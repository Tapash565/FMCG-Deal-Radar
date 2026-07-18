/**
 * Stage 1 — Ingest. Pull raw items from Google News RSS queries + direct trade feeds.
 *
 * A failing feed is logged and skipped, never fatal: one dead RSS endpoint must not
 * take down a refresh. See docs/pipeline.md#1-ingest.
 */

import Parser from 'rss-parser';
import { createHash } from 'node:crypto';
import { DIRECT_FEEDS, buildQueries, isBlockedSource, type FeedSource } from '../sources';
import { WINDOW_DAYS } from '../config';
import type { Article } from '../types';

/** Google News puts the publisher in a <source> element; rss-parser needs to be told. */
type RawItem = {
  title?: string;
  link?: string;
  pubDate?: string;
  isoDate?: string;
  contentSnippet?: string;
  content?: string;
  source?: { _?: string; $?: { url?: string } } | string;
};

const parser: Parser<unknown, RawItem> = new Parser({
  timeout: 8000,
  customFields: { item: ['source'] },
});

export interface IngestOptions {
  /** Rolling window. Items older than this are dropped at ingest. */
  windowDays?: number;
  /** Per-feed item cap — bounds fan-in against the 60s function budget. */
  perFeedCap?: number;
  /** Total Google News queries to issue. */
  queryLimit?: number;
}

export interface IngestResult {
  articles: Article[];
  /** Feeds that failed, for surfacing in logs — a silent narrowing of coverage. */
  failures: { feed: string; error: string }[];
}

export function articleId(url: string): string {
  return createHash('sha1').update(url).digest('hex').slice(0, 12);
}

/** Google News titles arrive as "Headline - Publisher"; the suffix is the source. */
function splitTitleSource(title: string): { title: string; source?: string } {
  const idx = title.lastIndexOf(' - ');
  if (idx === -1) return { title };
  return { title: title.slice(0, idx).trim(), source: title.slice(idx + 3).trim() };
}

function readSource(item: RawItem): string | undefined {
  if (typeof item.source === 'string') return item.source;
  if (item.source && typeof item.source === 'object' && item.source._) return item.source._;
  return undefined;
}

async function fetchFeed(
  feed: FeedSource,
  cap: number,
  cutoff: Date,
): Promise<Article[]> {
  const parsed = await parser.parseURL(feed.url);
  const out: Article[] = [];

  for (const item of parsed.items ?? []) {
    if (out.length >= cap) break;
    if (!item.link || !item.title) continue;

    const dateStr = item.isoDate ?? item.pubDate;
    if (!dateStr) continue;
    const published = new Date(dateStr);
    if (Number.isNaN(published.getTime()) || published < cutoff) continue;

    const { title, source: fromTitle } = splitTitleSource(item.title);
    // Prefer the explicit <source> element; fall back to the title suffix, then the
    // feed's own name (direct feeds carry neither).
    const source = readSource(item) ?? fromTitle ?? feed.name;

    // Drop stock-data mills and wrong-sector trade press at the door — they never carry
    // an FMCG deal, so embedding and classifying them is pure wasted budget. See
    // sources.ts#BLOCKED_SOURCES.
    if (isBlockedSource(source)) continue;

    out.push({
      id: articleId(item.link),
      title,
      url: item.link,
      source,
      sourceTier: 3, // provisional — clean() unifies the name, then tiers it
      publishedAt: published.toISOString(),
      snippet: item.contentSnippet ?? item.content ?? '',
      queryTerm: feed.name,
    });
  }

  return out;
}

export async function ingest(opts: IngestOptions = {}): Promise<IngestResult> {
  // queryLimit is left to buildQueries' own default — pinning it here previously
  // capped the grid at 12 regardless of what that default said.
  const { windowDays = WINDOW_DAYS, perFeedCap = 25, queryLimit } = opts;

  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const feeds: FeedSource[] = [...buildQueries(queryLimit), ...DIRECT_FEEDS];

  const settled = await Promise.allSettled(
    feeds.map((f) => fetchFeed(f, perFeedCap, cutoff)),
  );

  const articles: Article[] = [];
  const failures: { feed: string; error: string }[] = [];

  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      articles.push(...result.value);
    } else {
      failures.push({
        feed: feeds[i].name,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  });

  return { articles, failures };
}
