# FMCG Deal Radar — UI Review

**Audited:** 2026-07-17
**Baseline:** Abstract 6-pillar standards (no UI-SPEC.md — non-GSD project)
**Screenshots:** Captured — desktop 1440, tablet 768, mobile 375 (all rendered in dark mode; light mode verified from code only)

---

## Resolution (applied same day)

Four of the five priority fixes were applied and verified (typecheck + lint + build green;
desktop/mobile re-screenshotted; keyboard focus checked via DevTools Protocol):

- ✓ **#1 Funnel contrast** — counts and hints now sit on the card background above slim,
  comparable bars; no text is overlaid on a coloured fill. (`app/page.tsx`)
- ✓ **#2 Mobile table scroll** — added a below-`md` "scroll sideways" hint and a right-edge
  fade so the off-screen columns are discoverable. (`components/DealsTable.tsx`)
- ✓ **#3 Focus-visible states** — consistent `focus-visible:ring` on pills, sort headers,
  Reset, Refresh, and source links; confirmed each control matches `:focus-visible` and
  renders a ring on Tab. (`DealsTable.tsx`, `RefreshButton.tsx`, `page.tsx`)
- ✓ **#5 Undisclosed acquirer** — a nameless buyer now renders as a muted italic
  "Undisclosed acquirer" rather than a company literally named "Undisclosed".
  (`components/DealsTable.tsx`)
- ◻ **#4 Duplicate rows** — deferred: this is the upstream dedup under-merge (a deliberate
  bias documented in the README), not a UI defect. Fixing it belongs in the dedup stage,
  not a client-side heuristic.

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 4/4 | Specific, honest labels and states throughout; only the table's `Undisclosed →` / `Undisclosed (100%)` cells read ambiguously (data-driven). |
| 2. Visuals | 3/4 | Clean hierarchy and restraint, but funnel bar labels use fixed text colors overlaid on variably-colored bars, producing low-contrast hint text. |
| 3. Color | 4/4 | 117 zinc usages vs a handful of semantic accents — textbook neutral dominance; zero hardcoded colors in components. |
| 4. Typography | 4/4 | Four sizes, two weights, tabular-nums on numeric columns; well within limits. |
| 5. Spacing | 4/4 | Every value on the standard 4px scale; the only arbitrary token is `min-w-[680px]` (legitimate table scroll floor). |
| 6. Experience Design | 3/4 | Loading/error/empty/disabled states all handled thoughtfully, but no designed focus-visible states, and the mobile table hides the Confidence column behind an unmarked horizontal scroll. |

**Overall: 22/24**

---

## Top Priority Fixes

1. **Funnel bar hint text has fixed colors on variable-color bars** (`app/page.tsx:38-43`) — the number (`text-zinc-900 dark:text-zinc-100`) and hint (`text-zinc-500 dark:text-zinc-400`) are absolutely positioned over bars whose fill changes per stage (zinc-300/600, sky, violet, emerald) and over the light track behind short bars. On the wide Ingested (`bg-zinc-600` in dark) and De-duped (`bg-sky-500/80`) bars, the zinc-400 hint text is low-contrast and hard to read (visible in the desktop screenshot). *User impact:* the pipeline story — the app's stated thesis ("attrition is the work") — is partly illegible. *Fix:* move the hint text to a fixed track region outside the fill, add a subtle scrim behind the overlaid text, or drive text color from the bar it lands on.

2. **Mobile table hides the Confidence column behind an unmarked scroll** (`components/DealsTable.tsx:140-141`) — `overflow-x-auto` + `min-w-[680px]` with no responsive treatment means at 375px the Value/Announced/Confidence columns sit off-screen right, with no gradient/shadow edge to signal that more content exists. Confidence (the most scannable trust signal) is invisible by default. *User impact:* mobile readers miss the primary signal and may not realize the table scrolls. *Fix:* add a scroll-edge shadow affordance, and/or collapse to a stacked card layout below `md:`, or fold Confidence into the Deal cell on narrow widths.

3. **No designed focus-visible states anywhere** (`grep focus|outline` across `app`/`components` returns nothing) — pills (`DealsTable.tsx:297`), sort headers (`:236`), Reset (`:94`), Refresh (`RefreshButton.tsx:63`) and links rely entirely on the browser default outline. For a fully keyboard-operable dashboard this is a real accessibility gap. *User impact:* keyboard users get inconsistent/weak focus indication. *Fix:* add `focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:outline-none` (or equivalent) to the interactive primitives.

4. **Duplicate / near-duplicate rows contradict the "De-duped" funnel claim** (data surfaced at `components/DealsTable.tsx:170-171`) — the table shows two identical `Undisclosed → Naturis Cosmetics · ₹100 cr · 2026-07-16 · Med · 1 src` rows and both `Emami → Vedix, SkinCraft parent` and `Emami → Vedix, SkinKraft` (₹321 cr). This is a pipeline/dedup artifact, but it lands in the UI directly beneath a funnel that advertises "De-duped: 297". *User impact:* undermines the credibility the funnel is built to establish. *Fix:* resolve upstream dedup, or add a "possible duplicate" affordance so identical rows don't read as a bug.

5. **`Undisclosed →` and `Undisclosed (100%)` read ambiguously in the table** (`DealsTable.tsx:186`, `:197-198`; data confirms `acquirer: "Undisclosed"`) — `Undisclosed → Colgate-Palmolive Company` looks like a company named "Undisclosed" acquired Colgate, and `Undisclosed (100%)` in the Value cell mixes an undisclosed price with a 100% stake. The newsletter renders the same deal more clearly ("Undisclosed acquirer acquired stake in…"). *User impact:* minor confusion about deal direction/terms. *Fix:* render an undisclosed acquirer as a muted "Undisclosed acquirer" label rather than a company name, and/or add acquirer→target direction cues to the Deal header.

---

## Detailed Findings

### Pillar 1: Copywriting (4/4)
No generic CTAs found (grep for Submit/OK/Cancel/Save/Click Here is empty). Labels are specific and voice-consistent: "Refresh now" (`RefreshButton.tsx:79`), "Reset" (`DealsTable.tsx:103`), "Source →" (`page.tsx:131`), "Refreshing…" with sub-status "Running the pipeline — tens of seconds." (`RefreshButton.tsx:91`).

Honesty is a strength and clearly intentional: the freshness line states "committed seed" vs "live" (`page.tsx:181-183`), "Generated {relativeAge}" (`:179`), and the footer openly scopes the confidence metric — "measures who reported a deal … not whether it is true" (`page.tsx:204-205`). The "ran but not persisted" branch (`RefreshButton.tsx:98-104`) refuses to imply an update that didn't happen. Two distinct, actionable empty states: "No deals in this snapshot. Run npm run pipeline…" (`page.tsx:192-195`) and "No deals match these filters." (`DealsTable.tsx:136-137`).

Only caveat (kept at 4/4, noted for completeness): the table's `Undisclosed →` and `Undisclosed (100%)` cells (finding #5) are the single place where copy clarity dips, and the cause is data + the unlabeled `→` convention rather than the copy itself.

### Pillar 2: Visuals (3/4)
Focal hierarchy is clear and restrained: a single `text-2xl font-semibold` h1 (`page.tsx:163`), quiet `text-sm text-zinc-500` section labels (`:26`, `:62`, `:87`), and content (funnel, table, newsletter) carrying the weight. Icon-only affordances are labeled — sort carets and dots are `aria-hidden`, the spinner is `aria-hidden`, sortable headers expose `aria-sort` (`DealsTable.tsx:234`), pills expose `aria-pressed` (`:300`).

Two visual defects:
- **Funnel label contrast** (finding #1) — fixed text color over variable bar fills yields low-contrast hint text on the wide zinc-600 and sky bars.
- **Cross-dimension color reuse** — amber encodes both the Food category dot (`categories.ts:11`) and the "Med" confidence badge (`:25`); sky encodes Beverage and the De-duped funnel stage; violet encodes Personal care and the Relevant stage; emerald encodes the "High" badge and the Selected stage. The same hue means different things in different regions. It reads fine in context (dot vs. text-badge vs. bar) but is a latent ambiguity worth a glossary or a deliberate split.

### Pillar 3: Color (4/4)
Neutral dominance is textbook: 117 zinc `text/bg/border/ring` usages against a small, entirely-semantic accent set (emerald 4, blue 4, violet 2, sky 2, red 2, amber 2, plus teal/zinc dots). No hardcoded colors in any component — the only hex literals are theme tokens in `globals.css` (`--background`/`--foreground` at `:4-5,:17-18`) and the `::selection` blue (`:32`), which is the correct place for them. Accents are all functional (category encoding, confidence, funnel stages, links, error text), which matches the project's stated "restrained, honest, information-dense" intent rather than decoration. Full light/dark parity via `dark:` variants throughout. The cross-dimension reuse noted under Visuals is the only reason to think about this pillar further; it does not warrant a deduction.

### Pillar 4: Typography (4/4)
Distinct sizes in use: `text-xs` (22), `text-sm` (14), `text-lg` (1), `text-2xl` (1), over the default base — four steps, within the ≤4 guideline. Weights: `font-medium` (16), `font-semibold` (5) — two, within the ≤2 guideline. Numeric alignment handled with `tabular-nums` on value/date/count cells (`DealsTable.tsx:89,194,200`) and in the funnel (`page.tsx:39`). Geist sans/mono load in `layout.tsx:5-13`, and `globals.css:25-27` documents fixing a prior Arial override that had suppressed the loaded font. The single arbitrary size, `text-[0.65rem]` (`DealsTable.tsx:245`), is the sort-caret glyph — a decorative icon, not body text — so it is acceptable.

### Pillar 5: Spacing (4/4)
Every spacing utility resolves to the standard 4px scale (`p-3/4/6/8`, `py-1/1.5/3/10`, `gap-1/1.5/2/3`, `mt-0.5/1/…/12`, `space-y-1.5/2/5`). No arbitrary spacing values. The only bracketed token is `min-w-[680px]` (`DealsTable.tsx:141`), a legitimate minimum table width driving horizontal scroll — a sizing floor, not spacing. Vertical rhythm between sections is consistent (`mb-8/10`, `mt-10/12`). Note: spacing is applied without responsive prefixes (zero `sm:/md:/lg:` in the codebase) — it works via flex-wrap and intrinsic sizing, but see Experience Design for where the absence of breakpoints hurts the table.

### Pillar 6: Experience Design (3/4)
State coverage is genuinely strong. Loading: `useTransition` + spinner + status text keeps the button disabled until the re-rendered data is on screen (`RefreshButton.tsx:35-37,66,70-81`). Error: real messages surfaced in red (`:111-116`). Empty: two context-specific states (`page.tsx:189-196`, `DealsTable.tsx:135-138`). Disabled: `disabled:cursor-not-allowed disabled:opacity-60` (`RefreshButton.tsx:68`). The "ran but not persisted" amber branch (`:98-104`) is a thoughtful edge case most builds miss. There is no destructive action, so the absence of a confirm dialog is correct, not a gap.

Deductions:
- **No designed focus-visible states** (finding #3) — keyboard focus on the custom pills, sort headers, Reset and links falls back to browser defaults only.
- **Mobile table** (finding #2) — `min-w-[680px]` with no responsive/stacked fallback and no scroll affordance hides Confidence off-screen at 375px.
- **Duplicate rows** (finding #4) — identical rows surface directly under the "De-duped" funnel with no "possible duplicate" treatment.

Core flows (view → filter → sort → refresh) all work and degrade gracefully on desktop/tablet; the gaps are accessibility and mobile polish rather than broken tasks, which places this at 3/4.

---

## Files Audited
- `app/page.tsx` (server component: header, funnel, deals gate, newsletter, footer)
- `app/layout.tsx` (fonts, metadata, root shell)
- `app/globals.css` (theme tokens, dark mode, selection)
- `components/DealsTable.tsx` (client: filters, sort, rows, empty state)
- `components/RefreshButton.tsx` (client: pipeline trigger, loading/error/status)
- `components/categories.ts` (category dot + confidence badge color maps)
- `lib/format.ts` (value/relative-age formatting)
- `data/snapshot.json` (rendered data — cross-checked for duplicate/undisclosed rows)
- Screenshots: desktop 1440 / tablet 768 / mobile 375 (dark mode)
