/**
 * Stage 2 — Clean. Pure normalization, no network.
 *
 * Load-bearing for everything downstream: exact-URL dedup depends on canonical
 * URLs, and credibility tiering + corroboration counting depend on unified source
 * names. Getting this wrong quietly inflates corroboration counts, which quietly
 * inflates confidence badges. See docs/pipeline.md#2-clean.
 */

import { unifySourceName, tierFor } from '../sources';
import type { Article } from '../types';
import { articleId } from './ingest';

/** Params that identify a campaign, not a document. */
const TRACKING_PARAMS = [
  /^utm_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^mc_(cid|eid)$/i,
  /^igshid$/i,
  /^ref$/i,
  /^referrer$/i,
  /^source$/i,
  /^cmpid$/i,
  /^ncid$/i,
];

const isTracking = (key: string) => TRACKING_PARAMS.some((re) => re.test(key));

export function stripHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Canonicalize a URL: strip tracking params, normalize scheme/host/trailing slash.
 *
 * Older Google News wrappers carry the publisher URL in a `url=` param, which we
 * unwrap for free. The modern `/rss/articles/CBMi...` form encodes the target and
 * can only be resolved by following the redirect — a network call per article, which
 * we deliberately don't spend here. Consequence: those URLs stay as Google News
 * links, so exact-URL dedup can't collapse them. The embedding stage catches those.
 */
export function canonicalizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return raw.trim();
  }

  const wrapped = url.searchParams.get('url');
  if (url.hostname.endsWith('news.google.com') && wrapped) {
    try {
      url = new URL(wrapped);
    } catch {
      /* fall through with the wrapper */
    }
  }

  for (const key of [...url.searchParams.keys()]) {
    if (isTracking(key)) url.searchParams.delete(key);
  }

  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  url.hash = '';
  if (url.pathname !== '/' && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }
  url.searchParams.sort();

  return url.toString();
}

/** Derive a publisher name from a hostname when the feed gave us nothing usable. */
function sourceFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Unknown';
  }
}

export function clean(articles: Article[]): Article[] {
  return articles.map((a) => {
    const url = canonicalizeUrl(a.url);

    const rawSource = a.source?.trim() ? a.source : sourceFromUrl(url);
    const source = unifySourceName(rawSource);

    const published = new Date(a.publishedAt);
    const publishedAt = Number.isNaN(published.getTime())
      ? a.publishedAt
      : published.toISOString();

    return {
      ...a,
      // Re-key on the canonical URL so identical articles reached via different
      // tracking links collapse to one id.
      id: articleId(url),
      title: stripHtml(a.title),
      url,
      source,
      sourceTier: tierFor(source),
      publishedAt,
      snippet: stripHtml(a.snippet),
    };
  });
}
