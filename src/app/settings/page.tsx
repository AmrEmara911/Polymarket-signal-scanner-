'use client';

import { useEffect, useState } from 'react';

const DEFAULT_STOCKS = "NVDA, ASML, MSFT, GOOGL, AMZN, META, TSMC, AMD, AMAT, AAPL, VISA, ADYEN, PAYPAL";
const SECTORS_LIST = [
  "AI & Machine Learning",
  "Semiconductors",
  "Cloud & Software",
  "Fintech & Payments",
  "Digital Assets & Crypto",
  "Consumer Technology",
  "Macro & Rates"
];

const INTERVAL_OPTIONS = [
  { value: 1,  label: 'Every 1 hour' },
  { value: 3,  label: 'Every 3 hours' },
  { value: 6,  label: 'Every 6 hours' },
  { value: 12, label: 'Every 12 hours' },
  { value: 24, label: 'Every 24 hours' },
  { value: 0,  label: 'Manual only (disables auto-run)' },
];

function calcNextRun(intervalHours: number): string {
  if (intervalHours === 0) return 'Auto-run disabled';
  const now = new Date();
  const msPerHour = 60 * 60 * 1000;
  const intervalMs = intervalHours * msPerHour;
  const msSinceMidnight = now.getTime() % (24 * msPerHour);
  const next = Math.ceil(msSinceMidnight / intervalMs) * intervalMs;
  const midnight = new Date(now);
  midnight.setUTCHours(0, 0, 0, 0);
  const nextDate = new Date(midnight.getTime() + next);
  return nextDate.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });
}

export default function SettingsPage() {
  const [stocks, setStocks] = useState(DEFAULT_STOCKS);
  const [sectors, setSectors] = useState<Record<string, boolean>>(
    SECTORS_LIST.reduce((acc, curr) => ({ ...acc, [curr]: true }), {})
  );
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Scheduler state
  const [intervalHours, setIntervalHours] = useState(6);
  const [autoEnabled, setAutoEnabled] = useState(true);
  const [schedulerSaving, setSchedulerSaving] = useState(false);
  const [schedulerSaved, setSchedulerSaved] = useState(false);
  const [schedulerError, setSchedulerError] = useState<string | null>(null);

  useEffect(() => {
    const savedStocks = localStorage.getItem('bitcap_watched_stocks');
    if (savedStocks) setStocks(savedStocks);

    const savedSectorsStr = localStorage.getItem('bitcap_watched_sectors');
    if (savedSectorsStr) {
      try { setSectors(JSON.parse(savedSectorsStr)); } catch {}
    }

    // Load scheduler config from API (source of truth)
    fetch('/api/scheduler/config')
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setIntervalHours(data.enabled ? data.intervalHours : 0);
          setAutoEnabled(data.enabled);
        }
      })
      .catch(() => {
        // Fall back to localStorage
        const saved = localStorage.getItem('schedulerConfig');
        if (saved) {
          try {
            const cfg = JSON.parse(saved);
            setIntervalHours(cfg.intervalHours ?? 6);
            setAutoEnabled(cfg.enabled ?? true);
          } catch {}
        }
      });
  }, []);

  const toggleSector = (sector: string) => {
    setSectors(prev => ({ ...prev, [sector]: !prev[sector] }));
  };

  const handleSave = async () => {
    setSaveError(null);
    try {
      // Persist watched stocks / sectors to localStorage
      localStorage.setItem('bitcap_watched_stocks', stocks);
      localStorage.setItem('bitcap_watched_sectors', JSON.stringify(sectors));

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save configuration');
    }
  };

  const handleSchedulerSave = async () => {
    setSchedulerSaving(true);
    setSchedulerError(null);
    const enabled = intervalHours !== 0 && autoEnabled;
    const hours = intervalHours === 0 ? 6 : intervalHours;

    // Persist to localStorage
    localStorage.setItem('schedulerConfig', JSON.stringify({ intervalHours: hours, enabled }));

    // POST to API to persist to Supabase and restart in-process scheduler
    try {
      const res = await fetch('/api/scheduler/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intervalHours: hours, enabled }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? 'Failed to save');
      setSchedulerSaved(true);
      setTimeout(() => setSchedulerSaved(false), 2000);
    } catch (err) {
      setSchedulerError(err instanceof Error ? err.message : 'Failed to save scheduler config');
    } finally {
      setSchedulerSaving(false);
    }
  };

  const effectiveInterval = intervalHours === 0 ? 6 : intervalHours;
  const nextRun = calcNextRun(autoEnabled && intervalHours !== 0 ? effectiveInterval : 0);

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-white tracking-tight">Configuration</h2>
        <p className="text-[#9ca3af] mt-2 text-sm">Update the parameters used by the AI to filter prediction markets.</p>
      </div>

      <div className="bg-[#111827] border border-[#1f2937] rounded-xl shadow-sm p-6 space-y-8">

        {/* Section 1 — Watched Stocks */}
        <div>
          <h3 className="text-lg font-semibold text-white mb-4">Watched Stocks</h3>
          <p className="text-sm text-[#9ca3af] mb-3">Add stock tickers (comma separated or one per line).</p>
          <textarea
            value={stocks}
            onChange={(e) => setStocks(e.target.value)}
            rows={4}
            className="w-full bg-[#0a0f1e] border border-[#1f2937] rounded-lg px-4 py-3 text-white focus:outline-none focus:border-[#3b82f6] transition-colors"
          />
        </div>

        <hr className="border-[#1f2937]" />

        {/* Section 2 — Watched Sectors */}
        <div>
          <h3 className="text-lg font-semibold text-white mb-4">Watched Sectors</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {SECTORS_LIST.map(sector => (
              <label key={sector} className="flex items-center space-x-3 cursor-pointer group">
                <div className="relative flex items-center justify-center">
                  <input
                    type="checkbox"
                    checked={sectors[sector] || false}
                    onChange={() => toggleSector(sector)}
                    className="peer appearance-none w-5 h-5 border border-[#374151] rounded bg-[#0a0f1e] checked:bg-[#3b82f6] checked:border-[#3b82f6] transition-colors cursor-pointer"
                  />
                  <svg className="absolute w-3 h-3 text-white opacity-0 peer-checked:opacity-100 pointer-events-none" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </div>
                <span className="text-[#d1d5db] group-hover:text-white transition-colors">{sector}</span>
              </label>
            ))}
          </div>
        </div>

      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={handleSave}
          className="bg-[#3b82f6] hover:bg-blue-600 text-white px-6 py-2.5 rounded-lg font-medium transition-colors"
        >
          Save Configuration
        </button>
        {saved && (
          <div className="flex items-center gap-2 text-[#10b981]">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
            <span className="text-sm font-medium">Configuration saved.</span>
          </div>
        )}
        {saveError && (
          <p className="text-sm text-[#ef4444]">{saveError}</p>
        )}
      </div>

      {/* Section 3 — Pipeline Schedule */}
      <div className="bg-[#111827] border border-[#1f2937] rounded-xl shadow-sm p-6 space-y-6">
        <div>
          <h3 className="text-lg font-semibold text-white mb-1">Pipeline Schedule</h3>
          <p className="text-sm text-[#9ca3af]">Control how often the scanner automatically runs ingest → analyze → report.</p>
        </div>

        {/* Frequency dropdown */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-[#d1d5db]">Run frequency</label>
          <select
            value={intervalHours}
            onChange={e => {
              const v = Number(e.target.value);
              setIntervalHours(v);
              if (v === 0) setAutoEnabled(false);
              else setAutoEnabled(true);
            }}
            className="w-full sm:w-72 bg-[#0a0f1e] border border-[#1f2937] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#3b82f6] transition-colors"
          >
            {INTERVAL_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Auto-run toggle */}
        <div className="flex items-center justify-between max-w-sm">
          <span className="text-sm font-medium text-[#d1d5db]">Auto-run enabled</span>
          <button
            onClick={() => setAutoEnabled(prev => !prev)}
            disabled={intervalHours === 0}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed ${
              autoEnabled && intervalHours !== 0 ? 'bg-[#3b82f6]' : 'bg-[#374151]'
            }`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              autoEnabled && intervalHours !== 0 ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>

        {/* Next run info */}
        <p className="text-sm text-[#9ca3af]">
          Next scheduled run:{' '}
          <span className={`font-medium ${autoEnabled && intervalHours !== 0 ? 'text-[#10b981]' : 'text-[#6b7280]'}`}>
            {nextRun}
          </span>
        </p>

        {schedulerError && (
          <p className="text-sm text-[#ef4444]">{schedulerError}</p>
        )}

        <div className="flex items-center gap-4">
          <button
            onClick={handleSchedulerSave}
            disabled={schedulerSaving}
            className="bg-[#3b82f6] hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-lg font-medium transition-colors"
          >
            {schedulerSaving ? 'Saving...' : 'Save Schedule'}
          </button>
          {schedulerSaved && (
            <div className="flex items-center gap-2 text-[#10b981]">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
              <span className="text-sm font-medium">Schedule saved &amp; applied</span>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
