'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { DirectionBadge } from '@/components/DirectionBadge';
import { ProbChangeBadge } from '@/components/ProbChangeBadge';
import { MarketLinkIcon, resolveMarketUrl } from '@/components/MarketLink';
import { AheadOfCurveBadge } from '@/components/AheadOfCurveBadge';
import { AheadOfCurveTooltipContent, Delta24HTooltipContent, SignalTooltip } from '@/components/SignalTooltip';
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
type LastPipelineRunStatus = 'running' | 'completed' | 'error';

type LastPipelineRun = {
  status: LastPipelineRunStatus;
  ingested: number;
  analyzed: number;
  newRelevant: number;
  totalRelevant: number;
  completedAt: string;
  message: string;
};

type PipelineRunCounts = Pick<LastPipelineRun, 'ingested' | 'analyzed' | 'newRelevant' | 'totalRelevant'>;
type PipelineRunResult = PipelineRunCounts & { message: string };

type MarketInfo = {
  id?: string;
  question: string;
  probability: number;
  probability_24h_ago?: number | string | null;
  volume: number;
  end_date?: string | null;
  slug?: string | null;
  market_url?: string | null;
  fetched_at?: string | null;
  last_updated_at?: string | null;
};

type SignalRow = {
  id: string;
  markets: MarketInfo | MarketInfo[] | null;
  probability_change: number | null;
  is_moving: boolean | null;
  affected_stocks: string[] | null;
  urgency: string | null;
  signal_type: string | null;
  signal_direction: string | null;
  confidence: number | null;
  thematic_buckets: string[] | null;
  is_ahead_of_curve: boolean | null;
};

const MIN_ACTIONABLE_PROBABILITY = 0.05;
const MAX_ACTIONABLE_PROBABILITY = 0.95;
const RESOLVED_LOW_PROBABILITY = 0.03;
const RESOLVED_HIGH_PROBABILITY = 0.97;
const CONTESTED_LOW_PROBABILITY = 0.25;
const CONTESTED_HIGH_PROBABILITY = 0.75;
const LAST_PIPELINE_RUN_KEY = 'lastPipelineRun';
const PIPELINE_STEP_ESTIMATES: Record<Extract<PipelineStatus, 'ingesting' | 'analyzing' | 'reporting'>, number> = {
  ingesting: 10,
  analyzing: 30,
  reporting: 10,
};
function getSignalMarket(signal: SignalRow): MarketInfo | null {
  return Array.isArray(signal.markets) ? signal.markets[0] ?? null : signal.markets;
}

function getMarketFreshnessAt(market: MarketInfo | null): string | null {
  return market?.last_updated_at ?? market?.fetched_at ?? null;
}

function MarketFreshness({ market }: { market: MarketInfo | null }) {
  const timestamp = getMarketFreshnessAt(market);
  if (!timestamp) return null;

  return (
    <span title={formatFullTimestamp(timestamp)} className="text-xs text-[#6b7280] whitespace-nowrap">
      as of {formatRelativeTime(timestamp)}
    </span>
  );
}

function isMissingFreshnessColumn(error: { message?: string } | null) {
  return Boolean(error?.message?.includes('last_updated_at'));
}

function getAheadOfCurveMovement(signal: SignalRow): number {
  const market = getSignalMarket(signal);
  const probability = Number(market?.probability);
  const prior = Number(market?.probability_24h_ago);

  if (Number.isFinite(probability) && Number.isFinite(prior)) {
    return Math.abs(probability - prior);
  }

  return Math.abs(signal.probability_change ?? 0);
}

function hasExpired(endDate: string | null | undefined, now = Date.now()): boolean {
  if (!endDate) return false;
  const expiry = new Date(endDate).getTime();
  return Number.isFinite(expiry) && expiry < now;
}

function isActionableTopSignal(signal: SignalRow, now = Date.now()): boolean {
  const market = getSignalMarket(signal);
  const probability = market?.probability;
  if (typeof probability !== 'number' || !Number.isFinite(probability)) return false;
  if (probability <= RESOLVED_LOW_PROBABILITY || probability >= RESOLVED_HIGH_PROBABILITY) return false;
  if (probability <= MIN_ACTIONABLE_PROBABILITY || probability >= MAX_ACTIONABLE_PROBABILITY) return false;
  return !hasExpired(market?.end_date, now);
}

function contestedProbabilityScore(probability: number): number {
  if (probability >= CONTESTED_LOW_PROBABILITY && probability <= CONTESTED_HIGH_PROBABILITY) {
    const centeredness = 1 - Math.abs(probability - 0.5) / (CONTESTED_HIGH_PROBABILITY - 0.5);
    return 1 + centeredness; // 1 at 25%/75%, 2 at 50%.
  }

  const distanceToContestedRange = probability < CONTESTED_LOW_PROBABILITY
    ? CONTESTED_LOW_PROBABILITY - probability
    : probability - CONTESTED_HIGH_PROBABILITY;
  const actionableEdgeWidth = CONTESTED_LOW_PROBABILITY - MIN_ACTIONABLE_PROBABILITY;
  return Math.max(0, 1 - distanceToContestedRange / actionableEdgeWidth);
}

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

function formatProbabilityDelta(change: number | null | undefined): {
  label: string;
  className: string;
} {
  if (change == null || !Number.isFinite(change)) {
    return { label: '-', className: 'text-[#6b7280]' };
  }

  const isUp = change >= 0;
  const sign = change > 0 ? '+' : change < 0 ? '-' : '';
  return {
    label: `${isUp ? '↑' : '↓'} ${sign}${Math.round(Math.abs(change) * 100)}pp`,
    className: isUp ? 'text-[#10b981]' : 'text-[#ef4444]',
  };
}

function calculateSignificance(signal: SignalRow): number {
  // Urgency weight (high=3, medium=2, low=1)
  const urgencyScore = signal.urgency === 'high' ? 3 :
                       signal.urgency === 'medium' ? 2 : 1;

  // Contested markets are more actionable than near-settled 0%/100% markets.
  const m = getSignalMarket(signal);
  const probability = m?.probability ?? 0.5;
  const probabilityScore = contestedProbabilityScore(probability);

  // Volume credibility (log scale, 0 to 1)
  const volume = m?.volume || 0;
  const volumeScore = Math.min(Math.log10(volume + 1) / 7, 1);

  // Probability change (movement is signal, 0 to 2)
  const change = Math.abs(signal.probability_change || 0);
  const changeScore = Math.min(change * 3, 2);

  // Confidence from the LLM (0 to 1)
  const confidence = signal.confidence || 0.5;

  // Weighted sum: urgency and active uncertainty matter most.
  return (urgencyScore * 2) + (probabilityScore * 3) + volumeScore + changeScore + confidence;
}

function formatNewMarketCount(count: number): string {
  return `${count} new ${count === 1 ? 'market' : 'markets'}`;
}

function formatNewRelevantSignalCount(count: number): string {
  return `${count} new relevant ${count === 1 ? 'signal' : 'signals'}`;
}

function formatTotalRelevantSignalCount(count: number): string {
  return `${count} relevant ${count === 1 ? 'signal' : 'signals'}`;
}

function isActivePipelineStatus(status: PipelineStatus): boolean {
  return ['ingesting', 'analyzing', 'reporting'].includes(status);
}

function toLastPipelineRunStatus(status: PipelineStatus): LastPipelineRunStatus {
  if (status === 'error') return 'error';
  if (status === 'done') return 'completed';
  return 'running';
}

function readLastPipelineRun(): LastPipelineRun | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = localStorage.getItem(LAST_PIPELINE_RUN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastPipelineRun>;
    if (!parsed.message || !parsed.completedAt) return null;
    if (!['running', 'completed', 'error'].includes(String(parsed.status))) return null;

    return {
      status: parsed.status as LastPipelineRunStatus,
      ingested: Number(parsed.ingested ?? 0),
      analyzed: Number(parsed.analyzed ?? 0),
      newRelevant: Number(parsed.newRelevant ?? 0),
      totalRelevant: Number(parsed.totalRelevant ?? 0),
      completedAt: parsed.completedAt,
      message: parsed.message,
    };
  } catch {
    return null;
  }
}

function saveLastPipelineRun(run: LastPipelineRun): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LAST_PIPELINE_RUN_KEY, JSON.stringify(run));
}

function getPipelineEstimateSeconds(status: PipelineStatus): number {
  if (status === 'ingesting' || status === 'analyzing' || status === 'reporting') {
    return PIPELINE_STEP_ESTIMATES[status];
  }
  return 0;
}

function formatPipelineProgressMessage(status: PipelineStatus, secondsRemaining: number): string {
  const seconds = Math.max(0, secondsRemaining);
  if (status === 'ingesting') return `Step 1/3 — Fetching from Polymarket... ~${seconds}s`;
  if (status === 'analyzing') return `Step 2/3 — Analyzing with LLM... ~${seconds}s remaining`;
  if (status === 'reporting') return `Step 3/3 — Almost done... ~${seconds}s`;
  return '';
}

function getPipelineProgressPercent(status: PipelineStatus): number {
  if (status === 'ingesting') return 8;
  if (status === 'analyzing') return 40;
  if (status === 'reporting') return 75;
  if (status === 'done') return 100;
  return 0;
}

function formatDuration(seconds: number): string {
  const rounded = Math.max(1, Math.round(seconds));
  return `${rounded} ${rounded === 1 ? 'second' : 'seconds'}`;
}

function formatPipelineCompletionMessage(result: PipelineRunResult, elapsedSeconds: number): string {
  const elapsed = formatDuration(elapsedSeconds);
  const analyzedMarketText = formatNewMarketCount(result.analyzed);

  if (result.newRelevant === 0) {
    return `Done in ${elapsed} — Analyzed ${analyzedMarketText}, no new relevant signals found. Database holds ${result.totalRelevant} total relevant ${result.totalRelevant === 1 ? 'signal' : 'signals'}.`;
  }

  return `Done in ${elapsed} — Analyzed ${analyzedMarketText} this run, ${formatNewRelevantSignalCount(result.newRelevant)} added. Total: ${formatTotalRelevantSignalCount(result.totalRelevant)} in database.`;
}

async function runPipeline(
  onStep: (status: PipelineStatus, msg: string, counts?: Partial<PipelineRunCounts>) => void
): Promise<PipelineRunResult> {
  onStep('ingesting', 'Step 1/3 - Fetching fresh Polymarket data...');
  onStep('analyzing', 'Step 2/3 - Analyzing new and recently changed markets...');

  const pipelineRes = await fetch('/api/pipeline', { method: 'POST', cache: 'no-store' });
  const pipelineData = await pipelineRes.json();
  if (!pipelineData.success) throw new Error(pipelineData.error ?? 'Pipeline failed');

  const ingested = Number(pipelineData.markets_ingested ?? 0);
  const analyzed = Number(pipelineData.markets_analyzed ?? 0);
  const newRelevant = Number(pipelineData.relevant_signals ?? 0);

  onStep('reporting', 'Step 3/3 - Generating fresh morning briefing...', {
    ingested,
    analyzed,
    newRelevant,
  });

  const { count: totalRelevantCount, error: totalRelevantError } = await supabase
    .from('signals')
    .select('*', { count: 'exact', head: true })
    .eq('is_relevant', true);
  if (totalRelevantError) throw new Error(totalRelevantError.message);

  const totalRelevant = totalRelevantCount ?? 0;
  const analyzedMarketText = formatNewMarketCount(analyzed);
  const message =
    newRelevant === 0
      ? `Done - Analyzed ${analyzedMarketText}, no new relevant signals found. Database holds ${totalRelevant} total relevant ${totalRelevant === 1 ? 'signal' : 'signals'}.`
      : `Done - Analyzed ${analyzedMarketText} this run, ${formatNewRelevantSignalCount(newRelevant)} added. Total: ${formatTotalRelevantSignalCount(totalRelevant)} in database.`;

  onStep('done', message, { ingested, analyzed, newRelevant, totalRelevant });

  return {
    ingested,
    analyzed,
    newRelevant,
    totalRelevant,
    message,
  };
}

export default function Dashboard() {
  const [metrics, setMetrics] = useState<{
    totalScanned: number;
    relevantFound: number;
    highUrgency: number;
    /** ISO string of the most recent signal, or null. Formatted on render so
     *  the relative time stays fresh as the page sits open. */
    lastUpdatedAt: string | null;
  }>({
    totalScanned: 0,
    relevantFound: 0,
    highUrgency: 0,
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
  const [aheadOfCurveSignals, setAheadOfCurveSignals] = useState<SignalRow[]>([]);
  // Bucket aggregates for the "Thematic Exposure Today" section. Computed
  // from ALL relevant signals, not just the top 5 in the table above.
  const [thematicStats, setThematicStats] = useState<Record<ThematicBucket, BucketStats>>(
    () => Object.fromEntries(
      THEMATIC_BUCKETS.map((b) => [b, { count: 0, positive: 0, negative: 0 }])
    ) as Record<ThematicBucket, BucketStats>
  );
  const [loading, setLoading] = useState(true);
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus>('idle');
  const [secondsRemaining, setSecondsRemaining] = useState(60);
  const [lastPipelineRun, setLastPipelineRun] = useState<LastPipelineRun | null>(null);
  const [schedulerInfo, setSchedulerInfo] = useState<{
    schedule: string;
    next_run: string | null;
    last_run: string | null;
  }>({ schedule: 'Every 6 hours', next_run: null, last_run: null });

  useEffect(() => {
    setLastPipelineRun(readLastPipelineRun());
  }, []);

  useEffect(() => {
    if (!isActivePipelineStatus(pipelineStatus)) return;
    const id = setInterval(() => {
      setSecondsRemaining((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [pipelineStatus]);

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
      const relevantCountRes = await fetch(`/api/signals/count?t=${Date.now()}`, { cache: 'no-store' });
      const relevantCountData = await relevantCountRes.json();
      if (!relevantCountData.success) throw new Error(relevantCountData.error ?? 'Relevant count failed');
      const { count: highUrgency } = await supabase.from('signals').select('*', { count: 'exact', head: true }).eq('urgency', 'high');

      // NOTE: "Markets Moving Today" metric was removed — probability_change /
      // is_moving detection isn't reliable across ingest cycles yet. The
      // columns remain in the schema; revisit post-launch.

      const { data: latestSignal } = await supabase.from('signals').select('analyzed_at').order('analyzed_at', { ascending: false }).limit(1);

      setMetrics({
        totalScanned: totalScanned || 0,
        relevantFound: Number(relevantCountData.count ?? 0),
        highUrgency: highUrgency || 0,
        lastUpdatedAt: latestSignal?.[0]?.analyzed_at ?? null,
      });

      // Fetch Top Signals — get relevant signals and sort by significance score
      let { data: top, error: topError } = await supabase
        .from('signals')
        .select('*, markets(id, question, probability, volume, end_date, slug, market_url, last_updated_at, fetched_at)')
        .eq('is_relevant', true)
        .order('analyzed_at', { ascending: false })
        .limit(100); // Fetch more because near-settled/expired markets are filtered client-side.

      if (isMissingFreshnessColumn(topError)) {
        const fallback = await supabase
          .from('signals')
          .select('*, markets(id, question, probability, volume, end_date, slug, market_url, fetched_at)')
          .eq('is_relevant', true)
          .order('analyzed_at', { ascending: false })
          .limit(100);
        top = fallback.data;
        topError = fallback.error;
      }

      if (topError) console.error('[Dashboard] Top signals fetch error:', topError.message);

      if (top) {
        const signals = top as unknown as SignalRow[];
        const now = Date.now();
        const sorted = [...signals]
          .filter((signal) => isActionableTopSignal(signal, now))
          .sort((a, b) => calculateSignificance(b) - calculateSignificance(a))
          .slice(0, 5); // Take top 5 by significance
        setTopSignals(sorted);
      }

      let { data: aheadRows, error: aheadError } = await supabase
        .from('signals')
        .select('*, markets(id, question, probability, probability_24h_ago, volume, end_date, slug, market_url, last_updated_at, fetched_at)')
        .eq('is_ahead_of_curve', true)
        .limit(500);

      if (isMissingFreshnessColumn(aheadError)) {
        const fallback = await supabase
          .from('signals')
          .select('*, markets(id, question, probability, probability_24h_ago, volume, end_date, slug, market_url, fetched_at)')
          .eq('is_ahead_of_curve', true)
          .limit(500);
        aheadRows = fallback.data;
        aheadError = fallback.error;
      }

      if (aheadError) console.error('[Dashboard] Ahead-of-curve fetch error:', aheadError.message);

      if (aheadRows) {
        const sorted = [...(aheadRows as unknown as SignalRow[])]
          .sort((a, b) => getAheadOfCurveMovement(b) - getAheadOfCurveMovement(a))
          .slice(0, 5);
        setAheadOfCurveSignals(sorted);
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
    if (typeof window !== 'undefined') {
      localStorage.removeItem(LAST_PIPELINE_RUN_KEY);
    }

    const startedAt = Date.now();
    const initialEstimate = getPipelineEstimateSeconds('ingesting');
    const initialMessage = formatPipelineProgressMessage('ingesting', initialEstimate);
    let persistedRun: LastPipelineRun = {
      status: 'running',
      ingested: 0,
      analyzed: 0,
      newRelevant: 0,
      totalRelevant: 0,
      completedAt: new Date().toISOString(),
      message: initialMessage,
    };

    const persistRun = (run: LastPipelineRun) => {
      persistedRun = run;
      saveLastPipelineRun(run);
      setLastPipelineRun(run);
    };

    setPipelineStatus('ingesting');
    setSecondsRemaining(initialEstimate);
    persistRun(persistedRun);

    try {
      const result = await runPipeline((status, msg, counts) => {
        const estimate = getPipelineEstimateSeconds(status);
        const message = isActivePipelineStatus(status)
          ? formatPipelineProgressMessage(status, estimate)
          : msg;

        if (isActivePipelineStatus(status)) {
          setSecondsRemaining(estimate);
        }

        setPipelineStatus(status);
        persistRun({
          ...persistedRun,
          ...counts,
          status: toLastPipelineRunStatus(status),
          completedAt: new Date().toISOString(),
          message,
        });
      });
      const elapsedSeconds = (Date.now() - startedAt) / 1000;
      const completionMessage = formatPipelineCompletionMessage(result, elapsedSeconds);
      const completedRun: LastPipelineRun = {
        status: 'completed',
        ingested: result.ingested,
        analyzed: result.analyzed,
        newRelevant: result.newRelevant,
        totalRelevant: result.totalRelevant,
        completedAt: new Date().toISOString(),
        message: completionMessage,
      };
      setSecondsRemaining(0);
      setPipelineStatus('done');
      persistRun(completedRun);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      const errorRun: LastPipelineRun = {
        ...persistedRun,
        status: 'error',
        completedAt: new Date().toISOString(),
        message,
      };
      setPipelineStatus('error');
      setSecondsRemaining(0);
      persistRun(errorRun);
    }
  }

  const isPipelineRunning = isActivePipelineStatus(pipelineStatus);
  const bannerStatus = isPipelineRunning ? 'running' : lastPipelineRun?.status;
  const bannerMessage = isPipelineRunning
    ? formatPipelineProgressMessage(pipelineStatus, secondsRemaining)
    : lastPipelineRun?.message;
  const pipelineProgress = getPipelineProgressPercent(pipelineStatus);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white tracking-tight">Morning Briefing</h2>
        <div className="flex flex-col items-end gap-2">
          <button
            onClick={handleRunPipeline}
            disabled={isPipelineRunning}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#3b82f6] hover:bg-[#2563eb] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
          >
            {isPipelineRunning ? (
              <>
                <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Running…
              </>
            ) : (
              <>▶ Run Pipeline Now</>
            )}
          </button>
          {bannerMessage && (isPipelineRunning || lastPipelineRun) && (
            <div className={`text-xs max-w-xs text-right ${
              bannerStatus === 'error' ? 'text-[#ef4444]' :
              bannerStatus === 'completed' ? 'text-[#10b981]' :
              'text-[#9ca3af]'
            }`}>
              <p>{bannerMessage}</p>
              {isPipelineRunning && (
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#1f2937]">
                  <div
                    className="h-full rounded-full bg-[#3b82f6] transition-all duration-500"
                    style={{ width: `${pipelineProgress}%` }}
                  />
                </div>
              )}
              {!isPipelineRunning && lastPipelineRun && (
                <p className="mt-0.5 text-[#6b7280]">
                  Last pipeline ran {formatRelativeTime(lastPipelineRun.completedAt)}
                </p>
              )}
            </div>
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
            disabled={isPipelineRunning}
            className="bg-[#3b82f6] hover:bg-[#2563eb] disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-3 rounded-lg font-medium transition-colors"
          >
            {isPipelineRunning
              ? 'Running…'
              : '▶ Run Your First Pipeline'}
          </button>
          <p className="text-[#6b7280] text-sm mt-4">
            Takes about 30 seconds. Will fetch ~100 markets and analyze them with the LLM.
          </p>
        </div>
      ) : (
        <>
      {/* Metrics Row — "Markets Moving Today" removed pending reliable
          probability-change detection across ingest cycles. */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
        {/* 4. Last Updated — relative time, full timestamp on hover, auto-refreshes every 30s */}
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
                  <td colSpan={6} className="px-6 py-8 text-center">No actionable unresolved signals found.</td>
                </tr>
              ) : (
                topSignals.map((s) => {
                  const m = getSignalMarket(s);
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
                          <AheadOfCurveBadge flagged={Boolean(s.is_ahead_of_curve)} />
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-semibold text-white">{prob.toFixed(1)}%</span>
                            <MarketFreshness market={m} />
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

      {/* Ahead of Curve Today */}
      <div className="bg-[#111827] border border-[#1f2937] rounded-xl shadow-sm overflow-hidden">
        <div className="p-5 border-b border-[#1f2937] flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-white">
              <SignalTooltip content={<AheadOfCurveTooltipContent />}>
                <span>⚡</span>
              </SignalTooltip>{' '}
              Ahead of Curve Today
            </h3>
            <p className="mt-1 text-sm text-[#9ca3af]">Contested · High volume · Just moved sharply</p>
          </div>
          <Link
            href="/signals?ahead_of_curve=true"
            className="text-sm font-medium text-[#93c5fd] hover:text-[#bfdbfe] whitespace-nowrap"
          >
            View all →
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-[#9ca3af]">
            <thead className="bg-[#0a0f1e] text-[#9ca3af] uppercase font-semibold text-xs border-b border-[#1f2937]">
              <tr>
                <th className="px-6 py-4">Market Question</th>
                <th className="px-6 py-4">
                  <SignalTooltip
                    content={<Delta24HTooltipContent />}
                    className="inline-flex items-center gap-1"
                  >
                    <span>Δ 24H</span>
                    <span className="normal-case">(i)</span>
                  </SignalTooltip>
                </th>
                <th className="px-6 py-4">Volume</th>
                <th className="px-6 py-4">Affected Stocks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1f2937]">
              {aheadOfCurveSignals.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center">
                    No ahead-of-curve signals right now. Check back after the next pipeline run.
                  </td>
                </tr>
              ) : (
                aheadOfCurveSignals.map((s) => {
                  const m = getSignalMarket(s);
                  const delta = formatProbabilityDelta(s.probability_change);
                  const marketUrl = resolveMarketUrl(m);

                  return (
                    <tr key={s.id} className="transition-colors duration-150 hover:bg-slate-800/50">
                      <td className="px-6 py-4 max-w-md">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-white truncate" title={m?.question}>
                            {m?.question}
                          </span>
                          {marketUrl && <MarketLinkIcon url={marketUrl} />}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`font-mono font-semibold ${delta.className}`}>
                          {delta.label}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {formatVolume(m?.volume || 0)}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1">
                          {s.affected_stocks?.slice(0, 3).map((stock) => (
                            <span key={stock} className="px-2 py-0.5 rounded-full bg-[#3b82f6]/20 text-[#3b82f6] text-xs font-medium">
                              {stock}
                            </span>
                          ))}
                          {(s.affected_stocks?.length ?? 0) > 3 && (
                            <span className="text-xs text-[#9ca3af]">+{(s.affected_stocks?.length ?? 0) - 3}</span>
                          )}
                          {(s.affected_stocks?.length ?? 0) === 0 && (
                            <span className="text-[#6b7280]">-</span>
                          )}
                        </div>
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
