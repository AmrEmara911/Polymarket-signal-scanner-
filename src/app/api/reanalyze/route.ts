import { NextResponse } from 'next/server';
import { callOpenAIJson } from '@/lib/openai';
import {
  THEMATIC_BUCKETS,
  type ThematicBucket,
  inferBucketsFromStocks,
  inferBucketsFromSignalType,
} from '@/lib/filter';
import { getSupabaseClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const VALID_BUCKETS_SET = new Set<string>(THEMATIC_BUCKETS);
/** Batch size for LLM classification calls — 10 questions per call keeps each
 *  prompt small (cheap) while amortizing the round-trip overhead. */
const LLM_BATCH_SIZE = 10;

interface SignalRow {
  id: string;
  market_id: string;
  affected_stocks: string[] | null;
  signal_type: string | null;
}

interface MarketRow {
  id: string;
  question: string;
}

interface LlmClassificationResponse {
  classifications: Array<{
    id: string;
    thematic_buckets: string[];
  }>;
}

/**
 * Build the LLM prompt for batch classification. Kept terse — this is a backfill
 * pass, not the main analysis loop, so we only ask for the bucket array.
 */
function buildClassificationPrompt(items: Array<{ id: string; question: string }>) {
  const lines = items
    .map(
      (item, i) =>
        `${i + 1}. id: ${item.id}\n   question: ${item.question.replace(/\n/g, ' ')}`
    )
    .join('\n');

  const system = `You are classifying Polymarket prediction markets into BIT Capital portfolio thematic buckets.

For each market question, return ALL applicable buckets from this EXACT list (case-sensitive):
- "AI Infrastructure"  (chip/GPU/data-center stocks: IREN, NVDA, AMD, APLD, COHR)
- "Big Tech Platforms" (MSFT, GOOGL, META, AAPL, AMZN, RDDT)
- "Fintech"            (SOFI, LMND, HIMS, CRCL)
- "Digital Assets"     (IREN, CRCL, GLXY; also BTC/ETH price markets and crypto ETFs)
- "Digital Health"     (HNGE, HIMS, LMND)
- "Cybersecurity"      (NTSK)
- "Macro/Rates"        (Fed decisions, FOMC, tariffs, inflation prints, AI regulation, semiconductor export controls)

Rules:
- A SINGLE market frequently affects MULTIPLE buckets. A Fed rate decision is "Macro/Rates" AND should also include the equity buckets it affects ("Big Tech Platforms", "AI Infrastructure" for growth/duration-sensitive holdings).
- A SpaceX IPO market → "Big Tech Platforms".
- A Bitcoin price market → "Digital Assets".
- NEVER return an empty array. If nothing else fits, include "Macro/Rates".

Return JSON only:
{"classifications": [{"id": "<exact-input-id>", "thematic_buckets": ["bucket1", "bucket2"]}]}`;

  const user = `Classify these ${items.length} markets:\n\n${lines}`;
  return { system, user };
}

async function classifyBatchWithLlm(
  items: Array<{ id: string; question: string }>
): Promise<Map<string, ThematicBucket[]>> {
  if (items.length === 0) return new Map();
  const { system, user } = buildClassificationPrompt(items);
  const response = await callOpenAIJson<LlmClassificationResponse>([
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]);

  const out = new Map<string, ThematicBucket[]>();
  for (const cls of response.classifications ?? []) {
    if (!cls?.id) continue;
    const cleaned = (cls.thematic_buckets ?? [])
      .map((b) => String(b).trim())
      .filter((b): b is ThematicBucket => VALID_BUCKETS_SET.has(b));
    out.set(cls.id, Array.from(new Set(cleaned)));
  }
  return out;
}

async function handler() {
  try {
    const supabase = getSupabaseClient();

    // 1. Fetch signals where thematic_buckets is null OR empty array.
    //    Two `or` filters needed because PostgREST treats NULL and {} differently.
    const { data: nullSignals, error: nullErr } = await supabase
      .from('signals')
      .select('id, market_id, affected_stocks, signal_type')
      .is('thematic_buckets', null);
    if (nullErr) throw new Error(`Fetch (null): ${nullErr.message}`);

    const { data: emptySignals, error: emptyErr } = await supabase
      .from('signals')
      .select('id, market_id, affected_stocks, signal_type')
      .eq('thematic_buckets', '{}');
    if (emptyErr) throw new Error(`Fetch (empty): ${emptyErr.message}`);

    const allSignals: SignalRow[] = [
      ...((nullSignals ?? []) as SignalRow[]),
      ...((emptySignals ?? []) as SignalRow[]),
    ];

    if (allSignals.length === 0) {
      return NextResponse.json({
        success: true,
        updated: 0,
        scanned: 0,
        message: 'No signals need backfill — all signals already have thematic_buckets.',
      });
    }

    console.log('[Reanalyze] Found', allSignals.length, 'signals needing backfill');

    // 2. Try deterministic inference first (fast, free). Anything we can't
    //    classify deterministically goes to the LLM.
    const inferredById = new Map<string, ThematicBucket[]>();
    const needsLlm: Array<{ id: string; market_id: string }> = [];

    for (const sig of allSignals) {
      const fromStocks = inferBucketsFromStocks(sig.affected_stocks);
      const fromType = inferBucketsFromSignalType(sig.signal_type);
      const merged = Array.from(new Set<ThematicBucket>([...fromStocks, ...fromType]));
      if (merged.length > 0) {
        inferredById.set(sig.id, merged);
      } else {
        needsLlm.push({ id: sig.id, market_id: sig.market_id });
      }
    }

    console.log(
      '[Reanalyze] Deterministic:',
      inferredById.size,
      '| LLM needed:',
      needsLlm.length
    );

    // 3. Fetch market questions for the rows that still need LLM classification.
    if (needsLlm.length > 0) {
      const marketIds = Array.from(new Set(needsLlm.map((s) => s.market_id)));
      const { data: markets, error: marketErr } = await supabase
        .from('markets')
        .select('id, question')
        .in('id', marketIds);
      if (marketErr) throw new Error(`Fetch markets: ${marketErr.message}`);

      const questionByMarket = new Map<string, string>();
      for (const m of (markets ?? []) as MarketRow[]) {
        questionByMarket.set(m.id, m.question);
      }

      // 4. Batch-classify with the LLM.
      for (let i = 0; i < needsLlm.length; i += LLM_BATCH_SIZE) {
        const batch = needsLlm.slice(i, i + LLM_BATCH_SIZE);
        const items = batch
          .map((s) => ({
            id: s.id,
            question: questionByMarket.get(s.market_id) ?? '',
          }))
          .filter((it) => it.question);

        if (items.length === 0) continue;

        try {
          const llmResult = await classifyBatchWithLlm(items);
          // Array.from for ES5 target compatibility (no Map iterator support).
          Array.from(llmResult.entries()).forEach(([id, buckets]) => {
            // Default to Macro/Rates if LLM still returned empty (it shouldn't, but defensive).
            inferredById.set(id, buckets.length > 0 ? buckets : ['Macro/Rates']);
          });
          console.log(
            `[Reanalyze] LLM batch ${Math.floor(i / LLM_BATCH_SIZE) + 1}:`,
            llmResult.size,
            'classified'
          );
        } catch (err) {
          console.error(
            `[Reanalyze] LLM batch ${Math.floor(i / LLM_BATCH_SIZE) + 1} failed:`,
            err instanceof Error ? err.message : err
          );
          // Continue — partial backfill is better than none.
        }
      }
    }

    // 5. Apply updates. One UPDATE per signal — Supabase doesn't support
    //    bulk UPDATE with different values per row in a single call.
    let updated = 0;
    for (const sig of allSignals) {
      const buckets = inferredById.get(sig.id);
      if (!buckets || buckets.length === 0) continue;
      const { error } = await supabase
        .from('signals')
        .update({ thematic_buckets: buckets })
        .eq('id', sig.id);
      if (error) {
        console.error('[Reanalyze] Update failed for', sig.id, ':', error.message);
        continue;
      }
      updated += 1;
    }

    return NextResponse.json({
      success: true,
      scanned: allSignals.length,
      updated,
      deterministic: inferredById.size - needsLlm.length,
      llm_classified: needsLlm.length,
      skipped: allSignals.length - updated,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Reanalyze] Failed:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export const GET = handler;
export const POST = handler;
