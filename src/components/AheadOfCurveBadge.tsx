import React from 'react';

interface AheadOfCurveBadgeProps {
  /** When false/null, renders nothing (no placeholder). */
  flagged: boolean | null | undefined;
}

/**
 * Small purple/violet badge marking signals that fit BIT Capital's
 * "Ahead of the Curve" thesis — contested probability range, sharp recent
 * movement, credible volume.
 *
 * Renders nothing when not flagged so the badge doesn't take up row space
 * for the majority of signals that aren't ahead-of-curve.
 */
export function AheadOfCurveBadge({ flagged }: AheadOfCurveBadgeProps) {
  if (!flagged) return null;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-violet-500/15 text-violet-300 border border-violet-500/30 whitespace-nowrap"
      title="Probability is in a contested range with sharp recent movement on credible volume — fits the BIT Capital 'act before consensus' thesis."
    >
      ⚡ Ahead of Curve
    </span>
  );
}
