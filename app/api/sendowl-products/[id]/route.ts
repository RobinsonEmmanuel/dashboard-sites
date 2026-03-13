import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { productId, productName, siteCode, siteName, destination } = body;
    if (!productName || !siteCode || !siteName) {
      return NextResponse.json({ error: 'productName, siteCode et siteName sont requis' }, { status: 400 });
    }
    const db = await getDatabase();
    await db.collection('sendowl_products').updateOne(
      { _id: new ObjectId(id) },
      { $set: { productId: productId ?? '', productName, siteCode, siteName, destination: destination ?? '', updatedAt: new Date() } },
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const db = await getDatabase();
    await db.collection('sendowl_products').deleteOne({ _id: new ObjectId(id) });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
