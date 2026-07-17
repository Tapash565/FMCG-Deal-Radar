/**
 * Download bar — surfaces the /api/export/{format} routes in the UI.
 *
 * Without this, the exports — which are the actual deliverables (the newsletter as Word/PPT,
 * the data as Excel/CSV/JSON) — are reachable only by hand-typing an API URL, so a business
 * user skimming the demo could never get them. Plain anchors, not fetch: the route already
 * sets Content-Disposition: attachment, so a click downloads with no client JS.
 *
 * Split by intent — the newsletter artifact vs. the raw data behind it — because those are
 * two different reasons to click, and grouping says so without a legend.
 */

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

function ExportLink({ fmt, label }: { fmt: string; label: string }) {
  return (
    <a
      href={`/api/export/${fmt}`}
      className="inline-flex items-center rounded-md border border-zinc-300 bg-white px-2.5 py-1 font-mono text-xs font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 focus-visible:ring-offset-white dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus-visible:ring-blue-400 dark:focus-visible:ring-offset-zinc-950"
    >
      {label}
    </a>
  );
}

export function ExportBar() {
  return (
    <section
      aria-label="Download"
      className="mb-8 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-zinc-200 bg-zinc-50/70 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/40"
    >
      <span className={`${MICRO_LABEL} text-zinc-500 dark:text-zinc-400`}>Download</span>

      <div className="flex items-center gap-2">
        <span className="text-xs text-zinc-400 dark:text-zinc-500">Newsletter</span>
        {NEWSLETTER_FORMATS.map((f) => (
          <ExportLink key={f.fmt} {...f} />
        ))}
      </div>

      <span className="hidden h-4 w-px bg-zinc-300 dark:bg-zinc-700 sm:block" aria-hidden />

      <div className="flex items-center gap-2">
        <span className="text-xs text-zinc-400 dark:text-zinc-500">Data</span>
        {DATA_FORMATS.map((f) => (
          <ExportLink key={f.fmt} {...f} />
        ))}
      </div>
    </section>
  );
}
