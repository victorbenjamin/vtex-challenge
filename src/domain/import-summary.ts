// What can happen to an item of an import file.
export type ItemOutcome = 'linked' | 'alreadyLinked' | 'conflict' | 'unmatched' | 'rejected';

// How many items of an import file ended in each outcome, and where the import stopped if
// an item could not be committed. Temporary: a detailed report comes back once all
// matching rules are in place.
export class ImportSummary {
  private readonly totals: Record<ItemOutcome, number> = {
    linked: 0,
    alreadyLinked: 0,
    conflict: 0,
    unmatched: 0,
    rejected: 0,
  };
  private stoppedAt: { index: number; message: string } | undefined;

  count(outcome: ItemOutcome): void {
    this.totals[outcome] += 1;
  }

  recordFailure(index: number, message: string): void {
    this.stoppedAt = { index, message };
  }

  counts(): Readonly<Record<ItemOutcome, number>> {
    return { ...this.totals };
  }

  get failure(): { index: number; message: string } | undefined {
    return this.stoppedAt;
  }
}
