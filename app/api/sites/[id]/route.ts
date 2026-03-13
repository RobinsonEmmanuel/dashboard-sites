import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDatabase } from '@/lib/mongodb';
import type { Site } from '@/lib/models/site';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const db = await getDatabase();
    const site = await db.collection<Site>('sites').findOne({ _id: new ObjectId(id) as any });

    if (!site) {
      return NextResponse.json({ error: 'Site introuvable' }, { status: 404 });
    }
    return NextResponse.json(site);
  } catch (error) {
    console.error('[SITES] GET/:id error:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const body = await request.json();
    const {
      name, shortName, ga4PropertyId, gscSiteUrl, gscType, linkEvent, active,
      bookingAffiliateId, discoverCarsChan, gygCampaign, tiqetsCampaign,
    } = body;

    if (!name || !shortName || !ga4PropertyId || !gscSiteUrl || !gscType || !linkEvent) {
      return NextResponse.json({ error: 'Tous les champs sont requis' }, { status: 400 });
    }

    const db = await getDatabase();
    const result = await db.collection<Site>('sites').findOneAndUpdate(
      { _id: new ObjectId(id) as any },
      {
        $set: {
          name, shortName, ga4PropertyId, gscSiteUrl, gscType, linkEvent,
          active: active ?? true,
          ...(bookingAffiliateId !== undefined ? { bookingAffiliateId } : {}),
          ...(discoverCarsChan   !== undefined ? { discoverCarsChan }   : {}),
          ...(gygCampaign        !== undefined ? { gygCampaign }        : {}),
          ...(tiqetsCampaign     !== undefined ? { tiqetsCampaign }     : {}),
          updatedAt: new Date(),
        },
      },
      { returnDocument: 'after' }
    );

    if (!result) {
      return NextResponse.json({ error: 'Site introuvable' }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error('[SITES] PUT/:id error:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const db = await getDatabase();
    const result = await db.collection<Site>('sites').deleteOne({ _id: new ObjectId(id) as any });

    if (result.deletedCount === 0) {
      return NextResponse.json({ error: 'Site introuvable' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[SITES] DELETE/:id error:', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
