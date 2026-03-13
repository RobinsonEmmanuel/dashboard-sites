import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';
import { SENDOWL_PRODUCTS_SEED } from '@/lib/models/sendowl-product';

export async function POST() {
  try {
    const db = await getDatabase();
    const col = db.collection('sendowl_products');
    const existing = await col.countDocuments();
    if (existing > 0) {
      return NextResponse.json({ message: `Déjà ${existing} produits en base — seed ignoré.`, skipped: true });
    }
    const docs = SENDOWL_PRODUCTS_SEED.map((p) => ({ ...p, createdAt: new Date(), updatedAt: new Date() }));
    await col.insertMany(docs);
    return NextResponse.json({ message: `${docs.length} produits importés avec succès.`, inserted: docs.length });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
