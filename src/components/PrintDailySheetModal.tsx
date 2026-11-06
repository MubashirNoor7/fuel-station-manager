import { StationConfig, DailyOperation, Employee } from '../types';
import { X, Printer, FileText, Building2 } from 'lucide-react';

interface PrintDailySheetModalProps {
  isOpen: boolean;
  onClose: () => void;
  record: DailyOperation | null;
  station: StationConfig;
  employees: Employee[];
}

export function PrintDailySheetModal({
  isOpen,
  onClose,
  record,
  station,
  employees,
}: PrintDailySheetModalProps) {
  if (!isOpen || !record) return null;

  const getEmployeeName = (employeeId: string, snapshot?: string) => {
    if (snapshot) return snapshot;
    return employees.find((employee) => employee.id === employeeId)?.name || 'Unknown';
  };

  const handlePrint = () => window.print();

  const fmtMoney = (v: number) =>
    `Rs. ${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const fmtNum = (v: number, decimals = 3) =>
    v.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm print:static print:bg-white print:p-0 print:backdrop-blur-none">
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl print:max-h-none print:max-w-none print:rounded-none print:border-0 print:shadow-none">
        {/* Header (screen only) */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 p-6 print:hidden">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white">
              <FileText className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-lg font-extrabold text-slate-900">
                Daily Operations Summary
              </h3>
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
                Business Date: {record.businessDate}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              id="btn-trigger-print-sheet"
              onClick={handlePrint}
              className="flex items-center gap-2 rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-emerald-700"
            >
              <Printer className="h-4 w-4" />
              Print Sheet
            </button>
            <button
              id="btn-close-print-modal"
              onClick={onClose}
              className="fuel-close-button flex items-center justify-center gap-2 rounded-lg border border-slate-200 text-slate-600"
              aria-label="Close print preview"
            >
              <X className="h-4 w-4" aria-hidden="true" /> Close
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 text-slate-900 print:overflow-visible print:p-0">
          {record.manualSummary && <div className="mb-4 border p-3">
            <strong>Manual register summary - individual nozzle transactions unavailable</strong>
            <p>Entered {new Date(record.manualSummary.enteredAt).toLocaleString('en-PK',{timeZone:'Asia/Karachi'})} (Pakistan) by {record.manualSummary.enteredBy}. Reason: {record.manualSummary.reason}</p>
            {(['PETROL', 'CNG'] as const).map(fuel => <p key={fuel}>{fuel}: {record.manualSummary?.fuel[fuel]?.quantity || 0} units; Rs. {record.manualSummary?.fuel[fuel]?.amount || 0}</p>)}
          </div>}
          {/* Station header block */}
          <div className="border-b-2 border-slate-900 pb-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white print:bg-white print:text-slate-900 print:ring-2 print:ring-slate-900">
                  <Building2 className="h-6 w-6" />
                </div>
                <div>
                  <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900">
                    {station.stationName}
                  </h1>
                  <p className="mt-0.5 text-sm font-medium text-slate-600">
                    {station.address}
                  </p>
                  {station.phone && (
                    <p className="text-sm font-medium text-slate-600">
                      Phone: {station.phone}
                    </p>
                  )}
                </div>
              </div>
              <div className="text-right">
                <span className="inline-block rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-white print:bg-white print:text-slate-900 print:ring-1 print:ring-slate-900">
                  Daily Shift Report
                </span>
                <div className="mt-2 space-y-0.5 text-sm">
                  <p className="font-bold text-slate-900">
                    Date: {record.businessDate}
                  </p>
                  <p className="font-medium text-slate-600">
                    Status:{' '}
                    <span className="font-bold text-slate-800">{record.status}</span>
                  </p>
                  <p className="font-medium text-slate-600">
                    Manager:{' '}
                    <span className="font-bold text-slate-800">
                      {station.managerName}
                    </span>
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Summary strip (screen only) */}
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 print:hidden">
            <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Fuel Sales
              </p>
              <p className="mt-1 text-base font-extrabold text-slate-900">
                {fmtMoney(record.grossSales)}
              </p>
            </div>
            <div className="rounded-2xl border border-rose-100 bg-rose-50/60 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Expenses
              </p>
              <p className="mt-1 text-base font-extrabold text-rose-700">
                -{fmtMoney(record.totalExpenses)}
              </p>
            </div>
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Expected Net
              </p>
              <p className="mt-1 text-base font-extrabold text-emerald-700">
                {fmtMoney(record.expectedNet)}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Cash after expenses
              </p>
              <p className="mt-1 text-base font-extrabold text-slate-700">
                {record.actualCollection === null
                  ? 'Pending'
                  : fmtMoney(record.actualCollection)}
              </p>
            </div>
          </div>

          {/* Section 1: Meter Readings */}
          <div className="mt-6">
            <div className="mb-2 flex items-center gap-2 border-b border-slate-200 pb-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
                1
              </span>
              <h4 className="text-sm font-bold uppercase tracking-wide text-slate-700">
                Fuel Dispenser & Nozzle Meter Sales
              </h4>
            </div>
            <div className="overflow-hidden rounded-xl border border-slate-300">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-300 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-600">
                    <th className="border-r border-slate-200 p-3">Pump / Nozzle</th>
                    <th className="border-r border-slate-200 p-3">Shift / Operator</th>
                    <th className="border-r border-slate-200 p-3 text-right">Opening</th>
                    <th className="border-r border-slate-200 p-3 text-right">Closing</th>
                    <th className="border-r border-slate-200 p-3 text-right">Qty</th>
                    <th className="border-r border-slate-200 p-3 text-right">Rate</th>
                    <th className="p-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {record.nozzleReadings.map((entry) => (
                    <tr
                      key={`${entry.nozzleId}-${entry.shiftId}-${entry.employeeId}`}
                      className="text-sm"
                    >
                      <td className="border-r border-slate-200 p-3 font-semibold text-slate-900">
                        {entry.pumpNameSnapshot} / {entry.nozzleNameSnapshot}{' '}
                        <span className="text-slate-400">({entry.fuelType})</span>
                      </td>
                      <td className="border-r border-slate-200 p-3">
                        <div className="font-semibold text-slate-800">
                          {entry.shiftNameSnapshot}
                        </div>
                        <div className="text-xs text-slate-500">
                          {getEmployeeName(entry.employeeId, entry.employeeNameSnapshot)}
                        </div>
                      </td>
                      <td className="border-r border-slate-200 p-3 text-right font-medium text-slate-700">
                        {entry.openingMeter.toLocaleString()}
                      </td>
                      <td className="border-r border-slate-200 p-3 text-right font-medium text-slate-700">
                        {entry.closingMeter.toLocaleString()}
                      </td>
                      <td className="border-r border-slate-200 p-3 text-right font-bold text-slate-900">
                        {fmtNum(entry.quantitySold)}
                      </td>
                      <td className="border-r border-slate-200 p-3 text-right font-medium text-slate-700">
                        {entry.rate.toFixed(2)}
                      </td>
                      <td className="p-3 text-right font-bold text-slate-900">
                        {entry.salesAmount.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-slate-300 bg-slate-50">
                  <tr className="text-sm">
                    <td
                      colSpan={6}
                      className="border-r border-slate-200 p-3 text-right font-bold uppercase tracking-wide text-slate-600"
                    >
                      Gross Fuel Sales
                    </td>
                    <td className="p-3 text-right text-base font-extrabold text-slate-900">
                      {fmtMoney(record.grossSales)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Section 2 & 3: Cash + Expenses */}
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Cash Collection */}
            <div>
              <div className="mb-2 flex items-center gap-2 border-b border-slate-200 pb-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
                  2
                </span>
                <h4 className="text-sm font-bold uppercase tracking-wide text-slate-700">
                  Cash Collection
                </h4>
              </div>
              <div className="overflow-hidden rounded-xl border border-slate-300">
                <table className="w-full text-left text-sm">
                  <tbody className="divide-y divide-slate-200">
                    <tr>
                      <td className="p-3 font-semibold text-slate-700">Expected Net</td>
                      <td className="p-3 text-right font-bold text-slate-900">
                        {fmtMoney(record.expectedNet)}
                      </td>
                    </tr>
                    <tr>
                      <td className="p-3 font-semibold text-slate-700">
                        Cash after expenses
                      </td>
                      <td className="p-3 text-right font-bold text-slate-900">
                        {record.actualCollection === null
                          ? 'Pending'
                          : fmtMoney(record.actualCollection)}
                      </td>
                    </tr>
                    <tr>
                      <td className="p-3 font-semibold text-slate-700">Variance</td>
                      <td
                        className={`p-3 text-right font-bold ${
                          record.variance === null
                            ? 'text-slate-500'
                            : record.variance === 0
                            ? 'text-emerald-700'
                            : record.variance < 0
                            ? 'text-rose-700'
                            : 'text-blue-700'
                        }`}
                      >
                        {record.variance === null ? 'Pending' : fmtMoney(record.variance)}
                      </td>
                    </tr>
                    <tr className="bg-slate-50">
                      <td className="p-3 font-bold uppercase tracking-wide text-slate-600">
                        Reconciliation
                      </td>
                      <td className="p-3 text-right font-bold text-slate-900">
                        {record.reconciliationText || record.reconciliationStatus}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Expenses */}
            <div>
              <div className="mb-2 flex items-center gap-2 border-b border-slate-200 pb-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
                  3
                </span>
                <h4 className="text-sm font-bold uppercase tracking-wide text-slate-700">
                  Operational Expenses
                </h4>
              </div>
              <div className="overflow-hidden rounded-xl border border-slate-300">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-300 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-600">
                    <tr>
                      <th className="p-3">Description</th>
                      <th className="p-3 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {record.expenses.length === 0 ? (
                      <tr>
                        <td colSpan={2} className="p-3 text-center text-slate-400">
                          No expenses recorded
                        </td>
                      </tr>
                    ) : (
                      record.expenses.map((expense) => (
                        <tr key={expense.id}>
                          <td className="p-3">
                            <div className="font-semibold text-slate-800">
                              {expense.description}
                            </div>
                            <div className="text-xs text-slate-500">
                              {expense.category}
                            </div>
                          </td>
                          <td className="p-3 text-right font-bold text-rose-700">
                            {expense.amount.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                            })}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  <tfoot className="border-t-2 border-slate-300 bg-slate-50">
                    <tr className="text-sm">
                      <td className="p-3 text-right font-bold uppercase tracking-wide text-slate-600">
                        Total Expenses
                      </td>
                      <td className="p-3 text-right text-base font-extrabold text-slate-900">
                        {fmtMoney(record.totalExpenses)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>

          {/* Grand Total Strip */}
          <div className="mt-6 flex items-center justify-between rounded-2xl border-2 border-slate-900 bg-slate-50 p-5 print:border print:border-slate-900">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Daily Reconciliation
              </p>
              <p className="mt-0.5 text-sm font-medium text-slate-700">
                Expected cash after recorded operational expenses.
              </p>
              <p className="mt-1.5 text-sm font-semibold text-slate-600">
                Total Quantity:{' '}
                <span className="font-bold text-slate-900">
                  {fmtNum(record.totalQuantity)} L
                </span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Net Payable
              </p>
              <p className="mt-1 text-2xl font-black text-slate-900">
                {fmtMoney(record.expectedNet)}
              </p>
            </div>
          </div>

          {/* Notes */}
          {record.notes && (
            <div className="mt-5 rounded-2xl border border-slate-300 bg-slate-50/60 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Manager Notes
              </p>
              <p className="mt-1 text-sm font-medium text-slate-700">
                {record.notes}
              </p>
            </div>
          )}

          {/* Signatures */}
          <div className="mt-12 grid grid-cols-2 gap-12 text-sm font-semibold text-slate-600">
            <div className="border-t border-slate-400 pt-2 text-center">
              Operator / Shift Supervisor
            </div>
            <div className="border-t border-slate-400 pt-2 text-center">
              Station Manager / Authorized
            </div>
          </div>

          {/* Print footer */}
          <div className="mt-6 hidden text-center text-xs font-medium text-slate-500 print:block">
            Generated on {new Date().toLocaleString()} · {station.stationName}
          </div>
        </div>
      </div>
    </div>
  );
}
