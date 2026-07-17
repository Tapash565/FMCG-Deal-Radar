import { loadSnapshot, relativeAge } from '@/lib/snapshot';
import type { Funnel, Newsletter } from '@/lib/types';
import { RefreshButton } from '@/components/RefreshButton';
import { ExportBar } from '@/components/ExportBar';
import { DealsTable } from '@/components/DealsTable';
import { CATEGORY_BORDER, CATEGORY_DOT, CONFIDENCE_BADGE, MICRO_LABEL } from '@/components/categories';

// Always re-read the snapshot; a stale prerender would defeat the freshness header.
export const dynamic = 'force-dynamic';

function FunnelPanel({ funnel }: { funnel: Funnel }) {
  // A graduated zinc ramp that darkens as the funnel narrows, with the one accent reserved
  // for "Selected" — the output the whole pipeline exists to produce. Keeping the earlier
  // stages neutral avoids reusing category/confidence hues for an unrelated meaning.
  const steps: { label: string; value: number; hint: string; bar: string }[] = [
    { label: 'Ingested', value: funnel.ingested, hint: 'raw items from all feeds', bar: 'bg-zinc-300 dark:bg-zinc-700' },
    { label: 'De-duped', value: funnel.deduped, hint: 'after URL + embedding clustering', bar: 'bg-zinc-400 dark:bg-zinc-600' },
    { label: 'Relevant', value: funnel.relevant, hint: 'confirmed FMCG deals', bar: 'bg-zinc-500 dark:bg-zinc-500' },
    { label: 'Selected', value: funnel.selected, hint: 'ranked into the newsletter', bar: 'bg-emerald-500' },
  ];
  // Bar widths scale to the widest stage so the attrition is visible, not just stated —
  // 431 → 12 should look like a funnel, not four equal boxes. Floored so the last stage
  // never collapses to an invisible sliver.
  const max = Math.max(funnel.ingested, 1);
  const retained =
    funnel.ingested > 0 ? Math.round((funnel.selected / funnel.ingested) * 1000) / 10 : 0;

  return (
    <section className="mb-10">
      <h2 className={`mb-3 ${MICRO_LABEL} text-zinc-500 dark:text-zinc-400`}>Pipeline funnel</h2>
      <div className="space-y-3 rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        {steps.map((s) => (
          <div key={s.label}>
            {/* Count + hint live on the card background, never over the coloured fill, so
                they stay legible whatever the bar colour or width. */}
            <div className="flex items-baseline gap-2 text-xs">
              <span className="w-20 shrink-0 font-medium text-zinc-700 dark:text-zinc-300">
                {s.label}
              </span>
              <span className="font-mono text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                {s.value}
              </span>
              <span className="text-zinc-500 dark:text-zinc-500">{s.hint}</span>
            </div>
            {/* Full-width track + proportional fill — bars are comparable across stages. */}
            <div className="mt-1 h-2.5 w-full overflow-hidden rounded-sm bg-zinc-100 dark:bg-zinc-900">
              <div
                className={`h-full rounded-sm ${s.bar}`}
                style={{ width: `${Math.max((s.value / max) * 100, 1)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-500">
        Attrition is the work: {funnel.ingested} raw items became {funnel.selected} deals
        {' '}(<span className="font-mono tabular-nums">{retained}%</span> retained) — the
        pipeline is what happens in between.
      </p>
    </section>
  );
}

function NewsletterPreview({ newsletter }: { newsletter: Newsletter }) {
  const sections = newsletter.sections.filter((s) => s.items.length > 0);
  if (sections.length === 0 && newsletter.tldr.length === 0) return null;

  return (
    <section className="mt-12">
      <h2 className={`mb-1 ${MICRO_LABEL} text-zinc-500 dark:text-zinc-400`}>Newsletter draft</h2>
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 border-b border-zinc-200 pb-3 dark:border-zinc-800">
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          {newsletter.title}
        </h3>
        <span className="font-mono text-xs text-zinc-500">{newsletter.period}</span>
      </div>

      {/* Bento: a TL;DR panel beside the category sections. Grouped by category still —
          a personal-care analyst finds their section — but rendered as scannable cards. */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {newsletter.tldr.length > 0 && (
          <aside className="rounded-md border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950 lg:col-span-1 lg:self-start lg:sticky lg:top-6">
            <h4 className={`mb-3 w-fit border-b-2 border-emerald-500 pb-1 ${MICRO_LABEL} text-zinc-600 dark:text-zinc-300`}>
              TL;DR
            </h4>
            <ul className="space-y-2.5">
              {newsletter.tldr.map((t, i) => (
                <li
                  key={i}
                  className="flex gap-2 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300"
                >
                  <span className="mt-1 font-mono text-emerald-600 dark:text-emerald-400" aria-hidden>
                    →
                  </span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </aside>
        )}

        <div className="space-y-6 lg:col-span-2">
          {sections.map((section) => (
            <div key={section.category}>
              <h4 className={`mb-3 flex items-center gap-2 ${MICRO_LABEL} text-zinc-500 dark:text-zinc-400`}>
                <span className={`h-2 w-2 rounded-full ${CATEGORY_DOT[section.category]}`} aria-hidden />
                {section.category}
              </h4>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {section.items.map((item) => (
                  <article
                    key={item.dealId}
                    className={`flex flex-col rounded-md border border-t-2 border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 ${CATEGORY_BORDER[section.category]}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h5 className="font-semibold leading-snug text-zinc-900 dark:text-zinc-100">
                        {item.headline}
                      </h5>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${CONFIDENCE_BADGE[item.badge]}`}
                      >
                        {item.badge}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                      {item.summary}
                    </p>
                    {item.whyItMatters && (
                      <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                        <span className="font-medium text-zinc-700 dark:text-zinc-300">
                          Why it matters:{' '}
                        </span>
                        {item.whyItMatters}
                      </p>
                    )}
                    {item.primarySourceUrl && (
                      <div className="mt-auto border-t border-zinc-100 pt-3 dark:border-zinc-800">
                        <a
                          href={item.primarySourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`inline-block rounded-sm ${MICRO_LABEL} text-blue-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-400`}
                        >
                          Source →
                        </a>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Ships inside the newsletter, not just the README — this is the artifact
          that gets forwarded to someone who never saw the repo. */}
      <p className="mt-6 font-mono text-[11px] leading-5 text-zinc-500 opacity-80 dark:text-zinc-500">
        {newsletter.methodology}
      </p>
    </section>
  );
}

export default async function Page() {
  const { snapshot, source } = await loadSnapshot();
  const { funnel, deals, newsletter, window: win } = snapshot;
  // Derived from the actual window, so it stays honest whether this is the 90-day seed or
  // a narrower live refresh — not a hardcoded number that silently goes stale.
  const windowDays = Math.round(
    (new Date(win.to).getTime() - new Date(win.from).getTime()) / 86_400_000,
  );

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8 border-b border-zinc-200 pb-6 dark:border-zinc-800">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                FMCG Deal Radar
              </h1>
              {/* Seed vs live is stated as a system badge, not implied away. */}
              <span
                className={`rounded-sm border px-1.5 py-0.5 ${MICRO_LABEL} ${
                  source === 'seed'
                    ? 'border-zinc-300 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400'
                    : 'border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400'
                }`}
              >
                {source === 'seed' ? 'Committed seed' : 'Live'}
              </span>
            </div>
            <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400">
              India FMCG + global majors · M&amp;A, funding, stakes, JVs · {windowDays}-day window
            </p>
            {/* Staleness stated in mono, so the reader always knows how old the data is. */}
            <p className="mt-1 font-mono text-xs text-zinc-500 dark:text-zinc-500">
              {win.from.slice(0, 10)} → {win.to.slice(0, 10)} · Generated{' '}
              {relativeAge(snapshot.generatedAt)}
            </p>
          </div>
          {/* Proof the pipeline behind the seed actually runs. */}
          <RefreshButton />
        </div>
      </header>

      <ExportBar />

      <FunnelPanel funnel={funnel} />

      {deals.length === 0 ? (
        <section>
          <h2 className={`mb-3 ${MICRO_LABEL} text-zinc-500 dark:text-zinc-400`}>Deals (0)</h2>
          <p className="rounded-md border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
            No deals in this snapshot. Run <code className="font-mono">npm run pipeline</code> to
            regenerate.
          </p>
        </section>
      ) : (
        <DealsTable deals={deals} />
      )}

      <NewsletterPreview newsletter={newsletter} />

      <footer className="mt-10 border-t border-zinc-200 pt-4 text-xs leading-relaxed text-zinc-500 dark:border-zinc-800 dark:text-zinc-500">
        Confidence is a source-tier + corroboration heuristic — it measures who reported a deal
        and how many outlets carried it, not whether it is true. Hover a badge for sources.
      </footer>
    </main>
  );
}
