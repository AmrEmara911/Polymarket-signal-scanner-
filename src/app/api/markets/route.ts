import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = getSupabaseClient();
    const { count, error: countError } = await supabase
      .from('markets')
      .select('id', { count: 'exact', head: true });

    if (countError) throw new Error(countError.message);

    const { data, error } = await supabase
      .from('markets')
      .select('id, question, probability, volume, category, end_date, fetched_at')
      .order('volume', { ascending: false })
      .limit(8);

    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, count: count ?? 0, markets: data ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
