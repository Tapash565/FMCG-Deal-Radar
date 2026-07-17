/**
 * Category accent colours, shared so the deals table and the newsletter preview mark a
 * category the same way. A restrained dot, not a full colour-coded row — enough to scan
 * by, not enough to shout. Client-safe (no node imports).
 */

import type { Category, Confidence } from '@/lib/types';

/** Tailwind background classes for the small category dot, one per category. */
export const CATEGORY_DOT: Record<Category, string> = {
  Food: 'bg-amber-500',
  Beverage: 'bg-sky-500',
  'Personal care': 'bg-violet-500',
  'Home care': 'bg-teal-500',
  Other: 'bg-zinc-400',
};

/** Top-border accent for the newsletter deal cards — same hue as the category dot. */
export const CATEGORY_BORDER: Record<Category, string> = {
  Food: 'border-t-amber-500',
  Beverage: 'border-t-sky-500',
  'Personal care': 'border-t-violet-500',
  'Home care': 'border-t-teal-500',
  Other: 'border-t-zinc-400',
};

/**
 * Confidence badge colours. Shared by the deals table and the newsletter preview so a
 * "High" badge looks identical wherever it appears — the dashboard and the artifact it
 * exports must not disagree even on colour.
 */
export const CONFIDENCE_BADGE: Record<Confidence, string> = {
  High: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  Med: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  Low: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400',
};

/**
 * The terminal-style micro-label: uppercase JetBrains Mono, tight tracking. Used for
 * section headers, column headers, and meta badges so they read as system labels rather
 * than prose. Colour is applied by the caller.
 */
export const MICRO_LABEL = 'font-mono text-[11px] font-semibold uppercase tracking-[0.08em]';
