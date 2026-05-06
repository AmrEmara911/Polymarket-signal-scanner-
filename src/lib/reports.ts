import { getAnalystConfig } from './analyst-config';
import { BITCAP_RESEARCH_CONTEXT } from './bitcap';
import { callOpenAIJson, getOpenAIModel } from './openai';
import { getSupabaseClient } from './supabase';

interface SignalWithMarket {
  id: string;
  market_id: string;
  is_relevant: boolean;
  relevance_score: number;
  confidence: number;
  reason: string;
  affected_stocks: string[];
  affected_sectors: string[];
  signal_type: string | null;
  signal_direction: string | null;
  urgency: string;
  thesis: string;
  evidence: string[];
  key_risks: string[];
  suggested_action: string;
  probability_change: number | null;
  analyzed_at: string;
  markets: {
    id: string;
    question: string;
    probability: number;
    volume: number;
    liquidity: number;
    category: string;
    end_date: string | null;
  } | null;
}

interface ReportResponse {
  title: string;
  summary: string;
  key_takeaways: string[];
  markdown_report: string;
}

export interface GeneratedReport {
  id: string;
  title: string;
  summary: string;
  content: string;
  key_takeaways: string[];
  signal_count: number;
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

function reportUtilityScore(signal: SignalWithMarket) {
  const question = signal.markets?.question ?? '';
  if (isDirectEquityPriceMarket(question)) return -1;

  let score = signal.relevance_score * 0.45 + signal.confidence * 0.25;
  const type = signal.signal_type?.toLowerCase();

  if (['rates', 'tariff', 'regulatory', 'macro', 'crypto'].includes(type ?? '')) score += 0.18;
  if (type === 'company' && (signal.markets?.volume ?? 0) >= 10_000) score += 0.08;
  if ((signal.markets?.volume ?? 0) >= 50_000) score += 0.08;
  if ((signal.markets?.volume ?? 0) < 5_000) score -= 0.12;
  if (signal.affected_stocks?.length) score += 0.06;
  if (signal.thesis?.length > 120) score += 0.04;

  const probability = signal.markets?.probability;
  if (typeof probability === 'number' && probability > 0.1 && probability < 0.9) score += 0.04;
  if (typeof probability === 'number' && (probability >= 0.97 || probability <= 0.03)) score -= 0.16;
  if (typeof probability === 'number' && probability >= 0.93 && type === 'company') score -= 0.18;

  return score;
}

function selectReportSignals(signals: SignalWithMarket[], limit: number) {
  const ranked = signals
    .map((signal) => ({ signal, utility: reportUtilityScore(signal) }))
    .filter(({ signal, utility }) => signal.is_relevant && utility >= 0.45)
    .sort((a, b) => b.utility - a.utility);

  if (ranked.length) {
    return ranked.slice(0, limit).map(({ signal, utility }) => ({
      ...signal,
      report_utility_score: Number(utility.toFixed(3)),
    }));
  }

  return signals
    .filter((signal) => signal.is_relevant && !isDirectEquityPriceMarket(signal.markets?.question ?? ''))
    .slice(0, limit);
}

function getMissingColumn(message: string) {
  return message.match(/Could not find the '([^']+)' column/)?.[1] ?? null;
}

async function insertReportWithSchemaFallback(row: Record<string, unknown>) {
  const supabase = getSupabaseClient();
  let mutableRow = { ...row };
  const removedColumns: string[] = [];

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { data, error } = await supabase.from('reports').insert(mutableRow).select('*').single();

    if (!error) {
      return { data: data as Record<string, unknown>, removedColumns };
    }

    const missingColumn = getMissingColumn(error.message);
    if (!missingColumn) {
      throw new Error(`Supabase report insert error: ${error.message}`);
    }

    removedColumns.push(missingColumn);
    delete mutableRow[missingColumn];
  }

  throw new Error(
    `Supabase report insert error: schema fallback removed too many columns (${removedColumns.join(
      ', '
    )})`
  );
}

export async function generateSignalReport(limit = 12): Promise<GeneratedReport | null> {
  const supabase = getSupabaseClient();
  const config = await getAnalystConfig();

  const { data: signals, error } = await supabase
    .from('signals')
    .select(
      `
      id,
      market_id,
      is_relevant,
      relevance_score,
      confidence,
      reason,
      affected_stocks,
      affected_sectors,
      signal_type,
      signal_direction,
      urgency,
      thesis,
      evidence,
      key_risks,
      suggested_action,
      analyzed_at,
      markets (
        id,
        question,
        probability,
        volume,
        liquidity,
        category,
        end_date
      )
    `
    )
    .eq('is_relevant', true)
    .order('relevance_score', { ascending: false })
    .order('confidence', { ascending: false })
    .limit(Math.max(limit * 4, 40));

  if (error) {
    throw new Error(`Supabase report signal fetch error: ${error.message}`);
  }

  const reportSignals = selectReportSignals((signals ?? []) as unknown as SignalWithMarket[], limit);
  if (!reportSignals.length) return null;

  const today = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const signalLines = reportSignals
    .map((s) => {
      const prob = s.markets?.probability != null
        ? `${(s.markets.probability * 100).toFixed(0)}%`
        : 'n/a';
      const vol = s.markets?.volume != null
        ? `$${s.markets.volume.toLocaleString()}`
        : 'n/a';
      const stocks = s.affected_stocks?.length ? s.affected_stocks.join(', ') : 'none identified';
      const changeStr =
        s.probability_change != null && Math.abs(s.probability_change) >= 0.05
          ? ` | 24h move: ${s.probability_change > 0 ? '+' : ''}${(s.probability_change * 100).toFixed(1)}pp${Math.abs(s.probability_change) > 0.10 ? ' ⚡ MOVING' : ''}`
          : '';
      return [
        `Question: ${s.markets?.question ?? '(unknown)'}`,
        `Probability: ${prob}${changeStr} | Volume: ${vol}`,
        `Affected stocks: ${stocks}`,
        `Direction: ${s.signal_direction ?? 'unclear'} | Urgency: ${s.urgency}`,
        `Reason: ${s.reason}`,
      ].join('\n');
    })
    .join('\n\n---\n\n');

  const response = await callOpenAIJson<ReportResponse>([
    {
      role: 'system',
      content: `You are a senior investment analyst at BIT Capital, a Berlin-based tech fund managing over €1B in assets. You write morning briefings for portfolio managers who are pressed for time and need sharp, actionable insight. Your writing is direct, specific, and opinionated. You never summarize data — you interpret it.

Return JSON only:
{
  "title": "string",
  "summary": "3-5 sentence executive summary",
  "key_takeaways": ["string"],
  "markdown_report": "markdown string following the exact structure below"
}`,
    },
    {
      role: 'user',
      content: `Write a morning signal briefing for BIT Capital portfolio managers based on these Polymarket prediction markets.

Pay special attention to markets that have moved significantly in the last 24 hours — these are the most actionable signals. Markets tagged ⚡ MOVING have shifted more than 10 percentage points since yesterday; treat them with higher priority and explain what drove the move.

Active signals:
${signalLines}

Your briefing MUST follow this exact structure:

---
# BIT Capital Signal Briefing — ${today}

## Market Pulse (2-3 sentences max)
One sharp paragraph on what the prediction markets are collectively signaling about the macro environment right now. Be specific. Name numbers.

## Top 3 Signals to Act On

For each signal:
**[Signal name]** — [probability]% probability
*What the market is pricing:* [one sentence]
*What this means for our portfolio:* [specific stock impact, bullish or bearish, magnitude]
*What would change this view:* [specific trigger to watch]
*Conviction:* High / Medium / Low

## Portfolio Exposure Summary
Which of our holdings (NVDA, ASML, MSFT, GOOGL, AMZN, META, TSMC, AMD, AMAT, AAPL, VISA, ADYEN, PAYPAL) have the most signals pointing at them today, and what is the net direction?

## Contrarian Take
One market where the crowd is probably wrong and why. Be specific. Show your reasoning.

## What to Watch Today
Three specific things to monitor that could move these probabilities significantly.
---

Important rules:
- Never show Market IDs
- Never say 'the data shows' or 'according to the signals'
- Write as if you are the analyst, not a system summarizing data
- Be bullish or bearish — never neutral or vague
- If two signals conflict, call it out explicitly`,
    },
  ]);

  const row = {
    title: response.title,
    summary: response.summary,
    content: response.markdown_report,
    key_takeaways: response.key_takeaways ?? [],
    market_ids: reportSignals.map((signal) => signal.market_id),
    signal_count: reportSignals.length,
    model: getOpenAIModel(),
  };

  const { data: inserted } = await insertReportWithSchemaFallback(row);

  return {
    id: String(inserted.id),
    title: String(inserted.title ?? response.title),
    summary: String(inserted.summary ?? response.summary),
    content: String(inserted.content ?? response.markdown_report),
    key_takeaways: Array.isArray(inserted.key_takeaways)
      ? (inserted.key_takeaways as string[])
      : response.key_takeaways ?? [],
    signal_count: Number(inserted.signal_count ?? reportSignals.length),
  };
}
