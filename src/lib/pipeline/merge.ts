/**
 * Stage 5b — Deal-identity merge. A second de-dup pass, on extracted deals rather than
 * article text.
 *
 * Why a second pass at all: stage 3 clusters by article-text similarity, and is
 * deliberately biased to under-merge (COSINE_THRESHOLD 0.80 — see dedup.ts). That bias
 * is right for prose, but it leaves genuine duplicates when two outlets describe the
 * same deal in different words and the embedding lands below threshold — observed live
 * as "Naturis Cosmetics receives funding" twice (Entrackr + Inc42) and Emami/Vedix
 * twice. Article text disagreed; the extracted DEAL is identical.
 *
 * So we merge on the structured identity — acquirer, target, type, value, date — which
 * is far more reliable than headline cosine because it is what the deal actually IS.
 * This never touches the calibrated cosine threshold, so it cannot reintroduce the
 * over-merge that threshold guards against.
 *
 * Running BEFORE credibility is load-bearing: merging unions the clusters, so stage 6
 * counts corroboration across all the merged outlets and the badge rises to match.
 */

import type { Cluster, Deal } from '../types';
import { sharesDistinctiveToken } from './tokens';

/** The pre-credibility shape: extract's output, before badges are attached. */
export type PartialDeal = Omit<Deal, 'credibilityScore' | 'corroboratingSources' | 'confidence'>;

/** Same day, allowing a few days' slack for outlets that report an announcement late. */
const DATE_TOLERANCE_DAYS = 5;

function isUndisclosed(name: string): boolean {
  const n = name.trim().toLowerCase();
  return n === '' || n === 'undisclosed';
}

function dayDiff(a: string, b: string): number {
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  if (Number.isNaN(da) || Number.isNaN(db)) return Infinity;
  return Math.abs(da - db) / 86_400_000;
}

/** Both sides carry a value, in the same currency, within 1% — the same figure. */
function valuesEqual(a: PartialDeal, b: PartialDeal): boolean {
  if (a.dealValue == null || b.dealValue == null) return false;
  if (a.currency !== b.currency) return false;
  const tol = 0.01 * Math.max(a.dealValue, b.dealValue);
  return Math.abs(a.dealValue - b.dealValue) <= tol;
}

/** Both sides carry a value but they genuinely differ — evidence of two DIFFERENT deals. */
function valuesConflict(a: PartialDeal, b: PartialDeal): boolean {
  if (a.dealValue == null || b.dealValue == null) return false;
  return !valuesEqual(a, b);
}

function stakesEqual(a: PartialDeal, b: PartialDeal): boolean {
  return a.stakePct != null && b.stakePct != null && a.stakePct === b.stakePct;
}

/**
 * Are two extracted deals the same transaction?
 *
 * Necessary in all cases: same type, same target (a shared distinctive token), and
 * announced within a few days. On top of that, the acquirer has to line up, and how
 * strictly depends on whether either side named a buyer:
 *
 *   - Both name a buyer → they must be the SAME buyer (a shared token). Two named,
 *     different buyers is two deals, however similar the rest looks. And the values
 *     must not contradict each other.
 *   - Either buyer is undisclosed → a name can't corroborate, so something else must:
 *     an equal disclosed value, or an equal stake %. Same-target-same-day alone is too
 *     weak — four institutions each "buying a stake in Colgate-Palmolive" on the same
 *     day are four filings, not one deal — so absent a value/stake match we DON'T merge
 *     and simply show both. That under-merge is the safe direction (see dedup.ts).
 */
export function sameDeal(a: PartialDeal, b: PartialDeal): boolean {
  if (a.dealType !== b.dealType) return false;
  if (dayDiff(a.announcedDate, b.announcedDate) > DATE_TOLERANCE_DAYS) return false;
  if (!sharesDistinctiveToken(a.target, b.target)) return false;

  const bothNamed = !isUndisclosed(a.acquirer) && !isUndisclosed(b.acquirer);
  if (bothNamed) {
    return sharesDistinctiveToken(a.acquirer, b.acquirer) && !valuesConflict(a, b);
  }
  return valuesEqual(a, b) || stakesEqual(a, b);
}

/**
 * Pick the survivor of a merged group: the record that carries the most information.
 * Prefer a disclosed value, then a named acquirer, then the larger source cluster
 * (better canonical), then the earlier announcement as a stable tiebreak.
 */
function pickSurvivor(group: PartialDeal[], clusterSize: (d: PartialDeal) => number): PartialDeal {
  return [...group].sort((x, y) => {
    const xv = x.dealValue != null ? 1 : 0;
    const yv = y.dealValue != null ? 1 : 0;
    if (xv !== yv) return yv - xv;
    const xa = isUndisclosed(x.acquirer) ? 0 : 1;
    const ya = isUndisclosed(y.acquirer) ? 0 : 1;
    if (xa !== ya) return ya - xa;
    const cs = clusterSize(y) - clusterSize(x);
    if (cs !== 0) return cs;
    return x.announcedDate.localeCompare(y.announcedDate);
  })[0];
}

/**
 * Fold a merged group's facts into the survivor: adopt a disclosed value, a named
 * acquirer, or a stake % from a sibling when the survivor lacks it. A fact one outlet
 * disclosed shouldn't be lost because a fuller-sourced outlet didn't.
 */
function enrich(survivor: PartialDeal, group: PartialDeal[]): PartialDeal {
  const merged = { ...survivor };
  for (const d of group) {
    if (merged.dealValue == null && d.dealValue != null) {
      merged.dealValue = d.dealValue;
      merged.currency = d.currency;
    }
    if (isUndisclosed(merged.acquirer) && !isUndisclosed(d.acquirer)) {
      merged.acquirer = d.acquirer;
    }
    if (merged.stakePct == null && d.stakePct != null) {
      merged.stakePct = d.stakePct;
    }
  }
  return merged;
}

export interface MergeResult {
  deals: PartialDeal[];
  /** Clusters with merged-away members folded into survivors; orphans removed. */
  clusters: Cluster[];
  /** How many duplicate rows were collapsed — surfaced in diagnostics. */
  mergedCount: number;
}

/**
 * Collapse duplicate deals and union their clusters so credibility sees every source.
 *
 * Single-link over the sameDeal relation, matching stage 3's clustering: if A~B and
 * B~C they land together. The survivor's cluster absorbs every merged member's
 * memberIds; the merged-away clusters are dropped so the exported audit trail has one
 * cluster per surviving deal.
 */
export function mergeDuplicateDeals(deals: PartialDeal[], clusters: Cluster[]): MergeResult {
  const clusterById = new Map(clusters.map((c) => [c.clusterId, c]));
  const clusterSize = (d: PartialDeal) => clusterById.get(d.clusterId)?.memberIds.length ?? 1;

  const n = deals.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (i: number, j: number) => {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[rj] = ri;
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (sameDeal(deals[i], deals[j])) union(i, j);
    }
  }

  const groups = new Map<number, PartialDeal[]>();
  deals.forEach((d, i) => {
    const root = find(i);
    const g = groups.get(root);
    if (g) g.push(d);
    else groups.set(root, [d]);
  });

  const outDeals: PartialDeal[] = [];
  const outClusters: Cluster[] = [];
  let mergedCount = 0;

  for (const group of groups.values()) {
    const survivor = enrich(pickSurvivor(group, clusterSize), group);
    outDeals.push(survivor);

    // Union every member's cluster into the survivor's, keeping the survivor's id.
    const memberIds = new Set<string>();
    for (const d of group) {
      const c = clusterById.get(d.clusterId);
      if (c) c.memberIds.forEach((id) => memberIds.add(id));
      else memberIds.add(d.dealId);
    }
    const merged = [...memberIds];
    outClusters.push({
      clusterId: survivor.clusterId,
      canonicalId: survivor.dealId,
      memberIds: merged,
      size: merged.length,
    });

    if (group.length > 1) mergedCount += group.length - 1;
  }

  return { deals: outDeals, clusters: outClusters, mergedCount };
}
