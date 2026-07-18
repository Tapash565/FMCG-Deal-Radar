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

/**
 * Publishers that categorically never report an FMCG DEAL, dropped at ingest.
 *
 * This is a blocklist, which the tiering deliberately is NOT (docs/decisions.md:
 * unknown → T3, never blocked). No contradiction: tiering rates how much to TRUST a
 * source that reported a deal; this drops sources whose entire output is a different
 * kind of document. Two kinds, both measured polluting the funnel:
 *
 *   - Stock-data mills (MarketBeat): algorithmic 13F-holdings and analyst-rating posts
 *     about US-listed FMCG names — "First Horizon Corp Purchases 31,583 Shares of
 *     Colgate-Palmolive Company $CL". A quarterly share position is not a transaction.
 *   - Wrong-sector trade press that trips one FMCG keyword: home-HEALTH-care and hospice
 *     outlets match "home care"; horse-racing / betting outlets match "stake(s)".
 *
 * Names are matched after unification, case-insensitively. Kept tight on purpose — a
 * source that sometimes carries real deals (Investing.com, TradingView) is NOT here;
 * its 13F noise is caught by content instead (NON_DEAL_NOISE_PATTERN).
 */
const BLOCKED_SOURCES = new Set<string>([
  'marketbeat',
  // home-health / hospice / elder-care services press — not FMCG home care
  'home health care news',
  'mcknights home care',
  'fierce healthcare',
  'care home professional',
  'caring times',
  'hospice news',
  'laingbuisson news',
  // horse racing / sports betting — "stake(s)" false positives
  'at the races',
  'daily racing form',
  'betfair',
  'olbg',
  'racing tv',
  'read horse racing',
  'thoroughbred daily news',
  'william hill news',
]);

/** Is this publisher on the drop-at-ingest blocklist? Matches raw or unified name. */
export function isBlockedSource(raw: string): boolean {
  const key = raw.trim().toLowerCase().replace(/^www\./, '');
  return BLOCKED_SOURCES.has(key) || BLOCKED_SOURCES.has(unifySourceName(raw).toLowerCase());
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
  // Second tranche — listed majors and fast-moving D2C names that were producing deal
  // news but weren't on the watchlist, so their deals only surfaced by luck via the
  // category terms. Naming them makes that coverage deliberate.
  'Varun Beverages',
  'United Spirits',
  'Radico Khaitan',
  'Zydus Wellness',
  'Jyothy Labs',
  'Bajaj Consumer Care',
  'Bikaji Foods',
  'Gopal Snacks',
  'Honasa Consumer',
  'Mamaearth',
  'Nykaa',
  'Wipro Consumer Care',
  'CavinKare',
  'Reliance Consumer Products',
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
  // The category grid is where off-watchlist targets actually get found (Innovist,
  // Naturis, Anmasa were all D2C names nobody had listed), so widen it — kept specific
  // ("skincare brand", not "skincare") to bias toward transaction copy over trend pieces.
  'snacks brand',
  'dairy brand',
  'confectionery',
  'skincare brand',
  'haircare brand',
  'ayurveda',
  'nutraceutical',
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
 * 'raises'/'invests' pull the D2C funding rounds that make up most of the real yield;
 * 'stake' drags in horse-racing and 13F noise, which BLOCKED_SOURCES and
 * NON_DEAL_NOISE_PATTERN drop for free before any LLM call.
 */
const QUERY_VERBS = ['acquires', 'funding', 'stake', 'raises', 'invests', 'merger'] as const;

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
 * The default gives every term its two highest-yield verbs (acquires + funding), and
 * SCALES with the term list so widening the grid can't silently leave the tail
 * unqueried the way a hardcoded 32 did. This bound is the SEED's — /api/refresh passes
 * its own tight queryLimit (8) for the 60s budget, so raising this can't slow a refresh.
 * See docs/architecture.md#runtime-and-timeout-strategy.
 */
export function buildQueries(limit = (FMCG_ENTITIES.length + CATEGORY_TERMS.length) * 2): FeedSource[] {
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

/**
 * The inverse of the pre-filter: content that marks an item as NOT a deal, however
 * many deal-verbs and FMCG-signals it also contains. Rejected free in stage 4 before
 * any LLM call — the "stake" verb + an FMCG name is exactly what a 13F holdings post or
 * a horse-racing report looks like to the recall filter.
 *
 * Every pattern here is high-PRECISION: calibrated against 297 live articles, it flagged
 * 32 — all genuine noise (MarketBeat 13F churn, home-health / hospice M&A, a promoter
 * share-count blurb) — and hit NONE of the real-deal headlines, including the deliberately
 * tricky "acquires stake in Badshah Masala" and "buy 100% stake in Yoga Bar maker". The
 * asymmetry is deliberate: a pattern that could match a real deal does not belong here,
 * because the LLM never gets a chance to overrule it. When unsure, leave it to the model.
 *
 * Note what is absent: bare "stake in" is a legitimate FMCG deal phrase, so the 13F
 * signal is "stake lifted/boosted/... BY <fund>" and share-count verbs, never "stake in".
 */
export const NON_DEAL_NOISE_PATTERN = new RegExp(
  [
    // exchange listings and share counts — 13F holdings / analyst-rating churn
    '\\((?:nyse|nasdaq|lon|otcmkts|tsx|amex|asx|cboe)\\s*:',
    '\\b13f\\b',
    '\\bshares of\\b',
    '\\b(?:stock position|stock holdings|holdings in)\\b',
    '(?:buys|sells|purchases|boosts|reduces|trims|lowers|cuts|lifts|raises|acquires|decreases|increases)\\s+[\\d,]+\\s+shares',
    '\\bstake (?:lifted|boosted|cut|lowered|trimmed|reduced|raised|decreased|increased|sold)\\s+by\\b',
    'has \\$[\\d.,]+\\s+(?:million|billion)\\s+(?:holdings|stock|stake|position)',
    '\\bprice target\\b',
    '\\bconsensus recommendation\\b',
    '(?:moderate|strong)\\s+buy',
    // home-HEALTH-care / hospice / elder-care — matches "home care" but isn't FMCG
    '\\bhome health\\b',
    '\\bhospice\\b',
    '\\bassisted living\\b',
    '\\bnursing home\\b',
    'caregiv',
    'in-home care',
    '\\bhomecare\\b',
  ].join('|'),
  'i',
);
