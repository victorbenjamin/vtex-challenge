import type { Knex } from 'knex';

// 008: Product.MergedIntoId, set when a product is merged into another (a duplicate D
// merged into the right product P). D is kept instead of deleted, so the merge stays on
// record and D's name and brand keep being recognized: the import resolves D to P, as an
// alias. MergedIntoId always points to an active (not merged) product.

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE Product ADD COLUMN MergedIntoId INTEGER REFERENCES Product (Id)
      CHECK (MergedIntoId IS NULL OR MergedIntoId <> Id)`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('ALTER TABLE Product DROP COLUMN MergedIntoId');
}
