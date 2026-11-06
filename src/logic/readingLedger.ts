import type { NozzleReadingRecord, CashDeposit, DailyOperation, Nozzle, Expense } from '../types';
import { calculateSales } from './calculations';

const cashRound = (n: number) => Math.round(n * 100) / 100;

export function collectedExpenseTotal(expenses: Expense[]): number {
  return cashRound(expenses.reduce((sum, e) => sum + (e.collectedCashUsed ?? (e.paidBy === 'manager' ? e.amount : 0)), 0));
}

export function expenseFromCollectedCash(amount: number, expenses: Expense[], deposits: CashDeposit[]): number {
  const received = deposits.reduce((sum, d) => sum + d.amount, 0);
  const spent = expenses.reduce((sum, e) => sum + (e.collectedCashUsed ?? (e.paidBy === 'manager' ? e.amount : 0)), 0);
  return cashRound(Math.min(amount, Math.max(0, received - spent)));
}

export function remainingCashForReading(sale: number, received: number, dayRemaining: number): number {
  // Keep genuine reading overpayments visible, but never ask for money already
  // accounted for by day-level expenses or credit. Do not allocate them twice.
  const readingRemaining = cashRound(sale - received);
  return readingRemaining < 0 ? readingRemaining : cashRound(Math.min(readingRemaining, Math.max(0, dayRemaining)));
}

export function updateNozzleMeters(operation: DailyOperation, nozzles: Nozzle[], operations: DailyOperation[]): Nozzle[] {
  return nozzles.map((nozzle) => {
    // Derive the date for legacy nozzles too, before their first dated save.
    const latestDay = operations.reduce((latest, op) =>
      op.id !== operation.id && op.nozzleReadings.some((r) => r.nozzleId === nozzle.id && r.closingAccepted)
        && op.businessDate > latest ? op.businessDate : latest,
    nozzle.lastClosingDay || '');
    if (latestDay > operation.businessDate) return nozzle;
    const accepted = operation.nozzleReadings.filter((r) => r.nozzleId === nozzle.id && r.closingAccepted)
      .sort((a, b) => (a.meterOrder || 0) - (b.meterOrder || 0)
        || (a.closingAcceptedAt || '').localeCompare(b.closingAcceptedAt || ''));
    const last = accepted[accepted.length - 1];
    if (!last || !Number.isFinite(last.closingMeter)) return nozzle;
    return { ...nozzle, lastClosingMeter: last.closingMeter, lastClosingDay: operation.businessDate };
  });
}

export function closingInput(record: NozzleReadingRecord): string {
  if (record.closingAccepted) return String(record.closingMeter);
  if (record.closingEntered === false) return '';
  if (!Number.isFinite(record.closingMeter)) return '';
  // Older drafts stored the opening as a placeholder for an empty closing.
  if (record.closingEntered === undefined && record.closingMeter === record.openingMeter) return '';
  return String(record.closingMeter);
}

export function readingId(record: Pick<NozzleReadingRecord, 'readingId' | 'nozzleId' | 'shiftId' | 'readingSequence'>, sequence = record.readingSequence || 1): string {
  return record.readingId || `legacy:${JSON.stringify([record.nozzleId, record.shiftId || 'default-shift', sequence])}`;
}

export function correctReading(record: NozzleReadingRecord, closing: number, reason: string, at: string): NozzleReadingRecord {
  if (!record.closingAccepted) throw new Error('Save this reading before correcting it.');
  if (!reason.trim()) throw new Error('Enter a correction reason.');
  if (!Number.isFinite(closing) || closing <= record.openingMeter || closing - record.openingMeter > 1000000) throw new Error('Closing meter must be greater than the opening meter.');
  const quantitySold = Math.round((closing - record.openingMeter) * 1000) / 1000;
  const salesAmount = calculateSales(quantitySold, record.rate);
  return { ...record, closingMeter: closing, quantitySold, salesAmount,
    closingAcceptanceNote: `Corrected by Manager: ${reason.trim()}`,
    corrections: [...(record.corrections || []), { at, reason: reason.trim(), previousClosing: record.closingMeter, closing, previousAmount: record.salesAmount, amount: salesAmount }] };
}

export function readingCash(record: NozzleReadingRecord, deposits: CashDeposit[]) {
  const id = readingId(record);
  return {
    received: deposits.filter(d => d.readingId === id).reduce((sum, d) => sum + d.amount, 0),
    legacy: deposits.filter(d => !d.readingId && d.nozzleId === record.nozzleId).reduce((sum, d) => sum + d.amount, 0),
  };
}
