import { NextRequest, NextResponse } from 'next/server';
import { analyzeMarkets, type Sensitivity } from '@/lib/filter';

export const dynamic = 'force-dynamic';

const VALID_SENSITIVITIES: Sensitivity[] = ['strict', 'balanced', 'broad'];

function parseSensitivity(value: string | null): Sensitivity {
  if (value && VALID_SENSITIVITIES.includes(value as Sensitivity)) {
    return value as Sensitivity;
  }
  return 'balanced';
}

async function handler(req: NextRequest) {
  try {
    const sensitivity = parseSensitivity(req.nextUrl.searchParams.get('sensitivity'));
    const result = await analyzeMarkets(36, sensitivity);
    return NextResponse.json({ success: true, sensitivity, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export const GET = handler;
export const POST = handler;
