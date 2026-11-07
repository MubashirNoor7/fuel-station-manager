import React, { useState, useEffect, useRef, useCallback, Component, ReactNode } from 'react';
import { StationConfig, Pump, Nozzle, DailyOperation, FuelStockDayRecord, StationConfigUpdate, RateChangeRecord } from './types';
import { getPakistanLocalDate } from './logic/calculations';
import { Navigation, ScreenTab } from './components/Navigation';
import { DashboardScreen } from './components/DashboardScreen';
import { DailyOperationScreen } from './components/DailyOperationScreen';
import { PumpsNozzlesScreen } from './components/PumpsNozzlesScreen';
import { HistoryScreen } from './components/HistoryScreen';
import { CustomersPage } from './components/CustomersPage';
import { ExpensesPage } from './components/ExpensesPage';
import { FuelStockScreen } from './components/FuelStockScreen';
import { AlertTriangle, RotateCcw, CalendarDays, UserCog, X } from 'lucide-react';
import type { SaveResult } from './logic/saveResult';
import './styles/fuel-workspace.css';
import { updateNozzleMeters } from './logic/readingLedger';
import { standaloneExpensesFromRows, summaryTotalForKind, type StandaloneExpense } from './logic/dayTotals';


type PetrolSqliteState = {
  station: StationConfig | null;
  pumps: Pump[];
  nozzles: Nozzle[];
  operations: DailyOperation[];
  fuelStock: FuelStockDayRecord[];
  rateChanges: RateChangeRecord[];
};

const EMPTY_STATION: StationConfig = {
  stationName: 'My Petrol Pump',
  address: '',
  phone: '',
  managerName: '',
  currency: 'Rs.',
  rates: { PETROL: 0, CNG: 0 },
  security: { isPinSet: false },
  shifts: [
    { id: 'shift-a', name: 'Shift A', order: 1, isActive: true },
    { id: 'shift-b', name: 'Shift B', order: 2, isActive: true },
  ],
  shiftAssignments: [],
};


async function databaseRequest(payload: any) {
  if (!window.business) {
    throw new Error('Open the Windows desktop app to connect to the SQLite database.');
  }

  const result = await window.business.request(payload);
  if (!result.ok) throw new Error(result.error || 'Database request failed.');
  return result.data;
}


export type TabType =
  | 'dashboard'
  | 'daily'
  | 'fuel-stock'
  | 'pumps'
  | 'customers'
  | 'expenses'
  | 'history';

const tabToScreenTab = (tab: TabType): ScreenTab => {
  switch (tab) {
    case 'daily':
      return 'daily-operation';
    case 'fuel-stock':
      return 'fuel-stock';
    case 'pumps':
      return 'pumps-nozzles';
    default:
      return tab as ScreenTab;
  }
};

const screenTabToTab = (screen: ScreenTab): TabType => {
  switch (screen) {
    case 'daily-operation':
      return 'daily';
    case 'pumps-nozzles':
      return 'pumps';
    default:
      return screen as TabType;
  }
};

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class AppErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('App Runtime Error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6 text-center text-slate-900">
          <div className="w-full max-w-md rounded-2xl border-2 border-red-100 bg-white p-6 shadow-lg">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-500">
              <AlertTriangle className="h-7 w-7" />
            </div>

            <h2 className="mb-1 text-lg font-bold text-slate-900">
              Something went wrong
            </h2>

            <p className="mb-5 text-xs text-slate-500">
              {this.state.error?.message || 'Unexpected error in this view.'}
            </p>

            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-700 cursor-pointer"
            >
              <RotateCcw className="h-4 w-4" />
              Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export function App() {
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const selectTab = (tab: TabType) => { setActiveTab(tab); };

  const [station, setStation] = useState<StationConfig>(EMPTY_STATION);
  const [pumps, setPumps] = useState<Pump[]>([]);
  const [nozzles, setNozzles] = useState<Nozzle[]>([]);
  const [operations, setOperations] = useState<DailyOperation[]>([]);
  const [fuelStock, setFuelStock] = useState<FuelStockDayRecord[]>([]);
  const [rateChanges, setRateChanges] = useState<RateChangeRecord[]>([]);
  const [customers, setCustomers] = useState<{ id: string; name: string; active?: boolean }[]>([]);
  const loadCustomers = useCallback(async () => {
    try {
      const snap = (await databaseRequest({ type: 'snapshot', kinds: ['CREDIT', 'PAYMENT'] })) as { masters?: { customer?: { id: string; name: string; active?: boolean }[] } };
      setCustomers(snap.masters?.customer || []);
    } catch {
      // Customer list stays as-is; the Customers page loads its own copy.
    }
  }, []);
  // Expenses entered on the Expenses page (issue #17): standalone EXPENSE
  // documents in the ledger. Dashboard/History totals add these on top of
  // operation-embedded expenses; the ledger is the single source of truth.
  const [standaloneExpenses, setStandaloneExpenses] = useState<StandaloneExpense[]>([]);
  const loadStandaloneExpenses = useCallback(async () => {
    try {
      const to = getPakistanLocalDate();
      const [y, m, d] = to.split('-').map(Number);
      const from = new Date(Date.UTC(y, m - 1, d - 89)).toISOString().slice(0, 10);
      const all: any[] = [];
      for (let page = 0; page < 10; page++) {
        const snap = (await databaseRequest({ type: 'snapshot', kinds: ['EXPENSE'], from, to, page })) as { rows?: any[] };
        const rows = snap.rows || [];
        all.push(...rows);
        if (rows.length < 100) break;
      }
      setStandaloneExpenses(standaloneExpensesFromRows(all));
    } catch {
      // Totals fall back to operation-only; the pages still work.
    }
  }, []);
  // Bumps whenever the Customers tab is opened, so the Customers page
  // reloads its list instead of showing stale balances (Bilal Rs. 0 case).
  const [customersRefreshSignal, setCustomersRefreshSignal] = useState(0);
  // Today's credit given, read from the ledger (issue #17 follow-up): the
  // operation's cached udhaarTotal goes stale in-session when credit is added
  // on the Daily Operation tab, so the Dashboard must not trust it.
  const [todayCredit, setTodayCredit] = useState<number | undefined>(undefined);
  const loadTodayCredit = useCallback(async () => {
    try {
      const today = getPakistanLocalDate();
      const snap = (await databaseRequest({ type: 'snapshot', kinds: ['CREDIT'], from: today, to: today })) as { summary?: Array<{ kind: string; amount: number }> };
      setTodayCredit(summaryTotalForKind(snap.summary, 'CREDIT'));
    } catch {
      // Dashboard falls back to the operation's cached total.
      setTodayCredit(undefined);
    }
  }, []);
  const [activeOperationToEdit, setActiveOperationToEdit] = useState<DailyOperation | null>(null);
  const [databaseReady, setDatabaseReady] = useState(false);
  const [databaseError, setDatabaseError] = useState('');

  const [saveError, setSaveError] = useState('');
  const [resumeOperation, setResumeOperation] = useState<DailyOperation | null>(null);
  // Changing this key starts the Daily screen fresh (used for "Start new day").
  const [dailyScreenKey, setDailyScreenKey] = useState(0);

  // Last state that is confirmed to be inside the database. React state is only
  // updated from this after a successful save, so the screen never shows data
  // that the database does not have.
  const committedRef = useRef<PetrolSqliteState>({
    station: EMPTY_STATION, pumps: [], nozzles: [], operations: [], fuelStock: [], rateChanges: [],
  });
  // All writes run one after another through this chain.
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  const todayIso = getPakistanLocalDate();
  const managerFirstName = station.managerName?.split(' ')[0] || 'Manager';

  useEffect(() => {
    let cancelled = false;

    const loadDatabase = async () => {
      try {
        let data = (await databaseRequest({ type: 'petrolStateLoad' })) as PetrolSqliteState;
        const sqliteHasData =
          !!data.station ||
          data.pumps.length > 0 ||
          data.nozzles.length > 0 ||
          data.operations.length > 0 ||
          data.fuelStock.length > 0;

        if (!sqliteHasData) {
          const initialData: PetrolSqliteState = {
            station: EMPTY_STATION,
            pumps: [],
            nozzles: [],
            operations: [],
            fuelStock: [],
            rateChanges: [],
          };

          await databaseRequest({ type: 'petrolStateImport', data: initialData });
          data = (await databaseRequest({ type: 'petrolStateLoad' })) as PetrolSqliteState;
        }

        if (cancelled) return;

        const loadedStation = data.station || EMPTY_STATION;
        setStation(loadedStation);
        setPumps(data.pumps || []);
        setNozzles(data.nozzles || []);
        setOperations(data.operations || []);
        setFuelStock(data.fuelStock || []);
        setRateChanges(data.rateChanges || []);

        committedRef.current = {
          station: loadedStation,
          pumps: data.pumps || [],
          nozzles: data.nozzles || [],
          operations: data.operations || [],
          fuelStock: data.fuelStock || [],
          rateChanges: data.rateChanges || [],
        };

        // After a restart, continue today's saved operation instead of starting a new one.
        const today = getPakistanLocalDate();
        setResumeOperation((data.operations || []).find((op) => op.businessDate === today) || null);

        setDatabaseReady(true);
        setDatabaseError('');
        void loadCustomers();
        void loadStandaloneExpenses();
        void loadTodayCredit();
      } catch (error: any) {
        if (!cancelled) {
          setDatabaseError(error?.message || 'Could not open the SQLite database.');
        }
      }
    };

    void loadDatabase();
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep lists fresh when a tab is opened: customers (Daily Operation and
  // Customers) and standalone Expenses-page entries (Dashboard and History).
  useEffect(() => {
    if (activeTab === 'daily' || activeTab === 'customers') void loadCustomers();
    if (activeTab === 'customers') setCustomersRefreshSignal((s) => s + 1);
    if (activeTab === 'dashboard' || activeTab === 'history' || activeTab === 'expenses') void loadStandaloneExpenses();
    if (activeTab === 'dashboard') void loadTodayCredit();
  }, [activeTab, loadCustomers, loadStandaloneExpenses, loadTodayCredit]);

  const applyState = (next: PetrolSqliteState) => {
    setStation(next.station || EMPTY_STATION);
    setPumps(next.pumps);
    setNozzles(next.nozzles);
    setOperations(next.operations);
    setFuelStock(next.fuelStock);
    setRateChanges(next.rateChanges);
  };

  /**
   * Saves a change to the database FIRST, then updates the screen.
   * - Runs one save at a time (queue), always against the latest saved state.
   * - All changed records go in one database transaction (all or nothing).
   * - On failure nothing changes on screen and the error stays visible.
   */
  const commit = (updater: (current: PetrolSqliteState) => Partial<PetrolSqliteState>): Promise<SaveResult> => {
    const run = async (): Promise<SaveResult> => {
      if (!databaseReady) return { ok: false, error: 'Database is not ready yet.' };
      const current = committedRef.current;
      try {
        const patch = updater(current);
        const next: PetrolSqliteState = { ...current, ...patch };
        const deletes: any[] = [];
        const puts: any[] = [];

        if (patch.station && JSON.stringify(patch.station) !== JSON.stringify(current.station)) {
          puts.push({ action: 'put', kind: 'station', item: next.station });
        }

        const kinds = [
          ['pump', 'pumps'],
          ['nozzle', 'nozzles'],
          ['operation', 'operations'],
          ['fuelStock', 'fuelStock'],
        ] as const;

        for (const [kind, key] of kinds) {
          if (!patch[key]) continue;
          const before = new Map<string, string>((current[key] as Array<{ id: string }>).map((i) => [i.id, JSON.stringify(i)]));
          const seen = new Set<string>();
          for (const item of next[key] as Array<{ id: string }>) {
            seen.add(item.id);
            if (before.get(item.id) !== JSON.stringify(item)) puts.push({ action: 'put', kind, item });
          }
          for (const id of before.keys()) {
            if (!seen.has(id)) deletes.push({ action: 'delete', kind, id });
          }
        }

        const ops = [...deletes, ...puts];
        if (ops.length > 0) {
          await databaseRequest({ type: 'petrolStateBatch', ops });
          const saved = await databaseRequest({ type: 'petrolStateLoad' }) as PetrolSqliteState;
          committedRef.current = saved;
          applyState(saved);
        }
        return { ok: true };
      } catch (error: any) {
        const message = error?.message || 'Could not save to the database.';
        setSaveError(message);
        return { ok: false, error: message };
      }
    };

    const result = saveQueueRef.current.then(run, run) as Promise<SaveResult>;
    saveQueueRef.current = result.catch(() => undefined);
    return result;
  };

  const handleSaveOperation = (operation: DailyOperation) =>
    commit((s) => {
      const existing = s.operations.find((item) => item.id === operation.id);
      const clash = s.operations.find(
        (item) => item.businessDate === operation.businessDate && item.id !== operation.id,
      );
      // Block brand-new days and date changes onto a taken date, but never
      // block saving corrections to a record that already exists: legacy
      // duplicate dates (from before this guard) must stay editable, and
      // nothing here deletes data.
      if (clash && (!existing || existing.businessDate !== operation.businessDate)) {
        throw new Error(
          `A daily operation for ${operation.businessDate} already exists. Nothing was overwritten. Open that day from History instead.`,
        );
      }
      const exists = !!existing;
      return {
        operations: exists
          ? s.operations.map((item) => {
              if (item.id !== operation.id) return item;
              // v74: Preserve countedCash from latest committed version.
              // Only handleSaveCountedCash (dedicated action) can change it.
              // This prevents stale drafts from wiping a saved count.
              return { ...operation, countedCash: item.countedCash ?? null };
            })
          : [operation, ...s.operations],
        nozzles: updateNozzleMeters(operation, s.nozzles, s.operations),
      };
    });

  const handleUpdateOperation = async (operation: DailyOperation) => {
    const result = await commit((s) => ({
      operations: s.operations.map((item) => {
        if (item.id !== operation.id) return item;
        // v74: Preserve countedCash from latest committed version.
        return { ...item, ...operation, countedCash: item.countedCash ?? null };
      }),
    }));
    if (result.ok) {
      const saved = committedRef.current.operations.find((op) => op.id === operation.id);
      if (saved) {
        setActiveOperationToEdit(saved);
        setResumeOperation(null);
        setDailyScreenKey((key) => key + 1);
      }
    }
    return result;
  };

  // v70: Save counted cash for today's operation (from Dashboard).
  // v71: Return promise so UI waits for database success before showing "Saved!".
  // v74: Only update edit/resume states AFTER database success.
  // If DB fails, screen and database must not disagree.
  const handleSaveCountedCash = async (operationId: string, countedCash: number | null): Promise<SaveResult> => {
    const result = await commit((s) => ({
      operations: s.operations.map((item) =>
        item.id === operationId ? { ...item, countedCash } : item
      ),
    }));
    // v74: Update edit states only on success (not optimistically).
    if (result.ok) {
      setActiveOperationToEdit((prev) =>
        prev && prev.id === operationId ? { ...prev, countedCash } : prev
      );
      setResumeOperation((prev) =>
        prev && prev.id === operationId ? { ...prev, countedCash } : prev
      );
    }
    return result;
  };

  const handleUpdateFuelStock = (records: FuelStockDayRecord[]) => commit(() => ({ fuelStock: records }));
  /**
   * Station updates always merge against the latest SAVED station inside the
   * commit queue. Callers must pass an updater function so that a snapshot
   * taken from an older screen render can never wipe out a concurrent change
   * (for example a shift assignment saved together with a new employee).
   */
  const handleUpdateStation = (update: StationConfigUpdate): Promise<SaveResult> =>
    commit((s) => ({
      station: typeof update === 'function' ? update(s.station) : { ...s.station, ...update },
    }));

  // Mid-day fuel rate change: goes through the backend's petrolRateChange,
  // which logs who/when/old/new and updates station rates atomically.
  // Old readings keep their old rate.
  const handleRateChange = async (petrolRate: number, cngRate: number): Promise<SaveResult> => {
    if (!databaseReady) return { ok: false, error: 'Database is not ready yet.' };
    try {
      const result = (await databaseRequest({
        type: 'petrolRateChange',
        petrolRate,
        cngRate,
        businessDate: todayIso,
      })) as RateChangeRecord;
      // Reload to get updated station + rateChanges log.
      const data = (await databaseRequest({ type: 'petrolStateLoad' })) as PetrolSqliteState;
      const loadedStation = data.station || EMPTY_STATION;
      setStation(loadedStation);
      setRateChanges(data.rateChanges || []);
      committedRef.current = {
        ...committedRef.current,
        station: loadedStation,
        rateChanges: data.rateChanges || [],
      };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Rate change failed.' };
    }
  };

  // Udhaar (credit) entry: manager records "customer X took fuel worth Rs. Y on credit".
  // Backend auto-allocates across today's accepted sales, reduces cash posting,
  // increases customer outstanding.
  const handleAddUdhaar = async (customerId: string, amount: number, note: string, businessDate?: string): Promise<SaveResult> => {
    if (!databaseReady) return { ok: false, error: 'Database is not ready yet.' };
    try {
      // FIX 3: Use the operation's business date, not today - the user may be
      // working on an older open day or past midnight.
      const day = businessDate || todayIso;
      await databaseRequest({
        type: 'addUdhaar',
        customer: customerId,
        amount,
        note,
        businessDate: day,
        day,
      });
      void loadCustomers();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Credit save failed.' };
    }
  };

  // FIX 2: Get total udhaar for a day (for expected cash calculation).
  // Returns null on failure (instead of silent 0) so the UI knows the
  // total is unknown and doesn't show a wrong expected cash.
  const handleGetUdhaarTotal = useCallback(async (businessDate?: string): Promise<number | null> => {
    if (!databaseReady) return null;
    try {
      const result = (await databaseRequest({
        type: 'getUdhaarTotal',
        day: businessDate || todayIso,
        businessDate: businessDate || todayIso,
      })) as { total: number };
      const total = Number(result.total);
      return Number.isFinite(total) ? total : null;
    } catch {
      return null;
    }
  }, [databaseReady, todayIso]);

  const handleAddPump = (newPump: Pump) =>
    commit((s) => {
      if (s.pumps.some((p) => p.id === newPump.id)) return {};
      return { pumps: [...s.pumps, newPump] };
    });

  const handleAddNozzle = (newNozzle: Nozzle) =>
    commit((s) => {
      if (s.nozzles.some((n) => n.id === newNozzle.id)) return {};
      return { nozzles: [...s.nozzles, newNozzle] };
    });

  const handleUpdatePump = (pump: Pump) => commit((s) => ({ pumps: s.pumps.map((p) => p.id === pump.id ? { ...p, name: pump.name, notes: pump.notes } : p) }));
  const handleUpdateNozzle = (nozzle: Nozzle) => commit((s) => {
    const target = s.pumps.find((p) => p.id === nozzle.pumpId);
    if (!target) throw new Error('Select an existing pump.');
    return { nozzles: s.nozzles.map((n) => n.id === nozzle.id ? { ...n, name: nozzle.name, pumpId: nozzle.pumpId } : n) };
  });
  const handleTogglePumpActive = (id: string) =>
    commit((s) => ({ pumps: s.pumps.map((p) => (p.id === id ? { ...p, isActive: !p.isActive } : p)) }));

  const handleToggleNozzleActive = (id: string, opts?: { reason?: string; reactivateChoice?: string }) =>
    commit((s) => {
      const nozzle = s.nozzles.find((n) => n.id === id);
      const turningOff = nozzle?.isActive;
      let newClosing = nozzle?.lastClosingMeter;
      // On reactivate, set lastClosingMeter based on choice: 0, L (keep), or custom.
      // Validation: only "L" or valid non-negative number accepted.
      if (!turningOff && opts?.reactivateChoice !== undefined) {
        const c = opts.reactivateChoice.trim().toUpperCase();
        if (c === "L") {
          // Keep last - do nothing
        } else {
          const num = Number(opts.reactivateChoice.trim());
          if (opts.reactivateChoice.trim() === "" || !Number.isFinite(num) || num < 0) {
            throw new Error("Enter L or a valid non-negative number.");
          }
          newClosing = num;
        }
      }
      return {
        nozzles: s.nozzles.map((n) =>
          n.id === id
            ? {
                ...n,
                isActive: !n.isActive,
                ...(turningOff ? { deactivateReason: opts?.reason || "" } : { deactivateReason: undefined }),
                ...(newClosing !== undefined ? { lastClosingMeter: newClosing } : {}),
              }
            : n
        ),
      };
    });

  const handleDeleteNozzle = (id: string) =>
    commit((s) => ({
      nozzles: s.nozzles.filter((n) => n.id !== id),
      station: {
        ...s.station,
        shiftAssignments: (s.station.shiftAssignments || []).filter((a) => a.nozzleId !== id),
      },
    }));

  const handleDeletePump = (id: string) =>
    commit((s) => {
      if (s.nozzles.some((n) => n.pumpId === id)) {
        throw new Error('Remove this pump\'s nozzles first.');
      }
      return { pumps: s.pumps.filter((p) => p.id !== id) };
    });

  // Used when the business date was moved/rolled over and another day already exists for it.
  // An OPEN day can be continued directly; a CLOSED day must be unlocked from History (reason + PIN).
  // After midnight the previous day is finished: start the Daily screen fresh for the new date.
  // If a day for the new date already exists in the database, continue that one instead of making a duplicate.
  const handleStartNewDay = () => {
    const today = getPakistanLocalDate();
    const existing = committedRef.current.operations.find((op) => op.businessDate === today) || null;
    setActiveOperationToEdit(null);
    setResumeOperation(existing);
    setDailyScreenKey((key) => key + 1);
  };

  if (!databaseReady) {
    return (
      <div className="flex min-h-[320px] items-center justify-center bg-[#F7F9FC] p-6">
        <div className="w-full max-w-md rounded-2xl border-2 border-slate-200 bg-white p-6 text-center shadow-sm">
          <p className="text-base font-bold text-slate-800">
            {databaseError ? 'Database connection problem' : 'Loading local database...'}
          </p>
          <p className="mt-2 text-sm text-slate-500">
            {databaseError || 'Opening business.sqlite'}
          </p>
          {databaseError && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <AppErrorBoundary>
      <div className="fuel-workspace flex min-h-screen bg-[#F7F9FC] text-slate-900 font-sans antialiased">
        <Navigation
          currentTab={tabToScreenTab(activeTab)}
          onSelectTab={(screen) => selectTab(screenTabToTab(screen))}
          stationName={station.stationName}
          managerName={station.managerName}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          {/* ============ COMMON HEADER ============ */}
          <header className="sticky top-0 z-20 border-b-2 border-slate-200 bg-white/95 backdrop-blur-sm print:hidden">
            <div className="mx-auto flex min-h-[72px] max-w-[1280px] items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
              {/* Left: spacer (keeps header layout balanced) */}
              <div className="min-w-0 flex-1" />

              {/* Right: Date + Business Day + Profile */}
              <div className="flex flex-wrap items-center gap-3">
                {/* Date */}
                <div className="hidden items-center gap-2 rounded-xl border-2 border-slate-200 bg-white px-4 py-2.5 sm:flex">
                  <CalendarDays className="h-5 w-5 text-slate-500" />
                  <span className="text-base font-bold text-slate-700">
                    {new Date(`${todayIso}T00:00:00+05:00`).toLocaleDateString(
                      'en-PK',
                      {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      },
                    )}
                  </span>
                </div>

                {/* Business Day Badge */}
                <span className="hidden rounded-xl bg-emerald-50 px-4 py-2.5 text-base font-bold text-emerald-700 border-2 border-emerald-100 sm:inline-block">
                  Business Day
                </span>

                {/* Profile */}
                <div className="flex items-center gap-3 rounded-xl border-2 border-slate-200 bg-white px-4 py-2">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                    <UserCog className="h-5 w-5" />
                  </span>
                  <div className="hidden text-right leading-tight sm:block">
                    <p className="text-base font-bold text-slate-800">
                      {managerFirstName}
                    </p>
                    {managerFirstName !== 'Manager' && (
                      <p className="text-sm font-medium text-slate-400">
                        Manager
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </header>

          {saveError && (
            <div role="alert" className="mx-auto mt-4 flex w-full max-w-[1280px] items-start gap-3 rounded-2xl border-2 border-red-200 bg-red-50 px-5 py-4 text-red-800 print:hidden">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-black">Data was NOT saved</p>
                <p className="text-sm font-medium">{saveError}</p>
                <p className="mt-1 text-xs font-medium">Your entries on the screen are still here. Fix the problem and try saving again.</p>
              </div>
              <button type="button" onClick={() => setSaveError('')} className="shrink-0 rounded-lg p-1 hover:bg-red-100 cursor-pointer" title="Dismiss">
                <X className="h-4 w-4" aria-hidden="true" /> Dismiss
              </button>
            </div>
          )}

          {/* ============ MAIN CONTENT ============ */}
          <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 print:p-0">
            <div className="mx-auto max-w-[1280px]">
              {activeTab === 'dashboard' && (
                <DashboardScreen
  station={station}
  pumps={pumps}
  nozzles={nozzles}
  employees={[]}
  operations={operations}
  stockRecords={fuelStock}
  standaloneExpenses={standaloneExpenses}
  todayCredit={todayCredit}
  onNavigateToOperation={() => selectTab('daily')}
  onNavigateToFuelStock={() => selectTab('fuel-stock')}
  onNavigateToHistory={() => selectTab('history')}
  onSaveCountedCash={handleSaveCountedCash}
/>
              )}

              <div className={activeTab === 'fuel-stock' ? '' : 'hidden'}>
                <FuelStockScreen
                  station={station}
                  operations={operations}
                  nozzles={nozzles}
                  stockRecords={fuelStock}
                  onUpdateStockRecords={handleUpdateFuelStock}
                  onUpdateStationConfig={handleUpdateStation}
                  onRateChange={handleRateChange}
                  canChangeRates
                />
              </div>

              <div className={activeTab === 'daily' ? '' : 'hidden'}>
                <DailyOperationScreen
                  key={dailyScreenKey}
                  station={station}
                  pumps={pumps}
                  nozzles={nozzles}
                  employees={[]}
                  customers={customers}
                  canGiveUdhaar
                  onAddUdhaar={handleAddUdhaar}
                  onGetUdhaarTotal={handleGetUdhaarTotal}
                  activeOperationToEdit={activeOperationToEdit ?? resumeOperation}
                  existingOperations={operations}
                  standaloneExpenses={standaloneExpenses}
                  onSaveOperation={handleSaveOperation}
                  onStartNewDay={handleStartNewDay}
                  onUpdateStationConfig={handleUpdateStation}
                  stockRecords={fuelStock}
                  onClearActiveEdit={() => { setActiveOperationToEdit(null); setResumeOperation(null); }}
                />
              </div>

              <div className={activeTab === 'pumps' ? '' : 'hidden'}>
                <PumpsNozzlesScreen
                  pumps={pumps}
                  nozzles={nozzles}
                  employees={[]}
                  station={station}
                  onUpdatePump={handleUpdatePump}
                  onUpdateNozzle={handleUpdateNozzle}
                  onAddPump={handleAddPump}
                  onAddNozzle={handleAddNozzle}
                  onTogglePumpActive={handleTogglePumpActive}
                  onToggleNozzleActive={handleToggleNozzleActive}
                  onDeleteNozzle={handleDeleteNozzle}
                  onDeletePump={handleDeletePump}
                  onUpdateStationConfig={handleUpdateStation}
                />
              </div>

              <div className={activeTab === 'history' ? '' : 'hidden'}>
                <HistoryScreen
                  operations={operations}
                  station={station}
                  pumps={pumps}
                  nozzles={nozzles}
                  employees={[]}
                  rateChanges={rateChanges}
                  standaloneExpenses={standaloneExpenses}
                  onUnlockOperationForEdit={async (operation) => {
                    // Serialize with pending saves before reloading the confirmed state.
                    const run = async () => {
                      try {
                        if (operation.status === 'CLOSED') {
                          await databaseRequest({ type: 'reopen', business: 'FUEL', day: operation.businessDate, reason: operation.lastEditReason });
                        }
                        const data = await databaseRequest({ type: 'petrolStateLoad' }) as PetrolSqliteState;
                        const reopened = data.operations.find((op) => op.id === operation.id);
                        if (!reopened || reopened.status !== 'OPEN') throw new Error('This day could not be opened. Reload History and try again.');
                        committedRef.current = data;
                        applyState(data);
                        setSaveError('');
                        setResumeOperation(null);
                        setActiveOperationToEdit(reopened);
                        setDailyScreenKey((key) => key + 1);
                        selectTab('daily');
                      } catch (error: any) {
                        setSaveError(error?.message || 'Could not reopen this day.');
                      }
                    };
                    const pending = saveQueueRef.current.then(run, run);
                    saveQueueRef.current = pending;
                    await pending;
                  }}
                  onUpdateOperation={handleUpdateOperation}
                  onUpdateStationConfig={handleUpdateStation}
                  onNavigateBack={() => selectTab('dashboard')}
                />
              </div>

              <div className={activeTab === 'customers' ? '' : 'hidden'}>
                <CustomersPage onCustomersChanged={() => void loadCustomers()} refreshSignal={customersRefreshSignal} />
              </div>

              <div className={activeTab === 'expenses' ? '' : 'hidden'}>
                <ExpensesPage />
              </div>
            </div>
          </main>
        </div>
      </div>
    </AppErrorBoundary>
  );
}

