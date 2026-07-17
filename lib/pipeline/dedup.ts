/**
 * Stage 3 — De-dup. Exact URL → embedding clusters → fuzzy title guard.
 *
 * Thresholds here are calibrated empirically against live data, not assumed.
 * See scripts/calibrate-dedup.ts and docs/pipeline.md#3-de-dup.
 */

import { cosine } from '../hf';
import type { Article, Cluster } from '../types';

/**
 * Cosine floor for "same story". CALIBRATED against 7,626 live pairs —
 * see scripts/calibrate-dedup.ts and docs/pipeline.md#calibration.
 *
 * Not the plan's 0.85: that misses real duplicates. Measured on live data, the
 * L'Oréal/Innovist pair (unambiguously one deal, two outlets) scores 0.818, and a
 * SwitchOn funding pair scores 0.815 — both would survive as duplicates at 0.85.
 *
 * 0.80 sits just above the first observed false merge (0.795, two unrelated
 * refurbished-electronics stories). The margin is thin and the bands genuinely
 * touch: a true duplicate scores 0.796. Where they overlap we bias toward
 * under-merging, because the failure modes are not symmetric — an over-merge
 * deletes a real deal from the newsletter, while an under-merge only shows it
 * twice. Redundancy is visible and survivable; silent loss is neither.
 */
export const COSINE_THRESHOLD = 0.8;

/**
 * Token-sort ratio at which two titles are "the same string, reordered" — a merge
 * on its own, no embedding needed. Catches syndicated copy running under a
 * near-identical headline.
 *
 * Note this is an OR, not an AND. The plan specified token-sort >= 90 as a *guard*
 * that must also pass before merging; calibration showed that inverts the truth.
 * Real duplicates score 28–74 here (headlines of the same story share remarkably
 * few literal tokens), so requiring >= 90 would have blocked nearly every genuine
 * merge. See docs/pipeline.md#why-the-guard-became-a-fast-path.
 */
export const TITLE_MATCH_RATIO = 95;

/** Levenshtein distance. Titles are short; the O(n·m) DP is irrelevant here. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = [...curr];
  }
  return prev[b.length];
}

function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

/**
 * Token-sort ratio, 0–100: sort each title's tokens, then compare as strings.
 *
 * Word order stops mattering, so "HUL acquires Minimalist" and "Minimalist
 * acquired by HUL" score high. Uses normalized Levenshtein rather than difflib's
 * matching-block ratio — simpler, and the thresholds are calibrated against this
 * implementation anyway.
 */
export function tokenSortRatio(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na && !nb) return 100;
  const max = Math.max(na.length, nb.length);
  if (max === 0) return 100;
  return Math.round((1 - levenshtein(na, nb) / max) * 100);
}

/**
 * Should two articles collapse into one cluster?
 *
 * Two independent signals, either sufficient:
 *   1. Cosine >= COSINE_THRESHOLD — the same story in different words.
 *   2. Token-sort >= TITLE_MATCH_RATIO — literally the same headline, reordered.
 *
 * The original design made (2) a precondition on (1). Calibration inverted it: real
 * duplicates share almost no literal tokens, so ANDing the two blocked the merges we
 * most wanted. As an OR, (2) adds recall for syndicated copy that (1) already tends
 * to catch, and costs nothing when it doesn't fire.
 *
 * The over-merge case the guard was meant to stop — "Dabur acquires stake in
 * Badshah" vs "Marico acquires stake in Plix" — turns out to score 0.285, nowhere
 * near the threshold. Cosine handles it alone; the feared failure never appeared.
 */
export function shouldMerge(
  a: Article,
  b: Article,
  similarity: number,
  opts: { cosineThreshold?: number; titleMatchRatio?: number } = {},
): boolean {
  const { cosineThreshold = COSINE_THRESHOLD, titleMatchRatio = TITLE_MATCH_RATIO } = opts;

  if (similarity >= cosineThreshold) return true;
  return tokenSortRatio(a.title, b.title) >= titleMatchRatio;
}

/** The text we embed. Snippet adds context the headline alone often omits. */
export function embedText(a: Article): string {
  return `${a.title}. ${a.snippet}`.slice(0, 512);
}

/** Highest tier wins; ties break to the earliest publication. */
function pickCanonical(members: Article[]): Article {
  return [...members].sort(
    (x, y) => x.sourceTier - y.sourceTier || x.publishedAt.localeCompare(y.publishedAt),
  )[0];
}

export interface ClusterResult {
  clusters: Cluster[];
  /** One canonical article per cluster — what the rest of the pipeline sees. */
  canonical: Article[];
}

/**
 * Single-link agglomerative clustering over the similarity graph.
 *
 * Single-link (transitive: A~B, B~C ⇒ same cluster) suits news, where a story
 * drifts across rewrites — A and C may not resemble each other directly while both
 * clearly match B.
 */
export function clusterArticles(
  articles: Article[],
  embeddings: number[][],
  opts: { cosineThreshold?: number; titleMatchRatio?: number } = {},
): ClusterResult {
  const n = articles.length;
  const parent = Array.from({ length: n }, (_, i) => i);

  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (i: number, j: number) => {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[rj] = ri;
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sim = cosine(embeddings[i], embeddings[j]);
      if (shouldMerge(articles[i], articles[j], sim, opts)) union(i, j);
    }
  }

  const groups = new Map<number, Article[]>();
  articles.forEach((a, i) => {
    const root = find(i);
    const g = groups.get(root);
    if (g) g.push(a);
    else groups.set(root, [a]);
  });

  const clusters: Cluster[] = [];
  const canonical: Article[] = [];

  for (const members of groups.values()) {
    const rep = pickCanonical(members);
    clusters.push({
      clusterId: rep.id,
      canonicalId: rep.id,
      memberIds: members.map((m) => m.id),
      size: members.length,
    });
    canonical.push(rep);
  }

  return { clusters, canonical };
}
