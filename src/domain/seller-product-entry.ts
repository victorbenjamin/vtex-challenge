import { normalizeBrand } from './brand.ts';
import { normalizeProductName } from './product-name.ts';

const isNonEmptyText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isOptionalText = (value: unknown): value is string | null | undefined =>
  value === null || value === undefined || typeof value === 'string';

// A seller's own code for the item: non-empty text, or a whole number, read as text so
// that 123 and "123" are the same SKU. A decimal number is more likely corrupt than a code.
const sellerProductIdOf = (value: unknown): string | undefined => {
  if (isNonEmptyText(value)) {
    return value;
  }
  return Number.isSafeInteger(value) ? String(value) : undefined;
};

// A product as a seller sent it in an import file. Only valid entries can exist.
export class SellerProductEntry {
  private constructor(
    readonly sellerProductId: string,
    readonly sellerName: string,
    readonly name: string,
    readonly brand: string | null,
    readonly category: string | null,
  ) {}

  // Reads an item of an import file: the entry, or why the item is invalid. The seller's Id
  // is accepted in any non-empty format, text or whole number: it belongs to the seller.
  // The product name is kept exactly as received.
  static read(raw: unknown): { entry: SellerProductEntry } | { rejection: string } {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return { rejection: 'item is not an object' };
    }
    const { Id, SellerName, Name, Brand, Category } = raw as Record<string, unknown>;
    const sellerProductId = sellerProductIdOf(Id);
    if (sellerProductId === undefined) {
      return { rejection: 'Id must be non-empty text or a whole number' };
    }
    if (!isNonEmptyText(SellerName)) {
      return { rejection: 'SellerName must be non-empty text' };
    }
    if (!isNonEmptyText(Name)) {
      return { rejection: 'Name must be non-empty text' };
    }
    if (!isOptionalText(Brand)) {
      return { rejection: 'Brand must be text or null' };
    }
    if (!isOptionalText(Category)) {
      return { rejection: 'Category must be text or null' };
    }
    return {
      entry: new SellerProductEntry(
        sellerProductId,
        SellerName.trim(),
        Name,
        Brand ?? null,
        Category ?? null,
      ),
    };
  }

  // The entry, or undefined for an invalid item.
  static parse(raw: unknown): SellerProductEntry | undefined {
    const result = SellerProductEntry.read(raw);
    return 'entry' in result ? result.entry : undefined;
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
