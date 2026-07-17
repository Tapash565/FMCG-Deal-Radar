# Assumptions and limitations

Stated up front, and repeated in the README and the newsletter's methodology footer. A tool
that scores other people's credibility should be legible about its own.

## "Real-time" means on-demand + daily, not streaming

The system refreshes when someone clicks **Refresh now** and once a day via cron. It does not
stream, poll continuously, or push.

For a rolling deal digest this is the right granularity — deals are announced, not
emitted continuously, and a reader checking a weekly newsletter does not need sub-minute
latency. But "real-time" in a strict sense is not what this does, and the dashboard shows
`generatedAt` prominently rather than implying otherwise.

## Credibility is a heuristic, not fact-checking

The badge is computed from **source tier + corroboration count**. That is: *who published it*
and *how many independent outlets carried it*. It is not a truth claim.

What it cannot do:

- **Separate a scoop from a rumour.** A single-source Reuters exclusive and a single-source
  unverified report look similar to this method. Tier helps; it doesn't resolve it.
- **Detect wire-copy echo.** Fifteen outlets running the same agency story is fifteen outlets,
  but roughly one act of reporting. Corroboration counts distinct publishers, which
  over-credits syndication.
- **Catch a confidently-wrong T1 story.** Tier-1 outlets do report deals that fall through.

This is why the badge is *shown* rather than folded into the rank score — see
[decisions.md](./decisions.md#visible-confidence-badges). The reader supplies the judgement
the heuristic can't.

## Scope is deliberately narrow

**India FMCG + global majors · M&A + funding + stakes + JVs · rolling 90 days.**

Everything outside that is invisible to the system — not filtered out, never ingested. A
European mid-cap deal with no India angle will not appear, and the app has no way to tell you
it's missing.

The window is a product decision (a digest, not an archive), and it's why there's no
history: each refresh replaces the snapshot wholesale.

## Free LLM tiers set the pace, and it is slow

**Groq's free tier allows 6,000 tokens per minute.** This is the hardest constraint in the
project — harder than Vercel's 60s function limit, which is what we originally expected to
fight.

The arithmetic is unforgiving. A 90-day window is ~400 articles → ~130 pre-filter survivors →
~11 batched classify calls at ~2,400 tokens each ≈ 26,000 tokens for the relevance stage
alone, before extraction or drafting. At 6,000 TPM that is **several minutes of pure waiting**,
and no amount of tuning changes it. Measured, not theorised: the same stage ran in 1.7s with
quota available and sat out a 570-second advised wait once exhausted.

**Why we tolerate it: the slow path runs once.** `npm run pipeline` generates the committed
seed. The deployed app never invokes it, and no reviewer ever waits on it — they read
`data/snapshot.json`. A generator that takes four minutes and runs daily is not a user-facing
cost, so we spend the time to get 12 deals across four categories instead of three deals in
one. (Duration only genuinely binds on `/api/refresh`, which is a different budget.)

Consequences we accept:

- **`npm run pipeline` takes minutes, by design.** It waits out rate-limit windows rather
  than failing (`GROQ_MAX_BACKOFF_MS=600000`). Slow is fine — it runs offline, and the seed
  it produces is committed. Use `WINDOW_DAYS=30` for a snapshot in seconds while iterating.
- **`/api/refresh` cannot reproduce a full run.** It keeps a tight backoff and fails fast,
  because Vercel kills it at 60s regardless. A live refresh needs a narrower window or a paid
  tier. The button proves the pipeline is real; it does not rebuild the whole corpus.
- **Concurrency is not the answer, and actively hurts.** At 8 concurrent calls one request
  blocked for 25s while sequential calls returned in 0.3s, and 10 of 24 failed. The limiter
  is the bottleneck, so parallelism buys nothing and costs reliability.

Upgrading the Groq tier removes most of this. On free tiers, patience is the design.

## Free data tiers only

Google News RSS + public trade feeds. No API keys required.

Consequences worth naming:

- **RSS gives titles and snippets, not article bodies.** Extraction reasons over the headline
  and lede. This is usually enough — deal facts live in the first sentence — but a detail
  buried in paragraph nine is out of reach.
- **Coverage is whatever the feeds carry.** Paywalled scoops and outlets without RSS are
  simply absent.
- **Google News RSS is an undocumented interface.** It can change shape without notice. Feed
  failures are logged and skipped rather than fatal, so a broken feed silently narrows
  coverage rather than breaking the run — a trade-off in favour of demo reliability.

NewsAPI/GNews are wired but optional, and would widen coverage if keys are added.

## LLM extraction can be wrong

`8b-instant` reads press copy and emits structured fields. It will sometimes misparse — swap
acquirer and target in an awkwardly-worded headline, or misread a valuation as a deal value.

Mitigations, not fixes:

- Optional fields are genuinely optional, so the model can decline rather than invent.
- `reasoning` is retained on every classification, so a bad call is auditable.
- Every deal chains back to source URLs, so any claim can be checked against the original.

Nothing here is human-reviewed before it renders. This is a demo pipeline, not an editorial
desk.

## Dedup will make mistakes in both directions

Cosine ≥ 0.80 is a calibrated threshold, not a solved problem. It was measured against live
data ([pipeline.md](./pipeline.md#calibration)) — which is what makes its limits knowable
rather than hypothetical.

**The true and false bands overlap.** In the calibration set a genuine duplicate scores 0.796
and the first false merge scores 0.795. No threshold separates those cleanly, so errors in
both directions are guaranteed by construction, not by bad tuning:

- **Under-merge:** the same deal covered from angles far enough apart to fall below 0.80 — a
  valuation story and a regulatory-approval story on one transaction. Shows as the same deal
  appearing twice.
- **Over-merge:** two different deals scoring above it. Rarer at 0.80, and the feared case
  (same sentence shape, different parties) turned out to score 0.285 — cosine rejects it
  easily. But it's the more damaging error: an over-merge **deletes a real deal**.

We bias toward under-merging deliberately, because those failure modes aren't equally bad.
A duplicate is visible to the reader; a deleted deal is invisible to everyone.

Calibration is also **specific to this model and this text**. The numbers hold for
`all-MiniLM-L6-v2` over `title + snippet` and would need re-deriving for any other — which is
what `npm run calibrate:dedup` is for. It measures 7,626 real pairs plus hand-labelled
controls, and inspection of the resulting clusters is by eye, on one snapshot. That is a
sanity check, not a test set with ground truth.

## The seed snapshot is stale by construction

`data/snapshot.json` is committed, so it reflects whenever it was last generated — not today.
A reader who doesn't click Refresh is looking at a fixture.

Mitigated by showing `generatedAt` in the header. Not hidden, because the alternative — an
empty demo when the reviewer opens it — is worse.

## What would change with more time

- Full-article fetch for richer extraction context, rather than RSS snippets alone.
- Entity resolution on company names ("HUL" / "Hindustan Unilever" / "Hindustan Unilever Ltd"
  are one entity; the current pipeline treats string variants as distinct).
- Snapshot history, enabling trend views and "what changed since last week".
- Human-in-the-loop review before a newsletter is considered sendable.
- Wire-copy detection, to stop syndication from inflating corroboration counts.
