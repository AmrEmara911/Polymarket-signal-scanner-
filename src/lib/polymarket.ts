import { getSupabaseClient } from './supabase';

interface PolymarketAPIMarket {
  id: string;
  slug?: string;
  question: string;
  description?: string;
  outcomes?: string;
  outcomePrices?: string;
  volume?: string;
  liquidity?: string;
  category?: string;
  groupItemTagged?: string;
  endDate?: string;
  active: boolean;
}

export interface Market {
  id: string;
  slug: string | null;
  question: string;
  description: string | null;
  probability: number;
  yes_price: number;
  no_price: number | null;
  volume: number;
  liquidity: number;
  category: string;
  end_date: string | null;
  is_active: boolean;
  fetched_at: string;
  raw: PolymarketAPIMarket;
}

const DISCOVERY_SEARCH_TERMS = [
  'fed',
  'interest rates',
  'inflation',
  'tariff',
  'china',
  'semiconductor',
  'chips',
  'AI regulation',
  'OpenAI',
  'Nvidia',
  'Microsoft',
  'Google antitrust',
  'Apple app store',
  'Meta',
  'Amazon',
  'Bitcoin',
  'Ethereum',
  'crypto regulation',
  'SEC',
];

function parseJsonArray(value?: string): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function getYesPrice(market: PolymarketAPIMarket) {
  const outcomes = parseJsonArray(market.outcomes).map((outcome) => outcome.toLowerCase());
  const prices = parseJsonArray(market.outcomePrices).map((price) => Number.parseFloat(price));
  const yesIndex = outcomes.findIndex((outcome) => outcome === 'yes');
  const selectedPrice = prices[yesIndex >= 0 ? yesIndex : 0];

  return Number.isFinite(selectedPrice) ? selectedPrice : 0;
}

async function fetchPolymarketMarkets(params: Record<string, string | number | boolean>) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    searchParams.set(key, String(value));
  }

  const res = await fetch(`https://gamma-api.polymarket.com/markets?${searchParams.toString()}`, {
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    throw new Error(`Polymarket API error: ${res.status}`);
  }

  return (await res.json()) as PolymarketAPIMarket[];
}

export async function fetchAndStoreMarkets(limit = 250): Promise<number> {
  const supabase = getSupabaseClient();
  const rawById = new Map<string, PolymarketAPIMarket>();
  const pageSize = Math.min(limit, 250);

  const volumePages = await Promise.all(
    [0, pageSize, pageSize * 2].map((offset) =>
      fetchPolymarketMarkets({
        limit: pageSize,
        offset,
        active: true,
        order: 'volume',
        ascending: false,
      })
    )
  );

  for (const page of volumePages) {
    for (const market of page) {
      rawById.set(market.id, market);
    }
  }

  const searchedMarkets = await Promise.allSettled(
    DISCOVERY_SEARCH_TERMS.map((search) =>
      fetchPolymarketMarkets({
        limit: 75,
        active: true,
        search,
      })
    )
  );

  for (const result of searchedMarkets) {
    if (result.status !== 'fulfilled') continue;
    for (const market of result.value) {
      rawById.set(market.id, market);
    }
  }

  const fetchedAt = new Date().toISOString();
  const markets: Market[] = Array.from(rawById.values())
    .filter((market) => market.id && market.question)
    .map((market) => {
      const yesPrice = getYesPrice(market);

      return {
        id: market.id,
        slug: market.slug ?? null,
        question: market.question,
        description: market.description ?? null,
        probability: yesPrice,
        yes_price: yesPrice,
        no_price: yesPrice ? 1 - yesPrice : null,
        volume: Number.parseFloat(market.volume ?? '0') || 0,
        liquidity: Number.parseFloat(market.liquidity ?? '0') || 0,
        category: market.category ?? market.groupItemTagged ?? 'uncategorized',
        end_date: market.endDate ?? null,
        is_active: market.active,
        fetched_at: fetchedAt,
        raw: market,
      };
    });

  const { error } = await supabase.from('markets').upsert(markets, {
    onConflict: 'id',
  });

  if (error) {
    throw new Error(`Supabase upsert error: ${error.message}`);
  }

  // Record probability snapshot for movement detection
  const snapshots = markets.map((m) => ({
    market_id: m.id,
    probability: m.probability,
    recorded_at: fetchedAt,
  }));

  const { error: snapError } = await supabase
    .from('probability_snapshots')
    .insert(snapshots);

  if (snapError) {
    // Non-fatal — log but don't block ingest
    console.warn('[Ingest] Snapshot insert warning:', snapError.message);
  }

  return markets.length;
}
