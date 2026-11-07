// Day expense totals: the documents ledger is the single source of truth.
//
// Expenses can be entered in two places for the same day:
//   - inside Daily Operation (embedded in the operation; the store syncs each
//     one into the ledger as an EXPENSE document with data.petrolSync = 1)
//   - on the Expenses page (a standalone EXPENSE document, no petrolSync)
//
// Dashboard and History used to sum only operation.totalExpenses, so
// Expenses-page entries never showed up in day totals and Expected cash was
// overstated (issue #17). Every total below counts each ledger EXPENSE
// document exactly once: embedded ones through the operation, standalone
// ones through the ledger. A synced document is never counted twice.
import type { DailyOperation, Expense } from '../types';
import { calculateExpectedNet } from './calculations';

/** One row from the documents ledger (snapshot / history), as the renderer sees it. */
export interface LedgerExpenseRow {
  id: string;
  kind: string;
  day: string;
  /** Cents, as stored in the documents ledger (250000 = Rs. 2,500). */
  amount: number;
  reversed?: number | boolean;
  data?: { petrolSync?: number | boolean; note?: string } | null;
}

/** A standalone Expenses-page entry, in rupees. */
export interface StandaloneExpense {
  id: string;
  day: string;
  amount: number;
  note: string;
}

/** Map one ledger row to a standalone expense, or null when it is not one:
 *  not an EXPENSE, reversed, or synced from an operation (already counted
 *  through that operation's total). */
export function toStandaloneExpense(
  row: LedgerExpenseRow | null | undefined,
): StandaloneExpense | null {
  if (!row || row.kind !== 'EXPENSE') return null;
  if (row.reversed) return null;
  if (row.data?.petrolSync) return null;
  const amount = Math.round(Number(row.amount) || 0) / 100;
  if (!(amount > 0)) return null;
  return {
    id: String(row.id),
    day: String(row.day),
    amount,
    note: String(row.data?.note || ''),
  };
}

export function standaloneExpensesFromRows(
  rows: LedgerExpenseRow[] | null | undefined,
): StandaloneExpense[] {
  if (!Array.isArray(rows)) return [];
  const out: StandaloneExpense[] = [];
  for (const row of rows) {
    const expense = toStandaloneExpense(row);
    if (expense) out.push(expense);
  }
  return out;
}

export function standaloneTotalForDay(
  list: StandaloneExpense[] | null | undefined,
  day: string,
): number {
  if (!Array.isArray(list)) return 0;
  const total = list
    .filter((e) => e.day === day)
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  return Math.round(total * 100) / 100;
}

/** Total for one ledger kind from a snapshot `summary` (rows of
 *  {kind, amount}, amounts in cents, already non-reversed). Used for the
 *  Dashboard's "Credit given": the operation's cached udhaarTotal goes stale
 *  in-session when credit is added on another tab, but the ledger never does. */
export function summaryTotalForKind(
  summary: Array<{ kind: string; amount: number }> | null | undefined,
  kind: string,
): number {
  if (!Array.isArray(summary)) return 0;
  const row = summary.find((r) => r.kind === kind);
  return Math.round(Number(row?.amount) || 0) / 100;
}

/** Full day expense total: operation-embedded plus standalone ledger entries. */
export function dayExpenseTotal(
  operationTotalExpenses: number | null | undefined,
  list: StandaloneExpense[] | null | undefined,
  day: string,
): number {
  const embedded = Number(operationTotalExpenses) || 0;
  return Math.round((embedded + standaloneTotalForDay(list, day)) * 100) / 100;
}

/** A copy of an operation whose expenses list, total and expected net include
 *  the standalone ledger expenses for its day. The original is untouched.
 *  The copy is for display only (Dashboard / History / print) — never save
 *  it back as an operation. */
export function operationWithLedgerExpenses(
  operation: DailyOperation,
  list: StandaloneExpense[] | null | undefined,
): DailyOperation {
  const extra: Expense[] = (Array.isArray(list) ? list : [])
    .filter((e) => e.day === operation.businessDate)
    .map((e) => ({
      id: `ledger-${e.id}`,
      description: e.note || 'Expense',
      category: 'Other' as const,
      amount: e.amount,
      dateTime: `${operation.businessDate}T00:00:00`,
    }));
  const totalExpenses = dayExpenseTotal(
    operation.totalExpenses,
    list,
    operation.businessDate,
  );
  return {
    ...operation,
    expenses: [...(operation.expenses || []), ...extra],
    totalExpenses,
    expectedNet: calculateExpectedNet(
      operation.grossSales,
      totalExpenses,
      operation.udhaarTotal || 0,
    ),
  };
}
