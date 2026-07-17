/**
 * Pure display formatting — no I/O, no Node built-ins.
 *
 * Split out of snapshot.ts so both the server (page, exports) and client components (the
 * interactive deals table) can share one formatting source of truth. snapshot.ts imports
 * node:fs, so a client component importing formatValue from it would drag the filesystem
 * into the browser bundle; importing from here can't.
 */

/** "3 days ago" — the header leads with this, so staleness is never implied away. */
export function relativeAge(iso: string, now = Date.now()): string {
  const ms = now - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** "₹2,955 cr" / "$8 mn" / "Undisclosed" — never a blank cell. */
export function formatValue(value?: number, currency?: string): string {
  if (value == null) return 'Undisclosed';
  const n = new Intl.NumberFormat('en-IN').format(value);
  switch (currency) {
    case 'INR_CRORE':
      return `₹${n} cr`;
    case 'USD_MILLION':
      return `$${n} mn`;
    case 'INR':
      return `₹${n}`;
    case 'USD':
      return `$${n}`;
    default:
      return currency ? `${n} ${currency}` : n;
  }
}

/**
 * Rough USD-millions, for SORTING ONLY — never shown to the reader.
 *
 * A shared comparable so a ₹500 cr deal and a $60 mn deal sort by magnitude instead of by
 * bare number. Undisclosed returns null: the table sorts those to the end rather than
 * pretending they're worth zero. Mirrors rank.ts's private bucketing; kept lightweight
 * here so the client table needn't import the ranking module.
 */
export function usdMillions(value?: number, currency?: string): number | null {
  if (value == null) return null;
  switch (currency) {
    case 'INR_CRORE':
      return value * 0.12;
    case 'USD_MILLION':
      return value;
    case 'INR':
      return value / 8_300_000;
    case 'USD':
      return value / 1_000_000;
    default:
      return null;
  }
}
