/**
 * GET /api/trajectory/dossier
 *
 * Le dossier de trajectoire brut, tel qu'il est donné au modèle. Exposé pour que
 * chaque chiffre cité dans une analyse soit vérifiable — c'est la contrepartie de
 * la règle « le modèle ne calcule rien ».
 *
 * ?today=YYYY-MM-DD pour rejouer le dossier à une date donnée.
 */

import { NextRequest, NextResponse } from 'next/server';
import { buildTrajectoryDossier } from '@/lib/trajectory/build-dossier';

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    const todayStr = new URL(req.url).searchParams.get('today') ?? undefined;
    const dossier = await buildTrajectoryDossier({ todayStr });
    return NextResponse.json(dossier);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[TRAJECTORY/DOSSIER]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
