import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import '../styles/fuel-management.css';
import { saveErrorText, type SaveResult } from '../logic/saveResult';
import {
  DailyOperation,
  FuelStockDayRecord,
  FuelSupplyRecord,
  FuelType,
  Nozzle,
  StationConfig,
} from '../types';
import {
  calculateFuelStock,
  calculateFuelStockHistory,
  createFuelSupplyRecord,
  getPreviousRemainingStock,
} from '../logic/fuelStock';
import { getPakistanLocalDate } from '../logic/calculations';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Droplet,
  Flame,
  Fuel,
  Info,
  PackagePlus,
  Plus,
  Search,
  TrendingUp,
  Truck,
  X,
} from 'lucide-react';

interface FuelStockScreenProps {
  station: StationConfig;
  operations: DailyOperation[];
  nozzles: Nozzle[];
  stockRecords: FuelStockDayRecord[];
  onUpdateStockRecords: (records: FuelStockDayRecord[]) => Promise<SaveResult>;
  onUpdateStationConfig: (station: StationConfig) => Promise<SaveResult>;
  /** Mid-day fuel rate change (backend checks FUEL "manage" permission and logs the change). */
  onRateChange?: (petrolRate: number, cngRate: number) => Promise<SaveResult>;
  /** Whether the current user may change fuel rates (Owner grants this). */
  canChangeRates?: boolean;
}

const FUEL_TYPES: FuelType[] = ['PETROL', 'CNG'];
const QUICK_SELECT_OPTIONS = [1000, 2000, 5000, 10000];
const RECORDS_PER_PAGE = 10;

type StockAction = 'SUPPLY' | 'PHYSICAL';
type Status = 'OK' | 'LOW' | 'PROBLEM';

function formatQty(value: number | null): string {
  // v63: show em-dash when untracked (null) so "no data" is not confused with 0.
  if (value === null) return '-';
  return value.toLocaleString('en-PK', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

function getUnit(fuelType: FuelType): string {
  return fuelType === 'PETROL' ? 'Litres' : 'Units';
}

function getUnitShort(fuelType: FuelType): string {
  return fuelType === 'PETROL' ? 'L' : 'kg';
}

function getFuelName(fuelType: FuelType): string {
  return fuelType === 'PETROL' ? 'Petrol' : 'CNG';
}

function getStatusClass(status: Status): string {
  if (status === 'PROBLEM') return 'bg-red-50 text-red-700 ring-red-100';
  if (status === 'LOW') return 'bg-amber-50 text-amber-700 ring-amber-100';
  return 'bg-emerald-50 text-emerald-700 ring-emerald-100';
}

function getStatusDot(status: Status): string {
  if (status === 'PROBLEM') return 'bg-red-500';
  if (status === 'LOW') return 'bg-amber-500';
  return 'bg-emerald-500';
}

function getLatestRecord(
  records: FuelStockDayRecord[],
  businessDate: string,
  fuelType: FuelType,
): FuelStockDayRecord | undefined {
  return records
    .filter(
      (record) =>
        record.businessDate === businessDate && record.fuelType === fuelType,
    )
    // v63: guard against legacy records without updatedAt (crash fix).
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0];
}

export function FuelStockScreen({
  station,
  operations,
  nozzles,
  stockRecords,
  onUpdateStockRecords,
  onUpdateStationConfig,
  onRateChange,
  canChangeRates = false,
}: FuelStockScreenProps) {
  const [businessDate, setBusinessDate] = useState(getPakistanLocalDate);
  useEffect(() => {
    const refreshDate = () => setBusinessDate(getPakistanLocalDate());
    const timer = window.setInterval(refreshDate, 30000);
    window.addEventListener('focus', refreshDate);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refreshDate); };
  }, []);
  const [activeFuel, setActiveFuel] = useState<FuelType>('PETROL');
  const [showAddFuelPage, setShowAddFuelPage] = useState(false);
  const [action, setAction] = useState<StockAction | null>(null);
  const actionDateRef = useRef(businessDate);
  const [showRateDialog, setShowRateDialog] = useState(false);
  const [newPetrolRateInput, setNewPetrolRateInput] = useState('');
  const [newCngRateInput, setNewCngRateInput] = useState('');
  const [rateMessage, setRateMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  // View All popup states
  const [showStockHistoryModal, setShowStockHistoryModal] = useState(false);
  const [showReceivedHistoryModal, setShowReceivedHistoryModal] = useState(false);
  const [stockHistorySearch, setStockHistorySearch] = useState('');
  const [receivedHistorySearch, setReceivedHistorySearch] = useState('');

  // Pagination states (NEW)
  const [stockHistoryPage, setStockHistoryPage] = useState(1);
  const [receivedHistoryPage, setReceivedHistoryPage] = useState(1);

  const summaries = useMemo(
    () =>
      FUEL_TYPES.map((fuelType) =>
        calculateFuelStock(businessDate, fuelType, operations, stockRecords),
      ),
    [businessDate, operations, stockRecords],
  );

  const current = summaries.find((item) => item.fuelType === activeFuel)!;

  const history = useMemo(
    () => calculateFuelStockHistory(activeFuel, operations, stockRecords),
    [activeFuel, operations, stockRecords],
  );

  const deliveries = useMemo(() => {
    const seen = new Set<string>();
    const rows: FuelSupplyRecord[] = [];

    stockRecords
      .filter((record) => record.fuelType === activeFuel)
      .forEach((record) => {
        // v63: guard against legacy records without supplyRecords (crash fix).
        const supplies = Array.isArray(record.supplyRecords) ? record.supplyRecords : [];
        supplies.forEach((supply) => {
          if (seen.has(supply.id)) return;
          seen.add(supply.id);
          rows.push(supply);
        });
      });

    return rows
      .filter((row) =>
        `${row.businessDate} ${row.note || ''} ${getFuelName(row.fuelType)}`
          .toLowerCase()
          .includes(search.toLowerCase().trim()),
      )
      .sort((a, b) => {
        const dateCompare = b.businessDate.localeCompare(a.businessDate);
        if (dateCompare !== 0) return dateCompare;
        // v63: guard against legacy supply records without createdAt.
        return (b.createdAt || '').localeCompare(a.createdAt || '');
      });
  }, [activeFuel, search, stockRecords]);

  // Filtered history for modals
  const filteredStockHistory = useMemo(() => {
    if (!stockHistorySearch.trim()) return history;
    const query = stockHistorySearch.toLowerCase();
    return history.filter((row) =>
      `${row.businessDate} ${row.statusText}`.toLowerCase().includes(query),
    );
  }, [history, stockHistorySearch]);

  const filteredDeliveries = useMemo(() => {
    if (!receivedHistorySearch.trim()) return deliveries;
    const query = receivedHistorySearch.toLowerCase();
    return deliveries.filter((row) =>
      `${row.businessDate} ${row.note || ''} ${getFuelName(row.fuelType)}`
        .toLowerCase()
        .includes(query),
    );
  }, [deliveries, receivedHistorySearch]);

  // Pagination calculations (NEW)
  const stockHistoryTotalPages = Math.max(
    1,
    Math.ceil(filteredStockHistory.length / RECORDS_PER_PAGE),
  );
  const receivedHistoryTotalPages = Math.max(
    1,
    Math.ceil(filteredDeliveries.length / RECORDS_PER_PAGE),
  );

  const paginatedStockHistory = useMemo(() => {
    const start = (stockHistoryPage - 1) * RECORDS_PER_PAGE;
    return filteredStockHistory.slice(start, start + RECORDS_PER_PAGE);
  }, [filteredStockHistory, stockHistoryPage]);

  const paginatedDeliveries = useMemo(() => {
    const start = (receivedHistoryPage - 1) * RECORDS_PER_PAGE;
    return filteredDeliveries.slice(start, start + RECORDS_PER_PAGE);
  }, [filteredDeliveries, receivedHistoryPage]);

  // Reset pagination when search changes
  const handleStockHistorySearch = (value: string) => {
    setStockHistorySearch(value);
    setStockHistoryPage(1);
  };

  const handleReceivedHistorySearch = (value: string) => {
    setReceivedHistorySearch(value);
    setReceivedHistoryPage(1);
  };

  const requestAction = (nextAction: StockAction) => {
    actionDateRef.current = businessDate;
    setAction(nextAction);
    setQuantity('');
    setNote('');
    setMessage(null);
    setShowAddFuelPage(false);
    if (nextAction === 'SUPPLY') setShowAddFuelPage(true);
  };

  const savingRef = useRef(false);

  const saveAction = async () => {
    if (!action || savingRef.current) return;
    // Recheck at save time as timers may be suspended while the laptop sleeps.
    const currentDate = getPakistanLocalDate();
    if (currentDate !== businessDate || currentDate !== actionDateRef.current) {
      setBusinessDate(currentDate);
      actionDateRef.current = currentDate;
      setMessage('The date has changed. Check the date and save again.');
      return;
    }

    const value = Number(quantity);

    if (
      !Number.isFinite(value) ||
      value < 0 ||
      (action === 'SUPPLY' && value <= 0)
    ) {
      setMessage(
        action === 'SUPPLY'
          ? 'Enter a quantity greater than zero.'
          : 'Enter a valid physical stock.',
      );
      return;
    }

    const now = new Date().toISOString();
    const existing = getLatestRecord(stockRecords, businessDate, activeFuel);

    const nextRecord: FuelStockDayRecord = existing
      ? { ...existing, updatedAt: now }
      : {
          id: `stock-${businessDate}-${activeFuel.toLowerCase()}`,
          businessDate,
          fuelType: activeFuel,
          openingStock: 0,
          supplyRecords: [],
          createdAt: now,
          updatedAt: now,
        };

    if (action === 'SUPPLY') {
      const supply = createFuelSupplyRecord(
        businessDate,
        activeFuel,
        value,
        note,
      );
      // v63: guard against legacy records without supplyRecords.
      nextRecord.supplyRecords = [...(Array.isArray(nextRecord.supplyRecords) ? nextRecord.supplyRecords : []), supply];
    } else {
      nextRecord.actualPhysicalStock = value;
      nextRecord.physicalCheckAt = now;
      nextRecord.physicalCheckNote = note.trim() || undefined;
    }

    savingRef.current = true;
    try {
      const result = await onUpdateStockRecords([
        ...stockRecords.filter((record) => record.id !== nextRecord.id),
        nextRecord,
      ]);

      if (!result.ok) {
        // Keep the form open and the entered quantity/note so nothing has to be typed again.
        setMessage(`Not saved: ${saveErrorText(result)}`);
        return;
      }

      setMessage('Saved');
      setShowAddFuelPage(false);
      setAction(null);
    } finally {
      savingRef.current = false;
    }
  };

  const previousStock = getPreviousRemainingStock(
    stockRecords,
    operations,
    businessDate,
    activeFuel,
  );

  const lastDelivery = useMemo(() => {
    const rows: FuelSupplyRecord[] = [];
    stockRecords
      .filter((record) => record.fuelType === activeFuel)
      .forEach((record) => {
        // v63: guard against legacy records without supplyRecords.
        const supplies = Array.isArray(record.supplyRecords) ? record.supplyRecords : [];
        supplies.forEach((supply) => rows.push(supply));
      });
    // v63: guard against legacy supply records without createdAt.
    return rows.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
  }, [activeFuel, stockRecords]);

  // ============ ADD FUEL RECEIVED PAGE ============
  if (showAddFuelPage && action === 'SUPPLY') {
    return (
      <div
        className="fuel-management fuel-stock-entry space-y-6"
        data-fuel={activeFuel}
        style={{ fontFamily: 'var(--ui-font)' }}
      >
        {/* Page Header */}
        <div className="fuel-entry-header">
          <button
            type="button"
            onClick={() => {
              setShowAddFuelPage(false);
              setAction(null);
              setQuantity('');
              setNote('');
              setMessage(null);
            }}
            className="fuel-back-button rounded-lg bg-white text-blue-700 flex items-center justify-center gap-2 shrink-0"
            title="Back"
          >
            <ArrowLeft className="w-7 h-7" aria-hidden="true" /> Back
          </button>
          <div>
            <h1 className="text-3xl font-black tracking-tight text-slate-900">
              Add Fuel Received
            </h1>
            <p className="mt-1 text-lg font-medium text-slate-500">
              Record new fuel delivery from tanker
            </p>
          </div>
        </div>

        {/* Main Grid */}
        <div className="fuel-delivery-layout">
          {/* Left: Form */}
          <div className="space-y-6">
            <div className="rounded-2xl border-2 border-slate-200 bg-white p-7 shadow-sm">
              <div className="fuel-entry-section-heading">
                <div className="fuel-entry-icon">
                  {activeFuel === 'PETROL' ? <Droplet aria-hidden="true" /> : <Flame aria-hidden="true" />}
                </div>
                <h2 className="text-2xl font-black text-slate-900">
                  Fuel Information
                </h2>
              </div>

              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <div>
                  <label htmlFor="fuel-delivery-type" className="block text-lg font-bold text-slate-700 mb-3">
                    Fuel Type <span className="text-red-500">*</span>
                  </label>
                  <div className="fuel-entry-select">
                    {activeFuel === 'PETROL' ? <Droplet aria-hidden="true" /> : <Flame aria-hidden="true" />}
                    <select
                      id="fuel-delivery-type"
                      value={activeFuel}
                      onChange={(e) => setActiveFuel(e.target.value as FuelType)}
                      className="w-full h-14 pl-12 pr-4 rounded-xl border-2 border-slate-200 bg-white text-lg font-semibold text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-4 focus:ring-emerald-100 cursor-pointer appearance-none"
                    >
                      <option value="PETROL">Petrol</option>
                      <option value="CNG">CNG</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label htmlFor="fuel-delivery-quantity" className="block text-lg font-bold text-slate-700 mb-3">
                    Quantity ({getUnitShort(activeFuel)}) <span className="text-red-500">*</span>
                  </label>
                  <div className="fuel-entry-quantity">
                    <input
                      id="fuel-delivery-quantity"
                      autoFocus
                      type="number"
                      min="0"
                      step="0.001"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      placeholder="5,000"
                      className="w-full h-14 px-4 pr-14 rounded-xl border-2 border-slate-200 bg-white text-lg font-bold text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-4 focus:ring-emerald-100"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-lg font-bold text-slate-500">
                      {getUnitShort(activeFuel)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-7">
                <label htmlFor="fuel-delivery-note" className="block text-lg font-bold text-slate-700 mb-3">
                  Note (Optional)
                </label>
                <div className="relative">
                  <textarea
                    id="fuel-delivery-note"
                    rows={2}
                    maxLength={200}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Delivery or supplier details"
                    className="w-full rounded-xl border-2 border-slate-200 bg-white px-5 py-4 text-lg text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-4 focus:ring-emerald-100 resize-none"
                  />
                  <span className="absolute right-4 bottom-4 text-sm font-semibold text-slate-400">
                    {note.length}/200
                  </span>
                </div>
              </div>

              <div className="fuel-entry-hint">
                <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
                <p className="text-lg font-semibold text-emerald-800">
                  This quantity will be added to your current fuel stock.
                </p>
              </div>

              <div className="mt-7">
                <label className="block text-lg font-bold text-slate-700 mb-3">
                  Quick Select
                </label>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {QUICK_SELECT_OPTIONS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setQuantity(String(value))}
                      className="h-14 rounded-xl border-2 border-slate-200 bg-white text-lg font-bold text-slate-700 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 transition-colors cursor-pointer"
                    >
                      {value.toLocaleString('en-PK')} {getUnitShort(activeFuel)}
                    </button>
                  ))}
                </div>
              </div>

              {message && (
                <div className="mt-6 rounded-xl border-2 border-red-200 bg-red-50 px-5 py-4 text-lg font-bold text-red-700">
                  {message}
                </div>
              )}

              <div className="fuel-entry-footer">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddFuelPage(false);
                    setAction(null);
                    setQuantity('');
                    setNote('');
                    setMessage(null);
                  }}
                  className="fuel-action"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveAction}
                  className="fuel-action fuel-action--primary"
                >
                  <CheckCircle2 className="w-6 h-6" />
                  Save fuel received
                </button>
              </div>
            </div>
          </div>

          {/* Right: Info Cards */}
          <div className="space-y-6">
            <div className="rounded-2xl border-2 border-emerald-100 bg-emerald-50/40 p-7 shadow-sm">
              <div className="fuel-entry-section-heading">
                <div className="fuel-entry-icon">
                  {activeFuel === 'PETROL' ? <Droplet aria-hidden="true" /> : <Flame aria-hidden="true" />}
                </div>
                <div>
                  <p className="text-lg font-bold text-slate-700">
                    Current Stock ({getFuelName(activeFuel)})
                  </p>
                </div>
              </div>
              <p className="mt-5 text-4xl font-black tracking-tight text-slate-900">
                {formatQty(current.remainingStock)}{' '}
                {getUnitShort(activeFuel)}
              </p>

              {lastDelivery && (
                <div className="mt-5 border-t-2 border-emerald-100 pt-5">
                  <p className="text-base font-bold text-slate-700">
                    Last Delivery
                  </p>
                  <p className="mt-2 text-lg font-semibold text-slate-600">
                    {lastDelivery.businessDate}{' '}
                    <span className="text-slate-400">|</span>{' '}
                    {formatQty(lastDelivery.quantity)}{' '}
                    {getUnitShort(lastDelivery.fuelType)}
                  </p>
                </div>
              )}
            </div>

            <div className="rounded-2xl border-2 border-slate-200 bg-white p-7 shadow-sm">
              <div className="flex items-center justify-between gap-3 mb-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                    <Truck className="w-6 h-6" />
                  </div>
                  <h3 className="text-xl font-black text-slate-900">
                    Recent Fuel Received
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddFuelPage(false);
                    setAction(null);
                  }}
                  className="text-base font-bold text-emerald-700 hover:text-emerald-800"
                >
                  View All
                </button>
              </div>

              <div className="space-y-3">
                {deliveries.slice(0, 3).map((delivery) => (
                  <div
                    key={delivery.id}
                    className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-800">
                        {delivery.businessDate}
                      </p>
                      <p className="text-sm text-slate-500">
                        {getFuelName(delivery.fuelType)}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-base font-black text-slate-900">
                        {formatQty(delivery.quantity)}{' '}
                        {getUnitShort(delivery.fuelType)}
                      </p>
                      <p className="text-sm text-slate-500">
                        {delivery.note || 'Tanker delivery'}
                      </p>
                    </div>
                  </div>
                ))}
                {deliveries.length === 0 && (
                  <p className="text-center text-base text-slate-500 py-4">
                    No deliveries yet.
                  </p>
                )}
              </div>

              <div className="fuel-entry-hint">
                <Info className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-base font-black text-emerald-800">Note</p>
                  <p className="text-base font-medium text-emerald-700 mt-1">
                    Fuel received will be automatically added to your
                    continuous stock balance.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ============ MAIN FUEL STOCK SCREEN ============
  return (
    <div
      className="fuel-management fuel-stock-screen space-y-6 text-base text-slate-800"
      style={{ fontFamily: 'var(--ui-font)' }}
    >
      {/* Page Header */}
      <div className="fuel-management-header">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-slate-900">
              Fuel Stock
            </h1>
            <p className="mt-1 text-lg font-medium text-slate-500">
              Check fuel levels and record deliveries.
            </p>
          </div>
        </div>

        <div className="fuel-management-actions">
          <button
            type="button"
            onClick={() => {
              actionDateRef.current = businessDate;
              setAction('SUPPLY');
              setQuantity('');
              setNote('');
              setMessage(null);
              setShowAddFuelPage(true);
            }}
            className="fuel-action fuel-action--primary"
          >
            <Plus className="h-6 w-6" />
            Add Fuel Received
          </button>
          <button
            type="button"
            onClick={() => requestAction('PHYSICAL')}
            className="fuel-action"
          >
            <ClipboardCheck className="h-6 w-6" />
            Check Tank
          </button>
          {canChangeRates && onRateChange && (
            <button
              type="button"
              onClick={() => {
                setNewPetrolRateInput(String(station.rates?.PETROL ?? ''));
                setNewCngRateInput(String(station.rates?.CNG ?? ''));
                setRateMessage(null);
                setShowRateDialog(true);
              }}
              className="fuel-action"
              title="Change fuel rates (old sales keep old rate, new sales use new rate)"
            >
              Change Rates
            </button>
          )}
        </div>
      </div>

      {/* Fuel Type Tabs */}
      <div className="fuel-management-tabs" role="group" aria-label="Fuel type">
        {FUEL_TYPES.map((fuelType) => {
          const item = summaries.find(
            (summary) => summary.fuelType === fuelType,
          )!;
          const isActive = activeFuel === fuelType;

          return (
            <button
              type="button"
              key={fuelType}
              data-fuel={fuelType}
              aria-pressed={isActive}
              onClick={() => setActiveFuel(fuelType)}
              className={`flex items-center justify-center gap-3 rounded-lg px-6 py-3.5 text-lg font-bold transition ${
                isActive
                  ? 'bg-emerald-700 text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {fuelType === 'PETROL' ? <Droplet className="h-5 w-5" /> : <Flame className="h-5 w-5" />}
              {getFuelName(fuelType)}
              <span
                className={`h-3 w-3 rounded-full ${getStatusDot(item.status)}`}
              />
            </button>
          );
        })}
      </div>

      {/* Fuel Left Now + Stats Card */}
      <section className="fuel-stock-metrics" aria-label="Stock summary">
        <div className="fuel-management-metrics">
          <div className="flex items-center gap-5 lg:border-r-2 lg:border-emerald-100 lg:pr-6">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-200 text-emerald-800 shrink-0">
              <Fuel className="w-10 h-10" />
            </div>
            <div>
              <p className="text-base font-bold text-slate-600">
                Fuel Left Now
              </p>
              <p className="mt-2 text-4xl font-black tracking-tight text-slate-900">
                {formatQty(current.remainingStock)}{' '}
                <span className="text-2xl">{getUnitShort(activeFuel)}</span>
              </p>
              <div
                className={`mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-bold ring-1 ${getStatusClass(
                  current.status,
                )}`}
              >
                <span
                  className={`h-2.5 w-2.5 rounded-full ${getStatusDot(
                    current.status,
                  )}`}
                />
                {current.statusText}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 lg:border-r-2 lg:border-emerald-100 lg:pr-6">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-600 shrink-0">
              <Droplet className="w-7 h-7" />
            </div>
            <div>
              <p className="text-base font-bold text-slate-600">
                Sold Today
              </p>
              <p className="mt-2 text-3xl font-black tracking-tight text-slate-900">
                {formatQty(current.sold)}{' '}
                <span className="text-xl">{getUnitShort(activeFuel)}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 lg:border-r-2 lg:border-emerald-100 lg:pr-6">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-100 text-blue-600 shrink-0">
              <Truck className="w-7 h-7" />
            </div>
            <div>
              <p className="text-base font-bold text-slate-600">
                Received Today
              </p>
              <p className="mt-2 text-3xl font-black tracking-tight text-slate-900">
                {formatQty(current.supplied)}{' '}
                <span className="text-xl">{getUnitShort(activeFuel)}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 shrink-0">
              <TrendingUp className="w-7 h-7" />
            </div>
            <div>
              <p className="text-base font-bold text-slate-600">
                Sold Since Start
              </p>
              <p className="mt-2 text-3xl font-black tracking-tight text-slate-900">
                {formatQty(current.soldSinceStart)}{' '}
                <span className="text-xl">{getUnitShort(activeFuel)}</span>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Two History Tables Side by Side */}
      <div className="fuel-stock-tables">
        {/* Fuel Stock History */}
        <section className="overflow-hidden rounded-2xl border-2 border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b-2 border-slate-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                <TrendingUp className="w-6 h-6" />
              </div>
              <h2 className="text-xl font-black text-slate-900">
                Fuel Stock History
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setShowStockHistoryModal(true)}
              className="fuel-history-link"
            >
              View All
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50">
                <tr className="border-b-2 border-slate-100">
                  <th className="whitespace-nowrap px-5 py-4 text-sm font-black text-slate-600 uppercase tracking-wide">
                    Date
                  </th>
                  <th className="whitespace-nowrap px-5 py-4 text-right text-sm font-black text-slate-600 uppercase tracking-wide">
                    Fuel Received
                  </th>
                  <th className="whitespace-nowrap px-5 py-4 text-right text-sm font-black text-slate-600 uppercase tracking-wide">
                    Sold
                  </th>
                  <th className="whitespace-nowrap px-5 py-4 text-right text-sm font-black text-slate-600 uppercase tracking-wide">
                    Fuel Left
                  </th>
                  <th className="whitespace-nowrap px-5 py-4 text-center text-sm font-black text-slate-600 uppercase tracking-wide">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y-2 divide-slate-100">
                {history.slice(0, 5).map((row) => (
                  <tr key={row.businessDate} className="hover:bg-slate-50/70">
                    <td className="whitespace-nowrap px-5 py-4 text-sm font-semibold text-slate-800">
                      {row.businessDate}
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-right text-sm font-semibold text-slate-700">
                      {formatQty(row.supplied)} {getUnitShort(activeFuel)}
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-right text-sm font-semibold text-slate-700">
                      {formatQty(row.sold)} {getUnitShort(activeFuel)}
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-right text-sm font-black text-slate-900">
                      {formatQty(row.remainingStock)} {getUnitShort(activeFuel)}
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-center">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ring-1 ${getStatusClass(
                          row.status,
                        )}`}
                      >
                        <span
                          className={`h-2 w-2 rounded-full ${getStatusDot(
                            row.status,
                          )}`}
                        />
                        {row.statusText}
                      </span>
                    </td>
                  </tr>
                ))}

                {history.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-10 text-center">
                      <p className="text-base font-bold text-slate-600">
                        No stock history yet.
                      </p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Fuel Received History */}
        <section className="overflow-hidden rounded-2xl border-2 border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b-2 border-slate-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                <Truck className="w-6 h-6" />
              </div>
              <h2 className="text-xl font-black text-slate-900">
                Fuel Received History
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setShowReceivedHistoryModal(true)}
              className="fuel-history-link"
            >
              View All
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50">
                <tr className="border-b-2 border-slate-100">
                  <th className="whitespace-nowrap px-5 py-4 text-sm font-black text-slate-600 uppercase tracking-wide">
                    Date
                  </th>
                  <th className="whitespace-nowrap px-5 py-4 text-sm font-black text-slate-600 uppercase tracking-wide">
                    Fuel Type
                  </th>
                  <th className="whitespace-nowrap px-5 py-4 text-right text-sm font-black text-slate-600 uppercase tracking-wide">
                    Quantity
                  </th>
                  <th className="whitespace-nowrap px-5 py-4 text-sm font-black text-slate-600 uppercase tracking-wide">
                    Note
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y-2 divide-slate-100">
                {deliveries.slice(0, 5).map((delivery) => (
                  <tr key={delivery.id} className="hover:bg-slate-50/70">
                    <td className="whitespace-nowrap px-5 py-4 text-sm font-semibold text-slate-800">
                      {delivery.businessDate}
                    </td>
                    <td className="whitespace-nowrap px-5 py-4">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${
                          delivery.fuelType === 'CNG'
                            ? 'bg-violet-100 text-violet-700'
                            : 'bg-emerald-100 text-emerald-700'
                        }`}
                      >
                        {getFuelName(delivery.fuelType)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-right text-sm font-black text-slate-900">
                      {formatQty(delivery.quantity)}{' '}
                      {getUnitShort(delivery.fuelType)}
                    </td>
                    <td className="px-5 py-4 text-sm text-slate-600">
                      {delivery.note || 'Tanker delivery'}
                    </td>
                  </tr>
                ))}

                {deliveries.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-10 text-center">
                      <p className="text-base font-bold text-slate-600">
                        No fuel received records yet.
                      </p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Bottom Info Banner */}
      <div className="flex flex-col gap-4 rounded-2xl border-2 border-emerald-100 bg-emerald-50/40 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 shrink-0">
            <Info className="w-6 h-6" />
          </div>
          <p className="text-base font-semibold text-slate-700">
            Stock updates automatically when fuel is received or nozzle readings
            are accepted.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setActiveFuel(activeFuel === 'PETROL' ? 'CNG' : 'PETROL')}
          className="inline-flex items-center gap-2 self-start rounded-xl px-4 py-2 text-base font-bold text-emerald-700 hover:bg-emerald-100 sm:self-auto"
        >
          <Fuel className="w-5 h-5" />
          {getFuelName(activeFuel)}
          <span className="text-emerald-600">›</span>
        </button>
      </div>

      {/* Message */}
      {message && (
        <div className="rounded-xl border-2 border-emerald-100 bg-emerald-50 px-5 py-4 text-lg font-bold text-emerald-700">
          {message}
        </div>
      )}

      {/* ============ STOCK HISTORY MODAL ============ */}
      {showStockHistoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-2xl border-2 border-slate-200 bg-white shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between gap-4 border-b-2 border-slate-100 px-7 py-6">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                  <TrendingUp className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-2xl font-black text-slate-900">
                    Fuel Stock History
                  </h3>
                  <p className="mt-1 text-base font-medium text-slate-500">
                    Complete history for {getFuelName(activeFuel)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowStockHistoryModal(false);
                  setStockHistorySearch('');
                  setStockHistoryPage(1);
                }}
                className="flex h-12 w-12 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
              >
                <X className="w-7 h-7" />
              </button>
            </div>

            {/* Search */}
            <div className="border-b-2 border-slate-100 px-7 py-4">
              <div className="flex items-center gap-2 rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-3">
                <Search className="h-5 w-5 text-slate-400" />
                <input
                  value={stockHistorySearch}
                  onChange={(e) => handleStockHistorySearch(e.target.value)}
                  placeholder="Search by date or status..."
                  className="w-full bg-transparent text-base text-slate-800 outline-none placeholder:text-slate-400"
                />
              </div>
            </div>

            {/* Table */}
            <div className="fuel-history-scroll flex-1 overflow-y-auto">
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b-2 border-slate-200">
                    <th className="px-4 py-3 text-sm font-black text-slate-600 uppercase tracking-wide">
                      Date
                    </th>
                    <th className="px-4 py-3 text-right text-sm font-black text-slate-600 uppercase tracking-wide">
                      Fuel Received
                    </th>
                    <th className="px-4 py-3 text-right text-sm font-black text-slate-600 uppercase tracking-wide">
                      Sold
                    </th>
                    <th className="px-4 py-3 text-right text-sm font-black text-slate-600 uppercase tracking-wide">
                      Fuel Left
                    </th>
                    <th className="px-4 py-3 text-center text-sm font-black text-slate-600 uppercase tracking-wide">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y-2 divide-slate-100">
                  {paginatedStockHistory.map((row) => (
                    <tr key={row.businessDate} className="hover:bg-slate-50/70">
                      <td className="px-4 py-4 text-base font-semibold text-slate-800">
                        {row.businessDate}
                      </td>
                      <td className="px-4 py-4 text-right text-base font-semibold text-slate-700">
                        {formatQty(row.supplied)} {getUnitShort(activeFuel)}
                      </td>
                      <td className="px-4 py-4 text-right text-base font-semibold text-slate-700">
                        {formatQty(row.sold)} {getUnitShort(activeFuel)}
                      </td>
                      <td className="px-4 py-4 text-right text-base font-black text-slate-900">
                        {formatQty(row.remainingStock)} {getUnitShort(activeFuel)}
                      </td>
                      <td className="px-4 py-4 text-center">
                        <span
                          className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold ring-1 ${getStatusClass(
                            row.status,
                          )}`}
                        >
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${getStatusDot(
                              row.status,
                            )}`}
                          />
                          {row.statusText}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {filteredStockHistory.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-12 text-center">
                        <p className="text-lg font-bold text-slate-600">
                          No records found.
                        </p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination + Footer (NEW) */}
            <div className="flex flex-col gap-4 border-t-2 border-slate-100 px-7 py-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-base font-semibold text-slate-600">
                Showing{' '}
                {filteredStockHistory.length === 0
                  ? 0
                  : (stockHistoryPage - 1) * RECORDS_PER_PAGE + 1}
                -
                {Math.min(
                  stockHistoryPage * RECORDS_PER_PAGE,
                  filteredStockHistory.length,
                )}{' '}
                of {filteredStockHistory.length} records
              </p>

              <div className="flex items-center gap-2">
                {/* Previous */}
                <button
                  type="button"
                  onClick={() => setStockHistoryPage((p) => Math.max(1, p - 1))}
                  disabled={stockHistoryPage === 1}
                  className="flex h-11 w-11 items-center justify-center rounded-xl border-2 border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title="Previous page"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>

                {/* Page numbers */}
                {Array.from({ length: stockHistoryTotalPages }, (_, i) => i + 1)
                  .filter((page) => {
                    // Show first, last, current, and 1 neighbor of current
                    if (page === 1 || page === stockHistoryTotalPages) return true;
                    if (Math.abs(page - stockHistoryPage) <= 1) return true;
                    return false;
                  })
                  .map((page, idx, arr) => {
                    const prev = arr[idx - 1];
                    const showEllipsis = prev && page - prev > 1;
                    return (
                      <div key={page} className="flex items-center gap-2">
                        {showEllipsis && (
                          <span className="px-2 text-slate-400">...</span>
                        )}
                        <button
                          type="button"
                          onClick={() => setStockHistoryPage(page)}
                          className={`flex h-11 min-w-11 items-center justify-center rounded-xl border-2 px-4 text-base font-bold transition-colors ${
                            page === stockHistoryPage
                              ? 'border-emerald-600 bg-emerald-600 text-white'
                              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          {page}
                        </button>
                      </div>
                    );
                  })}

                {/* Next */}
                <button
                  type="button"
                  onClick={() =>
                    setStockHistoryPage((p) =>
                      Math.min(stockHistoryTotalPages, p + 1),
                    )
                  }
                  disabled={stockHistoryPage === stockHistoryTotalPages}
                  className="flex h-11 w-11 items-center justify-center rounded-xl border-2 border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title="Next page"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>

                {/* Close */}
                <button
                  type="button"
                  onClick={() => {
                    setShowStockHistoryModal(false);
                    setStockHistorySearch('');
                    setStockHistoryPage(1);
                  }}
                  className="ml-2 rounded-xl bg-emerald-600 px-6 py-3 text-base font-bold text-white hover:bg-emerald-700 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============ RECEIVED HISTORY MODAL ============ */}
      {showReceivedHistoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl border-2 border-slate-200 bg-white shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between gap-4 border-b-2 border-slate-100 px-7 py-6">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                  <Truck className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-2xl font-black text-slate-900">
                    Fuel Received History
                  </h3>
                  <p className="mt-1 text-base font-medium text-slate-500">
                    All tanker deliveries for {getFuelName(activeFuel)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowReceivedHistoryModal(false);
                  setReceivedHistorySearch('');
                  setReceivedHistoryPage(1);
                }}
                className="flex h-12 w-12 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
              >
                <X className="w-7 h-7" />
              </button>
            </div>

            {/* Search */}
            <div className="border-b-2 border-slate-100 px-7 py-4">
              <div className="flex items-center gap-2 rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-3">
                <Search className="h-5 w-5 text-slate-400" />
                <input
                  value={receivedHistorySearch}
                  onChange={(e) => handleReceivedHistorySearch(e.target.value)}
                  placeholder="Search by date, fuel type or note..."
                  className="w-full bg-transparent text-base text-slate-800 outline-none placeholder:text-slate-400"
                />
              </div>
            </div>

            {/* Table */}
            <div className="fuel-history-scroll flex-1 overflow-y-auto">
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b-2 border-slate-200">
                    <th className="px-4 py-3 text-sm font-black text-slate-600 uppercase tracking-wide">
                      Date
                    </th>
                    <th className="px-4 py-3 text-sm font-black text-slate-600 uppercase tracking-wide">
                      Fuel Type
                    </th>
                    <th className="px-4 py-3 text-right text-sm font-black text-slate-600 uppercase tracking-wide">
                      Quantity
                    </th>
                    <th className="px-4 py-3 text-sm font-black text-slate-600 uppercase tracking-wide">
                      Note
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y-2 divide-slate-100">
                  {paginatedDeliveries.map((delivery) => (
                    <tr key={delivery.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-4 text-base font-semibold text-slate-800">
                        {delivery.businessDate}
                      </td>
                      <td className="px-4 py-4">
                        <span
                          className={`inline-flex rounded-full px-4 py-1.5 text-sm font-bold ${
                            delivery.fuelType === 'CNG'
                              ? 'bg-violet-100 text-violet-700'
                              : 'bg-emerald-100 text-emerald-700'
                          }`}
                        >
                          {getFuelName(delivery.fuelType)}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right text-base font-black text-slate-900">
                        {formatQty(delivery.quantity)}{' '}
                        {getUnitShort(delivery.fuelType)}
                      </td>
                      <td className="px-4 py-4 text-base text-slate-600">
                        {delivery.note || 'Tanker delivery'}
                      </td>
                    </tr>
                  ))}
                  {filteredDeliveries.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-12 text-center">
                        <p className="text-lg font-bold text-slate-600">
                          No records found.
                        </p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination + Footer (NEW) */}
            <div className="flex flex-col gap-4 border-t-2 border-slate-100 px-7 py-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-base font-semibold text-slate-600">
                Showing{' '}
                {filteredDeliveries.length === 0
                  ? 0
                  : (receivedHistoryPage - 1) * RECORDS_PER_PAGE + 1}
                -
                {Math.min(
                  receivedHistoryPage * RECORDS_PER_PAGE,
                  filteredDeliveries.length,
                )}{' '}
                of {filteredDeliveries.length} records
              </p>

              <div className="flex items-center gap-2">
                {/* Previous */}
                <button
                  type="button"
                  onClick={() =>
                    setReceivedHistoryPage((p) => Math.max(1, p - 1))
                  }
                  disabled={receivedHistoryPage === 1}
                  className="flex h-11 w-11 items-center justify-center rounded-xl border-2 border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title="Previous page"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>

                {/* Page numbers */}
                {Array.from(
                  { length: receivedHistoryTotalPages },
                  (_, i) => i + 1,
                )
                  .filter((page) => {
                    if (page === 1 || page === receivedHistoryTotalPages)
                      return true;
                    if (Math.abs(page - receivedHistoryPage) <= 1) return true;
                    return false;
                  })
                  .map((page, idx, arr) => {
                    const prev = arr[idx - 1];
                    const showEllipsis = prev && page - prev > 1;
                    return (
                      <div key={page} className="flex items-center gap-2">
                        {showEllipsis && (
                          <span className="px-2 text-slate-400">...</span>
                        )}
                        <button
                          type="button"
                          onClick={() => setReceivedHistoryPage(page)}
                          className={`flex h-11 min-w-11 items-center justify-center rounded-xl border-2 px-4 text-base font-bold transition-colors ${
                            page === receivedHistoryPage
                              ? 'border-emerald-600 bg-emerald-600 text-white'
                              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          {page}
                        </button>
                      </div>
                    );
                  })}

                {/* Next */}
                <button
                  type="button"
                  onClick={() =>
                    setReceivedHistoryPage((p) =>
                      Math.min(receivedHistoryTotalPages, p + 1),
                    )
                  }
                  disabled={receivedHistoryPage === receivedHistoryTotalPages}
                  className="flex h-11 w-11 items-center justify-center rounded-xl border-2 border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title="Next page"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>

                {/* Close */}
                <button
                  type="button"
                  onClick={() => {
                    setShowReceivedHistoryModal(false);
                    setReceivedHistorySearch('');
                    setReceivedHistoryPage(1);
                  }}
                  className="ml-2 rounded-xl bg-emerald-600 px-6 py-3 text-base font-bold text-white hover:bg-emerald-700 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tank Check Editor Modal */}
      {action === 'PHYSICAL' && !showAddFuelPage && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/40 p-4 sm:items-center">
          <div className="w-full max-w-lg rounded-2xl border-2 border-slate-200 bg-white p-7 shadow-xl">
            <div className="mb-6 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-2xl font-black text-slate-900">
                  Check Tank
                </h3>
                <p className="mt-1 text-lg font-medium text-slate-500">
                  {getFuelName(activeFuel)} | {businessDate}
                </p>
              </div>
              <X
                className="h-7 w-7 text-slate-400 cursor-pointer hover:text-slate-700"
                onClick={() => setAction(null)}
              />
            </div>

            <div className="space-y-5">
              <div>
                <label className="mb-2 block text-lg font-bold text-slate-700">
                  Actual Stock
                </label>
                <input
                  autoFocus
                  type="number"
                  min="0"
                  step="0.001"
                  value={quantity}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setQuantity(event.target.value)
                  }
                  placeholder="Enter physical stock"
                  className="w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-5 py-4 text-lg text-slate-900 outline-none focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/10"
                />
              </div>

              <div>
                <label className="mb-2 block text-lg font-bold text-slate-700">
                  Note
                </label>
                <input
                  value={note}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setNote(event.target.value)
                  }
                  placeholder="Optional"
                  className="w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-5 py-4 text-lg text-slate-900 outline-none focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/10"
                />
              </div>
            </div>

            {message && (
              <div className="mt-4 rounded-xl border-2 border-red-100 bg-red-50 px-4 py-3 text-lg font-bold text-red-700">
                {message}
              </div>
            )}

            <div className="mt-7 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setAction(null);
                  setMessage(null);
                }}
                className="rounded-xl border-2 border-slate-200 bg-white px-6 py-4 text-lg font-bold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveAction}
                className="rounded-xl bg-emerald-600 px-6 py-4 text-lg font-bold text-white hover:bg-emerald-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mid-day fuel rate change dialog */}
      {showRateDialog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
            <h2 className="text-2xl font-black text-slate-900">Change Fuel Rates</h2>
            <p className="text-base text-slate-600">
              Current: Petrol Rs. {station.rates?.PETROL ?? 0}/L, CNG Rs. {station.rates?.CNG ?? 0}/kg.
              Old sales keep their old rate; only new readings use the new rate.
              This change is logged with your name.
            </p>
            {rateMessage && (
              <div className={`rounded-xl px-4 py-3 text-sm font-bold ${rateMessage.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'}`}>
                {rateMessage.text}
              </div>
            )}
            <div className="space-y-3">
              <label className="block">
                <span className="text-base font-bold text-slate-700">New petrol rate per litre (Rs.)</span>
                <input
                  type="number" min="0.01" step="0.01" required
                  value={newPetrolRateInput}
                  onChange={(e) => setNewPetrolRateInput(e.target.value)}
                  className="mt-1 w-full rounded-xl border-2 border-slate-200 px-4 py-3 text-lg text-slate-900 outline-none focus:border-amber-500"
                />
              </label>
              <label className="block">
                <span className="text-base font-bold text-slate-700">New CNG rate per kg (Rs.)</span>
                <input
                  type="number" min="0.01" step="0.01" required
                  value={newCngRateInput}
                  onChange={(e) => setNewCngRateInput(e.target.value)}
                  className="mt-1 w-full rounded-xl border-2 border-slate-200 px-4 py-3 text-lg text-slate-900 outline-none focus:border-amber-500"
                />
              </label>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowRateDialog(false)}
                className="rounded-xl border-2 border-slate-200 bg-white px-6 py-3 text-lg font-bold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const pr = Number(newPetrolRateInput);
                  const cr = Number(newCngRateInput);
                  if (!Number.isFinite(pr) || pr <= 0 || !Number.isFinite(cr) || cr <= 0) {
                    setRateMessage({ type: 'error', text: 'Enter valid petrol and CNG rates.' });
                    return;
                  }
                  if (!onRateChange) return;
                  const result = await onRateChange(pr, cr);
                  if (result.ok) {
                    setRateMessage({ type: 'success', text: `Fuel rates updated and saved: Petrol Rs. ${pr}, CNG Rs. ${cr}.` });
                  } else {
                    setRateMessage({ type: 'error', text: `Rates were NOT saved: ${result.error || 'Unknown error'}.` });
                  }
                }}
                className="rounded-xl bg-amber-600 px-6 py-3 text-lg font-bold text-white hover:bg-amber-700"
              >
                Save rates
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
