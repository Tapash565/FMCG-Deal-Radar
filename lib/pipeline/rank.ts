/**
 * Stage 7 — Rank + group. Pure, no network.
 *
 *   score = 0.35·relevance + 0.30·credibility + 0.20·recency + 0.15·deal-size
 *
 * See docs/pipeline.md#7-rank for what the weights encode.
 */

import type { Category, Deal } from '../types';
import { CATEGORIES } from '../types';
import { WINDOW_DAYS } from '../config';

export const WEIGHTS = { relevance: 0.35, credibility: 0.3, recency: 0.2, size: 0.15 };

/** Newsletter target. Deliberately small — a digest, not an archive. */
export const TOP_N = 12;

/**
 * Rough conversion to USD-millions, for BUCKETING ONLY.
 *
 * Never surfaced to the reader and never stored — a real conversion needs a rate and a
 * date, and guessing either corrupts the figure. This exists so a ₹500 cr deal and a
 * $60 mn deal land in the same bucket instead of being compared as bare numbers.
 */
function toUsdMillions(value?: number, currency?: string): number | undefined {
  if (value == null) return undefined;
  switch (currency) {
    case 'INR_CRORE':
      return value * 0.12; // 1 crore INR ~ USD 120k
    case 'USD_MILLION':
      return value;
    case 'INR':
      return value / 8_300_000;
    case 'USD':
      return value / 1_000_000;
    default:
      return undefined;
  }
}

/**
 * Coarse size score.
 *
 * Undisclosed scores NEUTRAL (0.5), not zero. "Terms not disclosed" is extremely
 * common, and zeroing it would bury every undisclosed deal regardless of how
 * interesting it is — punishing the deal for the press release's reticence.
 */
export function sizeScore(value?: number, currency?: string): number {
  const usdM = toUsdMillions(value, currency);
  if (usdM == null) return 0.5;
  if (usdM >= 500) return 1;
  if (usdM >= 100) return 0.85;
  if (usdM >= 25) return 0.7;
  if (usdM >= 5) return 0.5;
  return 0.35;
}

/**
 * Linear decay across the window. Today = 1, window edge = 0.
 *
 * windowDays MUST track ingest's window (hence the shared constant): if ingest widens
 * and this doesn't, every deal past the old edge scores 0 on recency and sinks — a
 * silent ranking bug with no error to notice.
 */
export function recencyScore(
  announcedDate: string,
  now = Date.now(),
  windowDays = WINDOW_DAYS,
): number {
  const ageDays = (now - new Date(announcedDate).getTime()) / 86_400_000;
  if (Number.isNaN(ageDays)) return 0.5;
  return Math.max(0, Math.min(1, 1 - ageDays / windowDays));
}

export function scoreDeal(d: Deal, now = Date.now()): number {
  return (
    WEIGHTS.relevance * d.relevanceConf +
    WEIGHTS.credibility * d.credibilityScore +
    WEIGHTS.recency * recencyScore(d.announcedDate, now) +
    WEIGHTS.size * sizeScore(d.dealValue, d.currency)
  );
}

export interface RankResult {
  selected: Deal[];
  grouped: { category: Category; deals: Deal[] }[];
  /** Parallel to selected, for surfacing the score in the UI. */
  scores: Map<string, number>;
}

export function rank(deals: Deal[], now = Date.now(), topN = TOP_N): RankResult {
  const scores = new Map(deals.map((d) => [d.dealId, scoreDeal(d, now)]));

  const selected = [...deals]
    .sort((a, b) => (scores.get(b.dealId) ?? 0) - (scores.get(a.dealId) ?? 0))
    .slice(0, topN);

  // Group in the canonical category order, not by size — a reader scanning for
  // "Personal care" should find it in the same place every issue. Rank still orders
  // within each group.
  const grouped = CATEGORIES.map((category) => ({
    category,
    deals: selected.filter((d) => d.category === category),
  })).filter((g) => g.deals.length > 0);

  return { selected, grouped, scores };
}
