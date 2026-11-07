// Regression test for issue #17: expenses entered on the Expenses page were
// missing from Dashboard and History day totals (only operation-embedded
// expenses were counted), so Expected cash was overstated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  standaloneExpensesFromRows,
  standaloneTotalForDay,
  dayExpenseTotal,
  operationWithLedgerExpenses,
  summaryTotalForKind,
  type LedgerExpenseRow,
} from '../src/logic/dayTotals';
import type { DailyOperation } from '../src/types';

const expenseRow = (over: Record<string, unknown> = {}): LedgerExpenseRow => ({
  id: String(over.id ?? 'e1'),
  kind: String(over.kind ?? 'EXPENSE'),
  day: String(over.day ?? '2026-11-07'),
  amount: Number(over.amount ?? 250000),
  reversed: (over.reversed as number | undefined) ?? 0,
  data: (over.data ?? { note: 'Electricity bill' }) as {
    petrolSync?: number;
    note?: string;
  },
});

// Only the fields the totals touch; the rest is cast away.
const operation = (over: Record<string, unknown> = {}) =>
  ({
    id: 'op-1',
    businessDate: '2026-11-07',
    expenses: (over.expenses ?? []) as DailyOperation['expenses'],
    grossSales: Number(over.grossSales ?? 91445),
    totalExpenses: Number(over.totalExpenses ?? 800),
    udhaarTotal: Number(over.udhaarTotal ?? 10000),
    expectedNet: 0,
  }) as unknown as DailyOperation;

test('issue #17 repro: Expenses-page Rs. 2,500 + operation Rs. 800 = Rs. 3,300', () => {
  const standalone = standaloneExpensesFromRows([expenseRow()]);
  assert.equal(standalone.length, 1);
  assert.equal(standalone[0].amount, 2500);
  assert.equal(dayExpenseTotal(800, standalone, '2026-11-07'), 3300);
});

test('demo case: operation Rs. 3,300 + standalone Rs. 3,300 = Rs. 6,600', () => {
  const standalone = standaloneExpensesFromRows([
    expenseRow({ id: 'e1', amount: 250000 }),
    expenseRow({ id: 'e2', amount: 80000, data: { note: 'Cleaning' } }),
  ]);
  assert.equal(dayExpenseTotal(3300, standalone, '2026-11-07'), 6600);
});

test('synced operation expenses are not counted again', () => {
  const standalone = standaloneExpensesFromRows([
    expenseRow({ id: 's1', amount: 250000, data: { petrolSync: 1, note: 'Electricity bill' } }),
    expenseRow({ id: 's2', amount: 80000, data: { petrolSync: 1, note: 'Cleaning' } }),
  ]);
  assert.equal(standalone.length, 0);
  assert.equal(dayExpenseTotal(3300, standalone, '2026-11-07'), 3300);
});

test('reversed and non-expense rows are ignored', () => {
  const standalone = standaloneExpensesFromRows([
    expenseRow({ id: 'r1', amount: 250000, reversed: 1 }),
    expenseRow({ id: 'c1', kind: 'CREDIT', amount: 500000, data: {} }),
    expenseRow({ id: 'e3', amount: 100000, day: '2026-11-06' }),
  ]);
  assert.equal(standalone.length, 1);
  assert.equal(standaloneTotalForDay(standalone, '2026-11-07'), 0);
  assert.equal(standaloneTotalForDay(standalone, '2026-11-06'), 1000);
});

test('operation copy adds standalone expenses and recomputes totals', () => {
  const op = operation();
  const standalone = standaloneExpensesFromRows([
    expenseRow({ id: 'e1', amount: 250000 }),
    expenseRow({ id: 'e2', amount: 80000, data: { note: 'Cleaning' } }),
  ]);
  const fixed = operationWithLedgerExpenses(op, standalone);
  assert.equal(fixed.totalExpenses, 4100);
  // 91,445 sales - 4,100 expenses - 10,000 credit = 77,345 expected cash.
  assert.equal(fixed.expectedNet, 77345);
  assert.equal(fixed.expenses.length, 2);
  assert.equal(fixed.expenses[0].description, 'Electricity bill');
  // Original untouched.
  assert.equal(op.totalExpenses, 800);
  assert.equal(op.expenses.length, 0);
});

test('empty or missing input never breaks the totals', () => {
  assert.equal(dayExpenseTotal(undefined, undefined, '2026-11-07'), 0);
  assert.equal(standaloneTotalForDay(null, '2026-11-07'), 0);
  assert.deepEqual(standaloneExpensesFromRows(undefined), []);
});

test('ledger summary gives today\'s credit in rupees (cents to rupees)', () => {
  assert.equal(
    summaryTotalForKind(
      [
        { kind: 'CREDIT', amount: 1000000 },
        { kind: 'PAYMENT', amount: 100000 },
      ],
      'CREDIT',
    ),
    10000,
  );
  assert.equal(summaryTotalForKind([], 'CREDIT'), 0);
  assert.equal(summaryTotalForKind(undefined, 'CREDIT'), 0);
});
