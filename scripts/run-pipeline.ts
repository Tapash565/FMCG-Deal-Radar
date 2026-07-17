/**
 * Regenerate data/snapshot.json — the committed seed that keeps the demo non-empty.
 *
 *   npm run pipeline            # full run
 *   npm run pipeline -- --force # write even if it produced 0 deals
 *
 * All eight stages run in lib/pipeline/run.ts, the SAME orchestration /api/refresh uses,
 * so the committed seed and a live refresh are the same shape of artifact. This file adds
 * only what's specific to producing a committed seed: rich diagnostics, the don't-clobber
 * guard, and the file write.
 *
 * EXPECT THIS TO TAKE MINUTES, and that it is not a bug. Groq's free tier allows 6,000
 * tokens/min; a 90-day window is ~400 articles, so the run has to sit out several rate
 * limit windows. That's exactly why the seed is generated offline and committed — the
 * demo must not depend on the pipeline being fast. See docs/architecture.md.
 */

// Offline: no deadline, so wait out rate-limit windows instead of failing. /api/refresh
// keeps the tight default, because Vercel kills it at 60s regardless. MUST be set before
// anything reads it — hence before the lib/groq import chain does any work.
//
// 10 minutes, which sounds absurd until you watch it: after repeated runs Groq advised a
// 570s wait, and a 180s cap simply turned that into a failed run and an empty snapshot.
// Nothing is gained by giving up on a wait we're perfectly able to sit through.
process.env.GROQ_MAX_BACKOFF_MS ??= '45000';
process.env.GROQ_ATTEMPTS ??= '12';

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runPipeline } from '../lib/pipeline/run';
import { formatValue } from '../lib/snapshot';
import { WINDOW_DAYS } from '../lib/config';

async function main() {
  const { snapshot, diagnostics } = await runPipeline({
    windowDays: WINDOW_DAYS,
    log: (msg) => console.log(msg),
  });

  const { failures, stats, rejected, timings, grouped, canonical, relevant, verdicts, totalMs } =
    diagnostics;

  if (failures.length) {
    console.warn(`\n${failures.length} feed(s) failed — coverage is narrower this run:`);
    for (const f of failures) console.warn(`  · ${f.feed}: ${f.error}`);
    console.warn('');
  }

  console.log(
    `  ${stats.preFiltered}/${stats.input} passed the regex pre-filter ` +
      `(${stats.input - stats.preFiltered} LLM calls saved)`,
  );
  console.log(
    `  ${stats.batchSurvivors} survived the batch pass → ${stats.relevant} after individual confirm ` +
      `(${stats.batchSurvivors - stats.relevant} false positive(s) caught)`,
  );

  if (rejected.length) {
    console.log(`  ${rejected.length} dropped for having no named target:`);
    for (const r of rejected) console.log(`     ${r.acquirer} → (none) · ${r.dealType}`);
  }

  const dir = join(process.cwd(), 'data');
  const target = join(dir, 'snapshot.json');
  await mkdir(dir, { recursive: true });

  // The seed exists to guarantee the demo is never empty, so a failed run must not be
  // able to destroy it. A run that yields 0 deals where the existing seed has some is
  // far more likely to be broken (rate limits, a bad prompt) than to be the truth.
  // Pass --force to overwrite anyway.
  if (snapshot.deals.length === 0 && !process.argv.includes('--force')) {
    let existing = 0;
    try {
      existing = JSON.parse(await readFile(target, 'utf8')).deals?.length ?? 0;
    } catch {
      /* no seed yet — writing an empty one is fine */
    }
    if (existing > 0) {
      console.error(
        `\nREFUSING TO WRITE: this run produced 0 deals but the existing seed has ${existing}.\n` +
          `That is almost certainly a failure, not a result. The seed is unchanged.\n` +
          `Re-run when the provider quota resets, or pass --force if 0 is genuinely correct.`,
      );
      process.exit(1);
    }
  }

  await writeFile(target, JSON.stringify(snapshot, null, 2) + '\n');

  const elapsed = (totalMs / 1000).toFixed(1);
  console.log('\nFunnel');
  console.log(`  ingested  ${snapshot.funnel.ingested}`);
  console.log(`  deduped   ${snapshot.funnel.deduped}`);
  console.log(`  relevant  ${snapshot.funnel.relevant}`);
  console.log(`  selected  ${snapshot.funnel.selected}`);

  console.log('\nSelected deals');
  for (const g of grouped) {
    console.log(`\n  ${g.category}`);
    for (const d of g.deals) {
      console.log(
        `    ${d.acquirer} → ${d.target}` +
          `\n      ${d.dealType} · ${formatValue(d.dealValue, d.currency)}` +
          `${d.stakePct != null ? ` · ${d.stakePct}%` : ''}` +
          ` · ${d.confidence} (${d.corroboratingSources.length} source${d.corroboratingSources.length === 1 ? '' : 's'})`,
      );
    }
  }

  // If every kept deal scores ~1.0, relevanceConf carries no ranking signal and its
  // 0.35 weight in stage 7 is inert. Worth watching.
  const confs = relevant.map((a) => verdicts.get(a.id)!.confidence);
  if (confs.length) {
    const uniq = new Set(confs.map((c) => c.toFixed(2)));
    console.log(
      `\n  relevanceConf: min ${Math.min(...confs).toFixed(2)} max ${Math.max(...confs).toFixed(2)} ` +
        `— ${uniq.size} distinct value(s) across ${confs.length} deals`,
    );
  }

  const tierCounts = [1, 2, 3].map((t) => canonical.filter((a) => a.sourceTier === t).length);
  console.log(`\nTiers  T1=${tierCounts[0]}  T2=${tierCounts[1]}  T3=${tierCounts[2]}`);

  // Which origins actually pay off? Articles are cheap; RELEVANT articles are the
  // product. A query pulling 20 items that all get rejected is pure cost.
  const relevantIds = new Set(relevant.map((a) => a.id));
  const yieldByOrigin = new Map<string, { total: number; relevant: number }>();
  for (const a of canonical) {
    const e = yieldByOrigin.get(a.queryTerm) ?? { total: 0, relevant: 0 };
    e.total++;
    if (relevantIds.has(a.id)) e.relevant++;
    yieldByOrigin.set(a.queryTerm, e);
  }
  const productive = [...yieldByOrigin.entries()]
    .filter(([, v]) => v.relevant > 0)
    .sort((a, b) => b[1].relevant - a[1].relevant);
  console.log('\nOrigins that produced a relevant deal');
  for (const [q, v] of productive) console.log(`  ${v.relevant}/${v.total}  ${q}`);
  const deadWeight = [...yieldByOrigin.values()].filter((v) => v.relevant === 0);
  console.log(
    `  (${deadWeight.length} origins produced 0 deals from ` +
      `${deadWeight.reduce((s, v) => s + v.total, 0)} articles)`,
  );

  console.log('\nStage timings (60s ceiling on /api/refresh)');
  for (const t of timings) {
    console.log(`  ${t.stage.padEnd(10)} ${(t.ms / 1000).toFixed(1)}s`);
  }
  const total = Number(elapsed);
  console.log(`  ${'TOTAL'.padEnd(10)} ${total}s  ${total > 60 ? '*** OVER BUDGET ***' : '(within budget)'}`);
  console.log(`\nWrote data/snapshot.json in ${elapsed}s`);
}

main().catch((err) => {
  console.error('Pipeline failed:', err);
  process.exit(1);
});
