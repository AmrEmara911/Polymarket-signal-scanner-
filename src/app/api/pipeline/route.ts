import { NextResponse } from 'next/server';
import { runPipeline } from '@/lib/pipeline';

export const dynamic = 'force-dynamic';

async function handler() {
  try {
    const result = await runPipeline();
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export const GET = handler;
export const POST = handler;
