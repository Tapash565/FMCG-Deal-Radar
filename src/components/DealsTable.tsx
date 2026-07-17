'use client';

/**
 * The deals table, made interactive — filterable by category, type, and confidence, and
 * sortable by value, date, or confidence. features.md promised this; here it is.
 *
 * All client-side: the snapshot is a dozen rows, so filtering and sorting in the browser
 * is instant and needs no round-trip. The server still owns selection and ranking — this
 * only re-orders and hides what stage 7 already chose, and the default view preserves the
 * ranked order exactly.
 */

import { useMemo, useState } from 'react';
import type { Confidence, Deal, DealType, Category } from '@/lib/types';
import { formatValue, usdMillions } from '@/lib/format';
import { CATEGORY_DOT, CONFIDENCE_BADGE, MICRO_LABEL } from './categories';

const CONFIDENCE_RANK: Record<Confidence, number> = { High: 3, Med: 2, Low: 1 };

type SortKey = 'default' | 'value' | 'announced' | 'confidence';
type Dir = 'asc' | 'desc';

interface Filters {
  category: Category | 'all';
  type: DealType | 'all';
  confidence: Confidence | 'all';
}

const INITIAL_FILTERS: Filters = { category: 'all', type: 'all', confidence: 'all' };

export function DealsTable({ deals }: { deals: Deal[] }) {
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
  const [sort, setSort] = useState<{ key: SortKey; dir: Dir }>({ key: 'default', dir: 'desc' });

  // Offer only the categories and types actually present — no dead filter that always
  // returns nothing.
  const categories = useMemo(
    () => [...new Set(deals.map((d) => d.category))],
    [deals],
  );
  const types = useMemo(() => [...new Set(deals.map((d) => d.dealType))], [deals]);

  const rows = useMemo(() => {
    const filtered = deals.filter(
      (d) =>
        (filters.category === 'all' || d.category === filters.category) &&
        (filters.type === 'all' || d.dealType === filters.type) &&
        (filters.confidence === 'all' || d.confidence === filters.confidence),
    );

    if (sort.key === 'default') return filtered; // preserve the server's ranked order

    const sign = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sort.key === 'value') {
        // Undisclosed has no magnitude — always sort it to the bottom, both directions,
        // so a filter on value never buries real deals under blanks.
        const av = usdMillions(a.dealValue, a.currency);
        const bv = usdMillions(b.dealValue, b.currency);
        if (av == null && bv == null) cmp = 0;
        else if (av == null) return 1;
        else if (bv == null) return -1;
        else cmp = av - bv;
      } else if (sort.key === 'announced') {
        cmp = a.announcedDate.localeCompare(b.announcedDate);
      } else if (sort.key === 'confidence') {
        cmp = CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence];
      }
      return cmp * sign;
    });
  }, [deals, filters, sort]);

  function toggleSort(key: Exclude<SortKey, 'default'>) {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' }
        : { key, dir: 'desc' },
    );
  }

  const filtered = rows.length !== deals.length;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className={`${MICRO_LABEL} text-zinc-500 dark:text-zinc-400`}>
          Deals{' '}
          <span className="tabular-nums">
            {filtered ? `(${rows.length} of ${deals.length})` : `(${deals.length})`}
          </span>
        </h2>
        {filtered && (
          <button
            type="button"
            onClick={() => {
              setFilters(INITIAL_FILTERS);
              setSort({ key: 'default', dir: 'desc' });
            }}
            className="rounded-sm text-xs text-blue-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-400"
          >
            Reset
          </button>
        )}
      </div>

      {/* Filters — pills, not selects, so the active facet is visible at a glance. */}
      <div className="mb-4 flex flex-col gap-2 rounded-md border border-zinc-200 bg-zinc-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
        <FilterRow
          label="Category"
          options={categories}
          value={filters.category}
          onChange={(category) => setFilters((f) => ({ ...f, category }))}
          renderOption={(c) => (
            <span className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${CATEGORY_DOT[c]}`} aria-hidden />
              {c}
            </span>
          )}
        />
        <FilterRow
          label="Type"
          options={types}
          value={filters.type}
          onChange={(type) => setFilters((f) => ({ ...f, type }))}
        />
        <FilterRow
          label="Confidence"
          options={['High', 'Med', 'Low'] as Confidence[]}
          value={filters.confidence}
          onChange={(confidence) => setFilters((f) => ({ ...f, confidence }))}
        />
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No deals match these filters.
        </p>
      ) : (
        <div className="relative">
          {/* Below md the table is wider than the viewport and scrolls sideways; without a
              cue the off-screen Confidence column reads as missing. A right-edge fade plus
              a one-line hint make the scroll — and what's past it — discoverable. */}
          <p className="mb-2 text-xs text-zinc-400 md:hidden" aria-hidden>
            Scroll the table sideways for value, date, and confidence →
          </p>
          <div className="overflow-x-auto rounded-md border border-zinc-200 dark:border-zinc-800">
            <table className="w-full min-w-[680px] text-left">
            <thead>
              <tr
                className={`border-b border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60 ${MICRO_LABEL}`}
              >
                <th className="px-4 py-2.5">Deal</th>
                <th className="px-4 py-2.5">Type</th>
                <SortHeader
                  label="Value"
                  active={sort.key === 'value'}
                  dir={sort.dir}
                  onClick={() => toggleSort('value')}
                />
                <SortHeader
                  label="Announced"
                  active={sort.key === 'announced'}
                  dir={sort.dir}
                  onClick={() => toggleSort('announced')}
                />
                <SortHeader
                  label="Confidence"
                  active={sort.key === 'confidence'}
                  dir={sort.dir}
                  onClick={() => toggleSort('confidence')}
                />
              </tr>
            </thead>
            <tbody>
              {rows.map((deal) => (
                <DealRow key={deal.dealId} deal={deal} />
              ))}
            </tbody>
            </table>
          </div>
          {/* Fades the right edge on narrow screens to signal there's more to scroll to.
              Hidden at md+ where the whole table fits. pointer-events-none so it never
              intercepts a tap/scroll. */}
          <div
            className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-white to-transparent md:hidden dark:from-zinc-950"
            aria-hidden
          />
        </div>
      )}
    </section>
  );
}

function DealRow({ deal }: { deal: Deal }) {
  return (
    <tr className="border-b border-zinc-100 last:border-0 even:bg-zinc-50/60 hover:bg-zinc-100/70 dark:border-zinc-900 dark:even:bg-zinc-900/30 dark:hover:bg-zinc-800/50">
      <td className="px-4 py-3">
        <div className="font-medium text-zinc-900 dark:text-zinc-100">
          {/* A nameless buyer is a fact about the deal, not a company called "Undisclosed" —
              render it as a muted label so the row doesn't read as a real acquirer name. */}
          {deal.acquirer === 'Undisclosed' ? (
            <span className="font-normal italic text-zinc-400">Undisclosed acquirer</span>
          ) : (
            deal.acquirer
          )}{' '}
          <span className="text-zinc-400">→</span> {deal.target}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-500">
          <span className={`h-2 w-2 rounded-full ${CATEGORY_DOT[deal.category]}`} aria-hidden />
          {deal.category} · {deal.region}
        </div>
      </td>
      <td className="px-4 py-3 font-mono text-[13px] text-zinc-600 dark:text-zinc-400">
        {deal.dealType}
      </td>
      <td className="px-4 py-3 font-mono text-[13px] tabular-nums text-zinc-700 dark:text-zinc-300">
        {/* "Undisclosed", never a blank cell: an empty cell reads as missing data,
            but not disclosing terms is a fact about the deal. */}
        {formatValue(deal.dealValue, deal.currency)}
        {deal.stakePct != null && <span className="ml-1 text-zinc-400">({deal.stakePct}%)</span>}
      </td>
      <td className="px-4 py-3 font-mono text-[13px] tabular-nums text-zinc-500 dark:text-zinc-500">
        {deal.announcedDate.slice(0, 10)}
      </td>
      <td className="px-4 py-3">
        <span
          className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${CONFIDENCE_BADGE[deal.confidence]}`}
          title={`Corroborating sources: ${deal.corroboratingSources.join(', ')}`}
        >
          {deal.confidence}
        </span>
        <div className="mt-0.5 font-mono text-xs text-zinc-400">
          {deal.corroboratingSources.length} src
        </div>
      </td>
    </tr>
  );
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: Dir;
  onClick: () => void;
}) {
  return (
    <th
      className="px-4 py-2.5"
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={onClick}
        // Form controls don't inherit text-transform/font-family, so the mono-uppercase
        // has to be restated here or these headers won't match the static "DEAL"/"TYPE".
        className={`group inline-flex items-center gap-1 rounded-sm ${MICRO_LABEL} transition hover:text-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:text-zinc-200 dark:focus-visible:ring-blue-400 ${
          active ? 'text-zinc-800 dark:text-zinc-200' : ''
        }`}
      >
        {label}
        <span
          className={`text-[0.65rem] leading-none transition ${
            active ? 'opacity-100' : 'opacity-0 group-hover:opacity-40'
          }`}
          aria-hidden
        >
          {active && dir === 'asc' ? '▲' : '▼'}
        </span>
      </button>
    </th>
  );
}

function FilterRow<T extends string>({
  label,
  options,
  value,
  onChange,
  renderOption,
}: {
  label: string;
  options: T[];
  value: T | 'all';
  onChange: (v: T | 'all') => void;
  renderOption?: (v: T) => React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={`w-20 shrink-0 ${MICRO_LABEL} text-zinc-400 dark:text-zinc-500`}>
        {label}
      </span>
      <Pill active={value === 'all'} onClick={() => onChange('all')}>
        All
      </Pill>
      {options.map((opt) => (
        <Pill key={opt} active={value === opt} onClick={() => onChange(opt)}>
          {renderOption ? renderOption(opt) : opt}
        </Pill>
      ))}
    </div>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-md px-2.5 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:focus-visible:ring-blue-400 ${
        active
          ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
          : 'bg-white text-zinc-600 ring-1 ring-inset ring-zinc-200 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-zinc-700 dark:hover:bg-zinc-800'
      }`}
    >
      {children}
    </button>
  );
}
