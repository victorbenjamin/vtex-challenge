// An offer: one of the seller's own SKUs linked to a catalog product. A seller may have
// several SKUs for the same product, but each SKU points to a single product.
export class Offer {
  constructor(
    readonly sellerId: number,
    readonly sellerProductId: string,
    readonly productId: number,
  ) {}

  // What making this offer means, given the product the seller's SKU already pointed to
  // (undefined when it was new and this offer was stored). An existing link is never
  // overwritten: the same product is a re-import, another product is a conflict.
  outcomeGiven(existingProductId: number | undefined): 'linked' | 'alreadyLinked' | 'conflict' {
    if (existingProductId === undefined) {
      return 'linked';
    }
    return existingProductId === this.productId ? 'alreadyLinked' : 'conflict';
  }
}
