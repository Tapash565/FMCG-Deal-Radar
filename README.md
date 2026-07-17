# FMCG Deal Radar

An agentic pipeline that aggregates recent FMCG M&A and investment news, de-duplicates and
scores it, and drafts a skimmable intelligence newsletter.

**Scope:** India FMCG + global majors · deals = M&A + funding + stakes + JVs · rolling 90-day
window.

> Built for the Benori take-home assignment.

---

## Status

✅ **Feature-complete.** All eight pipeline stages, the dashboard, the newsletter draft,
the five export routes (DOCX / XLSX / PPTX / CSV / JSON), and the live-refresh loop (the
**Refresh now** button + daily cron, both persisting to Vercel Blob) are working end to
end. What's left is the operational step of deploying to Vercel — see [Roadmap](#roadmap).

## Quick start

```bash
npm install
npm run dev
```

Opens on http://localhost:3000 and renders the committed seed snapshot. **No API keys
required** for a read-only demo.

For live refresh, copy `.env.example` to `.env.local` and fill in the keys:

```bash
cp .env.example .env.local
```

| Var | Purpose |
|---|---|
| `GROQ_API_KEY` | Classification, extraction, newsletter drafting |
| `HF_API_TOKEN` | Dedup embeddings |
| `BLOB_READ_WRITE_TOKEN` | Live snapshot persistence |
| `CRON_SECRET` | Guards the daily cron route |

Verify the providers respond before running anything:

```bash
npm run check:providers
```

Regenerate the seed snapshot:

```bash
npm run pipeline                  # 90-day window — takes minutes, see below
WINDOW_DAYS=30 npm run pipeline   # ~30s, fewer deals — for iterating
```

**Expect `npm run pipeline` to take minutes, and know that this is fine.** Groq's free tier
allows 6,000 tokens/min, and a 90-day window is ~385 articles, so the run deliberately waits
out rate-limit windows rather than failing. It runs *offline* — the deployed app never invokes
it and no reviewer waits on it; they read the committed `data/snapshot.json`. Paying a few
minutes once to get 12 deals across four categories beats a fast run that finds three.

A run that yields 0 deals will refuse to overwrite a non-empty seed (that's almost always a
rate-limit failure, not a result). Pass `--force` if 0 is genuinely correct.

## How it works

```
sources → ingest → clean → dedup → relevance → extract → credibility → rank → newsletter
                                                                                    ↓
                                                                              snapshot.json
                                                                                    ↓
                                                                       dashboard + exports
```

The whole system is one Next.js app — no separate backend, no database. The pipeline runs in a
route handler, writes a single `Snapshot` JSON object, and every UI surface reads it. A seed
snapshot is committed so the demo is never empty.

Two stages carry most of the interesting logic:

**De-dup** — the same deal gets reported by fifteen outlets within an hour, usually rewording
the same wire copy. Exact-URL match catches syndication; HF `all-MiniLM-L6-v2` embeddings with
**cosine ≥ 0.80** catch the reworded case that lexical matching misses.

That threshold is measured, not chosen: `npm run calibrate:dedup` scores all 7,626 pairs in a
live snapshot against hand-labelled controls. The plan's original 0.85 turned out to *miss*
real duplicates (two outlets on the same L'Oréal/Innovist deal score 0.818). The bands touch —
a true duplicate scores 0.796, the first false merge 0.795 — so 0.80 biases toward
under-merging, because an over-merge deletes a real deal while an under-merge only shows it
twice.

Calibration also inverted the plan's fuzzy title guard. It was specified as a precondition
(token-sort ≥ 90 required *before* merging), but real duplicates share almost no literal
tokens — they score 28–74 — so that would have blocked nearly every genuine merge, silently.
It's now an OR at ≥ 95: identical headlines merge without consulting the embedding.

**Relevance** — three passes, cheapest first, each filtering for the next:

| Pass | Cost | Sees | Job |
|---|---|---|---|
| Regex pre-filter | free | title + snippet | drop the obvious (~306 → ~128) |
| LLM screen | ~737 tokens / 25 articles | titles only | recall (~128 → ~15) |
| LLM confirm | full prompt | title + snippet | precision, on survivors only |

Each stage is tuned for **recall, not precision** — it may pass junk, since the next stage is
stricter, but it must not drop a real deal, because nothing downstream can recover one. The
ordering is the whole point: the screen pass costs ~26 tokens per article versus ~180 for the
full prompt, and the expensive prompt only ever runs on the handful that survive.

That matters because the binding constraint isn't Vercel's 60s limit — it's Groq's free tier
at **6,000 tokens/min**. Naively running the full prompt over every candidate cost ~26,000
tokens; this costs about a quarter of that.

Full detail in [docs/pipeline.md](./docs/pipeline.md).

## Documentation

| Doc | Covers |
|---|---|
| [architecture.md](./docs/architecture.md) | System diagram, request flows, timeout strategy, deployment |
| [pipeline.md](./docs/pipeline.md) | The eight stages — dedup and relevance logic especially |
| [data-model.md](./docs/data-model.md) | TypeScript interfaces, snapshot contract, funnel |
| [features.md](./docs/features.md) | Dashboard, exports, newsletter format |
| [decisions.md](./docs/decisions.md) | Locked decisions and what each one costs |
| [assumptions.md](./docs/assumptions.md) | Scope boundaries and honest limitations |

## Stack

| Concern | Choice |
|---|---|
| App | Next.js 16 (App Router), React 19, TypeScript, Tailwind 4 |
| LLM | Groq — `llama-3.1-8b-instant` (classify/extract), `llama-3.3-70b-versatile` (newsletter) |
| Embeddings | HuggingFace Inference API — `all-MiniLM-L6-v2` |
| Sourcing | Google News RSS + trade feeds (keyless); NewsAPI/GNews optional |
| Persistence | Vercel Blob (live) + committed seed JSON |
| Exports | `docx`, `exceljs`, `pptxgenjs`, `papaparse` |
| Deploy | Vercel + daily Cron |

## Layout

```
app/
  page.tsx                       # dashboard
  api/refresh/route.ts           # runs pipeline, maxDuration=60, persists to Blob
  api/export/[format]/route.ts   # docx | xlsx | pptx | csv | json
lib/
  types.ts                       # the Snapshot contract
  sources.ts                     # feed registry, tiers, query construction
  groq.ts  hf.ts                 # provider clients
  pipeline/{ingest,clean,dedup,relevance,extract,credibility,rank,newsletter}.ts
  export/{docx,xlsx,pptx}.ts
scripts/run-pipeline.ts          # local / cron regen of snapshot
data/snapshot.json               # committed seed — demo always has content
outputs/                         # sample exports: newsletter.docx, deals.xlsx, deck.pptx, deals.csv, snapshot.json
docs/                            # architecture, pipeline, decisions, assumptions
```

## Assumptions

Stated in full in [docs/assumptions.md](./docs/assumptions.md). The short version:

- **"Real-time" = on-demand refresh + daily cron**, not always-on streaming.
- **Credibility is a source-tier + corroboration heuristic, not fact-checking.** It measures
  who reported a deal and how many outlets carried it — not whether it's true. That's why the
  badge is shown to the reader rather than hidden inside a rank score.
- **Demo universe is India FMCG + global majors, 90-day window.** Anything outside is never
  ingested, and the app can't tell you what it's missing. The window is a coverage/cost
  choice: at 30 days the corpus yielded three deals in one category, at 90 it yields twelve
  across four.
- **Free tiers set the pace.** Groq allows 6,000 tokens/min, which is the hardest constraint
  in the project — harder than Vercel's 60s ceiling. Seed generation takes minutes and that's
  by design; live refresh needs a narrower window or a paid tier.
- **Free data tiers only.** RSS gives titles and snippets, not article bodies — extraction
  reasons over the headline and lede.
- **The seed snapshot is stale by construction.** `generatedAt` is shown prominently so a
  reader always knows how old the data is.

## Roadmap

- [x] Scaffold, docs, source registry, data model
- [x] `ingest` + `clean` + first snapshot
- [x] `dedup` (HF cosine, threshold calibrated against live data)
- [x] `relevance` (regex → LLM screen → LLM confirm) + `extract`
- [x] `credibility` + `rank`
- [x] Dashboard — funnel panel + deals table
- [x] `newsletter` draft (Groq 70b)
- [x] Export routes — DOCX / XLSX / PPTX / CSV / JSON
- [x] Refresh button + Blob persistence (`/api/refresh`, guarded cron, seed fallback)
- [ ] Deploy to Vercel + daily cron *(code + `vercel.json` cron ready; deploy is the ops step)*

Known gaps, tracked honestly:

- **The Blob round-trip is only exercised with a token.** Locally (no `BLOB_READ_WRITE_TOKEN`)
  `loadSnapshot()` falls back to the seed and `/api/refresh` runs the full pipeline but reports
  `persisted: false`. The put/list/fetch path itself is verified only where a token exists — a
  deployed Vercel env, or one exported locally.
- The **Refresh button (POST) is intentionally open**; the **cron (GET) is guarded** by
  `CRON_SECRET`. A public, clickable refresh is the demo's whole point, and its cost is bounded
  (60s cap, free-tier quota, seed fallback). See [decisions.md](./docs/decisions.md).
- Dedup under-merges occasionally (the same funding round can appear twice). That's the
  deliberate bias — an over-merge deletes a real deal, an under-merge only repeats one.
- `relevanceConf` is near-constant (0.9–1.0), so its 35% weight in the rank formula does
  little work in practice.
