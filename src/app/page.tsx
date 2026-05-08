'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { DirectionBadge } from '@/components/DirectionBadge';
import { ProbChangeBadge } from '@/components/ProbChangeBadge';
import { MarketLinkIcon, resolveMarketUrl } from '@/components/MarketLink';
import { AheadOfCurveBadge } from '@/components/AheadOfCurveBadge';
import { formatRelativeTime, formatFullTimestamp } from '@/lib/format-time';

const THEMATIC_BUCKETS = [
  'AI Infrastructure',
  'Big Tech Platforms',
  'Fintech',
  'Digital Assets',
  'Digital Health',
  'Cybersecurity',
  'Macro/Rates',
] as const;
type ThematicBucket = (typeof THEMATIC_BUCKETS)[number];

interface BucketStats {
  count: number;
  positive: number;
  negative: number;
}

/**
 * Categorize a signal_direction string into 'positive' | 'negative' | 'neutral'
 * — same logic as the DirectionBadge component, kept local here so the dashboard
 * can aggregate without rendering.
 */
function classifyDirection(d: string | null | undefined): 'positive' | 'negative' | 'neutral' {
  if (!d) return 'neutral';
  const lower = d.toLowerCase();
  if (/(bullish|positive|\bup\b|rise|increase)/.test(lower)) return 'positive';
  if (/(bearish|negative|\bdown\b|fall|decrease)/.test(lower)) return 'negative';
  return 'neutral';
}

function netDirectionLabel(stats: BucketStats): {
  label: string;
  border: string;
  text: string;
} {
  const { count, positive, negative } = stats;
  if (count === 0) return { label: 'No active signals', border: 'border-[#1f2937]', text: 'text-[#6b7280]' };
  const total = positive + negative;
  // Mostly directional → >70% one side
  if (total > 0 && positive / total > 0.7) {
    return { label: 'Mostly positive', border: 'border-[#10b981]/40', text: 'text-[#10b981]' };
  }
  if (total > 0 && negative / total > 0.7) {
    return { label: 'Mostly negative', border: 'border-[#ef4444]/40', text: 'text-[#ef4444]' };
  }
  return { label: 'Mixed', border: 'border-[#f59e0b]/40', text: 'text-[#f59e0b]' };
}

type PipelineStatus = 'idle' | 'ingesting' | 'analyzing' | 'reporting' | 'done' | 'error';

type MarketInfo = {
  id?: string;
  question: string;
  probability: number;
  volume: number;
  slug?: string | null;
  market_url?: string | null;
};

type SignalRow = {
  id: string;
  markets: MarketInfo | MarketInfo[] | null;
  probability_change: number | null;
  affected_stocks: string[] | null;
  urgency: string | null;
  signal_type: string | null;
  signal_direction: string | null;
  confidence: number | null;
  thematic_buckets: string[] | null;
  is_ahead_of_curve: boolean | null;
};

/**
 * Format a USD volume figure as a compact human-readable string.
 * Examples: 2_300_000 → "$2.3M", 50_000 → "$50K", 800 → "$800".
 * Used to signal market credibility (thin markets = noise).
 */
function formatVolume(volume: number): string {
  if (volume >= 1_000_000) return `$${(volume / 1_000_000).toFixed(1)}M`;
  if (volume >= 1_000) return `$${(volume / 1_000).toFixed(0)}K`;
  return `$${volume.toFixed(0)}`;
}

function calculateSignificance(signal: SignalRow): number {
  // Urgency weight (high=3, medium=2, low=1)
  const urgencyScore = signal.urgency === 'high' ? 3 :
                       signal.urgency === 'medium' ? 2 : 1;

  // Conviction weight: how extreme the probability is (closer to 0% or 100% = stronger)
  const m = Array.isArray(signal.markets) ? signal.markets[0] : signal.markets;
  const probability = m?.probability || 0.5;
  const conviction = Math.abs(probability - 0.5) * 2; // 0 to 1

  // Volume credibility (log scale, 0 to 1)
  const volume = m?.volume || 0;
  const volumeScore = Math.min(Math.log10(volume + 1) / 7, 1);

  // Probability change (movement is signal, 0 to 2)
  const change = Math.abs(signal.probability_change || 0);
  const changeScore = Math.min(change * 3, 2);

  // Confidence from the LLM (0 to 1)
  const confidence = signal.confidence || 0.5;

  // Weighted sum: urgency is most important, then conviction and confidence
  return (urgencyScore * 2) + (conviction * 2) + volumeScore + changeScore + confidence;
}

async function runPipeline(onStep: (status: PipelineStatus, msg: string) => void) {
  onStep('ingesting', 'Step 1/3 — Ingesting markets...');
  const ingestRes = await fetch('/api/ingest', { method: 'POST' });
  const ingestData = await ingestRes.json();
  if (!ingestData.success) throw new Error(ingestData.error ?? 'Ingest failed');

  onStep('analyzing', `Step 2/3 — Analyzing ${ingestData.count} markets with LLM...`);
  const sensitivity = (typeof window !== 'undefined' ? localStorage.getItem('filter_sensitivity') : null) ?? 'balanced';
  const analyzeRes = await fetch(`/api/analyze?sensitivity=${sensitivity}`, { method: 'POST' });
  const analyzeData = await analyzeRes.json();
  if (!analyzeData.success) throw new Error(analyzeData.error ?? 'Analyze failed');

  if (analyzeData.relevant > 0) {
    onStep('reporting', `Step 3/3 — Generating report for ${analyzeData.relevant} relevant signals...`);
    const reportRes = await fetch('/api/report', { method: 'POST' });
    const reportData = await reportRes.json();
    if (!reportData.success && !reportData.id) throw new Error(reportData.error ?? 'Report failed');
  }

  onStep('done', `Done — ${ingestData.count} markets ingested, ${analyzeData.analyzed} analyzed, ${analyzeData.relevant} relevant signals found.`);
}

export default function Dashboard() {
  const [metrics, setMetrics] = useState<{
    totalScanned: number;
    relevantFound: number;
    highUrgency: number;
    marketsMoving: number;
    /** ISO string of the most recent signal, or null. Formatted on render so
     *  the relative time stays fresh as the page sits open. */
    lastUpdatedAt: string | null;
  }>({
    totalScanned: 0,
    relevantFound: 0,
    highUrgency: 0,
    marketsMoving: 0,
    lastUpdatedAt: null,
  });
  // Tick state: bumped every 30s so any formatRelativeTime() call below
  // re-renders with fresh "Xm ago" output without re-fetching data.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const [topSignals, setTopSignals] = useState<SignalRow[]>([]);
  // Bucket aggregates for the "Thematic Exposure Today" section. Computed
  // from ALL relevant signals, not just the top 5 in the table above.
  const [thematicStats, setThematicStats] = useState<Record<ThematicBucket, BucketStats>>(
    () => Object.fromEntries(
      THEMATIC_BUCKETS.map((b) => [b, { count: 0, positive: 0, negative: 0 }])
    ) as Record<ThematicBucket, BucketStats>
  );
  const [loading, setLoading] = useState(true);
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus>('idle');
  const [pipelineMessage, setPipelineMessage] = useState('');
  const [schedulerInfo, setSchedulerInfo] = useState<{
    schedule: string;
    next_run: string | null;
    last_run: string | null;
  }>({ schedule: 'Every 6 hours', next_run: null, last_run: null });

  useEffect(() => {
    fetch('/api/scheduler')
      .then(r => r.json())
      .then(data => setSchedulerInfo({
        schedule: data.schedule ?? 'Every 6 hours',
        next_run: data.next_run ?? null,
        last_run: data.last_run ?? null,
      }))
      .catch(() => {});
  }, []);

  useEffect(() => {
    async function fetchData() {
      // Fetch metrics
      const { count: totalScanned } = await supabase.from('markets').select('*', { count: 'exact', head: true });
      const { count: relevantFound } = await supabase.from('signals').select('*', { count: 'exact', head: true }).eq('is_relevant', true);
      const { count: highUrgency } = await supabase.from('signals').select('*', { count: 'exact', head: true }).eq('urgency', 'high');

      // Count markets moving significantly (>10pp change in either direction).
      // NOTE: with `head: true` the response `data` is null — we MUST use `count`.
      const { count: movingUpCount } = await supabase
        .from('signals')
        .select('*', { count: 'exact', head: true })
        .eq('is_relevant', true)
        .gt('probability_change', 0.10);
      const { count: movingDownCount } = await supabase
        .from('signals')
        .select('*', { count: 'exact', head: true })
        .eq('is_relevant', true)
        .lt('probability_change', -0.10);
      const movingCount = (movingUpCount ?? 0) + (movingDownCount ?? 0);

      const { data: latestSignal } = await supabase.from('signals').select('analyzed_at').order('analyzed_at', { ascending: false }).limit(1);

      setMetrics({
        totalScanned: totalScanned || 0,
        relevantFound: relevantFound || 0,
        highUrgency: highUrgency || 0,
        marketsMoving: movingCount,
        lastUpdatedAt: latestSignal?.[0]?.analyzed_at ?? null,
      });

      // Fetch Top Signals — get relevant signals and sort by significance score
      const { data: top } = await supabase
        .from('signals')
        .select('*, markets(id, question, probability, volume, slug, market_url)')
        .eq('is_relevant', true)
        .order('analyzed_at', { ascending: false })
        .limit(20); // Fetch more, sort by significance

      if (top) {
        const signals = top as unknown as SignalRow[];
        const sorted = [...signals]
          .sort((a, b) => calculateSignificance(b) - calculateSignificance(a))
          .slice(0, 5); // Take top 5 by significance
        setTopSignals(sorted);
      }

      // Fetch ALL relevant signals (just the bucket + direction columns) for
      // the "Thematic Exposure Today" aggregation. Separate query because we
      // want every relevant signal, not just the top 20.
      const { data: bucketRows } = await supabase
        .from('signals')
        .select('thematic_buckets, signal_direction')
        .eq('is_relevant', true);

      if (bucketRows) {
        const stats = Object.fromEntries(
          THEMATIC_BUCKETS.map((b) => [b, { count: 0, positive: 0, negative: 0 }])
        ) as Record<ThematicBucket, BucketStats>;

        for (const row of bucketRows as Array<{
          thematic_buckets: string[] | null;
          signal_direction: string | null;
        }>) {
          if (!Array.isArray(row.thematic_buckets)) continue;
          const direction = classifyDirection(row.signal_direction);
          for (const bucket of row.thematic_buckets) {
            if (!THEMATIC_BUCKETS.includes(bucket as ThematicBucket)) continue;
            const b = bucket as ThematicBucket;
            stats[b].count += 1;
            if (direction === 'positive') stats[b].positive += 1;
            if (direction === 'negative') stats[b].negative += 1;
          }
        }
        setThematicStats(stats);
      }

      setLoading(false);
    }
    fetchData();
  }, []);

  if (loading) {
    return <div className="animate-pulse text-[#9ca3af]">Loading dashboard...</div>;
  }

  async function handleRunPipeline() {
    setPipelineStatus('ingesting');
    setPipelineMessage('Starting pipeline...');
    try {
      await runPipeline((status, msg) => {
        setPipelineStatus(status);
        setPipelineMessage(msg);
      });
    } catch (err) {
      setPipelineStatus('error');
      setPipelineMessage(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white tracking-tight">Morning Briefing</h2>
        <div className="flex flex-col items-end gap-2">
          <button
            onClick={handleRunPipeline}
            disabled={['ingesting', 'analyzing', 'reporting'].includes(pipelineStatus)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#3b82f6] hover:bg-[#2563eb] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
          >
            {['ingesting', 'analyzing', 'reporting'].includes(pipelineStatus) ? (
              <>
                <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Running…
              </>
            ) : (
              <>▶ Run Pipeline Now</>
            )}
          </button>
          {pipelineMessage && (
            <p className={`text-xs max-w-xs text-right ${
              pipelineStatus === 'error' ? 'text-[#ef4444]' :
              pipelineStatus === 'done'  ? 'text-[#10b981]' :
              'text-[#9ca3af]'
            }`}>
              {pipelineMessage}
            </p>
          )}
          <div className="text-xs text-[#6b7280] text-right space-y-0.5">
            <p>🕐 <span className="text-[#9ca3af]">{schedulerInfo.schedule}</span></p>
            <p>Last run:{' '}
              <span className="text-[#9ca3af]">
                {schedulerInfo.last_run
                  ? new Date(schedulerInfo.last_run).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                  : 'Not yet'}
              </span>
            </p>
            <p>Next run:{' '}
              <span className="text-[#10b981]">
                {schedulerInfo.next_run
                  ? new Date(schedulerInfo.next_run).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                  : '—'}
              </span>
            </p>
          </div>
        </div>
      </div>

      {metrics.totalScanned === 0 ? (
        // First-run empty state — no markets ingested yet
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-[#3b82f6]/10 flex items-center justify-center mb-4">
            {/* Lucide `radio` glyph — radar/scan vibe */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#3b82f6"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" />
              <path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5" />
              <circle cx="12" cy="12" r="2" />
              <path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5" />
              <path d="M19.1 4.9C23 8.8 23 15.1 19.1 19" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">
            Welcome to BIT Capital Signal Scanner
          </h2>
          <p className="text-[#9ca3af] max-w-md mb-6">
            Run your first pipeline to scan Polymarket prediction markets and identify
            equity-relevant signals for the BIT Capital portfolio.
          </p>
          <button
            onClick={handleRunPipeline}
            disabled={['ingesting', 'analyzing', 'reporting'].includes(pipelineStatus)}
            className="bg-[#3b82f6] hover:bg-[#2563eb] disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-3 rounded-lg font-medium transition-colors"
          >
            {['ingesting', 'analyzing', 'reporting'].includes(pipelineStatus)
              ? 'Running…'
              : '▶ Run Your First Pipeline'}
          </button>
          <p className="text-[#6b7280] text-sm mt-4">
            Takes about 30 seconds. Will fetch ~100 markets and analyze them with the LLM.
          </p>
        </div>
      ) : (
        <>
      {/* Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {/* 1. Total Markets Scanned */}
        <div className="bg-[#111827] border border-[#1f2937] p-5 rounded-xl shadow-sm">
          <h3 className="text-sm font-medium text-[#9ca3af] mb-1">Total Markets Scanned</h3>
          <p className="font-bold text-3xl text-white">{metrics.totalScanned}</p>
        </div>
        {/* 2. Relevant Signals Found */}
        <div className="bg-[#111827] border border-[#1f2937] p-5 rounded-xl shadow-sm">
          <h3 className="text-sm font-medium text-[#9ca3af] mb-1">Relevant Signals Found</h3>
          <p className="font-bold text-3xl text-[#10b981]">{metrics.relevantFound}</p>
        </div>
        {/* 3. High Urgency Signals */}
        <div className="bg-[#111827] border border-[#1f2937] p-5 rounded-xl shadow-sm">
          <h3 className="text-sm font-medium text-[#9ca3af] mb-1">High Urgency Signals</h3>
          <p className="font-bold text-3xl text-[#ef4444]">{metrics.highUrgency}</p>
        </div>
        {/* 4. Markets Moving Today — special handling for the no-data-yet case */}
        <div className="bg-[#111827] border border-[#1f2937] p-5 rounded-xl shadow-sm">
          <h3 className="text-sm font-medium text-[#9ca3af] mb-1 flex items-center gap-1.5">
            Markets Moving Today
            <span
              title="Markets where probability has changed by more than 10 percentage points in the last 24 hours."
              className="cursor-help text-[#6b7280] hover:text-[#9ca3af] transition-colors"
              aria-label="What counts as a moving market?"
            >
              {/* lucide `info` */}
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
            </span>
          </h3>
          {metrics.marketsMoving > 0 ? (
            <p className="font-bold text-3xl text-[#f59e0b]">{metrics.marketsMoving}</p>
          ) : (
            <>
              <p className="font-bold text-3xl text-[#6b7280]">—</p>
              <p className="text-xs text-[#6b7280] mt-1">Tracking begins after 2nd run</p>
            </>
          )}
        </div>
        {/* 5. Last Updated — relative time, full timestamp on hover, auto-refreshes every 30s */}
        <div className="bg-[#111827] border border-[#1f2937] p-5 rounded-xl shadow-sm">
          <h3 className="text-sm font-medium text-[#9ca3af] mb-1">Last Updated</h3>
          {metrics.lastUpdatedAt ? (
            <p
              className="font-bold text-lg text-white"
              title={formatFullTimestamp(metrics.lastUpdatedAt)}
            >
              {formatRelativeTime(metrics.lastUpdatedAt)}
            </p>
          ) : (
            <p className="font-bold text-lg text-[#6b7280]">Never</p>
          )}
        </div>
      </div>

      {/* Top Signals Table */}
      <div className="bg-[#111827] border border-[#1f2937] rounded-xl shadow-sm overflow-hidden">
        <div className="p-5 border-b border-[#1f2937]">
          <h3 className="text-lg font-semibold text-white">Top Signals Today</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-[#9ca3af]">
            <thead className="bg-[#0a0f1e] text-[#9ca3af] uppercase font-semibold text-xs border-b border-[#1f2937]">
              <tr>
                <th className="px-6 py-4">Market Question</th>
                <th className="px-6 py-4">Probability (24H)</th>
                <th className="px-6 py-4">Affected Stocks</th>
                <th className="px-6 py-4">Direction</th>
                <th className="px-6 py-4">Urgency</th>
                <th className="px-6 py-4">Signal Type</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1f2937]">
              {topSignals.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center">No highly relevant signals found.</td>
                </tr>
              ) : (
                topSignals.map((s) => {
                  const m = Array.isArray(s.markets) ? s.markets[0] : s.markets;
                  const prob = (m?.probability || 0) * 100;
                  const volume = m?.volume || 0;
                  const volumeLabel = formatVolume(volume);
                  const marketUrl = resolveMarketUrl(m);

                  return (
                    <tr key={s.id} className="transition-colors duration-150 hover:bg-slate-800/50">
                      <td className="px-6 py-4 max-w-md">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-white truncate" title={m?.question}>{m?.question}</span>
                          {marketUrl && <MarketLinkIcon url={marketUrl} />}
                          <AheadOfCurveBadge flagged={s.is_ahead_of_curve} />
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-semibold text-white">{prob.toFixed(1)}%</span>
                            <div className="w-16 h-1.5 bg-[#1f2937] rounded-full overflow-hidden">
                              <div className="h-full bg-[#3b82f6]" style={{ width: `${prob}%` }}></div>
                            </div>
                          </div>
                          <ProbChangeBadge change={s.probability_change} />
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-2">
                          <div className="flex flex-wrap gap-1">
                            {s.affected_stocks?.slice(0, 3).map((stock) => (
                              <span key={stock} className="px-2 py-0.5 rounded-full bg-[#3b82f6]/20 text-[#3b82f6] text-xs font-medium">
                                {stock}
                              </span>
                            ))}
                            {(s.affected_stocks?.length ?? 0) > 3 && (
                              <span className="text-xs text-[#9ca3af]">+{(s.affected_stocks?.length ?? 0) - 3}</span>
                            )}
                          </div>
                          <span className="text-xs text-[#6b7280]">{volumeLabel} volume</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <DirectionBadge direction={s.signal_direction} />
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${
                          s.urgency === 'high' ? 'bg-[#ef4444]/20 text-[#ef4444]' :
                          s.urgency === 'medium' ? 'bg-[#f59e0b]/20 text-[#f59e0b]' :
                          'bg-[#374151] text-gray-300'
                        }`}>
                          {s.urgency}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="capitalize text-gray-300">{s.signal_type || '—'}</span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Thematic Exposure Today — net direction per BIT Capital bucket */}
      <div className="bg-[#111827] border border-[#1f2937] rounded-xl shadow-sm p-6">
        <div className="flex items-baseline justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Thematic Exposure Today</h3>
          <span className="text-xs text-[#6b7280]">
            Net direction across BIT Capital portfolio buckets
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {THEMATIC_BUCKETS.map((bucket) => {
            const stats = thematicStats[bucket];
            const meta = netDirectionLabel(stats);
            return (
              <div
                key={bucket}
                className={`bg-[#0a0f1e] border-l-4 ${meta.border} border-y border-r border-[#1f2937] rounded-lg p-3 transition-colors`}
              >
                <h4 className="text-sm font-semibold text-white">{bucket}</h4>
                <p className="text-xs text-[#9ca3af] mt-0.5">
                  {stats.count} {stats.count === 1 ? 'signal' : 'signals'}
                </p>
                <p className={`text-xs font-medium mt-1.5 ${meta.text}`}>{meta.label}</p>
              </div>
            );
          })}
        </div>
      </div>
        </>
      )}
    </div>
  );
}
