import OpenAI from 'openai';
import { getAnalystConfig } from './analyst-config';
import { sortMarketsForAnalysis } from './market-prioritization';
import { getSupabaseClient } from './supabase';

const BATCH_SIZE = 5;
const ANALYSIS_MODEL = "gpt-4o-mini";
const ANALYSIS_PROMPT_VERSION = "filter-v4-coverage";
const ANALYSIS_MODEL_TAG = `${ANALYSIS_MODEL}:${ANALYSIS_PROMPT_VERSION}`;
const ANALYSIS_CONCURRENCY = 12;
const MIN_RELEVANT_VOLUME_USD = 50;
const HOLDINGS = [
  'NVDA','MSFT','GOOGL','GOOG','META','AAPL','AMZN','AMD','ASML','TSM',
  'ORCL','ADBE','CRM','NOW','PLTR','ARM','AVGO','QCOM','INTC','MU','NFLX',
  'SHOP','COIN','AMAT','V','MA','PYPL','ADYEN','IREN','SOFI','RDDT','HIMS',
  'LMND','HNGE','CRCL','APLD','COHR','GLXY','NTSK',
];
const HOLDINGS_SET = new Set(HOLDINGS);
const TICKER_ALIASES: Record<string, string> = {
  TSMC: 'TSM',
  GOOGLE: 'GOOGL',
  ALPHABET: 'GOOGL',
  VISA: 'V',
  PAYPAL: 'PYPL',
};
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
  GOOG: ['Big Tech Platforms'],
  META: ['Big Tech Platforms'],
  NVDA: ['AI Infrastructure'],
  AMD: ['AI Infrastructure'],
  ASML: ['AI Infrastructure'],
  TSM: ['AI Infrastructure'],
  AMAT: ['AI Infrastructure'],
  AVGO: ['AI Infrastructure'],
  QCOM: ['AI Infrastructure'],
  INTC: ['AI Infrastructure'],
  MU: ['AI Infrastructure'],
  ARM: ['AI Infrastructure'],
  AMZN: ['Big Tech Platforms'],
  AAPL: ['Big Tech Platforms'],
  RDDT: ['Big Tech Platforms'],
  ORCL: ['Big Tech Platforms'],
  ADBE: ['Big Tech Platforms'],
  CRM: ['Big Tech Platforms'],
  NOW: ['Big Tech Platforms'],
  PLTR: ['Big Tech Platforms'],
  NFLX: ['Big Tech Platforms'],
  SHOP: ['Big Tech Platforms'],
  HIMS: ['Fintech', 'Digital Health'],
  LMND: ['Fintech', 'Digital Health'],
  HNGE: ['Digital Health'],
  SOFI: ['Fintech'],
  V: ['Fintech'],
  MA: ['Fintech'],
  PYPL: ['Fintech'],
  ADYEN: ['Fintech'],
  COIN: ['Fintech', 'Digital Assets'],
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
  signal_type: 'macro' | 'rates' | 'tariff' | 'regulation' | 'regulatory' | 'company' | 'sector' | 'crypto' | 'supply_chain' | 'geopolitical' | null;
  signal_direction: 'positive' | 'negative' | 'mixed' | 'neutral' | 'unclear' | null;
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

const SYSTEM_PROMPT = `
You are a senior research analyst at BIT Capital, a Berlin-based
asset manager focused on global technology equities.

BIT CAPITAL TRACKED HOLDINGS:
NVDA, MSFT, GOOGL, GOOG, META, AAPL, AMZN, AMD, ASML, TSM,
ORCL, ADBE, CRM, NOW, PLTR, ARM, AVGO, QCOM, INTC, MU, NFLX,
SHOP, COIN, AMAT, V, MA, PYPL, ADYEN, IREN, SOFI, RDDT, HIMS,
LMND, HNGE, CRCL, APLD, COHR, GLXY, NTSK

A signal is RELEVANT if it meets BOTH of these:
1. You can name at least one specific ticker from the holdings
   list in affected_stocks. If you cannot, is_relevant=false.
2. The market outcome would plausibly move that ticker's price,
   sentiment, or competitive position — even indirectly. Be
   GENEROUS here: macro signals, regulatory signals, competitor
   movements, supply chain events, geopolitical events affecting
   tech supply chains, AI model rankings, IPO announcements, and
   earnings-related markets all qualify as long as a tracked
   ticker is genuinely affected.

REJECT ONLY:
- Pure price-target markets with no underlying event ("Will X
  reach $Y price?")
- Markets where ALL affected tickers are NOT in the BIT Capital
  holdings list
- Sports, weather, celebrity, entertainment, music, gaming
- Markets with less than $50 volume
- Resolved or near-resolved markets (probability >99% or <1%)
- Markets resolving in less than 12 hours

When in doubt between relevant and not relevant, choose RELEVANT
with a moderate confidence score (0.55-0.70). Better to surface
a borderline signal than miss a real one.

SIGNAL DIRECTION RULES (critical — get these right):
- If a competitor (ByteDance, Mistral, Meta AI) beats MSFT/GOOGL
  at AI → signal_direction = "negative" for MSFT/GOOGL
- If regulation passes that restricts tech → "negative"
- If Fed cuts rates → "positive" for growth tech
- If Fed hikes rates → "negative" for growth tech
- If OpenAI IPO succeeds → "positive" for MSFT (they hold equity)
- If AI safety bill passes → "negative" for AI infrastructure

FEW-SHOT EXAMPLES:

Input: "Will the Fed cut rates by September 2026?"
Probability: 0.149, Volume: $920K
Output: {
  "is_relevant": true,
  "confidence": 0.82,
  "reason": "Fed rate cuts directly improve growth equity
    valuations across BIT Capital holdings via discount rate
    channel. $920K volume confirms serious institutional
    attention.",
  "affected_stocks": ["MSFT", "GOOGL", "META", "NVDA"],
  "signal_type": "macro",
  "signal_direction": "positive",
  "urgency": "high",
  "thematic_buckets": ["Macro/Rates", "Big Tech Platforms"],
  "is_ahead_of_curve": false
}

Input: "Will EU AI Act enforcement begin before June 2026?"
Probability: 0.42, Volume: $180K
Output: {
  "is_relevant": true,
  "confidence": 0.76,
  "reason": "EU AI Act enforcement creates direct compliance
    costs for MSFT Copilot, GOOGL Gemini, and META AI products
    sold in Europe. Specific regulatory catalyst with named
    deadline.",
  "affected_stocks": ["MSFT", "GOOGL", "META"],
  "signal_type": "regulation",
  "signal_direction": "negative",
  "urgency": "medium",
  "thematic_buckets": ["AI Regulation", "Big Tech Platforms"],
  "is_ahead_of_curve": true
}

Input: "Will inflation reach more than 5% in 2026?"
Probability: 0.305, Volume: $112K
Output: {
  "is_relevant": true,
  "confidence": 0.74,
  "reason": "Persistent inflation above 5% forces Fed to
    maintain high rates, compressing growth multiples across
    BIT Capital's core holdings. Macro signal with direct
    portfolio impact.",
  "affected_stocks": ["MSFT", "GOOGL", "META", "NVDA"],
  "signal_type": "macro",
  "signal_direction": "negative",
  "urgency": "high",
  "thematic_buckets": ["Macro/Rates"],
  "is_ahead_of_curve": false
}

Input: "Will Gemini 3.5 be released by July 31?"
Probability: 0.845, Volume: $16K
Output: {
  "is_relevant": true,
  "confidence": 0.71,
  "reason": "Gemini 3.5 release directly impacts GOOGL's AI
    competitive position and developer adoption metrics.
    Product launch catalyst with specific deadline.",
  "affected_stocks": ["GOOGL"],
  "signal_type": "company",
  "signal_direction": "positive",
  "urgency": "high",
  "thematic_buckets": ["AI Infrastructure", "Big Tech Platforms"],
  "is_ahead_of_curve": false
}

Input: "Will ByteDance have the #1 AI model by December 2026?"
Probability: 0.155, Volume: $958
Output: {
  "is_relevant": true,
  "confidence": 0.65,
  "reason": "ByteDance achieving #1 AI model ranking would
    indicate competitive pressure on MSFT Copilot and GOOGL
    Gemini, threatening their AI revenue growth.",
  "affected_stocks": ["MSFT", "GOOGL"],
  "signal_type": "company",
  "signal_direction": "negative",
  "urgency": "medium",
  "thematic_buckets": ["AI Infrastructure"],
  "is_ahead_of_curve": false
}

Input: "Will Bitcoin be above $88,000 on May 12?"
Probability: 0.001, Volume: $92K
Output: {
  "is_relevant": false,
  "confidence": 0.97,
  "reason": "Pure crypto price target with no specific catalyst.
    No BIT Capital ticker has direct exposure.",
  "affected_stocks": [],
  "signal_type": null,
  "signal_direction": null,
  "urgency": null,
  "thematic_buckets": [],
  "is_ahead_of_curve": false
}

Input: "Will SpaceX IPO above $1.4T?"
Probability: 0.895, Volume: $95K
Output: {
  "is_relevant": false,
  "confidence": 0.92,
  "reason": "SpaceX is private. No BIT Capital holding has
    material direct exposure to SpaceX valuation.",
  "affected_stocks": [],
  "signal_type": null,
  "signal_direction": null,
  "urgency": null,
  "thematic_buckets": [],
  "is_ahead_of_curve": false
}

Input: "Will Abdul El-Sayed win the Michigan Democratic Primary?"
Probability: 0.54, Volume: $103K
Output: {
  "is_relevant": false,
  "confidence": 0.88,
  "reason": "State-level primary election. No specific tech
    policy catalyst that would directly move BIT Capital
    holdings. Read-through too indirect.",
  "affected_stocks": [],
  "signal_type": null,
  "signal_direction": null,
  "urgency": null,
  "thematic_buckets": [],
  "is_ahead_of_curve": false
}

Input: "Will Apple market cap exceed Microsoft by Dec 2026?"
Probability: 0.31, Volume: $145K
Output: {
  "is_relevant": true,
  "confidence": 0.62,
  "reason": "Direct competitive positioning signal between two
    major BIT Capital holdings. Outcome reflects relative growth
    expectations and AI monetization narratives for both AAPL
    and MSFT.",
  "affected_stocks": ["AAPL", "MSFT"],
  "signal_type": "company",
  "signal_direction": "neutral",
  "urgency": "medium",
  "thematic_buckets": ["Big Tech Platforms"],
  "is_ahead_of_curve": false
}

Input: "Will US impose 25% tariffs on Chinese semiconductors?"
Probability: 0.48, Volume: $620K
Output: {
  "is_relevant": true,
  "confidence": 0.78,
  "reason": "Direct supply chain and cost impact for NVDA, AMD,
    AAPL, and TSM. Major catalyst with bipartisan support —
    market is split, making this a genuine ahead-of-curve signal.",
  "affected_stocks": ["NVDA", "AMD", "AAPL", "TSM"],
  "signal_type": "regulation",
  "signal_direction": "negative",
  "urgency": "high",
  "thematic_buckets": ["Semiconductors", "Geopolitics"],
  "is_ahead_of_curve": true
}

Input: "Will Q3 2026 GDP growth exceed 2.5%?"
Probability: 0.42, Volume: $89K
Output: {
  "is_relevant": true,
  "confidence": 0.58,
  "reason": "GDP growth above trend supports continued Fed
    hawkishness, pressuring growth tech valuations. Moderate
    indirect read-through to MSFT, GOOGL, META through rate
    expectations channel.",
  "affected_stocks": ["MSFT", "GOOGL", "META"],
  "signal_type": "macro",
  "signal_direction": "negative",
  "urgency": "medium",
  "thematic_buckets": ["Macro/Rates"],
  "is_ahead_of_curve": false
}

Input: "Will the US further restrict Nvidia chip exports to China before Q4 2026?"
Probability: 0.38, Volume: $410K
Output: {
  "is_relevant": true,
  "confidence": 0.83,
  "reason": "Export restrictions would directly reduce addressable China revenue for NVDA and AMD while pressuring AI supply chain sentiment. Specific regulatory catalyst with clear semiconductor exposure.",
  "affected_stocks": ["NVDA", "AMD", "ASML", "TSM"],
  "signal_type": "regulation",
  "signal_direction": "negative",
  "urgency": "high",
  "thematic_buckets": ["AI Infrastructure", "Semiconductors", "Geopolitics"],
  "is_ahead_of_curve": true
}

Input: "Will DOJ win its Google adtech antitrust case before 2027?"
Probability: 0.44, Volume: $260K
Output: {
  "is_relevant": true,
  "confidence": 0.79,
  "reason": "A DOJ win would create direct remedy risk for GOOGL's adtech stack and could change platform economics. Named legal catalyst tied to a tracked holding.",
  "affected_stocks": ["GOOGL"],
  "signal_type": "regulation",
  "signal_direction": "negative",
  "urgency": "high",
  "thematic_buckets": ["Big Tech Platforms", "AI Regulation"],
  "is_ahead_of_curve": true
}

Input: "Will OpenAI release GPT-5 before December 2026?"
Probability: 0.52, Volume: $340K
Output: {
  "is_relevant": true,
  "confidence": 0.73,
  "reason": "A major OpenAI model release would strengthen MSFT's Copilot and Azure AI positioning through its OpenAI partnership. Product launch catalyst with direct competitive read-through.",
  "affected_stocks": ["MSFT"],
  "signal_type": "company",
  "signal_direction": "positive",
  "urgency": "medium",
  "thematic_buckets": ["AI Infrastructure", "Big Tech Platforms"],
  "is_ahead_of_curve": false
}

Input: "Will a US stablecoin bill pass before September 2026?"
Probability: 0.46, Volume: $275K
Output: {
  "is_relevant": true,
  "confidence": 0.76,
  "reason": "Stablecoin legislation directly affects COIN, CRCL, PYPL, and digital asset infrastructure sentiment. Specific regulatory catalyst with clear fintech exposure.",
  "affected_stocks": ["COIN", "CRCL", "PYPL"],
  "signal_type": "regulation",
  "signal_direction": "positive",
  "urgency": "high",
  "thematic_buckets": ["Fintech", "Digital Assets"],
  "is_ahead_of_curve": true
}

Input: "Will Texas pass new data center power restrictions before 2027?"
Probability: 0.36, Volume: $44K
Output: {
  "is_relevant": true,
  "confidence": 0.7,
  "reason": "Data center power restrictions would affect AI infrastructure buildout economics for IREN, APLD, NVDA, and cloud platforms. Specific policy catalyst tied to compute capacity.",
  "affected_stocks": ["IREN", "APLD", "NVDA", "MSFT", "GOOGL"],
  "signal_type": "regulation",
  "signal_direction": "negative",
  "urgency": "medium",
  "thematic_buckets": ["AI Infrastructure"],
  "is_ahead_of_curve": true
}

Input: "Will Reddit announce a major AI data licensing deal before 2027?"
Probability: 0.28, Volume: $18K
Output: {
  "is_relevant": true,
  "confidence": 0.66,
  "reason": "A major AI data licensing deal would directly affect RDDT monetization and could influence data access costs for MSFT, GOOGL, and META. Company catalyst with AI platform read-through.",
  "affected_stocks": ["RDDT", "MSFT", "GOOGL", "META"],
  "signal_type": "company",
  "signal_direction": "positive",
  "urgency": "medium",
  "thematic_buckets": ["Big Tech Platforms", "AI Infrastructure"],
  "is_ahead_of_curve": false
}

Input: "Will Nvidia hit (HIGH) $224 this week?"
Probability: 0.33, Volume: $210K
Output: {
  "is_relevant": false,
  "confidence": 0.94,
  "reason": "Pure equity price-level market with no underlying catalyst. It restates market pricing rather than identifying a BIT Capital signal.",
  "affected_stocks": [],
  "signal_type": null,
  "signal_direction": null,
  "urgency": null,
  "thematic_buckets": [],
  "is_ahead_of_curve": false
}

Input: "Will WTI Crude Oil hit (HIGH) $130 in May?"
Probability: 0.115, Volume: $1.1M
Output: {
  "is_relevant": false,
  "confidence": 0.91,
  "reason": "Pure commodity price-level market with no policy, supply, or demand catalyst. Any tech read-through is too generic without an underlying event.",
  "affected_stocks": [],
  "signal_type": null,
  "signal_direction": null,
  "urgency": null,
  "thematic_buckets": [],
  "is_ahead_of_curve": false
}

Return a JSON object:
{
  "signals": [
    { ...signal1 },
    { ...signal2 }
  ]
}
One signal per market, in the same order as the input.
`;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function buildUserPrompt(batch: MarketForAnalysis[]): string {
  return `Analyze these ${batch.length} markets. Return a JSON object with
a 'signals' array containing one result per market in order:

${batch.map((m, i) => `Market ${i+1}: "${m.question}"
Probability: ${m.probability} | Volume: $${m.volume}`).join('\n\n')}`;
}

function isPurePriceLevelMarket(market: MarketForAnalysis): boolean {
  const question = market.question.toLowerCase();
  const hasDollarLevel = /\$\s*\d/.test(market.question);
  const hasPriceLevelShape =
    question.includes('hit (high)') ||
    question.includes('hit (low)') ||
    /\b(hit|reach|above|below|close above|close below|finish above|finish below|end above|end below)\b[^?]*\$\s*\d/i.test(market.question);
  const hasUnderlyingCatalyst =
    /\b(ipo|market cap|tariff|rate|cut|hike|earnings|revenue|approval|deal|ban|regulation|ruling|launch|release|export|import|sanction|merger|acquisition)\b/i.test(
      market.question
    );

  return hasDollarLevel && hasPriceLevelShape && !hasUnderlyingCatalyst;
}

function normalizeTicker(ticker: string): string {
  const normalized = ticker.trim().toUpperCase();
  return TICKER_ALIASES[normalized] ?? normalized;
}

function validateAndClean(signal: any, market: MarketForAnalysis): any {
  const validTickers = (signal.affected_stocks || [])
    .map((t: string) => normalizeTicker(String(t)))
    .filter((t: string) => HOLDINGS_SET.has(t));
  const uniqueValidTickers = Array.from(new Set(validTickers));

  if (signal.is_relevant && uniqueValidTickers.length === 0) {
    signal.is_relevant = false;
    signal.reason = signal.reason +
      " [Auto-rejected: no BIT Capital ticker identified]";
  }

  // Rule 2: Confidence below 0.45 = not relevant
  if (signal.is_relevant && signal.confidence < 0.45) {
    signal.is_relevant = false;
  }

  if (signal.is_relevant && isPurePriceLevelMarket(market)) {
    signal.is_relevant = false;
    signal.reason =
      "Pure price-level market with no underlying catalyst. Rejected to avoid treating price bets as BIT Capital research signals.";
  }

  const probability = market.probability ?? null;
  if (
    signal.is_relevant &&
    probability !== null &&
    (probability < 0.01 || probability > 0.99)
  ) {
    signal.is_relevant = false;
    signal.reason =
      "Resolved or near-resolved market. Rejected because probability is outside the 1%-99% actionable range.";
  }

  const volume = market.volume ?? 0;
  if (signal.is_relevant && volume < MIN_RELEVANT_VOLUME_USD) {
    signal.is_relevant = false;
    signal.reason =
      "Market volume is below $50. Rejected because liquidity is too thin for a reliable BIT Capital signal.";
  }

  if (signal.is_relevant && market.end_date) {
    const hoursRemaining = (new Date(market.end_date).getTime() - Date.now()) / (1000 * 60 * 60);
    if (hoursRemaining < 12) {
      signal.is_relevant = false;
      signal.reason =
        "Market resolves in less than 12 hours. Rejected because the signal has no actionable monitoring window.";
    }
  }

  // Rule 3: Clean ticker list to only valid holdings
  signal.affected_stocks = uniqueValidTickers;

  // Rule 4: Null out fields on rejected signals
  if (!signal.is_relevant) {
    signal.signal_type = signal.signal_type || null;
    signal.signal_direction = null;
    signal.urgency = null;
    signal.is_ahead_of_curve = false;
  }

  return signal;
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

function hasActionableMarketShape(market: MarketForAnalysis): boolean {
  const probability = market.probability ?? null;
  if (probability !== null && (probability < 0.01 || probability > 0.99)) return false;
  if ((market.volume ?? 0) < MIN_RELEVANT_VOLUME_USD) return false;

  if (market.end_date) {
    const hoursRemaining = (new Date(market.end_date).getTime() - Date.now()) / (1000 * 60 * 60);
    if (hoursRemaining < 12) return false;
  }

  return true;
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
  const desiredMarketRows = Math.max(limit * 4, 1000);
  const pageSize = 1000;

  const freshMarketColumns =
    'id, question, description, probability, probability_24h_ago, volume, liquidity, category, end_date, last_updated_at';
  const fallbackMarketColumns =
    'id, question, description, probability, volume, liquidity, category, end_date';

  async function fetchActiveMarketRows(columns: string) {
    const rows: unknown[] = [];
    for (let offset = 0; offset < desiredMarketRows; offset += pageSize) {
      const { data, error } = await supabase
        .from('markets')
        .select(columns)
        .eq('is_active', true)
        .order('volume', { ascending: false })
        .range(offset, Math.min(offset + pageSize - 1, desiredMarketRows - 1));

      if (error) return { data: rows, error };
      rows.push(...(data ?? []));
      if (!data || data.length < pageSize) break;
    }

    return { data: rows, error: null };
  }

  let { data: markets, error: marketFetchError } = await fetchActiveMarketRows(freshMarketColumns);

  if (marketFetchError && getMissingColumn(marketFetchError.message)) {
    console.warn(
      '[Filter] markets freshness columns missing; falling back to legacy market selection'
    );
    const fallback = await fetchActiveMarketRows(fallbackMarketColumns);
    markets = fallback.data as typeof markets;
    marketFetchError = fallback.error;
  }

  if (marketFetchError) throw new Error(`Supabase market fetch error: ${marketFetchError.message}`);
  if (!markets?.length) return [];

  const actionableMarkets = (markets as MarketForAnalysis[]).filter(hasActionableMarketShape);
  console.log(
    `[Filter] Quality prefilter kept ${actionableMarkets.length}/${markets.length} active markets`
  );

  const marketsWithMovement = await enrichWithProbabilityChanges(actionableMarkets);
  const ids = marketsWithMovement.map((market) => market.id);

  async function fetchExistingSignalRows(columns: string) {
    const rows: unknown[] = [];
    for (let i = 0; i < ids.length; i += 500) {
      const { data, error } = await supabase
        .from('signals')
        .select(columns)
        .in('market_id', ids.slice(i, i + 500));

      if (error) return { data: rows, error };
      rows.push(...(data ?? []));
    }

    return { data: rows, error: null };
  }

  let { data: existingSignals, error: signalFetchError } =
    await fetchExistingSignalRows('market_id, model');

  const modelColumnMissing = signalFetchError && getMissingColumn(signalFetchError.message) === 'model';
  if (modelColumnMissing) {
    console.warn('[Filter] signals.model is missing; treating existing analyses as stale for this run');
    const fallback = await fetchExistingSignalRows('market_id');
    existingSignals = fallback.data as typeof existingSignals;
    signalFetchError = fallback.error;
  }

  if (signalFetchError) throw new Error(`Supabase signal fetch error: ${signalFetchError.message}`);

  const signalByMarket = new Map(
    ((existingSignals ?? []) as Array<{ market_id: string; model: string | null }>).map((signal) => [
      signal.market_id,
      signal,
    ])
  );
  const analysisCandidateMarkets = marketsWithMovement.filter(
    (market) => {
      const existingSignal = signalByMarket.get(market.id);
      return (
        !existingSignal ||
        modelColumnMissing ||
        existingSignal.model !== ANALYSIS_MODEL_TAG ||
        hasRecentProbabilityMove(market)
      );
    }
  );
  const staleCount = analysisCandidateMarkets.filter((market) => {
    const existingSignal = signalByMarket.get(market.id);
    return existingSignal && (modelColumnMissing || existingSignal.model !== ANALYSIS_MODEL_TAG);
  }).length;
  const changedCount = analysisCandidateMarkets.filter(
    (market) => signalByMarket.has(market.id) && hasRecentProbabilityMove(market)
  ).length;

  if (staleCount > 0) {
    console.log(`[Filter] Re-analyzing ${staleCount} markets from older prompt/model versions`);
  }
  if (changedCount > 0) {
    console.log(`[Filter] Re-analyzing ${changedCount} markets with fresh probability moves`);
  }

  const prioritizedCandidates = sortMarketsForAnalysis(analysisCandidateMarkets, config);

  return prioritizedCandidates
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

  const batch = await enrichWithProbabilityChanges(markets);

  console.log(`[Filter] Sending batch of ${batch.length} to gpt-4o-mini...`);

  const response = await openai.chat.completions.create({
    model: ANALYSIS_MODEL,
    temperature: 0.1,
    response_format: { type: "json_object" },
    max_tokens: 2000,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(batch) }
    ]
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI returned an empty response.');
  }

  let parsedResponse: OpenAISignalResponse;
  try {
    parsedResponse = JSON.parse(content) as OpenAISignalResponse;
  } catch {
    throw new Error(`OpenAI returned invalid JSON: ${content.slice(0, 500)}`);
  }

  const parsedSignals = parsedResponse.signals || [];
  const analyzedAt = new Date().toISOString();
  const rows: SignalRow[] = [];

  for (let i = 0; i < parsedSignals.length; i++) {
    const market = batch[i];
    if (!market) continue;

    const parsed = validateAndClean({ ...parsedSignals[i], market_id: market.id }, market);

    rows.push({
      ...parsed,
      model: ANALYSIS_MODEL_TAG,
      analyzed_at: analyzedAt,
      probability_change: market.probability_change,
      is_moving: market.is_moving,
    });
  }

  return rows;
}

async function analyzeBatchesWithConcurrency(
  batches: MarketForAnalysis[][]
): Promise<PromiseSettledResult<SignalRow[]>[]> {
  const results: PromiseSettledResult<SignalRow[]>[] = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < batches.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = {
          status: 'fulfilled',
          value: await analyzeBatch(batches[index]),
        };
      } catch (reason) {
        results[index] = {
          status: 'rejected',
          reason,
        };
      }
    }
  }

  const workerCount = Math.min(ANALYSIS_CONCURRENCY, batches.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

export async function analyzeMarkets(limit = 36): Promise<AnalyzeResult> {
  console.log(`[Filter] analyzeMarkets starting | limit: ${limit}`);

  await refreshExistingSignalMovement(limit);

  const unanalyzed = await fetchUnanalyzedMarkets(limit);
  if (!unanalyzed.length) {
    console.log('[Filter] No new markets need analysis.');
    return { analyzed: 0, relevant: 0 };
  }

  const batches: MarketForAnalysis[][] = [];
  for (let i = 0; i < unanalyzed.length; i += BATCH_SIZE) {
    batches.push(unanalyzed.slice(i, i + BATCH_SIZE));
  }

  console.log(
    `[Filter] Dispatching ${batches.length} OpenAI batches of up to ${BATCH_SIZE} markets with concurrency ${ANALYSIS_CONCURRENCY}...`
  );
  const batchResults = await analyzeBatchesWithConcurrency(batches);

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

  return { analyzed: analyzedCount, relevant: relevantCount };
}
