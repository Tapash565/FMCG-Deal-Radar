/**
 * Stage 5 — Extract. Pull structured deal fields out of press copy.
 *
 * Every field except dealType and category is nullable, deliberately: coverage
 * routinely says "terms were not disclosed". A schema that forces those fields
 * invites the model to invent them. Absent is a fact; fabricated is a bug.
 * See docs/pipeline.md#5-extract.
 */

import { chatJSON, mapLimit, MODEL_FAST } from '../groq';
import type { Article, Category, Deal, DealType, RelevanceVerdict } from '../types';
import { namesAnEntity } from './tokens';

const CONCURRENCY = 2;

const SYSTEM = `You extract structured deal data from FMCG news articles. Return JSON only.

Fields:
- acquirer: the buyer/investor. For a funding round, the lead investor. Use "" if genuinely absent.
- target: the company being bought/invested in. Use "" if genuinely absent.
- deal_type: "M&A" | "Funding" | "Stake" | "JV"
- deal_value: NUMBER only, no units or commas. null if not disclosed.
- currency: "INR_CRORE" | "USD_MILLION" | "INR" | "USD". null if deal_value is null.
- stake_pct: NUMBER 0-100. null if not stated.
- category: "Food" | "Beverage" | "Personal care" | "Home care" | "Other"
- region: e.g. "India", "Global", "US". Best guess from context.
- announced_date: "YYYY-MM-DD". Use the article date if the deal date isn't stated.
- one_line: a single factual sentence describing the deal.

CRITICAL RULES:
- NEVER invent a deal_value. "Rs 100 Cr" -> 100 + "INR_CRORE". "$8 Mn" -> 8 + "USD_MILLION".
  If the article does not state a value, deal_value MUST be null.
- Do not confuse a company VALUATION with the DEAL VALUE. If only a valuation is given,
  deal_value is null.
- stake_pct only when an explicit percentage is stated. "majority stake" alone -> null.
- Get the DIRECTION right: acquirer buys target, never the reverse.

Respond ONLY with JSON:
{"acquirer": string, "target": string, "deal_type": string, "deal_value": number|null, "currency": string|null, "stake_pct": number|null, "category": string, "region": string, "announced_date": "YYYY-MM-DD", "one_line": string}`;

interface RawDeal {
  acquirer?: string;
  target?: string;
  deal_type?: string;
  deal_value?: number | null;
  currency?: string | null;
  stake_pct?: number | null;
  category?: string;
  region?: string;
  announced_date?: string;
  one_line?: string;
}

const VALID_TYPES: DealType[] = ['M&A', 'Funding', 'Stake', 'JV'];
const VALID_CATEGORIES: Category[] = ['Food', 'Beverage', 'Personal care', 'Home care', 'Other'];

/** Numbers arrive as strings, with commas, or as NaN. Only a clean positive number counts. */
function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v.replace(/,/g, '')) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Upper bounds per currency, beyond which a value is a misparse rather than a deal.
 *
 * Observed in the wild: a small stake sale extracted as "83,20,000 INR_CRORE" — about
 * a trillion dollars. The model had almost certainly misread lakhs or a share count.
 * The prompt already forbids inventing values, and it still produced this, so the
 * schema needs a floor of its own: a number this wrong is worse than no number, since
 * it renders as fact and ranks on deal size.
 *
 * Bounds are generous — the largest real Indian FMCG deals are single-digit thousands
 * of crore (Tata/Capital Foods was ~5,100 cr). Anything past these is not a big deal,
 * it's a broken parse, so we drop to Undisclosed rather than guess a correction.
 */
const MAX_VALUE: Record<string, number> = {
  INR_CRORE: 100_000, // ~USD 12bn
  USD_MILLION: 100_000, // USD 100bn
  INR: 1e13,
  USD: 1e11,
};

function plausibleValue(value?: number, currency?: string | null): number | undefined {
  if (value == null) return undefined;
  if (!currency) return undefined; // a bare number is meaningless — see docs/data-model.md
  const max = MAX_VALUE[currency];
  if (max == null || value > max) return undefined;
  return value;
}

function isoDate(v: unknown, fallback: string): string {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return fallback;
}

export async function extractDeal(
  a: Article,
  verdict: RelevanceVerdict,
): Promise<Omit<Deal, 'credibilityScore' | 'corroboratingSources' | 'confidence'> | null> {
  const raw = await chatJSON<RawDeal>({
    model: MODEL_FAST,
    system: SYSTEM,
    user: `Title: ${a.title}\nSource: ${a.source}\nDate: ${a.publishedAt.slice(0, 10)}\nSnippet: ${a.snippet.slice(0, 800)}`,
    maxTokens: 400,
  });

  const dealType =
    VALID_TYPES.find((t) => t === raw.deal_type) ?? verdict.dealType ?? 'M&A';
  const category = VALID_CATEGORIES.find((c) => c === raw.category) ?? 'Other';

  const dealValue = plausibleValue(num(raw.deal_value), raw.currency);
  const stakePct = num(raw.stake_pct);

  return {
    dealId: a.id,
    clusterId: a.id,
    acquirer: (raw.acquirer ?? '').trim() || 'Undisclosed',
    target: (raw.target ?? '').trim() || 'Undisclosed',
    dealType,
    // Currency only travels with a value — a bare currency is noise, and a bare
    // number is meaningless across INR crore and USD million.
    ...(dealValue != null ? { dealValue, currency: raw.currency ?? undefined } : {}),
    ...(stakePct != null && stakePct <= 100 ? { stakePct } : {}),
    category,
    region: (raw.region ?? '').trim() || 'India',
    announcedDate: isoDate(raw.announced_date, a.publishedAt),
    relevanceConf: verdict.confidence,
  };
}

type PartialDeal = Omit<Deal, 'credibilityScore' | 'corroboratingSources' | 'confidence'>;

/**
 * Structural gate: does this record name anything?
 *
 * A deal needs a named target — that IS the news. Two ways it fails, both observed:
 *
 *   1. No target at all. "Marico → Undisclosed, M&A, Undisclosed" informs nobody, and
 *      arrived from Tracxn listing pages ("List of 12 Acquisitions by Marico") that
 *      name no transaction.
 *   2. A target that is a DESCRIPTION, not a name: "Beverages Major", "Kenyan firm",
 *      "Indian billionaire". These are worse than empty, because they read as real
 *      companies and would ship in a newsletter looking like fact.
 *
 * The distinctive-token test that decides (2) lives in ./tokens as namesAnEntity, shared
 * with the deal-identity merge so both stages agree on what counts as a name.
 *
 * Relevance rejects listing pages upstream, but this stays as a backstop — the checks
 * fail independently. Relevance judges the article; this judges the record. An
 * extraction that comes back nameless is itself evidence the article had no specific
 * deal, whatever the classifier believed.
 *
 * Only a TARGET is required, not a value. Undisclosed terms are normal and newsworthy;
 * an unnamed target is neither.
 */
export function isPublishable(d: PartialDeal): boolean {
  return d.target !== 'Undisclosed' && d.target.length > 1 && namesAnEntity(d.target);
}

export async function extractDeals(
  articles: Article[],
  verdicts: Map<string, RelevanceVerdict>,
): Promise<{ deals: PartialDeal[]; rejected: PartialDeal[] }> {
  const results = await mapLimit(articles, CONCURRENCY, (a) =>
    extractDeal(a, verdicts.get(a.id) ?? { isFmcgDeal: true, confidence: 0.5, reasoning: '' }),
  );
  const extracted = results.filter((d): d is PartialDeal => d != null);

  return {
    deals: extracted.filter(isPublishable),
    rejected: extracted.filter((d) => !isPublishable(d)),
  };
}
