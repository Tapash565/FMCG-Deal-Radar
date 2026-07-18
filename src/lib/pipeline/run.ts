/**
 * The pipeline, orchestrated once.
 *
 * Both entry points run THIS — `scripts/run-pipeline.ts` (offline seed) and
 * `/api/refresh` (live). That's the guarantee the architecture doc makes good on: the
 * seed and a live refresh produce the same shape of artifact, because they run the same
 * code, only with different budgets (docs/architecture.md — the two-budget table).
 *
 * The eight stages, in order:
 *   ingest → clean → dedup(url + embeddings) → relevance → extract → credibility → rank
 *   → newsletter
 *
 * This module owns the wiring and the funnel arithmetic. It does NOT own presentation:
 * the script keeps its rich console diagnostics, and the route returns a JSON summary —
 * both built from the `diagnostics` this returns, so neither has to re-run anything.
 */

import { ingest } from './ingest';
import { clean } from './clean';
import { clusterArticles, embedText } from './dedup';
import { assessRelevance, type RelevanceResult } from './relevance';
import { extractDeals } from './extract';
import { mergeDuplicateDeals } from './merge';
import { applyCredibility } from './credibility';
import { rank } from './rank';
import { draftNewsletter } from './newsletter';
import { embed } from '../hf';
import { WINDOW_DAYS } from '../config';
import type { Article, Category, Deal, RelevanceVerdict, Snapshot } from '../types';

export interface RunPipelineOptions {
  /** Rolling window in days. Defaults to the shared WINDOW_DAYS (90 for the seed). */
  windowDays?: number;
  /** Per-feed item cap — bounds fan-in against a tight budget. Passed through to ingest. */
  perFeedCap?: number;
  /** Total Google News queries to issue. Passed through to ingest. */
  queryLimit?: number;
  /** Injectable clock, so a fixed `now` gives deterministic windows in tests. */
  now?: number;
  /**
   * Progress sink. The offline seed run takes minutes; without this the operator stares
   * at a dead terminal. The route leaves it unset (silent). Called at stage boundaries.
   */
  log?: (message: string) => void;
}

export interface PipelineDiagnostics {
  /** Feeds that failed — a silent narrowing of coverage, surfaced by both callers. */
  failures: { feed: string; error: string }[];
  stats: RelevanceResult['stats'];
  /** Extracted records dropped for naming no target — the extract backstop firing. */
  rejected: { acquirer: string; target: string; dealType: string }[];
  timings: { stage: string; ms: number }[];
  grouped: { category: Category; deals: Deal[] }[];
  /** Deduped canonical articles — for tier counts and origin-yield reporting. */
  canonical: Article[];
  /** Confirmed-relevant articles, and their verdicts, for the relevanceConf drift check. */
  relevant: Article[];
  verdicts: Map<string, RelevanceVerdict>;
  totalMs: number;
}

export interface PipelineRun {
  snapshot: Snapshot;
  diagnostics: PipelineDiagnostics;
}

/**
 * The free half of stage 3: identical canonical URLs are the same article. Runs before
 * the paid embedding pass so we never spend an embedding on a URL-level duplicate.
 */
export function dedupeByUrl(articles: Article[]): Article[] {
  const seen = new Map<string, Article>();
  for (const a of articles) {
    const existing = seen.get(a.id);
    // Keep the better-tiered copy; ties break to the earlier publication.
    if (
      !existing ||
      a.sourceTier < existing.sourceTier ||
      (a.sourceTier === existing.sourceTier && a.publishedAt < existing.publishedAt)
    ) {
      seen.set(a.id, a);
    }
  }
  return [...seen.values()];
}

/**
 * Run the whole pipeline and assemble a Snapshot.
 *
 * Never throws for "no deals" — an empty-but-valid snapshot is a legitimate result the
 * callers decide what to do with (the script refuses to overwrite a good seed with it;
 * the route persists it). It throws only on genuine failure (e.g. a rate-limit abort
 * from Groq), which must not be mistaken for "found nothing".
 */
export async function runPipeline(opts: RunPipelineOptions = {}): Promise<PipelineRun> {
  const { windowDays = WINDOW_DAYS, perFeedCap, queryLimit, now = Date.now() } = opts;
  const log = opts.log ?? (() => {});

  const timings: { stage: string; ms: number }[] = [];
  async function timed<T>(stage: string, fn: () => Promise<T>): Promise<T> {
    const t0 = Date.now();
    const out = await fn();
    timings.push({ stage, ms: Date.now() - t0 });
    return out;
  }

  const startedAt = now;
  const to = new Date(now);
  const from = new Date(now - windowDays * 24 * 60 * 60 * 1000);

  // 1 — ingest
  log(`Ingesting — ${windowDays}d window, from ${from.toISOString().slice(0, 10)}`);
  const { articles: raw, failures } = await timed('ingest', () =>
    ingest({ windowDays, perFeedCap, queryLimit }),
  );

  // 2 — clean, then 3a — free URL-level dedup
  const cleaned = clean(raw);
  const urlDeduped = dedupeByUrl(cleaned);

  // 3b — embedding clustering (the paid half of dedup)
  log(`Embedding ${urlDeduped.length} articles for clustering...`);
  const vecs = await timed('embed', () => embed(urlDeduped.map(embedText)));
  const { clusters, canonical } = clusterArticles(urlDeduped, vecs);
  log(`  ${clusters.length} clusters, ${urlDeduped.length - canonical.length} collapsed`);

  // 4 — relevance (regex pre-filter → screen → confirm)
  log('Classifying relevance...');
  const { relevant, verdicts, stats } = await timed('relevance', () =>
    assessRelevance(canonical),
  );

  // 5 — extract structured deal fields
  log('Extracting deal fields...');
  const { deals: extracted, rejected } = await timed('extract', () =>
    extractDeals(relevant, verdicts),
  );

  // 5b — merge duplicate deals on structured identity, catching same-deal pairs whose
  // article text scored below the (deliberately conservative) cosine threshold. Runs
  // BEFORE credibility so the unioned clusters give the merged deal its full source count.
  const { deals: mergedDeals, clusters: mergedClusters, mergedCount } = mergeDuplicateDeals(
    extracted,
    clusters,
  );
  if (mergedCount > 0) log(`  merged ${mergedCount} duplicate deal(s) on identity`);

  // 6 — credibility (needs the full article set to count corroboration)
  const articlesById = new Map(urlDeduped.map((a) => [a.id, a]));
  const deals = applyCredibility(mergedDeals, mergedClusters, articlesById);

  // 7 — rank + group
  const { selected, grouped } = rank(deals, now);

  // 8 — newsletter draft (the one large-model call)
  log('Drafting newsletter...');
  const funnel = {
    ingested: raw.length,
    deduped: canonical.length,
    relevant: relevant.length,
    selected: selected.length,
  };
  const period = `${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}`;
  const newsletter = await timed('newsletter', () =>
    draftNewsletter({ grouped, deals: selected, funnel, windowDays, period, articlesById }),
  );

  const snapshot: Snapshot = {
    generatedAt: new Date(now).toISOString(),
    window: { from: from.toISOString(), to: to.toISOString() },
    funnel,
    deals: selected,
    newsletter,
    // Merged clusters, so the exported audit chain has one cluster per surviving deal
    // with every corroborating outlet folded in — matching what credibility scored.
    clusters: mergedClusters,
    articles: canonical,
  };

  return {
    snapshot,
    diagnostics: {
      failures,
      stats,
      rejected: rejected.map((r) => ({
        acquirer: r.acquirer,
        target: r.target,
        dealType: r.dealType,
      })),
      timings,
      grouped,
      canonical,
      relevant,
      verdicts,
      totalMs: Date.now() - startedAt,
    },
  };
}
