import { DEFAULT_SECTORS, DEFAULT_STOCKS } from './bitcap';
import { getSupabaseClient } from './supabase';

export interface AnalystConfig {
  id: string;
  sectors: string[];
  stocks: string[];
  focus_notes: string;
  updated_at?: string;
}

export const DEFAULT_CONFIG: AnalystConfig = {
  id: 'default',
  sectors: DEFAULT_SECTORS,
  stocks: DEFAULT_STOCKS,
  focus_notes:
    'Prioritize public technology equities where Polymarket probabilities can change growth expectations, margins, regulation, supply chains, or valuation multiples.',
};

function cleanList(items: unknown, fallback: string[], uppercase = false) {
  if (!Array.isArray(items)) return fallback;

  const cleaned = items
    .map((item) => {
      const value = String(item).trim();
      return uppercase ? value.toUpperCase() : value;
    })
    .filter(Boolean);

  return cleaned.length ? Array.from(new Set(cleaned)) : fallback;
}

export async function getAnalystConfig(): Promise<AnalystConfig> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('analyst_config')
    .select('*')
    .eq('id', DEFAULT_CONFIG.id)
    .maybeSingle();

  if (error) {
    throw new Error(`Supabase config fetch error: ${error.message}`);
  }

  if (!data) {
    const { data: inserted, error: insertError } = await supabase
      .from('analyst_config')
      .insert(DEFAULT_CONFIG)
      .select('*')
      .single();

    if (insertError) {
      throw new Error(`Supabase config insert error: ${insertError.message}`);
    }

    return inserted as AnalystConfig;
  }

  return data as AnalystConfig;
}

export async function updateAnalystConfig(input: Partial<AnalystConfig>) {
  const supabase = getSupabaseClient();
  const nextConfig = {
    id: DEFAULT_CONFIG.id,
    sectors: cleanList(input.sectors, DEFAULT_CONFIG.sectors),
    stocks: cleanList(input.stocks, DEFAULT_CONFIG.stocks, true),
    focus_notes: String(input.focus_notes ?? DEFAULT_CONFIG.focus_notes).trim(),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('analyst_config')
    .upsert(nextConfig, { onConflict: 'id' })
    .select('*')
    .single();

  if (error) {
    throw new Error(`Supabase config upsert error: ${error.message}`);
  }

  return data as AnalystConfig;
}
