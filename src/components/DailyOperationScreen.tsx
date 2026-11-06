import { useState, useMemo, useEffect, useRef, FormEvent } from 'react';
import '../styles/daily-operation.css';
import {
  StationConfig,
  StationConfigUpdate,
  Pump,
  Nozzle,
  Employee,
  Expense,
  ExpenseCategory,
  DailyOperation,
  NozzleReadingRecord,
  OperationStatus,
  CashDeposit,
  FuelStockDayRecord,
} from '../types';
import { readingId, correctReading, readingCash, closingInput, collectedExpenseTotal, expenseFromCollectedCash, remainingCashForReading } from '../logic/readingLedger';
import { calculateFuelStock } from '../logic/fuelStock';
import {
  calculateQuantitySold,
  calculateSales,
  calculateGrossSales,
  calculateTotalExpenses,
  calculateExpectedNet,
  calculateVariance,
  getReconciliationStatus,
  formatCurrency,
  getPakistanLocalDate,
  formatBusinessDateDisplay,
} from '../logic/calculations';
import { EXPENSE_CATEGORIES } from '../types';
import { PrintDailySheetModal } from './PrintDailySheetModal';
import { CannotCloseDayModal, MissingRequirementItem } from './CannotCloseDayModal';
import {
  Plus,
  CheckCircle2,
  AlertCircle,
  Lock,
  Fuel,
  CalendarDays,
  Flame,
  Coins,
  Receipt,
  AlertTriangle,
  Edit3,
  ChevronDown,
  Clock,
  Trash2,
} from 'lucide-react';

import { saveErrorText, type SaveResult } from '../logic/saveResult';

interface DailyOperationScreenProps {
  station: StationConfig;
  pumps: Pump[];
  nozzles: Nozzle[];
  employees: Employee[];
  /** Fuel customers (from masters) for Udhaar entries. */
  customers?: { id: string; name: string; active?: boolean }[];
  /** Whether current user has FUEL "credit" permission (Owner grants). */
  canGiveUdhaar?: boolean;
  /** Save an credit entry: customerId, amount (Rs), note. */
  onAddUdhaar?: (customerId: string, amount: number, note: string, businessDate?: string) => Promise<SaveResult>;
  /** Get total udhaar for a business day (for expected cash). Returns null if unknown. */
  onGetUdhaarTotal?: (businessDate?: string) => Promise<number | null>;
  activeOperationToEdit?: DailyOperation | null;
  onSaveOperation: (operation: DailyOperation) => Promise<SaveResult>;
  onUpdateStationConfig?: (update: StationConfigUpdate) => Promise<SaveResult>;
  onClearActiveEdit?: () => void;
  /** All saved days, used for stock availability checks. */
  existingOperations?: DailyOperation[];
  /** Starts the screen fresh for the new calendar date after the previous day is closed. */
  onStartNewDay?: () => void;
  /** Fuel stock records for stock availability check before accepting readings. */
  stockRecords?: FuelStockDayRecord[];
}

import {
  buildDefaultShiftRows,
  assignMeterOrder,
  computeCalculatedReadings,
  buildOperationDraft,
} from '../logic/operationDraft';
import type { NozzleFormRow } from '../logic/operationDraft';

export function DailyOperationScreen({
  station,
  pumps,
  nozzles,
  employees,
  customers = [],
  canGiveUdhaar = false,
  onAddUdhaar,
  onGetUdhaarTotal,
  activeOperationToEdit,
  onSaveOperation,
  onUpdateStationConfig,
  onClearActiveEdit,
  existingOperations = [],
  onStartNewDay,
  stockRecords = [],
}: DailyOperationScreenProps) {
  const activeNozzles = useMemo(() => nozzles.filter((n) => n.isActive), [nozzles]);

  const [operationStatus, setOperationStatus] = useState<OperationStatus>(() => {
    return activeOperationToEdit?.status || 'OPEN';
  });

  const [businessDate, setBusinessDate] = useState(() => {
    if (activeOperationToEdit) return activeOperationToEdit.businessDate;
    return getPakistanLocalDate();
  });

  const [petrolRate, setPetrolRate] = useState(() => {
    return activeOperationToEdit?.rates?.PETROL ?? station.rates?.PETROL ?? 0;
  });
  const [cngRate, setCngRate] = useState(() => {
    return activeOperationToEdit?.rates?.CNG ?? station.rates?.CNG ?? 0;
  });

  const [rows, setRows] = useState<NozzleFormRow[]>(() => {
    if (activeOperationToEdit) {
      // Group by nozzle+shift to assign proper reading sequences for old data.
      // Keep saved rows and their legacy sequence positions intact. Inactive
      // pending rows are hidden by the display filter, never removed on load.
      const seqCounter = new Map<string, number>();
      const loadedRows = activeOperationToEdit.nozzleReadings
        .map((r) => {
        const key = `${r.nozzleId}|${r.shiftId || 'default-shift'}`;
        const existingSeq = (r as any).readingSequence;
        let seq: number;
        if (existingSeq && existingSeq > 0) {
          seq = existingSeq;
          seqCounter.set(key, Math.max(seqCounter.get(key) || 0, seq));
        } else {
          seq = (seqCounter.get(key) || 0) + 1;
          seqCounter.set(key, seq);
        }
        return {
          readingId: readingId(r, seq),
          savedRecord: r.closingAccepted ? { ...r, readingId: readingId(r, seq) } : undefined,
          nozzleId: r.nozzleId,
          pumpId: r.pumpId,
          shiftId: r.shiftId || 'default-shift',
          shiftNameSnapshot: r.shiftNameSnapshot || 'Shift 1',
          readingSequence: seq,
          meterOrder: (r as any).meterOrder || 0, // assigned below
          readingTime: (r as any).readingTime,
          employeeId: r.employeeId,
          openingMeter: r.openingMeter,
          // v64: preserve explicitly entered closing even when it equals opening
          // (legitimate 0L test reading). Only treat non-numeric as "no entry".
          // (TS-clean: closingMeter is typed number; guard the runtime value.)
          closingMeterStr: closingInput(r),
          cashReceivedStr: (r as any).cashReceived !== undefined ? String((r as any).cashReceived) : '',
          closingAccepted: !!r.closingAccepted,
          closingAcceptedAt: r.closingAcceptedAt,
          closingAcceptanceNote: r.closingAcceptanceNote,
        };
      });
      return assignMeterOrder(loadedRows);
    }
    return buildDefaultShiftRows(activeNozzles, station);
  });

  const [expenses, setExpenses] = useState<Expense[]>(() => {
    if (activeOperationToEdit?.expenses) return activeOperationToEdit.expenses;
    return [];
  });

  const [newExpenseDesc, setNewExpenseDesc] = useState('');
  const [newExpenseCat, setNewExpenseCat] = useState<ExpenseCategory>('Tea/Food');
  const [newExpenseAmount, setNewExpenseAmount] = useState('');
  const [newExpenseNote, setNewExpenseNote] = useState('');

  const [cashDeposits, setCashDeposits] = useState<CashDeposit[]>(() => activeOperationToEdit?.cashDeposits || []);
  // v64: nozzle-based cash handover.
  const [depositFuelType, setDepositFuelType] = useState<'PETROL' | 'CNG'>('PETROL');
  const [depositNozzleId, setDepositNozzleId] = useState('');
  const [depositReadingId, setDepositReadingId] = useState('');
  const [newDepositAmountStr, setNewDepositAmountStr] = useState('');
  const [newDepositNote, setNewDepositNote] = useState('');
  const [depositError, setDepositError] = useState<string | null>(null);
  const [showCashModal, setShowCashModal] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showUdhaarModal, setShowUdhaarModal] = useState(false);
  const [udhaarCustomer, setUdhaarCustomer] = useState('');
  const [udhaarAmount, setUdhaarAmount] = useState('');
  const [udhaarNote, setUdhaarNote] = useState('');
  const [udhaarSaving, setUdhaarSaving] = useState(false);
  const [udhaarError, setUdhaarError] = useState('');
  // FIX 2: Track total udhaar for the day (for expected cash calculation).
  // null = unknown (not yet loaded, or fetch failed). Never assume 0 initially -
  // an autosave before the first fetch would otherwise save wrong expected cash.
  const [udhaarTotal, setUdhaarTotal] = useState<number | null>(null);
  const [udhaarLoading, setUdhaarLoading] = useState(false);
  const [udhaarFetchError, setUdhaarFetchError] = useState(false);

  const fetchUdhaarTotal = async (day: string) => {
    if (!onGetUdhaarTotal) return;
    setUdhaarLoading(true);
    setUdhaarFetchError(false);
    setUdhaarTotal(null);
    try {
      const total = await onGetUdhaarTotal(day);
      setUdhaarTotal(total);
      setUdhaarFetchError(total === null);
    } catch {
      setUdhaarTotal(null);
      setUdhaarFetchError(true);
    } finally {
      setUdhaarLoading(false);
    }
  };

  // Fetch credit total when business date changes.
  useEffect(() => {
    let cancelled = false;
    if (onGetUdhaarTotal) {
      setUdhaarLoading(true);
      setUdhaarFetchError(false);
      setUdhaarTotal(null);
      onGetUdhaarTotal(businessDate).then((total) => {
        if (cancelled) return;
        setUdhaarTotal(total);
        setUdhaarFetchError(total === null);
        setUdhaarLoading(false);
      }).catch(() => {
        if (cancelled) return;
        setUdhaarTotal(null);
        setUdhaarFetchError(true);
        setUdhaarLoading(false);
      });
    }
    return () => { cancelled = true; };
  }, [businessDate, onGetUdhaarTotal]);

  const retryUdhaarFetch = () => fetchUdhaarTotal(businessDate);

  // Guard: block saves while credit total is unknown (would save wrong expected cash).
  const udhaarReady = udhaarTotal !== null;

  const handleAddUdhaarSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (udhaarSaving || !onAddUdhaar) return;
    setUdhaarError('');
    const amount = Number(udhaarAmount);
    if (!udhaarCustomer) { setUdhaarError('Select a customer.'); return; }
    if (!Number.isFinite(amount) || amount <= 0) { setUdhaarError('Enter a valid amount.'); return; }
    setUdhaarSaving(true);
    try {
      const result = await onAddUdhaar(udhaarCustomer, amount, udhaarNote.trim(), businessDate);
      if (!result.ok) { setUdhaarError(result.error || 'Credit save failed.'); return; }
      setShowUdhaarModal(false);
      setUdhaarCustomer('');
      setUdhaarAmount('');
      setUdhaarNote('');
      // Refresh credit total after adding.
      fetchUdhaarTotal(businessDate);
    } finally {
      setUdhaarSaving(false);
    }
  };

  const [closingNotes, setClosingNotes] = useState(() => activeOperationToEdit?.notes || '');
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string; action?: { label: string; run: () => void } } | null>(null);
  // Current calendar date (Pakistan). Re-checked every 30 s so midnight is noticed without a restart.
  const [calendarToday, setCalendarToday] = useState(() => getPakistanLocalDate());
  useEffect(() => {
    const timer = window.setInterval(() => setCalendarToday(getPakistanLocalDate()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  // Auto-dismiss success toasts after 3 seconds (errors stay until dismissed).
  useEffect(() => {
    if (feedbackMsg?.type === 'success') {
      const t = window.setTimeout(() => setFeedbackMsg(null), 3000);
      return () => window.clearTimeout(t);
    }
  }, [feedbackMsg]);
  const operationIdRef = useRef(activeOperationToEdit?.id || `op-${Date.now()}`);
  const startTimeRef = useRef(activeOperationToEdit?.startTime || new Date().toISOString());
  const savingRef = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  /**
   * Guards for explicit saves (Add expense, Accept reading, Cash deposit):
   * - lastPersistedSigRef: signature of the last successfully persisted draft,
   *   so the autosave effect does not write it a second time.
   * - saveSeqRef: every save attempt bumps this; a stale in-flight autosave
   *   failure must not overwrite the message of a newer save.
   */
  const saveSeqRef = useRef(0);
  const lastPersistedSigRef = useRef<string>('');
  const [editingAcceptedRow, setEditingAcceptedRow] = useState<number | null>(null);
  const [acceptedEditReason, setAcceptedEditReason] = useState('');
  const [correctedClosing, setCorrectedClosing] = useState('');
  const [correctionError, setCorrectionError] = useState('');
  const [deletingReadingRow, setDeletingReadingRow] = useState<number | null>(null);
  const [deleteReadingReason, setDeleteReadingReason] = useState('');

  const [savedFinalOperation, setSavedFinalOperation] = useState<DailyOperation | null>(null);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [showCannotCloseModal, setShowCannotCloseModal] = useState(false);

  // Actions the user confirms in a dialog (delete, correct, close day...).
  // They run straight away once confirmed.
  type ConfirmedAction =
    | { type: 'FINALIZE_DAY' }
    | { type: 'CHANGE_RATES'; tempPetrolRate: number; tempCngRate: number }
    | { type: 'OVERRIDE_OPENING_METER'; nozzleIndex: number; newOpeningMeter: number; note: string }
    | { type: 'ADD_CASH_DEPOSIT'; readingId: string; nozzleId: string; fuelType: 'PETROL' | 'CNG'; amount: number; note: string }
    | { type: 'EDIT_ACCEPTED_READING'; readingId: string; closing: number; reason: string }
    | { type: 'DELETE_READING'; nozzleIndex: number; reason: string };

  const activeShifts = useMemo(
    () =>
      [...(station.shifts || [])]
        .filter((s) => s.isActive)
        .sort((a, b) => a.order - b.order),
    [station.shifts]
  );
  const [activeShiftTab, setActiveShiftTab] = useState<string>(
    () => activeShifts[0]?.id || 'default-shift'
  );

  // Fuel-type tab filter (manager feedback): Petrol | CNG | All
  const [activeFuelTab, setActiveFuelTab] = useState<'ALL' | 'PETROL' | 'CNG'>('ALL');

  const [overrideModalRowIndex, setOverrideModalRowIndex] = useState<number | null>(null);
  const [overrideMeterVal, setOverrideMeterVal] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideError, setOverrideError] = useState<string | null>(null);

  const shiftLateWarning = useMemo(() => {
    if (operationStatus === 'CLOSED') return null;
    const currentDate = new Date(calendarToday);
    const busDate = new Date(businessDate);
    const diffTime = currentDate.getTime() - busDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 3600 * 24));

    if (diffDays > 0) {
      return {
        isMultiDay: true,
        message: `Business date (${formatBusinessDateDisplay(businessDate)}) is ${diffDays} day(s) behind current system date.`,
      };
    }
    return null;
  }, [businessDate, operationStatus, calendarToday]);

  const loadedOperationIdRef = useRef(activeOperationToEdit?.id);
  useEffect(() => {
    if (activeOperationToEdit && loadedOperationIdRef.current !== activeOperationToEdit.id) {
      loadedOperationIdRef.current = activeOperationToEdit.id;
      setEditingAcceptedRow(null);
      setShowCashModal(false);
      operationIdRef.current = activeOperationToEdit.id;
      startTimeRef.current = activeOperationToEdit.startTime || startTimeRef.current;
      setOperationStatus(activeOperationToEdit.status);
      setBusinessDate(activeOperationToEdit.businessDate);
      setPetrolRate(activeOperationToEdit.status === 'OPEN' && activeOperationToEdit.businessDate === getPakistanLocalDate() ? station.rates.PETROL : activeOperationToEdit.rates.PETROL);
      setCngRate(activeOperationToEdit.status === 'OPEN' && activeOperationToEdit.businessDate === getPakistanLocalDate() ? station.rates.CNG : activeOperationToEdit.rates.CNG);
      setExpenses(activeOperationToEdit.expenses);
      setCashDeposits(activeOperationToEdit.cashDeposits || []);
      setClosingNotes(activeOperationToEdit.notes || '');
      setRows(
        (() => {
          // Preserve saved rows; apply inactive-nozzle filtering only to display.
          const seqCounter = new Map<string, number>();
          const loadedRows = activeOperationToEdit.nozzleReadings
            .map((r) => {
            const key = `${r.nozzleId}|${r.shiftId || 'default-shift'}`;
            const existingSeq = (r as any).readingSequence;
            let seq: number;
            if (existingSeq && existingSeq > 0) {
              seq = existingSeq;
              seqCounter.set(key, Math.max(seqCounter.get(key) || 0, seq));
            } else {
              seq = (seqCounter.get(key) || 0) + 1;
              seqCounter.set(key, seq);
            }
            return {
              readingId: readingId(r, seq),
          savedRecord: r.closingAccepted ? { ...r, readingId: readingId(r, seq) } : undefined,
          nozzleId: r.nozzleId,
          pumpId: r.pumpId,
              shiftId: r.shiftId || 'default-shift',
              shiftNameSnapshot: r.shiftNameSnapshot || 'Shift 1',
              readingSequence: seq,
              meterOrder: (r as any).meterOrder || 0, // assigned below
              readingTime: (r as any).readingTime,
              employeeId: r.employeeId,
              openingMeter: r.openingMeter,
              // v64: preserve explicitly entered closing even when it equals opening
              // (legitimate 0L test reading). Only treat non-numeric as "no entry".
              // (TS-clean: closingMeter is typed number; guard the runtime value.)
              closingMeterStr: closingInput(r),
              cashReceivedStr: (r as any).cashReceived !== undefined ? String((r as any).cashReceived) : '',
              closingAccepted: !!r.closingAccepted,
              closingAcceptedAt: r.closingAcceptedAt,
              closingAcceptanceNote: r.closingAcceptanceNote,
            };
          });
          return assignMeterOrder(loadedRows);
        })()
      );
    }
  }, [activeOperationToEdit]);

  // Follow current rates for new readings on today's open day. Accepted rows
  // retain savedRecord.rate; historical days retain their operation rates.
  useEffect(() => {
    if (operationStatus === 'CLOSED' || businessDate !== getPakistanLocalDate()) return;
    setPetrolRate(station.rates?.PETROL ?? 0);
    setCngRate(station.rates?.CNG ?? 0);
  }, [station.rates?.PETROL, station.rates?.CNG, businessDate, operationStatus]);

  // v86 Bug 5: Append rows when a nozzle is added after the screen loaded.
  // Works for new days and when reopening a saved day. Never duplicates.
  useEffect(() => {
    if ((activeOperationToEdit?.status || operationStatus) === 'CLOSED') return;
    setRows((prev) => {
      const existing = new Set(prev.map((r) => `${r.nozzleId}|${r.shiftId}`));
      const activeShifts = [...(station.shifts || [])].filter((s) => s.isActive).sort((a, b) => a.order - b.order);
      const shiftsToUse = activeShifts.length > 0
        ? activeShifts
        : [{ id: 'default-shift', name: 'Shift 1', order: 1, isActive: true }];
      const added: NozzleFormRow[] = [];
      for (const n of activeNozzles) {
        for (const shift of shiftsToUse) {
          const key = `${n.id}|${shift.id}`;
          if (existing.has(key)) continue;
          const assignment = (station.shiftAssignments || []).find(
            (a) => a.nozzleId === n.id && a.shiftId === shift.id
          );
          added.push({
            readingId: crypto.randomUUID(),
            nozzleId: n.id,
            pumpId: n.pumpId,
            shiftId: shift.id,
            shiftNameSnapshot: shift.name,
            readingSequence: 1,
            meterOrder: 0,
            employeeId: assignment?.employeeId || '',
            openingMeter: n.lastClosingMeter,
            closingMeterStr: '',
            cashReceivedStr: '',
            closingAccepted: false,
          });
          existing.add(key);
        }
      }
      if (added.length === 0) return prev;
      return assignMeterOrder([...prev, ...added]);
    });
  }, [activeNozzles, station, activeOperationToEdit, operationStatus]);

  const pumpMap = useMemo(() => new Map(pumps.map((p) => [p.id, p])), [pumps]);
  const nozzleMap = useMemo(() => new Map(nozzles.map((n) => [n.id, n])), [nozzles]);
  const employeeMap = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);

  const calculatedReadings = useMemo(
    () => computeCalculatedReadings(rows, nozzleMap, pumpMap, employeeMap, petrolRate, cngRate),
    [rows, nozzleMap, pumpMap, employeeMap, petrolRate, cngRate],
  );

  const acceptedRecords = useMemo(() => calculatedReadings.filter((r) => r.hasAcceptedClosing).map((r) => r.record), [calculatedReadings]);
  const grossSales = useMemo(() => calculateGrossSales(acceptedRecords), [acceptedRecords]);
  const totalQuantity = useMemo(() => acceptedRecords.reduce((sum, r) => sum + r.quantitySold, 0), [acceptedRecords]);
  const totalExpenses = useMemo(() => calculateTotalExpenses(expenses), [expenses]);
  // Deduct new expenses once; preserve historical cash routing on old records.
  const cashExpensesTotal = useMemo(() => 
    expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0),
    [expenses]
  );
  const expectedNet = useMemo(() => calculateExpectedNet(grossSales, cashExpensesTotal, udhaarTotal ?? 0), [grossSales, cashExpensesTotal, udhaarTotal]);

  const actualCollection = useMemo(() => {
    if (cashDeposits.length === 0) return udhaarReady && expectedNet === 0 ? 0 : null;
    const total = cashDeposits.reduce((sum, d) => sum + d.amount, 0);
    return Math.round((total - collectedExpenseTotal(expenses)) * 100) / 100;
  }, [cashDeposits, expenses, expectedNet, udhaarReady]);

  const dayRemaining = udhaarReady ? Math.max(0, expectedNet - (actualCollection ?? 0)) : 0;
  const variance = useMemo(() => calculateVariance(actualCollection, expectedNet), [actualCollection, expectedNet]);
  const reconciliation = useMemo(() => getReconciliationStatus(variance, actualCollection), [variance, actualCollection]);

  /**
   * Builds the exact draft the autosave would persist. Handlers pass overrides
   * (e.g. the new expense) so they can save FIRST and only show success after
   * the database confirms.
   */
  const buildDraft = (overrides?: {
    rows?: NozzleFormRow[];
    expenses?: Expense[];
    cashDeposits?: CashDeposit[];
    businessDate?: string;
    petrolRate?: number;
    cngRate?: number;
  }): DailyOperation | null => {
    // Block draft building while credit total is unknown.
    if (!udhaarReady) return null;
    return buildOperationDraft({
      operationId: operationIdRef.current,
      businessDate: overrides?.businessDate ?? businessDate,
      cycleNumber: activeOperationToEdit?.cycleNumber || 1,
      startTime: startTimeRef.current,
      petrolRate: overrides?.petrolRate ?? petrolRate,
      cngRate: overrides?.cngRate ?? cngRate,
      rows: overrides?.rows ?? rows,
      expenses: overrides?.expenses ?? expenses,
      cashDeposits: overrides?.cashDeposits ?? cashDeposits,
      closingNotes,
      lastEditReason: activeOperationToEdit?.lastEditReason,
      nozzleMap,
      pumpMap,
      employeeMap,
      udhaarTotal: udhaarTotal ?? 0,
      // v71: Preserve counted cash saved from Dashboard.
      countedCash: activeOperationToEdit?.countedCash ?? null,
    });
  };

  /**
   * Persists a draft and remembers its signature, so the autosave effect
   * skips re-saving the identical draft afterwards.
   */
  const persistDraft = async (draft: DailyOperation | null): Promise<SaveResult> => {
    // Block save while credit total is unknown (would save wrong expected cash).
    // Form data is preserved - user just waits and retries.
    if (!draft) {
      return { ok: false, error: 'Credit total is still loading. Wait a moment and try again.' };
    }
    saveSeqRef.current += 1;
    const result = await onSaveOperation(draft);
    if (result.ok) {
      lastPersistedSigRef.current = JSON.stringify(draft);
    }
    return result;
  };

  const closingChecklist = useMemo(() => {
    const unassignedNozzles = calculatedReadings.filter((r) => !r.row.employeeId || r.row.employeeId.trim() === '');
    const missingClosingNozzles = calculatedReadings.filter((r) => !r.hasEnteredClosing);
    const unacceptedClosingNozzles = calculatedReadings.filter((r) => r.hasEnteredClosing && !r.hasAcceptedClosing);
    const readingErrors = calculatedReadings.filter((r) => !!r.error);
    const hasCash = actualCollection !== null && actualCollection !== undefined && !isNaN(actualCollection);

    return {
      allNozzlesHaveClosing: calculatedReadings.length > 0 && missingClosingNozzles.length === 0,
      allClosingsAccepted: calculatedReadings.length > 0 && unacceptedClosingNozzles.length === 0,
      unacceptedClosingNozzles,
      missingClosingNozzles,
      // Employee is optional now (manager feedback) - kept for info, not blocking.
      allNozzlesHaveOperator: true,
      unassignedNozzles: [],
      noReadingErrors: readingErrors.length === 0,
      readingErrors,
      hasCashEntered: hasCash,
      isAllValid:
        calculatedReadings.length > 0 &&
        missingClosingNozzles.length === 0 &&
        unacceptedClosingNozzles.length === 0 &&
        readingErrors.length === 0 &&
        hasCash,
    };
  }, [calculatedReadings, actualCollection]);

  const isClosed = operationStatus === 'CLOSED';

  const missingRequirementsForModal: MissingRequirementItem[] = useMemo(() => {
    const items: MissingRequirementItem[] = [];

    closingChecklist.readingErrors.forEach((r) => {
      items.push({
        id: `err-${r.record.nozzleId}-${r.record.shiftId}`,
        category: 'reading_error',
        title: `Invalid Meter: ${r.record.pumpNameSnapshot} - ${r.record.nozzleNameSnapshot} (${r.record.shiftNameSnapshot})`,
        detail: r.error || 'Closing meter cannot be less than opening meter.',
        nozzleId: r.record.nozzleId,
        rowIndex: calculatedReadings.indexOf(r),
      });
    });

    closingChecklist.missingClosingNozzles.forEach((r) => {
      items.push({
        id: `missing-close-${r.record.nozzleId}-${r.record.shiftId}`,
        category: 'meter',
        title: `Closing Meter Missing: ${r.record.pumpNameSnapshot} - ${r.record.nozzleNameSnapshot} (${r.record.shiftNameSnapshot})`,
        detail: `Current opening meter is ${r.record.openingMeter}. Enter closing meter to calculate sales.`,
        nozzleId: r.record.nozzleId,
        rowIndex: calculatedReadings.indexOf(r),
      });
    });

    closingChecklist.unacceptedClosingNozzles.forEach((r) => {
      items.push({
        id: `unaccepted-close-${r.record.nozzleId}-${r.record.shiftId}`,
        category: 'meter',
        title: `Closing Not Accepted: ${r.record.pumpNameSnapshot} - ${r.record.nozzleNameSnapshot} (${r.record.shiftNameSnapshot})`,
        detail: 'Click Save after verifying the closing meter.',
        nozzleId: r.record.nozzleId,
        rowIndex: calculatedReadings.indexOf(r),
      });
    });

    closingChecklist.unassignedNozzles.forEach((r) => {
      items.push({
        id: `unassigned-op-${r.record.nozzleId}-${r.record.shiftId}`,
        category: 'operator',
        title: `Operator Unassigned: ${r.record.pumpNameSnapshot} - ${r.record.nozzleNameSnapshot} (${r.record.shiftNameSnapshot})`,
        detail: 'Assign an active staff member for this nozzle.',
      });
    });

    if (!closingChecklist.hasCashEntered) {
      items.push({
        id: 'missing-cash',
        category: 'cash',
        title: 'Cash Handed to Manager Missing',
        detail: 'Enter physical cash handed over to the manager.',
      });
    }

    return items;
  }, [closingChecklist]);

  const handleAddReading = (nozzleId: string, shiftId: string) => {
    if (isClosed) return;
    // Display sequence is per nozzle+shift (each shift restarts at 1).
    // Meter order is global per nozzle (physical meter is continuous).
    // A pending reading in Shift B must NOT block Shift A.
    const nozzleShiftRows = rows.filter((r) => r.nozzleId === nozzleId && r.shiftId === shiftId);
    if (nozzleShiftRows.length === 0) return;
    const maxAcceptedSeq = Math.max(
      0,
      ...nozzleShiftRows.filter((r) => r.closingAccepted).map((r) => r.readingSequence || 0)
    );
    const hasPending = nozzleShiftRows.some((r) => !r.closingAccepted);
    if (hasPending) {
      setFeedbackMsg({
        type: 'error',
        text: 'Accept the current reading first before adding a new one.',
      });
      return;
    }
    // Use the latest accepted reading's closing as the new opening.
    // Look across all shifts by meter order (physical meter is continuous).
    // v63: derive from the CALCULATED reading (frozen closingMeter), not the raw
    // row's text input, with finite-number guards to avoid NaN openings.
    const nozzleRows = rows.filter((r) => r.nozzleId === nozzleId);
    const sortedAccepted = nozzleRows
      .filter((r) => r.closingAccepted)
      .sort((a, b) => (a.meterOrder || a.readingSequence || 0) - (b.meterOrder || b.readingSequence || 0));
    const lastRow = sortedAccepted[sortedAccepted.length - 1] || nozzleShiftRows[0];
    const lastRowIndex = rows.indexOf(lastRow);
    const lastCalc = lastRowIndex >= 0 ? calculatedReadings[lastRowIndex] : undefined;
    const calcClosing = lastCalc?.record?.closingMeter;
    const textClosing = lastRow.closingMeterStr.trim() !== '' ? Number(lastRow.closingMeterStr) : NaN;
    const lastClosing = Number.isFinite(calcClosing)
      ? calcClosing as number
      : Number.isFinite(textClosing)
        ? textClosing
        : Number.isFinite(lastRow.openingMeter)
          ? lastRow.openingMeter
          : 0;
    const newSeq = maxAcceptedSeq + 1;
    const newRow: NozzleFormRow = {
      nozzleId: lastRow.nozzleId,
      pumpId: lastRow.pumpId,
      shiftId: shiftId,
      shiftNameSnapshot: activeShifts.find((s) => s.id === shiftId)?.name || lastRow.shiftNameSnapshot,
      readingSequence: newSeq,
      meterOrder: 0, // assigned when accepted (accept-time ordering)
      readingTime: new Date().toISOString(),
      employeeId: lastRow.employeeId,
      openingMeter: lastClosing,
      closingMeterStr: '',
      cashReceivedStr: '',
      closingAccepted: false,
    };
    setRows((prev) => [...prev, { ...newRow, readingId: crypto.randomUUID() }]);
    setFeedbackMsg({ type: 'success', text: `New reading #${newSeq} added. Opening: ${lastClosing.toLocaleString('en-US')}` });
  };

  const handleAcceptClosing = async (index: number) => {
    // v63: double-accept race guard. Two rapid Enter presses could both pass
    // the checks and assign the same meterOrder. Block re-entry while saving.
    if (isClosed || savingRef.current) return;
    const item = calculatedReadings[index];
    if (!item || !item.hasEnteredClosing || item.error) {
      setFeedbackMsg({ type: 'error', text: 'Please enter a valid closing meter reading before saving.' });
      return;
    }
    // v86 Bug 3: Never save a reading at zero rate (would record a Rs. 0 sale).
    if (!Number.isFinite(item.record.rate) || item.record.rate <= 0) {
      setFeedbackMsg({ type: 'error', text: 'Set fuel rates first (Fuel Stock > Change Rates) before saving readings.' });
      return;
    }
    // Block readings for inactive nozzles.
    const nozzle = nozzleMap.get(item.row.nozzleId);
    if (nozzle && !nozzle.isActive && !item.row.closingAccepted) {
      setFeedbackMsg({ type: 'error', text: 'This nozzle is inactive. Turn it on from Pumps & Nozzles to add readings.' });
      return;
    }
    // Employee is optional now (manager feedback): nozzle-only operation.
    // No longer blocks accepting a reading.
    // STOCK CHECK: block accepting if fuel stock would go negative.
    // Only checks when stock tracking data exists (remainingStock !== null).
    const fuelType = item.record.fuelType;
    const quantityToSell = item.record.quantitySold;
    if (quantityToSell > 0 && stockRecords.length > 0) {
      // Build operations list including current draft for accurate stock calc.
      // v63: build the draft directly (bypassing the udhaarReady gate) so the
      // stock check sees the current session's accepted readings even while
      // credit total is still loading. Udhaar does not affect stock math.
      const draftForStock = buildOperationDraft({
        operationId: operationIdRef.current,
        businessDate,
        cycleNumber: activeOperationToEdit?.cycleNumber || 1,
        startTime: startTimeRef.current,
        petrolRate,
        cngRate,
        rows,
        expenses,
        cashDeposits,
        closingNotes,
        lastEditReason: activeOperationToEdit?.lastEditReason,
        nozzleMap,
        pumpMap,
        employeeMap,
        udhaarTotal: udhaarTotal ?? 0,
      });
      const opsForStock = [...existingOperations];
      if (draftForStock) {
        const draftIdx = opsForStock.findIndex((op) => op.id === draftForStock.id);
        if (draftIdx >= 0) {
          opsForStock[draftIdx] = draftForStock;
        } else {
          opsForStock.push(draftForStock);
        }
      }
      const stockCalc = calculateFuelStock(businessDate, fuelType, opsForStock, stockRecords);
      if (stockCalc.remainingStock !== null && stockCalc.remainingStock - quantityToSell < 0) {
        const available = Math.max(0, stockCalc.remainingStock);
        setFeedbackMsg({
          type: 'error',
          text: `Not enough ${fuelType === 'PETROL' ? 'Petrol' : 'CNG'} in stock. Available: ${available.toFixed(1)} L. Add fuel supply first.`,
        });
        return;
      }
    }
    const acceptedAt = new Date().toISOString();
    // Assign meterOrder at ACCEPT time: next order for this nozzle.
    // Pending rows don't consume order positions.
    const nozzleId = item.row.nozzleId;
    const maxOrder = Math.max(
      0,
      ...rows.filter((r) => r.nozzleId === nozzleId && r.closingAccepted).map((r) => r.meterOrder || 0)
    );
    const newOrder = maxOrder + 1;
    // Freeze the CALCULATED opening (item.row.openingMeter), not the raw row's.
    // The raw row may have a stale opening; the calculated one chains correctly.
    const frozenOpening = item.row.openingMeter;
    const nextRows = rows.map((r, i) =>
      i === index ? { ...r, openingMeter: frozenOpening, closingAccepted: true, closingAcceptedAt: acceptedAt, meterOrder: newOrder } : r,
    );
    // Save FIRST: success is only shown after the database confirms.
    setIsSaving(true);
    savingRef.current = true;
    const acceptedDraft = buildDraft({ rows: nextRows });
    const result = await persistDraft(acceptedDraft);
    setIsSaving(false);
    savingRef.current = false;
    if (!result.ok) {
      setFeedbackMsg({ type: 'error', text: `Reading was NOT saved: ${saveErrorText(result)} Your entry is unchanged. Please try again.` });
      return;
    }
    // Functional update: never clobber edits typed while the save was in flight.
    setRows((prev) => prev.map((r) => (r.readingId === item.row.readingId ? { ...r, openingMeter: frozenOpening, closingAccepted: true, closingAcceptedAt: acceptedAt, meterOrder: newOrder, savedRecord: acceptedDraft!.nozzleReadings[index] } : r)));
    setFeedbackMsg({ type: 'success', text: `${item.record.pumpNameSnapshot} - ${item.record.nozzleNameSnapshot}: closing reading accepted and saved.` });
  };

  const handleRequestEditAcceptedClosing = (index: number) => {
    if (isClosed) return;
    // Block editing if a later accepted reading exists for the same nozzle.
    // Correct from the latest backwards to avoid breaking the meter chain.
    // Uses meterOrder (global chain order), not shift-wise readingSequence.
    const row = rows[index];
    if (row) {
      const rowOrder = row.meterOrder || row.readingSequence || 0;
      const laterAccepted = rows.some((r, i) =>
        i !== index &&
        r.nozzleId === row.nozzleId &&
        (r.meterOrder || r.readingSequence || 0) > rowOrder &&
        r.closingAccepted
      );
      if (laterAccepted) {
        setFeedbackMsg({ type: 'error', text: 'Correct the later reading first.' });
        return;
      }
    }
    setEditingAcceptedRow(index);
    setAcceptedEditReason('');
    setCorrectedClosing(row.closingMeterStr);
    setCorrectionError('');
  };

  const handleRequestDeleteReading = (index: number) => {
    if (isClosed) return;
    if (rows[index]?.closingAccepted) { setFeedbackMsg({ type: 'error', text: 'Saved readings stay in History. Use the pencil to correct this reading.' }); return; }
    const row = rows[index];
    if (!row) return;
    // Block deleting if a later accepted reading exists for the same nozzle.
    const rowOrder = row.meterOrder || row.readingSequence || 0;
    const laterAccepted = rows.some((r, i) =>
      i !== index &&
      r.nozzleId === row.nozzleId &&
      (r.meterOrder || r.readingSequence || 0) > rowOrder &&
      r.closingAccepted
    );
    if (laterAccepted) {
      setFeedbackMsg({ type: 'error', text: 'Delete the later reading first.' });
      return;
    }
    setDeletingReadingRow(index);
    setDeleteReadingReason('');
  };

  const handleConfirmDeleteReading = () => {
    if (deletingReadingRow === null || !deleteReadingReason.trim()) return;
    const index = deletingReadingRow;
    setDeletingReadingRow(null);
    void runAction({ type: 'DELETE_READING', nozzleIndex: index, reason: deleteReadingReason.trim() });
    setDeleteReadingReason('');
  };

  const handleConfirmEditAcceptedClosing = () => {
    if (editingAcceptedRow === null || !acceptedEditReason.trim() || correctedClosing.trim() === '') return;
    try {
      const record = calculatedReadings[editingAcceptedRow].record;
      correctReading(record, Number(correctedClosing), acceptedEditReason, new Date().toISOString());
      void runAction({ type: 'EDIT_ACCEPTED_READING', readingId: readingId(record), closing: Number(correctedClosing), reason: acceptedEditReason.trim() });
    } catch (error) { setCorrectionError((error as Error).message); }
  };

  // v80: Only digits allowed in closing meter (no letters like "Abcd")
  const handleClosingMeterChange = (index: number, val: string) => {
    if (isClosed) return;
    const digitsOnly = val.replace(/[^0-9]/g, '');
    setFeedbackMsg(null);
    setRows((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], closingMeterStr: digitsOnly };
      return next;
    });
  };

  const handleCashReceivedChange = (index: number, val: string) => {
    if (isClosed) return;
    setRows((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], cashReceivedStr: val };
      return next;
    });
  };

  const handleOperatorChange = (index: number, empId: string) => {
    if (isClosed) return;
    setRows((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], employeeId: empId };
      return next;
    });
  };

  const handleAddExpense = async (e: FormEvent) => {
    e.preventDefault();
    if (isClosed) return;
    if (!newExpenseDesc.trim() || !newExpenseAmount || isNaN(Number(newExpenseAmount))) return;

    const exp: Expense = {
      id: `exp-${Date.now()}`,
      description: newExpenseDesc.trim(),
      category: newExpenseCat,
      amount: Math.abs(Number(newExpenseAmount)),
      collectedCashUsed: expenseFromCollectedCash(Math.abs(Number(newExpenseAmount)), expenses, cashDeposits),
      notes: newExpenseNote.trim() || undefined,
      dateTime: new Date().toISOString(),

    };
    const nextExpenses = [...expenses, exp];
    // Save FIRST: the form only clears after the database confirms.
    setIsSaving(true);
    const result = await persistDraft(buildDraft({ expenses: nextExpenses }));
    setIsSaving(false);
    if (!result.ok) {
      setFeedbackMsg({ type: 'error', text: `Expense was NOT saved: ${saveErrorText(result)} Your entry is still in the form. Please try again.` });
      return;
    }
    setExpenses((prev) => (prev.some((e) => e.id === exp.id) ? prev : [...prev, exp]));
    setNewExpenseDesc('');
    setNewExpenseAmount('');
    setNewExpenseNote('');
    setShowExpenseModal(false);
    setFeedbackMsg({ type: 'success', text: 'Expense added and saved successfully.' });
  };

  const handleRequestAddDeposit = (e: FormEvent) => {
    e.preventDefault();
    if (isClosed) return;
    setDepositError(null);

    // v64: nozzle-based handover (no employee).
    if (!depositReadingId || !calculatedReadings.some(item => item.row.readingId === depositReadingId && item.hasAcceptedClosing)) {
      setDepositError('Save the selected reading before receiving cash.');
      return;
    }
    const amountNum = Number(newDepositAmountStr);
    if (!newDepositAmountStr.trim() || !Number.isFinite(amountNum) || amountNum <= 0 || Math.round(amountNum * 100) <= 0) {
      setDepositError('Enter a valid deposit amount greater than zero.');
      return;
    }
    // v81: Never accept more cash than the reading sale (not even 1 rupee extra).
    // v83: Overpaid readings (received > sale) block any further cash.
    const depositItem = calculatedReadings.find(item => item.row.readingId === depositReadingId);
    if (depositItem) {
      const alreadyReceived = readingCash(depositItem.record, cashDeposits).received;
      const remaining = remainingCashForReading(depositItem.record.salesAmount, alreadyReceived, dayRemaining);
      if (remaining < -0.001) {
        setDepositError(`This reading is overpaid by ${formatCurrency(-remaining)}. No more cash can be collected for it.`);
        return;
      }
      if (Math.round(amountNum * 100) / 100 > remaining + 0.001) {
        setDepositError(`Cash cannot exceed the remaining cash due of ${formatCurrency(Math.max(0, remaining))} for this reading.`);
        return;
      }
    }

    void runAction({
      type: 'ADD_CASH_DEPOSIT',
      readingId: depositReadingId,
      nozzleId: depositNozzleId,
      fuelType: depositFuelType,
      amount: Math.round(amountNum * 100) / 100,
      note: newDepositNote.trim(),
    });
  };

  const handleOpenOverrideDialog = (index: number) => {
    if (isClosed) return;
    setOverrideModalRowIndex(index);
    setOverrideMeterVal(String(rows[index].openingMeter));
    setOverrideReason('');
    setOverrideError(null);
  };

  const handleConfirmOverrideSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (overrideModalRowIndex === null) return;
    const newOpening = Number(overrideMeterVal);
    if (isNaN(newOpening) || newOpening < 0) {
      setOverrideError('Please enter a valid non-negative opening meter.');
      return;
    }
    if (!overrideReason.trim()) {
      setOverrideError('Manager override requires an explanation reason.');
      return;
    }
    setOverrideError(null);

    const idx = overrideModalRowIndex;
    setOverrideModalRowIndex(null);

    void runAction({
      type: 'OVERRIDE_OPENING_METER',
      nozzleIndex: idx,
      newOpeningMeter: newOpening,
      note: overrideReason.trim(),
    });
  };

  const handleRequestFinalize = () => {
    // Block Close Day while credit total is unknown (would save wrong expected cash).
    if (!udhaarReady) {
      setFeedbackMsg({ type: 'error', text: 'Credit total is still loading. Wait a moment and try again.' });
      return;
    }
    if (!closingChecklist.isAllValid) {
      setShowCannotCloseModal(true);
      return;
    }
    void runAction({ type: 'FINALIZE_DAY' });
  };

  const runAction = async (action: ConfirmedAction) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setIsSaving(true);
    try {
    if (action.type === 'CHANGE_RATES') {
      const newPetrolRate = action.tempPetrolRate;
      const newCngRate = action.tempCngRate;
      // Save FIRST: the new rates only take effect after the database confirms.
      setIsSaving(true);
      const rateResult = await persistDraft(buildDraft({ petrolRate: newPetrolRate, cngRate: newCngRate }));
      setIsSaving(false);
      if (!rateResult.ok) {
        setFeedbackMsg({ type: 'error', text: `Rates were NOT saved: ${saveErrorText(rateResult)} Please try again.` });
        return;
      }
      setPetrolRate(newPetrolRate);
      setCngRate(newCngRate);
      setFeedbackMsg({
        type: 'success',
        text: `Fuel rates updated and saved: Petrol ${formatCurrency(newPetrolRate)}, CNG ${formatCurrency(newCngRate)}.`,
      });
    } else if (action.type === 'ADD_CASH_DEPOSIT') {
      // v64: nozzle-based handover.
      const nozzle = nozzleMap.get(action.nozzleId);
      const deposit: CashDeposit = {
        id: crypto.randomUUID(),
        readingId: action.readingId,
        readingSequence: rows.find(row => row.readingId === action.readingId)?.readingSequence,
        nozzleId: action.nozzleId,
        nozzleNameSnapshot: calculatedReadings.find(item => item.row.readingId === action.readingId)?.record.nozzleNameSnapshot || nozzle?.name || 'Unknown Nozzle',
        fuelType: action.fuelType,
        amount: action.amount,
        note: action.note || undefined,
        timestamp: new Date().toISOString(),
      };
      const nextDeposits = [...cashDeposits, deposit];
      // Save FIRST: the form only clears after the database confirms.
      setIsSaving(true);
      const depResult = await persistDraft(buildDraft({ cashDeposits: nextDeposits }));
      setIsSaving(false);
      if (!depResult.ok) {
        // Keep the entered values so the user can retry without retyping.
        setDepositNozzleId(action.nozzleId);
        setDepositFuelType(action.fuelType);
        setNewDepositAmountStr(String(action.amount));
        setNewDepositNote(action.note);
        setDepositError(`Deposit was NOT saved: ${saveErrorText(depResult)} Please try again.`);
        return;
      }
      setCashDeposits((prev) => (prev.some((d) => d.id === deposit.id) ? prev : [...prev, deposit]));
      setDepositNozzleId('');
      setNewDepositAmountStr('');
      setNewDepositNote('');
      setShowCashModal(false);
      setFeedbackMsg({
        type: 'success',
        text: `Rs. ${action.amount.toLocaleString('en-US')} deposit logged and saved from ${nozzle ? nozzle.name : 'nozzle'}.`,
      });
    } else if (action.type === 'EDIT_ACCEPTED_READING') {
      const idx = rows.findIndex(row => row.readingId === action.readingId);
      if (idx < 0) { setCorrectionError('Reading no longer available.'); return; }
      try {
        const before = calculatedReadings[idx].record;
        if (rows.some((row, i) => i !== idx && row.nozzleId === before.nozzleId && row.closingAccepted && row.meterOrder > (before.meterOrder || 0))) throw new Error('A later reading is already saved. Correct the latest reading first.');
        const corrected = correctReading(before, action.closing, action.reason, new Date().toISOString());
        const nextRows = rows.map((row, i) => i === idx ? { ...row, closingMeterStr: String(corrected.closingMeter), savedRecord: corrected, closingAcceptanceNote: corrected.closingAcceptanceNote } : row);
        const result = await persistDraft(buildDraft({ rows: nextRows }));
        if (!result.ok) throw new Error(saveErrorText(result));
        setRows(prev => prev.map(row => row.readingId === action.readingId ? { ...row, closingMeterStr: String(corrected.closingMeter), savedRecord: corrected, closingAcceptanceNote: corrected.closingAcceptanceNote } : row));
        setEditingAcceptedRow(null);
        setFeedbackMsg({ type: 'success', text: 'Reading corrected and saved. Other readings remain locked.' });
      } catch (error) { setCorrectionError((error as Error).message); }
    } else if (action.type === 'DELETE_READING') {
      const idx = action.nozzleIndex;
      const nextRows = rows.filter((_, i) => i !== idx);
      // Save FIRST: the delete only takes effect after the database confirms.
      setIsSaving(true);
      const delResult = await persistDraft(buildDraft({ rows: nextRows }));
      setIsSaving(false);
      if (!delResult.ok) {
        setFeedbackMsg({ type: 'error', text: `Delete was NOT saved: ${saveErrorText(delResult)} Please try again.` });
        return;
      }
      setRows(nextRows);
      setFeedbackMsg({ type: 'success', text: `Reading deleted: ${action.reason}` });
    } else if (action.type === 'OVERRIDE_OPENING_METER') {
      const idx = action.nozzleIndex;
      const newOpening = action.newOpeningMeter;
      const ovNote = action.note;
      const nextRows = rows.map((r, i) =>
        i === idx
          ? { ...r, openingMeter: newOpening, overrideNote: ovNote }
          : r,
      );
      // Save FIRST: the override only takes effect after the database confirms.
      setIsSaving(true);
      const ovResult = await persistDraft(buildDraft({ rows: nextRows }));
      setIsSaving(false);
      if (!ovResult.ok) {
        setFeedbackMsg({ type: 'error', text: `Override was NOT saved: ${saveErrorText(ovResult)} Please try again.` });
        return;
      }
      setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, openingMeter: newOpening, overrideNote: ovNote } : r)));
      setFeedbackMsg({
        type: 'success',
        text: `Opening meter overridden to ${action.newOpeningMeter} and saved. Reason: ${action.note}`,
      });
    } else if (action.type === 'FINALIZE_DAY') {
      // Re-check udhaar readiness before closing: total may have become unknown
      // while the dialog was open. Never close the day on a guessed total.
      if (!udhaarReady) {
        setFeedbackMsg({ type: 'error', text: 'Credit total is still loading. Wait a moment and try closing the day again.' });
        return;
      }
      const finalOp: DailyOperation = {
        id: operationIdRef.current,
        businessDate,
        cycleNumber: activeOperationToEdit?.cycleNumber || 1,
        startTime: startTimeRef.current,
        endTime: new Date().toISOString(),
        status: 'CLOSED',
        rates: { PETROL: petrolRate, CNG: cngRate },
        nozzleReadings: calculatedReadings.map((r) => r.record),
        expenses,
        cashDeposits,
        grossSales,
        totalQuantity,
        totalExpenses,
        expectedNet,
        actualCollection,
        variance,
        reconciliationStatus: reconciliation.status,
        reconciliationText: reconciliation.text,
        notes: closingNotes.trim() || undefined,
        lastEditReason: activeOperationToEdit?.lastEditReason,
        // v73: Preserve counted cash on Close Day (was being wiped).
        countedCash: activeOperationToEdit?.countedCash ?? null,
      };

      setIsSaving(true);
      try {
        const result = await onSaveOperation(finalOp);
        if (result.ok) {
          setOperationStatus('CLOSED');
          setSavedFinalOperation(finalOp);
          setFeedbackMsg({
            type: 'success',
            text: `Shift operations for ${formatBusinessDateDisplay(businessDate)} closed successfully.`,
          });
        } else {
          setFeedbackMsg({
            type: 'error',
            text: `Day was NOT closed: ${saveErrorText(result)} Your entries are still on screen. Please try again.`,
          });
        }
      } finally {
        savingRef.current = false;
        setIsSaving(false);
      }
      return;
    }

    } finally { savingRef.current = false; setIsSaving(false); }
  };

  useEffect(() => {
    if (isClosed || savingRef.current) return;
    const hasMeaningfulData = calculatedReadings.some((r) => r.hasAcceptedClosing) || expenses.length > 0 || cashDeposits.length > 0;
    if (!hasMeaningfulData) return;
    const draft = buildDraft();
    // Don't autosave while credit total is unknown (would save wrong expected cash).
    // buildDraft returns null in that case - just skip this autosave cycle.
    if (!draft) return;
    const sig = JSON.stringify(draft);
    // Already persisted by an explicit handler save (Add expense, etc.).
    if (sig === lastPersistedSigRef.current) return;
    const seq = ++saveSeqRef.current;
    void onSaveOperation(draft).then((result) => {
      if (result.ok) {
        lastPersistedSigRef.current = sig;
      } else if (seq === saveSeqRef.current) {
        // Only report if no newer save has started since; a stale failure must
        // not overwrite a newer success message.
        setFeedbackMsg({ type: 'error', text: `Auto-save failed: ${saveErrorText(result)}` });
      }
    });
  }, [businessDate, petrolRate, cngRate, calculatedReadings, expenses, cashDeposits, grossSales, totalQuantity, totalExpenses, expectedNet, actualCollection, variance, reconciliation.status, reconciliation.text, closingNotes, isClosed]);

  const visibleReadings = useMemo(() => {
    return calculatedReadings
      .map((item, originalIndex) => ({ ...item, originalIndex }))
      .filter((item) => activeShifts.length <= 1 || item.row.shiftId === activeShiftTab)
      .filter((item) => activeFuelTab === 'ALL' || item.record.fuelType === activeFuelTab)
      // Hide pending rows for inactive nozzles; accepted readings always show.
      .filter((item) => {
        if (item.hasAcceptedClosing) return true;
        const nozzle = nozzleMap.get(item.row.nozzleId);
        return nozzle?.isActive !== false;
      })
      // Group by Pump -> Nozzle -> Reading sequence (new readings appear under their nozzle).
      // Numeric sort: extract numbers from names for correct ordering (Pump 1, 2, 10 not 1, 10, 2).
      .sort((a, b) => {
        const extractNum = (s: string) => {
          const m = (s || '').match(/\d+/);
          return m ? parseInt(m[0], 10) : 0;
        };
        // Use record (calculated) snapshots which are always populated.
        const recA = a.record as any;
        const recB = b.record as any;
        const rowA = a.row as any;
        const rowB = b.row as any;
        const pumpA: string = recA?.pumpNameSnapshot || rowA?.pumpNameSnapshot || '';
        const pumpB: string = recB?.pumpNameSnapshot || rowB?.pumpNameSnapshot || '';
        const pumpNumA = extractNum(pumpA);
        const pumpNumB = extractNum(pumpB);
        if (pumpNumA !== pumpNumB) return pumpNumA - pumpNumB;
        if (pumpA !== pumpB) return pumpA.localeCompare(pumpB);
        const nozzleA: string = recA?.nozzleNameSnapshot || rowA?.nozzleNameSnapshot || rowA?.nozzleId || '';
        const nozzleB: string = recB?.nozzleNameSnapshot || rowB?.nozzleNameSnapshot || rowB?.nozzleId || '';
        const nozzleNumA = extractNum(nozzleA);
        const nozzleNumB = extractNum(nozzleB);
        if (nozzleNumA !== nozzleNumB) return nozzleNumA - nozzleNumB;
        if (nozzleA !== nozzleB) return nozzleA.localeCompare(nozzleB);
        return (a.row.readingSequence || 0) - (b.row.readingSequence || 0);
      });
  }, [calculatedReadings, activeShifts, activeShiftTab, activeFuelTab, nozzleMap]);

  // Total for the footer: exclude hidden inactive pending rows.
  const totalVisibleRecords = useMemo(() => {
    return calculatedReadings.filter((item) => {
      if (item.hasAcceptedClosing) return true;
      const nozzle = nozzleMap.get(item.row.nozzleId);
      return nozzle?.isActive !== false;
    }).length;
  }, [calculatedReadings, nozzleMap]);

  return (
    <div className="daily-operation-screen space-y-6 text-slate-800">
      {isClosed && calendarToday > businessDate && onStartNewDay && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-emerald-900 shadow-sm">
          <span className="text-sm font-bold">
            {formatBusinessDateDisplay(businessDate)} is closed and the date is now {formatBusinessDateDisplay(calendarToday)}.
          </span>
          <button
            type="button"
            onClick={onStartNewDay}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 cursor-pointer shrink-0"
          >
            Start {formatBusinessDateDisplay(calendarToday)}
          </button>
        </div>
      )}

      {shiftLateWarning && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 flex items-center gap-3 text-amber-900 shadow-sm">
          <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600" />
          <span className="text-sm font-bold">{shiftLateWarning.message}</span>
        </div>
      )}

      {/* Page Header */}
      <div className="daily-operation-header">
        <div className="flex-1">
          <h1 className="text-3xl font-bold tracking-tight text-[#0f172a]">
            {isClosed ? 'Daily Operation Closed' : 'Daily Operation'}
          </h1>
          <p className="mt-0.5 text-base font-medium text-slate-500">Enter nozzle readings, check cash and close the day.</p>
        </div>
        <div className="daily-current-info" aria-label="Today's date and current fuel rates">
          <span><CalendarDays size={18} aria-hidden="true" />{formatBusinessDateDisplay(getPakistanLocalDate())}</span>
          <span><Fuel size={18} aria-hidden="true" />Petrol <strong>{formatCurrency(station.rates.PETROL)}/L</strong></span>
          <span><Flame size={18} aria-hidden="true" />CNG <strong>{formatCurrency(station.rates.CNG)}/kg</strong></span>
        </div>
      </div>

      {feedbackMsg && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] w-fit max-w-[90vw] rounded-2xl border px-5 py-3.5 flex items-center justify-between gap-4 shadow-2xl ${
            feedbackMsg.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            {feedbackMsg.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600" />
            ) : (
              <AlertCircle className="w-5 h-5 shrink-0 text-rose-600" />
            )}
            <span className="text-sm font-bold break-words">{feedbackMsg.text}</span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {feedbackMsg.action && (
              <button
                type="button"
                onClick={() => {
                  const run = feedbackMsg.action?.run;
                  setFeedbackMsg(null);
                  run?.();
                }}
                className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-700 cursor-pointer"
              >
                {feedbackMsg.action.label}
              </button>
            )}
            <button type="button" onClick={() => setFeedbackMsg(null)} className="text-xs font-bold underline cursor-pointer">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Main Nozzle Readings Card */}
      <section className="daily-readings" aria-label="Nozzle readings">
        
        {/* Card Top Header */}
        <div className="daily-readings-toolbar">
          <div className="flex items-center gap-3">
            <div className="daily-readings-icon">
              <Fuel className="w-5 h-5" />
            </div>
            <h2 className="text-lg font-bold text-slate-900">Nozzle Readings</h2>
          </div>

          {/* Business Date & Shift Dropdowns inside Header */}
          <div className="daily-readings-filters">

            <div className="daily-shift">
              <Clock className="w-4 h-4 text-emerald-700" />
              <select
                aria-label="Shift"
                value={activeShiftTab}
                onChange={(e) => setActiveShiftTab(e.target.value)}
                className="bg-transparent text-xs font-bold text-slate-700 outline-none cursor-pointer"
                disabled={isClosed}
              >
                {(activeShifts.length > 0 ? activeShifts : [{ id: 'default-shift', name: 'Shift 1' }]).map((shift) => (
                  <option key={shift.id} value={shift.id}>{shift.name}</option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </div>

            {/* Fuel-type tabs (manager feedback): Petrol | CNG | All */}
            <div className="daily-fuel-tabs" role="group" aria-label="Fuel filter">
              {(['ALL', 'PETROL', 'CNG'] as const).map((ft) => (
                <button
                  key={ft}
                  type="button"
                  onClick={() => setActiveFuelTab(ft)}
                  aria-pressed={activeFuelTab === ft}
                >
                  {ft === 'ALL' ? 'All' : ft === 'PETROL' ? 'Petrol' : 'CNG'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Table Content */}
        <div className="daily-readings-content">
          <table className="daily-readings-table" aria-label="Nozzle readings" role="table">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-100 text-xs font-semibold text-slate-500">
                <th scope="col">Pump / Nozzle</th>
                <th scope="col">Fuel</th>
                <th scope="col">Opening Meter</th>
                <th scope="col">Closing Meter</th>
                <th scope="col">Sold</th>
                <th scope="col">Amount (Rs)</th>
                <th scope="col">Time</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleReadings.length === 0 ? (
                <tr>
                  <td colSpan={9} className="daily-readings-empty">
                    No active nozzle readings available for this shift.
                  </td>
                </tr>
              ) : (
                visibleReadings.map((item, rowNum) => {
                  const index = item.originalIndex;
                  const isCng = item.record.fuelType === 'CNG';
                  const nozzleActive = nozzleMap.get(item.row.nozzleId)?.isActive !== false;
                  const isNozzleInactive = !nozzleActive && !item.hasAcceptedClosing;
                  // Clean display names: strip brackets and extra descriptions.
                  // Pump shows only number (header already says "Pump").
                  const cleanPumpName = (item.record.pumpNameSnapshot || '')
                    .replace(/\s*\(.*?\)\s*/g, '')
                    .replace(/^pump\s*/i, '')
                    .trim() || item.record.pumpNameSnapshot;
                  const cleanNozzleName = (item.record.nozzleNameSnapshot || '').replace(/\s*\(.*?\)\s*/g, '').trim() || item.record.nozzleNameSnapshot;

                  return (
                    <tr
                      key={item.row.readingId}
                      className={`hover:bg-slate-50/60 transition-colors ${item.error ? 'bg-rose-50/40' : ''}`}
                    >
                      {/* Keep each additional reading identified under its nozzle. */}
                      <td data-label="Pump / Nozzle" className="daily-nozzle">
                        <span className="sr-only">Row {rowNum + 1}. </span>
                        <strong>Pump {cleanPumpName}</strong>
                        <span>{cleanNozzleName}</span>
                        {(item.row.readingSequence || 1) > 1 && (
                          <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600">
                            Rd#{item.row.readingSequence}
                          </span>
                        )}
                      </td>

                      {/* Fuel Type Badge */}
                      <td data-label="Fuel" className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${
                            isCng
                              ? 'bg-purple-100 text-purple-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {isCng ? 'CNG' : 'Petrol'}
                        </span>
                      </td>

                      {/* Opening Meter */}
                      <td data-label="Opening Meter" className="py-3.5 px-4 text-right">
                        <div className="daily-opening">
                          <span className="font-mono font-bold text-slate-700 text-sm">
                            {item.record.openingMeter.toLocaleString('en-US')}
                          </span>
                          {!isClosed && !item.hasAcceptedClosing && (
                            <button
                              type="button"
                              onClick={() => handleOpenOverrideDialog(index)}
                              className="daily-opening-edit"
                              aria-label={`Override opening meter for ${cleanNozzleName}, reading ${item.row.readingSequence || 1}`}
                              title="Override opening meter"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Closing Meter */}
                      <td data-label="Closing Meter" className="py-3.5 px-4 text-right">
                        {item.hasAcceptedClosing ? (
                          <span className="font-mono font-bold text-slate-900 text-sm">
                            {item.record.closingMeter.toLocaleString('en-US')}
                          </span>
                        ) : (
                          <div className="daily-closing">
                            <input
                              id={`closing-meter-${index}`}
                              aria-label={`Closing meter for Pump ${cleanPumpName}, ${cleanNozzleName}, reading ${item.row.readingSequence || 1}`}
                              aria-invalid={!!item.error}
                              aria-describedby={item.error ? `reading-error-${index}` : undefined}
                              type="text"
                              inputMode="numeric"
                              maxLength={10}
                              value={item.row.closingMeterStr}
                              onChange={(e) => handleClosingMeterChange(index, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  // Employee is optional now - no employeeId check.
                                  // v63: also block while a save is in flight (double-accept race).
                                  if (item.hasEnteredClosing && !item.error && !isClosed && !isNozzleInactive && !savingRef.current) {
                                    handleAcceptClosing(index);
                                  }
                                }
                              }}
                              placeholder={String(item.record.openingMeter)}
                              disabled={isClosed || isNozzleInactive}
                              title={isNozzleInactive ? "Nozzle is inactive" : undefined}
                              className="daily-closing-input"
                            />
                            <button
                              type="button"
                              onClick={() => handleAcceptClosing(index)}
                              disabled={!item.hasEnteredClosing || !!item.error || isClosed || isSaving || isNozzleInactive}
                              title={isNozzleInactive ? "Nozzle is inactive. Turn it on from Pumps & Nozzles." : undefined}
                              className="daily-save"
                            >
                              {isSaving ? '…' : 'Save'}
                            </button>
                          </div>
                        )}
                        {item.error && <p id={`reading-error-${index}`} className="daily-reading-error">{item.error}</p>}
                      </td>

                      {/* Quantity (L) */}
                      <td data-label="Sold" className="py-3.5 px-4 text-right font-mono font-bold text-slate-900 text-sm">
                        {item.hasAcceptedClosing
                          ? item.record.quantitySold.toFixed(1)
                          : (item.hasEnteredClosing && !item.error ? Math.max(0, Number(item.row.closingMeterStr) - item.record.openingMeter).toFixed(1) : '0.0')}
                        {' '}{isCng ? 'kg' : 'L'}
                      </td>

                      {/* Amount (Rs) - litres × rate, live as closing is typed */}
                      {/* v79: Use formatCurrency for paisa precision (developer audit fix) */}
                      <td data-label="Amount (Rs)" className="py-3.5 px-4 text-right font-mono font-bold text-emerald-700 text-sm">
                        {item.hasAcceptedClosing
                          ? formatCurrency(item.record.salesAmount)
                          : (item.hasEnteredClosing && !item.error
                              ? formatCurrency(Math.max(0, Number(item.row.closingMeterStr) - item.record.openingMeter) * item.record.rate)
                              : '-')}
                      </td>

                      {/* Time */}
                      <td data-label="Time" className="py-3.5 px-4 text-center text-sm font-medium text-slate-600">
                        {(() => {
                          const t = item.row.closingAcceptedAt || item.row.readingTime;
                          if (!t) return '-';
                          try {
                            const d = new Date(t);
                            return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                          } catch {
                            return '-';
                          }
                        })()}
                      </td>

                      {/* Status */}
                      <td data-label="Status" className="py-3.5 px-4 text-center">
                        {item.hasAcceptedClosing ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Accepted
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-bold">
                            <Clock className="w-3.5 h-3.5" />
                            Pending
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td data-label="Actions" className="py-3.5 px-4 text-center">
                        <div className="daily-reading-actions">
                          <button
                            type="button"
                            onClick={() => {
                              if (item.hasAcceptedClosing) {
                                handleRequestEditAcceptedClosing(index);
                              } else {
                                document.getElementById(`closing-meter-${index}`)?.focus();
                              }
                            }}
                            disabled={isClosed}
                            className="daily-icon-button"
                            aria-label={item.hasAcceptedClosing ? 'Edit accepted reading' : 'Edit closing meter'}
                            title={item.hasAcceptedClosing ? 'Edit accepted reading' : 'Edit closing meter'}
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          {(() => {
                            // v81: Cash button states - pending (outline) vs fully-paid (filled + disabled, visible from far).
                            // v83: Overpaid (received > sale) is also disabled, but shown distinctly - it is NOT "fully paid".
                            const rc = readingCash(item.record, cashDeposits);
                            const remainingCash = remainingCashForReading(item.record.salesAmount, rc.received, dayRemaining);
                            const overpaid = item.hasAcceptedClosing && remainingCash < -0.001;
                            const fullyPaid = udhaarReady && item.hasAcceptedClosing && !overpaid && remainingCash <= 0.001;
                            // Canonical requirement: fully-paid cash is display-only,
                            // solid green and disabled. Do not enable clicking to view it.
                            const cashDone = fullyPaid || overpaid;
                            const overpaidBy = overpaid ? formatCurrency(-remainingCash) : '';
                            return (
                              <button type="button" aria-label={!udhaarReady ? 'Waiting for credit total' : overpaid ? 'Overpaid by ' + overpaidBy : (fullyPaid ? 'Cash settled' : 'Receive cash for this reading')} title={!udhaarReady ? 'Wait for the credit total before receiving cash' : overpaid ? 'Overpaid by ' + overpaidBy : (fullyPaid ? 'Cash settled' : (item.hasAcceptedClosing ? 'Receive cash for this reading' : 'Save reading before receiving cash'))} disabled={!udhaarReady || isClosed || isSaving || !item.hasAcceptedClosing || cashDone}
                                onClick={cashDone ? undefined : () => { setDepositReadingId(item.row.readingId!); setDepositNozzleId(item.row.nozzleId); setDepositFuelType(item.record.fuelType); setNewDepositAmountStr(''); setNewDepositNote(''); setDepositError(null); setShowCashModal(true); }}
                                className={overpaid
                                  ? "daily-icon-button daily-cash-overpaid"
                                  : fullyPaid
                                  ? "daily-icon-button daily-cash-settled"
                                  : "daily-icon-button"}><Coins className="w-4 h-4" /></button>
                            );
                          })()}
                          {item.hasAcceptedClosing && !isClosed && !isNozzleInactive && (
                            <button
                              type="button"
                              onClick={() => handleAddReading(item.row.nozzleId, item.row.shiftId)}
                              className="daily-icon-button"
                              aria-label={`Add next reading for Pump ${cleanPumpName}, ${cleanNozzleName}`}
                              title="Add next reading for this nozzle"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Card Footer */}
        <div className="daily-readings-footer">
          Showing {visibleReadings.length} of {totalVisibleRecords} records
        </div>
      </section>

      {/* Bottom Action Cards */}
      <div className="daily-operation-cards">
        
        {/* Expenses */}
        <div className="daily-operation-card">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800 shrink-0">
              <Receipt className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Expenses</h3>
              <p className="text-xs font-medium text-slate-500">Add station expenses</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => !isClosed && setShowExpenseModal(true)}
            disabled={isClosed}
            className="daily-card-button"
          >
            <Plus className="h-4 w-4" />
            Add Expense
          </button>
        </div>

        {/* Udhaar (credit) - only for users with FUEL "credit" permission */}
        {canGiveUdhaar && (
          <div className="daily-operation-card">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-100 text-amber-800 shrink-0">
                <Clock className="h-5 w-5" />
              </div>
              <div>
                {/* v80: "Udhaar" renamed to "Credit" (Sammy's request) */}
                <h3 className="text-sm font-bold text-slate-900">Credit</h3>
                <p className="text-xs font-medium text-slate-500">Record fuel given on credit</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => !isClosed && setShowUdhaarModal(true)}
              disabled={isClosed}
              className="daily-card-button"
            >
              <Plus className="h-4 w-4" />
              Add Credit
            </button>
          </div>
        )}

        {/* Credit total status: loading/error indicator with retry */}
        {(udhaarLoading || udhaarFetchError) && (
          <div className={`rounded-2xl border p-4 shadow-sm flex items-center justify-between ${udhaarFetchError ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-slate-50'}`}>
            <p className={`text-xs font-bold ${udhaarFetchError ? 'text-red-700' : 'text-slate-600'}`}>
              {udhaarLoading ? 'Loading credit total…' : 'Could not load credit total. Expected cash may be wrong.'}
            </p>
            {udhaarFetchError && !udhaarLoading && (
              <button
                type="button"
                onClick={retryUdhaarFetch}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 cursor-pointer"
              >
                Retry
              </button>
            )}
          </div>
        )}

        {/* End of Day */}
        <div className="daily-operation-card">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800 shrink-0">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">End of Day</h3>
              <p className="text-xs font-medium text-slate-500">Close day operations</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleRequestFinalize}
            disabled={isClosed || isSaving}
            className="daily-card-button daily-card-button-primary"
          >
            <Lock className="h-3.5 w-3.5" />
            {isClosed ? 'Closed' : 'Close Day'}
          </button>
        </div>

      </div>

      {/* Cash Handover Modal - v64: nozzle-based (no employee) */}
      {showCashModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white border border-slate-200 shadow-2xl p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Cash Handover</h3>
                <p className="mt-0.5 text-xs font-medium text-slate-500">Record cash received for a nozzle</p>
              </div>
              <button type="button" onClick={() => { setShowCashModal(false); setDepositNozzleId(''); setDepositError(null); }} className="text-slate-400 hover:text-slate-900 text-xl font-bold cursor-pointer">
                ×
              </button>
            </div>

            <form onSubmit={handleRequestAddDeposit} className="mt-5 space-y-4">
              {depositError && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-bold text-rose-700">
                  {depositError}
                </div>
              )}

              {/* Fuel type toggle */}
              {(() => {
                const item = calculatedReadings.find(item => item.row.readingId === depositReadingId);
                if (!item) return <p role="alert">Reading unavailable. Close and reopen this popup.</p>;
                const cash = readingCash(item.record, cashDeposits);
                // v80: Clean names to match readings table (Sammy's request)
                const cleanPump = (item.record.pumpNameSnapshot || '').replace(/\s*\(.*?\)\s*/g, '').replace(/^pump\s*/i, '').trim() || item.record.pumpNameSnapshot;
                const cleanNozzle = (item.record.nozzleNameSnapshot || '').replace(/\s*\(.*?\)\s*/g, '').trim() || item.record.nozzleNameSnapshot;
                // v81: Fully-paid state - show banner, lock inputs.
                // v83: Overpaid (received > sale) is shown distinctly, not as "fully paid".
                const remaining = remainingCashForReading(item.record.salesAmount, cash.received, dayRemaining);
                const overpaid = remaining < -0.001;
                const fullyPaid = !overpaid && remaining <= 0.001;
                const bannerClass = overpaid
                  ? "rounded-lg border border-red-200 bg-red-50 p-4 space-y-2"
                  : "rounded-lg border border-emerald-200 bg-emerald-50 p-4 space-y-2";
                return <div className={bannerClass}>
                  <p className="font-bold">Pump {cleanPump} - {cleanNozzle} · Reading {item.row.readingSequence}</p>
                  <p className="text-lg font-bold">Sale: {formatCurrency(item.record.salesAmount)}</p>
                  <p>Cash received for this reading: {formatCurrency(cash.received)}</p>
                  {overpaid ? (
                    <p className="font-bold text-red-700">Overpaid by {formatCurrency(-remaining)} - no more cash can be collected.</p>
                  ) : fullyPaid ? (
                    <p className="font-bold text-emerald-700">Cash settled - nothing more to collect.</p>
                  ) : (
                    <p>Cash still to collect: {formatCurrency(remaining)}</p>
                  )}
                  {cash.legacy > 0 && <p className="text-xs text-amber-800">Earlier nozzle cash: {formatCurrency(cash.legacy)} (not assigned to a reading). Check this before receiving more.</p>}
                </div>;
              })()}

              {(() => {
                // v81: Lock the form when the reading is fully paid.
                // v83: Overpaid readings are also locked (no more cash can be collected).
                const item = calculatedReadings.find(item => item.row.readingId === depositReadingId);
                const remaining = item ? remainingCashForReading(item.record.salesAmount, readingCash(item.record, cashDeposits).received, dayRemaining) : 0;
                const overpaid = item ? remaining < -0.001 : false;
                const fullyPaid = item ? !overpaid && remaining <= 0.001 : false;
                const cashDone = fullyPaid || overpaid;
                const lockedLabel = overpaid ? "Overpaid - no more cash" : "Cash settled";
                return (
              <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Cash Received (PKR)</label>
                <input
                  type="number"
                  step="0.01" min="0.01" required
                  max={cashDone ? 0 : Math.max(0, remaining)}
                  value={newDepositAmountStr}
                  onChange={(e) => setNewDepositAmountStr(e.target.value)}
                  placeholder={cashDone ? lockedLabel : "50000"}
                  disabled={cashDone || isClosed}
                  className="w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-right text-sm font-mono font-bold text-slate-900 focus:border-emerald-500 outline-none disabled:bg-slate-100 disabled:text-slate-400"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Note (Optional)</label>
                <textarea
                  rows={2}
                  value={newDepositNote}
                  onChange={(e) => setNewDepositNote(e.target.value)}
                  placeholder="Optional note"
                  disabled={cashDone || isClosed}
                  className="w-full rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-900 focus:border-emerald-500 outline-none resize-none disabled:bg-slate-100 disabled:text-slate-400"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowCashModal(false)} className="h-10 px-4 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer">
                  Cancel
                </button>
                <button type="submit" disabled={isSaving || cashDone} className="h-10 px-5 rounded-lg bg-emerald-700 text-white text-xs font-bold hover:bg-emerald-800 transition-colors cursor-pointer disabled:bg-slate-300">
                  Save Cash
                </button>
              </div>
              </div>
                );
              })()}
            </form>
          </div>
        </div>
      )}

      {/* Expense Modal */}
      {showExpenseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white border border-slate-200 shadow-2xl p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Add Expense</h3>
                <p className="mt-0.5 text-xs font-medium text-slate-500">Automatically deducted from expected cash</p>
              </div>
              <button type="button" onClick={() => setShowExpenseModal(false)} className="text-slate-400 hover:text-slate-900 text-xl font-bold cursor-pointer">
                ×
              </button>
            </div>

            <form onSubmit={handleAddExpense} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Description</label>
                <input
                  type="text"
                  value={newExpenseDesc}
                  onChange={(e) => setNewExpenseDesc(e.target.value)}
                  placeholder="Expense description"
                  className="w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-900 focus:border-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Category</label>
                <select
                  value={newExpenseCat}
                  onChange={(e) => setNewExpenseCat(e.target.value as ExpenseCategory)}
                  className="w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-900 focus:border-emerald-500 outline-none cursor-pointer"
                >
                  {EXPENSE_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Amount (PKR)</label>
                <input
                  type="number"
                  value={newExpenseAmount}
                  onChange={(e) => setNewExpenseAmount(e.target.value)}
                  placeholder="5000"
                  className="w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-right text-sm font-mono font-bold text-slate-900 focus:border-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Note (Optional)</label>
                <textarea
                  rows={2}
                  value={newExpenseNote}
                  onChange={(e) => setNewExpenseNote(e.target.value)}
                  placeholder="Optional note"
                  className="w-full rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-900 focus:border-emerald-500 outline-none resize-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowExpenseModal(false)} className="h-10 px-4 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer">
                  Cancel
                </button>
                <button type="submit" disabled={isSaving} className="h-10 px-5 rounded-lg bg-emerald-700 text-white text-xs font-bold hover:bg-emerald-800 disabled:bg-slate-300 transition-colors cursor-pointer">
                  {isSaving ? 'Saving…' : 'Add Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Udhaar Modal */}
      {showUdhaarModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white border border-slate-200 shadow-2xl p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Add Credit</h3>
                <p className="mt-0.5 text-xs font-medium text-slate-500">Fuel given on credit - reduces expected cash, adds to customer accounts</p>
              </div>
              <button type="button" onClick={() => setShowUdhaarModal(false)} className="text-slate-400 hover:text-slate-900 text-xl font-bold cursor-pointer">
                ×
              </button>
            </div>

            <form onSubmit={handleAddUdhaarSubmit} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Customer</label>
                <select
                  value={udhaarCustomer}
                  onChange={(e) => setUdhaarCustomer(e.target.value)}
                  className="w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-900 focus:border-emerald-500 outline-none cursor-pointer"
                >
                  <option value="">Select customer</option>
                  {customers.filter(c => c.active !== false).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Amount (PKR)</label>
                <input
                  type="number"
                  value={udhaarAmount}
                  onChange={(e) => setUdhaarAmount(e.target.value)}
                  placeholder="15000"
                  min="0"
                  step="0.01"
                  className="w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-right text-sm font-mono font-bold text-slate-900 focus:border-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Note (Optional)</label>
                <textarea
                  rows={2}
                  value={udhaarNote}
                  onChange={(e) => setUdhaarNote(e.target.value)}
                  placeholder="e.g. Ahmed aaya - 40 litre"
                  className="w-full rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-900 focus:border-emerald-500 outline-none resize-none"
                />
              </div>

              {udhaarError && (
                <p className="text-xs font-bold text-red-600">{udhaarError}</p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowUdhaarModal(false)} className="h-10 px-4 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer">
                  Cancel
                </button>
                <button type="submit" disabled={udhaarSaving} className="h-10 px-5 rounded-lg bg-emerald-700 text-white text-xs font-bold hover:bg-emerald-800 disabled:bg-slate-300 transition-colors cursor-pointer">
                  {udhaarSaving ? 'Saving…' : 'Add Credit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Accepted Reading Modal */}
      {editingAcceptedRow !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Edit Accepted Reading</h3>
            <p className="text-xs font-medium text-slate-500">The saved reading stays locked until this correction is saved. Enter the corrected closing and a reason, then confirm.</p>
            <label className="block text-sm font-bold">Corrected closing meter<input type="number" step="any" value={correctedClosing} onChange={e => setCorrectedClosing(e.target.value)} className="block w-full border rounded-lg p-3" /></label>
            {correctionError && <p role="alert" className="text-sm text-red-700">{correctionError}</p>}
            <textarea
              value={acceptedEditReason}
              onChange={(e) => setAcceptedEditReason(e.target.value)}
              rows={3}
              placeholder="Reason for correction"
              className="w-full border border-slate-200 rounded-lg p-3 text-xs text-slate-900 focus:border-emerald-500 outline-none resize-none"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setEditingAcceptedRow(null)} className="h-10 px-4 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer">
                Cancel
              </button>
              <button
                onClick={handleConfirmEditAcceptedClosing}
                disabled={isSaving || !acceptedEditReason.trim() || correctedClosing.trim() === ''}
                className="h-10 px-5 rounded-lg bg-emerald-700 text-white text-xs font-bold disabled:bg-slate-200 disabled:text-slate-400 hover:bg-emerald-800 transition-colors cursor-pointer"
              >
                Save correction
              </button>
            </div>
          </div>
        </div>
      )}

      {deletingReadingRow !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-red-900">Delete Reading</h3>
            <p className="text-xs font-medium text-slate-500">This will permanently remove this reading. Enter a reason, then confirm.</p>
            <textarea
              value={deleteReadingReason}
              onChange={(e) => setDeleteReadingReason(e.target.value)}
              rows={3}
              placeholder="Reason for deletion"
              className="w-full border border-slate-200 rounded-lg p-3 text-xs text-slate-900 focus:border-red-500 outline-none resize-none"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setDeletingReadingRow(null)} className="h-10 px-4 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer">
                Cancel
              </button>
              <button
                onClick={handleConfirmDeleteReading}
                disabled={!deleteReadingReason.trim()}
                className="h-10 px-5 rounded-lg bg-red-700 text-white text-xs font-bold disabled:bg-slate-200 disabled:text-slate-400 hover:bg-red-800 transition-colors cursor-pointer"
              >
                Delete reading
              </button>
            </div>
          </div>
        </div>
      )}

      <CannotCloseDayModal
        isOpen={showCannotCloseModal}
        missingItems={missingRequirementsForModal}
        onClose={() => setShowCannotCloseModal(false)}
        onItemClick={(item) => {
          if (item.rowIndex === undefined || item.rowIndex < 0) return;
          setShowCannotCloseModal(false);
          // Clear fuel filter so the target row is visible.
          setActiveFuelTab('ALL');
          // Switch to the correct shift tab if needed.
          const row = rows[item.rowIndex];
          if (row && activeShifts.length > 1) {
            setActiveShiftTab(row.shiftId);
          }
          // Scroll to and focus the closing meter input after a brief delay.
          setTimeout(() => {
            const input = document.getElementById(`closing-meter-${item.rowIndex}`);
            if (input) {
              input.scrollIntoView({ behavior: 'smooth', block: 'center' });
              input.focus();
            }
          }, 100);
        }}
      />


      <PrintDailySheetModal
  isOpen={showPrintModal}
  record={savedFinalOperation || activeOperationToEdit || null}
  station={station}
  employees={employees}
  onClose={() => setShowPrintModal(false)}
/>

      {/* Override Opening Meter Modal */}
      {overrideModalRowIndex !== null && (
        <div className="fixed inset-0 bg-slate-950/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-slate-900">Override Opening Meter</h3>
            <p className="text-xs font-medium text-slate-500">
              Enter updated opening reading and a reason.
            </p>
            <form onSubmit={handleConfirmOverrideSubmit} className="space-y-4">
              {overrideError && (
                <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-800">
                  <span>{overrideError}</span>
                </div>
              )}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">New Opening Meter</label>
                <input
                  type="number"
                  step="any"
                  value={overrideMeterVal}
                  onChange={(e) => setOverrideMeterVal(e.target.value)}
                  className="w-full h-10 bg-white border border-slate-200 rounded-lg px-3 text-sm font-mono font-bold text-slate-900 outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Reason for Override</label>
                <textarea
                  rows={2}
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="Dispenser reset or physical meter correction"
                  className="w-full bg-white border border-slate-200 rounded-lg p-3 text-xs text-slate-900 outline-none focus:border-emerald-500 resize-none"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setOverrideModalRowIndex(null)}
                  className="h-10 px-4 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="h-10 px-5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs rounded-lg transition-colors cursor-pointer"
                >
                  Confirm Override
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
