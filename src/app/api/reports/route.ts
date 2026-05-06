import { NextResponse } from 'next/server';
import { generateSignalReport } from '@/lib/reports';
import { getSupabaseClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('reports')
      .select('*')
      .order('generated_at', { ascending: false })
      .limit(10);

    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, reports: data ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST() {
  try {
    const report = await generateSignalReport();
    return NextResponse.json({ success: true, report });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
