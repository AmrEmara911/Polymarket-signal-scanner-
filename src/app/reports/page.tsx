'use client';

import { useEffect, useState } from 'react';

// Simple markdown formatter since we cannot install react-markdown
function formatMarkdown(text: string) {
  // Replace headers
  let html = text.replace(/^### (.*$)/gim, '<h3 class="text-xl font-semibold text-white mt-6 mb-3">$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2 class="text-2xl font-bold text-white mt-8 mb-4 border-b border-[#1f2937] pb-2">$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1 class="text-3xl font-bold text-white mt-8 mb-4">$1</h1>');
  
  // Replace bold
  html = html.replace(/\*\*(.*?)\*\*/gim, '<strong class="text-white font-semibold">$1</strong>');
  
  // Replace bullets
  html = html.replace(/^\- (.*$)/gim, '<li class="ml-4 mb-2 list-disc">$1</li>');
  
  // Wrap paragraphs (basic)
  html = html.replace(/\n\n/gim, '</p><p class="mb-4">');
  
  return '<p class="mb-4">' + html + '</p>';
}

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
            
            <div className="p-8 text-[#9ca3af] leading-relaxed">
              <div dangerouslySetInnerHTML={{ __html: formatMarkdown(r.content) }} />
            </div>
          </div>
        ))
      )}
    </div>
  );
}
