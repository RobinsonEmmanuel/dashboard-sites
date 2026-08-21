/**
 * GET  /api/trajectory/context — le contexte métier courant.
 * PUT  /api/trajectory/context — l'enregistre.
 *
 * Seul bloc du dossier saisi à la main : il porte l'intention, que ni un calcul ni une
 * recherche web ne peuvent produire. Les champs vides sont renvoyés comme tels, et le
 * dossier en avertit le modèle — mieux vaut un objectif absent qu'un objectif supposé.
 */

import { NextRequest, NextResponse } from 'next/server';
import { ecrireContexte, lireContexte } from '@/lib/trajectory/context-store';
import type { ContexteMetier } from '@/lib/trajectory/context';

export async function GET() {
  try {
    return NextResponse.json(await lireContexte());
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[TRAJECTORY/CONTEXT] GET', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<ContexteMetier>;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Corps JSON attendu' }, { status: 400 });
    }
    return NextResponse.json(await ecrireContexte(body));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[TRAJECTORY/CONTEXT] PUT', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
