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

function applyQualityGate(signal: RawSignal, market: MarketForAnalysis): RawSignal {
  if (!isDirectEquityPriceMarket(market.question)) return signal;

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

function normalizeSignal(
  signal: RawSignal,
  marketById: Map<string, MarketForAnalysis>
): RawSignal | null {
  const market = marketById.get(signal.market_id);
  if (!market) return null;

  const gatedSignal = applyQualityGate(signal, market);

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
    urgency: gatedSignal.urgency ?? 'low',
    thesis: String(gatedSignal.thesis ?? '').slice(0, 1200),
    evidence: Array.isArray(gatedSignal.evidence)
      ? gatedSignal.evidence.map((item) => String(item).trim()).filter(Boolean).slice(0, 5)
      : [],
    key_risks: Array.isArray(gatedSignal.key_risks)
      ? gatedSignal.key_risks.map((item) => String(item).trim()).filter(Boolean).slice(0, 5)
      : [],
    suggested_action: String(gatedSignal.suggested_action ?? '').slice(0, 700),
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
  const marketById = new Map(markets.map((market) => [market.id, market]));
  const marketPayload = markets.map((market) => ({
    market_id: market.id,
    question: market.question,
    description: market.description,
    yes_probability: market.probability,
    volume: market.volume,
    liquidity: market.liquidity,
    category: market.category,
    end_date: market.end_date,
    deterministic_candidate_score: market.candidate_score,
    deterministic_candidate_reasons: market.candidate_reasons,
    deterministic_noise_flags: market.candidate_noise,
  }));

  const response = await callOpenAIJson<OpenAISignalResponse>([
    {
      role: 'system',
      content: `You are an investment analyst building a Polymarket signal scanner for a tech-focused public equities fund.

${BITCAP_RESEARCH_CONTEXT}

Your job is judgment, not keyword matching. A market can be relevant even when it does not name a company if the event has a clear transmission path to public equities. Penalize vague markets, low-volume markets, sports/entertainment noise, and markets whose effect is already too indirect.

Important quality rule: direct markets about a listed stock crossing a price level, closing above/below a price, or hitting a high/low are usually NOT useful signals. They restate equity market pricing rather than explaining an outside catalyst. Mark them not relevant unless the market question itself contains a fundamental catalyst.

The deterministic_candidate_score is only a triage hint from the application. You may disagree with it, but if you do, explain why in the reason/thesis.

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
}`,
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

  return response.signals
    .map((signal) => normalizeSignal(signal, marketById))
    .filter((signal): signal is RawSignal => signal !== null);
}

export async function analyzeMarkets(limit = 36): Promise<AnalyzeResult> {
  const supabase = getSupabaseClient();
  const markets = await getAnalysisCandidates(limit);
  if (!markets.length) return { analyzed: 0, relevant: 0 };

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
