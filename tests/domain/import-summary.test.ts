import { describe, expect, it } from 'vitest';
import { ImportSummary } from '../../src/domain/import-summary.ts';

describe('ImportSummary', () => {
  it('starts with every count at zero and no failure', () => {
    const summary = new ImportSummary();

    expect(summary.counts()).toEqual({
      linked: 0,
      alreadyLinked: 0,
      conflict: 0,
      created: 0,
      createdForReview: 0,
      unmatched: 0,
      rejected: 0,
    });
    expect(summary.failure).toBeUndefined();
  });

  it('counts each outcome of the records', () => {
    const summary = new ImportSummary();
    summary.add({ index: 0, outcome: 'linked', reason: 'matchedByName' });
    summary.add({ index: 1, outcome: 'linked', reason: 'matchedByName' });
    summary.add({ index: 2, outcome: 'unmatched', reason: 'ambiguous' });

    expect(summary.counts()).toMatchObject({ linked: 2, unmatched: 1 });
  });

  it('does not let callers change the counts', () => {
    const summary = new ImportSummary();
    const counts = summary.counts() as Record<string, number>;
    counts['linked'] = 99;

    expect(summary.counts().linked).toBe(0);
  });

  it('records where the import failed, without counting it', () => {
    const summary = new ImportSummary();
    summary.add({ index: 4, outcome: 'failed', reason: 'disk full' });

    expect(summary.failure).toEqual({ index: 4, message: 'disk full' });
    expect(Object.values(summary.counts()).every((count) => count === 0)).toBe(true);
  });
});
