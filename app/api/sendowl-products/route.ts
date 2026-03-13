import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';

export async function GET() {
  try {
    const db = await getDatabase();
    const products = await db.collection('sendowl_products')
      .find({})
      .sort({ siteName: 1, productName: 1 })
      .toArray();
    return NextResponse.json(products);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { productId, productName, siteCode, siteName, destination } = body;
    if (!productName || !siteCode || !siteName) {
      return NextResponse.json({ error: 'productName, siteCode et siteName sont requis' }, { status: 400 });
    }
    const db = await getDatabase();
    const result = await db.collection('sendowl_products').insertOne({
      productId: productId ?? '',
      productName,
      siteCode,
      siteName,
      destination: destination ?? '',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return NextResponse.json({ _id: result.insertedId }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
