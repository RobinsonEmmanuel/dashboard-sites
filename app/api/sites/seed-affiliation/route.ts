import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';

// Codes affiliation pour les sites existants
const EXISTING_SITES_AFFILIATION: Record<string, {
  bookingAffiliateId?: string;
  discoverCarsChan?: string;
  gygCampaign?: string;
  tiqetsCampaign?: string;
}> = {
  'Normandie': { bookingAffiliateId: '2281719', discoverCarsChan: 'NL', gygCampaign: 'NL', tiqetsCampaign: 'NL' },
  'Loire':     { bookingAffiliateId: '2274925', discoverCarsChan: 'LL', gygCampaign: 'LL', tiqetsCampaign: 'LL' },
  'Corse':     { bookingAffiliateId: '2291718', discoverCarsChan: 'CL', gygCampaign: 'CL', tiqetsCampaign: 'CL' },
  'Provence':  { bookingAffiliateId: '2319618', discoverCarsChan: 'PL', gygCampaign: 'PL', tiqetsCampaign: 'PL' },
  'Canarias':  { bookingAffiliateId: '2370548', discoverCarsChan: 'CAL', gygCampaign: 'CAL', tiqetsCampaign: 'CAL' },
  'Canarias 2':{ bookingAffiliateId: '2421274', discoverCarsChan: 'CAL', gygCampaign: 'CAL', tiqetsCampaign: 'CAL' },
  'Madeira':   { bookingAffiliateId: '2410700', discoverCarsChan: 'madeira', gygCampaign: 'madeira' },
  'Andalucia': { bookingAffiliateId: '2420173', discoverCarsChan: 'andalucia', gygCampaign: 'andalucia', tiqetsCampaign: 'andalucia' },
  'Iceland':   { bookingAffiliateId: '2421273', discoverCarsChan: 'iceland', gygCampaign: 'iceland', tiqetsCampaign: 'iceland' },
  'Alsace':    { gygCampaign: 'alsace' },
  // Zigzag
  'ZZ EN':     { bookingAffiliateId: '1164282', discoverCarsChan: 'ZZOE', gygCampaign: 'ZZOE' },
  'ZZ FR':     { bookingAffiliateId: '1222027', discoverCarsChan: 'ZV',   gygCampaign: 'ZV' },
  'ZZ R':      { bookingAffiliateId: '1576014', discoverCarsChan: 'ZR',   gygCampaign: 'ZR' },
  'ZZ ES':     { bookingAffiliateId: '2262538', discoverCarsChan: 'ZE',   gygCampaign: 'ZE' },
};

// 7 nouveaux sites à créer (sans GA4/GSC, inactifs)
const NEW_SITES = [
  { name: 'Baleares Lovers', shortName: 'Baleares', ga4PropertyId: '', gscSiteUrl: '', gscType: 'domain', linkEvent: 'clic_affiliation', active: false, bookingAffiliateId: '2420174', discoverCarsChan: 'baleares', gygCampaign: 'baleares', tiqetsCampaign: 'baleares' },
  { name: 'Crete Lovers',    shortName: 'Crete',    ga4PropertyId: '', gscSiteUrl: '', gscType: 'domain', linkEvent: 'clic_affiliation', active: false, bookingAffiliateId: '2420175', discoverCarsChan: 'crete', gygCampaign: 'crete', tiqetsCampaign: 'crete' },
  { name: 'Maroc Lovers',    shortName: 'Maroc',    ga4PropertyId: '', gscSiteUrl: '', gscType: 'domain', linkEvent: 'clic_affiliation', active: false, bookingAffiliateId: '2432849', discoverCarsChan: 'maroc', gygCampaign: 'maroc', tiqetsCampaign: 'maroc' },
  { name: 'Portugal Lovers', shortName: 'Portugal', ga4PropertyId: '', gscSiteUrl: '', gscType: 'domain', linkEvent: 'clic_affiliation', active: false, bookingAffiliateId: '2420176', discoverCarsChan: 'portugal', gygCampaign: 'portugal', tiqetsCampaign: 'portugal' },
  { name: 'Scotland Lovers', shortName: 'Scotland', ga4PropertyId: '', gscSiteUrl: '', gscType: 'domain', linkEvent: 'clic_affiliation', active: false, bookingAffiliateId: '2420177', discoverCarsChan: 'scotland', gygCampaign: 'scotland', tiqetsCampaign: 'scotland' },
  { name: 'Croatia Lovers',  shortName: 'Croatia',  ga4PropertyId: '', gscSiteUrl: '', gscType: 'domain', linkEvent: 'clic_affiliation', active: false, bookingAffiliateId: '2433338', discoverCarsChan: 'croatia', gygCampaign: 'croatia', tiqetsCampaign: 'croatia' },
  { name: 'Sicilia Lovers',  shortName: 'Sicilia',  ga4PropertyId: '', gscSiteUrl: '', gscType: 'domain', linkEvent: 'clic_affiliation', active: false, bookingAffiliateId: '2433339', discoverCarsChan: 'sicilia', gygCampaign: 'sicilia', tiqetsCampaign: 'sicilia' },
];

export async function POST() {
  try {
    const db = await getDatabase();
    const col = db.collection('sites');

    const updated: string[] = [];
    const created: string[] = [];
    const errors: string[] = [];

    // Mise à jour des codes affiliation des sites existants
    for (const [shortName, codes] of Object.entries(EXISTING_SITES_AFFILIATION)) {
      if (Object.keys(codes).length === 0) continue;
      const result = await col.updateOne(
        { shortName },
        { $set: { ...codes, updatedAt: new Date() } }
      );
      if (result.matchedCount > 0) {
        updated.push(shortName);
      } else {
        errors.push(`Site non trouvé : ${shortName}`);
      }
    }

    // Insertion des 7 nouveaux sites (uniquement s'ils n'existent pas)
    for (const site of NEW_SITES) {
      const exists = await col.findOne({ shortName: site.shortName });
      if (exists) {
        // Mise à jour des codes si déjà présent
        await col.updateOne(
          { shortName: site.shortName },
          { $set: { bookingAffiliateId: site.bookingAffiliateId, discoverCarsChan: site.discoverCarsChan, gygCampaign: site.gygCampaign, tiqetsCampaign: site.tiqetsCampaign, updatedAt: new Date() } }
        );
        updated.push(`${site.shortName} (codes mis à jour)`);
      } else {
        await col.insertOne({ ...site, createdAt: new Date(), updatedAt: new Date() });
        created.push(site.shortName);
      }
    }

    return NextResponse.json({
      success: true,
      updated,
      created,
      errors,
      message: `${updated.length} sites mis à jour, ${created.length} sites créés`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur inconnue';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
