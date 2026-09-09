import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({ id: 'test', url: 'https://checkout.furlpay.com/test' });
}
