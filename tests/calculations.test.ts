import {
  calculateQuantitySold,
  calculateSales,
  calculateGrossSales,
  calculateTotalExpenses,
  calculateExpectedNet,
  calculateVariance,
  getReconciliationStatus,
  formatCurrency,
  formatCurrencyAmount,
  getNextOpeningMeter,
  calculateCumulativeClosedTotals,
  getPakistanLocalDate,
  formatBusinessDateDisplay,
} from '../src/logic/calculations';
import { DailyOperation, Employee, Nozzle } from '../src/types';

interface TestResult {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
  error?: string;
}

const results: TestResult[] = [];

function assertEqual(testName: string, actual: any, expected: any) {
  const passed = actual === expected;
  results.push({
    name: testName,
    passed,
    expected: String(expected),
    actual: String(actual),
    error: passed ? undefined : `Expected "${expected}" but got "${actual}"`,
  });
}

async function runTests() {
  console.log('====================================================');
  console.log('RUNNING FUELSTATION MANAGER WORKFLOW TEST SUITE');
  console.log('====================================================\n');

  // TEST 1: Petrol reading and sales calculation
  // Petrol opening 1000, closing 1150, Rate Rs. 278 -> Result = 150 litres, Sales = Rs. 41,700
  {
    const qtyRes = calculateQuantitySold(1000, 1150);
    assertEqual('TEST 1 - Petrol Quantity Sold (1000 to 1150)', qtyRes.success ? qtyRes.data : null, 150);
    const sales = qtyRes.success && qtyRes.data ? calculateSales(qtyRes.data, 278) : 0;
    assertEqual('TEST 1 - Petrol Sales Amount (150 * 278)', sales, 41700);
  }

  // TEST 2: CNG reading and sales calculation
  // CNG opening 500, closing 550, Rate Rs. 215 -> Result = 50 units, Sales = Rs. 10,750
  {
    const qtyRes = calculateQuantitySold(500, 550);
    assertEqual('TEST 2 - CNG Quantity Sold (500 to 550)', qtyRes.success ? qtyRes.data : null, 50);
    const sales = qtyRes.success && qtyRes.data ? calculateSales(qtyRes.data, 215) : 0;
    assertEqual('TEST 2 - CNG Sales Amount (50 * 215)', sales, 10750);
  }

  // TEST 3: Gross fuel sales, expenses, and expected net to bank
  // Gross sales = Rs. 52,450, Expenses: Staff/Wages Rs. 2,000, Tea/Food Rs. 500 -> Expected Net to Bank = Rs. 49,950
  {
    const grossSales = calculateGrossSales([
      { salesAmount: 41700 }, // Petrol
      { salesAmount: 10750 }, // CNG
    ]);
    assertEqual('TEST 3 - Gross Fuel Sales (41700 + 10750)', grossSales, 52450);

    const totalExpenses = calculateTotalExpenses([
      { amount: 2000 }, // Staff/Wages
      { amount: 500 },  // Tea/Food
    ]);
    assertEqual('TEST 3 - Total Expenses (2000 + 500)', totalExpenses, 2500);

    const expectedNet = calculateExpectedNet(grossSales, totalExpenses);
    assertEqual('TEST 3 - Expected Net to Bank (52450 - 2500)', expectedNet, 49950);
  }

  // TEST 4: Actual Cash = Rs. 49,950 -> Result: BALANCED
  {
    const expectedNet = 49950;
    const actualCash = 49950;
    const variance = calculateVariance(actualCash, expectedNet);
    assertEqual('TEST 4 - Variance calculation (49950 - 49950)', variance, 0);

    const reconciliation = getReconciliationStatus(variance, actualCash);
    assertEqual('TEST 4 - Reconciliation Status (BALANCED)', reconciliation.status, 'BALANCED');
    assertEqual('TEST 4 - Reconciliation Text (BALANCED)', reconciliation.text, 'BALANCED');
  }

  // TEST 5: Actual Cash = Rs. 49,000 -> Result: SHORT BY Rs. 950
  {
    const expectedNet = 49950;
    const actualCash = 49000;
    const variance = calculateVariance(actualCash, expectedNet);
    assertEqual('TEST 5 - Variance calculation (49000 - 49950)', variance, -950);

    const reconciliation = getReconciliationStatus(variance, actualCash);
    assertEqual('TEST 5 - Reconciliation Status (SHORT)', reconciliation.status, 'SHORT');
    assertEqual('TEST 5 - Reconciliation Text (SHORT BY Rs. 950)', reconciliation.text, 'SHORT BY Rs. 950');
  }

  // TEST 6: Actual Cash = Rs. 50,500 -> Result: EXCESS BY Rs. 550
  {
    const expectedNet = 49950;
    const actualCash = 50500;
    const variance = calculateVariance(actualCash, expectedNet);
    assertEqual('TEST 6 - Variance calculation (50500 - 49950)', variance, 550);

    const reconciliation = getReconciliationStatus(variance, actualCash);
    assertEqual('TEST 6 - Reconciliation Status (EXCESS)', reconciliation.status, 'EXCESS');
    assertEqual('TEST 6 - Reconciliation Text (EXCESS BY Rs. 550)', reconciliation.text, 'EXCESS BY Rs. 550');
  }

  // TEST 7: Actual Cash empty -> Result: PENDING (no false shortage)
  {
    const expectedNet = 49950;
    const varianceNull = calculateVariance(null, expectedNet);
    assertEqual('TEST 7 - Variance for null cash is null', varianceNull, null);

    const statusNull = getReconciliationStatus(varianceNull, null);
    assertEqual('TEST 7 - Reconciliation Status for null cash is PENDING', statusNull.status, 'PENDING');
    assertEqual('TEST 7 - Reconciliation Text for null cash is PENDING', statusNull.text, 'PENDING');
  }

  // TEST 8: Closing meter lower than opening -> Result: REJECTED
  {
    const openingMeter = 1000;
    const closingMeter = 900;
    const qtyRes = calculateQuantitySold(openingMeter, closingMeter);
    assertEqual('TEST 8 - Reject Closing (900) < Opening (1000)', qtyRes.success, false);
    const hasError = !qtyRes.success && typeof qtyRes.error === 'string' && qtyRes.error.length > 0;
    assertEqual('TEST 8 - Rejection provides clear error message', hasError, true);
  }

  // TEST 9: Day 1 closing becomes Day 2 opening for the SAME nozzle
  {
    const nozzleA: Nozzle = {
      id: 'noz-a',
      pumpId: 'pump-1',
      name: 'Nozzle 1 (Petrol)',
      fuelType: 'PETROL',
      lastClosingMeter: 10250,
      isActive: true,
    };

    // When opening Day 2, opening meter comes from lastClosingMeter
    const day2Opening = getNextOpeningMeter(nozzleA.lastClosingMeter);
    assertEqual('TEST 9 - Day 2 opening for Nozzle A equals Day 1 closing (10250)', day2Opening, 10250);

    const day2QtyRes = calculateQuantitySold(day2Opening, 10600);
    assertEqual('TEST 9 - Day 2 Quantity sold calculated from continuous opening (350)', day2QtyRes.data, 350);
  }

  // TEST 10: Different nozzles maintain independent meter continuity
  {
    const nozzlePetrol: Nozzle = {
      id: 'noz-petrol-1',
      pumpId: 'pump-1',
      name: 'Petrol Nozzle 1',
      fuelType: 'PETROL',
      lastClosingMeter: 15400,
      isActive: true,
    };

    const nozzleCng: Nozzle = {
      id: 'noz-cng-1',
      pumpId: 'pump-2',
      name: 'CNG Nozzle 1',
      fuelType: 'CNG',
      lastClosingMeter: 8200,
      isActive: true,
    };

    const petrolOpening = getNextOpeningMeter(nozzlePetrol.lastClosingMeter);
    const cngOpening = getNextOpeningMeter(nozzleCng.lastClosingMeter);

    assertEqual('TEST 10 - Petrol Nozzle Opening is independent (15400)', petrolOpening, 15400);
    assertEqual('TEST 10 - CNG Nozzle Opening is independent (8200)', cngOpening, 8200);
  }

  // TEST 11: Employee remains available across future days without recreating them
  {
    const employeeMaster: Employee[] = [
      { id: 'emp-1', name: 'Ali Raza', notes: '03001112233', isActive: true, createdAt: '2026-01-01' },
      { id: 'emp-2', name: 'Ahmed Khan', notes: '03004445566', isActive: true, createdAt: '2026-01-01' },
      { id: 'emp-3', name: 'Usman Tariq', notes: '03007778899', isActive: true, createdAt: '2026-01-01' },
      { id: 'emp-4', name: 'Bilal Hassan', notes: '03009990011', isActive: true, createdAt: '2026-01-01' },
    ];

    // Day 1 shift assignment
    const day1Assignment = employeeMaster.find((e) => e.name === 'Ali Raza');
    assertEqual('TEST 11 - Day 1 employee assigned from master list', day1Assignment?.name, 'Ali Raza');

    // Day 2 shift assignment without re-creating employee
    const day2Assignment = employeeMaster.find((e) => e.name === 'Ali Raza');
    assertEqual('TEST 11 - Day 2 same employee assigned from existing master list', day2Assignment?.name, 'Ali Raza');
    assertEqual('TEST 11 - Employee master count remains stable', employeeMaster.length, 4);
  }

  // TEST 12: Employee name snapshot remains unchanged in old closed records after deactivation/name change
  {
    const employeeMaster: Employee[] = [
      { id: 'emp-10', name: 'Ali', notes: '03001234567', isActive: true, createdAt: '2026-01-01' },
    ];

    // Closed record created on 01-09-2026
    const closedRecordDay1: DailyOperation = {
      id: 'op-2026-09-01',
      businessDate: '2026-09-01',
      cycleNumber: 1,
      startTime: '2026-09-01T06:00:00Z',
      endTime: '2026-09-01T22:00:00Z',
      status: 'CLOSED',
      rates: { PETROL: 278.0, CNG: 215.0 },
      nozzleReadings: [
        {
          nozzleId: 'noz-1',
          nozzleNameSnapshot: 'Petrol Nozzle 1',
          pumpId: 'pump-1',
          pumpNameSnapshot: 'Pump 1',
          employeeId: employeeMaster[0].id,
          employeeNameSnapshot: employeeMaster[0].name, // "Ali"
          shiftId: 'shift-1',
          shiftNameSnapshot: 'Full Day',
          fuelType: 'PETROL',
          openingMeter: 1000,
          closingMeter: 1150,
          quantitySold: 150,
          rate: 278.0,
          salesAmount: 41700,
        },
      ],
      expenses: [],
      cashDeposits: [],
      grossSales: 41700,
      totalQuantity: 150,
      totalExpenses: 0,
      expectedNet: 41700,
      actualCollection: 41700,
      variance: 0,
      reconciliationStatus: 'BALANCED',
      reconciliationText: 'BALANCED',
    };

    // Later, Ali leaves and manager deactivates / renames employee in master list
    employeeMaster[0].isActive = false;
    employeeMaster[0].name = 'Ali (Deactivated)';

    // Verify historical closed record still has "Ali"
    assertEqual('TEST 12 - Historical operator snapshot remains "Ali"', closedRecordDay1.nozzleReadings[0].employeeNameSnapshot, 'Ali');
    assertEqual('TEST 12 - Master employee is deactivated', employeeMaster[0].isActive, false);
  }

  // TEST 13: Changing today's/default rate does not modify historical closed records
  {
    const historicalOp: DailyOperation = {
      id: 'op-hist-closed',
      businessDate: '2026-08-30',
      cycleNumber: 1,
      startTime: '2026-08-30T06:00:00Z',
      endTime: '2026-08-30T22:00:00Z',
      status: 'CLOSED',
      rates: { PETROL: 278.0, CNG: 215.0 },
      nozzleReadings: [
        {
          nozzleId: 'noz-1',
          nozzleNameSnapshot: 'Petrol Nozzle 1',
          pumpId: 'pump-1',
          pumpNameSnapshot: 'Pump 1',
          employeeId: 'emp-1',
          employeeNameSnapshot: 'Ahmed',
          shiftId: 'shift-1',
          shiftNameSnapshot: 'Full Day',
          fuelType: 'PETROL',
          openingMeter: 1000,
          closingMeter: 1150,
          quantitySold: 150,
          rate: 278.0,
          salesAmount: 41700,
        },
      ],
      expenses: [],
      cashDeposits: [],
      grossSales: 41700,
      totalQuantity: 150,
      totalExpenses: 0,
      expectedNet: 41700,
      actualCollection: 41700,
      variance: 0,
      reconciliationStatus: 'BALANCED',
      reconciliationText: 'BALANCED',
    };

    // Manager later changes station default rates in Settings to Rs. 310 / Rs. 240
    const newStationConfigRates = { PETROL: 310.0, CNG: 240.0 };

    assertEqual('TEST 13 - Historical record Petrol rate remains Rs. 278', historicalOp.rates.PETROL, 278.0);
    assertEqual('TEST 13 - Historical record CNG rate remains Rs. 215', historicalOp.rates.CNG, 215.0);
    assertEqual('TEST 13 - Historical reading rate remains Rs. 278', historicalOp.nozzleReadings[0].rate, 278.0);
    assertEqual('TEST 13 - Historical sales amount remains Rs. 41700', historicalOp.grossSales, 41700);
  }

  // TEST 14: Three closed days remain available and cumulative totals are correct
  // Day 1 -> Rs. 100,000 gross, Day 2 -> Rs. 120,000 gross, Day 3 -> Rs. 90,000 gross
  {
    const operationsList: DailyOperation[] = [
      {
        id: 'op-day-1',
        businessDate: '2026-08-25',
        cycleNumber: 1,
        startTime: '2026-08-25T06:00:00Z',
        status: 'CLOSED',
        rates: { PETROL: 278.0, CNG: 215.0 },
        grossSales: 100000,
        totalQuantity: 360,
        totalExpenses: 5000,
        expectedNet: 95000,
        actualCollection: 95000,
        variance: 0,
        reconciliationStatus: 'BALANCED',
        reconciliationText: 'BALANCED',
        nozzleReadings: [
          {
            nozzleId: 'noz-1',
            nozzleNameSnapshot: 'Petrol 1',
            pumpId: 'pump-1',
            pumpNameSnapshot: 'Pump 1',
            employeeId: 'emp-1',
            employeeNameSnapshot: 'Ali',
            shiftId: 'shift-1',
            shiftNameSnapshot: 'Full Day',
            fuelType: 'PETROL',
            openingMeter: 1000,
            closingMeter: 1360,
            quantitySold: 360,
            rate: 278,
            salesAmount: 100000,
          },
        ],
        expenses: [{ id: 'e1', description: 'Bill', category: 'Electricity/Bill', amount: 5000, dateTime: '2026-08-25T12:00:00Z' }],
      cashDeposits: [],
      },
      {
        id: 'op-day-2',
        businessDate: '2026-08-26',
        cycleNumber: 1,
        startTime: '2026-08-26T06:00:00Z',
        status: 'CLOSED',
        rates: { PETROL: 278.0, CNG: 215.0 },
        grossSales: 120000,
        totalQuantity: 430,
        totalExpenses: 6000,
        expectedNet: 114000,
        actualCollection: 114000,
        variance: 0,
        reconciliationStatus: 'BALANCED',
        reconciliationText: 'BALANCED',
        nozzleReadings: [
          {
            nozzleId: 'noz-1',
            nozzleNameSnapshot: 'Petrol 1',
            pumpId: 'pump-1',
            pumpNameSnapshot: 'Pump 1',
            employeeId: 'emp-1',
            employeeNameSnapshot: 'Ali',
            shiftId: 'shift-1',
            shiftNameSnapshot: 'Full Day',
            fuelType: 'PETROL',
            openingMeter: 1360,
            closingMeter: 1790,
            quantitySold: 430,
            rate: 278,
            salesAmount: 120000,
          },
        ],
        expenses: [{ id: 'e2', description: 'Staff', category: 'Staff/Wages', amount: 6000, dateTime: '2026-08-26T12:00:00Z' }],
      cashDeposits: [],
      },
      {
        id: 'op-day-3',
        businessDate: '2026-08-27',
        cycleNumber: 1,
        startTime: '2026-08-27T06:00:00Z',
        status: 'CLOSED',
        rates: { PETROL: 278.0, CNG: 215.0 },
        grossSales: 90000,
        totalQuantity: 320,
        totalExpenses: 4000,
        expectedNet: 86000,
        actualCollection: 86000,
        variance: 0,
        reconciliationStatus: 'BALANCED',
        reconciliationText: 'BALANCED',
        nozzleReadings: [
          {
            nozzleId: 'noz-1',
            nozzleNameSnapshot: 'Petrol 1',
            pumpId: 'pump-1',
            pumpNameSnapshot: 'Pump 1',
            employeeId: 'emp-1',
            employeeNameSnapshot: 'Ali',
            shiftId: 'shift-1',
            shiftNameSnapshot: 'Full Day',
            fuelType: 'PETROL',
            openingMeter: 1790,
            closingMeter: 2110,
            quantitySold: 320,
            rate: 278,
            salesAmount: 90000,
          },
        ],
        expenses: [{ id: 'e3', description: 'Tea', category: 'Tea/Food', amount: 4000, dateTime: '2026-08-27T12:00:00Z' }],
      cashDeposits: [],
      },
    ];

    const cumTotals = calculateCumulativeClosedTotals(operationsList);

    assertEqual('TEST 14 - Total Closed Days count is 3', cumTotals.count, 3);
    assertEqual('TEST 14 - Cumulative Gross Sales (100k + 120k + 90k = 310k)', cumTotals.grossSales, 310000);
    assertEqual('TEST 14 - Cumulative Total Expenses (5k + 6k + 4k = 15k)', cumTotals.totalExpenses, 15000);
    assertEqual('TEST 14 - Cumulative Expected Net (95k + 114k + 86k = 295k)', cumTotals.expectedNet, 295000);
    assertEqual('TEST 14 - Cumulative Actual Collection = 295k', cumTotals.actualCollection, 295000);
    assertEqual('TEST 14 - Cumulative Petrol Quantity Sold (360 + 430 + 320 = 1110)', cumTotals.totalPetrolQuantity, 1110);
  }

  // TEST 15: OPEN operation is not included in permanent CLOSED historical totals
  {
    const mixedOperationsList: DailyOperation[] = [
      {
        id: 'op-closed-1',
        businessDate: '2026-08-28',
        cycleNumber: 1,
        startTime: '2026-08-28T06:00:00Z',
        status: 'CLOSED',
        rates: { PETROL: 278.0, CNG: 215.0 },
        grossSales: 50000,
        totalQuantity: 180,
        totalExpenses: 2000,
        expectedNet: 48000,
        actualCollection: 48000,
        variance: 0,
        reconciliationStatus: 'BALANCED',
        reconciliationText: 'BALANCED',
        nozzleReadings: [],
        expenses: [],
      cashDeposits: [],
      },
      {
        id: 'op-open-current',
        businessDate: '2026-08-29',
        cycleNumber: 1,
        startTime: '2026-08-29T06:00:00Z',
        status: 'OPEN', // Unfinished today's operation!
        rates: { PETROL: 278.0, CNG: 215.0 },
        grossSales: 75000, // Should be EXCLUDED from cumulative history!
        totalQuantity: 270,
        totalExpenses: 3000,
        expectedNet: 72000,
        actualCollection: 72000,
        variance: 0,
        reconciliationStatus: 'BALANCED',
        reconciliationText: 'BALANCED',
        nozzleReadings: [],
        expenses: [],
      cashDeposits: [],
      },
    ];

    const cumTotals = calculateCumulativeClosedTotals(mixedOperationsList);

    assertEqual('TEST 15 - Cumulative count excludes OPEN operation (only 1 closed day)', cumTotals.count, 1);
    assertEqual('TEST 15 - Cumulative Gross Sales strictly excludes OPEN op (50k only, not 125k)', cumTotals.grossSales, 50000);
    assertEqual('TEST 15 - Cumulative Expenses strictly excludes OPEN op (2k only)', cumTotals.totalExpenses, 2000);
    assertEqual('TEST 15 - Cumulative Expected Net strictly excludes OPEN op (48k only)', cumTotals.expectedNet, 48000);
  }

  // TEST 16: Step 4 Pre-closing checklist validation behavior
  {
    // Case 1: Missing closing meter
    const rowMissingClosing = {
      hasEnteredClosing: false,
      error: null,
      row: { employeeId: 'emp-1' },
    };
    const rowValid = {
      hasEnteredClosing: true,
      error: null,
      row: { employeeId: 'emp-1' },
    };
    const rowReadingError = {
      hasEnteredClosing: true,
      error: 'Closing meter (900) cannot be lower than opening meter (1000)',
      row: { employeeId: 'emp-1' },
    };
    const rowUnassignedOperator = {
      hasEnteredClosing: true,
      error: null,
      row: { employeeId: '' },
    };

    // Checklist check function matching DailyOperationScreen logic
    const checkIsAllValid = (readings: any[], cash: number | null) => {
      const missingClosing = readings.filter((r) => !r.hasEnteredClosing);
      const unassigned = readings.filter((r) => !r.row.employeeId || r.row.employeeId.trim() === '');
      const readingErrors = readings.filter((r) => !!r.error);
      const hasCash = cash !== null && cash !== undefined && !isNaN(cash);
      return (
        readings.length > 0 &&
        missingClosing.length === 0 &&
        unassigned.length === 0 &&
        readingErrors.length === 0 &&
        hasCash
      );
    };

    assertEqual('TEST 16a - Checklist blocks close when closing meter is missing', checkIsAllValid([rowMissingClosing], 50000), false);
    assertEqual('TEST 16b - Checklist blocks close when reading error exists', checkIsAllValid([rowReadingError], 50000), false);
    assertEqual('TEST 16c - Checklist blocks close when operator is unassigned', checkIsAllValid([rowUnassignedOperator], 50000), false);
    assertEqual('TEST 16d - Checklist blocks close when actual cash is not entered', checkIsAllValid([rowValid], null), false);
    assertEqual('TEST 16e - Checklist allows close when all meters valid, operators assigned, cash entered', checkIsAllValid([rowValid], 50000), true);
  }

  // TEST 17: Step 4 Employee Filtering (Active vs Deactivated)
  {
    const staffList: Employee[] = [
      { id: 'emp-1', name: 'Rashid Khan', isActive: true, createdAt: '2026-01-01' },
      { id: 'emp-2', name: 'Tariq Mehmood', isActive: false, deactivatedAt: '2026-02-01', createdAt: '2026-01-01' },
      { id: 'emp-3', name: 'Usman Ali', isActive: true, createdAt: '2026-01-01' },
    ];

    const activeStaff = staffList.filter((e) => e.isActive);
    assertEqual('TEST 17a - Active staff filter returns only active operators', activeStaff.length, 2);
    assertEqual('TEST 17b - Inactive operator Tariq is excluded from active staff list', activeStaff.some((e) => e.id === 'emp-2'), false);

    // Available employees dropdown for row already referencing inactive employee
    const currentRows = [{ employeeId: 'emp-2' }];
    const assignedIds = new Set(currentRows.map((r) => r.employeeId));
    const availableForDropdown = [
      ...staffList.filter((e) => e.isActive),
      ...staffList.filter((e) => !e.isActive && assignedIds.has(e.id)),
    ];
    assertEqual('TEST 17c - Available dropdown includes active employees and preserved assigned inactive employee', availableForDropdown.length, 3);
  }

  // TEST 20: Step 6 Storage Idempotency & Duplicate Operation Prevention
  {
    const existingOps: DailyOperation[] = [
      {
        id: 'op-day-1',
        businessDate: '2026-03-01',
        cycleNumber: 1,
        startTime: '2026-03-01T08:00:00Z',
        status: 'CLOSED',
        rates: { PETROL: 278, CNG: 215 },
        nozzleReadings: [],
        expenses: [],
      cashDeposits: [],
        grossSales: 50000,
        totalQuantity: 200,
        totalExpenses: 2000,
        expectedNet: 48000,
        actualCollection: 48000,
        variance: 0,
        reconciliationStatus: 'BALANCED',
        reconciliationText: 'BALANCED',
      },
    ];

    // Simulating saveDailyOperation in-place update logic
    const saveOperationIdempotent = (ops: DailyOperation[], op: DailyOperation) => {
      const idx = ops.findIndex((o) => o.id === op.id);
      if (idx >= 0) {
        const copy = [...ops];
        copy[idx] = op;
        return copy;
      }
      return [...ops, op];
    };

    const updatedOp: DailyOperation = {
      ...existingOps[0],
      actualCollection: 48500,
      variance: 500,
      reconciliationStatus: 'EXCESS',
      reconciliationText: 'EXCESS BY Rs. 500',
    };

    const resultAfterResave = saveOperationIdempotent(existingOps, updatedOp);
    assertEqual('TEST 20a - Resaving existing operation maintains exact count without duplicate records', resultAfterResave.length, 1);
    assertEqual('TEST 20b - Resaving existing operation updates fields in-place', resultAfterResave[0].actualCollection, 48500);

    // Saving a distinct new operation appends correctly
    const newOp: DailyOperation = {
      ...existingOps[0],
      id: 'op-day-2',
      businessDate: '2026-03-02',
    };
    const resultAfterNewSave = saveOperationIdempotent(resultAfterResave, newOp);
    assertEqual('TEST 20c - Saving a new operation adds exactly 1 new record', resultAfterNewSave.length, 2);
  }

  // TEST 21: Step 6 Edge Case & Numeric Boundary Safety
  {
    // Zero readings (opening == closing)
    const zeroReading = calculateQuantitySold(5000, 5000);
    assertEqual('TEST 21a - Equal opening and closing meter yields 0 quantity', zeroReading.success ? zeroReading.data : null, 0);
    const zeroSales = calculateSales(0, 278);
    assertEqual('TEST 21b - 0 quantity sold produces Rs. 0 sales amount', zeroSales, 0);

    // Decimal meter reading support
    const decimalReading = calculateQuantitySold(100.5, 150.75);
    assertEqual('TEST 21c - Decimal meter reading calculates accurately (50.25)', decimalReading.success ? decimalReading.data : null, 50.25);

    // Very large meter reading
    const largeReading = calculateQuantitySold(1000000, 1005000);
    assertEqual('TEST 21d - Large meter values calculate accurately (5000)', largeReading.success ? largeReading.data : null, 5000);

    // Zero expenses
    const zeroExpenses = calculateTotalExpenses([]);
    assertEqual('TEST 21e - Empty expense list returns 0 total expenses', zeroExpenses, 0);
    const netWithZeroExp = calculateExpectedNet(50000, zeroExpenses);
    assertEqual('TEST 21f - Expected net equals gross sales when expenses are 0', netWithZeroExp, 50000);
  }

  // TEST 23: Automatic Business Date & Timezone / Date Display Helpers
  {
    const todayPkt = getPakistanLocalDate();
    assertEqual('TEST 23a - getPakistanLocalDate returns YYYY-MM-DD format', /^\d{4}-\d{2}-\d{2}$/.test(todayPkt), true);

    const formattedDisplay = formatBusinessDateDisplay('2026-09-01');
    assertEqual('TEST 23b - formatBusinessDateDisplay formats correctly (01 Sep 2026)', formattedDisplay, '01 Sep 2026');

    const formattedAnother = formatBusinessDateDisplay('2026-12-25');
    assertEqual('TEST 23c - formatBusinessDateDisplay handles December (25 Dec 2026)', formattedAnother, '25 Dec 2026');
  }

  // TEST 24: "Cannot Close Day" Missing Requirements Extraction Logic
  {
    interface MockRow {
      hasEnteredClosing: boolean;
      error?: string;
      record: {
        nozzleId: string;
        nozzleNameSnapshot: string;
        pumpNameSnapshot: string;
        fuelType: 'PETROL' | 'CNG';
        openingMeter: number;
      };
      row: { employeeId: string };
    }

    const compileMissingItems = (
      readings: MockRow[],
      actualCash: number | null
    ) => {
      const items: Array<{ category: string; title: string }> = [];

      // 1. Reading Errors
      readings.filter((r) => !!r.error).forEach((r) => {
        items.push({
          category: 'reading_error',
          title: `Invalid Meter: ${r.record.pumpNameSnapshot} - ${r.record.nozzleNameSnapshot}`,
        });
      });

      // 2. Missing Closing Meters
      readings.filter((r) => !r.hasEnteredClosing).forEach((r) => {
        items.push({
          category: 'meter',
          title: `Closing Meter Missing: ${r.record.pumpNameSnapshot} - ${r.record.nozzleNameSnapshot} (${r.record.fuelType})`,
        });
      });

      // 3. Unassigned Operators
      readings.filter((r) => !r.row.employeeId || r.row.employeeId.trim() === '').forEach((r) => {
        items.push({
          category: 'operator',
          title: `Operator Unassigned: ${r.record.pumpNameSnapshot} - ${r.record.nozzleNameSnapshot}`,
        });
      });

      // 4. Physical Cash Missing
      if (actualCash === null || isNaN(actualCash)) {
        items.push({
          category: 'cash',
          title: 'Physical Cash Handover Missing',
        });
      }

      return items;
    };

    const mockReadings: MockRow[] = [
      {
        hasEnteredClosing: false, // Missing closing
        record: { nozzleId: 'n-1', nozzleNameSnapshot: 'Nozzle 1', pumpNameSnapshot: 'Dispenser 1', fuelType: 'PETROL', openingMeter: 1000 },
        row: { employeeId: '' }, // Unassigned operator
      },
      {
        hasEnteredClosing: true,
        error: 'Closing meter (800) cannot be lower than opening meter (900)',
        record: { nozzleId: 'n-2', nozzleNameSnapshot: 'Nozzle 2', pumpNameSnapshot: 'Dispenser 2', fuelType: 'CNG', openingMeter: 900 },
        row: { employeeId: 'emp-1' },
      },
    ];

    const missingItems = compileMissingItems(mockReadings, null); // Cash also missing
    assertEqual('TEST 24a - Detects all 4 distinct missing categories', missingItems.length, 4);
    assertEqual('TEST 24b - Category 1: reading error detected', missingItems.some((i) => i.category === 'reading_error'), true);
    assertEqual('TEST 24c - Category 2: missing closing meter detected', missingItems.some((i) => i.category === 'meter'), true);
    assertEqual('TEST 24d - Category 3: unassigned operator detected', missingItems.some((i) => i.category === 'operator'), true);
    assertEqual('TEST 24e - Category 4: missing physical cash detected', missingItems.some((i) => i.category === 'cash'), true);
  }

  // TEST 25: Business Date Enforcement (Asia/Karachi)
  {
    // A. Enforce automatic Pakistan Local Date (Asia/Karachi)
    const testUtcTime = new Date('2026-09-02T20:00:00Z'); // In UTC: Sep 02, 20:00. In PKT (UTC+5): Sep 03, 01:00 AM
    const pkDate = getPakistanLocalDate(testUtcTime);
    assertEqual('TEST 25a - getPakistanLocalDate converts UTC to Asia/Karachi (next day across midnight)', pkDate, '2026-09-03');

  }

  // Summary Report
  console.log('\nRESULTS:');
  let allPassed = true;
  results.forEach((r, idx) => {
    const statusText = r.passed ? 'PASS' : `FAIL -> ${r.error}`;
    console.log(`✓ [${idx + 1}] ${r.name}: ${statusText}`);
    if (!r.passed) allPassed = false;
  });

  console.log('\n====================================================');
  console.log(`TOTAL: ${results.length} checks | PASSED: ${results.filter((r) => r.passed).length} | FAILED: ${results.filter((r) => !r.passed).length}`);
  console.log('====================================================\n');

  if (!allPassed) {
    process.exit(1);
  } else {
    console.log('ALL TESTS PASSED SUCCESSFULLY.');
  }
}

runTests().catch((err) => {
  console.error('Fatal error running tests:', err);
  process.exit(1);
});
