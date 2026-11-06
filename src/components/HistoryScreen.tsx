import { useMemo, useState } from 'react';
import { PageHeader } from './ui';
import '../styles/fuel-management.css';
import '../styles/fuel-records.css';
import { saveErrorText, type SaveResult } from '../logic/saveResult';
import { DailyOperation, StationConfig, StationConfigUpdate, Pump, Nozzle, Employee, RateChangeRecord } from '../types';
import {
  formatCurrency,
  calculateCumulativeClosedTotals,
  getPakistanLocalDate,
} from '../logic/calculations';
import { StatusBadge } from './StatusBadge';
import { PrintDailySheetModal } from './PrintDailySheetModal';
import {
  History,
  Calendar,
  Eye,
  Printer,
  Unlock,
  FileSpreadsheet,
  FileText,
  Fuel,
  Receipt,
  Trash2,
  Coins,
  X,
  ArrowLeft,
  Search,
  RefreshCw,
  ChevronDown,
  Filter,
} from 'lucide-react';

interface HistoryScreenProps {
  operations: DailyOperation[];
  station: StationConfig;
  pumps: Pump[];
  nozzles: Nozzle[];
  employees: Employee[];
  rateChanges?: RateChangeRecord[];
  onUnlockOperationForEdit?: (op: DailyOperation) => void;
  onUpdateOperation?: (op: DailyOperation) => Promise<SaveResult> | void;
  onUpdateStationConfig?: (update: StationConfigUpdate) => Promise<SaveResult> | void;
  onNavigateBack?: () => void;
  // v115: Export permission - hide buttons if user lacks permission.
  // v116: Separate print/csv permissions.
  canPrint?: boolean;
  canExportCsv?: boolean;
}

type ReportType = 'FUEL' | 'EXPENSES' | 'ALL';
type DatePreset = 'TODAY' | 'WEEK' | 'MONTH' | 'CUSTOM';
type ShiftFilter = 'ALL' | string;
type FuelTypeFilter = 'ALL' | 'PETROL' | 'CNG';

const pad = (n: number) => String(n).padStart(2, '0');
const toDateInput = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const pakistanToday = () => getPakistanLocalDate();

const escapeCsv = (value: unknown) =>
  `"${String(value ?? '').replace(/"/g, '""')}"`;

const escapeHtml = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[c] || c)
  );

const formatReportDate = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;

  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

export function HistoryScreen({
  operations,
  station,
  pumps: _pumps,
  nozzles: _nozzles,
  employees,
  rateChanges = [],
  onUnlockOperationForEdit,
  onUpdateOperation,
  onUpdateStationConfig,
  onNavigateBack,
  canPrint = true,
  canExportCsv = true,
}: HistoryScreenProps) {
  const [selectedDateForDetail, setSelectedDateForDetail] =
    useState<string | null>(null);

  // Rate changes for the currently viewed day (newest first).
  const dayRateChanges = (selectedDateForDetail
    ? rateChanges.filter((rc) => rc.businessDate === selectedDateForDetail)
    : []
  ).slice().sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const [selectedOperationForPrint, setSelectedOperationForPrint] =
    useState<DailyOperation | null>(null);

  const [operationToUnlock, setOperationToUnlock] =
    useState<DailyOperation | null>(null);

  const [showUnlockReasonModal, setShowUnlockReasonModal] = useState(false);
  const [unlockReason, setUnlockReason] = useState('');

  const [expenseToDelete, setExpenseToDelete] = useState<{
    operation: DailyOperation;
    expenseId: string;
    description: string;
    amount: number;
  } | null>(null);

  const [deleteExpenseReason, setDeleteExpenseReason] = useState('');
  const [showDeleteExpenseReasonModal, setShowDeleteExpenseReasonModal] =
    useState(false);
  const [deleteExpenseError, setDeleteExpenseError] = useState<string | null>(null);


  const [reportType, setReportType] = useState<ReportType>('ALL');
  const [datePreset, setDatePreset] = useState<DatePreset>('MONTH');
  const [shiftFilter, setShiftFilter] = useState<ShiftFilter>('ALL');
  const [fuelTypeFilter, setFuelTypeFilter] = useState<FuelTypeFilter>('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  const [fromDate, setFromDate] = useState(pakistanToday());
  const [toDate, setToDate] = useState(pakistanToday());

  const cumulativeTotals = useMemo(
    () => calculateCumulativeClosedTotals(operations),
    [operations],
  );

  // ============ FILTERED OPERATIONS ============
  const filteredOperations = useMemo(() => {
    const todayStr = pakistanToday();
    const today = new Date(`${todayStr}T12:00:00`);

    let from = fromDate;
    let to = toDate;

    if (datePreset === 'TODAY') {
      from = to = toDateInput(today);
    }

    if (datePreset === 'WEEK') {
      const start = new Date(today);
      const day = start.getDay();
      start.setDate(start.getDate() - (day === 0 ? 6 : day - 1));
      from = toDateInput(start);
      to = toDateInput(today);
    }

    if (datePreset === 'MONTH') {
      from = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`;
      to = toDateInput(today);
    }

    return operations
      .filter((op) => {
        if (op.status !== 'CLOSED' && !op.nozzleReadings.some(r => r.closingAccepted) && !(op.cashDeposits || []).length && !op.expenses.length) return false;
        if (op.businessDate < from || op.businessDate > to) return false;

        // Shift filter
        if (shiftFilter !== 'ALL') {
          const hasShift = (op.nozzleReadings || []).some(
            (r) => r.shiftId === shiftFilter,
          );
          if (!hasShift) return false;
        }

        // Fuel type filter
        if (fuelTypeFilter !== 'ALL') {
          const hasFuelType = (op.nozzleReadings || []).some(
            (r) => r.fuelType === fuelTypeFilter,
          );
          if (!hasFuelType && !Number(op.manualSummary?.fuel?.[fuelTypeFilter]?.quantity || 0)) return false;
        }

        // Search
        if (searchTerm.trim()) {
          const query = searchTerm.toLowerCase();
          const dateMatch = op.businessDate.toLowerCase().includes(query);
          const shiftMatch = (op.nozzleReadings || []).some((r) =>
            r.shiftNameSnapshot.toLowerCase().includes(query),
          );
          if (!dateMatch && !shiftMatch) return false;
        }

        return true;
      })
      .sort((a, b) => b.businessDate.localeCompare(a.businessDate));
  }, [
    operations,
    datePreset,
    fromDate,
    toDate,
    shiftFilter,
    fuelTypeFilter,
    searchTerm,
  ]);

  // ============ ACTIVE SHIFTS & FUEL TYPES FOR FILTERS ============
  const availableShifts = useMemo(() => {
    const set = new Map<string, string>();
    operations
      .forEach((op) => {
        (op.nozzleReadings || []).forEach((r) => {
          if (r.shiftId && r.shiftNameSnapshot) {
            set.set(r.shiftId, r.shiftNameSnapshot);
          }
        });
      });
    return Array.from(set.entries()).map(([id, name]) => ({ id, name }));
  }, [operations]);

  // ============ DETAIL DATA FOR SELECTED DAY ============
  const selectedDay = useMemo(() => {
    if (!selectedDateForDetail) return null;

    const dayOperations = operations.filter(
      (op) =>
        op.businessDate === selectedDateForDetail,
    );

    const fuel = dayOperations.flatMap((op) =>
      (op.nozzleReadings || [])
        .filter((r) => r.closingAccepted === true)
        .map((r) => ({ op, r })),
    );

    const expenses = dayOperations.flatMap((op) =>
      (op.expenses || []).map((expense) => ({ op, expense })),
    );

    const cash = dayOperations.flatMap((op) =>
      (op.cashDeposits || []).map((deposit) => ({ op, deposit })),
    );

    return {
      dayOperations,
      fuel,
      expenses,
      cash,
      sales: fuel.reduce((s, x) => s + x.r.salesAmount, dayOperations.filter(op=>op.manualSummary).reduce((n,op)=>n+op.grossSales,0)),
      litres: fuel.reduce((s, x) => s + x.r.quantitySold, dayOperations.filter(op=>op.manualSummary).reduce((n,op)=>n+op.totalQuantity,0)),
      expenseTotal: expenses.reduce((s, x) => s + x.expense.amount, 0),
      cashTotal: cash.reduce((s, x) => s + x.deposit.amount, dayOperations.filter(op=>op.manualSummary).reduce((n,op)=>n+Number(op.manualSummary?.cashCollected||0),0)),
    };
  }, [selectedDateForDetail, operations]);

  // ============ ROW CALCULATIONS ============
  const getRowData = (op: DailyOperation) => {
    if (op.manualSummary) {
      const rows=Object.entries(op.manualSummary.fuel).filter(([fuel])=>fuelTypeFilter==='ALL'||fuelTypeFilter===fuel);
      const totalSales=rows.reduce((n,[,r])=>n+Number(r?.amount||0),0), totalQty=rows.reduce((n,[,r])=>n+Number(r?.quantity||0),0);
      return {totalSales,totalQty,totalExpenses:op.totalExpenses,netAfterExpenses:totalSales-op.totalExpenses,shiftLabel:'Manual daily summary'};
    }
    const readings = (op.nozzleReadings || []).filter(
      (r) => r.closingAccepted === true,
    );

    // Filter by shift / fuel type
    let filtered = readings;
    if (shiftFilter !== 'ALL') {
      filtered = filtered.filter((r) => r.shiftId === shiftFilter);
    }
    if (fuelTypeFilter !== 'ALL') {
      filtered = filtered.filter((r) => r.fuelType === fuelTypeFilter);
    }

    const totalSales = filtered.reduce((s, r) => s + r.salesAmount, 0);
    const totalQty = filtered.reduce((s, r) => s + r.quantitySold, 0);
    const totalExpenses = op.totalExpenses || 0;
    const netAfterExpenses = totalSales - totalExpenses;

    // Shift label
    const shiftNames = [...new Set(filtered.map((r) => r.shiftNameSnapshot))];
    const shiftLabel =
      shiftNames.length === 0
        ? '-'
        : shiftNames.length === 1
        ? shiftNames[0]
        : 'Multiple';

    return { totalSales, totalQty, totalExpenses, netAfterExpenses, shiftLabel };
  };

  // ============ EXPORT CSV ============
  const exportCsv = () => {
    const lines: string[] = [];

    lines.push(
      [
        escapeCsv('Date'),
        escapeCsv('Shift'),
        escapeCsv('Total Fuel Sales'),
        escapeCsv('Total Quantity (L)'),
        escapeCsv('Total Expenses'),
        escapeCsv('Net After Expenses'),
        escapeCsv('Status'),
      ].join(','),
    );

    filteredOperations.forEach((op) => {
      const row = getRowData(op);
      lines.push(
        [
          escapeCsv(op.businessDate),
          escapeCsv(row.shiftLabel),
          escapeCsv(row.totalSales.toFixed(2)),
          escapeCsv(row.totalQty.toFixed(3)),
          escapeCsv(row.totalExpenses.toFixed(2)),
          escapeCsv(row.netAfterExpenses.toFixed(2)),
          escapeCsv(op.status === 'CLOSED' ? 'Closed' : 'Open'),
        ].join(','),
      );
    });

    const blob = new Blob([lines.join('\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fuel-station-history-${fromDate}-to-${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ============ PRINT REPORT ============
  const printReport = () => {
    const rowsHtml = filteredOperations
      .map((op) => {
        const row = getRowData(op);
        return `<tr><td>${escapeHtml(
          formatReportDate(op.businessDate),
        )}</td><td>${escapeHtml(row.shiftLabel)}</td><td>${escapeHtml(
          row.totalSales.toFixed(2),
        )}</td><td>${escapeHtml(
          row.totalQty.toFixed(3),
        )}</td><td>${escapeHtml(
          row.totalExpenses.toFixed(2),
        )}</td><td>${escapeHtml(
          row.netAfterExpenses.toFixed(2),
        )}</td><td>${op.status === 'CLOSED' ? 'Closed' : 'Open'}</td></tr>`;
      })
      .join('');

    const w = window.open('', '_blank', 'width=1200,height=800');
    if (!w) return;

    w.document.write(
      `<!doctype html><html><head><title>Daily Operation History</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#111}h1{margin:0 0 4px;font-size:22px}h2{margin-top:28px;font-size:18px}p{color:#555;font-size:12px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #bbb;padding:6px;text-align:left}th:nth-child(n+3),td:nth-child(n+3){text-align:right}</style></head><body><h1>${escapeHtml(
        station.stationName,
      )} | Daily Operation History</h1><p>Generated: ${escapeHtml(
        new Date().toLocaleString(),
      )}</p><table><thead><tr><th>Date</th><th>Shift</th><th>Total Fuel Sales</th><th>Total Quantity (L)</th><th>Total Expenses</th><th>Net After Expenses</th><th>Status</th></tr></thead><tbody>${rowsHtml}</tbody></table></body></html>`,
    );

    w.document.close();
    w.focus();
    w.print();
  };

  // ============ UNLOCK ============
  const requestUnlock = (op: DailyOperation) => {
    if (op.status === 'OPEN') { onUnlockOperationForEdit?.(op); return; }
    setOperationToUnlock(op);
    setUnlockReason('');
    setShowUnlockReasonModal(true);
  };

  const confirmUnlock = () => {
    if (!operationToUnlock || !unlockReason.trim()) return;
    setShowUnlockReasonModal(false);
    if (operationToUnlock && onUnlockOperationForEdit) {
      onUnlockOperationForEdit({
        ...operationToUnlock,
        lastEditReason: unlockReason.trim(),
      });
    }
    setOperationToUnlock(null);
  };

  // ============ DELETE EXPENSE ============
  const requestDeleteExpense = (
    op: DailyOperation,
    expenseId: string,
    description: string,
    amount: number,
  ) => {
    setExpenseToDelete({ operation: op, expenseId, description, amount });
    setDeleteExpenseReason('');
    setDeleteExpenseError(null);
    setShowDeleteExpenseReasonModal(true);
  };

  const confirmDeleteExpense = () => {
    if (!expenseToDelete || !deleteExpenseReason.trim()) return;
    setShowDeleteExpenseReasonModal(false);
    void handleDeleteExpense();
  };

  const handleDeleteExpense = async () => {
    if (!expenseToDelete || !onUpdateOperation) return;

    const target = expenseToDelete;
    const reason = deleteExpenseReason.trim();
    // Await the database: the reason is only cleared after the save confirms.
    const result = await onUpdateOperation({
      ...target.operation,
      expenses: (target.operation.expenses || []).filter(
        (expense) => expense.id !== target.expenseId,
      ),
      lastEditReason: `Expense deleted: ${reason}`,
    });
    if (!result || !result.ok) {
      // Keep the reason and the pending deletion, and re-open the reason
      // dialog so the user can retry without retyping.
      setDeleteExpenseError(
        `Delete was NOT saved: ${result ? saveErrorText(result) : 'No confirmation from the database.'}`,
      );
      setShowDeleteExpenseReasonModal(true);
      return;
    }
    setDeleteExpenseError(null);
    setExpenseToDelete(null);
    setDeleteExpenseReason('');
  };

  // ============ REFRESH ============
  const handleRefresh = () => {
    setSearchTerm('');
    setShiftFilter('ALL');
    setFuelTypeFilter('ALL');
  };

  // ============ RENDER ============
  return (
    <div
      className="fuel-management fuel-records fuel-history-screen space-y-6"
      style={{ fontFamily: 'var(--ui-font)' }}
    >
      {/* ============ PAGE HEADER ============ */}
      <div className="fuel-records-page-header">
        <PageHeader title="History" description="Find past daily records, fuel sales and reports." />
      </div>

      {/* ============ FILTERS BAR ============ */}
      <div className="fuel-records-card fuel-history-filters">
        <div className="fuel-history-filter-grid">
          {/* Date Range */}
          <div className="flex-1 min-w-[200px]">
            <label className="mb-2 block text-base font-bold text-slate-700">
              Date Range
            </label>
            <div className="relative">
              <Calendar className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <select
                value={datePreset}
                aria-label="Date range"
                onChange={(e) => setDatePreset(e.target.value as DatePreset)}
                className="w-full h-14 rounded-xl border-2 border-slate-200 bg-white pl-12 pr-10 text-lg font-bold text-slate-800 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100 cursor-pointer appearance-none"
              >
                <option value="TODAY">Today</option>
                <option value="WEEK">This Week</option>
                <option value="MONTH">This Month</option>
                <option value="CUSTOM">Custom Range</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            </div>
          </div>

          {/* Shift Filter */}
          <div className="flex-1 min-w-[180px]">
            <label className="mb-2 block text-base font-bold text-slate-700">
              Shift
            </label>
            <div className="relative">
              <Filter className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <select
                value={shiftFilter}
                aria-label="Shift"
                onChange={(e) => setShiftFilter(e.target.value)}
                className="w-full h-14 rounded-xl border-2 border-slate-200 bg-white pl-12 pr-10 text-lg font-bold text-slate-800 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100 cursor-pointer appearance-none"
              >
                <option value="ALL">All Shifts</option>
                {availableShifts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            </div>
          </div>

          {/* Fuel Type Filter */}
          <div className="flex-1 min-w-[180px]">
            <label className="mb-2 block text-base font-bold text-slate-700">
              Fuel Type
            </label>
            <div className="relative">
              <Fuel className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <select
                value={fuelTypeFilter}
                aria-label="Fuel type"
                onChange={(e) =>
                  setFuelTypeFilter(e.target.value as FuelTypeFilter)
                }
                className="w-full h-14 rounded-xl border-2 border-slate-200 bg-white pl-12 pr-10 text-lg font-bold text-slate-800 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100 cursor-pointer appearance-none"
              >
                <option value="ALL">All Fuel Types</option>
                <option value="PETROL">Petrol</option>
                <option value="CNG">CNG</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            </div>
          </div>

          {/* Refresh */}
          <button
            type="button"
            onClick={handleRefresh}
            className="fuel-action fuel-action--primary"
          >
            <RefreshCw className="h-5 w-5" />
            Reset filters
          </button>
        </div>

        {/* Custom Range Inputs */}
        {datePreset === 'CUSTOM' && (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:max-w-md">
            <div>
              <label className="mb-2 block text-base font-bold text-slate-700">
                From
              </label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full h-14 rounded-xl border-2 border-slate-200 bg-slate-50 px-5 text-lg font-medium text-slate-900 focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-100"
              />
            </div>
            <div>
              <label className="mb-2 block text-base font-bold text-slate-700">
                To
              </label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full h-14 rounded-xl border-2 border-slate-200 bg-slate-50 px-5 text-lg font-medium text-slate-900 focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-100"
              />
            </div>
          </div>
        )}
      </div>

      {/* ============ DAILY OPERATION HISTORY ============ */}
      <div className="fuel-records-card fuel-history-results">
        {/* Card Header */}
        <div className="fuel-records-toolbar fuel-history-toolbar">
          <div className="flex items-center gap-4">
            <div>
              <h2 className="text-2xl font-black text-slate-900">
                Daily Operation History
              </h2>
              <p className="mt-1 text-base font-medium text-slate-500">
                {filteredOperations.length} saved{' '}
                {filteredOperations.length === 1 ? 'record' : 'records'}
              </p>
            </div>
          </div>

          {/* Search */}
          <div className="fuel-records-search fuel-history-search">
            <Search className="h-5 w-5 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              aria-label="Search history by date or shift"
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by date or shift..."
              className="w-full bg-transparent text-lg text-slate-800 outline-none placeholder:text-slate-400"
            />
          </div>
        </div>

        {/* Table */}
        {filteredOperations.length === 0 ? (
          <div className="p-16 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-400">
              <History className="h-7 w-7" />
            </div>
            <p className="text-lg font-bold text-slate-700">
              No saved days found
            </p>
            <p className="mt-1 text-base font-medium text-slate-500">
              Change the filters or date range.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50">
                <tr className="border-b-2 border-slate-100">
                  <th className="whitespace-nowrap px-6 py-4 text-sm font-black text-slate-600 uppercase tracking-wide">
                    Date
                  </th>
                  <th className="whitespace-nowrap px-6 py-4 text-sm font-black text-slate-600 uppercase tracking-wide">
                    Shift
                  </th>
                  <th className="whitespace-nowrap px-6 py-4 text-right text-sm font-black text-slate-600 uppercase tracking-wide">
                    Total Fuel Sales
                  </th>
                  <th className="whitespace-nowrap px-6 py-4 text-right text-sm font-black text-slate-600 uppercase tracking-wide">
                    Total Quantity (L)
                  </th>
                  <th className="whitespace-nowrap px-6 py-4 text-right text-sm font-black text-slate-600 uppercase tracking-wide">
                    Total Expenses
                  </th>
                  <th className="whitespace-nowrap px-6 py-4 text-right text-sm font-black text-slate-600 uppercase tracking-wide">
                    Net After Expenses
                  </th>
                  <th className="whitespace-nowrap px-6 py-4 text-center text-sm font-black text-slate-600 uppercase tracking-wide">
                    Status
                  </th>
                  <th className="whitespace-nowrap px-6 py-4 text-center text-sm font-black text-slate-600 uppercase tracking-wide">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredOperations.map((op) => {
                  const row = getRowData(op);
                  return (
                    <tr key={op.id} className="hover:bg-slate-50/70">
                      <td className="whitespace-nowrap px-6 py-5 text-lg font-bold text-slate-800">
                        {formatReportDate(op.businessDate)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-5">
                        <span className="inline-flex items-center rounded-full bg-emerald-50 px-4 py-1.5 text-base font-bold text-emerald-700">
                          {row.shiftLabel}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-5 text-right text-lg font-bold text-slate-900">
                        {formatCurrency(row.totalSales)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-5 text-right text-lg font-bold text-slate-800">
                        {row.totalQty.toLocaleString('en-PK', {
                          maximumFractionDigits: 1,
                        })}{' '}
                        L
                      </td>
                      <td className="whitespace-nowrap px-6 py-5 text-right text-lg font-bold text-rose-600">
                        {formatCurrency(row.totalExpenses)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-5 text-right text-lg font-black text-emerald-700">
                        {formatCurrency(row.netAfterExpenses)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-5 text-center">
                        <span className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-4 py-1.5 text-base font-bold text-emerald-800">
                          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                          {op.manualSummary ? 'Closed - manual summary' : op.status === 'CLOSED' ? 'Closed' : 'Open'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-5">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => setSelectedDateForDetail(op.businessDate)}
                            className="inline-flex items-center gap-2 rounded-xl border-2 border-slate-200 bg-white px-4 py-2 text-base font-bold text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700"
                            title="View details"
                            aria-label="View details"
                          >
                            <Eye className="h-5 w-5" />
                          </button>
                          {canPrint && (
                            <button
                              onClick={() => setSelectedOperationForPrint(op)}
                              className="inline-flex items-center gap-2 rounded-xl border-2 border-slate-200 bg-white px-4 py-2 text-base font-bold text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700"
                              title="Print Report"
                              aria-label="Print report"
                            >
                            <Printer className="h-5 w-5" />
                          </button>
                          )}
                          <button
                            disabled={!!op.manualSummary}
                            onClick={() => requestUnlock(op)}
                            className="inline-flex h-11 w-11 items-center justify-center rounded-xl border-2 border-amber-200 bg-amber-50 text-amber-700 transition hover:bg-amber-100"
                            title={op.status === 'CLOSED' ? "Unlock to edit" : "Continue open day"}
                            aria-label={op.status === 'CLOSED' ? 'Unlock to edit' : 'Continue open day'}
                          >
                            <Unlock className="h-5 w-5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer */}
        <div className="border-t-2 border-slate-100 bg-slate-50 px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3 text-base">
            <span className="font-medium text-slate-600">
              Showing {filteredOperations.length} of {cumulativeTotals.count}{' '}
              records
            </span>
            <div className="flex gap-2">
              {canExportCsv && (
                <button
                  type="button"
                  onClick={exportCsv}
                  className="inline-flex items-center gap-2 rounded-xl border-2 border-slate-200 bg-white px-5 py-3 text-base font-bold text-slate-700 transition hover:bg-slate-50"
                >
                  <FileSpreadsheet className="h-5 w-5" />
                  Export
                </button>
              )}
              {canPrint && (
                <button
                  type="button"
                  onClick={printReport}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-base font-bold text-white transition hover:bg-emerald-700"
                >
                  <Printer className="h-5 w-5" />
                  Print Report
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ============ DETAIL MODAL ============ */}
      {selectedDay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border-2 border-slate-200 bg-white shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between gap-4 border-b-2 border-slate-100 px-7 py-6">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-white shrink-0">
                  <FileText className="h-7 w-7" />
                </div>
                <div>
                  <h3 className="text-2xl font-black text-slate-900">
                    Daily Report: {formatReportDate(selectedDateForDetail!)}
                  </h3>
                  <p className="mt-1 text-base font-medium text-slate-500">
                    Full records
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDateForDetail(null)}
                className="text-slate-400 hover:text-slate-900 text-3xl font-bold"
              >
                ×
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 space-y-6 overflow-y-auto p-7">
              {selectedDay.dayOperations.filter(op=>op.manualSummary).map(op=><div key={op.id} className="rounded border p-4">
                <strong>Manual register summary - individual nozzle transactions unavailable</strong>
                <p>Entered {new Date(op.manualSummary!.enteredAt).toLocaleString('en-PK',{timeZone:'Asia/Karachi'})} (Pakistan) by {op.manualSummary!.enteredBy}. Reason: {op.manualSummary!.reason}</p>
                {Object.entries(op.manualSummary!.fuel).map(([fuel,value])=><p key={fuel}>{fuel}: {Number(value?.quantity||0)} units; {formatCurrency(Number(value?.amount||0))}</p>)}
              </div>)}
              {/* Fuel rate changes this day */}
              {dayRateChanges.length > 0 && (
                <div className="rounded-2xl border-2 border-amber-200 bg-amber-50/60 p-5">
                  <p className="text-sm font-bold text-amber-900">
                    Fuel rate {dayRateChanges.length === 1 ? 'change' : 'changes'} this day
                  </p>
                  <div className="mt-3 space-y-2">
                    {dayRateChanges.map((rc) => (
                      <div key={rc.id} className="text-sm text-slate-800 bg-white rounded-xl border border-amber-100 px-4 py-3">
                        <span className="font-bold">
                          {new Date(rc.timestamp).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {' '}- Petrol Rs. {rc.oldPetrolRate} → Rs. {rc.newPetrolRate}/L,
                        CNG Rs. {rc.oldCngRate} → Rs. {rc.newCngRate}/kg
                        <span className="text-slate-500"> (by {rc.changedByName})</span>
                        <div className="text-xs text-slate-500 mt-1">
                          Sales before this change kept the old rate; sales after use the new rate.
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Summary Cards */}
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <div className="rounded-2xl border-2 border-emerald-100 bg-emerald-50/60 p-5">
                  <p className="text-sm font-bold text-slate-600">Sales</p>
                  <p className="mt-2 text-2xl font-black text-emerald-700">
                    {formatCurrency(selectedDay.sales)}
                  </p>
                </div>
                <div className="rounded-2xl border-2 border-blue-100 bg-blue-50/60 p-5">
                  <p className="text-sm font-bold text-slate-600">Litres</p>
                  <p className="mt-2 text-2xl font-black text-slate-900">
                    {selectedDay.litres.toFixed(1)} L
                  </p>
                </div>
                <div className="rounded-2xl border-2 border-rose-100 bg-rose-50/60 p-5">
                  <p className="text-sm font-bold text-slate-600">Expenses</p>
                  <p className="mt-2 text-2xl font-black text-rose-700">
                    {formatCurrency(selectedDay.expenseTotal)}
                  </p>
                </div>
                <div className="rounded-2xl border-2 border-slate-200 bg-slate-50 p-5">
                  <p className="text-sm font-bold text-slate-600">Cash received</p>
                  <p className="mt-2 text-2xl font-black text-slate-800">
                    {formatCurrency(selectedDay.cashTotal)}
                  </p>
                </div>
              </div>

              {/* v66: Day reconciliation from stored closed-operation values */}
              {(() => {
                const ops = selectedDay.dayOperations;
                if (ops.length === 0) return null;
                const grossSales = ops.reduce((s, op) => s + (Number(op.grossSales) || 0), 0);
                const expectedNet = ops.reduce((s, op) => s + (Number(op.expectedNet) || 0), 0);
                const actualCollection = ops.reduce((s, op) => s + (Number(op.actualCollection) || 0), 0);
                const variance = actualCollection - expectedNet;
                return (
                  <div className="rounded-2xl border border-slate-200 bg-white p-5">
                    <h4 className="text-sm font-bold text-slate-900 mb-3">Day Summary</h4>
                    <div className="space-y-1.5 text-xs max-w-md">
                      <div className="flex justify-between">
                        <span className="font-medium text-slate-600">Total fuel sales</span>
                        <span className="font-bold text-slate-900">{formatCurrency(grossSales)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-medium text-slate-600">Fuel expenses</span>
                        <span className="font-bold text-slate-900">{formatCurrency(selectedDay.expenseTotal)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-medium text-slate-600">Credit given</span>
                        <span className="font-bold text-slate-900">{formatCurrency(ops.reduce((sum, op) => sum + (op.udhaarTotal || 0), 0))}</span>
                      </div>
                      <div className="border-t border-slate-100 my-1"></div>
                      <div className="flex justify-between">
                        <span className="font-bold text-slate-700">Expected cash</span>
                        <span className="font-black text-slate-900">{formatCurrency(expectedNet)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-medium text-slate-600">Cash after expenses</span>
                        <span className="font-bold text-emerald-700">{formatCurrency(actualCollection)}</span>
                      </div>
                      {variance !== 0 && (
                        <div className="flex justify-between">
                          <span className="font-bold text-slate-700">{variance < 0 ? 'Cash short' : 'Cash excess'}</span>
                          <span className={`font-black ${variance < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                            {formatCurrency(Math.abs(variance))}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Fuel Sales Table */}
              <section>
                <div className="mb-3 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                    <Fuel className="h-5 w-5" />
                  </div>
                  <h4 className="text-xl font-black text-slate-900">
                    Fuel Sales
                  </h4>
                </div>
                <div className="overflow-hidden rounded-2xl border-2 border-slate-200">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50">
                      <tr className="border-b-2 border-slate-200">
                        <th className="px-5 py-4 text-sm font-black text-slate-600 uppercase tracking-wide">
                          Employee
                        </th>
                        <th className="px-5 py-4 text-sm font-black text-slate-600 uppercase tracking-wide">
                          Shift
                        </th>
                        <th className="px-5 py-4 text-sm font-black text-slate-600 uppercase tracking-wide">
                          Nozzle
                        </th>
                        <th className="px-5 py-4 text-right text-sm font-black text-slate-600 uppercase tracking-wide">
                          Opening
                        </th>
                        <th className="px-5 py-4 text-right text-sm font-black text-slate-600 uppercase tracking-wide">
                          Closing
                        </th>
                        <th className="px-5 py-4 text-right text-sm font-black text-slate-600 uppercase tracking-wide">
                          Litres
                        </th>
                        <th className="px-5 py-4 text-right text-sm font-black text-slate-600 uppercase tracking-wide">
                          Sale
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedDay.fuel.map(({ r }, i) => (
                        <tr
                          key={`${r.nozzleId}-${r.shiftId}-${i}`}
                          className="hover:bg-slate-50/70"
                        >
                          <td className="px-5 py-4 text-base font-semibold text-slate-800">
                            {r.employeeNameSnapshot}
                          </td>
                          <td className="px-5 py-4 text-base font-medium text-slate-700">
                            {r.shiftNameSnapshot}
                          </td>
                          <td className="px-5 py-4 text-base font-medium text-slate-700">
                            {r.pumpNameSnapshot} - {r.nozzleNameSnapshot}
                            <div className="text-xs text-slate-500">Reading {r.readingSequence || i + 1} · Saved {r.closingAcceptedAt ? new Date(r.closingAcceptedAt).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' }) : 'earlier'}</div>
                            {!!r.corrections?.length && <details className="mt-2 text-xs"><summary className="cursor-pointer text-amber-800">Corrections ({r.corrections.length})</summary>{r.corrections.map((c, index) => <p key={index} className="mt-1">{new Date(c.at).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })}: {c.previousClosing} → {c.closing}; {formatCurrency(c.previousAmount)} → {formatCurrency(c.amount)}. {c.reason}</p>)}</details>}
                          </td>
                          <td className="px-5 py-4 text-right text-base font-mono font-semibold text-slate-700">
                            {r.openingMeter.toLocaleString()}
                          </td>
                          <td className="px-5 py-4 text-right text-base font-mono font-semibold text-slate-700">
                            {r.closingMeter.toLocaleString()}
                          </td>
                          <td className="px-5 py-4 text-right text-base font-bold text-slate-900">
                            {r.quantitySold.toFixed(2)}
                          </td>
                          <td className="px-5 py-4 text-right text-base font-black text-emerald-700">
                            {formatCurrency(r.salesAmount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {selectedDay.fuel.length === 0 && (
                    <div className="p-6 text-center text-base font-medium text-slate-500">
                      No fuel sales recorded.
                    </div>
                  )}
                </div>
              </section>

              {/* Expenses Table */}
              <section>
                <div className="mb-3 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-50 text-rose-600">
                    <Receipt className="h-5 w-5" />
                  </div>
                  <h4 className="text-xl font-black text-slate-900">
                    Expenses
                  </h4>
                </div>
                <div className="overflow-hidden rounded-2xl border-2 border-slate-200">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50">
                      <tr className="border-b-2 border-slate-200">
                        <th className="px-5 py-4 text-sm font-black text-slate-600 uppercase tracking-wide">
                          Category
                        </th>
                        <th className="px-5 py-4 text-sm font-black text-slate-600 uppercase tracking-wide">
                          Description
                        </th>
                        <th className="px-5 py-4 text-right text-sm font-black text-slate-600 uppercase tracking-wide">
                          Amount
                        </th>
                        <th className="px-5 py-4 text-center text-sm font-black text-slate-600 uppercase tracking-wide">
                          Action
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedDay.expenses.map(({ op, expense }) => (
                        <tr
                          key={`${op.id}-${expense.id}`}
                          className="hover:bg-slate-50/70"
                        >
                          <td className="px-5 py-4 text-base font-semibold text-slate-800">
                            {expense.category}
                          </td>
                          <td className="px-5 py-4 text-base font-medium text-slate-700">
                            {expense.description}
                          </td>
                          <td className="px-5 py-4 text-right text-base font-black text-slate-900">
                            {formatCurrency(expense.amount)}
                          </td>
                          <td className="px-5 py-4 text-center">
                            <button
                              onClick={() =>
                                requestDeleteExpense(
                                  op,
                                  expense.id,
                                  expense.description,
                                  expense.amount,
                                )
                              }
                              className="inline-flex items-center gap-2 rounded-xl border-2 border-rose-200 bg-rose-50 px-4 py-2 text-sm font-bold text-rose-700 transition hover:bg-rose-100"
                              title="Delete expense"
                            >
                              <Trash2 className="h-4 w-4" />
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {selectedDay.expenses.length === 0 && (
                    <div className="p-6 text-center text-base font-medium text-slate-500">
                      No expenses recorded.
                    </div>
                  )}
                </div>
              </section>

              {/* Cash Handovers */}
              <section>
                <div className="mb-3 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                    <Coins className="h-5 w-5" />
                  </div>
                  <h4 className="text-xl font-black text-slate-900">
                    Cash Handovers
                  </h4>
                </div>
                <div className="overflow-hidden rounded-2xl border-2 border-slate-200">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50">
                      <tr className="border-b-2 border-slate-200">
                        <th className="px-5 py-4 text-sm font-black text-slate-600 uppercase tracking-wide">
                          Employee
                        </th>
                        <th className="px-5 py-4 text-sm font-black text-slate-600 uppercase tracking-wide">
                          Time
                        </th>
                        <th className="px-5 py-4 text-right text-sm font-black text-slate-600 uppercase tracking-wide">
                          Amount
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedDay.cash.map(({ deposit }) => (
                        <tr key={deposit.id} className="hover:bg-slate-50/70">
                          <td className="px-5 py-4 text-base font-semibold text-slate-800">
                            {/* v64: show nozzle name for nozzle-based deposits, fallback to employee for old ones */}
                            {deposit.nozzleNameSnapshot || deposit.employeeNameSnapshot || '-'}
                            <div className="text-xs text-slate-500">{deposit.readingId ? `Reading ${deposit.readingSequence || '-'}` : 'Earlier cash (not assigned to a reading)'}</div>
                            {deposit.fuelType && (
                              <span className="ml-1.5 text-[11px] font-bold text-slate-400">
                                {deposit.fuelType === 'PETROL' ? 'Petrol' : 'CNG'}
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-4 text-base font-medium text-slate-700">
                            {new Date(deposit.timestamp).toLocaleTimeString(
                              'en-PK',
                              { hour: '2-digit', minute: '2-digit' },
                            )}
                          </td>
                          <td className="px-5 py-4 text-right text-base font-black text-emerald-700">
                            {formatCurrency(deposit.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {selectedDay.cash.length === 0 && (
                    <div className="p-6 text-center text-base font-medium text-slate-500">
                      No cash handovers recorded.
                    </div>
                  )}
                </div>
              </section>
            </div>

            {/* Modal Footer */}
            <div className="flex justify-end gap-3 border-t-2 border-slate-100 bg-slate-50 px-7 py-5">
              {canPrint && (
                <button
                  type="button"
                  onClick={() => {
                    const first = selectedDay.dayOperations[0];
                    if (first) setSelectedOperationForPrint(first);
                  }}
                  className="inline-flex items-center gap-2 rounded-xl border-2 border-slate-200 bg-white px-6 py-3 text-base font-bold text-slate-700 transition hover:bg-slate-50"
                >
                  <Printer className="h-5 w-5" />
                  Print
                </button>
              )}
              <button
                type="button"
                onClick={() => setSelectedDateForDetail(null)}
                className="rounded-xl bg-emerald-600 px-7 py-3 text-base font-bold text-white transition hover:bg-emerald-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ UNLOCK REASON MODAL ============ */}
      {showUnlockReasonModal && operationToUnlock && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-2xl border-2 border-slate-200 bg-white p-7 shadow-2xl">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-2xl font-black text-slate-900">
                  Reason to Edit
                </h3>
                <p className="mt-1 text-base font-medium text-slate-500">
                  Add a reason, then confirm.
                </p>
              </div>
              <button
                onClick={() => {
                  setShowUnlockReasonModal(false);
                  setOperationToUnlock(null);
                }}
                className="text-slate-400 hover:text-slate-900 text-3xl font-bold"
              >
                ×
              </button>
            </div>

            <textarea
              value={unlockReason}
              onChange={(e) => setUnlockReason(e.target.value)}
              rows={3}
              placeholder="Reason"
              className="w-full rounded-xl border-2 border-slate-200 bg-slate-50 p-5 text-lg text-slate-900 focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-100 resize-none"
            />

            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowUnlockReasonModal(false);
                  setOperationToUnlock(null);
                }}
                className="rounded-xl border-2 border-slate-200 bg-white px-6 py-3 text-base font-bold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmUnlock}
                disabled={!unlockReason.trim()}
                className="rounded-xl bg-emerald-600 px-7 py-3 text-base font-bold text-white hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400"
              >
                Unlock
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ DELETE EXPENSE REASON MODAL ============ */}
      {showDeleteExpenseReasonModal && expenseToDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-2xl border-2 border-slate-200 bg-white p-7 shadow-2xl">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-2xl font-black text-slate-900">
                  Delete Expense
                </h3>
                <p className="mt-1 text-base font-medium text-slate-500">
                  {expenseToDelete.description} for{' '}
                  {formatCurrency(expenseToDelete.amount)}
                </p>
              </div>
              <button
                onClick={() => {
                  setShowDeleteExpenseReasonModal(false);
                  setExpenseToDelete(null);
                }}
                className="text-slate-400 hover:text-slate-900 text-3xl font-bold"
              >
                ×
              </button>
            </div>

            <p className="mb-4 text-base font-medium text-slate-600">
              Add a reason, then confirm.
            </p>

            {deleteExpenseError && (
              <p className="mb-4 rounded-xl border-2 border-rose-200 bg-rose-50 p-4 text-base font-bold text-rose-700">
                {deleteExpenseError}
              </p>
            )}

            <textarea
              value={deleteExpenseReason}
              onChange={(e) => setDeleteExpenseReason(e.target.value)}
              rows={3}
              placeholder="Reason"
              className="w-full rounded-xl border-2 border-slate-200 bg-slate-50 p-5 text-lg text-slate-900 focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-100 resize-none"
            />

            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowDeleteExpenseReasonModal(false);
                  setExpenseToDelete(null);
                }}
                className="rounded-xl border-2 border-slate-200 bg-white px-6 py-3 text-base font-bold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteExpense}
                disabled={!deleteExpenseReason.trim()}
                className="rounded-xl bg-rose-600 px-7 py-3 text-base font-bold text-white hover:bg-rose-700 disabled:bg-slate-200 disabled:text-slate-400"
              >
                Delete expense
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ PRINT MODAL ============ */}
      <PrintDailySheetModal
        isOpen={!!selectedOperationForPrint}
        record={selectedOperationForPrint}
        station={station}
        employees={employees}
        onClose={() => setSelectedOperationForPrint(null)}
      />

    </div>
  );
}
