import type { Knex } from 'knex';

// 002: The marketplace itself as a seller of every product already in the catalog.
//
// Before becoming a marketplace the company sold its whole catalog, so each existing
// product gets an offer from the "Marketplace" seller. The marketplace has no separate
// SKU code for its own items, so SellerProductId is the catalog Product.Id as text.
// Products created later by imports come from external sellers and are not linked here.

export const MARKETPLACE_SELLER_NAME = 'Marketplace';

export async function up(knex: Knex): Promise<void> {
  await knex.raw('INSERT INTO Seller (Name) VALUES (?)', [MARKETPLACE_SELLER_NAME]);

  await knex.raw(
    `INSERT INTO SellerProduct (SellerId, SellerProductId, ProductId)
     SELECT s.Id, CAST(p.Id AS TEXT), p.Id
     FROM Product AS p
     CROSS JOIN Seller AS s
     WHERE s.Name = ?`,
    [MARKETPLACE_SELLER_NAME],
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(
    'DELETE FROM SellerProduct WHERE SellerId = (SELECT Id FROM Seller WHERE Name = ?)',
    [MARKETPLACE_SELLER_NAME],
  );
  await knex.raw('DELETE FROM Seller WHERE Name = ?', [MARKETPLACE_SELLER_NAME]);
}
