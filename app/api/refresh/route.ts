/**
 * POST /api/refresh — the "Refresh now" button.
 * GET  /api/refresh — the daily Vercel Cron.
 *
 * Both run the same pipeline core as the offline seed (lib/pipeline/run.ts), then persist
 * the result as the live snapshot in Blob. What differs is only the budget: this path has
 * a hard 60s ceiling, so it runs a NARROWER window than the 90-day seed —
 * docs/architecture.md spells out why the two budgets are deliberately separate.
 *
 * Auth: the GET (cron) path requires the CRON_SECRET bearer token when that secret is
 * configured — the standard Vercel Cron guard, so a bot scanning the URL can't drive the
 * schedule. The POST (button) path is intentionally open: its whole purpose is to be
 * clickable by a reviewer on the deployed demo. The cost of that is bounded — the run is
 * capped at 60s, abuse only spends free-tier quota, and the committed seed means the app
 * never breaks even if a refresh fails. Noted as an accepted trade-off in
 * docs/assumptions.md.
 */

// Tighten Groq's retry budget for the 60s path BEFORE the import chain reads it: the seed
// script can afford to wait out a 570s rate-limit window; this function cannot, because
// Vercel kills it at 60s regardless. Fail fast and let the narrow window keep us under the
// free-tier TPM in the first place. `??=` so a deployment can still override.
process.env.GROQ_MAX_BACKOFF_MS ??= '8000';
process.env.GROQ_ATTEMPTS ??= '3';

import { runPipeline } from '@/lib/pipeline/run';
import { saveSnapshot, hasBlobToken } from '@/lib/snapshot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Take the full Vercel Hobby budget — the pipeline is network-bound.
export const maxDuration = 60;

/**
 * Refresh window, deliberately narrower than the seed's 90 days.
 *
 * The seed pays minutes offline to cover a full quarter; a live refresh has 60s, so it
 * trades coverage for latency — fewer queries, a tighter window, a lower per-feed cap.
 * It exists to prove the pipeline is real and to keep the deployed demo current, not to
 * reproduce the whole corpus in one request.
 */
const REFRESH_OPTS = {
  windowDays: Number(process.env.REFRESH_WINDOW_DAYS) || 21,
  queryLimit: 8,
  perFeedCap: 10,
} as const;

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // nothing configured to check against — open (local/demo)
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

async function refresh() {
  const { snapshot, diagnostics } = await runPipeline(REFRESH_OPTS);

  let persisted = false;
  let persistError: string | undefined;
  if (hasBlobToken()) {
    try {
      await saveSnapshot(snapshot);
      persisted = true;
    } catch (err) {
      persistError = err instanceof Error ? err.message : String(err);
    }
  } else {
    // No token: the pipeline still ran (useful proof locally), but nothing was stored, so
    // the dashboard will keep showing the seed. Say so plainly rather than implying success.
    persistError = 'BLOB_READ_WRITE_TOKEN not set — snapshot computed but not persisted.';
  }

  return Response.json({
    ok: true,
    persisted,
    ...(persistError ? { note: persistError } : {}),
    generatedAt: snapshot.generatedAt,
    window: snapshot.window,
    funnel: snapshot.funnel,
    deals: snapshot.deals.length,
    feedFailures: diagnostics.failures.length,
    durationMs: diagnostics.totalMs,
  });
}

export async function POST() {
  try {
    return await refresh();
  } catch (err) {
    console.error('Refresh (POST) failed:', err);
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : 'Refresh failed.' },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return Response.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  }
  try {
    return await refresh();
  } catch (err) {
    console.error('Refresh (GET/cron) failed:', err);
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : 'Refresh failed.' },
      { status: 500 },
    );
  }
}
