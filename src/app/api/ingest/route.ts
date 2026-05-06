import { NextResponse } from 'next/server';
import { fetchAndStoreMarkets } from '@/lib/polymarket';

export async function GET() {
  try {
    const count = await fetchAndStoreMarkets();
    return NextResponse.json({ success: true, count });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
