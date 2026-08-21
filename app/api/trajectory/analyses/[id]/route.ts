/**
 * GET /api/trajectory/analyses/:id
 *
 * Une analyse complète, dossier inclus — c'est ce qui permet de rouvrir une analyse
 * de l'an dernier et de retrouver les chiffres exacts sur lesquels elle reposait.
 */

import { NextResponse } from 'next/server';
import { analyseParId } from '@/lib/trajectory/store';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const doc = await analyseParId(id);
    if (!doc) {
      return NextResponse.json({ error: 'Analyse introuvable' }, { status: 404 });
    }
    return NextResponse.json(doc);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[TRAJECTORY/ANALYSE]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
