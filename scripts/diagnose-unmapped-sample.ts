/**
 * Expertise : échantillon de lignes affiliation_revenue encore sans siteName
 * (même filtre date / commission que reassign-affiliation-revenue.ts).
 *
 *   npx tsx scripts/diagnose-unmapped-sample.ts
 *   npx tsx scripts/diagnose-unmapped-sample.ts --limit 40
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { MongoClient } from 'mongodb';
import { buildAffiliateMaps } from '@/lib/affiliate-maps';
import type { AffiliationPartner } from '@/lib/models/revenue';

const PARTNERS: AffiliationPartner[] = ['getyourguide', 'booking', 'tiqets', 'discovercars', 'sendowl'];

function loadEnvFiles() {
  for (const name of ['.env.local', '.env']) {
    const p = resolve(process.cwd(), name);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq <= 0) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  }
}

function normalizeSendowlItemNameForLookup(name: string): string {
  return name.replace(/\(x\d+\)$/, '(x1)').trim();
}

function resolveTarget(
  partner: AffiliationPartner,
  affiliateId: string,
  productName: string,
  maps: Awaited<ReturnType<typeof buildAffiliateMaps>>,
  productNameMap: Record<string, string>,
): string | undefined {
  if (partner === 'booking') return maps.booking[affiliateId];
  if (partner === 'getyourguide') return maps.gyg[affiliateId];
  if (partner === 'discovercars') return maps.discovercars[affiliateId];
  if (partner === 'tiqets') return maps.tiqets[affiliateId];
  if (partner === 'sendowl') {
    return productNameMap[productName] ?? productNameMap[normalizeSendowlItemNameForLookup(productName)];
  }
  return undefined;
}

async function main() {
  loadEnvFiles();
  const limit = parseInt(process.argv.find((a, i) => process.argv[i - 1] === '--limit') || '25', 10) || 25;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI manquante');
    process.exit(1);
  }

  const today = new Date().toISOString().slice(0, 10);
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - 3);
  const startStr = d.toISOString().slice(0, 10);
  const endStr = today;

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME || 'dashboard_sites');
  const col = db.collection('affiliation_revenue');

  const maps = await buildAffiliateMaps(db);
  const soProducts = await db.collection('sendowl_products').find({}).toArray();
  const productNameMap: Record<string, string> = {};
  for (const p of soProducts) {
    if (p.productName && p.siteName) productNameMap[String(p.productName)] = String(p.siteName);
  }

  const cancelFilter = { $or: [{ status: { $exists: false } }, { status: { $not: /cancel/i } }] };
  const unassigned = { $or: [{ siteName: { $exists: false } }, { siteName: null }, { siteName: '' }] };
  const effectiveDateExpr = {
    $cond: [
      { $and: [{ $eq: ['$partner', 'booking'] }, { $gt: ['$bookingDateStr', null] }] },
      '$bookingDateStr',
      '$dateStr',
    ],
  };
  const baseFilter = {
    partner: { $in: PARTNERS },
    commissionActual: { $gt: 0 },
    ...cancelFilter,
    ...unassigned,
    $expr: {
      $and: [{ $gte: [effectiveDateExpr, startStr] }, { $lte: [effectiveDateExpr, endStr] }],
    },
  };

  const totalUnassigned = await col.countDocuments(baseFilter);

  const byPartner = await col
    .aggregate([
      { $match: baseFilter },
      { $group: { _id: '$partner', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ])
    .toArray();

  console.log('=== Contexte ===');
  console.log(`Plage ${startStr} → ${endStr}`);
  console.log(`Lignes encore sans siteName (filtre identique au script) : ${totalUnassigned}`);
  console.log('Répartition par partenaire :', Object.fromEntries(byPartner.map((x) => [x._id, x.n])));

  console.log('\n=== Clés présentes dans les maps (sites) ===');
  console.log('booking IDs   :', Object.keys(maps.booking).length, '→', Object.keys(maps.booking).join(', '));
  console.log('gyg campaigns :', Object.keys(maps.gyg).length, '→', Object.keys(maps.gyg).join(', '));
  console.log('discovercars  :', Object.keys(maps.discovercars).length, '→', Object.keys(maps.discovercars).join(', '));
  console.log('tiqets        :', Object.keys(maps.tiqets).length, '→', Object.keys(maps.tiqets).join(', '));
  console.log('sendowl_products (productName→site) :', Object.keys(productNameMap).length, 'entrées');

  const cursor = col.find(baseFilter, {
    projection: {
      partner: 1,
      affiliateId: 1,
      productName: 1,
      dateStr: 1,
      bookingDateStr: 1,
      orderId: 1,
      commissionActual: 1,
    },
  });

  console.log(`\n=== Échantillon jusqu’à ${limit} lignes (non résolues par la map) ===\n`);

  let shown = 0;
  for await (const doc of cursor as AsyncIterable<{
    partner: AffiliationPartner;
    affiliateId?: string;
    productName?: string;
    dateStr?: string;
    bookingDateStr?: string;
    orderId?: string;
    commissionActual?: number;
  }>) {
    const aid = (doc.affiliateId ?? '').toString();
    const pn = (doc.productName ?? '').toString();
    const target = resolveTarget(doc.partner, aid, pn, maps, productNameMap);
    if (target) continue;

    shown++;
    const eff = doc.partner === 'booking' && doc.bookingDateStr ? doc.bookingDateStr : doc.dateStr;
    console.log(`--- #${shown} ${doc.partner} ---`);
    console.log('  orderId       ', doc.orderId);
    console.log('  date effective', eff, '| dateStr', doc.dateStr, '| bookingDateStr', doc.bookingDateStr ?? '(absent)');
    console.log('  affiliateId   ', JSON.stringify(aid), aid.length === 0 ? '← VIDE' : '');
    console.log('  productName   ', pn ? JSON.stringify(pn.slice(0, 120)) + (pn.length > 120 ? '…' : '') : '(vide)');
    if (doc.partner === 'sendowl' && pn) {
      const norm = normalizeSendowlItemNameForLookup(pn);
      console.log('  normalisé (x1)', norm !== pn ? JSON.stringify(norm) : '(identique)');
      const exact = pn in productNameMap;
      const normHit = norm in productNameMap && norm !== pn;
      console.log('  dans sendowl_products ? exact=', exact, 'via normalisé=', normHit);
    }
    if (doc.partner === 'booking' && aid) {
      const keys = Object.keys(maps.booking);
      const asNum = String(Number(aid));
      const numMatch = !Number.isNaN(Number(aid)) && maps.booking[asNum];
      console.log('  map booking a cette clé ?', aid in maps.booking, '| même ID en number string ?', !!numMatch, 'exemple clés:', keys.slice(0, 5).join(', '));
    }
    if (doc.partner === 'getyourguide' && aid) {
      console.log('  map gyg a cette clé ?', aid in maps.gyg, '| clés gyg:', Object.keys(maps.gyg).join(', '));
    }

    if (shown >= limit) break;
  }

  if (shown === 0) {
    console.log('(Aucune ligne non mappée dans la plage — tout est soit attribué soit résolvable.)');
  }

  console.log('\n=== Lignes sans siteName ET affiliateId vide (par partenaire) ===');
  for (const p of PARTNERS) {
    const n = await col.countDocuments({
      $and: [
        baseFilter,
        { partner: p },
        { $or: [{ affiliateId: { $exists: false } }, { affiliateId: null }, { affiliateId: '' }] },
      ],
    });
    if (n > 0) console.log(`  ${p}: ${n}`);
  }

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
