import { supabase } from './supabase';

interface PolymarketAPIMarket {
  id: string;
  question: string;
  outcomePrices: string;
  volume: string;
  groupItemTagged?: string;
  endDate?: string;
  active: boolean;
}

export interface Market {
  id: string;
  question: string;
  probability: number;
  volume: number;
  category: string;
  end_date: string | null;
  is_active: boolean;
}

export async function fetchAndStoreMarkets(): Promise<number> {
  const res = await fetch(
    'https://gamma-api.polymarket.com/markets?limit=100&active=true',
    { next: { revalidate: 0 } }
  );

  if (!res.ok) {
    throw new Error(`Polymarket API error: ${res.status}`);
  }

  const raw: PolymarketAPIMarket[] = await res.json();

  const markets: Market[] = raw.map((m) => {
    let probability = 0;
    try {
      const prices = JSON.parse(m.outcomePrices);
      probability = parseFloat(prices[0]) ?? 0;
    } catch {
      probability = 0;
    }

    return {
      id: m.id,
      question: m.question,
      probability,
      volume: parseFloat(m.volume) || 0,
      category: m.groupItemTagged ?? 'uncategorized',
      end_date: m.endDate ?? null,
      is_active: m.active,
    };
  });

  const { error } = await supabase.from('markets').upsert(markets, {
    onConflict: 'id',
  });

  if (error) {
    throw new Error(`Supabase upsert error: ${error.message}`);
  }

  return markets.length;
}
