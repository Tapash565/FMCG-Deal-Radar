'use client';

/**
 * Download bar — surfaces the /api/export/{format} routes in the UI.
 *
 * Without this, the exports — the actual deliverables (the newsletter as Word/PPT, the data
 * as Excel/CSV/JSON) — are reachable only by hand-typing an API URL, so a business user
 * skimming the demo could never get them.
 *
 * Downloads are done in-page (fetch → Blob → synthetic <a download>), NOT plain <a href>.
 * A bare link navigates the tab to the route and leans on Content-Disposition: attachment
 * to turn that navigation into a download — which browsers honour inconsistently, so it can
 * read as "redirected, nothing downloaded". Fetching the bytes and clicking a synthetic
 * anchor guarantees a download with no navigation, and lets a failed export surface inline
 * instead of dumping the reader on a JSON error page.
 *
 * Split by intent — the newsletter artifact vs. the raw data behind it — because those are
 * two different reasons to click, and grouping says so without a legend.
 */

import { useState } from 'react';
import { MICRO_LABEL } from './categories';

const NEWSLETTER_FORMATS = [
  { fmt: 'docx', label: 'Word' },
  { fmt: 'pptx', label: 'PPT' },
] as const;

const DATA_FORMATS = [
  { fmt: 'xlsx', label: 'Excel' },
  { fmt: 'csv', label: 'CSV' },
  { fmt: 'json', label: 'JSON' },
] as const;

/** Pull the server's dated filename out of Content-Disposition; fall back to a plain name. */
function filenameFrom(headerValue: string | null, fmt: string): string {
  const match = headerValue?.match(/filename="?([^"]+)"?/i);
  return match?.[1] ?? `fmcg-deal-radar.${fmt}`;
}

function ExportButton({
  fmt,
  label,
  busy,
  disabled,
  onClick,
}: {
  fmt: string;
  label: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={busy}
      aria-label={`Download ${label}`}
      className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2.5 py-1 font-mono text-xs font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus-visible:ring-blue-400 dark:focus-visible:ring-offset-zinc-950"
    >
      {busy && (
        <span
          className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent"
          aria-hidden
        />
      )}
      {label}
    </button>
  );
}

export function ExportBar() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload(fmt: string) {
    setBusy(fmt);
    setError(null);
    try {
      const res = await fetch(`/api/export/${fmt}`);
      const contentType = res.headers.get('Content-Type') ?? '';
      // Guard against saving an error page as a document: a failed export (or a platform
      // error page) comes back as HTML/JSON, never the OOXML/CSV/JSON body we asked for.
      if (!res.ok || contentType.includes('text/html')) {
        let message = `Export failed (${res.status}).`;
        try {
          const data = (await res.json()) as { error?: string };
          if (data.error) message = data.error;
        } catch {
          // Non-JSON error body (e.g. an HTML page) — keep the status-based message.
        }
        throw new Error(message);
      }
      const blob = await res.blob();
      const name = filenameFrom(res.headers.get('Content-Disposition'), fmt);

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Give the browser a beat to start the download before releasing the blob.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setBusy(null);
    }
  }

  const anyBusy = busy !== null;

  return (
    <section
      aria-label="Download"
      className="mb-8 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-zinc-200 bg-zinc-50/70 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/40"
    >
      <span className={`${MICRO_LABEL} text-zinc-500 dark:text-zinc-400`}>Download</span>

      <div className="flex items-center gap-2">
        <span className="text-xs text-zinc-400 dark:text-zinc-500">Newsletter</span>
        {NEWSLETTER_FORMATS.map((f) => (
          <ExportButton
            key={f.fmt}
            fmt={f.fmt}
            label={f.label}
            busy={busy === f.fmt}
            disabled={anyBusy}
            onClick={() => handleDownload(f.fmt)}
          />
        ))}
      </div>

      <span className="hidden h-4 w-px bg-zinc-300 dark:bg-zinc-700 sm:block" aria-hidden />

      <div className="flex items-center gap-2">
        <span className="text-xs text-zinc-400 dark:text-zinc-500">Data</span>
        {DATA_FORMATS.map((f) => (
          <ExportButton
            key={f.fmt}
            fmt={f.fmt}
            label={f.label}
            busy={busy === f.fmt}
            disabled={anyBusy}
            onClick={() => handleDownload(f.fmt)}
          />
        ))}
      </div>

      {error && (
        <span role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
    </section>
  );
}
