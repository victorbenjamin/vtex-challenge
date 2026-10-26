import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ImportCatalog } from '../application/import-catalog.ts';
import type { ImportSummary } from '../domain/import-summary.ts';
import { readImportFile } from '../infrastructure/import-file.ts';
import { JsonArrayFile } from '../infrastructure/json-array-file.ts';
import { CatalogDatabase } from '../infrastructure/sqlite/catalog-database.ts';
import { openWorkingDatabase, WORKING_DATABASE_PATH } from '../infrastructure/sqlite/connection.ts';

// Usage: tsx src/cli/import.ts [file]   (default: data/ProductEntry.json)
// Imports into the working copy output/catalog.db, logs how many items ended in each outcome
// and writes what happened to each item, and why, to output/import-report.json.
const file = resolve(process.argv[2] ?? 'data/ProductEntry.json');

// The file is read before any write, so an invalid file changes nothing.
let items: unknown[];
try {
  items = readImportFile(file);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

if (!existsSync(WORKING_DATABASE_PATH)) {
  console.error('Working database not found. Run "npm run db:migrate" first.');
  process.exit(1);
}

const db = openWorkingDatabase(WORKING_DATABASE_PATH);
if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'Seller'").get()) {
  console.error(`Migrations not applied to ${WORKING_DATABASE_PATH}. Run "npm run db:migrate".`);
  process.exit(1);
}

const reportPath = join(dirname(WORKING_DATABASE_PATH), 'import-report.json');
const report = new JsonArrayFile(reportPath);
let summary: ImportSummary;
try {
  summary = new ImportCatalog(new CatalogDatabase(db)).execute(items, (record) =>
    report.append(record),
  );
} finally {
  report.close();
  db.close();
}

const counts = summary.counts();
console.log(`Imported ${file}`);
console.log(`  linked:         ${counts.linked}`);
console.log(`  already linked: ${counts.alreadyLinked}`);
console.log(`  conflicts:      ${counts.conflict}`);
console.log(`  created:        ${counts.created}`);
console.log(`  to review:      ${counts.createdForReview}`);
console.log(`  unmatched:      ${counts.unmatched}`);
console.log(`  rejected:       ${counts.rejected}`);

console.log(`Report: ${reportPath}`);

if (summary.failure) {
  const { index, message } = summary.failure;
  console.error(`Import stopped at item ${index}: ${message}`);
  console.error('Items before it are kept; re-run the import to complete it.');
  process.exitCode = 1;
}
