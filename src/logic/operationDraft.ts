// Pure daily-operation math: meter chains, reading calculations and the
// saveable operation draft. Kept separate from the screen component so the
// money logic can be tested without rendering React (and without CSS).
import type {
  StationConfig,
  Pump,
  Nozzle,
  Employee,
  Expense,
  DailyOperation,
  NozzleReadingRecord,
  CashDeposit,
} from '../types';
import { readingId, collectedExpenseTotal } from './readingLedger';
import {
  calculateQuantitySold,
  calculateSales,
  calculateGrossSales,
  calculateTotalExpenses,
  calculateExpectedNet,
  calculateVariance,
  getReconciliationStatus,
} from './calculations';

export interface NozzleFormRow {
  readingId?: string;
  savedRecord?: NozzleReadingRecord;
  nozzleId: string;
  pumpId: string;
  shiftId: string;
  shiftNameSnapshot: string;
  readingSequence: number;
  /** Global meter order, assigned when ACCEPTED. 0 = pending (not yet ordered).
   * readingSequence is shift-wise for display; meterOrder is the chain order. */
  meterOrder: number;
  readingTime?: string;
  employeeId: string;
  openingMeter: number;
  closingMeterStr: string;
  cashReceivedStr?: string;
  overrideNote?: string;
  closingAccepted: boolean;
  closingAcceptedAt?: string;
  closingAcceptanceNote?: string;
  error?: string;
}

export function buildDefaultShiftRows(activeNozzles: Nozzle[], station: StationConfig): NozzleFormRow[] {
  const activeShifts = [...(station.shifts || [])]
    .filter((s) => s.isActive)
    .sort((a, b) => a.order - b.order);
  // Use all active shifts for fresh rows (shift management is now available).
  const shiftsToUse =
    activeShifts.length > 0
      ? activeShifts
      : [{ id: 'default-shift', name: 'Shift 1', order: 1, isActive: true }];

  const rows: NozzleFormRow[] = [];
  activeNozzles.forEach((n) => {
    shiftsToUse.forEach((shift) => {
      const assignment = (station.shiftAssignments || []).find(
        (a) => a.nozzleId === n.id && a.shiftId === shift.id
      );
      rows.push({
        nozzleId: n.id,
        pumpId: n.pumpId,
        shiftId: shift.id,
        shiftNameSnapshot: shift.name,
        readingSequence: 1,
        meterOrder: 0, // assigned below per nozzle
        employeeId: assignment?.employeeId || '',
        openingMeter: n.lastClosingMeter,
        closingMeterStr: '',
        cashReceivedStr: '',
        closingAccepted: false,
      });
    });
  });
  return assignMeterOrder(rows);
}

/**
 * Assigns a continuous global meter order per nozzle across all shifts.
 * Display numbering (readingSequence) restarts per shift, but the physical
 * meter is continuous, so chain validation needs a global order.
 * Sorts by accepted/reading time, then shift order is preserved via sequence.
 */
/**
 * Assigns meterOrder to ACCEPTED readings based on meter continuity.
 * Pending rows get meterOrder = 0 (not yet ordered; assigned on accept).
 *
 * For old data: reconstructs the chain by linking opening == closing.
 * Falls back to time order if the chain can't be reconstructed.
 * Validates: if existing meterOrder produces a valid chain, keeps it.
 */
export function assignMeterOrder(rows: NozzleFormRow[]): NozzleFormRow[] {
  rows = rows.map(row => ({ ...row, readingId: row.readingId || crypto.randomUUID() }));
  const byNozzle = new Map<string, number[]>();
  rows.forEach((r, idx) => {
    const list = byNozzle.get(r.nozzleId) || [];
    list.push(idx);
    byNozzle.set(r.nozzleId, list);
  });

  const result = [...rows];

  byNozzle.forEach((indices) => {
    // Pending rows: meterOrder = 0 (assigned when accepted)
    indices.forEach((idx) => {
      if (!result[idx].closingAccepted) {
        result[idx] = { ...result[idx], meterOrder: 0 };
      }
    });

    // Accepted readings: determine order
    const acceptedIdx = indices.filter((idx) => result[idx].closingAccepted);
    if (acceptedIdx.length === 0) return;

    // Check if existing meterOrder forms a valid chain
    const withOrder = acceptedIdx.filter((idx) => (result[idx].meterOrder || 0) > 0);
    if (withOrder.length === acceptedIdx.length) {
      const sorted = [...withOrder].sort((a, b) => (result[a].meterOrder || 0) - (result[b].meterOrder || 0));
      let valid = true;
      for (let i = 1; i < sorted.length; i++) {
        const prev = result[sorted[i - 1]];
        const curr = result[sorted[i]];
        const prevClosing = prev.closingMeterStr.trim() !== '' ? Number(prev.closingMeterStr) : prev.openingMeter;
        if (Math.abs(curr.openingMeter - prevClosing) > 0.001) {
          // Allow meter reset (opening near zero)
          const isReset = curr.openingMeter < 1 && prevClosing > 1;
          if (!isReset) { valid = false; break; }
        }
      }
      if (valid) return; // Keep existing order
    }

    // Reconstruct chain by meter continuity
    const ordered = orderByMeterContinuity(acceptedIdx.map((idx) => result[idx]));
    const orderMap = new Map<string, number>();
    ordered.forEach((r, i) => {
      // Use a unique key (index in result array)
      const idx = result.indexOf(r);
      if (idx >= 0) orderMap.set(String(idx), i + 1);
    });
    acceptedIdx.forEach((idx) => {
      const order = orderMap.get(String(idx));
      if (order) {
        result[idx] = { ...result[idx], meterOrder: order };
      }
    });
  });

  return result;
}

/**
 * Orders accepted readings by meter continuity (opening == previous closing).
 * Falls back to time order for disconnected readings.
 */
export function orderByMeterContinuity(readings: NozzleFormRow[]): NozzleFormRow[] {
  if (readings.length <= 1) return readings;

  const getClosing = (r: NozzleFormRow): number => {
    const c = r.closingMeterStr.trim() !== '' ? Number(r.closingMeterStr) : r.openingMeter;
    return isNaN(c) ? r.openingMeter : c;
  };

  // Find start: reading whose opening doesn't match any other's closing
  const closings = new Set(readings.map(getClosing));
  let start = readings.find((r) => {
    return !readings.some((other) => other !== r && Math.abs(getClosing(other) - r.openingMeter) < 0.001);
  });
  if (!start) {
    // No clear start; fall back to time order
    return [...readings].sort((a, b) => {
      const ta = a.closingAcceptedAt || a.readingTime || '';
      const tb = b.closingAcceptedAt || b.readingTime || '';
      return ta.localeCompare(tb);
    });
  }

  const ordered: NozzleFormRow[] = [start];
  const used = new Set<NozzleFormRow>([start]);
  let current = start;

  while (ordered.length < readings.length) {
    const currentClosing = getClosing(current);
    const next = readings.find((r) =>
      !used.has(r) && Math.abs(r.openingMeter - currentClosing) < 0.001
    );
    if (!next) break;
    ordered.push(next);
    used.add(next);
    current = next;
  }

  // Append disconnected readings sorted by time
  const remaining = readings
    .filter((r) => !used.has(r))
    .sort((a, b) => {
      const ta = a.closingAcceptedAt || a.readingTime || '';
      const tb = b.closingAcceptedAt || b.readingTime || '';
      return ta.localeCompare(tb);
    });

  return [...ordered, ...remaining];
}

export interface CalculatedReading {
  row: NozzleFormRow;
  nozzle: Nozzle | undefined;
  pump: Pump | undefined;
  employee: Employee | undefined;
  record: NozzleReadingRecord;
  hasEnteredClosing: boolean;
  hasAcceptedClosing: boolean;
  error?: string;
}

/**
 * Pure version of the readings calculation. Used both by the on-screen
 * totals and to build a saveable draft from explicitly passed-in rows, so a
 * handler can persist BEFORE showing success (no "saved" before the database
 * confirms).
 */
export function computeCalculatedReadings(
  rows: NozzleFormRow[],
  nozzleMap: Map<string, Nozzle>,
  pumpMap: Map<string, Pump>,
  employeeMap: Map<string, Employee>,
  petrolRate: number,
  cngRate: number,
): CalculatedReading[] {
  const results: CalculatedReading[] = new Array(rows.length);

  const indicesByNozzle = new Map<string, number[]>();
  rows.forEach((row, idx) => {
    // Group by nozzle only: all readings for a nozzle form one chain
    // (Sammy's pump has no shifts; Reading 1, 2, 3... sequence).
    const key = row.nozzleId;
    const list = indicesByNozzle.get(key) || [];
    list.push(idx);
    indicesByNozzle.set(key, list);
  });

  // Sort each group's indices: accepted by meterOrder (chain order),
  // then pending rows. meterOrder = 0 means not yet accepted.
  indicesByNozzle.forEach((indices) => {
    indices.sort((a, b) => {
      const ra = rows[a];
      const rb = rows[b];
      // Accepted first, ordered by meterOrder
      if (ra.closingAccepted && rb.closingAccepted) {
        return (ra.meterOrder || 0) - (rb.meterOrder || 0);
      }
      if (ra.closingAccepted) return -1;
      if (rb.closingAccepted) return 1;
      // Both pending: by readingSequence for stable display
      return (ra.readingSequence || 0) - (rb.readingSequence || 0);
    });
  });

  indicesByNozzle.forEach((indices) => {
    let runningOpening: number | null = null;

    indices.forEach((idx, posInGroup) => {
      const row = rows[idx];
      const nozzle = nozzleMap.get(row.nozzleId);
      const pump = pumpMap.get(row.pumpId);
      const employee = employeeMap.get(row.employeeId);

      const fuelType = row.savedRecord?.fuelType || nozzle?.fuelType || 'PETROL';
      const rate = row.savedRecord?.rate ?? (fuelType === 'PETROL' ? petrolRate : cngRate);

      // Accepted readings keep their stored opening (frozen). Only pending
      // readings chain from the previous closing.
      const openingForThisShift = row.closingAccepted
        ? row.openingMeter
        : (posInGroup === 0 ? row.openingMeter : runningOpening ?? row.openingMeter);

      const closingNum = row.closingMeterStr.trim() === '' ? null : Number(row.closingMeterStr);

      let quantitySold = 0;
      let salesAmount = 0;
      let error = row.error;

      if (closingNum !== null && !isNaN(closingNum)) {
        const qtyRes = calculateQuantitySold(openingForThisShift, closingNum);
        if (qtyRes.success && typeof qtyRes.data === 'number') {
          quantitySold = row.closingAccepted ? qtyRes.data : (closingNum - openingForThisShift);
          // Guard against unreasonable values (input error or overflow).
          if (!Number.isFinite(quantitySold) || Math.abs(quantitySold) > 1000000) {
            quantitySold = 0;
            salesAmount = 0;
            error = 'Invalid meter reading.';
          } else {
            salesAmount = row.closingAccepted ? calculateSales(quantitySold, rate) : calculateSales((closingNum - openingForThisShift), rate);
            error = undefined;
          }
        } else {
          error = qtyRes.error;
        }
      }

      if (!row.closingAccepted && closingNum !== null && (!Number.isFinite(closingNum) || closingNum <= openingForThisShift)) {
        error = 'Closing meter must be greater than the opening meter.';
      }

      const finalClosing = closingNum !== null ? closingNum : openingForThisShift;

      const record: NozzleReadingRecord = {
        readingId: row.readingId,
        corrections: row.savedRecord?.corrections,
        employeeId: row.employeeId,
        employeeNameSnapshot: row.savedRecord?.employeeNameSnapshot ?? (employee ? employee.name : 'Unassigned'),
        pumpId: row.pumpId,
        pumpNameSnapshot: row.savedRecord?.pumpNameSnapshot ?? (pump ? pump.name : 'Pump'),
        nozzleId: row.nozzleId,
        nozzleNameSnapshot: row.savedRecord?.nozzleNameSnapshot ?? (nozzle ? nozzle.name : 'Nozzle'),
        shiftId: row.shiftId,
        shiftNameSnapshot: row.shiftNameSnapshot,
        readingSequence: row.readingSequence,
        meterOrder: row.meterOrder,
        readingTime: row.readingTime,
        cashReceived: row.cashReceivedStr && row.cashReceivedStr.trim() !== '' ? Number(row.cashReceivedStr) : undefined,
        fuelType,
        openingMeter: openingForThisShift,
        closingMeter: finalClosing,
        closingEntered: closingNum !== null,
        quantitySold: row.closingAccepted ? quantitySold : Math.max(0, finalClosing - openingForThisShift),
        rate,
        salesAmount,
        closingAccepted: row.closingAccepted,
        closingAcceptedAt: row.closingAcceptedAt,
        closingAcceptanceNote: row.closingAcceptanceNote,
        // Accepted sales are snapshots. Master/rate changes must not rewrite them.
        ...(row.closingAccepted && row.savedRecord ? row.savedRecord : {}),
      };

      results[idx] = {
        row: { ...row, openingMeter: openingForThisShift },
        nozzle,
        pump,
        employee,
        record,
        hasEnteredClosing: closingNum !== null,
        hasAcceptedClosing: row.closingAccepted,
        error,
      };

      runningOpening = row.closingAccepted ? finalClosing : openingForThisShift;
    });
  });

  return results;
}

/**
 * Builds the exact DailyOperation the autosave would persist, from explicitly
 * passed-in rows/expenses/deposits. Handlers use this to save FIRST and only
 * show success after the database confirms.
 */
export function buildOperationDraft(args: {
  operationId: string;
  businessDate: string;
  cycleNumber: number;
  startTime: string;
  petrolRate: number;
  cngRate: number;
  rows: NozzleFormRow[];
  expenses: Expense[];
  cashDeposits: CashDeposit[];
  closingNotes: string;
  lastEditReason?: string;
  nozzleMap: Map<string, Nozzle>;
  pumpMap: Map<string, Pump>;
  employeeMap: Map<string, Employee>;
  /** FIX: Credit total for expected cash (sale - udhaar - expenses). */
  udhaarTotal?: number;
  /** v71: Preserve counted cash across draft saves. */
  countedCash?: number | null;
}): DailyOperation {
  const readings = computeCalculatedReadings(
    args.rows,
    args.nozzleMap,
    args.pumpMap,
    args.employeeMap,
    args.petrolRate,
    args.cngRate,
  );
  const records = readings.map((r) => r.record);
  // Keep pending input in the draft, but only confirmed sales affect accounts.
  const acceptedRecords = records.filter((r) => r.closingAccepted === true);
  const grossSales = calculateGrossSales(acceptedRecords);
  const totalQuantity = acceptedRecords.reduce((sum, r) => sum + r.quantitySold, 0);
  const totalExpenses = calculateTotalExpenses(args.expenses);
  // All expenses reduce expected cash, including legacy manager-paid entries.
  // The collected portion also reduces actual cash, exactly once.
  const cashExpenses = (args.expenses || [])
    .reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const expectedNet = calculateExpectedNet(grossSales, cashExpenses, args.udhaarTotal || 0);
  const actualCollection =
    args.cashDeposits.length === 0
      ? (expectedNet === 0 ? 0 : null)
      : Math.round((args.cashDeposits.reduce((sum, d) => sum + d.amount, 0) - collectedExpenseTotal(args.expenses)) * 100) / 100;
  const variance = calculateVariance(actualCollection, expectedNet);
  const reconciliation = getReconciliationStatus(variance, actualCollection);
  return {
    id: args.operationId,
    businessDate: args.businessDate,
    cycleNumber: args.cycleNumber,
    startTime: args.startTime,
    status: 'OPEN',
    rates: { PETROL: args.petrolRate, CNG: args.cngRate },
    nozzleReadings: records,
    expenses: args.expenses,
    cashDeposits: args.cashDeposits,
    grossSales,
    totalQuantity,
    totalExpenses,
    expectedNet,
    udhaarTotal: args.udhaarTotal || 0,
    actualCollection,
    variance,
    reconciliationStatus: reconciliation.status,
    reconciliationText: reconciliation.text,
    notes: args.closingNotes.trim() || undefined,
    lastEditReason: args.lastEditReason,
    // v71: Preserve counted cash (saved from Dashboard) across draft/final saves.
    countedCash: args.countedCash ?? null,
  };
}
