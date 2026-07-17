/**
 * One column shape for the tabular exports. CSV and XLSX both render these rows, so
 * they cannot disagree with each other or with the dashboard — same snapshot, same
 * projection, three surfaces.
 *
 * The source URL is resolved through the same cluster → canonical article chain the
 * credibility stage used, so an exported row is auditable back to a real article the
 * way every other claim in the system is.
 */

import { formatValue } from '../snapshot';
import type { Snapshot } from '../types';

/** Column headers, in order. The single source of truth for both tabular exports. */
export const DEAL_COLUMNS = [
  'Acquirer',
  'Target',
  'Type',
  'Value',
  'Value (raw)',
  'Currency',
  'Stake %',
  'Category',
  'Region',
  'Announced',
  'Confidence',
  'Sources',
  'Source count',
  'Credibility',
  'Source URL',
] as const;

/** A single deal projected to primitives — strings and numbers only, no nested objects. */
export interface DealRow {
  Acquirer: string;
  Target: string;
  Type: string;
  /** Display form: "$32 mn" / "Undisclosed" — never a blank cell, never a bare zero. */
  Value: string;
  /** Raw magnitude for sorting/filtering; blank when undisclosed. Meaningless without Currency. */
  'Value (raw)': number | '';
  Currency: string;
  'Stake %': number | '';
  Category: string;
  Region: string;
  /** YYYY-MM-DD. */
  Announced: string;
  Confidence: string;
  /** Publisher names, one per outlet that carried the deal. */
  Sources: string;
  'Source count': number;
  Credibility: number;
  /** Canonical article URL, or '' if the chain can't resolve one. */
  'Source URL': string;
}

/**
 * Resolve each deal to its canonical source URL via the cluster chain, falling back to
 * the deal id (which equals the cluster id) and then to empty. The snapshot carries
 * clusters and articles precisely so this chain survives export.
 */
export function dealRows(snapshot: Snapshot): DealRow[] {
  const articleUrl = new Map((snapshot.articles ?? []).map((a) => [a.id, a.url]));
  const canonicalId = new Map((snapshot.clusters ?? []).map((c) => [c.clusterId, c.canonicalId]));

  return snapshot.deals.map((d) => {
    const canonical = canonicalId.get(d.clusterId) ?? d.dealId;
    return {
      Acquirer: d.acquirer,
      Target: d.target,
      Type: d.dealType,
      Value: formatValue(d.dealValue, d.currency),
      'Value (raw)': d.dealValue ?? '',
      Currency: d.currency ?? '',
      'Stake %': d.stakePct ?? '',
      Category: d.category,
      Region: d.region,
      Announced: d.announcedDate.slice(0, 10),
      Confidence: d.confidence,
      Sources: d.corroboratingSources.join('; '),
      'Source count': d.corroboratingSources.length,
      Credibility: d.credibilityScore,
      'Source URL': articleUrl.get(canonical) ?? '',
    };
  });
}
