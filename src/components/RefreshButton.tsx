'use client';

/**
 * "Refresh now" — runs the pipeline live and re-renders the dashboard with the result.
 *
 * This button is the answer to "is this real, or just a fixture?". The committed seed
 * makes the demo reliable; this proves the pipeline behind it actually runs. On success
 * it calls router.refresh(), which re-fetches the Server Component so the page reads the
 * freshly persisted Blob snapshot without a full reload.
 */

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

type Status =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; deals: number; seconds: number; persisted: boolean; note?: string }
  | { kind: 'error'; message: string };

interface RefreshResponse {
  ok: boolean;
  persisted?: boolean;
  note?: string;
  deals?: number;
  durationMs?: number;
  error?: string;
}

export function RefreshButton() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  // isPending covers the server re-render kicked off by router.refresh(), so the button
  // stays disabled until the new data is actually on screen, not just fetched.
  const [isPending, startTransition] = useTransition();

  const busy = status.kind === 'running' || isPending;

  async function onClick() {
    setStatus({ kind: 'running' });
    try {
      const res = await fetch('/api/refresh', { method: 'POST' });
      const data = (await res.json()) as RefreshResponse;
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `Refresh failed (${res.status}).`);
      }
      setStatus({
        kind: 'done',
        deals: data.deals ?? 0,
        seconds: Math.round((data.durationMs ?? 0) / 1000),
        persisted: data.persisted ?? false,
        note: data.note,
      });
      // Pull the newly persisted snapshot into the current view.
      startTransition(() => router.refresh());
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Refresh failed.' });
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        aria-busy={busy}
        className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-1.5 font-mono text-xs font-medium uppercase tracking-wide text-zinc-700 shadow-sm transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus-visible:ring-blue-400 dark:focus-visible:ring-offset-zinc-950"
      >
        {busy ? (
          <>
            <span
              className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent"
              aria-hidden
            />
            Refreshing…
          </>
        ) : (
          'Refresh now'
        )}
      </button>
      <RefreshStatus status={status} />
    </div>
  );
}

function RefreshStatus({ status }: { status: Status }) {
  if (status.kind === 'running') {
    return (
      <span className="text-xs text-zinc-500 dark:text-zinc-500">
        Running the pipeline — tens of seconds.
      </span>
    );
  }
  if (status.kind === 'done') {
    // A refresh that couldn't persist (no Blob token) still ran, but the view won't change
    // — say so rather than implying the dashboard updated.
    if (!status.persisted) {
      return (
        <span className="max-w-xs text-right text-xs text-amber-700 dark:text-amber-400">
          Ran ({status.deals} deals, {status.seconds}s) but not persisted — {status.note}
        </span>
      );
    }
    return (
      <span className="text-xs text-emerald-700 dark:text-emerald-400">
        Updated — {status.deals} deals in {status.seconds}s.
      </span>
    );
  }
  if (status.kind === 'error') {
    return (
      <span className="max-w-xs text-right text-xs text-red-600 dark:text-red-400">
        {status.message}
      </span>
    );
  }
  return null;
}
