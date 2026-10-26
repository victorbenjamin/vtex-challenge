import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonArrayFile } from '../../src/infrastructure/json-array-file.ts';

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'json-array-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const write = (values: unknown[]) => {
  const path = join(directory, 'nested', 'report.json');
  const file = new JsonArrayFile(path);
  values.forEach((value) => file.append(value));
  file.close();
  return readFileSync(path, 'utf8');
};

describe('JsonArrayFile', () => {
  it('writes an empty array when nothing is appended', () => {
    expect(JSON.parse(write([]))).toEqual([]);
  });

  it('writes the appended values as a JSON array, one per line', () => {
    const values = [{ a: 1 }, { b: 'quote \' and " and ],' }, null];
    const content = write(values);

    expect(JSON.parse(content)).toEqual(values);
    expect(content.split('\n')).toHaveLength(values.length + 3);
  });
});
