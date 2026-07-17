/**
 * Snapshot loading. Blob first, committed seed on miss.
 *
 * The fallback is what guarantees the demo is never empty: a missing token, a cold
 * deploy, or a failed cron all degrade to "shows the seed" rather than "shows an
 * error". See docs/architecture.md#persistence-model.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Snapshot } from './types';

/**
 * The one live-snapshot location in the Blob store. A FIXED pathname with allowOverwrite
 * — not a random suffix — so there's always exactly one canonical snapshot to read, and a
 * refresh replaces it in place. See docs/architecture.md#persistence-model.
 */
export const SNAPSHOT_BLOB_PATH = 'snapshots/latest.json';

export async function loadSeed(): Promise<Snapshot> {
  const raw = await readFile(join(process.cwd(), 'data', 'snapshot.json'), 'utf8');
  return JSON.parse(raw) as Snapshot;
}

/** Whether live persistence is even configured. No token → the seed is the whole story. */
export function hasBlobToken(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/**
 * Read the live snapshot from Blob.
 *
 * Returns null — never throws — when there's no token, no snapshot yet, or the store is
 * unreachable. Every one of those is a normal "fall back to the seed" case, not an error
 * the caller should handle. Only genuinely malformed JSON in an existing blob surfaces.
 */
async function loadFromBlob(): Promise<Snapshot | null> {
  if (!hasBlobToken()) return null;

  try {
    const { get } = await import('@vercel/blob');
    // The store is private, so the blob's URL isn't publicly fetchable — get() reads it by
    // its fixed pathname and authenticates server-side with BLOB_READ_WRITE_TOKEN. This is
    // only ever called during a server render / API route, never from the browser.
    // useCache: false bypasses the CDN and reads from origin, so a fresh refresh is visible
    // immediately — the pathname is stable across refreshes, so a cached read would be stale.
    const result = await get(SNAPSHOT_BLOB_PATH, { access: 'private', useCache: false });
    if (!result || result.statusCode !== 200) return null; // no refresh has run yet
    return (await new Response(result.stream).json()) as Snapshot;
  } catch (err) {
    // A missing token, a cold store, or a network blip must degrade to the seed rather
    // than blank the demo — that fallback is the whole point of committing a seed.
    console.warn('Blob read failed, falling back to seed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Persist a snapshot as the new live one. Overwrites the fixed path in place.
 *
 * access is 'private' to match the store's configuration: the snapshot is only ever read
 * server-side (loadFromBlob), so it never needs a public URL. cacheControlMaxAge is the
 * floor (60s): the snapshot only changes on refresh, and a short edge cache is fine, while
 * loadFromBlob reads with useCache: false so a fresh refresh is visible immediately.
 */
export async function saveSnapshot(snapshot: Snapshot): Promise<{ url: string }> {
  if (!hasBlobToken()) {
    throw new Error(
      'BLOB_READ_WRITE_TOKEN is not set — cannot persist a live snapshot. ' +
        'The read-only demo works without it; live refresh does not.',
    );
  }
  const { put } = await import('@vercel/blob');
  const { url } = await put(SNAPSHOT_BLOB_PATH, JSON.stringify(snapshot), {
    access: 'private',
    contentType: 'application/json',
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
  return { url };
}

/**
 * Live snapshot from Blob, or the committed seed.
 *
 * Blob first, seed on any miss. A missing token, a cold deploy, or a failed cron all
 * degrade to "shows the seed" rather than "shows an error" — the guarantee that keeps the
 * demo non-empty. The `source` tells the header which one the reader is looking at.
 */
export async function loadSnapshot(): Promise<{ snapshot: Snapshot; source: 'blob' | 'seed' }> {
  const live = await loadFromBlob();
  if (live) return { snapshot: live, source: 'blob' };
  return { snapshot: await loadSeed(), source: 'seed' };
}

// Display formatting lives in lib/format.ts (pure, no node imports) so client components
// can share it. Re-exported here so existing `from '@/lib/snapshot'` imports still resolve.
export { relativeAge, formatValue, usdMillions } from './format';
