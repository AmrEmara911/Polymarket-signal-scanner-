import { NextRequest, NextResponse } from 'next/server';
import { analyzeMarkets, type Sensitivity } from '@/lib/filter';
import { getSupabaseClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const VALID_SENSITIVITIES: Sensitivity[] = ['strict', 'balanced', 'broad'];

function parseSensitivity(value: string | null | undefined): Sensitivity {
  if (value && VALID_SENSITIVITIES.includes(value as Sensitivity)) {
    return value as Sensitivity;
  }
  return 'balanced';
}

async function handler(req: NextRequest) {
  try {
    const supabase = getSupabaseClient();

    // DB is the source of truth — read persisted setting
    const { data: configRow } = await supabase
      .from('config')
      .select('value')
      .eq('key', 'filter_sensitivity')
      .single();

    const dbSensitivity = parseSensitivity(configRow?.value);

    // Query param overrides DB value (used by scheduled runs or direct API calls)
    const paramValue = req.nextUrl.searchParams.get('sensitivity');
    const sensitivity = paramValue ? parseSensitivity(paramValue) : dbSensitivity;

    const result = await analyzeMarkets(36, sensitivity);
    return NextResponse.json({ success: true, sensitivity, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export const GET = handler;
export const POST = handler;
