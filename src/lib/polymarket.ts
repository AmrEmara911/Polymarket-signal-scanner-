import { getSupabaseClient } from './supabase';

interface PolymarketAPIEvent {
  slug?: string;
  title?: string;
}

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
  /**
   * Each market belongs to a parent event. The PUBLIC URL on polymarket.com
   * is keyed off the EVENT slug, NOT the market's own slug — this is the
   * one detail that makes URL construction correct vs 404.
   */
  events?: PolymarketAPIEvent[];
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
  market_url: string;
  fetched_at: string;
  raw: PolymarketAPIMarket;
}

/**
 * Shape accepted by `buildPolymarketUrl`. Both the API response and the DB
 * row can satisfy this — fields are all optional so the function can degrade
 * gracefully when called from the frontend with a partial DB row.
 */
export interface MarketUrlInput {
  events?: Array<{ slug?: string | null }> | null;
  slug?: string | null;
  question?: string | null;
  id?: string | null;
}

/**
 * Build a public Polymarket URL for a market.
 *
 * IMPORTANT: Polymarket markets are nested under parent events. The market's
 * OWN `slug` field is NOT the URL slug — that route returns 404. The correct
 * slug lives on `events[0].slug`. We try in this order:
 *   1. Parent event slug (canonical, always works when events array present)
 *   2. Market's own slug treated as event slug (legacy/fallback, may 404)
 *   3. Search URL by question text (always works regardless of slug format)
 *   4. id-based URL (last resort)
 */
export function buildPolymarketUrl(market: MarketUrlInput): string {
  // 1. Parent event slug — the correct URL key
  const eventSlug = market.events?.[0]?.slug;
  if (eventSlug && eventSlug.trim()) {
    return `https://polymarket.com/event/${eventSlug.trim()}`;
  }

  // 2. Market's own slug as event slug (legacy, may 404 but worth trying
  //    when the events array isn't available — e.g. building from a DB row)
  if (market.slug && market.slug.trim()) {
    return `https://polymarket.com/event/${market.slug.trim()}`;
  }

  // 3. Search by question text — the always-works fallback
  if (market.question && market.question.trim()) {
    return `https://polymarket.com/?q=${encodeURIComponent(market.question.trim())}`;
  }

  // 4. id-based URL (rarely needed, but better than nothing)
  if (market.id) {
    return `https://polymarket.com/market/${market.id}`;
  }

  return 'https://polymarket.com';
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

      const slug = market.slug ?? null;
      return {
        id: market.id,
        slug,
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
        // Pass the FULL market — the URL builder needs `events` to pick the
        // parent event slug (the only slug that yields a working URL).
        market_url: buildPolymarketUrl(market),
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

  // Record a probability snapshot for every market
  const recordedAt = new Date().toISOString();
  const snapshots = markets.map((m) => ({
    market_id: m.id,
    probability: m.probability,
    recorded_at: recordedAt,
  }));

  const { error: snapError, count: snapshotInsertCount } = await supabase
    .from('probability_snapshots')
    .insert(snapshots, { count: 'exact' });

  if (snapError) {
    console.error('[Snapshots] Failed to record probability snapshots:', snapError.message);
    throw new Error(`Supabase snapshot insert error: ${snapError.message}`);
  }

  console.log(`[Snapshots] ${snapshotInsertCount ?? snapshots.length} new snapshots recorded`);

  return markets.length;
}
