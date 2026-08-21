/**
 * GET /api/revenue/non-attributed/samples?partner=discovercars&limit=5
 *
 * Documents BRUTS des lignes de revenu qu'on ne sait rattacher à aucun site, plus une
 * couverture champ par champ.
 *
 * Raison d'être : avant de conclure que les liens ne sont pas balisés, il faut écarter
 * l'hypothèse concurrente — que l'import perde l'information. Les deux produisent le
 * même symptôme (un champ vide en base) mais se corrigent à des endroits opposés : les
 * liens sur les sites d'un côté, le parseur de l'autre.
 *
 * Trois éléments tranchent :
 *   - la COUVERTURE de chaque champ : un champ vide à 100 % alors qu'il devrait toujours
 *     être rempli (le modèle de voiture d'une location, par exemple) accuse le parseur,
 *     pas le balisage ;
 *   - la répartition par DATE D'IMPORT : concentrée sur un import, c'est un fichier ou
 *     un format ; étalée sur tous, c'est systémique ;
 *   - le PRÉFIXE des identifiants de commande : un identifiant de repli (« dc-fp- »)
 *     signale que même la colonne d'identifiant était absente du fichier.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';
import { resolvePeriod } from '@/lib/period-utils';
import type { AffiliationPartner } from '@/lib/models/revenue';

const PARTNERS: AffiliationPartner[] = ['getyourguide', 'booking', 'tiqets', 'discovercars', 'sendowl'];

/** Champs dont on veut connaître le taux de remplissage. */
const CHAMPS = [
  'siteName', 'affiliateId', 'productName', 'orderId', 'dateStr', 'bookingDateStr',
  'checkOutDateStr', 'reservationCity', 'reservationCountry', 'status',
  'commissionActual', 'commissionMin', 'commissionN1',
];

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const partner = searchParams.get('partner') as AffiliationPartner | null;
    if (!partner || !PARTNERS.includes(partner)) {
      return NextResponse.json(
        { error: `Paramètre partner requis, parmi : ${PARTNERS.join(', ')}` },
        { status: 400 },
      );
    }
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '5', 10), 1), 50);
    const { startStr, endStr } = resolvePeriod(
      searchParams.get('periodType') ?? 'custom',
      searchParams.get('periodValue'),
      searchParams.get('start') ?? '2023-01-01',
      searchParams.get('end') ?? '2026-12-31',
    );

    const db = await getDatabase();
    const col = db.collection('affiliation_revenue');

    /* Même définition que la liste des non attribués : ni code d'affiliation, ni nom de
     * produit exploitable. */
    const filtre = {
      partner,
      dateStr: { $gte: startStr, $lte: endStr },
      commissionActual: { $gt: 0 },
      $and: [
        { $or: [{ siteName: { $exists: false } }, { siteName: null }, { siteName: '' }] },
        { $or: [{ affiliateId: { $exists: false } }, { affiliateId: null }, { affiliateId: '' }] },
        { $or: [{ productName: { $exists: false } }, { productName: null }, { productName: '' }] },
      ],
    };

    const [total, echantillons, parImport, couvertureBrute] = await Promise.all([
      col.countDocuments(filtre),
      col.find(filtre).sort({ dateStr: -1 }).limit(limit).toArray(),
      col.aggregate([
        { $match: filtre },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$importedAt' } },
          lignes: { $sum: 1 },
          revenue: { $sum: '$commissionActual' },
          premiereDate: { $min: '$dateStr' },
          derniereDate: { $max: '$dateStr' },
        } },
        { $sort: { _id: -1 } },
        { $limit: 30 },
      ]).toArray(),
      col.aggregate([
        { $match: filtre },
        { $group: {
          _id: null,
          total: { $sum: 1 },
          ...Object.fromEntries(CHAMPS.map((c) => [
            `rempli_${c}`,
            { $sum: { $cond: [{ $in: [{ $type: `$${c}` }, ['missing', 'null']] }, 0, 1] } },
          ])),
        } },
      ]).toArray(),
    ]);

    const brut = couvertureBrute[0] ?? { total: 0 };
    const couverture = CHAMPS.map((c) => {
      const remplis = Number(brut[`rempli_${c}`] ?? 0);
      const t = Number(brut.total ?? 0);
      return {
        champ: c,
        remplis,
        part_pct: t > 0 ? Math.round((remplis / t) * 1000) / 10 : null,
      };
    }).sort((a, b) => (b.part_pct ?? 0) - (a.part_pct ?? 0));

    /* Un identifiant de repli révèle une colonne absente du fichier source. */
    const prefixesRepli = ['dc-fp-', 'gyg-fp-', 'bk-fp-', 'tq-fp-', 'so-fp-'];
    const nbRepli = await col.countDocuments({
      ...filtre,
      orderId: { $regex: `^(${prefixesRepli.join('|')})` },
    });

    return NextResponse.json({
      partner,
      periode: { debut: startStr, fin: endStr },
      lignes_sans_identifiant: total,
      identifiants_de_repli: {
        lignes: nbRepli,
        part_pct: total > 0 ? Math.round((nbRepli / total) * 1000) / 10 : null,
        lecture: 'Un identifiant de repli signale que le fichier source n\'avait même pas de colonne d\'identifiant de commande.',
      },
      couverture_des_champs: couverture,
      par_date_import: parImport.map((r) => ({
        importe_le: String(r._id),
        lignes: r.lignes,
        revenue: Math.round(Number(r.revenue ?? 0) * 100) / 100,
        commandes_du: String(r.premiereDate),
        commandes_au: String(r.derniereDate),
      })),
      echantillons,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[NON-ATTRIBUTED/SAMPLES]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
