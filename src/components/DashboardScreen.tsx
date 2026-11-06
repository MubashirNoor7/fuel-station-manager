import { collectedExpenseTotal } from '../logic/readingLedger';
import { Card, PageHeader } from './ui';
import '../styles/fuel-dashboard.css';
import { useMemo, useState } from 'react';
import {
  StationConfig,
  Pump,
  Nozzle,
  Employee,
  DailyOperation,
  FuelStockDayRecord,
  FuelType,
} from '../types';
import { formatCurrency, getPakistanLocalDate } from '../logic/calculations';
import { calculateFuelStock } from '../logic/fuelStock';
import type { SaveResult } from '../logic/saveResult';
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  Fuel,
  History,
  Plus,
  Receipt,
  Wallet,
  AlertTriangle,
  Droplet,
  Flame,
} from 'lucide-react';

interface DashboardScreenProps {
  station: StationConfig;
  pumps: Pump[];
  nozzles: Nozzle[];
  employees: Employee[];
  operations: DailyOperation[];
  stockRecords: FuelStockDayRecord[];
  onNavigateToOperation?: () => void;
  onNavigateToFuelStock?: () => void;
  onNavigateToHistory?: () => void;
  onNavigateToEmployees?: () => void;
  // v70: Save counted cash for today's operation.
  // v71: Returns promise - UI must wait for database success before showing "Saved!".
  onSaveCountedCash?: (operationId: string, countedCash: number | null) => Promise<SaveResult>;
}

// Safe number helper
const safeNum = (value: number | null | undefined): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return 0;
};

export function DashboardScreen({
  station,
  pumps,
  nozzles,
  employees,
  operations,
  stockRecords,
  onNavigateToOperation,
  onNavigateToFuelStock,
  onNavigateToHistory,
  onNavigateToEmployees,
}: DashboardScreenProps) {
  const todayIso = getPakistanLocalDate();
  const todayOps = operations.filter(
    (operation) => operation.businessDate === todayIso,
  );
  const activeNozzles = nozzles.filter((nozzle) => nozzle.isActive);

  // ============ METRIC CALCULATIONS ============
  const todayFuelSales = todayOps.reduce(
    (sum, operation) =>
      sum +
      (operation.nozzleReadings || [])
        .filter((reading) => reading.closingAccepted === true)
        .reduce(
          (inner, reading) => inner + Number(reading.salesAmount || 0),
          0,
        ),
    0,
  );
  const todayExpenses = todayOps.reduce(
    (sum, operation) => sum + Number(operation.totalExpenses || 0),
    0,
  );
  const todayNet = todayFuelSales - todayExpenses;

  const petrolQuantity = todayOps.reduce(
    (sum, operation) =>
      sum +
      (operation.nozzleReadings || [])
        .filter(
          (reading) =>
            reading.closingAccepted && reading.fuelType === 'PETROL',
        )
        .reduce(
          (inner, reading) => inner + Number(reading.quantitySold || 0),
          0,
        ),
    0,
  );

  const cngQuantity = todayOps.reduce(
    (sum, operation) =>
      sum +
      (operation.nozzleReadings || [])
        .filter(
          (reading) =>
            reading.closingAccepted && reading.fuelType === 'CNG',
        )
        .reduce(
          (inner, reading) => inner + Number(reading.quantitySold || 0),
          0,
        ),
    0,
  );

  const salesByFuel = (fuel: FuelType) => todayOps.reduce(
    (sum, operation) => sum + (operation.nozzleReadings || [])
      .filter(reading => reading.closingAccepted === true && reading.fuelType === fuel)
      .reduce((subtotal, reading) => subtotal + Number(reading.salesAmount || 0), 0),
    0,
  );
  const petrolSales = salesByFuel('PETROL');
  const cngSales = salesByFuel('CNG');
  const totalFuelSalesByType = petrolSales + cngSales;
  const petrolPercent =
    totalFuelSalesByType > 0
      ? Math.round((petrolSales / totalFuelSalesByType) * 100)
      : 0;
  const cngPercent =
    totalFuelSalesByType > 0 ? 100 - petrolPercent : 0;

  // ============ FUEL STOCK SUMMARY ============
  const stockSummaries = useMemo(
    () =>
      (['PETROL', 'CNG'] as FuelType[]).map((fuelType) =>
        calculateFuelStock(todayIso, fuelType, operations, stockRecords),
      ),
    [todayIso, operations, stockRecords],
  );

  const petrolStock = stockSummaries.find(
    (summary) => summary.fuelType === 'PETROL',
  );
  const cngStock = stockSummaries.find(
    (summary) => summary.fuelType === 'CNG',
  );

  const hasLowStock =
    petrolStock?.status === 'LOW' || cngStock?.status === 'LOW';
  const hasStockProblem =
    petrolStock?.status === 'PROBLEM' || cngStock?.status === 'PROBLEM';

  // ============ RECENT ACTIVITY ============
  const recentActivity = useMemo(() => {
    const items: Array<{
      id: string;
      title: string;
      detail: string;
      time: string;
      sortTime: number;
      tone: string;
      icon: typeof Activity;
    }> = [];

    todayOps.forEach((operation) => {
      (operation.cashDeposits || []).forEach((deposit) => {
        const timestamp = new Date(deposit.timestamp).getTime();
        items.push({
          id: `cash-${operation.id}-${deposit.id}`,
          title: 'Cash received',
          detail: `${deposit.nozzleNameSnapshot || deposit.employeeNameSnapshot || 'Cash handover'} - ${formatCurrency(deposit.amount)}`,
          time: new Date(deposit.timestamp).toLocaleTimeString('en-PK', {
            hour: '2-digit',
            minute: '2-digit',
          }),
          sortTime: timestamp,
          tone: 'bg-violet-100 text-violet-700',
          icon: Wallet,
        });
      });

      (operation.expenses || []).forEach((expense) => {
        const timestamp = new Date(expense.dateTime).getTime();
        items.push({
          id: `expense-${operation.id}-${expense.id}`,
          title: 'Expense added',
          detail: `${expense.description} , ${formatCurrency(expense.amount)}`,
          time: new Date(expense.dateTime).toLocaleTimeString('en-PK', {
            hour: '2-digit',
            minute: '2-digit',
          }),
          sortTime: timestamp,
          tone: 'bg-blue-100 text-blue-700',
          icon: Receipt,
        });
      });

      (operation.nozzleReadings || [])
        .filter((reading) => reading.closingAccepted)
        .forEach((reading, index) => {
          const timestamp = reading.closingAcceptedAt
            ? new Date(reading.closingAcceptedAt).getTime()
            : 0;
          items.push({
            id: `reading-${operation.id}-${reading.nozzleId}-${index}`,
            title: 'Fuel reading updated',
            detail: `${(nozzles.find((n) => n.id === reading.nozzleId)?.name || reading.nozzleNameSnapshot || 'Nozzle').replace(/\s*\(.*?\)\s*/g, '').trim()} - ${reading.fuelType === 'CNG' ? 'CNG' : 'Petrol'} - ${reading.shiftNameSnapshot || 'Shift'} - Reading #${reading.readingSequence || index + 1}`,
            time: timestamp
              ? new Date(timestamp).toLocaleTimeString('en-PK', {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : 'Today',
            sortTime: timestamp,
            tone: 'bg-emerald-100 text-emerald-700',
            icon: Fuel,
          });
        });

      if (operation.status === 'CLOSED' && operation.endTime) {
        const timestamp = new Date(operation.endTime).getTime();
        items.push({
          id: `closed-${operation.id}`,
          title: 'Daily operation closed',
          detail: 'Day closed successfully',
          time: new Date(timestamp).toLocaleTimeString('en-PK', {
            hour: '2-digit',
            minute: '2-digit',
          }),
          sortTime: timestamp,
          tone: 'bg-amber-100 text-amber-700',
          icon: CheckCircle2,
        });
      }
    });

    return items.sort((a, b) => b.sortTime - a.sortTime).slice(0, 4);
  }, [todayOps]);

  // ============ SALES TREND (LAST 7 DAYS) ============
  const lastSevenDays = useMemo(() => {
    const [year, month, day] = todayIso.split('-').map(Number);

    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(Date.UTC(year, month - 1, day - (6 - index)));
      const iso = date.toISOString().slice(0, 10);
      const sales = operations
        .filter((operation) => operation.businessDate === iso)
        .reduce(
          (sum, operation) =>
            sum + Number(operation.manualSummary ? operation.grossSales : 0) +
            (operation.nozzleReadings || [])
              .filter((reading) => reading.closingAccepted === true)
              .reduce(
                (inner, reading) =>
                  inner + Number(reading.salesAmount || 0),
                0,
              ),
          0,
        );
      return {
        iso,
        label: date.toLocaleDateString('en-PK', {
          day: '2-digit',
          month: 'short',
          timeZone: 'UTC',
        }),
        sales,
      };
    });
  }, [todayIso, operations]);

  const maxSevenDaySales = Math.max(
    ...lastSevenDays.map((day) => day.sales),
    1,
  );
  const yAxisMax = Math.max(
    400000,
    Math.ceil(maxSevenDaySales / 100000) * 100000,
  );

  const donutStyle =
    totalFuelSalesByType > 0
      ? {
          background: `linear-gradient(to right, #047857 0 ${petrolPercent}%, #7c3aed ${petrolPercent}% 100%)`,
        }
      : { background: '#e2e8f0' };

  const panelClass =
    'rounded-2xl border-2 border-slate-200 bg-white shadow-sm';
  const buttonBase =
    'focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2';

  // ============ RENDER ============
  return (
    <div
      className="fuel-dashboard"
      style={{ fontFamily: 'var(--ui-font)' }}
    >
      {/* ============ PAGE HEADER ============ */}
      <PageHeader title="Fuel dashboard" description="View your fuel sales, cash and daily activity." />

      {/* ============ METRIC CARDS ============ */}
      <section className="fuel-dashboard-metrics">
        {/* Total Fuel Sales */}
        <Card className="fuel-metric-card">
          <div className="flex items-start gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-emerald-200 text-emerald-800">
              <Fuel className="h-7 w-7" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-base font-bold text-slate-700">
                Total Fuel Sales
              </p>
              <p className="mt-2 text-3xl font-black leading-tight tracking-tight text-slate-900">
                {formatCurrency(todayFuelSales)}
              </p>
            </div>
          </div>
        </Card>

        {/* Fuel Quantity Today */}
        <Card className="fuel-metric-card">
          <div className="flex items-start gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-blue-200 text-blue-800">
              <Droplet className="h-7 w-7" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-base font-bold text-slate-700">
                Fuel Quantity (Today)
              </p>
              <p className="mt-2 text-3xl font-black leading-tight tracking-tight text-slate-900">
                {safeNum(petrolQuantity).toLocaleString('en-PK', {
                  maximumFractionDigits: 0,
                })}{' '}
                L Petrol
              </p>
              <p className="mt-2 text-sm font-bold text-slate-600">
                CNG:{' '}
                {safeNum(cngQuantity).toLocaleString('en-PK', {
                  maximumFractionDigits: 0,
                })}{' '}
                kg
              </p>
            </div>
          </div>
        </Card>

        {/* Total Expenses */}
        <Card className="fuel-metric-card">
          <div className="flex items-start gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-orange-200 text-orange-800">
              <Receipt className="h-7 w-7" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-base font-bold text-slate-700">
                Total Expenses
              </p>
              <p className="mt-2 text-3xl font-black leading-tight tracking-tight text-slate-900">
                {formatCurrency(todayExpenses)}
              </p>
            </div>
          </div>
        </Card>

        {/* Net After Expenses */}
        <Card className="fuel-metric-card">
          <div className="flex items-start gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-emerald-200 text-emerald-800">
              <ArrowUpRight className="h-7 w-7" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-base font-bold text-slate-700">
                Net After Expenses
              </p>
              <p className="mt-2 text-3xl font-black leading-tight tracking-tight text-slate-900">
                {formatCurrency(todayNet)}
              </p>
            </div>
          </div>
        </Card>
      </section>

      {/* v67: Day Summary (moved from Daily Operation per owner) */}
      <section className="fuel-dashboard-summary">
        {/* Day Summary */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="fuel-section-title"><Wallet size={20} aria-hidden="true" />Day Summary</h2>
          {(() => {
            const grossSales = todayFuelSales;
            // Include both historical and newly entered expenses.
            const staffExpenses = todayOps.reduce(
              (s, o) => s + (o.expenses || []).reduce((ss, e) => ss + (Number(e.amount) || 0), 0),
              0
            );
            // Credit comes from the database ledger, not inferred from cached totals.
            const creditGiven = todayOps.reduce((sum, o) => sum + (o.udhaarTotal || 0), 0);
            const expectedNet = grossSales - staffExpenses - creditGiven;
            const cashHandedOver = todayOps.reduce(
              (s, o) => s + (o.cashDeposits || []).reduce((ss, d) => ss + (Number(d.amount) || 0), 0),
              0
            );

            const collectedExpenses = todayOps.reduce((sum, o) => sum + collectedExpenseTotal(o.expenses || []), 0);
            const remainingCash = cashHandedOver - collectedExpenses;
            const variance = remainingCash - expectedNet;
            // v70: During the day (open), staff holding cash is normal - show "Pending handover".
            // Only show "Cash short" / "Cash excess" at final reconciliation (closed day).
            // v71: On open days, ANY variance shows "Pending handover" (not final yet).
            const isClosed = todayOps.length > 0 && todayOps.every((o) => o.status === 'CLOSED');
            return (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="font-medium text-slate-600"><Fuel size={18} aria-hidden="true" />Total fuel sales</span>
                  <span className="font-bold text-slate-900">{formatCurrency(grossSales)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium text-slate-600"><Receipt size={18} aria-hidden="true" />Credit given</span>
                  <span className="font-bold text-slate-900">{formatCurrency(creditGiven)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium text-slate-600"><ArrowUpRight size={18} aria-hidden="true" />Fuel expenses</span>
                  <span className="font-bold text-slate-900">{formatCurrency(staffExpenses)}</span>
                </div>
                <div className="border-t border-slate-100 my-1"></div>
                <div className="flex justify-between">
                  <span className="font-bold text-slate-700"><Wallet size={18} aria-hidden="true" />Expected cash</span>
                  <span className="font-black text-slate-900">{formatCurrency(expectedNet)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium text-slate-600"><CheckCircle2 size={18} aria-hidden="true" />Cash handed over</span>
                  <span className="font-bold text-emerald-700">{formatCurrency(cashHandedOver)}</span>
                </div>
                {collectedExpenses > 0 && <>
                  <div className="flex justify-between"><span>Expenses from received cash</span><span>{formatCurrency(collectedExpenses)}</span></div>
                  <div className="flex justify-between"><span className="font-bold">Remaining cash</span><span className="font-bold">{formatCurrency(remainingCash)}</span></div>
                </>}
                {variance !== 0 && (
                  <div className="flex justify-between">
                    <span className="font-bold text-slate-700"><Activity size={18} aria-hidden="true" />
                      {isClosed ? (variance < 0 ? 'Cash short' : 'Cash excess') : 'Pending handover'}
                    </span>
                    <span className={`font-black ${variance < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                      {formatCurrency(Math.abs(variance))}
                    </span>
                  </div>
                )}
              </div>
            );
          })()}
        </div>

      </section>

      {/* ============ CHART ROW ============ */}
      <section className="fuel-dashboard-charts">
        {/* Sales Trend */}
        <div className={`${panelClass} overflow-hidden`}>
          <div className="flex items-center justify-between border-b-2 border-slate-100 px-7 py-5">
            <h2 className="text-xl font-black text-slate-900">
              Sales Trend (Last 7 Days)
            </h2>
            <span className="text-base font-bold text-slate-400">Rs.</span>
          </div>
          <div className="px-7 pb-6 pt-6">
            <div className="flex gap-4">
              <div className="flex h-[180px] w-14 shrink-0 flex-col justify-between text-right text-sm font-bold text-slate-400">
                {[4, 3, 2, 1, 0].map((step) => (
                  <span key={step}>
                    {((yAxisMax * step) / 4 / 1000).toFixed(0)}K
                  </span>
                ))}
              </div>
              <div className="flex h-[220px] flex-1 items-end gap-3 border-b-2 border-slate-100">
                {lastSevenDays.map((day) => {
                  const height =
                    day.sales > 0
                      ? Math.max((day.sales / yAxisMax) * 180, 12)
                      : 6;
                  return (
                    <div
                      key={day.iso}
                      className="flex min-w-0 flex-1 flex-col items-center justify-end gap-2"
                    >
                      <div className="flex h-[180px] w-full items-end justify-center">
                        <div
                          className="fuel-dashboard-bar w-full max-w-[40px] rounded-t-md bg-emerald-700 transition-all"
                          style={{ height: `${height}px` }}
                          title={`${day.label}: ${formatCurrency(day.sales)}`}
                        >
                          <span className="fuel-dashboard-bar-label">{day.sales > 0 ? `${(day.sales / 1000).toFixed(0)}K` : ''}</span>
                        </div>
                      </div>
                      <span className="text-sm font-bold text-slate-500">
                        {day.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Donut Chart */}
        <div className={`${panelClass} overflow-hidden`}>
          <div className="border-b-2 border-slate-100 px-7 py-5">
            <h2 className="text-xl font-black text-slate-900">
              <span className="fuel-section-title"><Droplet size={20} aria-hidden="true" />Today's sales by fuel</span>
            </h2>
          </div>
          <div className="fuel-sales-breakdown">
            <div className="fuel-sales-total"><span>Total fuel sales</span><strong>{formatCurrency(totalFuelSalesByType)}</strong></div>
            <div className="fuel-sales-share-bar" style={donutStyle} aria-hidden="true" />
            {totalFuelSalesByType === 0 && <p className="fuel-sales-empty">No fuel sales recorded today.</p>}
            <div className="min-w-0 flex-1 space-y-5">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-base font-bold text-slate-700">
                  <Droplet className="fuel-share-petrol" size={20} aria-hidden="true" />
                  Petrol
                </span>
                <div className="text-right">
                  <p className="text-base font-black text-slate-800">
                    {safeNum(petrolQuantity).toLocaleString('en-PK', {
                      maximumFractionDigits: 0,
                    })}{' '}
                    L
                  </p>
                  <p className="text-sm font-bold text-slate-400">
                    {petrolPercent}% of sales
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-base font-bold text-slate-700">
                  <Flame className="fuel-share-cng" size={20} aria-hidden="true" />
                  CNG
                </span>
                <div className="text-right">
                  <p className="text-base font-black text-slate-800">
                    {safeNum(cngQuantity).toLocaleString('en-PK', {
                      maximumFractionDigits: 0,
                    })}{' '}
                    kg
                  </p>
                  <p className="text-sm font-bold text-slate-400">
                    {cngPercent}% of sales
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ QUICK ACTIONS + RECENT ACTIVITY ============ */}
      <section className="fuel-dashboard-activity">
        {/* Quick Actions */}
        <div className={`${panelClass} p-7`}>
          <h2 className="text-xl font-black text-slate-900">
            Quick Actions
          </h2>
          <div className="mt-5 grid grid-cols-2 gap-4">
            <button
              onClick={onNavigateToOperation}
              disabled={!onNavigateToOperation}
              className="flex flex-col items-center justify-center gap-3 rounded-xl bg-emerald-600 px-4 py-6 text-center text-base font-bold text-white transition hover:bg-emerald-700"
            >
              <Plus className="h-7 w-7" />
              New Operation
            </button>
            <button
              onClick={onNavigateToHistory}
              className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-slate-200 bg-white px-4 py-6 text-center text-base font-bold text-slate-700 transition hover:bg-slate-50"
            >
              <History className="h-7 w-7" />
              View History
            </button>
            <button
              onClick={onNavigateToFuelStock}
              disabled={!onNavigateToFuelStock}
              className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-slate-200 bg-white px-4 py-6 text-center text-base font-bold text-slate-700 transition hover:bg-slate-50"
            >
              <Fuel className="h-7 w-7" />
              Fuel Stock
            </button>
          </div>
        </div>

        {/* Recent Activity */}
        <div className={`${panelClass} overflow-hidden`}>
          <div className="flex items-center justify-between border-b-2 border-slate-100 px-7 py-5">
            <h2 className="text-xl font-black text-slate-900">
              Recent Activity
            </h2>
            <button
              onClick={onNavigateToHistory}
              className={`text-base font-bold text-emerald-700 hover:text-emerald-800 ${buttonBase}`}
            >
              View All
            </button>
          </div>
          {recentActivity.length === 0 ? (
            <div className="flex min-h-[250px] flex-col items-center justify-center px-6 text-center">
              <Activity className="h-10 w-10 text-slate-300" />
              <p className="mt-4 text-base font-bold text-slate-600">
                No activity today
              </p>
              <p className="mt-1 text-base font-medium text-slate-400">
                Start a daily operation to see updates.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {recentActivity.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.id}
                    className="flex min-h-[72px] items-center gap-4 px-7 py-4"
                  >
                    <span
                      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${item.tone}`}
                    >
                      <Icon className="h-6 w-6" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-bold text-slate-800">
                        {item.title}
                      </p>
                      <p className="mt-0.5 truncate text-sm font-medium text-slate-500">
                        {item.detail}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-bold text-slate-400">
                      {item.time}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ============ FUEL STOCK SUMMARY ============ */}
      <section className={`fuel-dashboard-stock ${panelClass} overflow-hidden`}>
        <div className="flex items-center justify-between border-b-2 border-slate-100 px-7 py-5">
          <h2 className="text-xl font-black text-slate-900">
            Fuel Stock Summary
          </h2>
          <button
            onClick={onNavigateToFuelStock}
            disabled={!onNavigateToFuelStock}
            className={`text-base font-bold text-emerald-700 hover:text-emerald-800 ${buttonBase}`}
          >
            View Details
          </button>
        </div>
        <div className="grid grid-cols-1 gap-5 p-7 sm:grid-cols-2">
          {/* Petrol Card */}
          <div className="rounded-2xl border-2 border-emerald-100 bg-emerald-50/50 p-6">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-200 text-emerald-800">
                <Droplet className="h-6 w-6" />
              </span>
              <span className="text-xl font-black text-slate-900">
                Petrol
              </span>
            </div>
            <p className="mt-5 text-4xl font-black leading-tight text-slate-900">
              {safeNum(petrolStock?.remainingStock).toLocaleString('en-PK', {
                maximumFractionDigits: 0,
              })}{' '}
              L
            </p>
            <p className="mt-1 text-base font-bold text-slate-500">
              Fuel Left Now
            </p>
            <div className="mt-5 grid grid-cols-2 gap-4 border-t-2 border-emerald-100 pt-5">
              <div>
                <p className="text-sm font-bold text-slate-500">
                  Sold Today
                </p>
                <p className="mt-1 text-lg font-black text-slate-800">
                  {safeNum(petrolStock?.sold).toLocaleString('en-PK', {
                    maximumFractionDigits: 0,
                  })}{' '}
                  L
                </p>
              </div>
              <div>
                <p className="text-sm font-bold text-slate-500">
                  Received Today
                </p>
                <p className="mt-1 text-lg font-black text-slate-800">
                  {safeNum(petrolStock?.supplied).toLocaleString('en-PK', {
                    maximumFractionDigits: 0,
                  })}{' '}
                  L
                </p>
              </div>
            </div>
          </div>

          {/* CNG Card */}
          <div className="rounded-2xl border-2 border-violet-100 bg-violet-50/50 p-6">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-200 text-violet-800">
                <Flame className="h-6 w-6" />
              </span>
              <span className="text-xl font-black text-slate-900">CNG</span>
            </div>
            <p className="mt-5 text-4xl font-black leading-tight text-slate-900">
              {safeNum(cngStock?.remainingStock).toLocaleString('en-PK', {
                maximumFractionDigits: 0,
              })}{' '}
              kg
            </p>
            <p className="mt-1 text-base font-bold text-slate-500">
              Fuel Left Now
            </p>
            <div className="mt-5 grid grid-cols-2 gap-4 border-t-2 border-violet-100 pt-5">
              <div>
                <p className="text-sm font-bold text-slate-500">
                  Sold Today
                </p>
                <p className="mt-1 text-lg font-black text-slate-800">
                  {safeNum(cngStock?.sold).toLocaleString('en-PK', {
                    maximumFractionDigits: 0,
                  })}{' '}
                  kg
                </p>
              </div>
              <div>
                <p className="text-sm font-bold text-slate-500">
                  Received Today
                </p>
                <p className="mt-1 text-lg font-black text-slate-800">
                  {safeNum(cngStock?.supplied).toLocaleString('en-PK', {
                    maximumFractionDigits: 0,
                  })}{' '}
                  kg
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Low stock warning */}
        {(hasLowStock || hasStockProblem) && (
          <div className="px-7 pb-7">
            <div
              className={`flex items-center gap-4 rounded-2xl border-2 px-6 py-5 ${
                hasStockProblem
                  ? 'border-red-200 bg-red-50'
                  : 'border-amber-200 bg-amber-50'
              }`}
            >
              <AlertTriangle
                className={`h-7 w-7 shrink-0 ${
                  hasStockProblem ? 'text-red-600' : 'text-amber-600'
                }`}
              />
              <div className="min-w-0 flex-1">
                <p
                  className={`text-lg font-black ${
                    hasStockProblem
                      ? 'text-red-800'
                      : 'text-amber-800'
                  }`}
                >
                  {hasStockProblem
                    ? 'Check Stock'
                    : 'Fuel is Getting Low'}
                </p>
                <p className="mt-0.5 text-base font-medium text-slate-600">
                  {hasStockProblem
                    ? 'Review the fuel stock before the next sale.'
                    : 'Consider arranging the next tanker delivery.'}
                </p>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
