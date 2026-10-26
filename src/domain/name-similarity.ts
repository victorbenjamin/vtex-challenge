import { distance } from 'fastest-levenshtein';

// How close two names must be, after sorting their words, to be reviewed as a possible
// duplicate. Similarity only ever flags a product for review, never links an offer: a
// false alarm ("Compression Shirt" and "Compression Shorts" pass) costs one review, while
// linking two different products would be the costly error.
export const NAME_SIMILARITY_THRESHOLD = 0.85;

const sortedWords = (normalizedName: string) => normalizedName.split(' ').sort().join(' ');

// Numbers tell models apart ("S23" vs "S24", "55" vs "65"), so they must be the same.
const numbersOf = (normalizedName: string) =>
  (normalizedName.match(/\d+(?:\.\d+)?/g) ?? []).sort().join(' ');

// Whether two normalized names may name the same product spelled differently: a typo
// ("smarthpone") or another word order ("galaxy s23 smartphone"). Identical names are not
// "similar": they are the same name, handled by the name match.
export function areSimilarNames(a: string, b: string): boolean {
  if (a === b || numbersOf(a) !== numbersOf(b)) {
    return false;
  }
  const [x, y] = [sortedWords(a), sortedWords(b)];
  return 1 - distance(x, y) / Math.max(x.length, y.length) >= NAME_SIMILARITY_THRESHOLD;
}
