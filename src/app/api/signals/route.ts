import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

interface SignalRow {
  id: string;
  market_id: string;
  is_relevant?: boolean;
  relevance_score?: number;
  confidence?: number;
  analyzed_at?: string;
}

interface MarketRow {
  id: string;
  question: string;
  probability: number | null;
  volume: number | null;
  liquidity?: number | null;
  category?: string | null;
  end_date?: string | null;
}

function sortSignals(a: SignalRow, b: SignalRow) {
  if (Boolean(b.is_relevant) !== Boolean(a.is_relevant)) {
    return Number(Boolean(b.is_relevant)) - Number(Boolean(a.is_relevant));
  }

  const relevanceDelta = (b.relevance_score ?? 0) - (a.relevance_score ?? 0);
  if (relevanceDelta !== 0) return relevanceDelta;

  return (b.confidence ?? 0) - (a.confidence ?? 0);
}

export async function GET() {
  try {
    const supabase = getSupabaseClient();
    const { data: signals, error } = await supabase
      .from('signals')
      .select('*')
      .limit(100);

    if (error) throw new Error(error.message);

    const signalRows = ((signals ?? []) as SignalRow[]).sort(sortSignals);
    const marketIds = Array.from(new Set(signalRows.map((signal) => signal.market_id).filter(Boolean)));

    const marketMap = new Map<string, MarketRow>();

    if (marketIds.length > 0) {
      const { data: markets, error: marketError } = await supabase
        .from('markets')
        .select('id, question, probability, volume, liquidity, category, end_date')
        .in('id', marketIds);

      if (marketError) throw new Error(marketError.message);

      for (const market of (markets ?? []) as MarketRow[]) {
        marketMap.set(market.id, market);
      }
    }

    return NextResponse.json({
      success: true,
      signals: signalRows.map((signal) => ({
        ...signal,
        markets: marketMap.get(signal.market_id) ?? null,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
