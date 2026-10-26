import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

// A JSON array written one element at a time: "[", the elements separated by commas, "]".
// The file is a regular JSON array, yet its contents never need to be held in memory.
export class JsonArrayFile {
  private readonly descriptor: number;
  private written = 0;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.descriptor = openSync(path, 'w');
    writeSync(this.descriptor, '[');
  }

  append(value: unknown): void {
    writeSync(this.descriptor, `${this.written === 0 ? '\n  ' : ',\n  '}${JSON.stringify(value)}`);
    this.written += 1;
  }

  close(): void {
    writeSync(this.descriptor, this.written === 0 ? ']\n' : '\n]\n');
    closeSync(this.descriptor);
  }
}
