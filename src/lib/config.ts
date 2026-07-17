/**
 * Pipeline configuration that more than one stage depends on.
 */

/**
 * Rolling window, in days.
 *
 * 90 days. It is the dominant cost driver — ~128 pre-filter survivors against Groq's
 * 6,000 TPM free tier, so a run takes minutes, where 30 days takes seconds.
 *
 * That cost is worth paying because it is paid ONCE. This script generates the
 * committed seed; the deployed app never runs it, and no reviewer ever waits on it. At
 * 30 days the window yielded 3 deals in a single category — at 90 it yields 12 across
 * four, including multi-source High-confidence deals. A slow generator producing a good
 * artifact beats a fast one producing a thin artifact.
 *
 * Narrow it with `WINDOW_DAYS=30 npm run pipeline` when iterating and you want a
 * snapshot in seconds rather than minutes.
 *
 * /api/refresh is the path where duration genuinely binds (60s ceiling) — that needs a
 * narrower window of its own, not this default. See docs/architecture.md.
 *
 * MUST be shared, not re-defaulted per stage. rank.recencyScore() divides by this to
 * decay a deal's score to zero at the window edge; if ingest widens and rank doesn't,
 * every deal older than rank's window silently scores 0 on recency and sorts to the
 * bottom — with no error anywhere.
 *
 * Stated in the README as an assumption: this is a digest window, chosen for coverage
 * and cost, not a claim about deal recency.
 */
export const DEFAULT_WINDOW_DAYS = 90;

/**
 * Overridable per run: `WINDOW_DAYS=30 npm run pipeline`.
 *
 * The window is the main lever on LLM cost, and on a 6,000 TPM free tier that decides
 * whether a run finishes at all. 90 days is ~128 pre-filter survivors (~26k tokens for
 * relevance); 30 days is ~24 (~5k). Roughly 5x, for the same code.
 *
 * So: 90 for the real seed, 30 when you need a populated snapshot in seconds.
 */
export const WINDOW_DAYS = Number(process.env.WINDOW_DAYS) || DEFAULT_WINDOW_DAYS;
