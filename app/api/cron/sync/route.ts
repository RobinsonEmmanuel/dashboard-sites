import { NextRequest, NextResponse } from 'next/server';

// Vercel Cron : durée max 60s (Pro) — la sync smart est rapide car incrémentale
export const maxDuration = 60;

/**
 * Route déclenchée par Vercel Cron toutes les nuits à 3h UTC.
 * Lance une ingestion "smart" GA4 + GSC en parallèle.
 * Protégée par CRON_SECRET pour éviter les appels non autorisés.
 */
export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.CRON_SECRET}`,
  };
  const body = JSON.stringify({ mode: 'smart' });

  try {
    const [ga4Res, gscRes] = await Promise.all([
      fetch(`${base}/api/ingest/ga4`, { method: 'POST', headers, body }),
      fetch(`${base}/api/ingest/gsc`, { method: 'POST', headers, body }),
    ]);

    const [ga4, gsc] = await Promise.all([ga4Res.json(), gscRes.json()]);

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      ga4: { totalRecords: ga4.totalRecords, errors: ga4.errors, period: ga4.period },
      gsc: { totalDaily: gsc.totalDaily, errors: gsc.errors, period: gsc.period },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[CRON] Erreur:', msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
