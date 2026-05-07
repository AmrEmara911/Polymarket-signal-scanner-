import React from 'react';
import { buildPolymarketUrl } from '@/lib/polymarket';

/**
 * Resolve the best Polymarket URL for a market: prefer the pre-computed
 * `market_url` from the DB, fall back to building one from slug, then
 * fall back to the id-based URL. This handles old rows that pre-date
 * the `market_url` column.
 */
export function resolveMarketUrl(market: {
  market_url?: string | null;
  slug?: string | null;
  id?: string | null;
} | null | undefined): string | null {
  if (!market) return null;
  if (market.market_url) return market.market_url;
  if (market.id) return buildPolymarketUrl(market.slug, market.id);
  return null;
}

interface MarketLinkIconProps {
  url: string;
  /** Tailwind color classes — defaults to subtle gray that brightens on hover */
  className?: string;
}

/**
 * Small inline external-link icon button. Opens Polymarket in a new tab
 * with safe rel attrs. Uses `e.stopPropagation()` so it doesn't trigger
 * row-expand handlers on parent <tr>.
 */
export function MarketLinkIcon({ url, className = '' }: MarketLinkIconProps) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title="View on Polymarket"
      aria-label="View on Polymarket"
      className={`inline-flex items-center justify-center w-4 h-4 text-[#6b7280] hover:text-[#3b82f6] transition-colors shrink-0 ${className}`}
    >
      {/* lucide-react `arrow-up-right` path, inlined to avoid the dep */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M7 17 17 7" />
        <path d="M7 7h10v10" />
      </svg>
    </a>
  );
}

interface MarketLinkButtonProps {
  url: string;
}

/**
 * Larger pill-shaped button used in expanded rows / report footers.
 * Same target/rel as the icon variant.
 */
export function MarketLinkButton({ url }: MarketLinkButtonProps) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#3b82f6]/10 hover:bg-[#3b82f6]/20 text-[#3b82f6] text-sm font-medium transition-colors border border-[#3b82f6]/30"
    >
      View Live Market on Polymarket
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M7 17 17 7" />
        <path d="M7 7h10v10" />
      </svg>
    </a>
  );
}
