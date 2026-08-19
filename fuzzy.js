import nlp from 'compromise';
import natural from 'natural';

const stemmer = natural.PorterStemmer;

const STOP_WORDS = new Set([
  'i', 'a', 'an', 'the', 'this', 'that',
  'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'and', 'or',
]);

function getWeightedTokens(text) {
  const doc = nlp(text);
  const tokens = new Map();

  const add = (weight) => (phrase) => {
    // split 'a coffee' → ['a', 'coffee'], filter stop words, then stem each
    for (const w of phrase.toLowerCase().split(/\s+/)) {
      if (STOP_WORDS.has(w)) continue;
      const stemmed = stemmer.stem(w);
      tokens.set(stemmed, Math.max(tokens.get(stemmed) ?? 0, weight));
    }
  };

  doc.nouns().out('array').forEach(add(5));
  doc.verbs().out('array').forEach(add(1));

  return tokens;
}

export function similarity(a, b) {
  const tA = getWeightedTokens(a);
  const tB = getWeightedTokens(b);
  const allKeys = new Set([...tA.keys(), ...tB.keys()]);

  let intersection = 0, union = 0;
  for (const key of allKeys) {
    const wA = tA.get(key) ?? 0;
    const wB = tB.get(key) ?? 0;
    intersection += Math.min(wA, wB);
    union += Math.max(wA, wB);
  }

  return union === 0 ? 0 : intersection / union;
}
