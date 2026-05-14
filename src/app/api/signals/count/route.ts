import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
};

export async function GET() {
  try {
    const supabase = getSupabaseClient();
    const { count, error } = await supabase
      .from('signals')
      .select('*', { count: 'exact', head: true })
      .eq('is_relevant', true);

    if (error) throw new Error(error.message);

    return NextResponse.json(
      { success: true, count: count ?? 0 },
      { headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
