import { describe, expect, it } from 'vitest';
import { ImportSummary } from '../../src/domain/import-summary.ts';

describe('ImportSummary', () => {
  it('starts with every count at zero and no failure', () => {
    const summary = new ImportSummary();

    expect(summary.counts()).toEqual({
      linked: 0,
      alreadyLinked: 0,
      conflict: 0,
      unmatched: 0,
      rejected: 0,
    });
    expect(summary.failure).toBeUndefined();
  });

  it('counts each outcome', () => {
    const summary = new ImportSummary();
    summary.count('linked');
    summary.count('linked');
    summary.count('unmatched');

    expect(summary.counts()).toMatchObject({ linked: 2, unmatched: 1 });
  });

  it('does not let callers change the counts', () => {
    const summary = new ImportSummary();
    const counts = summary.counts() as Record<string, number>;
    counts['linked'] = 99;

    expect(summary.counts().linked).toBe(0);
  });

  it('records where the import failed', () => {
    const summary = new ImportSummary();
    summary.recordFailure(4, 'disk full');

    expect(summary.failure).toEqual({ index: 4, message: 'disk full' });
  });
});
