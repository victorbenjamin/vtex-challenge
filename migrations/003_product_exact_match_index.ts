import type { Knex } from 'knex';

// 003: Index for finding a catalog product by exactly its name, brand and category.
//
// The import looks products up one entry at a time instead of loading the whole catalog,
// so the lookup must be indexed. The query compares Brand and Category with IS (null equals
// null), which SQLite can also serve from this index.

export async function up(knex: Knex): Promise<void> {
  await knex.raw('CREATE INDEX IX_Product_Name_Brand_Category ON Product (Name, Brand, Category)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IX_Product_Name_Brand_Category');
}
