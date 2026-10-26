import type { ImportRecord, ItemOutcome } from './import-record.ts';

export type { ItemOutcome } from './import-record.ts';

// How many items of an import file ended in each outcome, and where the import stopped if
// an item could not be committed. Built from the records of the import report.
export class ImportSummary {
  private readonly totals: Record<ItemOutcome, number> = {
    linked: 0,
    alreadyLinked: 0,
    conflict: 0,
    created: 0,
    createdForReview: 0,
    unmatched: 0,
    rejected: 0,
  };
  private stoppedAt: { index: number; message: string } | undefined;

  add({ index, outcome, reason }: ImportRecord): void {
    if (outcome === 'failed') {
      this.stoppedAt = { index, message: reason };
    } else {
      this.totals[outcome] += 1;
    }
  }

  counts(): Readonly<Record<ItemOutcome, number>> {
    return { ...this.totals };
  }

  get failure(): { index: number; message: string } | undefined {
    return this.stoppedAt;
  }
}
