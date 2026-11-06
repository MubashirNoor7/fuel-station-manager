import { useRef, useState, useMemo, type FormEvent } from 'react';
import { PageHeader } from './ui';
import '../styles/fuel-management.css';
import { Pump, Nozzle, FuelType, StationConfig, StationConfigUpdate, Employee } from '../types';
import { saveErrorText, type SaveResult } from '../logic/saveResult';
import {
  Gauge,
  Plus,
  AlertCircle,
  Lock,
  Trash2,
  Fuel,
  Power,
  Search,
  Wrench,
  Droplet,
  Flame,
  Info,
  Settings2,
} from 'lucide-react';

type ConfirmedAction =
  | { type: 'EDIT_PUMP'; payload: Pump }
  | { type: 'EDIT_NOZZLE'; payload: Nozzle }
  | { type: 'ADD_PUMP'; payload: Pump }
  | { type: 'ADD_NOZZLE'; payload: Nozzle }
  | { type: 'TOGGLE_PUMP'; id: string }
  | { type: 'TOGGLE_NOZZLE'; id: string; reason?: string; reactivateChoice?: string }
  | { type: 'DELETE_NOZZLE'; id: string }
  | { type: 'DELETE_PUMP'; id: string };

interface PumpsNozzlesScreenProps {
  pumps: Pump[];
  nozzles: Nozzle[];
  employees: Employee[];
  station: StationConfig;
  onUpdatePump: (pump: Pump) => Promise<SaveResult>;
  onUpdateNozzle: (nozzle: Nozzle) => Promise<SaveResult>;
  onAddPump: (pump: Pump) => Promise<SaveResult>;
  onAddNozzle: (nozzle: Nozzle) => Promise<SaveResult>;
  onTogglePumpActive: (id: string) => Promise<SaveResult>;
  onToggleNozzleActive?: (id: string, opts?: { reason?: string; reactivateChoice?: string }) => Promise<SaveResult>;
  onDeleteNozzle?: (id: string) => Promise<SaveResult>;
  onDeletePump?: (id: string) => Promise<SaveResult>;
  onUpdateStationConfig?: (update: StationConfigUpdate) => Promise<SaveResult>;
}

export function PumpsNozzlesScreen({
  pumps,
  nozzles,
  station,
  onUpdatePump,
  onUpdateNozzle,
  onAddPump,
  onAddNozzle,
  onTogglePumpActive,
  onToggleNozzleActive,
  onDeleteNozzle,
  onDeletePump,
  onUpdateStationConfig,
}: PumpsNozzlesScreenProps) {
  const displayName = (name: string) => name.replace(/\s*\(.*?\)\s*/g, '').trim();
  const [editEquipment, setEditEquipment] = useState<{ kind: 'pump' | 'nozzle'; item: Pump | Nozzle } | null>(null);
  const [editName, setEditName] = useState('');
  const [editPumpId, setEditPumpId] = useState('');
  const [editError, setEditError] = useState('');
  // v79: Close parent Manage modal before opening Edit (z-index fix - developer audit)
  const startEdit = (kind: 'pump' | 'nozzle', item: Pump | Nozzle) => {
    setShowManageEquipmentModal(false);
    setEditEquipment({ kind, item }); setEditName(item.name);
    setEditPumpId(kind === 'nozzle' ? (item as Nozzle).pumpId : ''); setEditError('');
  };
  const submitEdit = (event: FormEvent) => {
    event.preventDefault();
    if (!editEquipment || !editName.trim()) { setEditError('Enter a name.'); return; }
    const items = editEquipment.kind === 'pump' ? pumps : nozzles;
    if (items.some((item) => item.id !== editEquipment.item.id && item.name.trim().toLowerCase() === editName.trim().toLowerCase())) {
      setEditError('This name is already used.'); return;
    }
    if (editEquipment.kind === 'pump') void runAction({ type: 'EDIT_PUMP', payload: { ...editEquipment.item, name: editName.trim() } as Pump });
    else {
      const target = pumps.find((p) => p.id === editPumpId);
      if (!target || getPumpFuelType(target) !== (editEquipment.item as Nozzle).fuelType) { setEditError('Select a pump with the same fuel type.'); return; }
      void runAction({ type: 'EDIT_NOZZLE', payload: { ...editEquipment.item, name: editName.trim(), pumpId: editPumpId } as Nozzle });
    }
  };
  // ========== STATE ==========
  const [activeFuelFilter, setActiveFuelFilter] = useState<'ALL' | 'PETROL' | 'CNG'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddPumpModal, setShowAddPumpModal] = useState(false);
  const [showAddNozzleModal, setShowAddNozzleModal] = useState(false);
  const [showManageEquipmentModal, setShowManageEquipmentModal] = useState(false);


  // Add Pump state
  const [pumpName, setPumpName] = useState('');
  const [pumpNotes, setPumpNotes] = useState('');
  const [pumpFuelType, setPumpFuelType] = useState<FuelType>('PETROL');
  const [pumpError, setPumpError] = useState<string | null>(null);

  // Add Nozzle state
  const [nozzlePumpId, setNozzlePumpId] = useState(pumps[0]?.id || '');
  const [nozzleName, setNozzleName] = useState('');
  const [fuelType, setFuelType] = useState<FuelType>('PETROL');
  const [initialMeterStr, setInitialMeterStr] = useState('');
  const [nozzleError, setNozzleError] = useState<string | null>(null);


  // Nozzle off/on modal state (replaces window.prompt which Electron does not support)
  const [nozzleOffModal, setNozzleOffModal] = useState<{ id: string; name: string } | null>(null);
  const [nozzleOffReason, setNozzleOffReason] = useState('');
  const [nozzleOffError, setNozzleOffError] = useState<string | null>(null);
  const [nozzleOnModal, setNozzleOnModal] = useState<{ id: string; name: string } | null>(null);
  const [nozzleOnChoice, setNozzleOnChoice] = useState('L');
  const [nozzleOnError, setNozzleOnError] = useState<string | null>(null);

  const activeShifts = [...(station.shifts || [])]
    .filter((s) => s.isActive)
    .sort((a, b) => a.order - b.order);

  // ========== FILTERING ==========
  // v76: Filter by fuel type (All/Petrol/CNG) instead of confusing pump tabs
  // v79: Enforce fuel eligibility BEFORE search (developer audit fix)
  const filteredPumps = useMemo(() => {
    return [...pumps].sort((a, b) => displayName(a.name).localeCompare(displayName(b.name), undefined, { numeric: true })).filter((pump) => {
      const pumpNozzles = nozzles.filter((n) => n.pumpId === pump.id);
      // v79: Fuel eligibility check first - new pumps without nozzles use pump's own fuelType
      const fuelMatches =
        activeFuelFilter === 'ALL' ||
        pumpNozzles.some((n) => n.fuelType === activeFuelFilter) ||
        (pumpNozzles.length === 0 && (pump as any).fuelType === activeFuelFilter);
      if (!fuelMatches) return false;

      if (!searchQuery.trim()) return true;

      const query = searchQuery.toLowerCase();
      const pumpMatch = pump.name.toLowerCase().includes(query);
      const nozzleMatch = pumpNozzles.some(
        (n) =>
          n.name.toLowerCase().includes(query) ||
          n.fuelType.toLowerCase().includes(query),
      );
      return pumpMatch || nozzleMatch;
    });
  }, [pumps, nozzles, activeFuelFilter, searchQuery]);

  // ========== COUNTS ==========
  const totalPumps = pumps.length;
  const totalNozzles = nozzles.length;
  const petrolNozzles = nozzles.filter((n) => n.fuelType === 'PETROL').length;
  const cngNozzles = nozzles.filter((n) => n.fuelType === 'CNG').length;

  // ========== HELPERS ==========

  // Get pump's fuel type. Priority:
  // 1. pump.fuelType (if exists in type)
  // 2. First nozzle's fuel type
  // 3. Default to PETROL
  const getPumpFuelType = (pump: Pump): FuelType => {
    const pumpAny = pump as any;
    if (pumpAny.fuelType === 'PETROL' || pumpAny.fuelType === 'CNG') {
      return pumpAny.fuelType;
    }
    const pumpNozzles = nozzles.filter((n) => n.pumpId === pump.id);
    if (pumpNozzles[0]?.fuelType) return pumpNozzles[0].fuelType;
    return 'PETROL';
  };

  const getPumpStatus = (pump: Pump) => {
    const pumpNozzles = nozzles.filter((n) => n.pumpId === pump.id);
    if (!pump.isActive) return 'MAINTENANCE';
    if (pumpNozzles.length === 0) return 'MAINTENANCE';
    if (pumpNozzles.some((n) => !n.isActive)) return 'MAINTENANCE';
    return 'ONLINE';
  };

  const getFuelIcon = (fuelType: FuelType) => {
    return fuelType === 'PETROL' ? Droplet : Flame;
  };

  // Pump icon color scheme by fuel type
  const getPumpIconStyle = (fuelType: FuelType) => {
    if (fuelType === 'PETROL') {
      return {
        bg: 'bg-emerald-50',
        text: 'text-emerald-700',
      };
    }
    return {
      bg: 'bg-violet-50',
      text: 'text-violet-700',
    };
  };

  // ========== FORM HANDLERS ==========
  const handleCreatePump = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!pumpName.trim()) {
      setPumpError('Pump name is required.');
      return;
    }

void runAction({
  type: 'ADD_PUMP',
  payload: {
    id: `pump-${Date.now()}`,
    name: pumpName.trim(),
    isActive: true,
    notes: pumpNotes.trim() || undefined,
    fuelType: pumpFuelType,
  },
});
  };

  const handleCreateNozzle = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!nozzlePumpId) {
      setNozzleError('Select a pump.');
      return;
    }
    if (!nozzleName.trim()) {
      setNozzleError('Enter a nozzle name.');
      return;
    }
    // Duplicate name check (manager feedback): same name already exists.
    if (nozzles.some((n) => n.name.trim().toLowerCase() === nozzleName.trim().toLowerCase())) {
      setNozzleError(`"${nozzleName.trim()}" already exists. Use another name.`);
      return;
    }
    const meterNum = Number(initialMeterStr);
    if (initialMeterStr.trim() === '' || isNaN(meterNum) || meterNum < 0) {
      setNozzleError('Enter a valid starting meter (0 or higher).');
      return;
    }
    void runAction({
      type: 'ADD_NOZZLE',
      payload: {
        id: `nozzle-${Date.now()}`,
        pumpId: nozzlePumpId,
        name: nozzleName.trim(),
        fuelType,
        isActive: true,
        lastClosingMeter: meterNum,
      },
    });
  };

  const handleTogglePumpRequest = (id: string) =>
    void runAction({ type: 'TOGGLE_PUMP', id });
  const handleToggleNozzleRequest = (id: string) => {
    const nozzle = nozzles.find((n) => n.id === id);
    // When deactivating, ask for reason via modal (window.prompt not supported in Electron).
    if (nozzle?.isActive) {
      setNozzleOffReason('');
      setNozzleOffError(null);
      setNozzleOffModal({ id, name: nozzle.name });
    } else {
      // Reactivating: ask for starting point via modal.
      setNozzleOnChoice('L');
      setNozzleOnError(null);
      setNozzleOnModal({ id, name: nozzle?.name || '' });
    }
  };

  const handleNozzleOffConfirm = () => {
    if (!nozzleOffModal) return;
    if (!nozzleOffReason.trim()) {
      setNozzleOffError("Please enter a reason.");
      return;
    }
    setNozzleOffModal(null);
    void runAction({ type: 'TOGGLE_NOZZLE', id: nozzleOffModal.id, reason: nozzleOffReason.trim() });
  };

  const handleNozzleOnConfirm = () => {
    if (!nozzleOnModal) return;
    const choice = nozzleOnChoice.trim();
    const c = choice.toUpperCase();
    // Strict: only "L" or a valid non-negative number. Blank is not accepted.
    if (c !== "L") {
      const num = Number(choice);
      if (choice === "" || !Number.isFinite(num) || num < 0) {
        setNozzleOnError("Enter L or a valid non-negative number.");
        return;
      }
    }
    setNozzleOnModal(null);
    void runAction({ type: 'TOGGLE_NOZZLE', id: nozzleOnModal.id, reactivateChoice: choice });
  };
  const handleDeleteNozzleRequest = (id: string) =>
    void runAction({ type: 'DELETE_NOZZLE', id });
  const handleDeletePumpRequest = (id: string) =>
    void runAction({ type: 'DELETE_PUMP', id });

  // ========== SHIFT MANAGEMENT (Owner) ==========
  // Blocks a second click/Enter while a save is still running (prevents double toggles / duplicates).
  const savingRef = useRef(false);

  const runAction = async (action: ConfirmedAction) => {
    if (savingRef.current) return;
    savingRef.current = true;

    try {
      if (action.type === 'EDIT_PUMP' || action.type === 'EDIT_NOZZLE') {
        const result = action.type === 'EDIT_PUMP' ? await onUpdatePump(action.payload) : await onUpdateNozzle(action.payload);
        if (!result.ok) { setEditError(saveErrorText(result)); return; }
        setEditEquipment(null);
      } else if (action.type === 'ADD_PUMP') {
        const result = await onAddPump(action.payload);
        if (!result.ok) {
          // Keep the form and everything typed in it so the user can retry.
          setPumpError(`Pump was not saved: ${saveErrorText(result)}`);
          return;
        }
        setPumpName('');
        setPumpNotes('');
        setPumpFuelType('PETROL');
        setPumpError(null);
        setShowAddPumpModal(false);
        if (!nozzlePumpId) setNozzlePumpId(action.payload.id);
      } else if (action.type === 'ADD_NOZZLE') {
        const result = await onAddNozzle(action.payload);
        if (!result.ok) {
          setNozzleError(`Nozzle was not saved: ${saveErrorText(result)}`);
          return;
        }
        setNozzleName('');
        setInitialMeterStr('');
        setNozzleError(null);
        setShowAddNozzleModal(false);
      } else if (action.type === 'TOGGLE_PUMP') {
        await onTogglePumpActive(action.id);
      } else if (action.type === 'TOGGLE_NOZZLE') {
        await onToggleNozzleActive?.(action.id, {
          reason: action.reason,
          reactivateChoice: action.reactivateChoice,
        });
      } else if (action.type === 'DELETE_NOZZLE') {
        await onDeleteNozzle?.(action.id);
      } else if (action.type === 'DELETE_PUMP') {
        await onDeletePump?.(action.id);
      }
    } finally {
      savingRef.current = false;
      void runAction(null);
    }
  };

  // ========== RENDER ==========
  return (
    <div
      className="fuel-management fuel-equipment-screen space-y-6"
      style={{ fontFamily: 'var(--ui-font)' }}
    >
      {/* ============ PAGE HEADER ============ */}
      <div className="fuel-management-header">
        <div>
          <PageHeader title="Pumps & Nozzles" description="Add pumps and check which nozzles are in use." />
        </div>

        {/* v77: Professional button grouping - Add actions (primary) | Manage actions (secondary) */}
        <div className="fuel-management-actions">
          <button
            type="button"
            onClick={() => setShowAddPumpModal(true)}
            className="fuel-action fuel-action--primary"
          >
            <Plus className="h-5 w-5" />
            Add Pump
          </button>
          <button
            type="button"
            onClick={() => setShowAddNozzleModal(true)}
            className="fuel-action"
          >
            <Plus className="h-5 w-5" />
            Add Nozzle
          </button>
          {/* v75: Edit is now inside Manage Equipment modal (hierarchical) - no scattered edit buttons */}
        </div>
      </div>
      <div className="fuel-equipment-tools" role="group" aria-label="Equipment management">
        <span>Manage</span>
        <div className="fuel-management-actions">
          <button
            type="button"
            onClick={() => setShowManageEquipmentModal(true)}
            className="fuel-action"
          >
            <Settings2 className="h-4 w-4" />
            Equipment
          </button>
        </div>
      </div>

      {/* ============ 4 SUMMARY CARDS ============ */}
      <div className="fuel-management-metrics fuel-equipment-metrics">
        <div className="rounded-2xl border-2 border-emerald-100 bg-emerald-50/60 p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-emerald-200 text-emerald-800">
              <Gauge className="w-7 h-7" />
            </span>
            <div>
              <p className="text-base font-bold text-slate-700">Total Pumps</p>
              <p className="mt-2 text-4xl font-black text-slate-900">
                {totalPumps}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border-2 border-blue-100 bg-blue-50/60 p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-blue-200 text-blue-800">
              <Wrench className="w-7 h-7" />
            </span>
            <div>
              <p className="text-base font-bold text-slate-700">
                Total Nozzles
              </p>
              <p className="mt-2 text-4xl font-black text-slate-900">
                {totalNozzles}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border-2 border-amber-100 bg-amber-50/60 p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-amber-200 text-amber-800">
              <Droplet className="w-7 h-7" />
            </span>
            <div>
              <p className="text-base font-bold text-slate-700">
                Petrol Nozzles
              </p>
              <p className="mt-2 text-4xl font-black text-slate-900">
                {petrolNozzles}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border-2 border-violet-100 bg-violet-50/60 p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-violet-200 text-violet-800">
              <Flame className="w-7 h-7" />
            </span>
            <div>
              <p className="text-base font-bold text-slate-700">CNG Nozzles</p>
              <p className="mt-2 text-4xl font-black text-slate-900">
                {cngNozzles}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ============ FILTER TABS + SEARCH ============ */}
      {/* v76: Fuel type filter (All/Petrol/CNG) - clearer than pump names */}
      <div className="fuel-equipment-filters">
        <div className="fuel-management-tabs" role="group" aria-label="Filter equipment by fuel">
          <button
            type="button"
            onClick={() => setActiveFuelFilter('ALL')}
            aria-pressed={activeFuelFilter === 'ALL'}
            className="fuel-filter-tab"
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setActiveFuelFilter('PETROL')}
            data-fuel="PETROL"
            aria-pressed={activeFuelFilter === 'PETROL'}
            className="fuel-filter-tab"
          >
            <Droplet className="h-4 w-4" />
            Petrol
          </button>
          <button
            type="button"
            onClick={() => setActiveFuelFilter('CNG')}
            data-fuel="CNG"
            aria-pressed={activeFuelFilter === 'CNG'}
            className="fuel-filter-tab"
          >
            <Flame className="h-4 w-4" />
            CNG
          </button>
        </div>

        <div className="fuel-equipment-search">
          <Search className="h-5 w-5 text-slate-400" />
          <input
            value={searchQuery}
            aria-label="Search pump or nozzle"
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search pump or nozzle..."
            className="w-full bg-transparent text-base text-slate-800 outline-none placeholder:text-slate-400"
          />
        </div>
      </div>

      {/* ============ PUMP CARDS ============ */}
      {filteredPumps.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 p-12 text-center">
          <Gauge className="mx-auto mb-3 h-12 w-12 text-slate-300" />
          <p className="text-lg font-bold text-slate-600">
            {searchQuery.trim()
              ? 'No pumps or nozzles found matching your search.'
              : 'No pumps configured.'}
          </p>
        </div>
      ) : (
        <div className="fuel-pump-list">
          {filteredPumps.map((pump) => {
            // v76: Filter nozzles by selected fuel type for clarity
            const pumpNozzles = nozzles.filter((n) => 
              n.pumpId === pump.id && (activeFuelFilter === 'ALL' || n.fuelType === activeFuelFilter)
            );
            const status = getPumpStatus(pump);
            const pumpFuelType = getPumpFuelType(pump);
            const FuelIcon = getFuelIcon(pumpFuelType);
            const iconStyle = getPumpIconStyle(pumpFuelType);
            const fuelLabel = pumpFuelType === 'PETROL' ? 'Petrol' : 'CNG';

            return (
              <div
                key={pump.id}
                className="fuel-pump-card"
                data-fuel={pumpFuelType}
              >
                {/* Pump Header */}
                <div className="fuel-pump-heading">
                  <div className="flex items-center gap-4 min-w-0">
                    <div
                      className={`flex h-14 w-14 items-center justify-center rounded-full shrink-0 ${iconStyle.bg} ${iconStyle.text}`}
                    >
                      <FuelIcon className="h-7 w-7" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-2xl font-black text-slate-900 truncate">
                        {displayName(pump.name)}
                      </h3>
                      {/* v75: Edit moved to Manage Equipment modal */}
                    </div>
                  </div>
                  <span
                    className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-lg font-bold shrink-0 ${
                      status === 'ONLINE'
                        ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                        : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
                    }`}
                  >
                    <span
                      className={`h-3 w-3 rounded-full ${
                        status === 'ONLINE' ? 'bg-emerald-500' : 'bg-amber-500'
                      }`}
                    />
                    {status === 'ONLINE' ? 'Online' : 'Maintenance'}
                  </span>
                </div>

                {/* Pump Info Row */}
                <div className="fuel-pump-details">
                  <div>
                    <p className="text-base font-bold text-slate-500">
                      Fuel Type
                    </p>
                    <p className="mt-1 text-2xl font-black text-slate-900">
                      {fuelLabel}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-base font-bold text-slate-500">
                      Total Nozzles
                    </p>
                    <p className="mt-1 text-2xl font-black text-slate-900">
                      {pumpNozzles.length}
                    </p>
                  </div>
                </div>

                {/* Nozzles Table */}
                {pumpNozzles.length === 0 ? (
                  <div className="px-7 py-10 text-center">
                    <p className="text-lg font-bold text-slate-500">
                      No nozzles added yet.
                    </p>
                  </div>
                ) : (
                  <table className="w-full text-left">
                    <thead className="bg-slate-50">
                      <tr className="border-b-2 border-slate-100">
                        <th className="px-7 py-4 text-sm font-black text-slate-600 uppercase tracking-wide">
                          Nozzle
                        </th>
                        <th className="px-5 py-4 text-center text-sm font-black text-slate-600 uppercase tracking-wide">
                          Status
                        </th>
                        <th className="px-7 py-4 text-right text-sm font-black text-slate-600 uppercase tracking-wide">
                          Last Reading
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {pumpNozzles.map((nozzle) => {
                        const NozzleIcon = getFuelIcon(nozzle.fuelType);
                        const nozzleIconStyle = getPumpIconStyle(
                          nozzle.fuelType,
                        );
                        return (
                          <tr
                            key={nozzle.id}
                            className="hover:bg-slate-50/70"
                          >
                            <td className="px-7 py-5">
                              <div className="flex items-center gap-3">
                                <div
                                  className={`flex h-10 w-10 items-center justify-center rounded-full shrink-0 ${nozzleIconStyle.bg} ${nozzleIconStyle.text}`}
                                >
                                  <NozzleIcon className="h-5 w-5" />
                                </div>
                                <span className="text-lg font-bold text-slate-800">
                                  {displayName(nozzle.name)}
                                </span>
                                {/* v75: Edit moved to Manage Equipment modal */}
                              </div>
                            </td>
                            <td className="px-5 py-5 text-center">
                              {nozzle.isActive ? (
                                <span className="inline-flex items-center gap-2 text-base font-bold text-emerald-700">
                                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                                  Online
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-2 text-base font-bold text-amber-700">
                                  <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                                  Maintenance
                                </span>
                              )}
                            </td>
                            <td className="px-7 py-5 text-right">
                              <span className="text-lg font-mono font-bold text-slate-800">
                                {nozzle.lastClosingMeter.toLocaleString()}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ============ BOTTOM INFO BANNER ============ */}
      <div className="flex items-start gap-4 rounded-2xl border-2 border-emerald-100 bg-emerald-50/40 px-6 py-5">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 shrink-0">
          <Info className="w-6 h-6" />
        </div>
        <p className="text-base font-semibold text-slate-700">
          <span className="font-black">Note:</span> All meter readings are
          updated by staff during daily operations. Make sure to verify the
          readings before closing the day.
        </p>
      </div>

      {/* ============ MANAGE EQUIPMENT MODAL ============ */}
      {showManageEquipmentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl border-2 border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-4 border-b-2 border-slate-100 px-7 py-6">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                  <Settings2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-2xl font-black text-slate-900">
                    Manage Equipment
                  </h3>
                  <p className="mt-1 text-base font-medium text-slate-500">
                    Activate, deactivate or delete pumps and nozzles
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowManageEquipmentModal(false)}
                className="text-slate-400 hover:text-slate-900 text-3xl font-bold"
              >
                ×
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-7 space-y-6">
              {pumps.length === 0 ? (
                <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 p-12 text-center">
                  <Gauge className="mx-auto mb-3 h-12 w-12 text-slate-300" />
                  <p className="text-lg font-bold text-slate-600">
                    No pumps configured.
                  </p>
                </div>
              ) : (
                pumps.map((pump) => {
                  const pumpNozzles = nozzles.filter(
                    (n) => n.pumpId === pump.id,
                  );
                  const pumpFuelType = getPumpFuelType(pump);
                  const PumpIcon = getFuelIcon(pumpFuelType);
                  const pumpIconStyle = getPumpIconStyle(pumpFuelType);

                  return (
                    <div
                      key={pump.id}
                      className="overflow-hidden rounded-2xl border-2 border-slate-200"
                    >
                      <div className="flex flex-col gap-3 border-b-2 border-slate-100 bg-slate-50 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className={`flex h-12 w-12 items-center justify-center rounded-full shrink-0 border-2 border-slate-200 ${pumpIconStyle.bg} ${pumpIconStyle.text}`}
                          >
                            <PumpIcon className="h-6 w-6" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-lg font-black text-slate-900 truncate">
                              {displayName(pump.name)}
                            </p>
                            <p className="text-sm font-semibold text-slate-500 mt-0.5">
                              {pumpNozzles.length}{' '}
                              {pumpNozzles.length === 1 ? 'nozzle' : 'nozzles'}
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                          {pump.isActive ? (
                            <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-2 text-base font-bold text-emerald-700 ring-1 ring-emerald-200">
                              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-2 text-base font-bold text-slate-500 ring-1 ring-slate-200">
                              <span className="h-2.5 w-2.5 rounded-full bg-slate-400" />
                              Inactive
                            </span>
                          )}

                          {/* v75: Edit pump button in hierarchical modal */}
                          <button
                            type="button"
                            onClick={() => startEdit('pump', pump)}
                            className="inline-flex items-center gap-2 rounded-xl border-2 border-slate-300 bg-white px-5 py-3 text-base font-bold text-slate-700 transition hover:bg-slate-50"
                          >
                            Edit
                          </button>

                          <button
                            type="button"
                            onClick={() => handleTogglePumpRequest(pump.id)}
                            className={`inline-flex items-center gap-2 rounded-xl px-5 py-3 text-base font-bold transition ${
                              pump.isActive
                                ? 'border-2 border-amber-200 bg-white text-amber-700 hover:bg-amber-50'
                                : 'bg-emerald-600 text-white hover:bg-emerald-700'
                            }`}
                          >
                            <Power className="h-5 w-5" />
                            {pump.isActive ? 'Deactivate' : 'Activate'}
                          </button>

                          {!pump.isActive &&
                            pumpNozzles.length === 0 &&
                            onDeletePump && (
                              <button
                                type="button"
                                onClick={() =>
                                  handleDeletePumpRequest(pump.id)
                                }
                                className="inline-flex items-center gap-2 rounded-xl border-2 border-rose-200 bg-white px-5 py-3 text-base font-bold text-rose-700 transition hover:bg-rose-50"
                              >
                                <Trash2 className="h-5 w-5" />
                                Delete
                              </button>
                            )}
                        </div>
                      </div>

                      {pumpNozzles.length === 0 ? (
                        <div className="px-6 py-6 text-center">
                          <p className="text-base font-semibold text-slate-500">
                            No nozzles in this pump.
                          </p>
                        </div>
                      ) : (
                        <div className="divide-y-2 divide-slate-100">
                          {/* v75: Group nozzles by fuel type (Petrol/CNG) - professional hierarchical view */}
                          {(['PETROL', 'CNG'] as const).map((fuelType) => {
                            const fuelNozzles = pumpNozzles.filter((n) => n.fuelType === fuelType);
                            if (fuelNozzles.length === 0) return null;
                            return (
                              <div key={fuelType}>
                                <div className="px-6 pt-4 pb-2">
                                  <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold ${
                                    fuelType === 'PETROL' 
                                      ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' 
                                      : 'bg-purple-50 text-purple-700 ring-1 ring-purple-200'
                                  }`}>
                                    {fuelType} ({fuelNozzles.length})
                                  </span>
                                </div>
                                {fuelNozzles.map((nozzle) => {
                                  const NozzleIcon = getFuelIcon(nozzle.fuelType);
                                  const nozzleIconStyle = getPumpIconStyle(nozzle.fuelType);
                                  return (
                                    <div
                                      key={nozzle.id}
                                      className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"
                                    >
                                      <div className="flex items-center gap-3 min-w-0">
                                        <div
                                          className={`flex h-10 w-10 items-center justify-center rounded-full shrink-0 ${nozzleIconStyle.bg} ${nozzleIconStyle.text}`}
                                        >
                                          <NozzleIcon className="h-5 w-5" />
                                        </div>
                                        <div className="min-w-0">
                                          <p className="text-base font-bold text-slate-900 truncate">
                                            {displayName(nozzle.name)}
                                          </p>
                                          <div className="flex items-center gap-2 mt-1">
                                            <span className="text-xs font-semibold text-slate-500">
                                              Last:{' '}
                                              {nozzle.lastClosingMeter.toLocaleString()}
                                            </span>
                                          </div>
                                        </div>
                                      </div>

                                      <div className="flex flex-wrap items-center gap-3">
                                        {/* v75: Edit button in hierarchical modal (professional) */}
                                        <button
                                          type="button"
                                          onClick={() => startEdit('nozzle', nozzle)}
                                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-bold text-slate-700 hover:bg-slate-50 transition"
                                        >
                                          Edit
                                        </button>
                                        {nozzle.isActive ? (
                                          <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-bold text-emerald-700 ring-1 ring-emerald-200">
                                            <span className="h-2 w-2 rounded-full bg-emerald-500" />
                                            Active
                                          </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-sm font-bold text-slate-500 ring-1 ring-slate-200">
                                      <span className="h-2 w-2 rounded-full bg-slate-400" />
                                      Inactive
                                    </span>
                                  )}

                                  {onToggleNozzleActive && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleToggleNozzleRequest(nozzle.id)
                                      }
                                      className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition ${
                                        nozzle.isActive
                                          ? 'border-2 border-amber-200 bg-white text-amber-700 hover:bg-amber-50'
                                          : 'bg-emerald-600 text-white hover:bg-emerald-700'
                                      }`}
                                    >
                                      <Power className="h-4 w-4" />
                                      {nozzle.isActive
                                        ? 'Deactivate'
                                        : 'Activate'}
                                    </button>
                                  )}

                                  {!nozzle.isActive && onDeleteNozzle && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleDeleteNozzleRequest(nozzle.id)
                                      }
                                      className="inline-flex items-center gap-2 rounded-xl border-2 border-rose-200 bg-white px-4 py-2.5 text-sm font-bold text-rose-700 transition hover:bg-rose-50"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                      Delete
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex items-center justify-between gap-4 border-t-2 border-slate-100 px-7 py-5">
              <div className="flex items-center gap-3 text-base font-semibold text-slate-600">
                <Info className="h-5 w-5 text-emerald-600" />
                Changes save as soon as you confirm them
              </div>
              <button
                type="button"
                onClick={() => setShowManageEquipmentModal(false)}
                className="rounded-xl bg-emerald-600 px-7 py-3 text-base font-bold text-white hover:bg-emerald-700 transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ ADD PUMP MODAL (WITH FUEL TYPE) ============ */}
      {showAddPumpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-lg rounded-2xl border-2 border-slate-200 bg-white p-7 shadow-2xl">
            <div className="flex items-start justify-between gap-4 mb-6">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                  <Gauge className="h-7 w-7" />
                </div>
                <div>
                  <h3 className="text-2xl font-black text-slate-900">
                    Add Pump
                  </h3>
                  <p className="mt-1 text-base font-medium text-slate-500">
                    Add a pump to the station.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowAddPumpModal(false);
                  setPumpError(null);
                }}
                className="text-slate-400 hover:text-slate-900 text-3xl font-bold"
              >
                ×
              </button>
            </div>

            {pumpError && (
              <div className="mb-5 flex items-center gap-3 rounded-xl border-2 border-rose-200 bg-rose-50 p-4 text-base font-bold text-rose-800">
                <AlertCircle className="h-5 w-5 shrink-0" />
                <span>{pumpError}</span>
              </div>
            )}

            <form onSubmit={handleCreatePump} className="space-y-5">
              <div>
                <label className="mb-2 block text-base font-bold text-slate-700">
                  Pump Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="Pump 3"
                  value={pumpName}
                  onChange={(e) => setPumpName(e.target.value)}
                  className="w-full h-14 rounded-xl border-2 border-slate-200 bg-slate-50 px-5 text-lg font-medium text-slate-900 placeholder-slate-400 transition focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-100"
                />
              </div>

              {/* NEW: FUEL TYPE SELECTOR */}
              <div>
                <label className="mb-2 block text-base font-bold text-slate-700">
                  Fuel Type <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {/* Petrol Option */}
                  <button
                    type="button"
                    onClick={() => setPumpFuelType('PETROL')}
                    className={`flex items-center gap-3 rounded-xl border-2 px-5 py-4 transition ${
                      pumpFuelType === 'PETROL'
                        ? 'border-emerald-500 bg-emerald-50 ring-4 ring-emerald-100'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div
                      className={`flex h-11 w-11 items-center justify-center rounded-full shrink-0 ${
                        pumpFuelType === 'PETROL'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      <Droplet className="h-6 w-6" />
                    </div>
                    <div className="text-left">
                      <p
                        className={`text-base font-black ${
                          pumpFuelType === 'PETROL'
                            ? 'text-emerald-800'
                            : 'text-slate-700'
                        }`}
                      >
                        Petrol
                      </p>
                      <p className="text-xs font-semibold text-slate-500">
                        Petrol pump
                      </p>
                    </div>
                  </button>

                  {/* CNG Option */}
                  <button
                    type="button"
                    onClick={() => setPumpFuelType('CNG')}
                    className={`flex items-center gap-3 rounded-xl border-2 px-5 py-4 transition ${
                      pumpFuelType === 'CNG'
                        ? 'border-violet-500 bg-violet-50 ring-4 ring-violet-100'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div
                      className={`flex h-11 w-11 items-center justify-center rounded-full shrink-0 ${
                        pumpFuelType === 'CNG'
                          ? 'bg-violet-600 text-white'
                          : 'bg-violet-100 text-violet-700'
                      }`}
                    >
                      <Flame className="h-6 w-6" />
                    </div>
                    <div className="text-left">
                      <p
                        className={`text-base font-black ${
                          pumpFuelType === 'CNG'
                            ? 'text-violet-800'
                            : 'text-slate-700'
                        }`}
                      >
                        CNG
                      </p>
                      <p className="text-xs font-semibold text-slate-500">
                        CNG pump
                      </p>
                    </div>
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-base font-bold text-slate-700">
                  Notes (Optional)
                </label>
                <input
                  type="text"
                  placeholder="Main island"
                  value={pumpNotes}
                  onChange={(e) => setPumpNotes(e.target.value)}
                  className="w-full h-14 rounded-xl border-2 border-slate-200 bg-slate-50 px-5 text-lg font-medium text-slate-900 placeholder-slate-400 transition focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-100"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t-2 border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddPumpModal(false);
                    setPumpError(null);
                  }}
                  className="h-14 px-7 rounded-xl border-2 border-slate-200 bg-white text-lg font-bold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="h-14 px-7 rounded-xl bg-emerald-600 text-white text-lg font-bold hover:bg-emerald-700 inline-flex items-center gap-2"
                >
                  <Lock className="h-6 w-6" />
                  Add Pump
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============ ADD NOZZLE MODAL ============ */}
      {showAddNozzleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-2xl rounded-2xl border-2 border-slate-200 bg-white p-7 shadow-2xl">
            <div className="flex items-start justify-between gap-4 mb-6">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                  <Plus className="h-7 w-7" />
                </div>
                <div>
                  <h3 className="text-2xl font-black text-slate-900">
                    Add Nozzle
                  </h3>
                  <p className="mt-1 text-base font-medium text-slate-500">
                    Add a nozzle to a pump.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowAddNozzleModal(false);
                  setNozzleError(null);
                }}
                className="text-slate-400 hover:text-slate-900 text-3xl font-bold"
              >
                ×
              </button>
            </div>

            {nozzleError && (
              <div className="mb-5 flex items-center gap-3 rounded-xl border-2 border-rose-200 bg-rose-50 p-4 text-base font-bold text-rose-800">
                <AlertCircle className="h-5 w-5 shrink-0" />
                <span>{nozzleError}</span>
              </div>
            )}

            <form onSubmit={handleCreateNozzle} className="space-y-5">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-base font-bold text-slate-700">
                    Pump
                  </label>
                  <select
                    value={nozzlePumpId}
                    onChange={(e) => setNozzlePumpId(e.target.value)}
                    className="w-full h-14 rounded-xl border-2 border-slate-200 bg-slate-50 px-5 text-lg font-medium text-slate-900 transition focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-100 cursor-pointer"
                  >
                    {pumps
                      .filter((p) => p.isActive)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-base font-bold text-slate-700">
                    Fuel Type
                  </label>
                  <select
                    value={fuelType}
                    onChange={(e) => setFuelType(e.target.value as FuelType)}
                    className="w-full h-14 rounded-xl border-2 border-slate-200 bg-slate-50 px-5 text-lg font-medium text-slate-900 transition focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-100 cursor-pointer"
                  >
                    <option value="PETROL">Petrol</option>
                    <option value="CNG">CNG</option>
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-base font-bold text-slate-700">
                    Nozzle Name
                  </label>
                  <input
                    type="text"
                    placeholder="Nozzle 4"
                    value={nozzleName}
                    onChange={(e) => setNozzleName(e.target.value)}
                    className="w-full h-14 rounded-xl border-2 border-slate-200 bg-slate-50 px-5 text-lg font-medium text-slate-900 placeholder-slate-400 transition focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-100"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-base font-bold text-slate-700">
                    Starting Meter
                  </label>
                  <input
                    type="number"
                    step="any"
                    placeholder="10000"
                    value={initialMeterStr}
                    onChange={(e) => setInitialMeterStr(e.target.value)}
                    className="w-full h-14 rounded-xl border-2 border-slate-200 bg-slate-50 px-5 text-right text-lg font-mono font-bold text-slate-900 placeholder-slate-400 transition focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-100"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t-2 border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddNozzleModal(false);
                    setNozzleError(null);
                  }}
                  className="h-14 px-7 rounded-xl border-2 border-slate-200 bg-white text-lg font-bold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="h-14 px-7 rounded-xl bg-emerald-600 text-white text-lg font-bold hover:bg-emerald-700 inline-flex items-center gap-2"
                >
                  <Lock className="h-6 w-6" />
                  Add Nozzle
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============ NOZZLE OFF MODAL (reason) ============ */}
      {nozzleOffModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-2xl border-2 border-slate-200 bg-white p-7 shadow-2xl">
            <div className="flex items-start justify-between gap-4 mb-6">
              <div>
                <h3 className="text-2xl font-black text-slate-900">
                  Turn Off Nozzle
                </h3>
                <p className="mt-1 text-base font-medium text-slate-500">
                  {nozzleOffModal.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setNozzleOffModal(null)}
                className="text-slate-400 hover:text-slate-900 text-3xl font-bold"
              >
                ×
              </button>
            </div>

            {nozzleOffError && (
              <div className="mb-5 flex items-center gap-3 rounded-xl border-2 border-rose-200 bg-rose-50 p-4 text-base font-bold text-rose-800">
                <AlertCircle className="h-5 w-5 shrink-0" />
                <span>{nozzleOffError}</span>
              </div>
            )}

            <form onSubmit={(e) => { e.preventDefault(); handleNozzleOffConfirm(); }} className="space-y-5">
              <div>
                <label className="mb-2 block text-base font-bold text-slate-700">
                  Reason for turning off (e.g. broken, repair)
                </label>
                <input
                  type="text"
                  value={nozzleOffReason}
                  onChange={(e) => setNozzleOffReason(e.target.value)}
                  placeholder="Enter reason"
                  autoFocus
                  className="w-full h-14 rounded-xl border-2 border-slate-200 bg-slate-50 px-5 text-lg font-medium text-slate-900 transition focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-100"
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setNozzleOffModal(null)}
                  className="flex-1 h-14 rounded-xl border-2 border-slate-200 text-lg font-bold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 h-14 rounded-xl bg-rose-600 text-lg font-bold text-white hover:bg-rose-700"
                >
                  Turn Off
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============ NOZZLE ON MODAL (starting reading) ============ */}
      {nozzleOnModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-2xl border-2 border-slate-200 bg-white p-7 shadow-2xl">
            <div className="flex items-start justify-between gap-4 mb-6">
              <div>
                <h3 className="text-2xl font-black text-slate-900">
                  Turn On Nozzle
                </h3>
                <p className="mt-1 text-base font-medium text-slate-500">
                  {nozzleOnModal.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setNozzleOnModal(null)}
                className="text-slate-400 hover:text-slate-900 text-3xl font-bold"
              >
                ×
              </button>
            </div>

            {nozzleOnError && (
              <div className="mb-5 flex items-center gap-3 rounded-xl border-2 border-rose-200 bg-rose-50 p-4 text-base font-bold text-rose-800">
                <AlertCircle className="h-5 w-5 shrink-0" />
                <span>{nozzleOnError}</span>
              </div>
            )}

            <form onSubmit={(e) => { e.preventDefault(); handleNozzleOnConfirm(); }} className="space-y-5">
              <div>
                <label className="mb-2 block text-base font-bold text-slate-700">
                  Starting reading
                </label>
                <input
                  type="text"
                  value={nozzleOnChoice}
                  onChange={(e) => setNozzleOnChoice(e.target.value)}
                  placeholder="L"
                  autoFocus
                  className="w-full h-14 rounded-xl border-2 border-slate-200 bg-slate-50 px-5 text-lg font-medium text-slate-900 transition focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-emerald-100"
                />
                <p className="mt-2 text-sm font-medium text-slate-500">
                  Type 0 to start from zero, L for last reading, or a custom number.
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setNozzleOnModal(null)}
                  className="flex-1 h-14 rounded-xl border-2 border-slate-200 text-lg font-bold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 h-14 rounded-xl bg-emerald-600 text-lg font-bold text-white hover:bg-emerald-700"
                >
                  Turn On
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
