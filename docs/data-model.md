# Data model

Everything the app renders comes from one `Snapshot` object. This doc is the contract.

Canonical source: `lib/types.ts`.

## Entities

```ts
interface Article {
  id: string;
  title: string;
  url: string;              // canonicalized — tracking params stripped
  source: string;           // unified publisher name
  sourceTier: 1 | 2 | 3;
  publishedAt: string;      // ISO 8601
  snippet: string;
  rawText?: string;
  queryTerm: string;        // which ingest query surfaced this
}

interface Cluster {
  clusterId: string;
  canonicalId: string;      // Article.id — highest tier, earliest date
  memberIds: string[];      // includes canonicalId
  size: number;
}

interface Deal {
  dealId: string;
  clusterId: string;
  acquirer: string;
  target: string;
  dealType: 'M&A' | 'Funding' | 'Stake' | 'JV';
  dealValue?: number;
  currency?: string;
  stakePct?: number;
  category: string;         // Food | Beverage | Personal care | Home care
  region: string;
  announcedDate: string;    // ISO 8601
  relevanceConf: number;    // 0..1, from stage 4
  credibilityScore: number; // 0..1, from stage 6
  corroboratingSources: string[];
  confidence: 'High' | 'Med' | 'Low';
}

interface NewsletterItem {
  dealId: string;
  headline: string;
  summary: string;
  whyItMatters: string;
  primarySourceUrl: string;
  badge: 'High' | 'Med' | 'Low';
}

interface Snapshot {
  generatedAt: string;
  window: { from: string; to: string };
  funnel: { ingested: number; deduped: number; relevant: number; selected: number };
  deals: Deal[];
  newsletter: Newsletter;
}
```

## Design notes

**Optional fields are load-bearing.** `dealValue`, `currency`, and `stakePct` are optional
because press coverage genuinely omits them — "terms were not disclosed" is the norm, not the
exception. Making them required would push the extraction model to invent numbers. Absent is
a fact worth representing; fabricated is a bug.

**`currency` travels with `dealValue`.** A bare number is meaningless across INR crore, USD
million, and EUR. They are only ever read together, and rank buckets them coarsely rather
than converting — conversion needs a rate and a date, and guessing either corrupts the figure.

**IDs chain backwards to evidence.** `NewsletterItem.dealId` → `Deal.clusterId` →
`Cluster.memberIds` → `Article.url`. Every sentence in the newsletter can be walked back to
the URLs it came from. This is what makes the output auditable rather than merely plausible,
and it's why collapsed cluster members are retained rather than dropped at stage 3.

**`corroboratingSources` holds unified names, not URLs.** Three articles from one publisher
are one corroborating source. Storing URLs here would let the same outlet vote three times
and manufacture confidence — see [pipeline.md](./pipeline.md#corroboration).

**Scores are stored, not recomputed.** `relevanceConf` and `credibilityScore` are persisted on
the `Deal` so a snapshot is fully self-describing. Reading a snapshot never requires re-running
a stage or calling an API.

## Funnel

```ts
funnel: { ingested: number; deduped: number; relevant: number; selected: number }
```

Article counts at four checkpoints, each a strict subset of the last:

| Field | Meaning |
|---|---|
| `ingested` | Raw items pulled from all feeds |
| `deduped` | Survivors after exact-URL + cluster collapse |
| `relevant` | Survivors after regex pre-filter + Groq classification |
| `selected` | Deals that made the newsletter after rank |

Shown on the dashboard because attrition *is* the story: it makes the pipeline's work legible
at a glance, and it makes over-aggressive filtering visible instead of silent. If `relevant`
collapses to near-zero, that's a tuning bug — and the funnel is how you'd notice.

## Snapshot lifecycle

| Location | Written by | Read by | Purpose |
|---|---|---|---|
| `data/snapshot.json` | `scripts/run-pipeline.ts`, committed | App, on Blob miss | Seed — demo is never empty |
| Vercel Blob | `/api/refresh`, daily cron | App, preferentially | Live data |

Read order is Blob → seed. Missing token, cold deploy, or failed cron all degrade to "shows
the seed" rather than "shows an error".

A snapshot is immutable once written. Refresh replaces it wholesale; nothing mutates a
`Deal` in place. So any snapshot is a complete, coherent point-in-time artifact — which is
what makes the JSON export a legitimate deliverable on its own.
