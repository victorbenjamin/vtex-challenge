import { ImportSummary, type ItemOutcome } from '../domain/import-summary.ts';
import type { NameSynonyms } from '../domain/name-synonyms.ts';
import { Offer } from '../domain/offer.ts';
import { SellerProductEntry } from '../domain/seller-product-entry.ts';
import type { CatalogDatabase } from '../infrastructure/sqlite/catalog-database.ts';

// Most normalized names belong to a single product. Reaching this many candidates means
// the name is too generic to decide by brand alone.
export const CANDIDATE_LIMIT = 50;

// Use case: import a seller product file into the catalog.
//
// Each valid entry is linked to the catalog product with the same name up to spelling
// (accents, case, inch marks, spacing) and the same brand up to spelling. If no product
// has the entry's own name, its name translated to the catalog's vocabulary (synonyms such
// as "roteador" -> "router") is tried. Category is not compared: sellers spell it
// unreliably ("Photo" vs "Photography"). Entries that match no product are counted as
// unmatched and not written: creating products for them would duplicate the many that
// exist under another spelling. Any seller may send entries, the marketplace itself included.
//
// Each item runs in its own transaction. A failing item is rolled back and stops the
// import; re-running it completes the work, because importing is idempotent.
export class ImportCatalog {
  constructor(private readonly catalog: CatalogDatabase) {}

  execute(items: Iterable<unknown>): ImportSummary {
    // Synonyms are configuration-sized, so they are read once per import.
    const synonyms = this.catalog.loadNameSynonyms();
    const summary = new ImportSummary();
    let index = 0;
    for (const raw of items) {
      try {
        // The item is counted only once its transaction has committed.
        summary.count(this.catalog.transaction(() => this.importItem(raw, synonyms)));
      } catch (error) {
        summary.recordFailure(index, error instanceof Error ? error.message : String(error));
        return summary;
      }
      index++;
    }
    return summary;
  }

  private importItem(raw: unknown, synonyms: NameSynonyms): ItemOutcome {
    const entry = SellerProductEntry.parse(raw);
    if (!entry) {
      return 'rejected';
    }

    const productId = this.findProduct(entry, synonyms);
    if (productId === undefined) {
      return 'unmatched';
    }

    const sellerId = this.catalog.findOrCreateSeller(entry.sellerName);
    const offer = new Offer(sellerId, entry.sellerProductId, productId);
    return offer.outcomeGiven(this.catalog.addOfferIfAbsent(offer));
  }

  // The entry's own name comes first: a translated name is another name and could point
  // to another product. The translation is tried only when the own name finds no product
  // of the entry's brand; an ambiguous own name stops here.
  private findProduct(entry: SellerProductEntry, synonyms: NameSynonyms): number | undefined {
    const byOwnName = this.findUniqueProduct(entry.normalizedName, entry);
    if (byOwnName !== 'none') {
      return byOwnName === 'ambiguous' ? undefined : byOwnName;
    }

    const translatedName = synonyms.translate(entry.normalizedName);
    if (translatedName === entry.normalizedName) {
      return undefined;
    }
    const byTranslatedName = this.findUniqueProduct(translatedName, entry);
    return typeof byTranslatedName === 'number' ? byTranslatedName : undefined;
  }

  // The only product with this normalized name and the entry's brand. Several products, or
  // too many candidates to check all of them, are ambiguous: precision comes before recall.
  private findUniqueProduct(
    normalizedName: string,
    entry: SellerProductEntry,
  ): number | 'none' | 'ambiguous' {
    const candidates = this.catalog.findProductsByNormalizedName(normalizedName, CANDIDATE_LIMIT);
    if (candidates.length === CANDIDATE_LIMIT) {
      return 'ambiguous';
    }
    const [match, another] = candidates.filter((candidate) => entry.hasBrand(candidate.brand));
    if (!match) {
      return 'none';
    }
    return another ? 'ambiguous' : match.id;
  }
}
