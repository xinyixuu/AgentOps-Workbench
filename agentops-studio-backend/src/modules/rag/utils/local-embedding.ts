const DEFAULT_EMBEDDING_DIMENSION = 128;

export function generateLocalEmbedding(text: string, dimension = DEFAULT_EMBEDDING_DIMENSION): number[] {
  const tokens = tokenize(text);
  const vector = new Array(dimension).fill(0);

  if (tokens.length === 0) {
    return vector;
  }

  for (const token of tokens) {
    const index = hashToken(token) % dimension;
    vector[index] += token.length > 1 ? 1.25 : 1;
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) {
    return vector;
  }

  return vector.map((value) => Number((value / norm).toFixed(8)));
}

function tokenize(text: string): string[] {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const baseTokens = normalized.match(/[a-z0-9]+|[\u4e00-\u9fff]/g) || [];
  const cjkChars = baseTokens.filter((token) => /[\u4e00-\u9fff]/.test(token));
  const cjkBigrams: string[] = [];

  for (let index = 0; index < cjkChars.length - 1; index += 1) {
    cjkBigrams.push(`${cjkChars[index]}${cjkChars[index + 1]}`);
  }

  return [...baseTokens, ...cjkBigrams];
}

function hashToken(token: string): number {
  let hash = 2166136261;

  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}
