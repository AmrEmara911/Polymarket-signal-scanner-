import { NextResponse } from 'next/server';
import { analyzeMarkets } from '@/lib/filter';

export const dynamic = 'force-dynamic';

async function handler() {
  try {
    const result = await analyzeMarkets();
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export const GET = handler;
export const POST = handler;
