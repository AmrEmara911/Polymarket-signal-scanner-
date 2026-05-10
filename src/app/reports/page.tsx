'use client';

import { useEffect, useState } from 'react';
import jsPDF from 'jspdf';
import ReactMarkdown from 'react-markdown';
import { supabase } from '@/lib/supabase';
import { resolveMarketUrl } from '@/components/MarketLink';
import { formatRelativeTime, formatFullTimestamp } from '@/lib/format-time';

interface MarketRef {
  id: string;
  question: string;
  slug: string | null;
  market_url: string | null;
}

interface ReportRow {
  id: string;
  generated_at: string;
  content: string;
  signal_count: number;
  market_ids: string[] | null;
}

type PdfFontStyle = 'normal' | 'bold' | 'italic';

function parseInlineMarkdown(text: string): Array<{ text: string; style: PdfFontStyle }> {
  const segments: Array<{ text: string; style: PdfFontStyle }> = [];
  let i = 0;

  while (i < text.length) {
    if (text.startsWith('**', i)) {
      const end = text.indexOf('**', i + 2);
      if (end !== -1) {
        segments.push({ text: text.slice(i + 2, end), style: 'bold' });
        i = end + 2;
        continue;
      }
    }

    if (text[i] === '*') {
      const end = text.indexOf('*', i + 1);
      if (end !== -1) {
        segments.push({ text: text.slice(i + 1, end), style: 'italic' });
        i = end + 1;
        continue;
      }
    }

    const nextMarker = text.indexOf('*', i);
    const end = nextMarker === -1 ? text.length : nextMarker;
    if (end === i) {
      segments.push({ text: text[i], style: 'normal' });
      i += 1;
      continue;
    }
    segments.push({ text: text.slice(i, end), style: 'normal' });
    i = end;
  }

  return segments.filter((segment) => segment.text.length > 0);
}

function downloadPDF(report: ReportRow) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 50;
  const contentWidth = pageWidth - margin * 2;
  const footerY = pageHeight - 30;
  let y = margin;

  const ensurePageSpace = (needed: number) => {
    if (y + needed > pageHeight - 60) {
      doc.addPage();
      y = margin;
    }
  };

  const renderStyledLine = (line: string, indent = 0) => {
    const segments = parseInlineMarkdown(line);
    const lineHeight = 14;
    let x = margin + indent;

    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    ensurePageSpace(lineHeight);

    for (const segment of segments) {
      doc.setFont('helvetica', segment.style);
      const tokens = segment.text.split(/(\s+)/).filter(Boolean);

      for (const token of tokens) {
        if (!token.trim() && x === margin + indent) continue;
        const tokenWidth = doc.getTextWidth(token);
        if (token.trim() && x + tokenWidth > pageWidth - margin) {
          y += lineHeight;
          ensurePageSpace(lineHeight);
          x = margin + indent;
        }
        doc.text(token, x, y);
        x += tokenWidth;
      }
    }

    y += lineHeight;
  };

  const renderHeading = (text: string, fontSize: number, lineHeight: number, topGap: number) => {
    y += topGap;
    ensurePageSpace(lineHeight * 2);
    doc.setFontSize(fontSize);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    const wrapped = doc.splitTextToSize(text, contentWidth);
    doc.text(wrapped, margin, y);
    y += wrapped.length * lineHeight + 4;
  };

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 80, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text('BIT Capital', margin, 40);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(148, 163, 184);
  doc.text('SIGNAL SCANNER', margin, 58);

  doc.setTextColor(15, 23, 42);
  y = 110;

  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('Signal Briefing', margin, y);
  y += 25;

  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text(`Generated ${new Date(report.generated_at).toLocaleString()}`, margin, y);
  doc.text(`${report.signal_count} markets analyzed`, pageWidth - margin, y, { align: 'right' });
  y += 30;

  doc.setTextColor(15, 23, 42);

  const lines = report.content.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.startsWith('# ')) {
      renderHeading(line.replace(/^#\s+/, ''), 16, 20, 10);
    } else if (line.startsWith('## ')) {
      renderHeading(line.replace(/^##\s+/, ''), 13, 17, 8);
    } else if (line.startsWith('### ')) {
      renderHeading(line.replace(/^###\s+/, ''), 11, 15, 6);
    } else if (line.trim() === '---') {
      ensurePageSpace(14);
      doc.setDrawColor(203, 213, 225);
      doc.line(margin, y, pageWidth - margin, y);
      y += 14;
    } else if (line.trim() === '') {
      y += 6;
    } else if (/^[-+]\s+/.test(line)) {
      renderStyledLine(`- ${line.replace(/^[-+]\s+/, '')}`, 12);
    } else {
      renderStyledLine(line);
    }
  }

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(148, 163, 184);
    doc.text(`BIT Capital Signal Scanner — Page ${i} of ${pageCount}`, margin, footerY);
  }

  doc.save(`bit-capital-briefing-${new Date(report.generated_at).toISOString().split('T')[0]}.pdf`);
}

export default function ReportsPage() {
  const [reports, setReports] = useState<ReportRow[]>([]);
  // Map: market_id -> { question, market_url } for rendering source links
  const [marketLookup, setMarketLookup] = useState<Map<string, MarketRef>>(new Map());
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchReports() {
    const response = await fetch('/api/reports');
    const payload = await response.json();

    if (!response.ok || !payload.success) {
      throw new Error(payload.error ?? 'Failed to load reports');
    }

    const loadedReports = (payload.reports ?? []) as ReportRow[];
    setReports(loadedReports);

    // Collect every market_id cited across all reports, deduped, then fetch
    // them in one round-trip to build a lookup map for the footers.
    const allMarketIds = Array.from(
      new Set(loadedReports.flatMap((r) => r.market_ids ?? []).filter(Boolean))
    );
    if (allMarketIds.length > 0) {
      const { data: markets } = await supabase
        .from('markets')
        .select('id, question, slug, market_url')
        .in('id', allMarketIds);
      const map = new Map<string, MarketRef>();
      for (const m of (markets ?? []) as MarketRef[]) {
        map.set(m.id, m);
      }
      setMarketLookup(map);
    }
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
          <p className="text-[#9ca3af] text-lg mb-2">No reports generated yet.</p>
          <p className="text-[#6b7280] text-sm max-w-md mx-auto mb-6">
            Reports synthesize the day&rsquo;s most important signals into a morning briefing.
          </p>
          <button
            onClick={generateReport}
            disabled={generating}
            className="inline-flex items-center gap-2 bg-[#3b82f6] hover:bg-[#2563eb] disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-3 rounded-lg text-sm font-semibold transition-colors"
          >
            {generating ? (
              <>
                <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Generating…
              </>
            ) : (
              <>▶ Generate Your First Report</>
            )}
          </button>
        </div>
      ) : (
        reports.map(r => (
          <div
            key={r.id}
            id={`report-${r.id}`}
            className="bg-[#111827] border border-[#1f2937] rounded-xl shadow-sm overflow-hidden"
          >
            <div className="bg-[#0a0f1e] px-6 py-4 border-b border-[#1f2937] flex justify-between items-center">
              <div>
                <span className="text-[#9ca3af] text-sm font-medium">Generated </span>
                <span
                  className="text-white font-medium cursor-help"
                  title={formatFullTimestamp(r.generated_at)}
                >
                  {formatRelativeTime(r.generated_at)}
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
                <button
                  onClick={() => downloadPDF(r)}
                  className="text-[#9ca3af] hover:text-white transition-colors text-sm flex items-center gap-1"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" x2="12" y1="15" y2="3" />
                  </svg>
                  Download as PDF
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

            {/* Source markets — clickable links to the underlying Polymarket pages */}
            {r.market_ids && r.market_ids.length > 0 && (
              <div className="px-8 pb-8">
                <h4 className="text-sm font-semibold text-white uppercase tracking-wide mb-3">
                  Markets Cited ({r.market_ids.length})
                </h4>
                <ul className="space-y-2">
                  {r.market_ids.map((mid) => {
                    const market = marketLookup.get(mid);
                    const url = resolveMarketUrl(market ?? { id: mid });
                    const label = market?.question ?? mid;
                    return (
                      <li key={mid}>
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-[#3b82f6] hover:text-[#60a5fa] hover:underline transition-colors inline-flex items-center gap-1.5"
                          >
                            <span className="truncate max-w-2xl">{label}</span>
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.25"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="shrink-0"
                              aria-hidden="true"
                            >
                              <path d="M7 17 17 7" />
                              <path d="M7 7h10v10" />
                            </svg>
                          </a>
                        ) : (
                          <span className="text-sm text-[#6b7280]">{label}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
