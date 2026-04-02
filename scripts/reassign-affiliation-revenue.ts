/**
 * Réaffecte siteName sur affiliation_revenue (toutes sources partenaires + SendOwl)
 * à partir des codes affiliation de la collection `sites` et du mapping SendOwl.
 *
 * Usage (à la racine du projet) :
 *   npx tsx scripts/reassign-affiliation-revenue.ts
 *   npx tsx scripts/reassign-affiliation-revenue.ts --dry-run
 *   npx tsx scripts/reassign-affiliation-revenue.ts --start 2023-01-01 --end 2026-04-02
 *   npx tsx scripts/reassign-affiliation-revenue.ts --force
 *
 * --force : recalcule aussi les lignes qui ont déjà un siteName (écrase si la map donne une autre valeur).
 * Sans --force : même comportement que l’API auto-assign (uniquement siteName vide / absent).
 *
 * Variables d’environnement : MONGODB_URI, optionnellement MONGODB_DB_NAME (défaut dashboard_sites).
 * Charge automatiquement .env.local puis .env si présents.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { MongoClient, type AnyBulkWriteOperation } from 'mongodb';
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

function parseArgs() {
  const argv = process.argv.slice(2);
  let dryRun = false;
  let force = false;
  let start: string | undefined;
  let end: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') dryRun = true;
    else if (a === '--force') force = true;
    else if (a === '--start' && argv[i + 1]) {
      start = argv[++i];
    } else if (a === '--end' && argv[i + 1]) {
      end = argv[++i];
    } else if (a === '--help' || a === '-h') {
      console.log(`
Réaffectation affiliation_revenue → siteName

Options :
  --dry-run              Affiche les compteurs sans écrire en base
  --force                Aussi les documents qui ont déjà un siteName
  --start YYYY-MM-DD     Début (défaut : il y a 3 ans)
  --end YYYY-MM-DD       Fin (défaut : aujourd’hui UTC)
`);
      process.exit(0);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  if (!end) end = today;
  if (!start) {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() - 3);
    start = d.toISOString().slice(0, 10);
  }

  return { dryRun, force, startStr: start, endStr: end > today ? today : end };
}

function resolveTargetSiteName(
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
  const { dryRun, force, startStr, endStr } = parseArgs();

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI est requise (.env.local ou export).');
    process.exit(1);
  }

  const dbName = process.env.MONGODB_DB_NAME || 'dashboard_sites';
  console.log(`Plage : ${startStr} → ${endStr} | force=${force} | dry-run=${dryRun}`);

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const col = db.collection('affiliation_revenue');

  const affiliateMaps = await buildAffiliateMaps(db);
  const soProducts = await db.collection('sendowl_products').find({}).toArray();
  const productNameMap: Record<string, string> = {};
  for (const p of soProducts) {
    if (p.productName && p.siteName) productNameMap[String(p.productName)] = String(p.siteName);
  }

  const cancelFilter = { $or: [{ status: { $exists: false } }, { status: { $not: /cancel/i } }] };
  const unassignedSiteFilter = force
    ? {}
    : { $or: [{ siteName: { $exists: false } }, { siteName: null }, { siteName: '' }] };

  const effectiveDateExpr = {
    $cond: [
      { $and: [{ $eq: ['$partner', 'booking'] }, { $gt: ['$bookingDateStr', null] }] },
      '$bookingDateStr',
      '$dateStr',
    ],
  };

  const filter = {
    partner: { $in: PARTNERS },
    commissionActual: { $gt: 0 },
    ...cancelFilter,
    ...unassignedSiteFilter,
    $expr: {
      $and: [{ $gte: [effectiveDateExpr, startStr] }, { $lte: [effectiveDateExpr, endStr] }],
    },
  };

  const cursor = col.find(filter, { projection: { partner: 1, affiliateId: 1, productName: 1, siteName: 1 } });

  let scanned = 0;
  let wouldSet = 0;
  let skippedNoMap = 0;
  let unchanged = 0;
  const updatedByPartner: Record<AffiliationPartner, number> = {
    getyourguide: 0,
    booking: 0,
    tiqets: 0,
    discovercars: 0,
    sendowl: 0,
  };

  const batchSize = 500;
  let ops: AnyBulkWriteOperation[] = [];

  const flush = async () => {
    if (!ops.length) return;
    const bulkRes = await col.bulkWrite(ops, { ordered: false });
    const modified = bulkRes.modifiedCount ?? 0;
    console.log(`  … lot écrit, modifiedCount=${modified}`);
    ops = [];
  };

  for await (const doc of cursor as AsyncIterable<{
    _id: unknown;
    partner: AffiliationPartner;
    affiliateId?: string;
    productName?: string;
    siteName?: string;
  }>) {
    scanned++;
    const partner = doc.partner;
    const affiliateId = (doc.affiliateId ?? '').toString();
    const productName = (doc.productName ?? '').toString();

    const target = resolveTargetSiteName(partner, affiliateId, productName, affiliateMaps, productNameMap);
    if (!target) {
      skippedNoMap++;
      continue;
    }
    if (!force && doc.siteName) {
      unchanged++;
      continue;
    }
    if (force && doc.siteName === target) {
      unchanged++;
      continue;
    }

    wouldSet++;
    updatedByPartner[partner] += 1;
    if (!dryRun) {
      ops.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { siteName: target } },
        },
      });
      if (ops.length >= batchSize) await flush();
    }
  }

  await flush();

  console.log('\nRésumé');
  console.log('  scannés        ', scanned);
  console.log('  affectables    ', wouldSet, dryRun ? '(dry-run, non écrit)' : '');
  console.log('  sans map       ', skippedNoMap);
  console.log('  inchangés      ', unchanged);
  console.log('  par partenaire ', updatedByPartner);

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
