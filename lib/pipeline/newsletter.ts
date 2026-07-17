/**
 * Stage 8 — Newsletter. The one large-model call, spent on the one artifact a human
 * reads end to end.
 *
 * The model writes PROSE OVER FACTS THAT ALREADY EXIST. It does not pick the deals,
 * score them, or order them — stages 4–7 did that deterministically. Keeping selection
 * out of generation is what makes the output auditable: every claim traces to a Deal,
 * which traces to a cluster, which traces to source URLs.
 * See docs/pipeline.md#8-newsletter.
 */

import { chatJSON, MODEL_SMART } from '../groq';
import { formatValue } from '../snapshot';
import type {
  Article,
  Category,
  Deal,
  Funnel,
  Newsletter,
  NewsletterItem,
  NewsletterSection,
} from '../types';

const SYSTEM = `You write a concise FMCG M&A intelligence newsletter for business analysts.

You will receive a JSON list of deals that have ALREADY been selected, scored, and ordered.
Your job is prose only.

ABSOLUTE RULES:
- Use ONLY the facts given. Never add a deal value, stake, date, rationale, or company that
  is not in the input.
- If a deal's value is "Undisclosed", say so plainly or omit it. NEVER estimate or imply one.
- Do not speculate about motives or future outcomes as if they were fact. "Why it matters"
  must be analytical framing grounded in the given fields, not invented news.
- Do not reorder, merge, drop, or add deals. One item per input deal, echoing its deal_id.

Style: factual, dry, skimmable. No marketing language. No exclamation marks.

For each deal:
- headline: <= 12 words, naming the parties. Not a restatement of the raw title.
- summary: 2-3 sentences of what happened, using only the given fields.
- why_it_matters: 1-2 sentences of analytical significance for an FMCG market watcher.

Also write tldr: 3-4 bullets covering the period overall. Each bullet <= 20 words. Ground
every bullet in the deals given — reference real parties, no invented aggregate claims.

Respond ONLY with JSON:
{"tldr": ["..."], "items": [{"deal_id": "...", "headline": "...", "summary": "...", "why_it_matters": "..."}]}`;

interface RawNewsletter {
  tldr?: string[];
  items?: { deal_id?: string; headline?: string; summary?: string; why_it_matters?: string }[];
}

/** Only the fields the model is allowed to write about. */
function renderDeal(d: Deal): Record<string, unknown> {
  return {
    deal_id: d.dealId,
    acquirer: d.acquirer,
    target: d.target,
    deal_type: d.dealType,
    value: formatValue(d.dealValue, d.currency),
    stake_pct: d.stakePct ?? null,
    category: d.category,
    region: d.region,
    announced: d.announcedDate.slice(0, 10),
    confidence: d.confidence,
    reported_by: d.corroboratingSources,
  };
}

/**
 * Methodology is assembled from real numbers, NOT written by the model.
 *
 * It's the part of the newsletter that describes how the newsletter was made, so a
 * hallucinated funnel count would undermine the exact thing it exists to establish.
 */
export function buildMethodology(funnel: Funnel, windowDays: number, sourceCount: number): string {
  return [
    `Method: ${funnel.ingested} articles ingested from ${sourceCount} sources over the last ${windowDays} days,`,
    `de-duplicated to ${funnel.deduped} unique stories (embedding similarity + title match),`,
    `filtered to ${funnel.relevant} confirmed FMCG deals, ranked to the top ${funnel.selected}.`,
    `Confidence badges reflect source tier and how many independent outlets reported a deal —`,
    `they measure corroboration, not truth, and are not fact-checking.`,
    `Deal values are as reported; "Undisclosed" means terms were not made public.`,
  ].join(' ');
}

export interface NewsletterInput {
  grouped: { category: Category; deals: Deal[] }[];
  deals: Deal[];
  funnel: Funnel;
  windowDays: number;
  period: string;
  articlesById: Map<string, Article>;
}

export async function draftNewsletter(input: NewsletterInput): Promise<Newsletter> {
  const { grouped, deals, funnel, windowDays, period, articlesById } = input;

  const sourceCount = new Set(deals.flatMap((d) => d.corroboratingSources)).size;

  if (deals.length === 0) {
    return {
      title: 'FMCG Deal Radar',
      period,
      tldr: ['No qualifying FMCG deals in this window.'],
      sections: [],
      methodology: buildMethodology(funnel, windowDays, sourceCount),
    };
  }

  const raw = await chatJSON<RawNewsletter>({
    model: MODEL_SMART,
    system: SYSTEM,
    user: JSON.stringify({ period, deals: deals.map(renderDeal) }, null, 1),
    temperature: 0.3,
    maxTokens: 4000,
  });

  const byId = new Map((raw.items ?? []).map((i) => [i.deal_id, i]));

  // Sections are built from OUR grouping, not the model's — it can only fill prose into
  // slots that stages 4–7 already decided. A missing item degrades to the extracted
  // one_line rather than dropping a deal the ranker chose.
  const sections: NewsletterSection[] = grouped.map((g) => ({
    category: g.category,
    items: g.deals.map((d): NewsletterItem => {
      const item = byId.get(d.dealId);
      const article = articlesById.get(d.dealId);
      const fallback = `${d.acquirer} ${d.dealType === 'Funding' ? 'invests in' : 'acquires'} ${d.target}.`;
      return {
        dealId: d.dealId,
        headline: item?.headline?.trim() || `${d.acquirer} → ${d.target}`,
        summary: item?.summary?.trim() || fallback,
        whyItMatters: item?.why_it_matters?.trim() || '',
        primarySourceUrl: article?.url ?? '',
        badge: d.confidence,
      };
    }),
  }));

  const tldr = (raw.tldr ?? []).map((t) => t.trim()).filter(Boolean);

  return {
    title: 'FMCG Deal Radar',
    period,
    tldr: tldr.length ? tldr : [`${deals.length} FMCG deals tracked this period.`],
    sections,
    methodology: buildMethodology(funnel, windowDays, sourceCount),
  };
}
