import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/cron/ingest
 *
 * Déclenché automatiquement par Vercel Cron Jobs (vercel.json).
 * Vercel envoie automatiquement : Authorization: Bearer <CRON_SECRET>
 *
 * Variables d'environnement requises :
 *   CRON_SECRET          — secret partagé avec Vercel
 *   VERCEL_PROJECT_PRODUCTION_URL  — fourni auto par Vercel en production
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Vercel fournit VERCEL_PROJECT_PRODUCTION_URL en production (sans https://)
  // On peut aussi définir NEXT_PUBLIC_APP_URL comme fallback manuel
  const host =
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.NEXT_PUBLIC_APP_URL ?? `https://${process.env.VERCEL_URL}`;

  const headers = {
    'Content-Type': 'application/json',
    // On transmet le secret pour que les routes ingest puissent aussi le vérifier si besoin
    Authorization: `Bearer ${process.env.CRON_SECRET}`,
  };

  const body = JSON.stringify({ mode: 'incremental' });

  const startTime = Date.now();

  const [gscRes, ga4Res] = await Promise.allSettled([
    fetch(`${host}/api/ingest/gsc`, { method: 'POST', headers, body }),
    fetch(`${host}/api/ingest/ga4`, { method: 'POST', headers, body }),
  ]);

  const parseResult = async (
    settled: PromiseSettledResult<Response>,
    label: string
  ) => {
    if (settled.status === 'rejected') {
      console.error(`[CRON] ${label} fetch error:`, settled.reason);
      return { ok: false, error: String(settled.reason) };
    }
    const res = settled.value;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[CRON] ${label} HTTP ${res.status}:`, data);
    }
    return { ok: res.ok, status: res.status, ...data };
  };

  const [gsc, ga4] = await Promise.all([
    parseResult(gscRes, 'GSC'),
    parseResult(ga4Res, 'GA4'),
  ]);

  const durationMs = Date.now() - startTime;
  const success = gsc.ok && ga4.ok;

  console.log(`[CRON] Ingestion terminée en ${durationMs}ms — GSC: ${gsc.ok ? 'OK' : 'ERREUR'} | GA4: ${ga4.ok ? 'OK' : 'ERREUR'}`);

  return NextResponse.json(
    { success, durationMs, gsc, ga4 },
    { status: success ? 200 : 207 }
  );
}
