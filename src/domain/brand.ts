// The spelling-independent form of a brand: no accents, case, spaces or punctuation, so
// "Levi's" = "Levis", "Amazon Basics" = "AmazonBasics", "BLACK+DECKER" = "Black+Decker".
// A missing brand stays missing: null only matches null.
export function normalizeBrand(brand: string | null): string | null {
  if (brand === null) {
    return null;
  }
  return brand
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}
