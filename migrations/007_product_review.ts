import type { Knex } from 'knex';

// 007: ProductReview, products created by an import that may duplicate an existing one.
//
// When an entry's name exists in the catalog only under another brand, the import creates
// a new product rather than risk linking the seller to the wrong one, and records each
// existing product of that name here. A reviewer later merges the two or marks them as
// distinct. Linking to a wrong product is the costly error; a duplicate can be merged.

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE ProductReview (
      Id               INTEGER PRIMARY KEY,
      ProductId        INTEGER NOT NULL REFERENCES Product (Id),
      SimilarProductId INTEGER NOT NULL REFERENCES Product (Id),
      Reason           TEXT NOT NULL CHECK (Reason IN ('sameNameOtherBrand')),
      Status           TEXT NOT NULL DEFAULT 'pending'
                       CHECK (Status IN ('pending', 'merged', 'distinct')),
      CreatedAt        TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (ProductId, SimilarProductId),
      CHECK (ProductId <> SimilarProductId)
    )`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TABLE ProductReview');
}
