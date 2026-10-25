import type { Knex } from 'knex';

// 004: Product.NormalizedName, indexed with brand and category, for matching names that
// differ only in spelling (accents, case, inch marks, spacing).
//
// SQLite cannot strip accents in SQL, so the column is computed here. The normalization is
// a frozen copy of normalizeProductName as of this migration, so the migration always
// writes the same values; a test checks the two still agree. If the normalization changes,
// a new migration recomputes the column. New products must set NormalizedName themselves.

export function normalizeAtMigration004(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/''|"/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function up(knex: Knex): Promise<void> {
  await knex.raw('ALTER TABLE Product ADD COLUMN NormalizedName TEXT');

  const products = (await knex.raw('SELECT Id, Name FROM Product')) as {
    Id: number;
    Name: string;
  }[];
  for (const { Id, Name } of products) {
    await knex.raw('UPDATE Product SET NormalizedName = ? WHERE Id = ?', [
      normalizeAtMigration004(Name),
      Id,
    ]);
  }

  await knex.raw(
    'CREATE INDEX IX_Product_NormalizedName_Brand_Category ON Product (NormalizedName, Brand, Category)',
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IX_Product_NormalizedName_Brand_Category');
  await knex.raw('ALTER TABLE Product DROP COLUMN NormalizedName');
}
