/**
 * Stage 6 — Credibility. Source tier + independent corroboration. No network.
 *
 * This measures who reported a deal and how many outlets carried it. It is NOT
 * fact-checking, and the badge is shown to the reader rather than folded silently
 * into rank precisely because the signal is this coarse.
 * See docs/pipeline.md#6-credibility.
 */

import type { Article, Cluster, Confidence, Deal, SourceTier } from '../types';

/** Base score by tier. T3 is not zero — unknown is not the same as discredited. */
const TIER_SCORE: Record<SourceTier, number> = { 1: 0.75, 2: 0.5, 3: 0.25 };

/** Each independent corroborating source beyond the first. Capped below. */
const CORROBORATION_STEP = 0.12;
const MAX_CORROBORATION_BONUS = 0.25;

export function badgeFor(score: number): Confidence {
  if (score >= 0.75) return 'High';
  if (score >= 0.45) return 'Med';
  return 'Low';
}

/**
 * Distinct publishers in a cluster.
 *
 * Counts unified source NAMES, not URLs: three articles from one publisher are one
 * source. Counting them as three would manufacture confidence out of syndication —
 * which is why stage 2's source unification is load-bearing here.
 */
export function corroboratingSources(members: Article[]): string[] {
  return [...new Set(members.map((m) => m.source))];
}

export function scoreCredibility(
  canonical: Article,
  members: Article[],
): { score: number; sources: string[]; confidence: Confidence } {
  const sources = corroboratingSources(members);

  // Best tier in the cluster, not just the canonical's — if a T1 outlet also carried
  // it, that's evidence, even when the canonical happens to be the T1 article anyway.
  const bestTier = Math.min(...members.map((m) => m.sourceTier)) as SourceTier;
  const base = TIER_SCORE[bestTier] ?? TIER_SCORE[3];

  const bonus = Math.min((sources.length - 1) * CORROBORATION_STEP, MAX_CORROBORATION_BONUS);
  const score = Math.min(base + bonus, 1);

  return { score, sources, confidence: badgeFor(score) };
}

export function applyCredibility(
  deals: Omit<Deal, 'credibilityScore' | 'corroboratingSources' | 'confidence'>[],
  clusters: Cluster[],
  articlesById: Map<string, Article>,
): Deal[] {
  const clusterById = new Map(clusters.map((c) => [c.clusterId, c]));

  return deals.map((d) => {
    const cluster = clusterById.get(d.clusterId);
    const members = (cluster?.memberIds ?? [d.dealId])
      .map((id) => articlesById.get(id))
      .filter((a): a is Article => a != null);

    const canonical = articlesById.get(d.dealId);
    const { score, sources, confidence } = scoreCredibility(
      canonical ?? members[0],
      members.length ? members : [canonical!],
    );

    return { ...d, credibilityScore: score, corroboratingSources: sources, confidence };
  });
}
