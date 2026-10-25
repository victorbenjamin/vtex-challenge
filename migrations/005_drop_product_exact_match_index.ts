import type { Knex } from 'knex';

// 005: Drops the exact-match index created by migration 003.
//
// Every exact match is also a normalized-name match, so the import looks products up by
// normalized name only (IX_Product_NormalizedName_Brand_Category, migration 004). An unused
// index still costs on every write to Product.

export async function up(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IX_Product_Name_Brand_Category');
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('CREATE INDEX IX_Product_Name_Brand_Category ON Product (Name, Brand, Category)');
}
