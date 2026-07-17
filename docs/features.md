# Features

What the app does, from the user's side. For *how*, see [pipeline.md](./pipeline.md).

## Dashboard

The single page. Four regions, top to bottom:

### 1. Header — window + freshness

Period covered (rolling 90 days), `generatedAt` timestamp, and a **Refresh now** button.

The timestamp is prominent by design. This is a snapshot-based system, and the honest way to
present that is to show the reader exactly how old the data is rather than implying a
liveness the pipeline doesn't have.

### 2. Funnel panel

`ingested → deduped → relevant → selected` as four counts.

This is the pipeline made legible. A reader sees at a glance that ~200 raw items became ~12
deals, and that the work happened in between. It also doubles as the project's own diagnostic:
if `relevant` collapses toward zero, a filter is mis-tuned, and the funnel is where you'd see
it first.

### 3. Deals table

One row per selected deal:

| Column | Notes |
|---|---|
| Acquirer → Target | The headline fact |
| Type | M&A / Funding / Stake / JV |
| Value | With currency; **"Undisclosed"** when absent, never blank or zero |
| Stake % | When disclosed |
| Category | Food / Beverage / Personal care / Home care |
| Date | Announced |
| Confidence | High / Med / Low badge |
| Source | Link to the canonical article |

Sortable and filterable by category, deal type, and confidence.

"Undisclosed" rather than an empty cell matters: an empty cell reads as *missing data* (we
failed to get it), while "Undisclosed" reads as *a fact about the deal* (they didn't say).
Those are different claims and the table should not conflate them.

### 4. Newsletter preview

The generated draft, rendered as it will export. TL;DR bullets, then deals grouped by
category. What you see is what lands in the DOCX.

## Confidence badges

Every deal carries **High / Med / Low**, derived from source tier + corroboration count
(see [pipeline.md](./pipeline.md#6-credibility)).

Hovering shows the corroborating sources — the reader can check *why* something is High
rather than taking the badge on faith.

The badge is displayed rather than folded silently into rank because the underlying signal is
coarse. It measures who reported a deal and how many outlets carried it — not whether it's
true. Surfacing it lets the reader apply judgement the heuristic can't. A single-source T1
scoop and a widely-syndicated rumour are genuinely hard to separate this way, and pretending
otherwise would be the dishonest choice.

## Refresh

**Refresh now** runs the full pipeline live and persists a new snapshot. Takes tens of
seconds — bounded to fit Vercel's 60s function limit.

The button is the answer to "is this real or just a fixture?" The committed seed makes the
demo reliable; the refresh button proves the pipeline behind it actually runs.

A **daily Vercel Cron** does the same thing unattended, so the deployed demo stays current
without anyone clicking anything.

## Exports

Five formats, all rendered from the same snapshot — so no export can disagree with the
dashboard.

| Format | Route | Purpose |
|---|---|---|
| **Word** (.docx) | `/api/export/docx` | The hero deliverable — the newsletter as a sendable document |
| Excel (.xlsx) | `/api/export/xlsx` | Deals as a workbook, one row per deal, filterable |
| PowerPoint (.pptx) | `/api/export/pptx` | Title + TL;DR + one slide per category |
| CSV | `/api/export/csv` | Raw deal data |
| JSON | `/api/export/json` | Full snapshot — deals, clusters, funnel, newsletter |

Word is the hero because the artifact being asked for is *a newsletter*, and a newsletter's
native form is a document someone forwards — not a table or a deck.

JSON is the raw-data deliverable. Because a snapshot is immutable and self-describing, the
JSON export is a complete point-in-time record on its own: it contains the funnel counts, the
scores, and the cluster→article chain, so a reader can audit any claim in the newsletter
without the app.

## Newsletter format

1. **TL;DR** — 3–4 bullets. The "if you read nothing else" layer.
2. **By category** — Food, Beverage, Personal care, Home care. Per deal: headline, 2–3
   sentence summary, why it matters, source link + badge.
3. **Methodology footer** — window, sources, funnel counts, what the badge means.

Grouped by category rather than ranked flat because the reader is usually a
category specialist — someone covering personal care wants their section, not to scan past
beverage deals to find it. Rank still orders deals *within* each group.

The methodology footer ships inside the newsletter, not only in the README, because the
newsletter is the artifact that gets forwarded to someone who never saw the repo. It should
be able to explain itself standing alone.
