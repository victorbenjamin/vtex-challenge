import { ImportSummary, type ItemOutcome } from '../domain/import-summary.ts';
import type { NameSynonyms } from '../domain/name-synonyms.ts';
import { Offer } from '../domain/offer.ts';
import { SellerProductEntry } from '../domain/seller-product-entry.ts';
import type { CatalogDatabase } from '../infrastructure/sqlite/catalog-database.ts';

// Most normalized names belong to a single product. Reaching this many candidates means
// the name is too generic to decide by brand alone.
export const CANDIDATE_LIMIT = 50;

// What looking an entry up in the catalog found. `notFound` carries the products that have
// the name but another brand: a product created for the entry may duplicate one of them.
type Lookup =
  | { kind: 'found'; productId: number }
  | { kind: 'ambiguous' }
  | { kind: 'notFound'; similarProductIds: number[] };

// Use case: import a seller product file into the catalog.
//
// Each valid entry is linked to the catalog product with the same name up to spelling
// (accents, case, inch marks, spacing) and the same brand up to spelling. If no product has
// the entry's own name, its name translated to the catalog's vocabulary (synonyms such as
// "roteador" -> "router") is tried. Category is not compared: sellers spell it unreliably
// ("Photo" vs "Photography"). Any seller may send entries, the marketplace itself included.
//
// An entry that matches no product of its brand becomes a new product. If its name exists
// under another brand, the new product is recorded for review: linking the seller to a
// wrong product is the costly error, while a duplicate can be merged later. An ambiguous
// entry (several products of its name and brand) creates nothing: the product exists.
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

    const lookup = this.findProduct(entry, synonyms);
    if (lookup.kind === 'ambiguous') {
      return 'unmatched';
    }

    const sellerId = this.catalog.findOrCreateSeller(entry.sellerName);
    if (lookup.kind === 'notFound') {
      return this.createProduct(entry, sellerId, lookup.similarProductIds);
    }
    const offer = new Offer(sellerId, entry.sellerProductId, lookup.productId);
    return offer.outcomeGiven(this.catalog.addOfferIfAbsent(offer));
  }

  // A product new to the catalog, offered by the seller. If the seller's SKU already points
  // to a product, nothing is created: the SKU cannot point to two products, and an existing
  // link is never overwritten.
  private createProduct(
    entry: SellerProductEntry,
    sellerId: number,
    similarProductIds: readonly number[],
  ): ItemOutcome {
    if (this.catalog.findOfferProductId(sellerId, entry.sellerProductId) !== undefined) {
      return 'conflict';
    }
    const productId = this.catalog.createProduct(entry);
    this.catalog.addOfferIfAbsent(new Offer(sellerId, entry.sellerProductId, productId));
    if (similarProductIds.length === 0) {
      return 'created';
    }
    this.catalog.addProductReviews(productId, similarProductIds, 'sameNameOtherBrand');
    return 'createdForReview';
  }

  // The entry's own name comes first: a translated name is another name and could point
  // to another product. The translation is tried only when the own name finds no product
  // of the entry's brand; an ambiguous own name stops here.
  private findProduct(entry: SellerProductEntry, synonyms: NameSynonyms): Lookup {
    const byOwnName = this.lookUp(entry.normalizedName, entry);
    const translatedName = synonyms.translate(entry.normalizedName);
    if (byOwnName.kind !== 'notFound' || translatedName === entry.normalizedName) {
      return byOwnName;
    }
    const byTranslatedName = this.lookUp(translatedName, entry);
    if (byTranslatedName.kind !== 'notFound') {
      return byTranslatedName;
    }
    return {
      kind: 'notFound',
      similarProductIds: [...byOwnName.similarProductIds, ...byTranslatedName.similarProductIds],
    };
  }

  // The only product with this normalized name and the entry's brand. Several products, or
  // too many candidates to check all of them, are ambiguous: precision comes before recall.
  private lookUp(normalizedName: string, entry: SellerProductEntry): Lookup {
    const candidates = this.catalog.findProductsByNormalizedName(normalizedName, CANDIDATE_LIMIT);
    if (candidates.length === CANDIDATE_LIMIT) {
      return { kind: 'ambiguous' };
    }
    const [match, another] = candidates.filter((candidate) => entry.hasBrand(candidate.brand));
    if (!match) {
      return { kind: 'notFound', similarProductIds: candidates.map(({ id }) => id) };
    }
    return another ? { kind: 'ambiguous' } : { kind: 'found', productId: match.id };
  }
}
