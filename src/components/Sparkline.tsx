import React from 'react';

interface SparklineProps {
  /** Probability values in display order (oldest → newest), each 0..1 */
  data: number[];
  width?: number;
  height?: number;
  /** Below this absolute first→last delta the line renders gray (flat) */
  flatThreshold?: number;
}

/**
 * Tiny inline-SVG sparkline. Pure SVG path — no charting library needed
 * at this size. Trend color is derived from first vs last value:
 *   delta > +threshold  → green (up)
 *   delta < -threshold  → red   (down)
 *   |delta| < threshold → gray  (flat)
 *
 * If fewer than 2 points are provided, renders a small em-dash placeholder.
 */
export function Sparkline({
  data,
  width = 80,
  height = 24,
  flatThreshold = 0.02,
}: SparklineProps) {
  if (!data || data.length < 2) {
    return <span className="text-xs text-gray-500" aria-label="no trend data">—</span>;
  }

  // Clamp to [0,1] in case of bad data
  const cleaned = data.map((v) => Math.max(0, Math.min(1, Number(v) || 0)));

  const padding = 2;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  // Map index → x (evenly spaced), value → y (inverted: 1.0 at top, 0.0 at bottom).
  // Auto-scale Y to the data's own min/max so flat-ish series still show shape,
  // but only if the value range is tight; otherwise use the absolute 0..1 scale.
  const min = Math.min(...cleaned);
  const max = Math.max(...cleaned);
  const range = max - min;
  const useAutoScale = range > 0 && range < 0.5;
  const yScale = (v: number) => {
    if (useAutoScale) {
      // Map [min..max] → [innerH..0] with breathing room
      return padding + ((max - v) / (range || 1)) * innerH;
    }
    return padding + (1 - v) * innerH;
  };

  const points = cleaned.map((v, i) => {
    const x = padding + (i / (cleaned.length - 1)) * innerW;
    const y = yScale(v);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const path = `M${points.join(' L')}`;

  const delta = cleaned[cleaned.length - 1] - cleaned[0];
  const color =
    Math.abs(delta) < flatThreshold
      ? '#6b7280' // gray flat
      : delta > 0
      ? '#10b981' // green up
      : '#ef4444'; // red down

  const trendLabel =
    Math.abs(delta) < flatThreshold ? 'flat' : delta > 0 ? 'trending up' : 'trending down';

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`7-day probability trend, ${trendLabel}, ${(delta * 100).toFixed(0)} percentage points`}
      className="block"
    >
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
