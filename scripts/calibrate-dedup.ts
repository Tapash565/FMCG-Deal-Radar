/**
 * Measure the cosine distribution over real articles so the dedup threshold is
 * chosen from data instead of vibes.
 *
 *   npm run calibrate:dedup
 *
 * The plan specified cosine ≥ 0.85; measurement moved it to 0.80. Prints hand-labelled
 * control pairs plus the top-similarity pairs from the snapshot, so the question can be
 * answered by eye: where do true duplicates sit, and where does the first false merge
 * appear?
 *
 * Findings that set the current thresholds (2026-07-16, 124 articles / 7,626 pairs):
 *   - True duplicates span 0.77–1.00; the first false merge lands at 0.795, with a true
 *     duplicate at 0.796. The bands touch — no threshold is clean, so 0.80 biases toward
 *     under-merging (an over-merge deletes a deal; an under-merge only repeats one).
 *   - Token-sort on true duplicates: 28–74. The plan's ">= 90 required to merge" guard
 *     would have blocked nearly every real merge. Now an OR fast path at >= 95.
 *
 * Re-run after any change to the embedding model or embedText(); these numbers don't
 * transfer. Args: [bandLow] [bandHigh] to inspect a similarity range (default 0.72–0.86).
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { embed, cosine } from '../lib/hf';
import { tokenSortRatio, embedText, COSINE_THRESHOLD } from '../lib/pipeline/dedup';
import type { Snapshot } from '../lib/types';

/**
 * Control pairs with known labels, to locate the same-deal and different-deal bands
 * independently of whatever the snapshot happens to contain today.
 */
const CONTROLS: { label: string; truth: 'SAME' | 'DIFFERENT'; a: string; b: string }[] = [
  {
    label: 'same deal, reworded + abbreviated company',
    truth: 'SAME',
    a: 'HUL acquires skincare brand Minimalist for Rs 2,955 crore',
    b: 'Hindustan Unilever to buy Minimalist in Rs 2,955 crore deal',
  },
  {
    label: 'same deal, different angle (valuation vs approval)',
    truth: 'SAME',
    a: 'Dabur to acquire 51% stake in Badshah Masala',
    b: 'CCI clears Dabur acquisition of Badshah Masala',
  },
  {
    label: 'DIFFERENT deals, near-identical shape',
    truth: 'DIFFERENT',
    a: 'Dabur acquires majority stake in Badshah Masala',
    b: 'Marico acquires majority stake in Plix',
  },
  {
    label: 'DIFFERENT deals, same acquirer',
    truth: 'DIFFERENT',
    a: 'Tata Consumer acquires Capital Foods for Rs 5,100 crore',
    b: 'Tata Consumer acquires Organic India for Rs 1,900 crore',
  },
  {
    label: 'unrelated FMCG news',
    truth: 'DIFFERENT',
    a: 'HUL acquires skincare brand Minimalist for Rs 2,955 crore',
    b: 'Reliance opens 50 new grocery stores across Maharashtra',
  },
];

async function main() {
  console.log('\n=== CONTROL PAIRS (known labels) ===\n');

  const controlTexts = CONTROLS.flatMap((c) => [c.a, c.b]);
  const controlVecs = await embed(controlTexts);

  const sameScores: number[] = [];
  const diffScores: number[] = [];

  CONTROLS.forEach((c, i) => {
    const sim = cosine(controlVecs[i * 2], controlVecs[i * 2 + 1]);
    const ratio = tokenSortRatio(c.a, c.b);
    (c.truth === 'SAME' ? sameScores : diffScores).push(sim);
    console.log(`${c.truth.padEnd(9)} cos=${sim.toFixed(3)}  tokenSort=${String(ratio).padStart(3)}  ${c.label}`);
  });

  const maxDiff = Math.max(...diffScores);
  const minSame = Math.min(...sameScores);

  console.log(`\n  SAME      range ${minSame.toFixed(3)} – ${Math.max(...sameScores).toFixed(3)}`);
  console.log(`  DIFFERENT range ${Math.min(...diffScores).toFixed(3)} – ${maxDiff.toFixed(3)}`);
  console.log(
    minSame > maxDiff
      ? `  SEPARABLE — gap ${(minSame - maxDiff).toFixed(3)}; midpoint ${((minSame + maxDiff) / 2).toFixed(3)}`
      : `  OVERLAP of ${(maxDiff - minSame).toFixed(3)} — cosine alone cannot split these; the title guard has to.`,
  );

  console.log('\n=== LIVE SNAPSHOT PAIRS ===\n');

  const snap: Snapshot = JSON.parse(
    readFileSync(join(process.cwd(), 'data', 'snapshot.json'), 'utf8'),
  );
  const articles = (snap.articles ?? []).slice(0, 124);

  // Cache vectors: the article set is fixed between runs, and re-embedding on every
  // threshold tweak burns free-tier quota for identical numbers.
  const cachePath = join(process.cwd(), 'node_modules', '.cache', 'dedup-vecs.json');
  let vecs: number[][];
  try {
    const cached = JSON.parse(readFileSync(cachePath, 'utf8'));
    if (cached.count === articles.length) {
      vecs = cached.vecs;
      console.log(`Reusing ${vecs.length} cached embeddings`);
    } else throw new Error('stale');
  } catch {
    console.log(`Embedding ${articles.length} articles...`);
    vecs = await embed(articles.map(embedText));
    mkdirSync(join(process.cwd(), 'node_modules', '.cache'), { recursive: true });
    writeFileSync(cachePath, JSON.stringify({ count: articles.length, vecs }));
  }

  const pairs: { i: number; j: number; sim: number; ratio: number }[] = [];
  for (let i = 0; i < articles.length; i++) {
    for (let j = i + 1; j < articles.length; j++) {
      const sim = cosine(vecs[i], vecs[j]);
      if (sim >= 0.45) {
        pairs.push({ i, j, sim, ratio: tokenSortRatio(articles[i].title, articles[j].title) });
      }
    }
  }
  pairs.sort((x, y) => y.sim - x.sim);

  console.log(`${pairs.length} pairs scored >= 0.45 out of ${(articles.length * (articles.length - 1)) / 2} total\n`);

  // The decision band. Above ~0.81 live data is all true duplicates; the question is
  // how far down that holds before unrelated deals start merging.
  const [lo, hi] = [Number(process.argv[2] ?? 0.72), Number(process.argv[3] ?? 0.86)];
  const band = pairs.filter((p) => p.sim >= lo && p.sim < hi);
  console.log(`=== BAND ${lo}–${hi}: ${band.length} pairs — where does the first FALSE merge appear? ===\n`);

  for (const p of band.slice(0, 22)) {
    console.log(`cos=${p.sim.toFixed(3)}  tokenSort=${String(p.ratio).padStart(3)}`);
    console.log(`   A: ${articles[p.i].title.slice(0, 86)}`);
    console.log(`   B: ${articles[p.j].title.slice(0, 86)}`);
    console.log('');
  }

  console.log('Merge counts by threshold (* = current):\n');
  for (const t of [0.6, 0.65, 0.7, 0.75, 0.78, 0.8, 0.82, 0.85]) {
    const mark = t === COSINE_THRESHOLD ? ' *' : '';
    console.log(`  ${t.toFixed(2)} → ${String(pairs.filter((p) => p.sim >= t).length).padStart(3)} pairs merge${mark}`);
  }
  console.log('');
}

main().catch((err) => {
  console.error('calibration failed:', err);
  process.exit(1);
});
