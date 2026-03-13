import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';
import { DEFAULT_SITES } from '@/lib/models/site';

export async function POST() {
  try {
    const db = await getDatabase();
    const collection = db.collection('sites');

    const existing = await collection.countDocuments();
    if (existing > 0) {
      return NextResponse.json(
        { message: `${existing} site(s) déjà présents — seed ignoré.`, skipped: true },
        { status: 200 }
      );
    }

    const now = new Date();
    const docs = DEFAULT_SITES.map((s) => ({ ...s, createdAt: now, updatedAt: now }));
    const result = await collection.insertMany(docs);

    return NextResponse.json({
      message: `${result.insertedCount} sites insérés avec succès.`,
      insertedCount: result.insertedCount,
    });
  } catch (error) {
    console.error('[SEED] error:', error);
    return NextResponse.json({ error: 'Erreur lors du seed' }, { status: 500 });
  }
}
