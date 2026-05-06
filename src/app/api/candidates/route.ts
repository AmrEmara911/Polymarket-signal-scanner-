import { NextResponse } from 'next/server';
import { getAnalysisCandidates } from '@/lib/filter';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const candidates = await getAnalysisCandidates(25);
    return NextResponse.json({ success: true, candidates });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
