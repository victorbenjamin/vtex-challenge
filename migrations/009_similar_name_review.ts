import type { Knex } from 'knex';

// 009: Reviewing products created with a name similar to an existing one.
//
// When the import creates a product, it compares its name with the active products of the
// same brand, so a typo or a different word order does not create a silent duplicate. The
// brand lookup needs an index, and ProductReview needs the new reason 'similarName'.
// SQLite cannot change a CHECK in place, so ProductReview is rebuilt, keeping its rows.

const createReviewTable = (name: string, reasons: string) => `
  CREATE TABLE ${name} (
    Id               INTEGER PRIMARY KEY,
    ProductId        INTEGER NOT NULL REFERENCES Product (Id),
    SimilarProductId INTEGER NOT NULL REFERENCES Product (Id),
    Reason           TEXT NOT NULL CHECK (Reason IN (${reasons})),
    Status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (Status IN ('pending', 'merged', 'distinct')),
    CreatedAt        TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (ProductId, SimilarProductId),
    CHECK (ProductId <> SimilarProductId)
  )`;

const rebuildReviewTable = async (knex: Knex, reasons: string) => {
  await knex.raw(createReviewTable('ProductReview_new', reasons));
  await knex.raw('INSERT INTO ProductReview_new SELECT * FROM ProductReview');
  await knex.raw('DROP TABLE ProductReview');
  await knex.raw('ALTER TABLE ProductReview_new RENAME TO ProductReview');
};

export async function up(knex: Knex): Promise<void> {
  await knex.raw('CREATE INDEX IX_Product_Brand ON Product (Brand COLLATE NOCASE)');
  await rebuildReviewTable(knex, "'sameNameOtherBrand', 'similarName'");
}

// Reviews for similar names cannot exist under the previous CHECK, so they are removed.
export async function down(knex: Knex): Promise<void> {
  await knex.raw("DELETE FROM ProductReview WHERE Reason = 'similarName'");
  await rebuildReviewTable(knex, "'sameNameOtherBrand'");
  await knex.raw('DROP INDEX IX_Product_Brand');
}
