# FMCG Deal Radar — Documentation

An agentic pipeline that aggregates recent FMCG M&A and investment news, de-duplicates and
scores it, and drafts a skimmable intelligence newsletter.

Built for the Benori take-home assignment. Deliverables due **2026-07-19**.

## Contents

| Doc | What it covers |
|---|---|
| [architecture.md](./architecture.md) | System diagram, request flows, runtime/timeout strategy, deployment |
| [pipeline.md](./pipeline.md) | The eight pipeline stages in detail — dedup and relevance logic especially |
| [data-model.md](./data-model.md) | TypeScript interfaces, the snapshot contract, funnel accounting |
| [features.md](./features.md) | User-facing feature set, dashboard, exports, newsletter format |
| [decisions.md](./decisions.md) | Locked technical decisions and the reasoning behind each |
| [assumptions.md](./assumptions.md) | Scope boundaries and honest limitations, stated up front |

## Scope in one line

India FMCG + global majors · deals = M&A + funding + stakes + JVs · rolling 90-day window.

## Quick orientation

The whole system is one Next.js app. There is no separate backend and no database. The
pipeline runs inside a route handler, writes a single `Snapshot` JSON blob, and every UI
surface — dashboard, newsletter, exports — is a pure read of that snapshot.

That constraint is deliberate: it makes the demo reproducible (a committed seed snapshot
means the app is never empty) and keeps the whole thing deployable to Vercel's free tier.

```
sources → ingest → clean → dedup → relevance → extract → credibility → rank → newsletter
                                                                                    ↓
                                                                              snapshot.json
                                                                                    ↓
                                                                       dashboard + exports
```

Read [architecture.md](./architecture.md) first for the shape of the system, then
[pipeline.md](./pipeline.md) for how a raw RSS item becomes a scored deal.
