import { ImportSummary, type ItemOutcome } from '../domain/import-summary.ts';
import { Offer } from '../domain/offer.ts';
import { SellerProductEntry } from '../domain/seller-product-entry.ts';
import type { CatalogDatabase } from '../infrastructure/sqlite/catalog-database.ts';

// Most normalized names belong to a single product. Reaching this many candidates means
// the name is too generic to decide by brand alone.
export const CANDIDATE_LIMIT = 50;

// Use case: import a seller product file into the catalog.
//
// Each valid entry is linked to the catalog product with the same name up to spelling
// (accents, case, inch marks, spacing) and the same brand up to spelling. Category is not
// compared: sellers spell it unreliably ("Photo" vs "Photography"). Entries that match no
// product are counted as unmatched and not written: creating products for them would
// duplicate the many that exist under another spelling.
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

    const productId = this.findUniqueProduct(entry);
    if (productId === undefined) {
      return 'unmatched';
    }

    const sellerId = this.catalog.findOrCreateSeller(entry.sellerName);
    const offer = new Offer(sellerId, entry.sellerProductId, productId);
    return offer.outcomeGiven(this.catalog.addOfferIfAbsent(offer));
  }

  // The only product with the entry's normalized name and brand. None, several (ambiguous)
  // or too many candidates to check all of them leave the entry unmatched: precision
  // comes before recall.
  private findUniqueProduct(entry: SellerProductEntry): number | undefined {
    const candidates = this.catalog.findProductsByNormalizedName(
      entry.normalizedName,
      CANDIDATE_LIMIT,
    );
    if (candidates.length === CANDIDATE_LIMIT) {
      return undefined;
    }
    const matches = candidates.filter((candidate) => entry.hasBrand(candidate.brand));
    return matches.length === 1 ? matches[0]?.id : undefined;
  }
}
