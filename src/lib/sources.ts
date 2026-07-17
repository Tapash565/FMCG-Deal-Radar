/**
 * Source registry: feeds, tiers, and ingest query construction.
 *
 * Tiering is an allowlist — unknown sources default to T3. The input is the open
 * web, so untrusted-until-vouched-for is the only safe default. See
 * docs/decisions.md#allowlist-for-source-tiers-not-a-blocklist.
 */

import type { SourceTier } from './types';

/** Tier 1: wire services and established business dailies. */
const TIER_1 = [
  'Reuters',
  'Bloomberg',
  'The Economic Times',
  'Mint',
  'Business Standard',
  'Moneycontrol',
  'BusinessLine',
  'VCCircle',
  'Financial Express',
] as const;

/** Tier 2: credible trade and startup press. */
const TIER_2 = ['Inc42', 'Entrackr', 'YourStory', 'Just Food', 'FoodDive'] as const;

/**
 * Publisher name variants → unified name.
 *
 * Load-bearing for corroboration: three URLs from one publisher must count as
 * one source, or credibility inflates. See docs/pipeline.md#corroboration.
 */
const SOURCE_ALIASES: Record<string, string> = {
  'economic times': 'The Economic Times',
  'the economic times': 'The Economic Times',
  'et bureau': 'The Economic Times',
  'economictimes.indiatimes.com': 'The Economic Times',
  livemint: 'Mint',
  'live mint': 'Mint',
  'livemint.com': 'Mint',
  'mint.com': 'Mint',
  'business standard': 'Business Standard',
  'business-standard.com': 'Business Standard',
  'moneycontrol.com': 'Moneycontrol',
  'the hindu businessline': 'BusinessLine',
  'hindu businessline': 'BusinessLine',
  'thehindubusinessline.com': 'BusinessLine',
  'financial express': 'Financial Express',
  'financialexpress.com': 'Financial Express',
  'vccircle.com': 'VCCircle',
  'inc42.com': 'Inc42',
  'entrackr.com': 'Entrackr',
  'yourstory.com': 'YourStory',
  'just food': 'Just Food',
  'just-food.com': 'Just Food',
  'justfood.com': 'Just Food',
  'food dive': 'FoodDive',
  'fooddive.com': 'FoodDive',
  'reuters.com': 'Reuters',
  'bloomberg.com': 'Bloomberg',
};

/** Collapse a raw publisher string or hostname to a unified source name. */
export function unifySourceName(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/^www\./, '');
  return SOURCE_ALIASES[key] ?? raw.trim();
}

/** Tier lookup. Unknown → 3 by design. */
export function tierFor(source: string): SourceTier {
  const unified = unifySourceName(source);
  if ((TIER_1 as readonly string[]).includes(unified)) return 1;
  if ((TIER_2 as readonly string[]).includes(unified)) return 2;
  return 3;
}

/** Direct RSS feeds — publishers we pull from without going through search. */
export interface FeedSource {
  name: string;
  url: string;
}

/**
 * Direct RSS feeds, verified reachable as of 2026-07-16.
 *
 * VCCircle is deliberately absent: its /feed 500s and /rss.xml 404s. It stays in
 * TIER_1 because Google News still surfaces it, and we tier whatever arrives.
 */
export const DIRECT_FEEDS: FeedSource[] = [
  {
    name: 'The Economic Times',
    url: 'https://economictimes.indiatimes.com/industry/cons-products/fmcg/rssfeeds/13352306.cms',
  },
  { name: 'Moneycontrol', url: 'https://www.moneycontrol.com/rss/business.xml' },
  { name: 'Entrackr', url: 'https://entrackr.com/rss' },
  { name: 'Inc42', url: 'https://inc42.com/feed/' },
  { name: 'FoodDive', url: 'https://www.fooddive.com/feeds/news/' },
];

/** Deal verbs — the action half of the ingest query grid. */
export const DEAL_VERBS = [
  'acquires',
  'acquisition',
  'merger',
  'buyout',
  'stake',
  'invests',
  'funding',
  'raises',
  'Series',
  'PE investment',
  'joint venture',
  'takeover',
  'divests',
] as const;

/** Watchlist companies — the entity half of the ingest query grid. */
export const FMCG_ENTITIES = [
  'HUL',
  'Hindustan Unilever',
  'ITC',
  'Dabur',
  'Marico',
  'Nestle India',
  'Unilever',
  'Procter & Gamble',
  'Colgate',
  'Britannia',
  'Tata Consumer',
  'Emami',
  'Godrej Consumer',
  'Adani Wilmar',
  'Patanjali',
] as const;

/** Category words — widen beyond the watchlist to catch unlisted targets. */
export const CATEGORY_TERMS = [
  'FMCG',
  'consumer goods',
  'packaged foods',
  'beverages',
  'personal care',
  'home care',
  'D2C brand',
] as const;

/**
 * Google News RSS search URL, biased toward Indian coverage.
 * Keyless by design — see docs/decisions.md#keyless-data-sourcing.
 */
export function googleNewsFeed(query: string): string {
  const q = encodeURIComponent(query);
  return `https://news.google.com/rss/search?q=${q}&hl=en-IN&gl=IN&ceid=IN:en`;
}

/**
 * Verbs for the query grid, most productive first — the limit truncates the tail.
 */
const QUERY_VERBS = ['acquires', 'stake', 'funding', 'merger'] as const;

/**
 * Build the ingest query set: deal verbs × (watchlist + category terms).
 *
 * Ordered VERB-OUTER, term-inner, and that ordering is the point. The previous
 * term-outer version truncated to the first three companies — HUL, Hindustan
 * Unilever, ITC — so Dabur, Marico, Nestlé, Britannia and every category term were
 * never queried at all. Breadth across terms matters far more than depth on any one:
 * a company either has deal news this month or it doesn't, and four verbs against a
 * quiet company buys nothing.
 *
 * Category terms carry real weight here. The deals actually found — Innovist,
 * Naturis, Aflairza — are D2C brands on nobody's watchlist. A pure watchlist finds
 * only deals by companies we already thought to name, which is the wrong shape for
 * discovery.
 *
 * Bounded deliberately — the 60s function budget caps fan-in.
 * See docs/architecture.md#runtime-and-timeout-strategy.
 */
export function buildQueries(limit = 32): FeedSource[] {
  const terms = [...FMCG_ENTITIES, ...CATEGORY_TERMS];

  const queries: FeedSource[] = [];
  for (const verb of QUERY_VERBS) {
    for (const term of terms) {
      queries.push({ name: `${term} ${verb}`, url: googleNewsFeed(`${term} ${verb}`) });
    }
  }
  // Every term gets "acquires" before any term gets a second verb.
  return queries.slice(0, limit);
}

/** Regex pre-filter inputs — high recall by design. See docs/pipeline.md#4-relevance. */
export const DEAL_VERB_PATTERN = new RegExp(
  [
    'acquir\\w*',
    'acquisition',
    'merge\\w*',
    'merger',
    'buyout',
    'buys?',
    'stake',
    'invest\\w*',
    'funding',
    'raises?',
    'raised',
    'series\\s+[a-e]',
    'takeover',
    'takes?\\s+over',
    'divest\\w*',
    'joint\\s+venture',
    '\\bJV\\b',
    'majority\\s+stake',
    'minority\\s+stake',
  ].join('|'),
  'i',
);

export const FMCG_SIGNAL_PATTERN = new RegExp(
  [
    ...FMCG_ENTITIES.map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    'FMCG',
    'consumer\\s+goods',
    'packaged\\s+food',
    'beverage\\w*',
    'personal\\s+care',
    'home\\s+care',
    'skincare',
    'haircare',
    'D2C',
    'snack\\w*',
    'dairy',
    'confectioner\\w*',
  ].join('|'),
  'i',
);
