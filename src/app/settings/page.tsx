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

export default function SettingsPage() {
  const [stocks, setStocks] = useState(DEFAULT_STOCKS);
  const [sectors, setSectors] = useState<Record<string, boolean>>(
    SECTORS_LIST.reduce((acc, curr) => ({ ...acc, [curr]: true }), {})
  );
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const savedStocks = localStorage.getItem('bitcap_watched_stocks');
    if (savedStocks) setStocks(savedStocks);

    const savedSectorsStr = localStorage.getItem('bitcap_watched_sectors');
    if (savedSectorsStr) {
      try {
        setSectors(JSON.parse(savedSectorsStr));
      } catch {}
    }
  }, []);

  const toggleSector = (sector: string) => {
    setSectors(prev => ({ ...prev, [sector]: !prev[sector] }));
  };

  const handleSave = () => {
    localStorage.setItem('bitcap_watched_stocks', stocks);
    localStorage.setItem('bitcap_watched_sectors', JSON.stringify(sectors));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-white tracking-tight">Configuration</h2>
        <p className="text-[#9ca3af] mt-2 text-sm">Update the parameters used by the AI to filter prediction markets.</p>
      </div>

      <div className="bg-[#111827] border border-[#1f2937] rounded-xl shadow-sm p-6 space-y-8">
        
        {/* Section 1 */}
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

        {/* Section 2 */}
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
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"></path></svg>
            <span className="text-sm font-medium">Settings saved to localStorage</span>
          </div>
        )}
      </div>

    </div>
  );
}
