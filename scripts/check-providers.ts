/**
 * Smoke-test the Groq and HF clients against the live APIs.
 *
 *   npm run check:providers
 *
 * Run this the moment keys are added. Provider wiring that fails does so for boring
 * reasons — wrong endpoint, wrong header, model renamed — and it's far cheaper to
 * find that here than midway through a pipeline run.
 */

import { chatJSON, chatText, hasGroqKey, MODEL_FAST, MODEL_SMART } from '../lib/groq';
import { embed, cosine, hasHfToken, EMBED_DIM } from '../lib/hf';

const ok = (m: string) => console.log(`  PASS  ${m}`);
const bad = (m: string) => console.log(`  FAIL  ${m}`);

let failures = 0;

async function check(label: string, fn: () => Promise<string>) {
  try {
    ok(`${label} — ${await fn()}`);
  } catch (err) {
    failures++;
    bad(`${label} — ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main() {
  console.log('\nGroq');
  if (!hasGroqKey()) {
    failures++;
    bad('GROQ_API_KEY not set — add it to .env.local');
  } else {
    await check(`${MODEL_FAST} JSON mode`, async () => {
      const r = await chatJSON<{ deal_type: string }>({
        system: 'Reply only with JSON.',
        user: 'Classify this: "HUL acquires Minimalist". Return {"deal_type": "..."} — one of M&A, Funding, Stake, JV.',
      });
      if (!r?.deal_type) throw new Error('no deal_type in response');
      return `parsed {deal_type: "${r.deal_type}"}`;
    });

    await check(`${MODEL_SMART} text mode`, async () => {
      const r = await chatText({
        system: 'You are terse.',
        user: 'Say exactly: ready',
        maxTokens: 16,
      });
      if (!r) throw new Error('empty response');
      return `responded "${r.slice(0, 40)}"`;
    });
  }

  console.log('\nHuggingFace');
  if (!hasHfToken()) {
    failures++;
    bad('HF_API_TOKEN not set — add it to .env.local');
  } else {
    await check('embeddings + cosine', async () => {
      // Same deal, different wording, vs. an unrelated one. This is the dedup
      // signal in miniature — near/far must be clearly separated.
      const [same, reworded, different] = await embed([
        'HUL acquires skincare brand Minimalist for Rs 2,955 crore',
        'Hindustan Unilever to buy Minimalist in Rs 2,955 crore deal',
        'Reliance opens 50 new grocery stores across Maharashtra',
      ]);

      if (same.length !== EMBED_DIM) {
        throw new Error(`expected ${EMBED_DIM} dims, got ${same.length}`);
      }

      const near = cosine(same, reworded);
      const far = cosine(same, different);
      if (near <= far) {
        throw new Error(`similarity is inverted: near=${near.toFixed(3)} far=${far.toFixed(3)}`);
      }
      return `${EMBED_DIM} dims · same-deal ${near.toFixed(3)} vs unrelated ${far.toFixed(3)}`;
    });
  }

  if (failures) {
    console.log(`\n${failures} check(s) failed.\n`);
    process.exit(1);
  }
  console.log('\nBoth providers are live. Ready for the dedup + relevance stages.\n');
}

main().catch((err) => {
  console.error('\ncheck-providers crashed:', err);
  process.exit(1);
});
