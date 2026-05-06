import { getAnalystConfig } from './analyst-config';
import { BITCAP_RESEARCH_CONTEXT } from './bitcap';
import { sortMarketsForAnalysis } from './market-prioritization';
import { callOpenAIJson, getOpenAIModel } from './openai';
import { getSupabaseClient } from './supabase';

const BATCH_SIZE = 12;

interface MarketForAnalysis {
  id: string;
  question: string;
  description: string | null;
  probability: number | null;
  volume: number | null;
  liquidity: number | null;
  category: string | null;
  end_date: string | null;
  candidate_score?: number;
  candidate_reasons?: string[];
  candidate_noise?: string[];
  probability_change?: number | null; // vs 24h ago (fractional, e.g. 0.15 = +15pp)
}

interface RawSignal {
  market_id: string;
  is_relevant: boolean;
  relevance_score: number;
  confidence: number;
  reason: string;
  affected_stocks: string[];
  affected_sectors: string[];
  signal_type: 'macro' | 'rates' | 'tariff' | 'regulatory' | 'company' | 'sector' | 'crypto' | null;
  signal_direction: 'positive' | 'negative' | 'mixed' | 'unclear' | null;
  urgency: 'high' | 'medium' | 'low';
  thesis: string;
  evidence: string[];
  key_risks: string[];
  suggested_action: string;
  probability_change?: number | null; // set post-LLM from snapshot data
}

interface OpenAISignalResponse {
  signals: RawSignal[];
}

export interface AnalyzeResult {
  analyzed: number;
  relevant: number;
}

type SignalRow = RawSignal & {
  model?: string;
  analyzed_at: string;
};

type MutableSignalRow = Record<string, unknown> & {
  market_id: string;
};

function clamp(value: unknown, fallback: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function isDirectEquityPriceMarket(question: string) {
  const text = question.toLowerCase();
  const hasTicker = /\([a-z]{1,5}\)|\b(aapl|amzn|googl|meta|msft|nvda|amd|avgo|asml|amat|lrcx|crm|pypl|coin|mstr)\b/i.test(
    question
  );
  const hasPriceLevel = /\$\d+/.test(question);
  const hasPriceAction =
    text.includes('close above') ||
    text.includes('close below') ||
    text.includes('finish week') ||
    text.includes('hit (high)') ||
    text.includes('hit (low)') ||
    text.includes('hit $');

  return hasTicker && hasPriceLevel && hasPriceAction;
}

function daysUntilExpiry(endDate: string | null): number {
  if (!endDate) return Infinity;
  return (new Date(endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
}

function isAnnualProductCycleMarket(question: string): boolean {
  const text = question.toLowerCase();
  const hasReleaseVerb = /\b(release|launch|ship|announce|unveil|introduce)\b/.test(text);
  const hasAnnualProduct =
    /\b(iphone|ipad|macbook|mac pro|apple watch|galaxy s|galaxy z|pixel \d|surface pro|surface laptop|windows \d+|next (iphone|ipad|pixel|galaxy))\b/.test(text);
  const hasYear = /\b(20\d{2})\b/.test(text);
  return hasReleaseVerb && hasAnnualProduct && hasYear;
}

function isProductOrEarningsMarket(question: string): boolean {
  const text = question.toLowerCase();
  return (
    /\b(release|launch|ship|announce|unveil)\b/.test(text) ||
    /\b(earnings|revenue|eps|quarterly (results|earnings)|q[1-4] (earnings|results|revenue))\b/.test(text) ||
    /\b(beat|miss|exceed).*(earnings|estimates|expectations|consensus)\b/.test(text)
  );
}

function applyQualityGate(signal: RawSignal, market: MarketForAnalysis): RawSignal {
  // Rule 1: direct equity price targets are never useful signals
  if (isDirectEquityPriceMarket(market.question)) {
    return {
      ...signal,
      is_relevant: false,
      relevance_score: Math.min(clamp(signal.relevance_score, 0.25), 0.35),
      confidence: Math.max(clamp(signal.confidence, 0.7), 0.7),
      reason:
        'Direct stock-price prediction markets are derivative of equity prices, not independent Polymarket signals for analysts.',
      affected_stocks: [],
      affected_sectors: [],
      signal_type: null,
      signal_direction: null,
      urgency: 'low',
      thesis:
        'This market may describe where the stock trades, but it does not explain an external catalyst such as rates, regulation, tariffs, supply chains, product adoption, or company fundamentals.',
      evidence: ['The question is framed around a ticker crossing a price level.'],
      key_risks: ['Using this as a signal would double-count public equity market pricing.'],
      suggested_action:
        'Exclude from analyst report unless paired with a separate catalyst market that explains why the equity price should move.',
    };
  }

  // Rule 2: expiring within 3 days AND is a price target → reject
  if (daysUntilExpiry(market.end_date) <= 3 && isDirectEquityPriceMarket(market.question)) {
    return {
      ...signal,
      is_relevant: false,
      relevance_score: 0.1,
      urgency: 'low',
      reason: 'Market expires within 3 days and is a short-term price target — not a strategic signal.',
      affected_stocks: [],
      affected_sectors: [],
      signal_type: null,
      signal_direction: null,
    };
  }

  // Rule 3: annual product cycle near-certainties have no signal value
  if (isAnnualProductCycleMarket(market.question)) {
    return {
      ...signal,
      is_relevant: false,
      relevance_score: 0.1,
      urgency: 'low',
      reason: 'Annual product cycle market — foregone conclusion with no independent signal value for portfolio positioning.',
      affected_stocks: [],
      affected_sectors: [],
      signal_type: null,
      signal_direction: null,
    };
  }

  // Rule 4: no stocks and no signal type means the transmission path is undefined
  const hasStocks = Array.isArray(signal.affected_stocks) && signal.affected_stocks.length > 0;
  if (!hasStocks && signal.signal_type === null) {
    return {
      ...signal,
      is_relevant: false,
      reason: 'No affected stocks or signal type identified — transmission path to equities is undefined.',
    };
  }

  // Rule 5: thin markets (volume < $10,000) — low confidence regardless of LLM assessment.
  // Thin markets can be moved by a single participant and produce unreliable probability signals.
  const volume = market.volume ?? 0;
  if (volume < 10_000) {
    return {
      ...signal,
      is_relevant: false,
      confidence: Math.min(clamp(signal.confidence, 0.5), 0.30),
      urgency: 'low',
      reason: `Low confidence: volume $${volume.toLocaleString()} is below the $10,000 minimum threshold. Thin markets can be manipulated by a single participant and produce unreliable probability signals.`,
    };
  }

  return signal;
}

function normalizeSignal(
  signal: RawSignal,
  marketById: Map<string, MarketForAnalysis>
): RawSignal | null {
  const market = marketById.get(signal.market_id);
  if (!market) return null;

  const gatedSignal = applyQualityGate(signal, market);
  const probChange = market.probability_change ?? null;

  // Movement detection: > 20pp change → force urgency to high
  const movementUrgencyOverride =
    gatedSignal.is_relevant &&
    probChange !== null &&
    Math.abs(probChange) > 0.20;

  return {
    market_id: gatedSignal.market_id,
    is_relevant: Boolean(gatedSignal.is_relevant),
    relevance_score: clamp(gatedSignal.relevance_score, gatedSignal.is_relevant ? 0.65 : 0.2),
    confidence: clamp(gatedSignal.confidence, 0.5),
    reason: String(gatedSignal.reason ?? '').slice(0, 500),
    affected_stocks: Array.isArray(gatedSignal.affected_stocks)
      ? gatedSignal.affected_stocks.map((stock) => String(stock).trim().toUpperCase()).filter(Boolean)
      : [],
    affected_sectors: Array.isArray(gatedSignal.affected_sectors)
      ? gatedSignal.affected_sectors.map((sector) => String(sector).trim()).filter(Boolean)
      : [],
    signal_type: gatedSignal.signal_type ?? null,
    signal_direction: gatedSignal.signal_direction ?? null,
    urgency: movementUrgencyOverride ? 'high' : (gatedSignal.urgency ?? 'low'),
    thesis: String(gatedSignal.thesis ?? '').slice(0, 1200),
    evidence: Array.isArray(gatedSignal.evidence)
      ? gatedSignal.evidence.map((item) => String(item).trim()).filter(Boolean).slice(0, 5)
      : [],
    key_risks: Array.isArray(gatedSignal.key_risks)
      ? gatedSignal.key_risks.map((item) => String(item).trim()).filter(Boolean).slice(0, 5)
      : [],
    suggested_action: String(gatedSignal.suggested_action ?? '').slice(0, 700),
    probability_change: probChange,
  };
}

function getMissingColumn(message: string) {
  return message.match(/Could not find the '([^']+)' column/)?.[1] ?? null;
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
  const now = new Date();
  const t23h = new Date(now.getTime() - 23 * 60 * 60 * 1000);
  const t25h = new Date(now.getTime() - 25 * 60 * 60 * 1000);
  const ids = markets.map((m) => m.id);

  const { data } = await supabase
    .from('probability_snapshots')
    .select('market_id, probability')
    .in('market_id', ids)
    .lte('recorded_at', t23h.toISOString())
    .gte('recorded_at', t25h.toISOString())
    .order('recorded_at', { ascending: false });

  // Most-recent snapshot within the 23-25h window per market
  const probAgo = new Map<string, number>();
  const seen = new Set<string>();
  for (const snap of (data ?? []) as { market_id: string; probability: number }[]) {
    if (!seen.has(snap.market_id)) {
      seen.add(snap.market_id);
      probAgo.set(snap.market_id, snap.probability);
    }
  }

  return markets.map((market) => ({
    ...market,
    probability_change:
      probAgo.has(market.id) && market.probability != null
        ? market.probability - probAgo.get(market.id)!
        : null,
  }));
}

async function fetchUnanalyzedMarkets(limit: number) {
  const supabase = getSupabaseClient();
  const config = await getAnalystConfig();

  const { data: markets, error: marketFetchError } = await supabase
    .from('markets')
    .select('id, question, description, probability, volume, liquidity, category, end_date')
    .eq('is_active', true)
    .order('volume', { ascending: false })
    .limit(Math.max(limit * 25, 500));

  if (marketFetchError) throw new Error(`Supabase market fetch error: ${marketFetchError.message}`);
  if (!markets?.length) return [];

  const ids = markets.map((market) => market.id);
  const { data: existingSignals, error: signalFetchError } = await supabase
    .from('signals')
    .select('market_id')
    .in('market_id', ids);

  if (signalFetchError) throw new Error(`Supabase signal fetch error: ${signalFetchError.message}`);

  const analyzedIds = new Set((existingSignals ?? []).map((signal) => signal.market_id));
  const unanalyzedMarkets = (markets as MarketForAnalysis[]).filter(
    (market) => !analyzedIds.has(market.id)
  );

  return sortMarketsForAnalysis(unanalyzedMarkets, config)
    .slice(0, limit)
    .map(({ market, priority }) => ({
      ...market,
      candidate_score: priority.score,
      candidate_reasons: priority.reasons,
      candidate_noise: priority.noise,
    }));
}

export async function getAnalysisCandidates(limit = 20) {
  return fetchUnanalyzedMarkets(limit);
}

async function analyzeBatch(markets: MarketForAnalysis[]) {
  const config = await getAnalystConfig();
  const enriched = await enrichWithProbabilityChanges(markets);
  const marketById = new Map(enriched.map((market) => [market.id, market]));
  const marketPayload = enriched.map((market) => ({
    market_id: market.id,
    question: market.question,
    description: market.description,
    yes_probability: market.probability,
    volume: market.volume,
    liquidity: market.liquidity,
    category: market.category,
    end_date: market.end_date,
    probability_change_24h_pct:
      market.probability_change != null
        ? Number((market.probability_change * 100).toFixed(1))
        : null,
    is_moving: market.probability_change != null && Math.abs(market.probability_change) > 0.10,
    deterministic_candidate_score: market.candidate_score,
    deterministic_candidate_reasons: market.candidate_reasons,
    deterministic_noise_flags: market.candidate_noise,
  }));

  const systemPrompt = `You are a senior investment analyst at BIT Capital GmbH, a Berlin-based asset manager with $2.7B AUM as of 2025. You are building a Polymarket signal scanner to surface early-warning signals for the portfolio before consensus forms.

${BITCAP_RESEARCH_CONTEXT}

Your job is judgment, not keyword matching. A market can be relevant even when it does not name a company if the event has a clear transmission path to public equities. The goal is 15–30 relevant signals out of every ~100 markets. If you are returning fewer than 10 relevant signals from a batch of 12, you are being too aggressive.

ALWAYS RELEVANT — mark is_relevant: true with no exceptions for these:
- Any market that directly mentions a BIT Capital holding by ticker or name: IREN, MSFT, GOOGL, META, NVDA, SOFI, RDDT, HIMS, LMND, HNGE, CRCL, APLD, COHR, GLXY, NTSK — these are direct portfolio signals regardless of probability level.
- Fed rate decisions, FOMC outcomes, or any central bank policy shift that reprices growth equities.
- AI regulation in the US or EU — any bill, executive order, or consent decree affecting LLMs, foundation models, or AI deployment.
- Crypto regulation — ETF approvals/rejections, exchange licensing, stablecoin legislation, SEC/CFTC actions.
- Semiconductor export controls or tariffs, especially US–China or Taiwan-related restrictions on chips, equipment, or advanced packaging.
- Bitcoin or Ethereum price markets on weekly or monthly timeframes (not intraday/hourly).
- Major tech company earnings results — beating or missing estimates by a meaningful margin.
- IPOs of significant tech companies (>$1B expected market cap) that could affect sector dynamics or compete with holdings.
- Taiwan Strait / China geopolitical events with a plausible impact on semiconductor supply chains.

REJECT — mark is_relevant: false for these only:
- 5-minute, hourly, or daily Bitcoin/crypto price windows — too short-term to be strategic signals.
- Sports markets, even if a tech company is a sponsor.
- Celebrity or entertainment markets with no equity transmission path: award shows, reality TV, celebrity tweets.
- Markets expiring today that are pure same-day price bets with no fundamental catalyst ("Will X close above $Y today?").
- Annual product cycle certainties: "Will Apple release an iPhone in 2025?" — foregone conclusions with no timing uncertainty.
- Non-tech political markets with no plausible tech equity transmission path: crime rates, local elections, immigration.
- Oil, agriculture, and real estate markets unless directly tied to data center energy costs or semiconductor materials.

Do NOT reject a market solely because its probability is high or low. A 95% probability on a Fed rate hold is still a signal — it tells us the market is pricing in stability, which affects growth equity valuations. Probability level alone is never a rejection reason.

Important: direct markets about a stock crossing a price level on a specific date are usually not useful signals — they restate equity pricing rather than explaining a catalyst. Mark them not relevant unless the question contains a fundamental driver.

The deterministic_candidate_score is a triage hint. You may disagree with it, but explain why in the reason/thesis.

Return JSON only with this shape:
{
  "signals": [
    {
      "market_id": "exact input id",
      "is_relevant": true,
      "relevance_score": 0.0,
      "confidence": 0.0,
      "reason": "one sentence",
      "affected_stocks": ["NVDA"],
      "affected_sectors": ["Semiconductors"],
      "signal_type": "macro|rates|tariff|regulatory|company|sector|crypto|null",
      "signal_direction": "positive|negative|mixed|unclear|null",
      "urgency": "high|medium|low",
      "thesis": "specific equity impact thesis",
      "evidence": ["why the market probability matters"],
      "key_risks": ["why this could be noise"],
      "suggested_action": "what an analyst should check next"
    }
  ]
}`;

  // Safety check: verify the prompt was loaded with the updated content
  if (!systemPrompt.includes('IREN')) {
    throw new Error('[Filter] System prompt not updated correctly — IREN not found in prompt');
  }
  console.log('[Filter] System prompt loaded OK, length:', systemPrompt.length);
  console.log('[Filter] Batch size:', markets.length, '| Sample market:', markets[0]?.question);

  const response = await callOpenAIJson<OpenAISignalResponse>([
    {
      role: 'system',
      content: systemPrompt,
    },
    {
      role: 'user',
      content: `Analyst configuration:
Sectors: ${config.sectors.join(', ')}
Stocks: ${config.stocks.join(', ')}
Focus notes: ${config.focus_notes}

Analyze these active Polymarket markets:
${JSON.stringify(marketPayload, null, 2)}

Return exactly one signal object for each market. Use relevance_score >= 0.65 only when the market deserves analyst attention.`,
    },
  ]);

  const relevantCount = response.signals?.filter((s) => s.is_relevant).length ?? 0;
  console.log('[Filter] LLM returned:', response.signals?.length ?? 0, 'signals,', relevantCount, 'relevant | Sample:', JSON.stringify(response.signals?.[0]).slice(0, 150));

  return response.signals
    .map((signal) => normalizeSignal(signal, marketById))
    .filter((signal): signal is RawSignal => signal !== null);
}

export async function analyzeMarkets(limit = 36): Promise<AnalyzeResult> {
  const supabase = getSupabaseClient();
  console.log('[Filter] analyzeMarkets starting, model:', getOpenAIModel(), '| limit:', limit);
  const markets = await getAnalysisCandidates(limit);
  console.log('[Filter] Candidates to analyze:', markets.length, '| Sample:', markets[0]?.question ?? 'none');
  if (!markets.length) {
    console.log('[Filter] No unanalyzed markets found — all markets may already have signal rows. Run ingest first or clear old signals.');
    return { analyzed: 0, relevant: 0 };
  }

  let totalAnalyzed = 0;
  let totalRelevant = 0;

  for (let index = 0; index < markets.length; index += BATCH_SIZE) {
    const batch = markets.slice(index, index + BATCH_SIZE);
    const signals = await analyzeBatch(batch);
    const rows = signals.map((signal) => ({
      ...signal,
      model: getOpenAIModel(),
      analyzed_at: new Date().toISOString(),
    }));

    await upsertSignalsWithSchemaFallback(rows);

    totalAnalyzed += signals.length;
    totalRelevant += signals.filter((signal) => signal.is_relevant).length;
  }

  return { analyzed: totalAnalyzed, relevant: totalRelevant };
}
