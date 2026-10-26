import { normalizeBrand } from './brand.ts';
import { normalizeProductName } from './product-name.ts';

const isNonEmptyText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isOptionalText = (value: unknown): value is string | null | undefined =>
  value === null || value === undefined || typeof value === 'string';

// A product as a seller sent it in an import file. Only valid entries can exist.
export class SellerProductEntry {
  private constructor(
    readonly sellerProductId: string,
    readonly sellerName: string,
    readonly name: string,
    readonly brand: string | null,
    readonly category: string | null,
  ) {}

  // Returns undefined for an invalid item. The seller's Id is accepted in any non-empty
  // format: it belongs to the seller. The product name is kept exactly as received.
  static parse(raw: unknown): SellerProductEntry | undefined {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return undefined;
    }
    const { Id, SellerName, Name, Brand, Category } = raw as Record<string, unknown>;
    if (
      !isNonEmptyText(Id) ||
      !isNonEmptyText(SellerName) ||
      !isNonEmptyText(Name) ||
      !isOptionalText(Brand) ||
      !isOptionalText(Category)
    ) {
      return undefined;
    }
    return new SellerProductEntry(Id, SellerName.trim(), Name, Brand ?? null, Category ?? null);
  }

  get normalizedName(): string {
    return normalizeProductName(this.name);
  }

  // Whether a catalog brand is this entry's brand, up to spelling. A missing brand only
  // matches a missing brand.
  hasBrand(brand: string | null): boolean {
    return normalizeBrand(this.brand) === normalizeBrand(brand);
  }
}
