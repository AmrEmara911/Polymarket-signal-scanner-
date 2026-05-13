'use client';

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { DirectionBadge } from '@/components/DirectionBadge';
import { ProbChangeBadge } from '@/components/ProbChangeBadge';
import { MarketLinkIcon, MarketLinkButton, resolveMarketUrl } from '@/components/MarketLink';
// NOTE: <Sparkline /> import removed — TREND column hidden pending reliable
// snapshot history. The component file still exists for re-enable later.
import { AheadOfCurveBadge } from '@/components/AheadOfCurveBadge';
import { formatRelativeTime, formatFullTimestamp } from '@/lib/format-time';

/**
 * Format a USD volume figure as a compact human-readable string.
 * 2_300_000 → "$2.3M", 50_000 → "$50K", 800 → "$800".
 */
function formatVolume(volume: number): string {
  if (volume >= 1_000_000) return `$${(volume / 1_000_000).toFixed(1)}M`;
  if (volume >= 1_000) return `$${(volume / 1_000).toFixed(0)}K`;
  return `$${volume.toFixed(0)}`;
}

type MarketInfo = {
  id?: string;
  question: string;
  probability: number;
  volume: number;
  category?: string;
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
  affected_stocks: string[] | null;
  urgency: string | null;
  signal_type: string | null;
  confidence: number | null;
  is_relevant: boolean | null;
  reason: string | null;
  signal_direction: string | null;
  analyzed_at: string;
  thematic_buckets: string[] | null;
  is_ahead_of_curve: boolean | null;
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

function hasAheadOfCurveCriteria(signal: SignalRow): boolean {
  const market = getSignalMarket(signal);
  const probability = market?.probability;
  const volume = market?.volume ?? 0;
  const change = signal.probability_change;

  return (
    Boolean(signal.is_ahead_of_curve) &&
    typeof probability === 'number' &&
    Number.isFinite(probability) &&
    probability >= 0.25 &&
    probability <= 0.75 &&
    volume > 50_000 &&
    change !== null &&
    Math.abs(change) > 0.15
  );
}

export default function SignalsPage() {
  const [signals, setSignals] = useState<SignalRow[]>([]);
  const [relevantSignalCount, setRelevantSignalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [, setTick] = useState(0);

  // Filters — Movement filter removed pending reliable probability_change
  // detection across ingest cycles.
  const [filterRelevant, setFilterRelevant] = useState<'all' | 'relevant'>('relevant');
  const [filterUrgency, setFilterUrgency] = useState('All');
  const [filterType, setFilterType] = useState('All');
  const [search, setSearch] = useState('');
  const [aheadOfCurveOnly, setAheadOfCurveOnly] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setTick((tick) => tick + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setAheadOfCurveOnly(params.get('ahead_of_curve') === 'true');
  }, []);

  useEffect(() => {
    async function fetchSignals() {
      const countRes = await fetch(`/api/signals/count?t=${Date.now()}`, { cache: 'no-store' });
      const countData = await countRes.json();
      if (countData.success) {
        setRelevantSignalCount(Number(countData.count ?? 0));
      } else {
        console.error('[Signals] Relevant count fetch error:', countData.error ?? 'Unknown error');
      }

      let { data: signalData, error } = await supabase
        .from('signals')
        .select(`
          *,
          markets (
            id,
            question,
            probability,
            volume,
            category,
            end_date,
            slug,
            market_url,
            last_updated_at,
            fetched_at
          )
        `)
        .order('analyzed_at', { ascending: false })
        .range(0, 9999);

      if (isMissingFreshnessColumn(error)) {
        const fallback = await supabase
          .from('signals')
          .select(`
            *,
            markets (
              id,
              question,
              probability,
              volume,
              category,
              end_date,
              slug,
              market_url,
              fetched_at
            )
          `)
          .order('analyzed_at', { ascending: false })
          .range(0, 9999);
        signalData = fallback.data;
        error = fallback.error;
      }

      if (error) console.error('[Signals] Supabase fetch error:', error.message);
      const rows = (signalData ?? []) as unknown as SignalRow[];
      setSignals(rows);
      setLoading(false);
      // NOTE: 7-day snapshot fetch for sparklines removed alongside the TREND
      // column. Re-enable when probability snapshot history is reliable.
    }
    fetchSignals();
  }, []);

  const filteredSignals = signals.filter(s => {
    const m = getSignalMarket(s);
    if (filterRelevant === 'relevant' && !s.is_relevant) return false;
    if (filterUrgency !== 'All' && s.urgency?.toLowerCase() !== filterUrgency.toLowerCase()) return false;
    if (filterType !== 'All' && s.signal_type?.toLowerCase() !== filterType.toLowerCase()) return false;
    if (aheadOfCurveOnly && !hasAheadOfCurveCriteria(s)) return false;
    if (search && !m?.question?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  const usingExactRelevantCount =
    filterRelevant === 'relevant' &&
    filterUrgency === 'All' &&
    filterType === 'All' &&
    !aheadOfCurveOnly &&
    search.trim() === '';
  const visibleResultCount = usingExactRelevantCount ? relevantSignalCount : filteredSignals.length;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white tracking-tight">Signals Database</h2>

      {/* Filter Bar */}
      <div className="bg-[#111827] border border-[#1f2937] p-4 rounded-xl flex flex-wrap gap-4 items-center shadow-sm">
        <input
          type="text"
          placeholder="Search market question..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-[#0a0f1e] border border-[#1f2937] rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-[#3b82f6] min-w-[250px]"
        />

        <select
          value={filterRelevant}
          onChange={(e) => setFilterRelevant(e.target.value as 'all' | 'relevant')}
          className="bg-[#0a0f1e] border border-[#1f2937] rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-[#3b82f6]"
        >
          <option value="all">Show All</option>
          <option value="relevant">Relevant Only</option>
        </select>

        <select
          value={filterUrgency}
          onChange={(e) => setFilterUrgency(e.target.value)}
          className="bg-[#0a0f1e] border border-[#1f2937] rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-[#3b82f6]"
        >
          <option value="All">All Urgencies</option>
          <option value="High">High</option>
          <option value="Medium">Medium</option>
          <option value="Low">Low</option>
        </select>

        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="bg-[#0a0f1e] border border-[#1f2937] rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-[#3b82f6]"
        >
          <option value="All">All Types</option>
          <option value="Macro">Macro</option>
          <option value="Regulatory">Regulatory</option>
          <option value="Company">Company</option>
          <option value="Sector">Sector</option>
        </select>

        <button
          type="button"
          aria-pressed={aheadOfCurveOnly}
          onClick={() => setAheadOfCurveOnly((value) => !value)}
          className={`bg-[#0a0f1e] border rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-[#3b82f6] ${
            aheadOfCurveOnly ? 'border-[#3b82f6]' : 'border-[#1f2937]'
          }`}
        >
          Ahead of Curve only
        </button>

        <div className="ml-auto text-sm text-[#9ca3af]">
          Showing {visibleResultCount} results
        </div>
      </div>

      {/* Table */}
      <div className="bg-[#111827] border border-[#1f2937] rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-[#9ca3af] animate-pulse">Loading signals...</div>
        ) : filteredSignals.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-[#9ca3af] mb-2">No signals match your filters</p>
            <p className="text-[#6b7280] text-sm">
              Try changing the urgency or type filters above
            </p>
          </div>
        ) : (
          <table className="w-full text-left text-sm text-[#9ca3af]">
            <thead className="bg-[#0a0f1e] text-[#9ca3af] uppercase font-semibold text-xs border-b border-[#1f2937]">
              <tr>
                <th className="w-10 px-3 py-4 text-slate-500">#</th>
                <th className="px-6 py-4 w-1/3">Market Question</th>
                <th className="px-4 py-4">Prob (24H)</th>
                <th className="px-4 py-4">Relevant</th>
                <th className="px-4 py-4">Confidence</th>
                <th className="px-4 py-4">Signal Type</th>
                <th className="px-4 py-4">Direction</th>
                <th className="px-6 py-4">Stocks</th>
                <th className="px-4 py-4">Urgency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1f2937]">
              {filteredSignals.map((s, index) => {
                const m = getSignalMarket(s);
                const question = m?.question || 'Untitled market';
                const reason = s.reason || 'No analysis reason available.';
                const prob = (m?.probability || 0) * 100;
                const isExpanded = expandedId === s.id;
                const hasPreviewOverflow = question.length > 42 || reason.length > 58;
                const marketUrl = resolveMarketUrl(m);
                const isAheadOfCurve = hasAheadOfCurveCriteria(s);

                return (
                  <React.Fragment key={s.id}>
                    <tr
                      onClick={() => setExpandedId(isExpanded ? null : s.id)}
                      className="transition-colors duration-150 hover:bg-slate-800/70 cursor-pointer"
                    >
                      <td className="w-10 px-3 py-4 text-xs text-slate-500">
                        {index + 1}
                      </td>
                      <td className="px-6 py-4">
                        <div className="max-w-[360px]">
                          <div className="flex items-center gap-2">
                            <span className="text-white font-medium truncate" title={question}>
                              {question}
                            </span>
                            {marketUrl && <MarketLinkIcon url={marketUrl} />}
                            <AheadOfCurveBadge flagged={isAheadOfCurve} />
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-xs">
                            <span className="min-w-0 truncate text-[#9ca3af]" title={reason}>
                              {reason}
                            </span>
                            {(hasPreviewOverflow || isExpanded) && (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setExpandedId(isExpanded ? null : s.id);
                                }}
                                aria-expanded={isExpanded}
                                className="shrink-0 text-[11px] font-light lowercase tracking-normal text-[#93c5fd] hover:text-[#bfdbfe] focus:outline-none focus:text-[#bfdbfe]"
                              >
                                {isExpanded ? 'show less' : 'see more'}
                              </button>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span className={`font-mono ${prob > 60 ? 'text-[#10b981]' : prob > 40 ? 'text-[#f59e0b]' : 'text-[#ef4444]'}`}>
                              {prob.toFixed(1)}%
                            </span>
                            <MarketFreshness market={m} />
                          </div>
                          <ProbChangeBadge change={s.probability_change} />
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        {s.is_relevant ? (
                          <span className="text-[#10b981] font-bold">✓</span>
                        ) : (
                          <span className="text-[#ef4444] font-bold">✗</span>
                        )}
                      </td>
                      <td className="px-4 py-4 font-mono">
                        {((s.confidence ?? 0) * 100).toFixed(0)}%
                      </td>
                      <td className="px-4 py-4">
                        {s.signal_type && (
                          <span className="px-2.5 py-1 rounded-full bg-[#1f2937] text-gray-300 text-xs capitalize">
                            {s.signal_type}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <DirectionBadge direction={s.signal_direction} />
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1.5 max-w-[170px]">
                          <div className="flex flex-wrap gap-1">
                            {s.affected_stocks?.slice(0, 3).map((stock) => (
                              <span key={stock} className="px-2 py-0.5 rounded-full bg-[#3b82f6]/20 text-[#3b82f6] text-xs font-medium">
                                {stock}
                              </span>
                            ))}
                            {(s.affected_stocks?.length ?? 0) > 3 && (
                              <span className="px-2 py-0.5 text-xs text-[#9ca3af]">+{(s.affected_stocks?.length ?? 0) - 3}</span>
                            )}
                          </div>
                          {(m?.volume ?? 0) > 0 && (
                            <span className="text-xs text-[#6b7280]">{formatVolume(m?.volume ?? 0)} volume</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-4 min-w-[90px]">
                        {s.urgency && (
                          <span className={`inline-block whitespace-nowrap px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${
                            s.urgency === 'high' ? 'bg-[#ef4444]/20 text-[#ef4444]' :
                            s.urgency === 'medium' ? 'bg-[#f59e0b]/20 text-[#f59e0b]' :
                            'bg-[#374151] text-gray-300'
                          }`}>
                            {s.urgency}
                          </span>
                        )}
                      </td>
                    </tr>

                    {/* Expanded Row Content */}
                    {isExpanded && (
                      <tr className="bg-[#0a0f1e]/50">
                        <td colSpan={9} className="px-6 py-6 border-l-2 border-[#3b82f6]">
                          <div className="grid grid-cols-2 gap-8 text-sm">
                            <div>
                              <h4 className="font-semibold text-white mb-2">Market Details</h4>
                              <p className="text-gray-300 mb-4">{m?.question}</p>

                              <h4 className="font-semibold text-white mb-2">Analysis Reason</h4>
                              <p className="text-gray-300 leading-relaxed">{s.reason}</p>
                            </div>
                            <div>
                              <h4 className="font-semibold text-white mb-2">Metadata</h4>
                              <ul className="space-y-2 text-gray-400">
                                <li><strong className="text-gray-300">Signal Direction:</strong> {s.signal_direction || 'N/A'}</li>
                                <li><strong className="text-gray-300">Volume:</strong> ${(m?.volume || 0).toLocaleString()}</li>
                                <li>
                                  <strong className="text-gray-300">Analyzed:</strong>{' '}
                                  <span title={formatFullTimestamp(s.analyzed_at)} className="cursor-help">
                                    {formatRelativeTime(s.analyzed_at)}
                                  </span>
                                </li>
                                <li><strong className="text-gray-300">All Stocks:</strong> {s.affected_stocks?.join(', ') || 'None'}</li>
                                <li>
                                  <strong className="text-gray-300">Thematic Buckets:</strong>{' '}
                                  {s.thematic_buckets && s.thematic_buckets.length > 0
                                    ? s.thematic_buckets.join(', ')
                                    : 'None tagged'}
                                </li>
                              </ul>
                            </div>
                          </div>
                          {marketUrl && (
                            <div className="mt-6 pt-4 border-t border-[#1f2937]">
                              <MarketLinkButton url={marketUrl} />
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
