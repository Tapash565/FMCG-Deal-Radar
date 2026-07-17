/**
 * Stage 4 — Relevance. Free regex pre-filter, then Groq 8b on the survivors.
 *
 * Ordering is the whole point: the pre-filter removes most items at zero cost, and
 * every one it drops is an LLM call not made. That's what keeps a refresh inside the
 * 60s budget. See docs/pipeline.md#4-relevance.
 */

import { chatJSON, mapLimit, MODEL_FAST } from '../groq';
import { DEAL_VERB_PATTERN, FMCG_SIGNAL_PATTERN } from '../sources';
import type { Article, DealType, RelevanceVerdict } from '../types';

/**
 * Articles per LLM call.
 *
 * MEASURED, and the single biggest lever on this stage. One-article-per-call re-sends
 * the ~500-token system prompt every time: 24 articles burned ~12k tokens of pure
 * prompt overhead and pushed us through Groq's free-tier token budget, after which
 * everything throttled hard (0.3s/call → 5.6s/call) and calls began failing outright.
 *
 * Batching amortizes the prompt across articles.
 *
 * Raised 6 → 12 once the confirm pass existed. That changed the economics: the batch
 * pass no longer needs to be right, only to not miss real deals — anything it wrongly
 * waves through gets caught individually downstream. So the only real cost of a bigger
 * batch is index misalignment, which the echoed "n" already guards against.
 *
 * At a 90-day window this halves ~35 batch calls to ~18, and call count is what the
 * rate limiter charges for.
 *
 * Raised again to 25 once the screen pass went title-only with 1/0 output — each
 * article now costs ~26 tokens instead of ~180, so a batch of 25 is smaller than the
 * old batch of 12.
 */
const BATCH_SIZE = 25;

/** Confirm batches stay small: full prompt + snippet, and attention per item matters. */
const CONFIRM_BATCH_SIZE = 6;

/**
 * Concurrent batches. Deliberately low.
 *
 * Counterintuitive but measured: raising this makes the stage SLOWER, not faster. At
 * concurrency 8 a single call blocked for 25s while sequential calls returned in 0.3s,
 * and 10 of 24 failed after retries. The bottleneck is the provider's rate limiter, not
 * round-trip latency — so parallelism buys nothing and costs reliability.
 */
const CONCURRENCY = 2;

/**
 * Phase 1 — free. Must plausibly contain a deal verb AND an FMCG signal.
 *
 * Tuned for RECALL, not precision. It may pass junk (the LLM behind it is the
 * precision stage) but must not drop real deals, because nothing downstream can
 * recover them. When in doubt, pass it on.
 */
export function passesPreFilter(a: Article): boolean {
  const haystack = `${a.title} ${a.snippet}`;
  return DEAL_VERB_PATTERN.test(haystack) && FMCG_SIGNAL_PATTERN.test(haystack);
}

/**
 * Terse prompt for the cheap first pass. ~120 tokens vs ~700 for the full one.
 *
 * Token volume is the whole ballgame on a 6,000 TPM free tier, and the full prompt was
 * being re-sent on every batch — ~7.7k tokens of pure overhead per run. This pass only
 * has to be right about the obvious majority; SURVIVORS get re-asked with the full
 * prompt and the snippet, so precision is bought later on a much smaller set.
 *
 * Output is deliberately minimal: {"n":1,"d":1} rather than a verdict object with
 * prose. Generating `reasoning` for 128 articles to discard 113 of them was ~6k tokens
 * spent on text nobody reads.
 */
const BATCH_SYSTEM = `Decide if each headline reports a specific FMCG deal (M&A, funding round, stake purchase, or JV).

FMCG = packaged food, beverage, personal care, home care.

d=1 only if BOTH: it reports one specific transaction, AND the target is an FMCG business.
d=0 for: other sectors (IT, hotels, real estate, pharma, retail chains) even under an FMCG
parent name (ITC Hotels, ITC Infotech are NOT FMCG); earnings reports; listing/index pages
("List of 12 Acquisitions by X"); fund portfolio changes; product launches; commentary.

When genuinely unsure, use d=1 — a later pass re-checks survivors, but nothing recovers
something dropped here.

JSON only: {"v":[{"n":1,"d":0},{"n":2,"d":1}]}  — one entry per headline, echo n.`;

const SYSTEM = `You are an FMCG M&A analyst. Decide whether a news article reports a real corporate DEAL in the FMCG (fast-moving consumer goods) sector.

FMCG means fast-moving consumer packaged goods:
- Food (snacks, dairy, staples, confectionery, packaged foods)
- Beverage (soft drinks, juices, tea/coffee, alcohol, water)
- Personal care (skincare, haircare, cosmetics, oral care, hygiene)
- Home care (detergents, cleaners, air care)

A DEAL is one of: M&A (acquisition/merger), Funding (VC/PE investment round), Stake (buying or selling an equity stake), JV (joint venture).

Return true ONLY if BOTH hold:
1. The article's main subject is a specific, announced deal (or a concrete report of one), AND
2. The target or the business being transacted is an FMCG business.

Return FALSE for:
- LISTING / INDEX / DATABASE pages that enumerate deals rather than report one.
  Titles like "List of 12 Acquisitions by Marico", "Top 10 FMCG deals of 2026",
  "<Company> acquisitions and funding rounds", or directory pages from data providers
  (Tracxn, Crunchbase, PitchBook). These name no specific transaction, no target, and
  no date. A page ABOUT many deals is not a report OF a deal.
- Earnings/results articles that merely mention an acquisition in passing
- Deals in other sectors, even by a company with an FMCG parent or a similar name
  (e.g. ITC Hotels = hospitality; ITC Infotech = IT services; both are NOT FMCG)
- IT services, hotels, real estate, pharma, financial services, retail chains, logistics
- Mutual fund or institutional investors changing portfolio positions in a stock
- Product launches, marketing campaigns, executive appointments, stock price commentary
- Vague market/sector commentary with no specific transaction

Judge the deal's SUBJECT, not the companies mentioned. An article about a mutual fund buying
ITC shares is not an FMCG deal. An article about ITC Hotels buying a hotel is not an FMCG deal.

"confidence" means: how certain are you that THIS ARTICLE IS an FMCG deal? It is not
confidence in your verdict. It must run in the same direction as is_fmcg_deal — high when
is_fmcg_deal is true, low when false. Use the range, not just 0 and 1:
- 0.9-1.0  unambiguous FMCG deal, clearly stated
- 0.7-0.9  FMCG deal, some detail vague or the target's sector is implied
- 0.4-0.6  genuinely borderline — reported rumour, or an FMCG-adjacent target
- 0.0-0.3  not an FMCG deal

You will be given a NUMBERED LIST of articles. Judge each one independently.

Respond ONLY with JSON. Return one verdict per article, echoing its "n" so verdicts can be
matched back. Return exactly as many verdicts as there are articles:
{"verdicts": [{"n": 1, "is_fmcg_deal": boolean, "deal_type": "M&A"|"Funding"|"Stake"|"JV"|null, "confidence": 0.0-1.0, "reasoning": "one short sentence"}]}`;

interface RawVerdict {
  n?: number;
  is_fmcg_deal?: boolean;
  deal_type?: string | null;
  confidence?: number;
  reasoning?: string;
}

const VALID_TYPES: DealType[] = ['M&A', 'Funding', 'Stake', 'JV'];

function coerce(raw: RawVerdict): RelevanceVerdict {
  const dealType = VALID_TYPES.find((t) => t === raw.deal_type);
  const confidence =
    typeof raw.confidence === 'number' && raw.confidence >= 0 && raw.confidence <= 1
      ? raw.confidence
      : 0.5;

  return {
    isFmcgDeal: raw.is_fmcg_deal === true,
    dealType,
    confidence,
    reasoning: typeof raw.reasoning === 'string' ? raw.reasoning : '',
  };
}

function renderArticle(a: Article, n: number): string {
  return `${n}. Title: ${a.title}\n   Source: ${a.source}\n   Snippet: ${a.snippet.slice(0, 400)}`;
}

/** Title only for the cheap pass — ~18 tokens vs ~120 with the snippet. */
function renderTitle(a: Article, n: number): string {
  return `${n}. ${a.title}`;
}

interface RawScreen {
  v?: { n?: number; d?: number | boolean }[];
}

/**
 * Cheap screen: titles in, 1/0 out. The workhorse that makes a 90-day run viable.
 *
 * Batches are large (25) because output is now ~8 tokens per article rather than a
 * verdict object, so the misalignment risk the echoed "n" guards against is the only
 * real cost of size.
 */
export async function screenBatch(articles: Article[]): Promise<(boolean | null)[]> {
  if (articles.length === 0) return [];

  const raw = await chatJSON<RawScreen>({
    model: MODEL_FAST,
    system: BATCH_SYSTEM,
    user: articles.map((a, i) => renderTitle(a, i + 1)).join('\n'),
    maxTokens: 16 * articles.length + 32,
  });

  const byN = new Map<number, boolean>();
  for (const e of raw.v ?? []) {
    if (typeof e.n === 'number') byN.set(e.n, e.d === 1 || e.d === true);
  }
  // null = no answer for this one, so it gets re-asked rather than silently dropped.
  return articles.map((_, i) => byN.get(i + 1) ?? null);
}

/** Single-article classify. Kept for tests and for salvaging a failed batch. */
export async function classify(a: Article): Promise<RelevanceVerdict> {
  const [v] = await classifyBatch([a]);
  return v ?? { isFmcgDeal: false, confidence: 0, reasoning: 'no verdict returned' };
}

/**
 * Classify a batch in one call.
 *
 * Verdicts are matched by the echoed "n", not by array position: a model that drops or
 * reorders an entry would otherwise silently shift every verdict onto the wrong article,
 * which is far worse than a missing one. Anything unmatched comes back as a rejection
 * with empty reasoning, and assessRelevance retries those individually.
 */
export async function classifyBatch(articles: Article[]): Promise<(RelevanceVerdict | null)[]> {
  if (articles.length === 0) return [];

  const raw = await chatJSON<{ verdicts?: RawVerdict[] }>({
    model: MODEL_FAST,
    system: SYSTEM,
    user: articles.map((a, i) => renderArticle(a, i + 1)).join('\n\n'),
    maxTokens: 160 * articles.length,
  });

  const byN = new Map<number, RawVerdict>();
  for (const v of raw.verdicts ?? []) {
    if (typeof v.n === 'number') byN.set(v.n, v);
  }

  // null means "the model didn't answer for this one" — distinct from "answered no".
  // Previously both were represented as a rejection with empty reasoning, so every
  // genuine no-reasoning rejection got re-queued as an individual call. With ~200
  // candidates that turned one batch pass into hundreds of extra requests and blew
  // the token budget.
  return articles.map((_, i) => {
    const v = byN.get(i + 1);
    return v ? coerce(v) : null;
  });
}

export interface RelevanceResult {
  relevant: Article[];
  /** Keyed by article id. Retained in raw data as the audit trail. */
  verdicts: Map<string, RelevanceVerdict>;
  stats: {
    input: number;
    preFiltered: number;
    classified: number;
    /** Passed the cheap batch pass, before individual confirmation. */
    batchSurvivors: number;
    relevant: number;
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Two LLM passes, cheap-first — the shape that makes a 90-day window affordable.
 *
 *   1. SCREEN  — every candidate, titles only, terse prompt, 1/0 out. ~25 per call.
 *   2. CONFIRM — only survivors, full prompt + snippet, batched small.
 *
 * The asymmetry is the point: ~128 candidates screen in ~5 calls, and only ~15 reach
 * the expensive pass. Doing the full prompt on all 128 cost ~26k tokens (4+ minutes of
 * a 6,000 TPM budget); this costs roughly a quarter of that.
 *
 * Confirm exists because the cheap pass over-accepts — it waved through ITC dividend
 * notices and an ITC Hotels earnings report that the full prompt rejects correctly.
 * Recall cheaply, precision expensively, on a set small enough to afford it.
 */
export async function assessRelevance(articles: Article[]): Promise<RelevanceResult> {
  const candidates = articles.filter(passesPreFilter);

  // Pass 1 — screen.
  const screenBatches = chunk(candidates, BATCH_SIZE);
  const screened = await mapLimit(screenBatches, CONCURRENCY, (b) => screenBatch(b));

  const shortlist: Article[] = [];
  screenBatches.forEach((batch, bi) => {
    batch.forEach((a, i) => {
      // null (no answer / failed batch) is treated as a MAYBE and promoted, not dropped.
      // The confirm pass is the arbiter, and a false positive there is cheap; a real deal
      // lost here is unrecoverable.
      if (screened[bi]?.[i] !== false) shortlist.push(a);
    });
  });

  // Pass 2 — confirm.
  const confirmBatches = chunk(shortlist, CONFIRM_BATCH_SIZE);
  const confirmed = await mapLimit(confirmBatches, CONCURRENCY, (b) => classifyBatch(b));

  const verdicts = new Map<string, RelevanceVerdict>();
  confirmBatches.forEach((batch, bi) => {
    batch.forEach((a, i) => {
      const v = confirmed[bi]?.[i];
      if (v) verdicts.set(a.id, v);
    });
  });

  const relevant = shortlist.filter((a) => verdicts.get(a.id)?.isFmcgDeal);

  return {
    relevant,
    verdicts,
    stats: {
      input: articles.length,
      preFiltered: candidates.length,
      classified: verdicts.size,
      batchSurvivors: shortlist.length,
      relevant: relevant.length,
    },
  };
}
