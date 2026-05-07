import React from 'react';

interface ProbChangeBadgeProps {
  /** Fractional change, e.g. 0.18 = +18 percentage points */
  change: number | null | undefined;
  /** Minimum absolute change to display (default 0.05 = 5pp) */
  threshold?: number;
}

/**
 * Renders a colored badge showing 24h probability movement in percentage
 * points (pp). Returns null if change is below threshold or missing.
 *
 * "pp" (percentage points) is the analytically correct unit for changes
 * in probability — using "%" would imply a relative change, which is wrong.
 */
export function ProbChangeBadge({ change, threshold = 0.05 }: ProbChangeBadgeProps) {
  if (change == null || Math.abs(change) < threshold) return null;

  const isUp = change > 0;
  const ppValue = Math.round(change * 100);
  const sign = isUp ? '+' : '';

  return (
    <span
      className={`text-xs font-semibold px-1.5 py-0.5 rounded w-fit inline-block ${
        isUp
          ? 'bg-[#10b981]/20 text-[#10b981]'
          : 'bg-[#ef4444]/20 text-[#ef4444]'
      }`}
    >
      {isUp ? '↑' : '↓'} {sign}{ppValue}pp
    </span>
  );
}
