import { NextRequest, NextResponse } from 'next/server';
import { getCsvHeaders } from '@/lib/parsers/csv-utils';
import {
  detectRevenuePartnerFromHeaders,
  runRevenueCsvImport,
} from '@/lib/jobs/run-revenue-import';
import {
  ingestQueueEnabled,
  enqueueRevenueImport,
  REVENUE_IMPORT_MAX_BYTES,
} from '@/lib/jobs/ingest-queue';
import type { AffiliationPartner } from '@/lib/models/revenue';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const partnerOverrideRaw = formData.get('partner');
    const partnerOverride =
      partnerOverrideRaw && String(partnerOverrideRaw).trim()
        ? (String(partnerOverrideRaw).trim() as AffiliationPartner)
        : null;

    if (!file) {
      return NextResponse.json({ error: 'Aucun fichier fourni' }, { status: 400 });
    }

    const text = await file.text();
    if (!text.trim()) {
      return NextResponse.json({ error: 'Le fichier est vide' }, { status: 400 });
    }

    const headers = getCsvHeaders(text);
    const partnerResolved = partnerOverride ?? detectRevenuePartnerFromHeaders(headers);

    if (!partnerResolved) {
      return NextResponse.json(
        {
          error: 'Partenaire non reconnu. Veuillez sélectionner le partenaire manuellement.',
          detectedHeaders: headers,
        },
        { status: 422 },
      );
    }

    if (ingestQueueEnabled()) {
      const size = Buffer.byteLength(text, 'utf8');
      if (size > REVENUE_IMPORT_MAX_BYTES) {
        return NextResponse.json(
          {
            error: `Fichier trop volumineux pour la file (${(size / (1024 * 1024)).toFixed(1)} Mo, max ${REVENUE_IMPORT_MAX_BYTES / (1024 * 1024)} Mo). Réduisez le CSV ou contactez l’administrateur.`,
          },
          { status: 413 },
        );
      }
      const job = await enqueueRevenueImport({
        text,
        partner: partnerResolved,
      });
      return NextResponse.json(
        { queued: true, jobId: String(job.id), message: 'Import en file (worker Railway).' },
        { status: 202 },
      );
    }

    const result = await runRevenueCsvImport({
      text,
      partner: partnerOverride ?? undefined,
    });
    if (!result.ok) {
      return NextResponse.json(result.body, { status: result.status });
    }
    return NextResponse.json(result.body);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur inconnue';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** Détection automatique du partenaire sans import */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const preview = searchParams.get('headers');
  if (!preview) return NextResponse.json({ error: 'Paramètre headers manquant' }, { status: 400 });

  const headers = preview.split(',').map((h) => h.trim());
  const partner = detectRevenuePartnerFromHeaders(headers);
  return NextResponse.json({ partner });
}
