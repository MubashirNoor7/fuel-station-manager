export type FuelType = 'PETROL' | 'CNG';

export type ExpenseCategory =
  | 'Electricity/Bill'
  | 'Staff/Wages'
  | 'Tea/Food'
  | 'Maintenance'
  | 'Other';

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'Electricity/Bill',
  'Staff/Wages',
  'Tea/Food',
  'Maintenance',
  'Other',
];

export interface SecurityConfig {
  isPinSet: boolean;
  pinHash?: string;
  salt?: string;
}

export interface ShiftDefinition {
  id: string;
  name: string;
  order: number;
  isActive: boolean;
}

export interface ShiftDefaultAssignment {
  id: string;
  nozzleId: string;
  shiftId: string;
  employeeId: string;
  /** Optional one-off override for a specific date/time window. */
  assignmentType?: 'SHIFT' | 'CUSTOM_TIME';
  startDateTime?: string;
  endDateTime?: string;
}

export interface StationConfig {
  stationName: string;
  address: string;
  phone?: string;
  managerName: string;
  currency: 'Rs.';
  rates: Record<FuelType, number>;
  security: SecurityConfig;
  shifts: ShiftDefinition[];
  shiftAssignments: ShiftDefaultAssignment[];
}

/**
 * A station update expressed as a function of the latest saved station.
 * Use this instead of a stale snapshot so concurrent saves (e.g. an employee
 * added with a shift assignment) are never silently overwritten.
 * A plain snapshot is still accepted for compatibility and is merged over
 * the latest saved station.
 */
export type StationConfigUpdate =
  | StationConfig
  | ((latest: StationConfig) => StationConfig);

export interface Pump {
  id: string;
  name: string;
  isActive: boolean;
  notes?: string;
  fuelType?: FuelType;
}

export interface Nozzle {
  id: string;
  pumpId: string;
  name: string;
  fuelType: FuelType;
  isActive: boolean;
  lastClosingMeter: number;
  lastClosingDay?: string;
  deactivateReason?: string;
}

export interface Employee {
  id: string;
  name: string;
  fatherName?: string;
  cnic?: string;
  phone?: string;
  address?: string;
  role?: string;
  joiningDate?: string;
  isActive: boolean;
  notes?: string;
  createdAt: string;
  deactivatedAt?: string;
}
export interface Expense {
  id: string;
  operationId?: string;
  description: string;
  category: ExpenseCategory;
  amount: number;
  notes?: string;
  dateTime: string;
  // v66: who paid - manager (from collected cash) or staff (before handover).
  /** Historical cash routing only. New expenses deduct from station cash automatically. */
  paidBy?: 'manager' | 'staff';
  /** Automatically fixed at expense creation; cash already collected used for this expense. */
  collectedCashUsed?: number;
}

export interface NozzleReadingRecord {
  readingId?: string;
  corrections?: { at: string; reason: string; previousClosing: number; closing: number; previousAmount: number; amount: number }[];
  employeeId: string;
  employeeNameSnapshot: string;
  pumpId: string;
  pumpNameSnapshot: string;
  nozzleId: string;
  nozzleNameSnapshot: string;
  shiftId: string;
  shiftNameSnapshot: string;
  readingSequence?: number;
  /** Global meter order per nozzle, assigned when the reading is ACCEPTED.
   * 0/undefined = not yet accepted (pending placeholder).
   * Display numbering (readingSequence) restarts per shift, but the physical
   * meter is continuous, so the backend sorts accepted readings by meterOrder. */
  meterOrder?: number;
  readingTime?: string;
  cashReceived?: number;
  fuelType: FuelType;
  openingMeter: number;
  closingMeter: number;
  closingEntered?: boolean;
  quantitySold: number;
  rate: number;
  salesAmount: number;
  closingAccepted?: boolean;
  closingAcceptedAt?: string;
  closingAcceptanceNote?: string;
  assignmentType?: 'SHIFT' | 'CUSTOM_TIME';
  assignmentStartDateTime?: string;
  assignmentEndDateTime?: string;
}

export interface CashDeposit {
  id: string;
  readingId?: string;
  readingSequence?: number;
  // v64: nozzle-based handover. employeeId kept optional for old deposits.
  employeeId?: string;
  employeeNameSnapshot?: string;
  nozzleId?: string;
  nozzleNameSnapshot?: string;
  fuelType?: FuelType;
  amount: number;
  note?: string;
  timestamp: string;
}

export type OperationStatus = 'OPEN' | 'CLOSED';
export type ReconciliationStatusType = 'PENDING' | 'BALANCED' | 'SHORT' | 'EXCESS';

export interface FuelSupplyRecord {
  id: string;
  businessDate: string;
  fuelType: FuelType;
  quantity: number;
  note?: string;
  createdAt: string;
}

export interface FuelStockDayRecord {
  id: string;
  businessDate: string;
  fuelType: FuelType;
  openingStock: number;
  supplyRecords: FuelSupplyRecord[];
  actualPhysicalStock?: number;
  physicalCheckAt?: string;
  physicalCheckNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FuelStockSummary {
  fuelType: FuelType;
  businessDate: string;
  openingStock: number | null;
  supplied: number;
  sold: number;
  remainingStock: number | null;
  actualPhysicalStock: number | null;
  variance: number | null;
  hasCompleteSales: boolean;
}

export interface DailyOperation {
  manualSummary?: { batch: string; reason: string; enteredAt: string; enteredBy: string; cashCollected: number; fuel: Partial<Record<FuelType, { quantity: number; amount: number; supply: number }>> };
  id: string;
  businessDate: string;
  cycleNumber: number;
  startTime: string;
  endTime?: string;
  status: OperationStatus;
  rates: Record<FuelType, number>;
  nozzleReadings: NozzleReadingRecord[];
  expenses: Expense[];
  cashDeposits: CashDeposit[];
  grossSales: number;
  totalQuantity: number;
  totalExpenses: number;
  expectedNet: number;
  udhaarTotal?: number;
  actualCollection: number | null;
  // v69: Manager's counted cash (persisted, not just screen state).
  countedCash?: number | null;
  variance: number | null;
  reconciliationStatus: ReconciliationStatusType;
  reconciliationText: string;
  notes?: string;
  lastEditReason?: string;
}
export interface RateChangeRecord {
  id: string;
  businessDate: string;
  timestamp: string;
  changedByUserId: string;
  changedByName: string;
  oldPetrolRate: number;
  newPetrolRate: number;
  oldCngRate: number;
  newCngRate: number;
}
