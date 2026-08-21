/**
 * GET /api/trajectory/analyses
 *
 * La dernière analyse (sans son dossier, qui pèse plusieurs centaines de Ko) plus
 * l'historique en résumé. Le dossier se récupère à la demande via
 * /api/trajectory/analyses/:id.
 */

import { NextResponse } from 'next/server';
import { derniereAnalyse, listerAnalyses } from '@/lib/trajectory/store';

export async function GET() {
  try {
    const [derniere, historique] = await Promise.all([derniereAnalyse(), listerAnalyses()]);

    if (!derniere) {
      return NextResponse.json({ derniere: null, historique });
    }

    const { dossier, ...sansDossier } = derniere;
    return NextResponse.json({
      derniere: {
        ...sansDossier,
        id: String((derniere as { _id?: unknown })._id ?? ''),
        // Le strict nécessaire du dossier pour afficher le cadre de lecture.
        fiabilite: dossier.fiabilite,
        meta: dossier.meta,
        comparables: dossier.comparables,
        carnet: dossier.carnet,
      },
      historique,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[TRAJECTORY/ANALYSES]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
