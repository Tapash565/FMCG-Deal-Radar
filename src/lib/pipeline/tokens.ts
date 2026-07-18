/**
 * Shared token helpers for entity-name reasoning. No network, no model.
 *
 * Split out of extract.ts so the deal-identity merge (merge.ts) can share the exact
 * same notion of a "distinctive" token without pulling extract's Groq import chain.
 * One generic-token list, two callers — a name test (does this record name anything?)
 * and an identity test (do two records name the same thing?).
 */

/**
 * Words that describe a company without naming one. A name built only from these is a
 * paraphrase of the headline, not an entity.
 */
export const GENERIC_TOKENS = new Set([
  // generic nouns
  'company', 'companies', 'firm', 'firms', 'startup', 'startups', 'brand', 'brands',
  'business', 'businesses', 'major', 'majors', 'group', 'maker', 'makers', 'player',
  'players', 'giant', 'giants', 'billionaire', 'entity', 'arm', 'unit', 'subsidiary',
  'venture', 'chain', 'retailer', 'producer', 'manufacturer', 'conglomerate', 'parent',
  'undisclosed', 'unnamed', 'unknown', 'anonymous', 'investor', 'investors', 'consortium',
  // sector words — descriptive unless paired with a real name
  'beverage', 'beverages', 'food', 'foods', 'cosmetics', 'care', 'personal', 'home',
  'products', 'fmcg', 'consumer', 'goods', 'dairy', 'snacks', 'beauty', 'skincare',
  // qualifiers and nationalities
  'the', 'a', 'an', 'of', 'and', 'in', 'global', 'local', 'leading', 'top', 'largest',
  'biggest', 'indian', 'kenyan', 'german', 'american', 'british', 'french', 'chinese',
  'japanese', 'european', 'us', 'uk', 'india', 'based', 'listed', 'private', 'public',
]);

/** Lowercased alphanumeric tokens of a name. */
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Tokens that carry identity: not generic, and at least two chars (a lone letter or
 * digit is never a company name). "Vedix, SkinKraft parent" → [vedix, skinkraft];
 * "Beverages Major" → []; "Naturis Cosmetics" → [naturis].
 */
export function distinctiveTokens(s: string): string[] {
  return tokenize(s).filter((t) => t.length >= 2 && !GENERIC_TOKENS.has(t));
}

/**
 * Structural gate: does this string name anything at all? At least one distinctive
 * token. "Varun Beverages" keeps (varun); "Beverages Major" goes — every token is a
 * category or qualifier word.
 */
export function namesAnEntity(s: string): boolean {
  return distinctiveTokens(s).length > 0;
}

/** Do two names share a distinctive token — i.e. plausibly refer to the same entity? */
export function sharesDistinctiveToken(a: string, b: string): boolean {
  const setA = new Set(distinctiveTokens(a));
  return distinctiveTokens(b).some((t) => setA.has(t));
}
