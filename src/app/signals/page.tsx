'use client';

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { DirectionBadge } from '@/components/DirectionBadge';
import { ProbChangeBadge } from '@/components/ProbChangeBadge';
import { MarketLinkIcon, MarketLinkButton, resolveMarketUrl } from '@/components/MarketLink';
import { Sparkline } from '@/components/Sparkline';
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

export default function SignalsPage() {
  const [signals, setSignals] = useState<SignalRow[]>([]);
  // Map: market_id → ordered probability series (oldest → newest), last 7 days.
  // Populated in one batched query after signals load to avoid N+1.
  const [trendByMarket, setTrendByMarket] = useState<Map<string, number[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Filters
  const [filterRelevant, setFilterRelevant] = useState<'all' | 'relevant'>('relevant');
  const [filterUrgency, setFilterUrgency] = useState('All');
  const [filterType, setFilterType] = useState('All');
  const [filterMovement, setFilterMovement] = useState('All');
  const [search, setSearch] = useState('');

  useEffect(() => {
    async function fetchSignals() {
      const { data: signalData, error } = await supabase
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
            market_url
          )
        `)
        .order('analyzed_at', { ascending: false });

      if (error) console.error('[Signals] Supabase fetch error:', error.message);
      const rows = (signalData ?? []) as unknown as SignalRow[];
      setSignals(rows);
      setLoading(false);

      // Batched fetch for 7-day trend sparklines. One query, grouped client-side
      // by market_id — no N+1 even with hundreds of signals.
      const marketIds = Array.from(
        new Set(
          rows
            .map((r) => (Array.isArray(r.markets) ? r.markets[0]?.id : r.markets?.id))
            .filter((v): v is string => Boolean(v))
        )
      );
      if (marketIds.length > 0) {
        const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const { data: snaps, error: snapErr } = await supabase
          .from('probability_snapshots')
          .select('market_id, probability, recorded_at')
          .in('market_id', marketIds)
          .gte('recorded_at', sevenDaysAgoIso)
          .order('recorded_at', { ascending: true });

        if (snapErr) {
          console.error('[Signals] Snapshot fetch error:', snapErr.message);
        } else {
          const byMarket = new Map<string, number[]>();
          for (const s of (snaps ?? []) as Array<{ market_id: string; probability: number }>) {
            const existing = byMarket.get(s.market_id);
            const value = Number(s.probability);
            if (!Number.isFinite(value)) continue;
            if (existing) existing.push(value);
            else byMarket.set(s.market_id, [value]);
          }
          setTrendByMarket(byMarket);
        }
      }
    }
    fetchSignals();
  }, []);

  const filteredSignals = signals.filter(s => {
    const m = Array.isArray(s.markets) ? s.markets[0] : s.markets;
    if (filterRelevant === 'relevant' && !s.is_relevant) return false;
    if (filterUrgency !== 'All' && s.urgency?.toLowerCase() !== filterUrgency.toLowerCase()) return false;
    if (filterType !== 'All' && s.signal_type?.toLowerCase() !== filterType.toLowerCase()) return false;
    if (filterMovement === 'Moving Up Only' && (!s.probability_change || s.probability_change <= 0.10)) return false;
    if (filterMovement === 'Moving Down Only' && (!s.probability_change || s.probability_change >= -0.10)) return false;
    if (filterMovement === 'Stable Only' && s.probability_change && Math.abs(s.probability_change) >= 0.05) return false;
    if (search && !m?.question?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

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

        <select
          value={filterMovement}
          onChange={(e) => setFilterMovement(e.target.value)}
          className="bg-[#0a0f1e] border border-[#1f2937] rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-[#3b82f6]"
        >
          <option value="All">All Movement</option>
          <option value="Moving Up Only">Moving Up Only</option>
          <option value="Moving Down Only">Moving Down Only</option>
          <option value="Stable Only">Stable Only</option>
        </select>

        <div className="ml-auto text-sm text-[#9ca3af]">
          Showing {filteredSignals.length} results
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
              Try changing the urgency, type, or movement filters above
            </p>
          </div>
        ) : (
          <table className="w-full text-left text-sm text-[#9ca3af]">
            <thead className="bg-[#0a0f1e] text-[#9ca3af] uppercase font-semibold text-xs border-b border-[#1f2937]">
              <tr>
                <th className="w-10 px-3 py-4 text-slate-500">#</th>
                <th className="px-6 py-4 w-1/3">Market Question</th>
                <th className="px-4 py-4">Prob (24H)</th>
                <th className="px-4 py-4">Trend</th>
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
                const m = Array.isArray(s.markets) ? s.markets[0] : s.markets;
                const question = m?.question || 'Untitled market';
                const reason = s.reason || 'No analysis reason available.';
                const prob = (m?.probability || 0) * 100;
                const isExpanded = expandedId === s.id;
                const hasPreviewOverflow = question.length > 42 || reason.length > 58;
                const marketUrl = resolveMarketUrl(m);

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
                            <AheadOfCurveBadge flagged={s.is_ahead_of_curve} />
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
                          <span className={`font-mono ${prob > 60 ? 'text-[#10b981]' : prob > 40 ? 'text-[#f59e0b]' : 'text-[#ef4444]'}`}>
                            {prob.toFixed(1)}%
                          </span>
                          <ProbChangeBadge change={s.probability_change} />
                        </div>
                      </td>
                      <td className="px-4 py-4 w-[80px]">
                        <Sparkline data={(m?.id && trendByMarket.get(m.id)) || []} />
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
                      <td className="px-4 py-4">
                        {s.urgency && (
                          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${
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
                        <td colSpan={10} className="px-6 py-6 border-l-2 border-[#3b82f6]">
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
