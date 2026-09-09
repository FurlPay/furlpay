import { NextResponse } from 'next/server';
import { createSession } from '@/lib/payment-engine';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    
    // Zod validation stub
    if (!body.amount || !body.currency || !body.merchantId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const session = await createSession(body);
    
    return NextResponse.json(session);
  } catch (error) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
