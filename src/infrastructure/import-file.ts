import { readFileSync } from 'node:fs';

// Reads an import file: a JSON array of seller products. Each item is validated by the domain.
// Errors name the file and say what is wrong with it, in one line.
export function readImportFile(path: string): unknown[] {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Import file not found or not readable: ${path}`);
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Import file is not valid JSON: ${path} (${reason})`);
  }

  if (!Array.isArray(data)) {
    throw new Error(`Import file must contain a JSON array of products: ${path}`);
  }
  return data;
}
