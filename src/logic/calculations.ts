import { NozzleReadingRecord, Expense, ReconciliationStatusType } from '../types';

export interface CalculationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Calculates fuel quantity sold from opening and closing meters.
 * Validates that closing meter cannot be less than opening meter.
 */
export function calculateQuantitySold(
  opening: number,
  closing: number
): CalculationResult<number> {
  if (typeof opening !== 'number' || isNaN(opening)) {
    return { success: false, error: 'Invalid opening meter reading' };
  }
  if (typeof closing !== 'number' || isNaN(closing)) {
    return { success: false, error: 'Invalid closing meter reading' };
  }
  if (opening < 0 || closing < 0) {
    return { success: false, error: 'Meter readings cannot be negative' };
  }
  if (closing < opening) {
    return {
      success: false,
      error: `Closing meter (${closing}) cannot be less than opening meter (${opening})`,
    };
  }

  // Round to 3 decimal places to prevent floating-point anomalies
  const quantity = Math.round((closing - opening) * 1000) / 1000;
  return { success: true, data: quantity };
}

/**
 * Calculates fuel sales amount: Quantity Sold × Today's Rate
 */
export function calculateSales(quantity: number, rate: number): number {
  if (quantity <= 0 || rate <= 0 || isNaN(quantity) || isNaN(rate)) {
    return 0;
  }
  // Standard arithmetic rounding to 2 decimal places (cents/paisa) or nearest integer
  return Math.round(quantity * rate * 100) / 100;
}

/**
 * Calculates Gross Fuel Sales by summing all nozzle reading sales amounts.
 * Gross Fuel Sales = Petrol Sales + CNG Sales
 */
export function calculateGrossSales(
  readings: Array<Pick<NozzleReadingRecord, 'salesAmount'>>
): number {
  if (!Array.isArray(readings)) return 0;
  const total = readings.reduce((sum, r) => sum + (Number(r.salesAmount) || 0), 0);
  return Math.round(total * 100) / 100;
}

/**
 * Calculates total operational expenses.
 */
export function calculateTotalExpenses(
  expenses: Array<Pick<Expense, 'amount'>>
): number {
  if (!Array.isArray(expenses)) return 0;
  const total = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  return Math.round(total * 100) / 100;
}

/**
 * Expected Net to Bank = Gross Fuel Sales - Total Expenses
 */
export function calculateExpectedNet(grossSales: number, totalExpenses: number, udhaarTotal: number = 0): number {
  const gross = Number(grossSales) || 0;
  const expenses = Number(totalExpenses) || 0;
  const udhaar = Number(udhaarTotal) || 0;
  return Math.round((gross - udhaar - expenses) * 100) / 100;
}

/**
 * Variance = Actual Collection - Expected Net to Bank.
 * Returns null if actual collection has not been provided.
 */
export function calculateVariance(
  actualCollection: number | null | undefined,
  expectedNet: number
): number | null {
  if (
    actualCollection === null ||
    actualCollection === undefined ||
    isNaN(actualCollection) ||
    typeof actualCollection !== 'number'
  ) {
    return null;
  }
  return Math.round((actualCollection - expectedNet) * 100) / 100;
}

/**
 * Determines reconciliation status and human-readable text based on variance.
 * If actual collection is empty/null, returns PENDING without false shortage.
 */
export function getReconciliationStatus(
  variance: number | null,
  actualCollection: number | null | undefined
): { status: ReconciliationStatusType; text: string } {
  if (
    actualCollection === null ||
    actualCollection === undefined ||
    isNaN(actualCollection) ||
    typeof actualCollection !== 'number' ||
    variance === null
  ) {
    return { status: 'PENDING', text: 'PENDING' };
  }

  // Tolerance check for precision
  if (Math.abs(variance) < 0.001) {
    return { status: 'BALANCED', text: 'BALANCED' };
  }

  if (variance < 0) {
    const shortAmount = Math.abs(variance);
    return {
      status: 'SHORT',
      text: `SHORT BY ${formatCurrencyAmount(shortAmount)}`,
    };
  }

  return {
    status: 'EXCESS',
    text: `EXCESS BY ${formatCurrencyAmount(variance)}`,
  };
}

/**
 * Formats a clean currency amount in Pakistani Rupees format (e.g. Rs. 278.00, Rs. 500, -Rs. 500.00).
 */
export function formatCurrencyAmount(amount: number, forceDecimals = false): string {
  if (isNaN(amount)) return 'Rs. 0';
  const isNegative = amount < 0;
  const absAmount = Math.abs(amount);
  
  const hasFractions = absAmount % 1 !== 0 || forceDecimals;
  const formattedNum = absAmount.toLocaleString('en-US', {
    minimumFractionDigits: hasFractions ? 2 : 0,
    maximumFractionDigits: 2,
  });

  return isNegative ? `-Rs. ${formattedNum}` : `Rs. ${formattedNum}`;
}

/**
 * Formats full standard currency with two decimal places (e.g. Rs. 125,500.00)
 */
export function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || isNaN(amount)) {
    return 'Rs. 0.00';
  }
  const isNegative = amount < 0;
  const absAmount = Math.abs(amount);
  const formattedNum = absAmount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return isNegative ? `-Rs. ${formattedNum}` : `Rs. ${formattedNum}`;
}

/**
 * Meter Continuity:
 * Today's Opening Meter = Previous Closing Meter for a nozzle.
 */
export function getNextOpeningMeter(lastClosingMeter: number): number {
  return typeof lastClosingMeter === 'number' && !isNaN(lastClosingMeter)
    ? lastClosingMeter
    : 0;
}

export interface CumulativeTotalsResult {
  count: number;
  grossSales: number;
  totalExpenses: number;
  expectedNet: number;
  actualCollection: number;
  actualEnteredCount: number;
  totalVariance: number;
  totalPetrolQuantity: number;
  totalPetrolSales: number;
  totalCngQuantity: number;
  totalCngSales: number;
}

/**
 * Calculates cumulative totals strictly from CLOSED daily operation records.
 * Open or unfinished operations are excluded from permanent historical totals.
 */
export function calculateCumulativeClosedTotals(
  operations: Array<{
    status?: string;
    grossSales?: number;
    totalExpenses?: number;
    expectedNet?: number;
    actualCollection?: number | null;
    variance?: number | null;
    manualSummary?: { fuel: Partial<Record<string, { quantity: number; amount: number }>> };
    nozzleReadings?: Array<{
      fuelType?: string;
      quantitySold?: number;
      salesAmount?: number;
    }>;
  }>
): CumulativeTotalsResult {
  let grossSales = 0;
  let totalExpenses = 0;
  let expectedNet = 0;
  let actualCollection = 0;
  let actualEnteredCount = 0;
  let totalVariance = 0;
  let totalPetrolQuantity = 0;
  let totalPetrolSales = 0;
  let totalCngQuantity = 0;
  let totalCngSales = 0;

  // Filter ONLY closed operations
  const closedOps = (operations || []).filter((op) => op.status === 'CLOSED');

  closedOps.forEach((op) => {
    grossSales += op.grossSales || 0;
    totalPetrolQuantity += Number(op.manualSummary?.fuel?.PETROL?.quantity || 0);
    totalPetrolSales += Number(op.manualSummary?.fuel?.PETROL?.amount || 0);
    totalCngQuantity += Number(op.manualSummary?.fuel?.CNG?.quantity || 0);
    totalCngSales += Number(op.manualSummary?.fuel?.CNG?.amount || 0);
    totalExpenses += op.totalExpenses || 0;
    expectedNet += op.expectedNet || 0;

    if (typeof op.actualCollection === 'number' && !isNaN(op.actualCollection)) {
      actualCollection += op.actualCollection;
      actualEnteredCount++;
    }
    if (typeof op.variance === 'number' && !isNaN(op.variance)) {
      totalVariance += op.variance;
    }

    op.nozzleReadings?.forEach((r) => {
      if (r.fuelType === 'PETROL') {
        totalPetrolQuantity += r.quantitySold || 0;
        totalPetrolSales += r.salesAmount || 0;
      } else if (r.fuelType === 'CNG') {
        totalCngQuantity += r.quantitySold || 0;
        totalCngSales += r.salesAmount || 0;
      }
    });
  });

  return {
    count: closedOps.length,
    grossSales: Math.round(grossSales * 100) / 100,
    totalExpenses: Math.round(totalExpenses * 100) / 100,
    expectedNet: Math.round(expectedNet * 100) / 100,
    actualCollection: Math.round(actualCollection * 100) / 100,
    actualEnteredCount,
    totalVariance: Math.round(totalVariance * 100) / 100,
    totalPetrolQuantity: Math.round(totalPetrolQuantity * 100) / 100,
    totalPetrolSales: Math.round(totalPetrolSales * 100) / 100,
    totalCngQuantity: Math.round(totalCngQuantity * 100) / 100,
    totalCngSales: Math.round(totalCngSales * 100) / 100,
  };
}

/**
 * Returns the current business date in Pakistan timezone (Asia/Karachi, UTC+5) in YYYY-MM-DD format.
 * Uses Intl DateTimeFormat with Asia/Karachi or UTC+5 calculation fallback.
 */
export function getPakistanLocalDate(date: Date = new Date()): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Karachi',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(date);
  } catch {
    const pkOffsetMs = 5 * 60 * 60 * 1000;
    const pkTime = new Date(date.getTime() + pkOffsetMs);
    return pkTime.toISOString().split('T')[0];
  }
}

/**
 * Formats a YYYY-MM-DD date string into a professional display format e.g. "01 Sep 2026".
 */
export function formatBusinessDateDisplay(dateStr: string): string {
  if (!dateStr) return '-';
  try {
    const parts = dateStr.split('-').map(Number);
    if (parts.length !== 3 || isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2])) {
      return dateStr;
    }
    const [year, month, day] = parts;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dStr = String(day).padStart(2, '0');
    const mStr = months[month - 1] || String(month).padStart(2, '0');
    return `${dStr} ${mStr} ${year}`;
  } catch {
    return dateStr;
  }
}
