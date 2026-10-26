import { ItemResult, toImportRecord, type ImportRecord } from '../domain/import-record.ts';
import { ImportSummary } from '../domain/import-summary.ts';
import { Offer } from '../domain/offer.ts';
import { SellerProductEntry } from '../domain/seller-product-entry.ts';
import type { CatalogDatabase } from '../infrastructure/sqlite/catalog-database.ts';
import { ProductMatcher } from './product-matcher.ts';

export { CANDIDATE_LIMIT } from './product-matcher.ts';

// Use case: import a seller product file into the catalog.
//
// Each valid entry is matched to a catalog product (see ProductMatcher). A matched entry
// becomes an offer of the seller. An entry that matches no product of its brand becomes a
// new product; if its name exists under another brand, the new product is recorded for
// review: linking the seller to a wrong product is the costly error, while a duplicate can
// be merged later. An ambiguous entry creates nothing: the product exists. Any seller may
// send entries, the marketplace itself included.
//
// Each item runs in its own transaction. A failing item is rolled back and stops the
// import; re-running it completes the work, because importing is idempotent. `onItem`
// receives the report record of each item once its transaction has committed, so a report
// never lists work that was rolled back; it is called item by item, so it can be streamed.
export class ImportCatalog {
  constructor(private readonly catalog: CatalogDatabase) {}

  execute(
    items: Iterable<unknown>,
    onItem: (record: ImportRecord) => void = () => {},
  ): ImportSummary {
    // Synonyms are configuration-sized, so they are read once per import.
    const matcher = new ProductMatcher(this.catalog, this.catalog.loadNameSynonyms());
    const summary = new ImportSummary();
    const report = (index: number, result: ItemResult) => {
      const record = toImportRecord(index, result);
      summary.add(record);
      onItem(record);
    };

    let index = 0;
    for (const raw of items) {
      const current = index++;
      try {
        report(
          current,
          this.catalog.transaction(() => this.importItem(raw, matcher)),
        );
      } catch (error) {
        report(current, ItemResult.failed(error instanceof Error ? error.message : String(error)));
        return summary;
      }
    }
    return summary;
  }

  private importItem(raw: unknown, matcher: ProductMatcher): ItemResult {
    const read = SellerProductEntry.read(raw);
    if ('rejection' in read) {
      return ItemResult.rejected(read.rejection);
    }
    const { entry } = read;

    const match = matcher.match(entry);
    switch (match.kind) {
      case 'found':
        return this.offer(entry, match.productId, match.matchedBy);
      case 'notFound':
        return this.createProduct(entry, match.similarProductIds, matcher);
      case 'ambiguous':
        return ItemResult.ambiguous(entry, match.candidateProductIds);
      case 'tooManyCandidates':
        return ItemResult.tooManyCandidates(entry);
    }
  }

  // The seller's offer of a product found in the catalog.
  private offer(
    entry: SellerProductEntry,
    productId: number,
    matchedBy: 'name' | 'translatedName',
  ): ItemResult {
    const sellerId = this.catalog.findOrCreateSeller(entry.sellerName);
    const offer = new Offer(sellerId, entry.sellerProductId, productId);
    const existingProductId = this.catalog.addOfferIfAbsent(offer);
    const outcome = offer.outcomeGiven(existingProductId);
    return ItemResult.offered(entry, outcome, productId, matchedBy, existingProductId);
  }

  // A product new to the catalog, offered by the seller. If the seller's SKU already points
  // to a product, nothing is created: the SKU cannot point to two products, and an existing
  // link is never overwritten.
  //
  // A product that may duplicate others is recorded for review: products with the same name
  // under another brand, and products of the same brand with a similar name (a typo or
  // another word order), so no duplicate is created silently.
  private createProduct(
    entry: SellerProductEntry,
    sameNameProductIds: number[],
    matcher: ProductMatcher,
  ): ItemResult {
    const sellerId = this.catalog.findOrCreateSeller(entry.sellerName);
    const existingProductId = this.catalog.findOfferProductId(sellerId, entry.sellerProductId);
    if (existingProductId !== undefined) {
      return ItemResult.skuConflict(entry, existingProductId);
    }

    const similarNameProductIds = matcher.similarNamesOf(entry);
    const productId = this.catalog.createProduct(entry);
    this.catalog.addOfferIfAbsent(new Offer(sellerId, entry.sellerProductId, productId));
    if (sameNameProductIds.length === 0 && similarNameProductIds.length === 0) {
      return ItemResult.created(entry, productId);
    }
    this.catalog.addProductReviews(productId, sameNameProductIds, 'sameNameOtherBrand');
    this.catalog.addProductReviews(productId, similarNameProductIds, 'similarName');
    return ItemResult.createdForReview(entry, productId, sameNameProductIds, similarNameProductIds);
  }
}
