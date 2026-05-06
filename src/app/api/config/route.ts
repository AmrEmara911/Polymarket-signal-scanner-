import { NextRequest, NextResponse } from 'next/server';
import { getAnalystConfig, updateAnalystConfig } from '@/lib/analyst-config';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const config = await getAnalystConfig();
    return NextResponse.json({ success: true, config });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const config = await updateAnalystConfig(body);
    return NextResponse.json({ success: true, config });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
