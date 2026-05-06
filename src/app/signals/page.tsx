'use client';

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function SignalsPage() {
  const [signals, setSignals] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Filters
  const [filterRelevant, setFilterRelevant] = useState<'all' | 'relevant'>('relevant');
  const [filterUrgency, setFilterUrgency] = useState('All');
  const [filterType, setFilterType] = useState('All');
  const [search, setSearch] = useState('');

  useEffect(() => {
    async function fetchSignals() {
      const query = supabase
        .from('signals')
        .select('*, markets(question, probability, volume)')
        .order('analyzed_at', { ascending: false })
        .limit(200);

      const { data } = await query;
      if (data) setSignals(data);
      setLoading(false);
    }
    fetchSignals();
  }, []);

  const filteredSignals = signals.filter(s => {
    const m = Array.isArray(s.markets) ? s.markets[0] : (s.markets as Record<string, any>);
    if (filterRelevant === 'relevant' && !s.is_relevant) return false;
    if (filterUrgency !== 'All' && (s.urgency as string)?.toLowerCase() !== filterUrgency.toLowerCase()) return false;
    if (filterType !== 'All' && (s.signal_type as string)?.toLowerCase() !== filterType.toLowerCase()) return false;
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
                <th className="px-4 py-4">Prob</th>
                <th className="px-4 py-4">Relevant</th>
                <th className="px-4 py-4">Confidence</th>
                <th className="px-4 py-4">Signal Type</th>
                <th className="px-6 py-4">Stocks</th>
                <th className="px-4 py-4">Urgency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1f2937]">
              {filteredSignals.map(s => {
                const m = Array.isArray(s.markets) ? s.markets[0] : s.markets;
                const prob = (m?.probability || 0) * 100;
                const isExpanded = expandedId === s.id;

                return (
                  <React.Fragment key={s.id}>
                    <tr 
                      onClick={() => setExpandedId(isExpanded ? null : s.id)}
                      className="hover:bg-[#1f2937]/50 transition-colors cursor-pointer"
                    >
                      <td className="px-6 py-4">
                        <div className="text-white font-medium max-w-[300px] truncate" title={m?.question}>
                          {m?.question}
                        </div>
                        <div className="text-xs mt-1 text-[#9ca3af] truncate max-w-[300px]">{s.reason}</div>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`font-mono ${prob > 60 ? 'text-[#10b981]' : prob > 40 ? 'text-[#f59e0b]' : 'text-[#ef4444]'}`}>
                          {prob.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        {s.is_relevant ? (
                          <span className="text-[#10b981] font-bold">✓</span>
                        ) : (
                          <span className="text-[#ef4444] font-bold">✗</span>
                        )}
                      </td>
                      <td className="px-4 py-4 font-mono">
                        {((s.confidence || 0) * 100).toFixed(0)}%
                      </td>
                      <td className="px-4 py-4">
                        {s.signal_type && (
                          <span className="px-2.5 py-1 rounded-full bg-[#1f2937] text-gray-300 text-xs capitalize">
                            {s.signal_type}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1 max-w-[150px]">
                          {s.affected_stocks?.slice(0, 3).map((stock: string) => (
                            <span key={stock} className="px-2 py-0.5 rounded-full bg-[#3b82f6]/20 text-[#3b82f6] text-xs font-medium">
                              {stock}
                            </span>
                          ))}
                          {s.affected_stocks?.length > 3 && (
                            <span className="px-2 py-0.5 text-xs">+{s.affected_stocks.length - 3}</span>
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
                        <td colSpan={7} className="px-6 py-6 border-l-2 border-[#3b82f6]">
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
