import { readFileSync } from 'node:fs';

// Reads an import file: a JSON array of seller products. Each item is validated by the domain.
export function readImportFile(path: string): unknown[] {
  const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(data)) {
    throw new Error(`Import file must contain a JSON array of products: ${path}`);
  }
  return data;
}
