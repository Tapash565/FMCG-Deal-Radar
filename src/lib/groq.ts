/**
 * Groq client — thin. Retry, JSON coercion, bounded concurrency.
 *
 * Prompts deliberately live in the pipeline stages that own them
 * (relevance.ts, extract.ts, newsletter.ts), not here. This module knows how to
 * talk to Groq; it doesn't know what FMCG is.
 */

import Groq from 'groq-sdk';

/** High-volume mechanical work: classify, extract. */
export const MODEL_FAST = 'llama-3.1-8b-instant';
/** One call per run, for the one artifact a human reads end to end. */
export const MODEL_SMART = 'llama-3.3-70b-versatile';

let client: Groq | null = null;

/**
 * Lazy — a missing key must not crash at import time, or the read-only demo
 * (which needs no keys at all) breaks on a cold start.
 */
function getClient(): Groq {
  if (client) return client;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GROQ_API_KEY is not set. Copy .env.example to .env.local and fill it in. ' +
        'Read-only demo works without it; live refresh does not.',
    );
  }
  client = new Groq({ apiKey });
  return client;
}

export function hasGroqKey(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry 429 and 5xx; never retry 4xx — a bad prompt won't fix itself. */
function isRetryable(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (typeof status !== 'number') return true; // network/timeout — worth one more go
  return status === 429 || status >= 500;
}

/**
 * How long to wait, according to the server.
 *
 * Groq's free tier is 6,000 tokens/min, and a 429 says exactly when to come back —
 * both in a `retry-after` header and in the message ("Please try again in 8.09s").
 * Read it rather than guessing.
 *
 * This was a real bug: a 0.5s/1s/2s backoff burned all three attempts in ~3.5s while
 * the limiter wanted 8s, so every retry was doomed. Failures then cascaded — dropped
 * articles got re-queued as individual calls, which spent more tokens, which caused
 * more 429s. A stage that should take seconds ran for 20+ minutes.
 */
function readHeader(err: unknown, name: string): string | null {
  const h = (err as { headers?: unknown })?.headers;
  if (!h) return null;
  // groq-sdk hands back a fetch Headers instance, NOT a plain object — h['retry-after']
  // is silently undefined on it. Reading it as a POJO was a real bug: every advised
  // wait was missed, so we fell back to a 1s/2s backoff against a limiter asking for
  // 136s, and the call was guaranteed to fail.
  if (typeof (h as Headers).get === 'function') return (h as Headers).get(name);
  const rec = h as Record<string, string>;
  return rec[name] ?? rec[name.toLowerCase()] ?? null;
}

/** "1ms" / "2.5s" / "136" (bare = seconds) → ms. */
function parseDuration(raw: string): number | null {
  const m = raw.trim().match(/^([\d.]+)\s*(ms|s|m)?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  switch ((m[2] ?? 's').toLowerCase()) {
    case 'ms':
      return n;
    case 'm':
      return n * 60_000;
    default:
      return n * 1000;
  }
}

function retryAfterMs(err: unknown): number | null {
  for (const name of ['retry-after', 'x-ratelimit-reset-tokens', 'x-ratelimit-reset-requests']) {
    const raw = readHeader(err, name);
    if (raw) {
      const ms = parseDuration(raw);
      if (ms != null && ms > 0) return ms;
    }
  }
  // Some 429 bodies say it in prose instead ("Please try again in 8.09s"); others don't
  // say it at all, which is why the headers are checked first.
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/try again in ([\d.]+)\s*s/i);
  return m ? parseFloat(m[1]) * 1000 : null;
}

/** Distinguishable so callers can report "out of quota" rather than "something broke". */
export class RateLimitedError extends Error {
  constructor(
    message: string,
    readonly advisedWaitMs: number,
  ) {
    super(message);
    this.name = 'RateLimitedError';
  }
}

/**
 * Longest we'll block on one attempt when the limiter asks us to wait.
 *
 * The two callers have genuinely different budgets, which is why this is tunable
 * rather than a constant (see docs/architecture.md#the-real-constraint-is-the-provider):
 *
 *   - `npm run pipeline` (offline seed) — no deadline. Waiting out a 133s window is
 *     strictly better than failing; set GROQ_MAX_BACKOFF_MS high.
 *   - `/api/refresh` — 60s hard ceiling. Blocking 133s is pointless, since Vercel kills
 *     the function first. Fail fast and keep the default.
 *
 * Free-tier TPM is 6,000/min, so a full 90-day run genuinely needs to sit out several
 * windows. That's expected, not an error.
 */
function maxBackoffMs(): number {
  // Read per call, not at module load: a caller that sets the env var after importing
  // this module would otherwise be silently ignored.
  return Number(process.env.GROQ_MAX_BACKOFF_MS) || 20_000;
}

async function withRetry<T>(fn: () => Promise<T>, attempts = Number(process.env.GROQ_ATTEMPTS) || 4, label = 'groq'): Promise<T> {
  let lastErr: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || i === attempts - 1) break;

      // Server's number first; exponential backoff only as a fallback. +250ms so we
      // land just after the window opens rather than racing it.
      const advised = retryAfterMs(err);

      // CLAMP the advised wait rather than obeying it wholesale. Groq's advice is an
      // upper bound and is often wildly pessimistic — it asked for 570s on a window
      // that actually cleared in under a minute, and a run that obeyed it sat asleep
      // long after it could have proceeded. Re-probing early is nearly free (a 429
      // costs no tokens), so many short waits beat one long blind one.
      //
      // Total patience is `attempts x cap`, which is what callers actually tune:
      // the offline seed run allows many attempts; /api/refresh allows few.
      const cap = maxBackoffMs();
      await sleep(Math.min(advised != null ? advised + 250 : 1000 * 2 ** i, cap));
    }
  }

  // Surface rate limiting as its own type so callers can say "out of quota" rather than
  // "something broke" — and so mapLimit knows to abort the run instead of turning it
  // into a silent null.
  if (isRetryable(lastErr) && (lastErr as { status?: number })?.status === 429) {
    const advised = retryAfterMs(lastErr) ?? 0;
    throw new RateLimitedError(
      `${label}: still rate limited after ${attempts} attempts ` +
        `(${((attempts * maxBackoffMs()) / 1000).toFixed(0)}s of waiting). ` +
        `Groq's free tier is 6,000 tokens/min — wait for the window to reset, ` +
        `narrow the window (WINDOW_DAYS=30), or upgrade the tier.`,
      advised,
    );
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(`${label} failed after ${attempts} attempts: ${msg}`);
}


export interface ChatOptions {
  system: string;
  user: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/** Plain-text completion. Used for prose (the newsletter draft). */
export async function chatText(opts: ChatOptions): Promise<string> {
  const {
    system,
    user,
    model = MODEL_SMART,
    temperature = 0.4,
    maxTokens = 4096,
  } = opts;

  return withRetry(async () => {
    const res = await getClient().chat.completions.create({
      model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    return res.choices[0]?.message?.content?.trim() ?? '';
  }, undefined, `chatText(${model})`);
}

/**
 * JSON-mode completion, parsed.
 *
 * Temperature defaults to 0: extraction and classification are not creative tasks,
 * and a wandering model invents deal values that were never disclosed.
 */
export async function chatJSON<T>(opts: ChatOptions): Promise<T> {
  const {
    system,
    user,
    model = MODEL_FAST,
    temperature = 0,
    maxTokens = 1024,
  } = opts;

  return withRetry(async () => {
    const res = await getClient().chat.completions.create({
      model,
      temperature,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });

    const raw = res.choices[0]?.message?.content ?? '';
    try {
      return JSON.parse(raw) as T;
    } catch {
      // JSON mode makes this rare, but a truncated response (maxTokens) still lands here.
      // Salvage the outermost object rather than losing the whole article.
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start !== -1 && end > start) {
        return JSON.parse(raw.slice(start, end + 1)) as T;
      }
      throw new Error(`unparseable JSON response: ${raw.slice(0, 200)}`);
    }
  }, undefined, `chatJSON(${model})`);
}

/**
 * Map with bounded concurrency — the fan-out primitive for classify/extract.
 *
 * Unbounded Promise.all over ~100 articles trips Groq's rate limit and turns a fast
 * run into a retry storm. Bounded, it stays inside the 60s budget.
 *
 * A rejected item resolves to null rather than failing the batch: one unparseable
 * article must not cost us the other 99.
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array(items.length).fill(null);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        // A rate-limit failure is NOT "this item had no result" — it means the run is
        // invalid, and every remaining item will fail the same way. Swallowing it
        // produced the worst possible outcome: all 11 batches 429'd, every verdict
        // became null, and the pipeline reported "0 relevant deals" as a finding while
        // overwriting a good snapshot with an empty one. Fail loudly instead.
        if (err instanceof RateLimitedError) throw err;
        results[i] = null;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}
