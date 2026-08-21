import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';
import { resolvePeriod } from '@/lib/period-utils';
import type { AffiliationPartner } from '@/lib/models/revenue';
import { buildAffiliateMaps } from '@/lib/affiliate-maps';

const PARTNERS: AffiliationPartner[] = ['getyourguide', 'booking', 'tiqets', 'discovercars', 'sendowl'];

type MappingKind = 'affiliateId' | 'productName' | 'aucun';

/** Libellé du groupe des lignes sans aucun identifiant exploitable. */
const SANS_IDENTIFIANT = '(aucun identifiant)';

export interface UnassignedGroup {
  partner: AffiliationPartner;
  mappingKind: MappingKind;
  mappingKey: string;
  reason: string;
  exampleReservationCity?: string;
  exampleReservationCountry?: string;
  revenue: number;
  count: number;
  exampleOrderId: string;
  exampleDateStr: string;
}

function normalizeSendowlItemNameForLookup(name: string): string {
  // sendowl parser normalise pour le matching de mapping: "...(x2)" → "...(x1)"
  return name.replace(/\(x\d+\)$/, '(x1)').trim();
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const periodType = searchParams.get('periodType') || 'month';
    const periodValue = searchParams.get('periodValue') ?? undefined;
    const customStart = searchParams.get('start') ?? undefined;
    const customEnd = searchParams.get('end') ?? undefined;

    const limit = Math.max(10, parseInt(searchParams.get('limit') || '200', 10));

    const { startStr, endStr } = resolvePeriod(periodType, periodValue, customStart, customEnd);

    const db = await getDatabase();
    const col = db.collection('affiliation_revenue');

    // Tables de mapping pour générer des "raisons"
    const affiliateMaps = await buildAffiliateMaps(db);

    const soProducts = await db.collection('sendowl_products').find({}).toArray();
    const productNameMap: Record<string, string> = {};
    for (const p of soProducts) {
      if (p.productName && p.siteName) productNameMap[p.productName] = p.siteName;
    }

    const cancelFilter = { $or: [{ status: { $exists: false } }, { status: { $not: /cancel/i } }] };
    const unassignedSiteFilter = {
      $or: [
        { siteName: { $exists: false } },
        { siteName: null },
        { siteName: '' },
      ],
    };

    // Important: on ne renvoie que des clés non vides
    const agg = await col.aggregate([
      {
        $match: {
          dateStr: { $gte: startStr, $lte: endStr },
          partner: { $in: PARTNERS },
          commissionActual: { $gt: 0 },
          ...cancelFilter,
          ...unassignedSiteFilter,
        },
      },
      {
        $project: {
          partner: 1,
          affiliateId: 1,
          productName: 1,
          commissionActual: 1,
          orderId: 1,
          dateStr: 1,
          reservationCity: 1,
          reservationCountry: 1,
          hasAffiliateId: {
            $gt: [{ $strLenCP: { $ifNull: ['$affiliateId', ''] } }, 0],
          },
        },
      },
      {
        $addFields: {
          _cleBrute: { $cond: ['$hasAffiliateId', '$affiliateId', { $ifNull: ['$productName', ''] }] },
        },
      },
      {
        /* Les lignes sans aucun identifiant étaient auparavant écartées. C'est la
         * catégorie la plus lourde chez certains partenaires, et l'écarter faisait
         * disparaître le principal motif de non-attribution : le rapport paraissait
         * complet alors qu'il masquait l'essentiel. Elles sont désormais regroupées
         * sous un libellé explicite. */
        $addFields: {
          mappingKind: {
            $cond: [{ $eq: ['$_cleBrute', ''] }, 'aucun', { $cond: ['$hasAffiliateId', 'affiliateId', 'productName'] }],
          },
          mappingKey: { $cond: [{ $eq: ['$_cleBrute', ''] }, SANS_IDENTIFIANT, '$_cleBrute'] },
        },
      },
      {
        $group: {
          _id: { partner: '$partner', mappingKind: '$mappingKind', mappingKey: '$mappingKey' },
          revenue: { $sum: '$commissionActual' },
          count: { $sum: 1 },
          exampleOrderId: { $first: '$orderId' },
          exampleDateStr: { $first: '$dateStr' },
          exampleReservationCity: { $first: '$reservationCity' },
          exampleReservationCountry: { $first: '$reservationCountry' },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: limit },
    ]).toArray();

    const groups: UnassignedGroup[] = agg.map((g: any) => {
      const partner = g._id.partner as AffiliationPartner;
      const mappingKind = g._id.mappingKind as MappingKind;
      const mappingKey = String(g._id.mappingKey ?? '');

      let reason = 'Non attribué';
      if (mappingKind === 'affiliateId') {
        const mapped =
          partner === 'booking'
            ? affiliateMaps.booking[mappingKey]
            : partner === 'getyourguide'
              ? affiliateMaps.gyg[mappingKey]
              : partner === 'discovercars'
                ? affiliateMaps.discovercars[mappingKey]
                : partner === 'tiqets'
                  ? affiliateMaps.tiqets[mappingKey]
                  : undefined;

        reason = mapped
          ? 'Clé trouvée dans le mapping, mais `siteName` manquant (incohérence)'
          : `Clé non mappée (${partner} / ${mappingKey})`;
      } else if (mappingKind === 'aucun') {
        reason =
          `Aucun identifiant sur ces lignes (ni code d'affiliation, ni nom de produit) : ` +
          `rien ne permet de les rattacher à un site. Ce n'est pas un mapping à compléter mais un ` +
          `balisage de liens à corriger — les liens ${partner} concernés ne portent pas le paramètre ` +
          `qui identifie le site. Aucun code ajouté sur une fiche site ne récupérera ce revenu, ` +
          `ni pour le passé ni pour l'avenir tant que les liens ne sont pas corrigés.`;
      } else {
        // productName
        if (partner === 'sendowl') {
          const direct = productNameMap[mappingKey];
          const normalized = productNameMap[normalizeSendowlItemNameForLookup(mappingKey)];
          reason = direct || normalized
            ? 'Produit trouvé dans le mapping, mais `siteName` manquant (incohérence)'
            : `Produit non mappé (sendowl) : ${mappingKey}`;
        } else if (partner === 'tiqets') {
          reason = 'Campagne non mappée (historique sans `affiliateId` stocké)';
        } else {
          reason = 'Identifiant de mapping manquant (impossible de rattacher)';
        }
      }

      return {
        partner,
        mappingKind,
        mappingKey,
        reason,
        exampleReservationCity: g.exampleReservationCity ? String(g.exampleReservationCity) : undefined,
        exampleReservationCountry: g.exampleReservationCountry ? String(g.exampleReservationCountry) : undefined,
        revenue: Math.round((g.revenue ?? 0) * 100) / 100,
        count: g.count ?? 0,
        exampleOrderId: String(g.exampleOrderId ?? ''),
        exampleDateStr: String(g.exampleDateStr ?? ''),
      };
    });

    const groupsByPartner = Object.fromEntries(
      PARTNERS.map((p) => [p, [] as UnassignedGroup[]]),
    ) as Record<AffiliationPartner, UnassignedGroup[]>;

    for (const g of groups) {
      groupsByPartner[g.partner].push(g);
    }

    /* Totaux par partenaire, en distinguant ce qui est corrigeable par un mapping de ce
     * qui demande un travail sur les liens : les deux ne se traitent pas au même endroit.
     *
     * Attention au piège : un groupe clé par nom de produit n'est corrigeable QUE pour
     * SendOwl, où le nom du produit EST la clé de mapping. Pour les autres partenaires,
     * le nom de produit n'est qu'un repli d'affichage faute de code d'affiliation — le
     * motif de la ligne dit lui-même « impossible de rattacher ». Les compter comme
     * corrigeables laissait croire à un chantier de mapping là où il faut retoucher les
     * liens. */
    const estMappable = (g: UnassignedGroup) =>
      g.mappingKind === 'affiliateId' || (g.mappingKind === 'productName' && g.partner === 'sendowl');

    const totauxParPartenaire = PARTNERS.map((p) => {
      const gs = groupsByPartner[p];
      const mappables = gs.filter(estMappable);
      const nonMappables = gs.filter((g) => !estMappable(g));
      const somme = (arr: UnassignedGroup[]) => Math.round(arr.reduce((s2, g) => s2 + g.revenue, 0) * 100) / 100;
      return {
        partner: p,
        revenue: somme(gs),
        count: gs.reduce((s2, g) => s2 + g.count, 0),
        nb_groupes: gs.length,
        /** Un code d'affiliation existe : il suffit de l'ajouter sur la fiche du site. */
        revenue_corrigeable_par_mapping: somme(mappables),
        /** Aucun code exploitable : à corriger dans les liens, pas dans le dashboard. */
        revenue_non_rattachable: somme(nonMappables),
      };
    }).filter((t) => t.count > 0).sort((a, b) => b.revenue - a.revenue);

    const totalMappable = totauxParPartenaire.reduce((s2, t) => s2 + t.revenue_corrigeable_par_mapping, 0);
    const totalNonRattachable = totauxParPartenaire.reduce((s2, t) => s2 + t.revenue_non_rattachable, 0);

    return NextResponse.json({
      periodType,
      periodValue,
      startStr,
      endStr,
      limit,
      /* Une liste tronquée sans le dire laisserait croire à un inventaire complet. */
      tronque: groups.length >= limit
        ? `Liste tronquée à ${limit} groupes : relancer avec un limit plus élevé pour l'inventaire complet.`
        : null,
      synthese: {
        revenue_corrigeable_par_mapping: Math.round(totalMappable * 100) / 100,
        revenue_non_rattachable: Math.round(totalNonRattachable * 100) / 100,
        part_non_rattachable_pct: totalMappable + totalNonRattachable > 0
          ? Math.round((totalNonRattachable / (totalMappable + totalNonRattachable)) * 1000) / 10
          : null,
        lecture:
          'Le revenu « non rattachable » ne se corrige pas dans le dashboard : ces lignes ne portent ' +
          'aucun code identifiant le site. Seul le balisage des liens sur les sites peut le récupérer, ' +
          'et uniquement pour l\'avenir.',
      },
      totauxParPartenaire,
      groupsByPartner,
      totalRevenue: Math.round(groups.reduce((s, g) => s + g.revenue, 0) * 100) / 100,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[NON-ATTRIBUTED]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

