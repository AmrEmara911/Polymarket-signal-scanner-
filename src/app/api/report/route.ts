import { NextResponse } from 'next/server';
import { generateSignalReport } from '@/lib/reports';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const report = await generateSignalReport();
    return NextResponse.json({ success: true, report });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
