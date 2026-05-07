/**
 * Frontend-only date formatting utilities.
 * Pure functions, no backend dependencies — safe to import from client components.
 */

/**
 * Convert an absolute timestamp to a short relative-time string suitable
 * for tight UI cells: "just now", "12s ago", "5m ago", "3h ago", "2d ago",
 * or a localized date for anything older than a week.
 */
export function formatRelativeTime(date: Date | string): string {
  const now = new Date();
  const then = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(then.getTime())) return '—';

  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);

  if (seconds < 0) return 'just now'; // clock skew safety
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}d ago`;
  return then.toLocaleDateString();
}

/**
 * Long-form timestamp suitable for `title` tooltips and full date displays.
 * Example: "May 7, 2026, 2:19 PM"
 */
export function formatFullTimestamp(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
