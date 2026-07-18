# Decisions

Locked technical decisions and the reasoning behind them. The summary table is the *what*;
the sections below are the *why*, including what each choice costs.

| Area | Decision |
|---|---|
| Frontend + deploy | Next.js (App Router) on Vercel, single TypeScript app |
| LLM | Groq — `llama-3.1-8b-instant` (classify/extract), `llama-3.3-70b-versatile` (newsletter) |
| Dedup | HF Inference API embeddings (`all-MiniLM-L6-v2`) → cosine + fuzzy title guard |
| Scope | India FMCG + global majors · M&A + funding + stakes + JVs · last 90 days |
| Credibility | Source tiers + multi-source corroboration + visible confidence badge |
| Freshness | Committed seed snapshot + live "Refresh now" + daily Vercel Cron |
| Newsletter | TL;DR up top, then grouped by category |
| Exports | Word (hero) + Excel + PPT, plus raw CSV/JSON |
| Data sourcing | Google News RSS + trade feeds (no API key); NewsAPI/GNews optional |

---

## Single Next.js app, no separate backend

The pipeline runs in a route handler; the UI reads a JSON snapshot. One deploy, one language,
one repo.

**Cost:** the pipeline is bound to Vercel's 60s function limit, which is the project's real
engineering constraint (see [architecture.md](./architecture.md#runtime-and-timeout-strategy)).
A worker queue would lift that ceiling entirely.

**Why accept it:** a 4-day build. A queue means another service, another deploy target, and a
job-status protocol between them — real work that produces zero visible improvement in the
demo. The 60s limit is survivable by bounding fan-in and filtering before paying for LLM
calls. If it turns out not to be, the staged-endpoint fallback is already designed.

## Groq, two models

`8b-instant` for the high-volume mechanical work (classify, extract). `70b-versatile` once,
for the newsletter prose.

**Why Groq:** latency. Under a 60s ceiling, throughput is the binding constraint — fanning out
over ~50 candidates only fits because Groq is fast. A frontier model would be better at each
individual call and would not fit.

**Why two tiers:** classification and field extraction are near-mechanical — an 8b model does
them reliably with a tight JSON schema. The newsletter is the one artifact a human reads end
to end, so it gets the large model. Spending 70b on all ~50 classification calls would blow
the time budget to improve a task the small model already handles.

**Cost:** 8b will occasionally misclassify an ambiguous article. Mitigated by keeping
`reasoning` in the raw data, so misses are auditable rather than invisible.

## Embeddings for dedup, not an LLM

**Why:** dedup is a similarity problem, not a reasoning problem. `all-MiniLM-L6-v2` is
milliseconds and effectively free. Asking an LLM "are these the same story?" pairwise is
O(n²) calls for a worse answer.

**Cost:** the model has no entity knowledge. It doesn't know "HUL" and "Hindustan Unilever"
name one company, so it scores surface wording — which is why the same deal in two outlets'
words lands at 0.82 rather than the 0.95 intuition suggests. Every threshold here is therefore
an empirical property of this model, not a general truth, and must be re-derived if the model
or `embedText()` changes.

**We expected the opposite cost.** The prediction was over-merging in a narrow domain: every
article is an FMCG deal, so baseline similarity should run high and drag different deals
together. Calibration showed the reverse — the adversarial control ("Dabur acquires stake in
Badshah" vs "Marico acquires stake in Plix") scores **0.285**, and the real risk was
*under*-merging. The fuzzy title guard built to catch the predicted failure would have blocked
real merges instead, so it's now an OR fast path rather than a precondition
([pipeline.md](./pipeline.md#why-the-guard-became-a-fast-path)).

Worth keeping as a lesson: the reasoning above was plausible and wrong, and only measurement
caught it. Thresholds picked by intuition fail silently.

## Committed seed snapshot

`data/snapshot.json` ships in the repo. The app reads Blob first, seed on miss.

**Why:** a demo that requires four env vars and a working RSS fetch to show anything is a
demo that will be empty exactly when someone opens it. The seed makes a fresh clone render
real content with zero configuration. The Refresh button then proves the pipeline behind it
is real.

**Cost:** the seed goes stale, and a reader could mistake it for live data. Mitigated by
showing `generatedAt` prominently in the header.

## No database

A JSON blob, not Postgres.

**Why:** the working set is ~10–12 deals over 90 days. A snapshot is the correctly-sized tool.
Postgres would add a migration story, a pooling story, and a cold-start story for no gain.

**Cost:** no history — each refresh replaces the last snapshot, so trends over time aren't
queryable. Out of scope for a rolling digest, and if it were needed, writing timestamped
blobs would be the cheap next step, not a schema.

## Allowlist for source tiers, not a blocklist

Unknown sources default to T3.

**Why:** the input is the open web. Untrusted-until-vouched-for is the only safe default when
you cannot enumerate what you'll encounter. A blocklist assumes you can name the bad actors in
advance, which you can't.

**Cost:** a legitimate publisher not on the list is under-rated until someone adds it. That's
a one-line fix in `lib/sources.ts` and the right direction to fail in.

## A source blocklist for non-FMCG mills — which is not the same decision

`lib/sources.ts` also carries a small `BLOCKED_SOURCES` set, dropped at ingest. This is not a
reversal of the decision above. Tiering answers "how much do I trust a source that reported a
deal?" — and there, unknown must mean T3, not blocked. The blocklist answers a different
question: "does this publisher produce FMCG deal news *at all*?" Three kinds provably don't, and
were measured polluting the funnel:

- **Stock-data mills** (MarketBeat): algorithmic 13F-holdings and analyst-rating posts —
  "First Horizon Corp Purchases 31,583 Shares of Colgate-Palmolive Company $CL". A share
  position is not a transaction.
- **Home-health / hospice press** (Hospice News, McKnights Home Care): real M&A, in *healthcare*,
  matched because "home care" is an FMCG category word.
- **Horse-racing / betting press** (At The Races, Betfair): "Britannia **Stakes**" at Royal Ascot
  matched the watchlist entity *Britannia* and the *stake* verb.

**Why it's safe where a general blocklist isn't:** these are named by *sector*, not by trust.
The failure mode the allowlist decision guards against — silently under-rating a real publisher —
can't happen here, because nothing on this list can carry an FMCG deal to under-rate. The
content-level backstop (`NON_DEAL_NOISE_PATTERN`) is calibrated the same way: it flagged 32 of
297 live articles, all noise, and zero real-deal headlines. When a pattern *could* match a real
deal, it belongs to the LLM, not to a regex or a blocklist.

## Deal-identity merge, after extraction (stage 5b)

De-dup (stage 3) clusters on article-text similarity and is deliberately biased to under-merge
(`COSINE_THRESHOLD = 0.80`). That's right for prose but leaves genuine duplicates when two
outlets word the same deal differently — observed live as Naturis (Entrackr + Inc42) and
Emami/Vedix showing twice. `merge.ts` adds a second pass on the *extracted* identity (acquirer,
target, type, value, date), which is what the deal actually is, so it collapses those without
touching the calibrated cosine threshold. It runs before credibility so the merged deal counts
corroboration across every outlet. Same under-merge bias: when the acquirer is undisclosed and no
value/stake corroborates identity, it shows both rather than risk fusing two real deals.

## Visible confidence badges

Credibility is surfaced to the reader, not folded silently into rank.

**Why:** the heuristic measures *who reported it and how many* — not truth. It cannot separate
a single-source T1 scoop from a widely-syndicated rumour. Hiding a coarse signal inside a rank
score implies more confidence than the method earns. Showing it lets the reader apply the
judgement the heuristic can't.

**Cost:** more UI surface, and a reader has to interpret a badge. Worth it — see
[assumptions.md](./assumptions.md).

## Keyless data sourcing

Google News RSS + public trade feeds. NewsAPI/GNews wired but optional.

**Why:** the demo must run for a reviewer who has no accounts. Free tiers also can't silently
expire mid-review.

**Cost:** RSS gives titles and snippets, not full article text, so extraction works from less
context than it could. Acceptable — deal facts (acquirer, target, value) are near-always in the
headline and lede, which is exactly what RSS carries.

## Grouped newsletter, not ranked flat

**Why:** the reader is usually a category specialist. Someone covering personal care wants
their section, not to scan past beverage deals to reach it. Rank still orders within groups.

**Cost:** the single biggest deal of the period might sit below the fold if its category sorts
late — which is what the TL;DR at the top exists to fix.

## Open refresh button, guarded cron

`/api/refresh` runs the pipeline and writes the live snapshot. The **GET (cron) path requires
the `CRON_SECRET` bearer** — the standard Vercel Cron guard, so a bot hitting the URL can't
drive the schedule. The **POST (button) path is deliberately unauthenticated.**

**Why:** the button's entire purpose is to be clickable by a reviewer on the deployed demo —
it's the answer to "is this real or a fixture?". Gating it behind auth would defeat that, and
the browser can't hold a server secret anyway. The two callers map cleanly to the two methods:
a machine on GET (authenticated), a human on POST (open).

**Cost:** anyone can trigger a pipeline run. The blast radius is bounded on every axis — the
function is capped at 60s, a run only spends free-tier Groq/HF quota, exhausting that quota
degrades to a failed refresh rather than an outage, and the committed seed means the dashboard
never goes empty regardless. A production system with real traffic would put this behind auth
or a rate limit; for a take-home demo, the bound is the mitigation.

## Blob persistence, fixed path + overwrite

The live snapshot is one Blob at a fixed pathname (`snapshots/latest.json`), written with
`allowOverwrite` rather than a random suffix, and read back via `list` → `fetch(..., no-store)`.

**Why:** there's exactly one current snapshot, so there should be exactly one place to read it.
A random-suffix scheme would accumulate orphans and force a "which is newest?" query on every
read. Reads use `no-store` because the pathname is stable across refreshes — a cached read would
serve yesterday's snapshot after the cron writes today's.

**Cost:** no history — each refresh discards the prior snapshot. Fine here: the committed seed is
the durable baseline, and the app only ever shows the latest. Point-in-time records, if ever
needed, are what the JSON export is for.
