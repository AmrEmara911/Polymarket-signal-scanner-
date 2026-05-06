import { supabase } from './supabase';

const SYSTEM_PROMPT = `You are a senior investment analyst at BIT Capital, a Berlin-based \
tech-focused asset manager. BIT Capital invests in global technology \
leaders across: AI/ML infrastructure (NVIDIA, AMD, Broadcom), \
Semiconductor equipment (ASML, AMAT, LRCX), Cloud platforms \
(Microsoft, Google, Amazon, Salesforce), Consumer tech (Apple, Meta, \
Samsung), Fintech (Visa, Mastercard, PayPal, Adyen), Digital assets \
(Bitcoin, Ethereum).

A market IS relevant if it affects: interest rates or monetary policy, \
tech tariffs or semiconductor trade policy, AI/crypto/big tech regulation, \
direct company events for holdings above, or macro shifts hitting \
high-growth tech.

A market is NOT relevant if it is about: sports, entertainment, \
celebrities, non-tech politics, oil/real estate/agriculture.

Return ONLY a valid JSON array. No other text, no markdown.`;

const BATCH_SIZE = 15;
const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent';

interface RawSignal {
  market_id: string;
  is_relevant: boolean;
  confidence: number;
  reason: string;
  affected_stocks: string[];
  signal_type: 'macro' | 'regulatory' | 'company' | 'sector' | null;
  signal_direction: string | null;
  urgency: 'high' | 'medium' | 'low';
}

export interface AnalyzeResult {
  analyzed: number;
  relevant: number;
}

async function callGemini(apiKey: string, userPrompt: string): Promise<string> {
  const res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: SYSTEM_PROMPT + '\n\n' + userPrompt }] }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = await res.json();
  return json.candidates[0].content.parts[0].text as string;
}

export async function analyzeMarkets(): Promise<AnalyzeResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY — add it to .env.local and restart the dev server.');
  }

  // Fetch market_ids that already have a signal
  const { data: existingSignals, error: signalFetchError } = await supabase
    .from('signals')
    .select('market_id');
  if (signalFetchError) throw new Error(`Supabase error: ${signalFetchError.message}`);

  const analyzedIds = existingSignals?.map((s) => s.market_id) ?? [];

  // Fetch up to 20 markets that have not been analyzed yet
  let query = supabase
    .from('markets')
    .select('id, question, probability, volume')
    .eq('is_active', true)
    .limit(20);

  if (analyzedIds.length > 0) {
    query = query.not('id', 'in', `(${analyzedIds.join(',')})`);
  }

  const { data: markets, error: marketFetchError } = await query;
  if (marketFetchError) throw new Error(`Supabase error: ${marketFetchError.message}`);
  if (!markets || markets.length === 0) return { analyzed: 0, relevant: 0 };

  let totalAnalyzed = 0;
  let totalRelevant = 0;

  for (let i = 0; i < markets.length; i += BATCH_SIZE) {
    const batch = markets.slice(i, i + BATCH_SIZE);

    const marketLines = batch
      .map(
        (m, idx) =>
          `${idx + 1}. ID: ${m.id} | "${m.question}" | ${(
            (m.probability ?? 0) * 100
          ).toFixed(1)}% probability | $${(m.volume ?? 0).toLocaleString()} volume`
      )
      .join('\n');

    const userPrompt = `Analyze these markets and return a JSON array with one object per market:
${marketLines}

Each object must have exactly:
{
  market_id: string,
  is_relevant: boolean,
  confidence: number (0-1),
  reason: string (one sentence),
  affected_stocks: string[] (ticker symbols),
  signal_type: "macro" | "regulatory" | "company" | "sector" | null,
  signal_direction: string | null,
  urgency: "high" | "medium" | "low"
}`;

    const raw = await callGemini(apiKey, userPrompt);

    // Strip markdown code fences if Gemini wraps the response
    const cleaned = raw
      .replace(/^```(?:json)?\s*/m, '')
      .replace(/\s*```$/m, '')
      .trim();

    let signals: RawSignal[];
    try {
      signals = JSON.parse(cleaned);
    } catch {
      throw new Error(`Gemini returned non-JSON response: ${raw.slice(0, 300)}`);
    }

    const { error: upsertError } = await supabase
      .from('signals')
      .upsert(signals, { onConflict: 'market_id' });
    if (upsertError) throw new Error(`Supabase upsert error: ${upsertError.message}`);

    totalAnalyzed += signals.length;
    totalRelevant += signals.filter((s) => s.is_relevant).length;
  }

  return { analyzed: totalAnalyzed, relevant: totalRelevant };
}
