# Pipeline

Eight stages. Each takes data and returns data, so each can be run and inspected in
isolation. This doc is the reference for *why* each stage decides what it decides — the
dedup and relevance stages especially, since those are where the interesting judgement calls
live.

```
ingest → clean → dedup → relevance → extract → credibility → rank → newsletter
```

Every stage records its input and output counts into `Snapshot.funnel`, so the dashboard can
show attrition honestly (see [data-model.md](./data-model.md#funnel)).

---

## 1. Ingest

**In:** nothing · **Out:** `Article[]` (raw) · **Network:** yes (RSS) · **Cost:** free

Two source shapes, both keyless:

**Google News RSS** — the cartesian product of deal verbs × FMCG entities, issued as search
queries with `hl=en-IN&gl=IN` to bias toward Indian coverage.

- *Deal verbs:* acquire, acquisition, merger, buyout, stake, invests, funding, raises,
  Series, PE, JV, takeover, divest
- *FMCG entities:* a watchlist (HUL, ITC, Dabur, Marico, Nestlé, Unilever, P&G, Colgate,
  Britannia, Tata Consumer, Emami, …) plus category words

**Direct trade feeds** — Economic Times, Livemint, Business Standard, Moneycontrol,
BusinessLine, Financial Express, VCCircle, Entrackr, Inc42, Just Food, FoodDive.

Feeds fetch concurrently. Per-feed item caps and a bounded feed count keep the fan-in inside
the 60s function budget — see [architecture.md](./architecture.md#runtime-and-timeout-strategy).

A failing feed is logged and skipped, never fatal. One dead RSS endpoint must not take down
a refresh.

---

## 2. Clean

**In:** `Article[]` · **Out:** `Article[]` · **Network:** no · **Cost:** free

Pure normalization, and it earns its place by making every later stage simpler:

- Strip HTML from titles and snippets (RSS descriptions are full of markup).
- **Canonicalize URLs** — drop `utm_*` and tracking params, resolve Google News redirect
  wrappers to the publisher URL, normalize scheme/host casing, strip trailing slashes.
- Normalize dates to ISO 8601.
- Unify source names — "The Economic Times", "Economic Times", and "ET Bureau" are one source
  for tiering and corroboration purposes.

Canonical URLs and unified source names are load-bearing: exact-URL dedup depends on the
first, and credibility tiering plus corroboration counting depend on the second. Getting this
wrong quietly inflates the corroboration count, which quietly inflates confidence badges.

### Known limitation: Google News redirects

Modern Google News RSS links take the form `news.google.com/rss/articles/CBMi...`, which
encodes the publisher URL in a way that can only be resolved by *following the redirect* — one
network call per article. We don't spend that here.

**Measured on a live run (2026-07-16): 40 of 99 articles retained a `news.google.com` URL.**

Consequence: those 40 cannot be collapsed by exact-URL match, because two outlets' Google News
wrappers for the same story are different strings. They fall through to the embedding stage,
which is designed to catch exactly this. Older `?url=`-style wrappers are unwrapped for free.

The publisher is still recovered without the redirect — Google News supplies it in a `<source>`
element and as a `" - Publisher"` title suffix — so tiering and corroboration are unaffected.
Only exact-URL dedup loses coverage, and stage 3 is the backstop.

---

## 3. De-dup

**In:** `Article[]` · **Out:** `Cluster[]` + canonical `Article[]` · **Network:** yes (HF) · **Cost:** ~free

The same deal gets reported by fifteen outlets within an hour, usually rewording the same
wire copy. Naive title matching fails on this — "HUL acquires Minimalist for ₹2,955 crore"
and "Hindustan Unilever to buy skincare brand Minimalist" are the same story with almost no
lexical overlap.

Four steps, cheapest first:

1. **Exact canonical-URL match** → drop outright. Free, catches syndication.
2. **Embed `title + snippet`** via HF `all-MiniLM-L6-v2` (batched, one request).
3. **Cluster on cosine ≥ 0.80.** The primary signal — it catches the reworded-wire case
   that lexical matching misses. Threshold calibrated, not assumed — see below.
4. **Token-sort ≥ 95** as an *additional* merge signal (an OR, not a precondition).

Clustering is single-link: A~B and B~C puts all three together even if A and C don't match
directly. News stories drift across rewrites, and the intermediate version is often what
connects the two ends.

### Calibration

Both numbers above came from measuring, not from judgement. `scripts/calibrate-dedup.ts`
scores all 7,626 pairs in a live 124-article snapshot plus five hand-labelled control pairs.

**The plan's 0.85 was too high.** Measured on live data:

| Pair | Cosine | Truth |
|---|---|---|
| L'Oréal/Innovist — two outlets, one deal | 0.818 | SAME |
| SwitchOn $8M round — two outlets | 0.815 | SAME |
| ITC Hotels/GHK — same story, different angle | 0.796 | SAME |
| Two unrelated refurbished-electronics stories | 0.795 | DIFFERENT |

At 0.85, the first three survive as duplicates — including the exact case dedup exists for.

**The bands genuinely touch.** A true duplicate scores 0.796 and the first false merge scores
0.795. There is no threshold that is simply "correct" here, so the choice is which way to be
wrong. We take 0.80 and bias toward under-merging, because the failure modes aren't
symmetric: an over-merge **deletes a real deal** from the newsletter, while an under-merge
merely shows it twice. Redundancy is visible and survivable; silent loss is neither.

At 0.80, the snapshot yields 6 merged clusters (124 → 112 canonical) with **no false merges
on inspection** — including the L'Oréal/Innovist pair, and a 5-article ITC Hotels cluster.

### Why the guard became a fast path

The plan specified token-sort ≥ 90 as a *guard*: a check that must also pass before merging.
The intent was to stop embeddings over-merging in a narrow domain, where two different deals
share a sentence shape:

> "Dabur acquires stake in Badshah Masala"
> "Marico acquires stake in Plix"

**The data inverted this.** Two findings killed the design:

1. **The feared case never appeared.** That control pair scores **0.285** — nowhere near any
   plausible threshold. Cosine rejects it unaided. The closest real analogue, two genuinely
   different Tata Consumer acquisitions, scores 0.667 — still below 0.80.
2. **Real duplicates score 28–74 on token-sort.** Headlines of the same story share
   remarkably few literal tokens. The L'Oréal pair scores 58; the ITC Hotels cluster, 33–43.
   Requiring ≥ 90 would have blocked *nearly every genuine merge* — the guard would have
   quietly disabled the stage it was meant to protect.

So it's now an **OR at ≥ 95**: literally-identical headlines merge without consulting the
embedding, which catches syndicated copy. It adds recall instead of removing it, and costs
nothing when it doesn't fire.

The general lesson is worth keeping: a plausible-sounding guard, unmeasured, would have been
worse than no guard at all — and it would have failed *silently*, as duplicates in the
newsletter with no error anywhere.

### Tunables

| Knob | Value | Effect if raised |
|---|---|---|
| `COSINE_THRESHOLD` | 0.80 | Fewer merges, more duplicates survive |
| `TITLE_MATCH_RATIO` | 95 | Fast path fires less often (cosine still merges) |

Re-run `npm run calibrate:dedup` after any change to the embedding model or `embedText()` —
these numbers are specific to `all-MiniLM-L6-v2` over `title + snippet`, and won't transfer.

### Canonical selection

Within a cluster: **highest source tier wins**, ties broken by **earliest publication date**.
Tier first because the canonical article's URL is what we surface as the primary source and
what the reader clicks — a Reuters link beats an aggregator's rewrite of it. Date second
because, tier being equal, the outlet that broke it is the better citation.

Collapsed members are retained in `Cluster.memberIds` and in the raw export. They are not
discarded — they *are* the corroboration evidence that stage 6 consumes.

Verified on live data: the 6 merged clusters all picked a T1 canonical (Economic Times,
Moneycontrol, Mint) over T2 rewrites of the same story.

---

## 4. Relevance

**In:** canonical `Article[]` · **Out:** filtered `Article[]` + verdicts · **Network:** yes (Groq) · **Cost:** low

Two-phase, and the ordering is the whole point.

**Phase 1 — regex pre-filter (free).** An article must plausibly contain a deal verb *and*
an FMCG signal. Cheap, high-recall, deliberately loose. Its job is to throw out the obvious
noise that RSS keyword queries drag in: quarterly earnings, product launches, "Unilever CEO
says…" interviews, stock-price commentary.

**Phase 2 — Groq `llama-3.1-8b-instant` (paid).** Only survivors get a classification call:

```jsonc
{ "is_fmcg_deal": true, "deal_type": "M&A", "confidence": 0.91, "reasoning": "…" }
```

Ordering matters because the pre-filter typically removes the majority of ingested items, and
every one it removes is an LLM call not made. That's what keeps the refresh inside the 60s
budget and the cost near zero. Doing it the other way around — LLM first, then filter — would
be the same output at many times the latency.

The pre-filter is tuned for **recall, not precision.** It is allowed to pass junk through,
because the LLM behind it is the precision stage. It is *not* allowed to drop real deals,
because nothing downstream can recover them. When in doubt, the regex passes it on.

`reasoning` is retained in the raw data. It is the audit trail for "why is this in the
newsletter?" and it costs nothing to keep.

---

## 5. Extract

**In:** relevant `Article[]` · **Out:** `Deal[]` · **Network:** yes (Groq) · **Cost:** low

Groq `8b-instant`, JSON-mode, one call per article, concurrent:

```jsonc
{
  "acquirer": "Hindustan Unilever",
  "target": "Minimalist",
  "deal_type": "M&A",
  "deal_value": 2955, "currency": "INR_CRORE",
  "stake_pct": 90.5,
  "category": "Personal care",
  "region": "India",
  "announced_date": "2025-01-15",
  "one_line": "HUL buys skincare brand Minimalist at a ₹3,000 crore valuation."
}
```

Every field except `deal_type` and `category` is nullable, and that is intentional. Press
coverage frequently omits deal value ("terms were not disclosed") and stake percentage. A
schema that forces those fields invites the model to invent them. Absent is a fact; fabricated
is a bug.

Currency is carried explicitly rather than normalized to USD at extract time. Cross-currency
conversion needs a rate and a date, and guessing either would corrupt the number. Rank buckets
deal size coarsely instead, which is all the ranking actually needs.

---

## 6. Credibility

**In:** `Deal[]` + `Cluster[]` · **Out:** `Deal[]` (scored) · **Network:** no · **Cost:** free

Two inputs: where it was published, and how many independent outlets carried it.

### Source tiers

| Tier | Sources |
|---|---|
| T1 | Reuters, Bloomberg, Economic Times, Mint, Business Standard, Moneycontrol, BusinessLine, VCCircle |
| T2 | Inc42, Entrackr, YourStory, Just Food, FoodDive |
| T3 | unknown / aggregators / blogs |

Unknown sources default to T3 — an allowlist, not a blocklist. A new domain is untrusted
until it's explicitly vouched for, which is the correct default when the input is the open web.

### Corroboration

A deal reported by ≥2 *independent* sources gets a confidence boost. "Independent" is why
stage 2's source unification matters: three URLs from the same publisher are one source, and
counting them as three would manufacture false confidence.

The cluster from stage 3 is exactly the corroboration set — this stage is where the members
we collapsed earn their keep.

### Badge

`High` / `Med` / `Low`, surfaced in the UI next to every deal and in the newsletter.

This is a **heuristic, not fact-checking.** It measures "who reported it and how many", not
"is it true". A single-source T1 scoop and a widely-syndicated rumour are genuinely hard to
tell apart this way. The badge is shown rather than silently folded into rank so the reader
can apply their own judgement — the honest move when the underlying signal is this coarse.

---

## 7. Rank

**In:** scored `Deal[]` · **Out:** ordered, grouped `Deal[]` · **Network:** no · **Cost:** free

```
score = 0.35·relevance + 0.30·credibility + 0.20·recency + 0.15·deal-size bucket
```

Then group by category (Food / Beverage / Personal care / Home care) and take the top ~10–12.

The weights encode an editorial stance worth making explicit: **relevance and credibility
together are 65%** — a newsletter that surfaces an off-topic or badly-sourced item has failed
at its job, regardless of how big or recent the deal is. Recency at 20% matters but doesn't
dominate inside an already 30-day-bounded window. Deal size is deliberately the *smallest*
weight and bucketed rather than continuous, because raw value is a poor proxy for
interestingness — a ₹200cr acquisition of a fast-growing D2C brand is often the better story
than a ₹5,000cr stake shuffle, and undisclosed-value deals must not be pushed to the bottom
merely for being undisclosed.

---

## 8. Newsletter

**In:** ranked `Deal[]` · **Out:** `Newsletter` · **Network:** yes (Groq) · **Cost:** moderate

One call to `llama-3.3-70b-versatile` — the only large-model call in the pipeline, spent on
the one artifact a human actually reads end to end.

Structure:

1. **Period TL;DR** — 3–4 bullets, the "if you read nothing else" layer.
2. **Per category** — for each deal: headline, 2–3 sentence summary, "why it matters",
   source link + confidence badge.
3. **Methodology footer** — window, source count, funnel numbers, what the badge means.

The model writes *prose over the extracted fields*. It does not pick the deals, score them,
or decide the order — stages 4–7 already did that deterministically. Keeping selection out of
the generation step is what makes the output auditable: every claim in the newsletter traces
to a `Deal` record, which traces to a cluster, which traces to source URLs.

The methodology footer ships in the newsletter itself, not just the README, because the
newsletter is the artifact that gets forwarded to someone who never saw the repo.
