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

  const probability = signal.markets?.probability;
  if (typeof probability === 'number' && (probability >= 0.95 || probability <= 0.05)) {
    return -1;
  }

  const volume = signal.markets?.volume ?? 0;
  if (volume < 1_000) return -1;

  let score = signal.relevance_score * 0.45 + signal.confidence * 0.25;
  const type = signal.signal_type?.toLowerCase();

  if (['rates', 'tariff', 'regulatory', 'macro', 'crypto'].includes(type ?? '')) score += 0.18;
  if (type === 'company' && volume >= 10_000) score += 0.08;
  if (volume >= 50_000) score += 0.08;
  if (volume < 10_000) score -= 0.20;
  if (signal.affected_stocks?.length) score += 0.06;
  if (signal.thesis?.length > 120) score += 0.04;

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
  const mutableRow = { ...row };
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
      probability_change,
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

      const absChange = s.probability_change != null ? Math.abs(s.probability_change) : null;
      const changeStr =
        s.probability_change != null && absChange != null && absChange >= 0.05
          ? `${s.probability_change > 0 ? '+' : ''}${(s.probability_change * 100).toFixed(1)}pp in 24h${absChange > 0.10 ? ' ⚡ MOVING' : ''}`
          : 'stable';

      const thesisStr = s.thesis ? s.thesis.slice(0, 300) : s.reason;
      const risksStr = Array.isArray(s.key_risks) && s.key_risks.length
        ? s.key_risks.slice(0, 2).join('; ')
        : 'none noted';

      return [
        `Question: ${s.markets?.question ?? '(unknown)'}`,
        `Probability: ${prob} | 24h change: ${changeStr} | Volume: ${vol}`,
        `Affected stocks: ${stocks}`,
        `Direction: ${s.signal_direction ?? 'unclear'} | Urgency: ${s.urgency} | Type: ${s.signal_type ?? 'unclassified'}`,
        `Thesis: ${thesisStr}`,
        `Key risks: ${risksStr}`,
      ].join('\n');
    })
    .join('\n\n---\n\n');

  const response = await callOpenAIJson<ReportResponse>([
    {
      role: 'system',
      content: `You are a senior investment analyst at BIT Capital GmbH, a Berlin-based asset manager with $2.7B AUM. You write morning briefings for portfolio managers who are pressed for time and need sharp, actionable insight. Your writing is direct, specific, and opinionated. You never summarize data — you interpret it. You never hedge every sentence into meaninglessness.

Strict reporting rules:
- Never write the same "Why it moved" reason for multiple signals. If multiple signals show no movement, include at most one stable signal in the Top 3 and pick the most important one. Replace the others with signals that moved recently, especially markets that moved more than 10 percentage points in 24h.
- For the Contrarian Take, name a specific calendar event, data point, quote, or source. Examples: "the May 14 CPI release", "core PCE running at 2.8% vs the Fed's 2% target", or "Williams' speech last Thursday". Do not use vague filler such as "current economic indicators", "potential shifts", or "changing macro conditions".
- Verify question polarity before stating the implication. Read the exact market question before interpreting the probability. "Powell OUT as Fed Chair by May 16" at 96% means the market expects him to leave; "Powell IN as Fed Chair through 2026" at 96% means the market expects him to stay.
- If any signals moved significantly (>10 percentage points in 24h), prioritize those in the Top 3 over stable markets. The point of monitoring prediction markets is catching moves before they become news.

${BITCAP_RESEARCH_CONTEXT}

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

Each signal includes its current probability AND how much it has moved in the last 24 hours. The 24h change is as important as the current level — a market at 60% that was at 45% yesterday is a different animal from one that has been at 60% for a week. Markets tagged ⚡ MOVING have shifted more than 10 percentage points since yesterday; lead with the movement, not just the level. Explain what likely drove the shift.

CRITICAL: Pay special attention to markets that have moved more than 10 percentage points in the last 24 hours. These are the most actionable signals because they indicate the consensus view is shifting in real time. When probability has moved significantly (>10pp), this usually means new information has hit the market, and it merits front-and-center analysis. Always mention probability movement when it exists, not just current probability levels. Movement is your signal.

Active signals:
${signalLines}

Your briefing MUST follow this exact structure:

---
# BIT Capital Signal Briefing — ${today}

## Market Pulse (2-3 sentences max)
What are the prediction markets collectively signaling right now? Name specific probabilities and movements. If something has moved sharply in the last 24 hours, that is the lede.

## Top 3 Signals to Act On

For each signal, use this format exactly:

**[Descriptive signal name — not the raw market question]** — [probability]% ([+/-Xpp vs yesterday] if it moved, or "stable" if not)
*What the market is pricing:* [one sentence — the actual bet being made]
*Why it moved:* [if 24h change ≥ 5pp, explain what likely drove the shift; if stable, write "No significant movement — this is a slow-building thesis"]
*Portfolio impact:* [specific stock(s) from our holdings, bullish or bearish, rough magnitude]
*Trigger to watch:* [one specific event or data point that would reprice this materially]
*Conviction:* High / Medium / Low

## Portfolio Exposure Summary
Which of our holdings (IREN, MSFT, GOOGL, META, NVDA, SOFI, RDDT, HIMS, LMND, HNGE, CRCL, APLD, COHR, GLXY, NTSK) have the most signals pointing at them today? For each exposed name, give the net direction (net bullish / net bearish / conflicted) and one sentence on why.

## Contrarian Take
One market where the crowd is probably wrong. State the current probability, explain the consensus view embedded in it, then argue specifically why that consensus is mistaken. Do not hedge — pick a side.

## What to Watch Today
Three specific catalysts — scheduled events, data releases, or news triggers — that could move these probabilities by 10+ points before tomorrow's briefing.

## Risk to This View
One paragraph. Assume every signal in this briefing is wrong simultaneously — what is the scenario where that happens? What would the world have to look like for the prediction markets to be systematically mispricing everything we flagged today? Be specific. This is not a disclaimer — it is intellectual honesty about the limits of prediction market signals.
---

Writing rules:
- Never show Market IDs
- Never say "the data shows", "according to the signals", or "it is worth noting"
- Write as the analyst, not as a system narrating data
- Be bullish or bearish — never just "mixed exposure"
- When a market has moved significantly, that movement is the story, not the current level
- If two signals point in opposite directions for the same stock, call the conflict out explicitly`,
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
