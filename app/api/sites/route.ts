import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';
import type { Site } from '@/lib/models/site';

export async function GET() {
  try {
    const db = await getDatabase();
    const sites = await db
      .collection<Site>('sites')
      .find({})
      .sort({ name: 1 })
      .toArray();

    return NextResponse.json(sites);
  } catch (error) {
    console.error('[SITES] GET error:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, shortName, ga4PropertyId, gscSiteUrl, gscType, linkEvent, active } = body;

    if (!name || !shortName || !ga4PropertyId || !gscSiteUrl || !gscType || !linkEvent) {
      return NextResponse.json({ error: 'Tous les champs sont requis' }, { status: 400 });
    }

    const db = await getDatabase();
    const now = new Date();
    const site: Omit<Site, '_id'> = {
      name,
      shortName,
      ga4PropertyId,
      gscSiteUrl,
      gscType,
      linkEvent,
      active: active ?? true,
      createdAt: now,
      updatedAt: now,
    };

    const result = await db.collection<Omit<Site, '_id'>>('sites').insertOne(site);
    return NextResponse.json({ _id: result.insertedId, ...site }, { status: 201 });
  } catch (error) {
    console.error('[SITES] POST error:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
