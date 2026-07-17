/**
 * HuggingFace Inference client — thin. Batching, retry, cosine.
 *
 * Only job: turn text into vectors for the dedup stage. Clustering logic lives in
 * lib/pipeline/dedup.ts. See docs/decisions.md#embeddings-for-dedup-not-an-llm.
 */

export const EMBED_MODEL = 'sentence-transformers/all-MiniLM-L6-v2';

/**
 * HF's router endpoint. The legacy api-inference.huggingface.co host still
 * redirects here, but pointing at the current one avoids a hop.
 */
const HF_ENDPOINT = `https://router.huggingface.co/hf-inference/models/${EMBED_MODEL}/pipeline/feature-extraction`;

/** all-MiniLM-L6-v2 output width — used to validate responses. */
export const EMBED_DIM = 384;

/** Texts per request. The model caps at 256 tokens/input, so batches stay small. */
const BATCH_SIZE = 32;

export function hasHfToken(): boolean {
  return Boolean(process.env.HF_API_TOKEN);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function embedBatch(texts: string[], token: string): Promise<number[][]> {
  const attempts = 4;
  let lastErr = '';

  for (let i = 0; i < attempts; i++) {
    const res = await fetch(HF_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ inputs: texts, options: { wait_for_model: true } }),
    });

    if (res.ok) {
      const data = (await res.json()) as unknown;
      if (!Array.isArray(data) || !Array.isArray(data[0])) {
        throw new Error(`unexpected embedding shape: ${JSON.stringify(data).slice(0, 200)}`);
      }
      return data as number[][];
    }

    lastErr = `${res.status} ${await res.text().catch(() => '')}`.slice(0, 200);

    // 503 = cold model. HF spins it up and asks us to wait; that's expected, not an error.
    // 429 = rate limited on the free tier.
    if (res.status !== 503 && res.status !== 429 && res.status < 500) {
      throw new Error(`HF embedding failed: ${lastErr}`);
    }
    await sleep(1000 * 2 ** i);
  }

  throw new Error(`HF embedding failed after ${attempts} attempts: ${lastErr}`);
}

/**
 * Embed texts in batches, preserving input order.
 *
 * Sequential across batches by design: the free tier rate-limits aggressively, and
 * a handful of batches costs far less wall-clock than a 429 retry storm.
 */
export async function embed(texts: string[]): Promise<number[][]> {
  const token = process.env.HF_API_TOKEN;
  if (!token) {
    throw new Error(
      'HF_API_TOKEN is not set. Copy .env.example to .env.local and fill it in. ' +
        'Read-only demo works without it; live refresh does not.',
    );
  }
  if (texts.length === 0) return [];

  // Empty strings make the endpoint 400. Substitute a placeholder and keep alignment —
  // callers index results positionally against their input array.
  const safe = texts.map((t) => (t.trim() ? t.trim() : 'empty'));

  const out: number[][] = [];
  for (const batch of chunk(safe, BATCH_SIZE)) {
    out.push(...(await embedBatch(batch, token)));
  }

  if (out.length !== texts.length) {
    throw new Error(`embedding count mismatch: got ${out.length}, expected ${texts.length}`);
  }
  return out;
}

/**
 * Cosine similarity. all-MiniLM-L6-v2 returns normalized vectors, so this is
 * effectively a dot product — but normalizing anyway costs nothing and means a
 * model swap can't silently corrupt the dedup threshold.
 */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`vector length mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
