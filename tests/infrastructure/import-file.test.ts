import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readImportFile } from '../../src/infrastructure/import-file.ts';

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'import-file-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const fileWith = (content: string) => {
  const path = join(directory, 'products.json');
  writeFileSync(path, content);
  return path;
};

describe('readImportFile', () => {
  it('reads a JSON array of items', () => {
    expect(readImportFile(fileWith('[{"Id": 1}, {"Id": "a"}]'))).toEqual([{ Id: 1 }, { Id: 'a' }]);
  });

  it('names a missing file', () => {
    const path = join(directory, 'missing.json');

    expect(() => readImportFile(path)).toThrow(`Import file not found or not readable: ${path}`);
  });

  it('names a file that is not valid JSON, with the parser reason', () => {
    const path = fileWith('{oops');

    expect(() => readImportFile(path)).toThrow(
      new RegExp(`^Import file is not valid JSON: ${path} \\(.+\\)$`),
    );
  });

  it('names a file whose JSON is not an array', () => {
    const path = fileWith('{"products": []}');

    expect(() => readImportFile(path)).toThrow(
      `Import file must contain a JSON array of products: ${path}`,
    );
  });
});
