import type { Knex } from 'knex';

// 001: Seller entity and SellerProduct keyed by the seller's own SKU id.
//
// Each SellerProduct row is an offer: one seller SKU linked to one catalog product.
// A seller may have several SKUs for the same product. "Seller sells product" is a
// DISTINCT query over this table, not a row.
//
// SQLite cannot change a primary key in place, so SellerProduct is rebuilt.
// Existing rows are preserved; duplicate (seller, SellerProductId) pairs make the
// migration fail instead of silently dropping data.

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE Seller (
      Id   INTEGER PRIMARY KEY,
      Name TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(trim(Name)) > 0)
    )`);

  await knex.raw(`
    INSERT INTO Seller (Name)
    SELECT DISTINCT trim(SellerName) FROM SellerProduct`);

  await knex.raw(`
    CREATE TABLE SellerProduct_new (
      SellerId        INTEGER NOT NULL REFERENCES Seller (Id),
      SellerProductId TEXT    NOT NULL CHECK (length(trim(SellerProductId)) > 0),
      ProductId       INTEGER NOT NULL REFERENCES Product (Id),
      PRIMARY KEY (SellerId, SellerProductId)
    ) WITHOUT ROWID`);

  await knex.raw(`
    INSERT INTO SellerProduct_new (SellerId, SellerProductId, ProductId)
    SELECT s.Id, CAST(sp.SellerProductId AS TEXT), sp.ProductId
    FROM SellerProduct AS sp
    JOIN Seller AS s ON s.Name = trim(sp.SellerName)`);

  await knex.raw('DROP TABLE SellerProduct');
  await knex.raw('ALTER TABLE SellerProduct_new RENAME TO SellerProduct');
  await knex.raw('CREATE INDEX IX_SellerProduct_ProductId ON SellerProduct (ProductId)');
}

// Restores the original schema. A SellerProductId that is not an integer is still
// stored as text, because SQLite keeps the value when the column affinity cannot apply.
export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE SellerProduct_old (
      Id              INTEGER PRIMARY KEY AUTOINCREMENT,
      SellerName      TEXT NOT NULL,
      ProductId       INTEGER CONSTRAINT FK_Product_Id REFERENCES Product (Id) NOT NULL,
      SellerProductId INTEGER NOT NULL
    )`);

  await knex.raw(`
    INSERT INTO SellerProduct_old (SellerName, ProductId, SellerProductId)
    SELECT s.Name, sp.ProductId, sp.SellerProductId
    FROM SellerProduct AS sp
    JOIN Seller AS s ON s.Id = sp.SellerId`);

  await knex.raw('DROP TABLE SellerProduct');
  await knex.raw('ALTER TABLE SellerProduct_old RENAME TO SellerProduct');
  await knex.raw('DROP TABLE Seller');
}
