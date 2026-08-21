/**
 * PATCH /api/veille/:id — retient ou écarte un fait externe.
 *
 * Un fait écarté reste en base et reste visible : il n'entre simplement plus dans les
 * analyses. Écarter n'est pas supprimer — un fait mal daté aujourd'hui peut être
 * corrigé au prochain passage de veille.
 */

import { NextRequest, NextResponse } from 'next/server';
import { basculerRetenu } from '@/lib/trajectory/veille-store';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    if (typeof body?.retenu !== 'boolean') {
      return NextResponse.json({ error: 'Champ « retenu » (booléen) attendu' }, { status: 400 });
    }
    const ok = await basculerRetenu(id, body.retenu);
    if (!ok) return NextResponse.json({ error: 'Événement introuvable' }, { status: 404 });
    return NextResponse.json({ id, retenu: body.retenu });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
