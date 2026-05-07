'use client';

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

type MarketInfo = {
  question: string;
  probability: number;
  volume: number;
  category?: string;
  end_date?: string | null;
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
};

export default function SignalsPage() {
  const [signals, setSignals] = useState<SignalRow[]>([]);
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
            question,
            probability,
            volume,
            category,
            end_date
          )
        `)
        .order('analyzed_at', { ascending: false });

      if (error) console.error('[Signals] Supabase fetch error:', error.message);
      if (signalData) setSignals(signalData as unknown as SignalRow[]);
      setLoading(false);
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
        ) : (
          <table className="w-full text-left text-sm text-[#9ca3af]">
            <thead className="bg-[#0a0f1e] text-[#9ca3af] uppercase font-semibold text-xs border-b border-[#1f2937]">
              <tr>
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
              {filteredSignals.map(s => {
                const m = Array.isArray(s.markets) ? s.markets[0] : s.markets;
                const question = m?.question || 'Untitled market';
                const reason = s.reason || 'No analysis reason available.';
                const prob = (m?.probability || 0) * 100;
                const isExpanded = expandedId === s.id;
                const hasPreviewOverflow = question.length > 42 || reason.length > 58;

                return (
                  <React.Fragment key={s.id}>
                    <tr
                      onClick={() => setExpandedId(isExpanded ? null : s.id)}
                      className="hover:bg-[#1f2937]/50 transition-colors cursor-pointer"
                    >
                      <td className="px-6 py-4">
                        <div className="max-w-[360px]">
                          <div className="text-white font-medium truncate" title={question}>
                            {question}
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
                          {s.probability_change != null && Math.abs(s.probability_change) >= 0.05 && (
                            <span className={`text-xs font-semibold px-1.5 py-0.5 rounded w-fit ${
                              s.probability_change > 0
                                ? 'bg-[#10b981]/20 text-[#10b981]'
                                : 'bg-[#ef4444]/20 text-[#ef4444]'
                            }`}>
                              {s.probability_change > 0 ? '↑ +' : '↓ '}{(s.probability_change * 100).toFixed(0)}pts
                            </span>
                          )}
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
                        {(() => {
                          if (!s.signal_direction) return <span className="text-gray-400">—</span>;
                          const lower = s.signal_direction.toLowerCase();
                          if (lower.includes('bullish') || lower.includes('positive') || lower.includes('up') || lower.includes('rise') || lower.includes('increase')) {
                            return <span className="text-[#10b981] font-semibold">↑ BULLISH</span>;
                          }
                          if (lower.includes('bearish') || lower.includes('negative') || lower.includes('down') || lower.includes('fall') || lower.includes('decrease')) {
                            return <span className="text-[#ef4444] font-semibold">↓ BEARISH</span>;
                          }
                          return <span className="text-gray-400">◆ NEUTRAL</span>;
                        })()}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1 max-w-[150px]">
                          {s.affected_stocks?.slice(0, 3).map((stock) => (
                            <span key={stock} className="px-2 py-0.5 rounded-full bg-[#3b82f6]/20 text-[#3b82f6] text-xs font-medium">
                              {stock}
                            </span>
                          ))}
                          {(s.affected_stocks?.length ?? 0) > 3 && (
                            <span className="px-2 py-0.5 text-xs">+{(s.affected_stocks?.length ?? 0) - 3}</span>
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
                        <td colSpan={8} className="px-6 py-6 border-l-2 border-[#3b82f6]">
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
                                <li><strong className="text-gray-300">Analyzed At:</strong> {new Date(s.analyzed_at).toLocaleString()}</li>
                                <li><strong className="text-gray-300">All Stocks:</strong> {s.affected_stocks?.join(', ') || 'None'}</li>
                              </ul>
                            </div>
                          </div>
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
