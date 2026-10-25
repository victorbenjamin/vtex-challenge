import { ImportSummary, type ItemOutcome } from '../domain/import-summary.ts';
import { Offer } from '../domain/offer.ts';
import { SellerProductEntry } from '../domain/seller-product-entry.ts';
import type { CatalogDatabase } from '../infrastructure/sqlite/catalog-database.ts';

// Use case: import a seller product file into the catalog.
//
// Each valid entry is linked to the catalog product with the same name up to spelling
// (accents, case, inch marks, spacing) and the same brand and category. Entries that
// match no product are counted as unmatched and not written: creating products for them
// would duplicate the many that exist under another spelling.
//
// Each item runs in its own transaction. A failing item is rolled back and stops the
// import; re-running it completes the work, because importing is idempotent.
export class ImportCatalog {
  constructor(private readonly catalog: CatalogDatabase) {}

  execute(items: Iterable<unknown>): ImportSummary {
    const summary = new ImportSummary();
    let index = 0;
    for (const raw of items) {
      try {
        // The item is counted only once its transaction has committed.
        summary.count(this.catalog.transaction(() => this.importItem(raw)));
      } catch (error) {
        summary.recordFailure(index, error instanceof Error ? error.message : String(error));
        return summary;
      }
      index++;
    }
    return summary;
  }

  private importItem(raw: unknown): ItemOutcome {
    const entry = SellerProductEntry.parse(raw);
    if (!entry || entry.isFromMarketplace()) {
      return 'rejected';
    }

    // Two candidates are enough to tell a unique match from an ambiguous one, and an
    // ambiguous match never links: precision comes before recall.
    const [productId, ambiguous] = this.catalog.findProductIdsByNormalizedName(entry, 2);
    if (productId === undefined || ambiguous !== undefined) {
      return 'unmatched';
    }

    const sellerId = this.catalog.findOrCreateSeller(entry.sellerName);
    const offer = new Offer(sellerId, entry.sellerProductId, productId);
    return offer.outcomeGiven(this.catalog.addOfferIfAbsent(offer));
  }
}
