import { getAnalystConfig } from './analyst-config';
import { sortMarketsForAnalysis } from './market-prioritization';
import { callOpenAIJson } from './openai';
import { getSupabaseClient } from './supabase';

const BATCH_SIZE = 10;
const MOVEMENT_BASELINE_MIN_AGE_MS = 6 * 60 * 60 * 1000;
const MOVEMENT_THRESHOLD = 0.05;

/** Canonical BIT Capital thematic buckets — also referenced in the LLM prompt. */
export const THEMATIC_BUCKETS = [
  'AI Infrastructure',   // IREN, NVDA, AMD, APLD, COHR
  'Big Tech Platforms',  // MSFT, GOOGL, META, AAPL, AMZN
  'Fintech',             // SOFI, LMND, HIMS, CRCL
  'Digital Assets',      // IREN, CRCL, GLXY, BTC/ETH
  'Digital Health',      // HNGE, HIMS, LMND
  'Cybersecurity',       // NTSK
  'Macro/Rates',         // Fed, tariffs, inflation, AI regulation
] as const;

export type ThematicBucket = (typeof THEMATIC_BUCKETS)[number];

const STOCK_TO_BUCKETS: Record<string, ThematicBucket[]> = {
  IREN: ['AI Infrastructure', 'Digital Assets'],
  MSFT: ['Big Tech Platforms'],
  GOOGL: ['Big Tech Platforms'],
  META: ['Big Tech Platforms'],
  NVDA: ['AI Infrastructure'],
  AMD: ['AI Infrastructure'],
  AMZN: ['Big Tech Platforms'],
  AAPL: ['Big Tech Platforms'],
  RDDT: ['Big Tech Platforms'],
  HIMS: ['Fintech', 'Digital Health'],
  LMND: ['Fintech', 'Digital Health'],
  HNGE: ['Digital Health'],
  SOFI: ['Fintech'],
  CRCL: ['Fintech', 'Digital Assets'],
  APLD: ['AI Infrastructure'],
  COHR: ['AI Infrastructure'],
  GLXY: ['Digital Assets'],
  NTSK: ['Cybersecurity'],
  BTC: ['Digital Assets'],
  ETH: ['Digital Assets'],
  BITCOIN: ['Digital Assets'],
  ETHEREUM: ['Digital Assets'],
};

export function inferBucketsFromStocks(stocks: string[] | null | undefined): ThematicBucket[] {
  if (!Array.isArray(stocks)) return [];
  const out = new Set<ThematicBucket>();
  for (const stock of stocks) {
    const mapped = STOCK_TO_BUCKETS[String(stock).trim().toUpperCase()];
    if (mapped) for (const b of mapped) out.add(b);
  }
  return Array.from(out);
}

export function inferBucketsFromSignalType(
  signalType: string | null | undefined
): ThematicBucket[] {
  if (!signalType) return [];
  const lower = signalType.toLowerCase();
  if (lower === 'macro' || lower === 'rates' || lower === 'tariff') {
    return ['Macro/Rates'];
  }
  return [];
}


interface MarketForAnalysis {
  id: string;
  question: string;
  description: string | null;
  probability: number | null;
  probability_24h_ago?: number | string | null;
  volume: number | null;
  liquidity: number | null;
  category: string | null;
  end_date: string | null;
  last_updated_at?: string | null;
  candidate_score?: number;
  candidate_reasons?: string[];
  candidate_noise?: string[];
  probability_change?: number | null;
  is_moving?: boolean | null;
}

export interface ParsedSignal {
  market_id: string;
  is_relevant: boolean;
  confidence: number;
  reason: string;
  affected_stocks: string[];
  signal_type: 'macro' | 'rates' | 'tariff' | 'regulatory' | 'company' | 'sector' | 'crypto' | 'supply_chain' | null;
  signal_direction: 'positive' | 'negative' | 'mixed' | 'unclear' | null;
  urgency: 'high' | 'medium' | 'low' | null;
  thematic_buckets: string[];
  is_ahead_of_curve: boolean;
}

interface OpenAISignalResponse {
  signals: ParsedSignal[];
}

export interface AnalyzeResult {
  analyzed: number;
  relevant: number;
}

type SignalRow = ParsedSignal & {
  model?: string;
  analyzed_at: string;
  probability_change?: number | null;
  is_moving?: boolean | null;
};

type MutableSignalRow = Record<string, unknown> & {
  market_id: string;
};

const SYSTEM_PROMPT = `You are an extraction assistant for BIT Capital, a Berlin-based
asset manager focused on global technology equities. Your job is
to extract structured information about each Polymarket prediction
market — NOT to decide whether it is "worth trading." Code-level
gates downstream will make the final relevance decision based on
your extracted fields.

BIT CAPITAL HOLDINGS (the only tickers you may use):
NVDA, MSFT, GOOGL, GOOG, META, AAPL, AMZN, AMD, ASML, TSM,
ORCL, ADBE, CRM, NOW, PLTR, ARM, AVGO, QCOM, INTC, MU, NFLX,
SHOP, COIN

YOUR JOB IS SIMPLE:

For each market, name the BIT Capital holdings whose share price
would plausibly respond to this market's outcome. Be GENEROUS in
naming tickers — if there's any reasonable read-through, include
the ticker. The code gates downstream will filter for quality;
your job is to ensure no real signal is missed.

MARK is_relevant = true IF:
- The market mentions or affects any company/sector/macro factor
  that has read-through to ANY ticker in the holdings list above.
- Examples of "read-through": competitive dynamics, supply chain,
  regulatory pressure, macro multiples, M&A activity, AI capability
  benchmarks (matters for MSFT/GOOGL/META/NVDA).

MARK is_relevant = false ONLY IF:
- The market is about sports, entertainment, weather, celebrities.
- The market is a pure crypto price target ("Will BTC reach $X?")
  AND there is no spillover to COIN.
- The market is about a private company (SpaceX, xAI, Anthropic)
  with NO read-through to public holdings. Note: Anthropic affects
  GOOGL/AMZN (investors); OpenAI affects MSFT (investor + Azure).
- The market is a direct price-target on a stock ("Will NVDA hit
  $X?") — this restates pricing, not a catalyst.

GUIDANCE FOR MACRO MARKETS:

Fed rate decisions, CPI prints, jobs reports, tariff announcements,
AI regulation, antitrust rulings, and export controls all affect
tech multiples. For these, name the MOST EXPOSED holdings:
- Rates/macro/recession → MSFT, GOOGL, META, NVDA, AAPL
- AI regulation → MSFT, GOOGL, META, NVDA
- China/Taiwan/export controls → NVDA, AMD, ASML, TSM, AAPL
- Antitrust → the named company (AAPL, GOOGL, AMZN, META)

CONFIDENCE: Reflects how confident you are in the read-through.
- 0.80+: Direct, named company event with clear near-term P&L impact.
- 0.65-0.79: Strong thematic exposure with identified ticker(s).
- 0.50-0.64: Plausible read-through, real but indirect.
- Below 0.50: Very weak connection — but still try to name tickers.

Do NOT set is_relevant = false purely because you are uncertain.
Use confidence for that. Code gates will reject low-confidence
or weak-ticker cases automatically.

FEW-SHOT EXAMPLES:
Market: "Will the Fed cut rates by June 2026?"
Output: {
"is_relevant": true,
"confidence": 0.85,
"reason": "Direct macro signal for tech multiples; rate cuts
benefit growth equity valuations across BIT Capital's core
holdings.",
"affected_stocks": ["MSFT", "GOOGL", "META", "NVDA"],
"signal_type": "macro",
"signal_direction": "positive",
"urgency": "high",
"thematic_buckets": ["Macro/Rates", "Big Tech Platforms"],
"is_ahead_of_curve": false
}
Market: "Will TSMC announce Arizona fab delay before Q3?"
Output: {
"is_relevant": true,
"confidence": 0.82,
"reason": "Supply chain disruption for advanced node capacity
directly impacts NVDA, AMD, and AAPL production timelines.",
"affected_stocks": ["TSM", "NVDA", "AMD", "AAPL"],
"signal_type": "supply_chain",
"signal_direction": "negative",
"urgency": "medium",
"thematic_buckets": ["Semiconductors"],
"is_ahead_of_curve": true
}
Market: "Will OpenAI IPO close above $800B market cap?"
Output: {
"is_relevant": true,
"confidence": 0.78,
"reason": "MSFT holds a significant equity stake in OpenAI.
An $800B+ IPO valuation has direct read-through to MSFT's
book value and AI infrastructure thesis.",
"affected_stocks": ["MSFT"],
"signal_type": "company",
"signal_direction": "positive",
"urgency": "high",
"thematic_buckets": ["AI Infrastructure", "Big Tech Platforms"],
"is_ahead_of_curve": false
}
Market: "Will Bitcoin be above $76,000 on May 10?"
Output: {
"is_relevant": false,
"confidence": 0.95,
"reason": "Pure crypto price target with no specific catalyst.
No BIT Capital ticker has direct exposure to this outcome.",
"affected_stocks": [],
"signal_type": null,
"signal_direction": null,
"urgency": null,
"thematic_buckets": [],
"is_ahead_of_curve": false
}
Market: "Will SpaceX IPO above $1.4T?"
Output: {
"is_relevant": false,
"confidence": 0.90,
"reason": "SpaceX is private. No BIT Capital holding has
material direct exposure to SpaceX's valuation.",
"affected_stocks": [],
"signal_type": null,
"signal_direction": null,
"urgency": null,
"thematic_buckets": [],
"is_ahead_of_curve": false
}
Market: "Will GameStop acquire eBay?"
Output: {
"is_relevant": false,
"confidence": 0.95,
"reason": "Neither company is in BIT Capital's tech holdings
universe. Not a tech sector signal.",
"affected_stocks": [],
"signal_type": null,
"signal_direction": null,
"urgency": null,
"thematic_buckets": [],
"is_ahead_of_curve": false
}
Return a JSON object with a "signals" array containing one
analyzed signal per input market, in the same order.`;

// Per-pipeline-run counters for diagnostic logging.
// The LLM no longer gatekeeps relevance — code does — so there is no
// "llm_rejected" bucket. Every rejection happens at one of these gates.
const rejectionStats = {
  no_stocks: 0,
  no_valid_ticker: 0,
  probability_extreme: 0,
  expires_soon: 0,
  price_target: 0,
  low_confidence: 0,
  passed: 0,
};

function resetRejectionStats() {
  rejectionStats.no_stocks = 0;
  rejectionStats.no_valid_ticker = 0;
  rejectionStats.probability_extreme = 0;
  rejectionStats.expires_soon = 0;
  rejectionStats.price_target = 0;
  rejectionStats.low_confidence = 0;
  rejectionStats.passed = 0;
}

function logRejectionStats() {
  console.log(`[Filter] === Rejection breakdown ===`);
  console.log(`[Filter]   No affected_stocks:        ${rejectionStats.no_stocks}`);
  console.log(`[Filter]   No valid ticker:           ${rejectionStats.no_valid_ticker}`);
  console.log(`[Filter]   Probability outside 15-85: ${rejectionStats.probability_extreme}`);
  console.log(`[Filter]   Expires within 24h:        ${rejectionStats.expires_soon}`);
  console.log(`[Filter]   Direct price-target:       ${rejectionStats.price_target}`);
  console.log(`[Filter]   Confidence < 0.45:         ${rejectionStats.low_confidence}`);
  console.log(`[Filter]   PASSED:                    ${rejectionStats.passed}`);
}

function enforceValidation(signal: ParsedSignal, market: MarketForAnalysis): ParsedSignal {
  // ARCHITECTURE: The CODE is the relevance judge, not the LLM.
  // The LLM is used only as an extractor. We compute is_relevant from
  // the structured fields (affected_stocks, confidence) plus market
  // properties (probability, end_date, question shape). This sidesteps
  // the LLM's documented tendency to mark valid signals as not-relevant
  // out of misplaced caution (see PROJECT_LEARNINGS.md "Specific failure
  // modes" — self-contradictory output across fields).

  const HOLDINGS = [
    'NVDA','MSFT','GOOGL','GOOG','META','AAPL','AMZN','AMD',
    'ASML','TSM','ORCL','ADBE','CRM','NOW','PLTR','ARM',
    'AVGO','QCOM','INTC','MU','NFLX','SHOP','COIN',
  ];

  // STAGE 1: Sanity-clean the LLM's structured output.
  const rawStocks = (signal.affected_stocks || []).filter(
    (t) => t && t !== 'None' && t !== 'NONE'
  );
  const validTickers = rawStocks.filter((t) => HOLDINGS.includes(t));

  // Compute a base "should be relevant" from the structured signals.
  // Confidence here is the LLM's own self-rating — we still trust this
  // as a noisiness signal, but no longer trust its is_relevant verdict.
  const confidence = typeof signal.confidence === 'number' ? signal.confidence : 0;

  // STAGE 2: Apply hard code gates in priority order.
  // First, hard architectural rejects (gates 1, 3, 4, 5, 6).
  // Then, soft quality rejects (gate 2 — low confidence).

  // GATE 1: Must have at least one valid BIT Capital ticker.
  if (validTickers.length === 0) {
    if (rawStocks.length > 0) {
      // LLM tried to name tickers but none are in our universe.
      rejectionStats.no_valid_ticker += 1;
      console.log(`[Filter] REJECT no_valid_ticker: "${market.question.substring(0, 80)}" | LLM named ${JSON.stringify(rawStocks)} — none in holdings list`);
    } else {
      rejectionStats.no_stocks += 1;
      console.log(`[Filter] REJECT no_stocks: "${market.question.substring(0, 80)}"`);
    }
    return { ...signal, affected_stocks: validTickers, is_relevant: false };
  }

  // GATE 4: Probability outside 15–85% informational edge window.
  const prob = market.probability ?? 0.5;
  if (prob > 0.85 || prob < 0.15) {
    rejectionStats.probability_extreme += 1;
    console.log(`[Filter] REJECT probability_extreme (${(prob * 100).toFixed(0)}%): "${market.question.substring(0, 80)}"`);
    return {
      ...signal,
      affected_stocks: validTickers,
      is_relevant: false,
      reason: `Probability ${(prob * 100).toFixed(0)}% is outside the 15–85% informational edge window — outcome has reached consensus and is already priced into public markets.`,
    };
  }

  // GATE 5: Markets expiring within 24 hours — no actionable window.
  if (market.end_date) {
    const hoursRemaining = (new Date(market.end_date).getTime() - Date.now()) / (1000 * 60 * 60);
    if (hoursRemaining < 24) {
      rejectionStats.expires_soon += 1;
      console.log(`[Filter] REJECT expires_soon (${hoursRemaining.toFixed(1)}h): "${market.question.substring(0, 80)}"`);
      return {
        ...signal,
        affected_stocks: validTickers,
        is_relevant: false,
        reason: 'Market expires within 24 hours — no actionable window for analyst positioning.',
      };
    }
  }

  // GATE 6: Direct equity price-target ("Will NVDA hit (HIGH) $224?").
  const q = market.question.toLowerCase();
  const hasTickerInQ = /\([a-z]{1,5}\)|\b(aapl|amzn|googl|goog|meta|msft|nvda|amd|avgo|asml)\b/i.test(market.question);
  const hasPriceLevel = /\$\d+/.test(market.question);
  const hasPriceAction =
    q.includes('hit (high)') || q.includes('hit (low)') ||
    q.includes('close above') || q.includes('close below') ||
    q.includes('hit $') || q.includes('finish week');
  if (hasTickerInQ && hasPriceLevel && hasPriceAction) {
    rejectionStats.price_target += 1;
    console.log(`[Filter] REJECT price_target: "${market.question.substring(0, 80)}"`);
    return {
      ...signal,
      affected_stocks: validTickers,
      is_relevant: false,
      reason: 'Direct stock price-target market — restates equity pricing rather than explaining an independent catalyst.',
    };
  }

  // GATE 2: Confidence floor (soft quality gate, applied last).
  // Lowered from 0.55 → 0.45 because gpt-4o-mini anchors low for marginal cases.
  if (confidence < 0.45) {
    rejectionStats.low_confidence += 1;
    console.log(`[Filter] REJECT low_confidence (${confidence}): "${market.question.substring(0, 80)}"`);
    return { ...signal, affected_stocks: validTickers, is_relevant: false };
  }

  // ALL GATES PASSED → the CODE marks this relevant, regardless of
  // what the LLM thought. Trust the structured extraction.
  rejectionStats.passed += 1;
  console.log(`[Filter] PASS: "${market.question.substring(0, 80)}" | ${validTickers.join(',')} | conf=${confidence}`);
  return {
    ...signal,
    affected_stocks: validTickers,
    is_relevant: true,
  };
}

function getMissingColumn(message: string) {
  return (
    message.match(/Could not find the '([^']+)' column/)?.[1] ??
    message.match(/column \w+\.([a-zA-Z0-9_]+) does not exist/)?.[1] ??
    null
  );
}



function removeColumnFromRows(rows: MutableSignalRow[], column: string) {
  return rows.map((row) => {
    const nextRow = { ...row };
    delete nextRow[column];
    return nextRow;
  });
}



async function saveSignalsWithoutUniqueConstraint(rows: MutableSignalRow[]) {
  const supabase = getSupabaseClient();

  for (const row of rows) {
    const { data: existing, error: lookupError } = await supabase
      .from('signals')
      .select('id')
      .eq('market_id', row.market_id)
      .maybeSingle();

    if (lookupError) {
      throw new Error(`Supabase signal lookup error: ${lookupError.message}`);
    }

    if (existing?.id) {
      const { error: updateError } = await supabase
        .from('signals')
        .update(row)
        .eq('id', existing.id);

      if (updateError) {
        throw new Error(`Supabase signal update error: ${updateError.message}`);
      }
    } else {
      const { error: insertError } = await supabase.from('signals').insert(row);

      if (insertError) {
        throw new Error(`Supabase signal insert error: ${insertError.message}`);
      }
    }
  }
}



async function upsertSignalsWithSchemaFallback(rows: SignalRow[]) {
  const supabase = getSupabaseClient();
  let mutableRows: MutableSignalRow[] = rows.map((row) => ({ ...row }));
  const removedColumns: string[] = [];

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { error } = await supabase
      .from('signals')
      .upsert(mutableRows, { onConflict: 'market_id' });

    if (!error) return removedColumns;

    if (error.message.includes('no unique or exclusion constraint matching the ON CONFLICT')) {
      await saveSignalsWithoutUniqueConstraint(mutableRows);
      return removedColumns;
    }

    const missingColumn = getMissingColumn(error.message);
    if (!missingColumn) {
      throw new Error(`Supabase signal upsert error: ${error.message}`);
    }

    removedColumns.push(missingColumn);
    mutableRows = removeColumnFromRows(mutableRows, missingColumn);
  }

  throw new Error(
    `Supabase signal upsert error: schema fallback removed too many columns (${removedColumns.join(
      ', '
    )})`
  );
}



async function enrichWithProbabilityChanges(
  markets: MarketForAnalysis[]
): Promise<MarketForAnalysis[]> {
  if (!markets.length) return markets;
  const supabase = getSupabaseClient();
  const cutoff = new Date(Date.now() - MOVEMENT_BASELINE_MIN_AGE_MS).toISOString();
  const ids = markets.map((m) => m.id);

  const { data, error } = await supabase
    .from('probability_snapshots')
    .select('market_id, probability, recorded_at')
    .in('market_id', ids)
    .lt('recorded_at', cutoff)
    .order('recorded_at', { ascending: false });

  if (error) {
    console.warn('[Movement] Snapshot fetch warning:', error.message);
    return markets.map((market) => {
      console.log(
        `[Filter] Market ${market.id}: previous=null, current=${market.probability ?? 'null'}, change=null`
      );
      return {
        ...market,
        probability_change: null,
        is_moving: false,
      };
    });
  }

  const previousByMarket = new Map<string, number>();
  for (const snap of (data ?? []) as Array<{ market_id: string; probability: number; recorded_at: string }>) {
    if (!Number.isFinite(Number(snap.probability))) continue;
    if (!previousByMarket.has(snap.market_id)) {
      previousByMarket.set(snap.market_id, Number(snap.probability));
    }
  }

  let changedCount = 0;
  let movingCount = 0;

  const enriched = markets.map((market) => {
    const storedPrevious = Number(market.probability_24h_ago);
    const previous =
      previousByMarket.get(market.id) ??
      (Number.isFinite(storedPrevious) ? storedPrevious : null);
    const current = market.probability != null ? Number(market.probability) : null;
    const change =
      previous !== null && current !== null
        ? current - previous
        : null;
    const isMoving = change !== null && Math.abs(change) > MOVEMENT_THRESHOLD;

    if (change !== null) changedCount += 1;
    if (isMoving) movingCount += 1;
    console.log(
      `[Filter] Market ${market.id}: previous=${previous ?? 'null'}, current=${current ?? 'null'}, change=${change ?? 'null'}`
    );

    return {
      ...market,
      probability_change: change,
      is_moving: isMoving,
    };
  });

  console.log(
    `[Movement] Compared ${changedCount}/${markets.length} markets against ${data?.length ?? 0} snapshots older than ${cutoff}; moving=${movingCount}`
  );
  const sample = enriched.find((market) => market.probability_change !== null);
  if (sample) {
    console.log(
      `[Movement] Sample ${sample.id}: current=${sample.probability}, change=${sample.probability_change}`
    );
  }

  return enriched;
}



function hasRecentProbabilityMove(market: MarketForAnalysis): boolean {
  const snapshotChange = Number(market.probability_change);
  if (Number.isFinite(snapshotChange)) {
    return Math.abs(snapshotChange) >= MOVEMENT_THRESHOLD;
  }

  const current = Number(market.probability);
  const previous = Number(market.probability_24h_ago);
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return false;
  return Math.abs(current - previous) >= MOVEMENT_THRESHOLD;
}



async function refreshExistingSignalMovement(limit: number) {
  const supabase = getSupabaseClient();
  const { data: existingSignals, error: signalFetchError } = await supabase
    .from('signals')
    .select('market_id')
    .not('market_id', 'is', null)
    .limit(Math.max(limit * 25, 1000));

  if (signalFetchError) {
    console.warn('[Movement] Existing signal lookup warning:', signalFetchError.message);
    return { updated: 0, moving: 0 };
  }

  const existingIds = new Set((existingSignals ?? []).map((signal) => signal.market_id));
  if (existingIds.size === 0) {
    console.log('[Movement] No existing signals available for movement refresh');
    return { updated: 0, moving: 0 };
  }

  const freshMarketColumns =
    'id, question, description, probability, probability_24h_ago, volume, liquidity, category, end_date, last_updated_at';
  const fallbackMarketColumns =
    'id, question, description, probability, volume, liquidity, category, end_date';

  let { data: markets, error: marketFetchError } = await supabase
    .from('markets')
    .select(freshMarketColumns)
    .in('id', Array.from(existingIds))
    .eq('is_active', true);

  if (marketFetchError && getMissingColumn(marketFetchError.message)) {
    const fallback = await supabase
      .from('markets')
      .select(fallbackMarketColumns)
      .in('id', Array.from(existingIds))
      .eq('is_active', true);
    markets = fallback.data as typeof markets;
    marketFetchError = fallback.error;
  }

  if (marketFetchError) {
    console.warn('[Movement] Existing signal market fetch warning:', marketFetchError.message);
    return { updated: 0, moving: 0 };
  }
  if (!markets?.length) {
    console.log('[Movement] No active markets available for existing signal movement refresh');
    return { updated: 0, moving: 0 };
  }

  const enriched = await enrichWithProbabilityChanges(markets as MarketForAnalysis[]);
  let updated = 0;
  let moving = 0;
  let warnedMissingIsMoving = false;

  for (const market of enriched) {
    if (!existingIds.has(market.id)) continue;
    if (market.probability_change == null) continue;

    const row = {
      probability_change: market.probability_change,
      is_moving: Boolean(market.is_moving),
    };
    const { error } = await supabase
      .from('signals')
      .update(row)
      .eq('market_id', market.id);

    if (error) {
      const missingColumn = getMissingColumn(error.message);
      if (missingColumn === 'is_moving') {
        if (!warnedMissingIsMoving) {
          console.warn('[Movement] signals.is_moving is missing; updating probability_change only');
          warnedMissingIsMoving = true;
        }
        const { error: retryError } = await supabase
          .from('signals')
          .update({ probability_change: row.probability_change })
          .eq('market_id', market.id);
        if (retryError) {
          throw new Error(`Supabase movement update error: ${retryError.message}`);
        }
      } else {
        throw new Error(`Supabase movement update error: ${error.message}`);
      }
    }

    updated += 1;
    if (market.is_moving) moving += 1;
  }

  console.log(`[Movement] Refreshed probability_change for ${updated} existing signals; moving=${moving}`);
  return { updated, moving };
}

export async function getAnalysisCandidates(limit = 20) {
  return fetchUnanalyzedMarkets(limit);
}



async function fetchUnanalyzedMarkets(limit: number) {
  const supabase = getSupabaseClient();
  const config = await getAnalystConfig();

  const freshMarketColumns =
    'id, question, description, probability, probability_24h_ago, volume, liquidity, category, end_date, last_updated_at';
  const fallbackMarketColumns =
    'id, question, description, probability, volume, liquidity, category, end_date';

  // PRE-FILTER at the SQL layer: only fetch markets in the 15–85% informational
  // edge window. Markets at extremes are guaranteed to fail HARD RULE 4 in
  // enforceValidation, so spending an LLM call on them is pure waste.
  let { data: markets, error: marketFetchError } = await supabase
    .from('markets')
    .select(freshMarketColumns)
    .eq('is_active', true)
    .gte('probability', 0.15)
    .lte('probability', 0.85)
    .order('volume', { ascending: false })
    .limit(Math.max(limit * 25, 500));

  if (marketFetchError && getMissingColumn(marketFetchError.message)) {
    console.warn(
      '[Filter] markets freshness columns missing; falling back to legacy market selection'
    );
    const fallback = await supabase
      .from('markets')
      .select(fallbackMarketColumns)
      .eq('is_active', true)
      .gte('probability', 0.15)
      .lte('probability', 0.85)
      .order('volume', { ascending: false })
      .limit(Math.max(limit * 25, 500));
    markets = fallback.data as typeof markets;
    marketFetchError = fallback.error;
  }

  if (marketFetchError) throw new Error(`Supabase market fetch error: ${marketFetchError.message}`);
  if (!markets?.length) return [];

  const marketsWithMovement = await enrichWithProbabilityChanges(markets as MarketForAnalysis[]);
  const ids = marketsWithMovement.map((market) => market.id);
  const { data: existingSignals, error: signalFetchError } = await supabase
    .from('signals')
    .select('market_id')
    .in('market_id', ids);

  if (signalFetchError) throw new Error(`Supabase signal fetch error: ${signalFetchError.message}`);

  const analyzedIds = new Set((existingSignals ?? []).map((signal) => signal.market_id));
  const analysisCandidateMarkets = marketsWithMovement.filter(
    (market) => !analyzedIds.has(market.id) || hasRecentProbabilityMove(market)
  );
  const changedCount = analysisCandidateMarkets.filter(
    (market) => analyzedIds.has(market.id) && hasRecentProbabilityMove(market)
  ).length;
    if (changedCount > 0) {
    console.log(`[Filter] Re-analyzing ${changedCount} markets with fresh probability moves`);
  }

  return sortMarketsForAnalysis(analysisCandidateMarkets, config)
    .slice(0, limit)
    .map(({ market, priority }) => ({
      ...market,
      candidate_score: priority.score,
      candidate_reasons: priority.reasons,
      candidate_noise: priority.noise,
    }));
}



async function analyzeBatch(markets: MarketForAnalysis[]): Promise<SignalRow[]> {
  if (markets.length === 0) return [];
  
  const enriched = await enrichWithProbabilityChanges(markets);
  const userPrompt = JSON.stringify(
    enriched.map((m) => ({
      id: m.id,
      question: m.question,
      description: m.description,
      probability: m.probability,
    }))
  );

  console.log(`[Filter] Sending batch of ${markets.length} to gpt-4o-mini...`);
  
  const response = await callOpenAIJson<OpenAISignalResponse>([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt }
  ]);

  const parsedSignals = response.signals || [];
  const analyzedAt = new Date().toISOString();
  const rows: SignalRow[] = [];

  for (let i = 0; i < parsedSignals.length; i++) {
    const market = enriched[i];
    if (!market) continue;
    
    // Inject market ID because the LLM might not return it reliably, but relies on order
    let parsed = { ...parsedSignals[i], market_id: market.id };

    // Apply hard validation gates AFTER the LLM — these are code-level overrides
    // that the LLM cannot bypass, even if it marks the signal relevant.
    parsed = enforceValidation(parsed, market);

    rows.push({
      ...parsed,
      model: 'gpt-4o-mini',
      analyzed_at: analyzedAt,
      probability_change: market.probability_change,
      is_moving: market.is_moving,
    });
  }

  return rows;
}

export async function analyzeMarkets(limit = 36): Promise<AnalyzeResult> {
  console.log(`[Filter] analyzeMarkets starting | limit: ${limit}`);
  resetRejectionStats();

  // Refresh old signal movement before fetching new ones
  await refreshExistingSignalMovement(limit);

  const unanalyzed = await fetchUnanalyzedMarkets(limit);
  if (!unanalyzed.length) {
    console.log('[Filter] No new markets need analysis.');
    return { analyzed: 0, relevant: 0 };
  }

  // Run batches in PARALLEL. With 100 markets and BATCH_SIZE=10 we fire 10
  // OpenAI calls at once instead of sequentially. gpt-4o-mini's rate limit
  // (200 req/min, 200k tok/min) easily accommodates this, and total wall
  // time drops from ~2-3 minutes to ~15 seconds.
  const batches: MarketForAnalysis[][] = [];
  for (let i = 0; i < unanalyzed.length; i += BATCH_SIZE) {
    batches.push(unanalyzed.slice(i, i + BATCH_SIZE));
  }

  console.log(`[Filter] Dispatching ${batches.length} batches in parallel...`);
  const batchResults = await Promise.allSettled(batches.map((batch) => analyzeBatch(batch)));

  let analyzedCount = 0;
  let relevantCount = 0;
  const allRows: SignalRow[] = [];

  for (const result of batchResults) {
    if (result.status === 'fulfilled') {
      allRows.push(...result.value);
      analyzedCount += result.value.length;
      relevantCount += result.value.filter((r) => r.is_relevant).length;
    } else {
      console.error(`[Filter] analyzeBatch failed:`, result.reason);
    }
  }

  if (allRows.length > 0) {
    await upsertSignalsWithSchemaFallback(allRows);
  }

  logRejectionStats();

  return { analyzed: analyzedCount, relevant: relevantCount };
}
