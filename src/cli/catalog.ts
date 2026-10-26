import { existsSync } from 'node:fs';
import { MarkDistinct } from '../application/mark-distinct.ts';
import { MergeProducts } from '../application/merge-products.ts';
import { CatalogDatabase } from '../infrastructure/sqlite/catalog-database.ts';
import { openWorkingDatabase, WORKING_DATABASE_PATH } from '../infrastructure/sqlite/connection.ts';

// Usage, on the working copy output/catalog.db:
//   tsx src/cli/catalog.ts reviews                      lists pending reviews
//   tsx src/cli/catalog.ts merge <duplicate> <target>   merges a duplicate into a product
//   tsx src/cli/catalog.ts distinct <product> <similar> marks a reviewed pair as distinct
const [command, ...args] = process.argv.slice(2);

const productId = (value: string | undefined): number => {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) {
    throw new Error(`Invalid product id: ${value ?? '(missing)'}`);
  }
  return id;
};

if (!existsSync(WORKING_DATABASE_PATH)) {
  console.error('Working database not found. Run "npm run db:migrate" first.');
  process.exit(1);
}

const db = openWorkingDatabase(WORKING_DATABASE_PATH);
const catalog = new CatalogDatabase(db);

try {
  switch (command) {
    case 'reviews': {
      const reviews = catalog.listPendingReviews();
      if (reviews.length === 0) {
        console.log('No pending reviews');
      }
      for (const review of reviews) {
        console.log(
          `#${review.productId} ${review.product}  may duplicate  #${review.similarProductId} ${review.similarProduct}  (${review.createdAt})`,
        );
      }
      break;
    }
    case 'merge': {
      const [duplicate, target] = [productId(args[0]), productId(args[1])];
      const { movedOffers, resolvedReviews } = new MergeProducts(catalog).execute(
        duplicate,
        target,
      );
      console.log(
        `Merged product ${duplicate} into ${target}: ${movedOffers} offers moved, ${resolvedReviews} reviews resolved`,
      );
      break;
    }
    case 'distinct': {
      const [product, similar] = [productId(args[0]), productId(args[1])];
      new MarkDistinct(catalog).execute(product, similar);
      console.log(`Products ${product} and ${similar} marked as distinct`);
      break;
    }
    default:
      throw new Error(
        'Usage: catalog reviews | merge <duplicate> <target> | distinct <product> <similar>',
      );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  db.close();
}
