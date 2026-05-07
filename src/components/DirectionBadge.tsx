import React from 'react';

/**
 * Map a raw signal_direction string from the database to one of four
 * canonical states. Handles both the LLM's strict enum values
 * (positive/negative/mixed/unclear) and free-text fallbacks.
 *
 * Word-boundary regex prevents false positives like "support" matching "up"
 * or "upset" matching "up".
 */
export type DirectionState = 'bullish' | 'bearish' | 'neutral' | 'unknown';

export function parseDirection(direction: string | null | undefined): DirectionState {
  if (!direction) return 'unknown';
  const lower = direction.toLowerCase().trim();

  // Primary: strict LLM enum values
  if (lower === 'positive') return 'bullish';
  if (lower === 'negative') return 'bearish';
  if (lower === 'mixed' || lower === 'unclear') return 'neutral';

  // Fallback: word-boundary keyword matching for free-text variants
  if (/\b(bullish|positive|rise|risen|rising|rose|increase|increased|increasing|gain|gains|upside)\b/.test(lower)) {
    return 'bullish';
  }
  if (/\b(bearish|negative|fall|fell|falling|decrease|decreased|decreasing|decline|declining|declined|loss|losses|downside)\b/.test(lower)) {
    return 'bearish';
  }
  // Standalone "up" / "down" — only match when isolated
  if (/^up$|\bup\b(?!set|side|date|grade|hill|town|stairs|load)/.test(lower)) return 'bullish';
  if (/^down$|\bdown\b(?!town|side|stairs|load|grade|fall)/.test(lower)) return 'bearish';

  return 'neutral';
}

interface DirectionBadgeProps {
  direction: string | null | undefined;
  /** Show pill style with background (default) or plain colored text */
  variant?: 'pill' | 'text';
}

/**
 * Renders a colored badge representing market direction (bullish / bearish /
 * neutral / unknown). Uses the same pill style as urgency badges for
 * visual consistency.
 */
export function DirectionBadge({ direction, variant = 'pill' }: DirectionBadgeProps) {
  const state = parseDirection(direction);

  const baseClass = variant === 'pill'
    ? 'px-2.5 py-1 rounded-full text-xs font-semibold inline-block'
    : 'text-xs font-semibold';

  if (state === 'bullish') {
    return (
      <span className={`${baseClass} ${variant === 'pill' ? 'bg-[#10b981]/20 text-[#10b981]' : 'text-[#10b981]'}`}>
        ↑ BULLISH
      </span>
    );
  }
  if (state === 'bearish') {
    return (
      <span className={`${baseClass} ${variant === 'pill' ? 'bg-[#ef4444]/20 text-[#ef4444]' : 'text-[#ef4444]'}`}>
        ↓ BEARISH
      </span>
    );
  }
  if (state === 'neutral') {
    return (
      <span className={`${baseClass} ${variant === 'pill' ? 'bg-[#374151] text-gray-300' : 'text-gray-300'}`}>
        ◆ NEUTRAL
      </span>
    );
  }
  return <span className="text-xs text-gray-500">—</span>;
}
