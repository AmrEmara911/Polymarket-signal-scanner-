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
  probability_24h_ago: number | null;
  yes_price: number;
  no_price: number | null;
  volume: number;
  liquidity: number;
  category: string;
  end_date: string | null;
  is_active: boolean;
  market_url: string;
  fetched_at: string;
  last_updated_at: string;
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

  // 2. Market's own slug as market slug (the correct path for individual markets)
  if (market.slug && market.slug.trim()) {
    return `https://polymarket.com/market/${market.slug.trim()}`;
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
    cache: 'no-store',
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    throw new Error(`Polymarket API error: ${res.status}`);
  }

  return (await res.json()) as PolymarketAPIMarket[];
}

function getMissingColumn(message: string) {
  return (
    message.match(/Could not find the '([^']+)' column/)?.[1] ??
    message.match(/column \w+\.([a-zA-Z0-9_]+) does not exist/)?.[1] ??
    null
  );
}

function removeColumnFromMarkets(markets: Array<Record<string, unknown>>, column: string) {
  return markets.map((market) => {
    const nextMarket = { ...market };
    delete nextMarket[column];
    return nextMarket;
  });
}

async function fetchExistingProbabilities(
  supabase: ReturnType<typeof getSupabaseClient>,
  ids: string[]
) {
  const previousById = new Map<string, number>();
  const chunkSize = 500;

  for (let index = 0; index < ids.length; index += chunkSize) {
    const chunk = ids.slice(index, index + chunkSize);
    const { data, error } = await supabase
      .from('markets')
      .select('id, probability')
      .in('id', chunk);

    if (error) {
      console.warn('[Ingest] Could not read previous market probabilities:', error.message);
      return previousById;
    }

    for (const row of data ?? []) {
      const probability = Number(row.probability);
      if (Number.isFinite(probability)) {
        previousById.set(row.id, probability);
      }
    }
  }

  return previousById;
}

async function upsertMarketsWithSchemaFallback(markets: Market[]) {
  const supabase = getSupabaseClient();
  let mutableMarkets = markets.map((market) => ({ ...market })) as Array<Record<string, unknown>>;
  const removedColumns: string[] = [];

  for (let attempt = 0; attempt < 10; attempt += 1) {
    let errorOccurred = false;
    let lastError: any = null;

    // Chunk the upsert to avoid statement timeouts for large payloads
    const CHUNK_SIZE = 250;
    for (let i = 0; i < mutableMarkets.length; i += CHUNK_SIZE) {
      const chunk = mutableMarkets.slice(i, i + CHUNK_SIZE);
      const { error } = await supabase.from('markets').upsert(chunk, {
        onConflict: 'id',
      });

      if (error) {
        errorOccurred = true;
        lastError = error;
        break; // Stop processing chunks if we hit a schema error, so we can fallback and retry the whole set
      }
    }

    if (!errorOccurred) {
      if (removedColumns.length > 0) {
        console.warn('[Ingest] Markets upsert skipped missing columns:', removedColumns.join(', '));
      }
      return;
    }

    const missingColumn = getMissingColumn(lastError?.message || '');
    if (!missingColumn) {
      throw new Error(`Supabase upsert error: ${lastError?.message}`);
    }

    removedColumns.push(missingColumn);
    mutableMarkets = removeColumnFromMarkets(mutableMarkets, missingColumn);
  }

  throw new Error(
    `Supabase upsert error: schema fallback removed too many columns (${removedColumns.join(
      ', '
    )})`
  );
}

export async function fetchAndStoreMarkets(limit = 250): Promise<number> {
  const supabase = getSupabaseClient();
  const rawById = new Map<string, PolymarketAPIMarket>();
  const pageSize = Math.min(limit, 250);

  // 1. Fetch active signals from DB to ensure their prices stay fresh
  const { data: existingSignals } = await supabase.from('signals').select('market_id');
  if (existingSignals && existingSignals.length > 0) {
    const ids = existingSignals.map((s) => s.market_id).filter(Boolean);
    console.log(`[Ingest] Refreshing ${ids.length} existing signals`);
    
    // Fetch individually (in chunks of 50 to avoid hammering API)
    const chunkSize = 50;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const results = await Promise.allSettled(
        chunk.map((id) =>
          fetch(`https://gamma-api.polymarket.com/markets/${id}`)
            .then((r) => r.json())
            .catch(() => null)
        )
      );
      
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value && result.value.id) {
          rawById.set(result.value.id, result.value as PolymarketAPIMarket);
        }
      }
    }
  }

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

  const previousProbabilities = await fetchExistingProbabilities(supabase, Array.from(rawById.keys()));
  const fetchedAt = new Date().toISOString();
  const markets: Market[] = Array.from(rawById.values())
    .filter((market) => market.id && market.question)
    .map((market) => {
      const yesPrice = getYesPrice(market);
      const previousProbability = previousProbabilities.get(market.id) ?? null;

      const slug = market.slug ?? null;
      return {
        id: market.id,
        slug,
        question: market.question,
        description: market.description ?? null,
        probability: yesPrice,
        probability_24h_ago: previousProbability,
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
        last_updated_at: fetchedAt,
        raw: market,
      };
    });

  await upsertMarketsWithSchemaFallback(markets);

  // Record a probability snapshot for every market
  const recordedAt = new Date().toISOString();
  const snapshots = markets.map((m) => ({
    market_id: m.id,
    probability: m.probability,
    recorded_at: recordedAt,
  }));

  let snapshotInsertCount = 0;
  const SNAPSHOT_CHUNK_SIZE = 500;
  
  for (let i = 0; i < snapshots.length; i += SNAPSHOT_CHUNK_SIZE) {
    const chunk = snapshots.slice(i, i + SNAPSHOT_CHUNK_SIZE);
    const { error: snapError, count } = await supabase
      .from('probability_snapshots')
      .insert(chunk, { count: 'exact' });

    if (snapError) {
      console.error('[Snapshots] Failed to record probability snapshots:', snapError.message);
      throw new Error(`Supabase snapshot insert error: ${snapError.message}`);
    }
    
    if (count) snapshotInsertCount += count;
  }

  console.log(`[Snapshots] ${snapshotInsertCount} new snapshots recorded`);

  return markets.length;
}
