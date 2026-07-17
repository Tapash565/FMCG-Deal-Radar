/**
 * Canonical data model. See docs/data-model.md for the reasoning behind
 * optionality and the id chain that makes newsletter claims auditable.
 */

export type SourceTier = 1 | 2 | 3;
export type DealType = 'M&A' | 'Funding' | 'Stake' | 'JV';
export type Confidence = 'High' | 'Med' | 'Low';
export type Category = 'Food' | 'Beverage' | 'Personal care' | 'Home care' | 'Other';

export const DEAL_TYPES: readonly DealType[] = ['M&A', 'Funding', 'Stake', 'JV'];
export const CATEGORIES: readonly Category[] = [
  'Food',
  'Beverage',
  'Personal care',
  'Home care',
  'Other',
];

export interface Article {
  id: string;
  title: string;
  /** Canonicalized: tracking params stripped, Google News redirects resolved. */
  url: string;
  /** Unified publisher name — "ET Bureau" and "The Economic Times" collapse to one. */
  source: string;
  sourceTier: SourceTier;
  /** ISO 8601. */
  publishedAt: string;
  snippet: string;
  rawText?: string;
  /** Which ingest query surfaced this — useful for tuning source coverage. */
  queryTerm: string;
}

export interface Cluster {
  clusterId: string;
  /** Article.id of the cluster representative: highest tier, earliest date. */
  canonicalId: string;
  /** Includes canonicalId. Retained as corroboration evidence for credibility. */
  memberIds: string[];
  size: number;
}

export interface RelevanceVerdict {
  isFmcgDeal: boolean;
  dealType?: DealType;
  confidence: number;
  /** Retained as the audit trail for "why is this in the newsletter?". */
  reasoning: string;
}

export interface Deal {
  dealId: string;
  clusterId: string;
  acquirer: string;
  target: string;
  dealType: DealType;
  /** Absent when undisclosed. Absent is a fact; fabricated is a bug. */
  dealValue?: number;
  /** Only meaningful alongside dealValue. Never normalized across currencies. */
  currency?: string;
  stakePct?: number;
  category: Category;
  region: string;
  /** ISO 8601. */
  announcedDate: string;
  relevanceConf: number;
  credibilityScore: number;
  /** Unified source names, not URLs — one publisher must not vote twice. */
  corroboratingSources: string[];
  confidence: Confidence;
}

export interface NewsletterItem {
  dealId: string;
  headline: string;
  summary: string;
  whyItMatters: string;
  primarySourceUrl: string;
  badge: Confidence;
}

export interface NewsletterSection {
  category: Category;
  items: NewsletterItem[];
}

export interface Newsletter {
  title: string;
  period: string;
  tldr: string[];
  sections: NewsletterSection[];
  methodology: string;
}

/** Article counts at four checkpoints. Each is a strict subset of the previous. */
export interface Funnel {
  ingested: number;
  deduped: number;
  relevant: number;
  selected: number;
}

/**
 * The only contract between pipeline and UI. Immutable once written —
 * refresh replaces wholesale, nothing mutates in place.
 */
export interface Snapshot {
  generatedAt: string;
  window: { from: string; to: string };
  funnel: Funnel;
  deals: Deal[];
  newsletter: Newsletter;
  /** Retained for the raw-data export and the audit chain. */
  clusters?: Cluster[];
  articles?: Article[];
}
