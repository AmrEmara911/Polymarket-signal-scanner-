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

type Sensitivity = 'strict' | 'balanced' | 'broad';

const SENSITIVITY_OPTIONS: { value: Sensitivity; label: string; description: string; expected: string }[] = [
  {
    value: 'strict',
    label: 'Strict',
    description: 'Only direct company events for confirmed BIT Capital holdings. High conviction only.',
    expected: '5–15 signals per scan',
  },
  {
    value: 'balanced',
    label: 'Balanced',
    description: 'Company events + macro signals + regulatory events affecting portfolio sectors.',
    expected: '15–30 signals per scan',
  },
  {
    value: 'broad',
    label: 'Broad',
    description: 'Everything that could plausibly affect tech equities. Includes adjacent sectors and speculative connections.',
    expected: '30–60 signals per scan',
  },
];

const SENSITIVITY_INDEX: Record<Sensitivity, number> = { strict: 0, balanced: 1, broad: 2 };
const INDEX_SENSITIVITY: Sensitivity[] = ['strict', 'balanced', 'broad'];

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
  const [sensitivity, setSensitivity] = useState<Sensitivity>('balanced');
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

    // Load sensitivity from localStorage (DB is source of truth for analyze route;
    // localStorage keeps the UI in sync until the next explicit Save)
    const savedSensitivity = localStorage.getItem('filter_sensitivity') as Sensitivity | null;
    if (savedSensitivity && INDEX_SENSITIVITY.includes(savedSensitivity)) {
      setSensitivity(savedSensitivity);
    }

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

  // Slider change — updates local state only; backend write happens on Save
  const handleSensitivityChange = (value: Sensitivity) => {
    setSensitivity(value);
    localStorage.setItem('filter_sensitivity', value);
  };

  const handleSave = async () => {
    setSaveError(null);
    try {
      // Persist sensitivity to DB so the analyze route picks it up
      const res = await fetch('/api/scheduler/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'filter_sensitivity', value: sensitivity }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? 'Failed to save sensitivity');

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
            <span className="text-sm font-medium">Configuration saved. Applied on next pipeline run.</span>
          </div>
        )}
        {saveError && (
          <p className="text-sm text-[#ef4444]">{saveError}</p>
        )}
      </div>

      {/* Section 3 — Filter Sensitivity */}
      <div className="bg-[#111827] border border-[#1f2937] rounded-xl shadow-sm p-6 space-y-6">
        <div>
          <h3 className="text-lg font-semibold text-white mb-1">Filter Sensitivity</h3>
          <p className="text-sm text-[#9ca3af]">Controls how aggressively the LLM filters prediction markets. Applied on the next pipeline run.</p>
        </div>

        {/* Slider */}
        <div className="space-y-4">
          <div className="relative pt-1">
            {/* Track labels */}
            <div className="flex justify-between mb-3">
              {SENSITIVITY_OPTIONS.map((opt, i) => (
                <button
                  key={opt.value}
                  onClick={() => handleSensitivityChange(opt.value)}
                  className={`text-sm font-semibold transition-colors ${
                    sensitivity === opt.value ? 'text-[#3b82f6]' : 'text-[#6b7280] hover:text-[#9ca3af]'
                  }`}
                  style={{ width: '33%', textAlign: i === 0 ? 'left' : i === 2 ? 'right' : 'center' }}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Range input */}
            <div className="relative">
              <input
                type="range"
                min={0}
                max={2}
                step={1}
                value={SENSITIVITY_INDEX[sensitivity]}
                onChange={(e) => handleSensitivityChange(INDEX_SENSITIVITY[Number(e.target.value)])}
                className="w-full h-2 rounded-full appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${SENSITIVITY_INDEX[sensitivity] * 50}%, #1f2937 ${SENSITIVITY_INDEX[sensitivity] * 50}%, #1f2937 100%)`,
                  accentColor: '#3b82f6',
                }}
              />
              {/* Tick marks */}
              <div className="flex justify-between px-0.5 mt-1">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className={`w-1 h-1 rounded-full ${SENSITIVITY_INDEX[sensitivity] >= i ? 'bg-[#3b82f6]' : 'bg-[#374151]'}`}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Active mode description */}
          <div className="bg-[#0a0f1e] border border-[#1f2937] rounded-lg p-4 space-y-1">
            {SENSITIVITY_OPTIONS.filter(opt => opt.value === sensitivity).map(opt => (
              <div key={opt.value}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-semibold text-white">{opt.label} mode</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-[#3b82f6]/20 text-[#3b82f6] font-medium">
                    {opt.expected}
                  </span>
                  <span className="text-xs text-[#6b7280] ml-auto">Saved on next ↓</span>
                </div>
                <p className="text-sm text-[#9ca3af]">{opt.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Section 4 — Pipeline Schedule */}
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
