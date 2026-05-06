'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function Dashboard() {
  const [metrics, setMetrics] = useState({
    totalScanned: 0,
    relevantFound: 0,
    highUrgency: 0,
    lastUpdated: '-'
  });
  const [topSignals, setTopSignals] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      // Fetch metrics
      const { count: totalScanned } = await supabase.from('markets').select('*', { count: 'exact', head: true });
      const { count: relevantFound } = await supabase.from('signals').select('*', { count: 'exact', head: true }).eq('is_relevant', true);
      const { count: highUrgency } = await supabase.from('signals').select('*', { count: 'exact', head: true }).eq('urgency', 'high');
      
      const { data: latestSignal } = await supabase.from('signals').select('analyzed_at').order('analyzed_at', { ascending: false }).limit(1);

      setMetrics({
        totalScanned: totalScanned || 0,
        relevantFound: relevantFound || 0,
        highUrgency: highUrgency || 0,
        lastUpdated: latestSignal?.[0]?.analyzed_at ? new Date(latestSignal[0].analyzed_at).toLocaleString() : 'Never'
      });

      // Fetch Top Signals
      const { data: top } = await supabase
        .from('signals')
        .select('*, markets(question, probability, volume)')
        .eq('is_relevant', true)
        // Sort by urgency doesn't work perfectly via string (high, medium, low), but assuming 'high' is what we want most
        .order('confidence', { ascending: false })
        .limit(5);

      if (top) setTopSignals(top);
      setLoading(false);
    }
    fetchData();
  }, []);

  if (loading) {
    return <div className="animate-pulse text-[#9ca3af]">Loading dashboard...</div>;
  }

  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-bold text-white tracking-tight">Morning Briefing</h2>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Markets Scanned', value: metrics.totalScanned },
          { label: 'Relevant Signals Found', value: metrics.relevantFound, color: 'text-[#10b981]' },
          { label: 'High Urgency Signals', value: metrics.highUrgency, color: 'text-[#ef4444]' },
          { label: 'Last Updated', value: metrics.lastUpdated, small: true }
        ].map((metric, idx) => (
          <div key={idx} className="bg-[#111827] border border-[#1f2937] p-5 rounded-xl shadow-sm">
            <h3 className="text-sm font-medium text-[#9ca3af] mb-1">{metric.label}</h3>
            <p className={`font-bold ${metric.small ? 'text-lg text-white' : 'text-3xl'} ${metric.color || 'text-white'}`}>
              {metric.value}
            </p>
          </div>
        ))}
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
                <th className="px-6 py-4">Probability</th>
                <th className="px-6 py-4">Affected Stocks</th>
                <th className="px-6 py-4">Urgency</th>
                <th className="px-6 py-4">Signal Type</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1f2937]">
              {topSignals.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center">No highly relevant signals found.</td>
                </tr>
              ) : (
                topSignals.map((s) => {
                  const m = Array.isArray(s.markets) ? s.markets[0] : s.markets;
                  const prob = (m?.probability || 0) * 100;
                  return (
                    <tr key={s.id} className="hover:bg-[#1f2937]/50 transition-colors">
                      <td className="px-6 py-4 font-medium text-white max-w-md truncate" title={m?.question}>{m?.question}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className="font-mono w-12">{prob.toFixed(1)}%</span>
                          <div className="w-16 h-1.5 bg-[#1f2937] rounded-full overflow-hidden">
                            <div className="h-full bg-[#3b82f6]" style={{ width: `${prob}%` }}></div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1">
                          {s.affected_stocks?.map((stock: string) => (
                            <span key={stock} className="px-2 py-0.5 rounded-full bg-[#3b82f6]/20 text-[#3b82f6] text-xs font-medium">
                              {stock}
                            </span>
                          ))}
                        </div>
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
                        <span className="capitalize text-gray-300">{s.signal_type}</span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
