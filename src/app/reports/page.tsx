'use client';

import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';

export default function ReportsPage() {
  interface ReportRow {
    id: string;
    generated_at: string;
    content: string;
    signal_count: number;
  }

  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchReports() {
    const response = await fetch('/api/reports');
    const payload = await response.json();

    if (!response.ok || !payload.success) {
      throw new Error(payload.error ?? 'Failed to load reports');
    }

    setReports(payload.reports ?? []);
  }

  useEffect(() => {
    fetchReports()
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load reports'))
      .finally(() => setLoading(false));
  }, []);

  async function generateReport() {
    setGenerating(true);
    setError(null);

    try {
      const response = await fetch('/api/reports', { method: 'POST' });
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? 'Failed to generate report');
      }

      await fetchReports();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate report');
    } finally {
      setGenerating(false);
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert('Copied to clipboard!');
  };

  if (loading) {
    return <div className="animate-pulse text-[#9ca3af]">Loading reports...</div>;
  }

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-white tracking-tight">Analyst Reports</h2>
        <button 
          onClick={generateReport}
          disabled={generating}
          className="bg-[#3b82f6] hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {generating ? 'Generating...' : 'Generate New Report'}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-200 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {reports.length === 0 ? (
        <div className="bg-[#111827] border border-[#1f2937] p-12 text-center rounded-xl shadow-sm">
          <p className="text-[#9ca3af] text-lg">No reports generated yet.</p>
          <p className="text-[#9ca3af] mt-2">Hit /api/report to generate your first report.</p>
        </div>
      ) : (
        reports.map(r => (
          <div key={r.id} className="bg-[#111827] border border-[#1f2937] rounded-xl shadow-sm overflow-hidden">
            <div className="bg-[#0a0f1e] px-6 py-4 border-b border-[#1f2937] flex justify-between items-center">
              <div>
                <span className="text-[#9ca3af] text-sm font-medium">Generated at: </span>
                <span className="text-white font-medium">
                  {new Date(r.generated_at).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span className="bg-[#1f2937] text-gray-300 text-xs px-3 py-1 rounded-full">
                  {r.signal_count} markets analyzed
                </span>
                <button 
                  onClick={() => copyToClipboard(r.content)}
                  className="text-[#9ca3af] hover:text-white transition-colors text-sm flex items-center gap-1"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                  Copy
                </button>
              </div>
            </div>
            
            <div className="p-8 prose prose-invert prose-sm max-w-none
              prose-headings:text-white prose-headings:font-bold
              prose-h1:text-3xl prose-h1:mt-8 prose-h1:mb-4
              prose-h2:text-2xl prose-h2:mt-8 prose-h2:mb-4 prose-h2:border-b prose-h2:border-[#1f2937] prose-h2:pb-2
              prose-h3:text-xl prose-h3:mt-6 prose-h3:mb-3
              prose-p:text-[#9ca3af] prose-p:leading-relaxed prose-p:mb-4
              prose-strong:text-white prose-strong:font-semibold
              prose-em:text-[#cbd5e1] prose-em:italic
              prose-li:text-[#9ca3af] prose-li:mb-1
              prose-ul:my-3 prose-ul:ml-4
              prose-ol:my-3 prose-ol:ml-4
              prose-hr:border-[#1f2937] prose-hr:my-6
              prose-blockquote:border-l-[#3b82f6] prose-blockquote:text-[#9ca3af]">
              <ReactMarkdown>{r.content}</ReactMarkdown>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
