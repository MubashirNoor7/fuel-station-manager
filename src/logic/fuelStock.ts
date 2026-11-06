import {
  DailyOperation,
  FuelStockDayRecord,
  FuelStockSummary,
  FuelSupplyRecord,
  FuelType,
} from '../types';

export interface FuelStockCalculation extends FuelStockSummary {
  soldSinceStart: number;
  isNegativeStock: boolean;
  status: 'OK' | 'LOW' | 'PROBLEM';
  statusText: 'STOCK OK' | 'FUEL IS GETTING LOW' | 'CHECK STOCK';
}

export interface FuelStockHistoryRow extends FuelStockCalculation {
  supplyCount: number;
}

const LOW_STOCK_THRESHOLD = 0.5;
const CRITICAL_STOCK_THRESHOLD = 0.2;

function roundQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function isValidQuantity(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function getReadingQuantity(
  reading: DailyOperation['nozzleReadings'][number],
): number {
  // v63: quantity is ALWAYS derived from meters for accepted readings,
  // mirroring the backend STOCK_GUARD. Never trust quantitySold alone.
  if (reading.closingAccepted === true) {
    const closing = Number(reading.closingMeter);
    const opening = Number(reading.openingMeter);
    if (Number.isFinite(closing) && Number.isFinite(opening) && closing > opening) {
      return closing - opening;
    }
  }
  return isValidQuantity(reading.quantitySold) ? reading.quantitySold : 0;
}

function isAcceptedReading(
  reading: DailyOperation['nozzleReadings'][number],
): boolean {
  return reading.closingAccepted === true && getReadingQuantity(reading) > 0;
}

function getReadingKey(
  operation: DailyOperation,
  reading: DailyOperation['nozzleReadings'][number],
): string {
  // Each accepted reading counts separately (multiple readings per nozzle+shift).
  // Include sequence and meterOrder to keep every reading unique.
  return [
    operation.id,
    reading.nozzleId,
    reading.shiftId,
    reading.readingSequence ?? 0,
    (reading as any).meterOrder ?? 0,
  ].join('|');
}

function getAcceptedReadings(
  operations: DailyOperation[],
  fuelType: FuelType,
): Array<{
  operation: DailyOperation;
  reading: DailyOperation['nozzleReadings'][number];
}> {
  const latestByKey = new Map<
    string,
    {
      operation: DailyOperation;
      reading: DailyOperation['nozzleReadings'][number];
      index: number;
    }
  >();

  operations.forEach((operation) => {
    operation.nozzleReadings.forEach((reading, index) => {
      if (reading.fuelType !== fuelType || !isAcceptedReading(reading)) return;

      const key = getReadingKey(operation, reading);
      const existing = latestByKey.get(key);
      const existingTime = existing?.reading.closingAcceptedAt || '';
      const currentTime = reading.closingAcceptedAt || '';

      if (
        !existing ||
        currentTime > existingTime ||
        (currentTime === existingTime && index >= existing.index)
      ) {
        latestByKey.set(key, { operation, reading, index });
      }
    });
  });

  return [...latestByKey.values()].map(({ operation, reading }) => ({
    operation,
    reading,
  }));
}

function getSupplyRecords(
  stockRecords: FuelStockDayRecord[],
  fuelType: FuelType,
): FuelSupplyRecord[] {
  const seenIds = new Set<string>();
  const result: FuelSupplyRecord[] = [];

  stockRecords.forEach((record) => {
    if (record.fuelType !== fuelType) return;

    // v63: guard against legacy records without supplyRecords (crash fix).
    const supplies = Array.isArray(record.supplyRecords) ? record.supplyRecords : [];
    supplies.forEach((supply) => {
      if (
        supply.fuelType !== fuelType ||
        !supply.businessDate ||
        !Number.isFinite(supply.quantity) ||
        supply.quantity <= 0 ||
        seenIds.has(supply.id)
      ) {
        return;
      }

      seenIds.add(supply.id);
      result.push(supply);
    });
  });

  return result;
}

function getInitialStockInfo(
  stockRecords: FuelStockDayRecord[],
  fuelType: FuelType,
): { amount: number; date: string | null } {
  const firstLegacyRecord = stockRecords
    .filter(
      (record) =>
        record.fuelType === fuelType &&
        isValidQuantity(record.openingStock),
    )
    .sort((a, b) => {
      const dateCompare = a.businessDate.localeCompare(b.businessDate);
      if (dateCompare !== 0) return dateCompare;
      return a.createdAt.localeCompare(b.createdAt);
    })[0];

  if (!firstLegacyRecord) {
    return { amount: 0, date: null };
  }

  return {
    amount: roundQuantity(firstLegacyRecord.openingStock),
    date: firstLegacyRecord.businessDate,
  };
}

function getDateBeforeBusinessDate(businessDate: string): string {
  const date = new Date(`${businessDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function getRelevantSupplyRecords(
  stockRecords: FuelStockDayRecord[],
  fuelType: FuelType,
  throughDate?: string,
): FuelSupplyRecord[] {
  const initial = getInitialStockInfo(stockRecords, fuelType);

  return getSupplyRecords(stockRecords, fuelType).filter((record) => {
    if (initial.date && record.businessDate < initial.date) return false;
    if (throughDate && record.businessDate > throughDate) return false;
    return true;
  });
}

function getAcceptedSales(
  operations: DailyOperation[],
  stockRecords: FuelStockDayRecord[],
  fuelType: FuelType,
  throughDate?: string,
): Array<{
  operation: DailyOperation;
  reading: DailyOperation['nozzleReadings'][number];
}> {
  const initial = getInitialStockInfo(stockRecords, fuelType);

  return getAcceptedReadings(operations, fuelType).filter(({ operation }) => {
    if (initial.date && operation.businessDate < initial.date) return false;
    if (throughDate && operation.businessDate > throughDate) return false;
    return true;
  });
}

function getCumulativeReceived(
  stockRecords: FuelStockDayRecord[],
  fuelType: FuelType,
  throughDate?: string,
): number {
  return roundQuantity(
    getRelevantSupplyRecords(stockRecords, fuelType, throughDate).reduce(
      (sum, record) => sum + record.quantity,
      0,
    ),
  );
}

function getCumulativeSold(
  operations: DailyOperation[],
  stockRecords: FuelStockDayRecord[],
  fuelType: FuelType,
  throughDate?: string,
): number {
  return roundQuantity(
    getAcceptedSales(operations, stockRecords, fuelType, throughDate).reduce(
      (sum, item) => sum + getReadingQuantity(item.reading),
      operations.filter(op => op.manualSummary && (!throughDate || op.businessDate <= throughDate) && (!getInitialStockInfo(stockRecords, fuelType).date || op.businessDate >= getInitialStockInfo(stockRecords, fuelType).date!)).reduce((n,op)=>n+Number(op.manualSummary?.fuel?.[fuelType]?.quantity || 0),0),
    ),
  );
}

function getLatestStockReference(
  stockRecords: FuelStockDayRecord[],
  operations: DailyOperation[],
  fuelType: FuelType,
  throughDate: string,
): number {
  const deliveries = getRelevantSupplyRecords(
    stockRecords,
    fuelType,
    throughDate,
  ).sort((a, b) => {
    const dateCompare = b.businessDate.localeCompare(a.businessDate);
    if (dateCompare !== 0) return dateCompare;
    return b.createdAt.localeCompare(a.createdAt);
  });

  const latestDelivery = deliveries[0];
  if (!latestDelivery) return 0;

  const openingOnDeliveryDate = findOpeningStock(
    stockRecords,
    latestDelivery.businessDate,
    fuelType,
    operations,
  );

  const suppliedOnDeliveryDate = getRelevantSupplyRecords(
    stockRecords,
    fuelType,
    latestDelivery.businessDate,
  )
    .filter((record) => record.businessDate === latestDelivery.businessDate)
    .reduce((sum, record) => sum + record.quantity, 0);

  return roundQuantity(
    Math.max(0, openingOnDeliveryDate ?? 0) + suppliedOnDeliveryDate,
  );
}

function getStatus(
  remainingStock: number,
  stockReference: number,
): FuelStockCalculation['status'] {
  if (remainingStock < 0) return 'PROBLEM';

  if (stockReference <= 0) return 'OK';

  const lowStockLimit = stockReference * LOW_STOCK_THRESHOLD;
  const criticalStockLimit = stockReference * CRITICAL_STOCK_THRESHOLD;

  if (remainingStock < criticalStockLimit) return 'PROBLEM';
  if (remainingStock < lowStockLimit) return 'LOW';

  return 'OK';
}

export function calculateFuelSalesForDate(
  operations: DailyOperation[],
  businessDate: string,
  fuelType: FuelType,
): number {
  return roundQuantity(
    getAcceptedReadings(operations, fuelType)
      .filter(({ operation }) => operation.businessDate === businessDate)
      .reduce((sum, item) => sum + getReadingQuantity(item.reading), operations.filter(op=>op.businessDate===businessDate).reduce((n,op)=>n+Number(op.manualSummary?.fuel?.[fuelType]?.quantity || 0),0)),
  );
}

export function calculateFuelSupplyForDate(
  stockRecords: FuelStockDayRecord[],
  businessDate: string,
  fuelType: FuelType,
): number {
  // v63: aggregate across ALL matching date+fuel records (not just the first).
  // Legacy data may hold duplicates; the UI picks latest by updatedAt, so
  // summing all matches keeps calculation and UI consistent.
  const seenIds = new Set<string>();
  let total = 0;

  stockRecords.forEach((stockRecord) => {
    if (
      !stockRecord ||
      stockRecord.businessDate !== businessDate ||
      stockRecord.fuelType !== fuelType
    ) {
      return;
    }

    // v63: guard against legacy records without supplyRecords.
    const supplies = Array.isArray(stockRecord.supplyRecords)
      ? stockRecord.supplyRecords
      : [];
    supplies.forEach((record) => {
      if (
        record.fuelType !== fuelType ||
        record.businessDate !== businessDate ||
        !Number.isFinite(record.quantity) ||
        record.quantity <= 0 ||
        seenIds.has(record.id)
      ) {
        return;
      }
      seenIds.add(record.id);
      total += record.quantity;
    });
  });

  return roundQuantity(total);
}

export function findOpeningStock(
  stockRecords: FuelStockDayRecord[],
  businessDate: string,
  fuelType: FuelType,
  operations: DailyOperation[] = [],
): number | null {
  const initial = getInitialStockInfo(stockRecords, fuelType);

  if (initial.date && businessDate < initial.date) return null;

  return roundQuantity(
    initial.amount +
      getCumulativeReceived(
        stockRecords,
        fuelType,
        getDateBeforeBusinessDate(businessDate),
      ) -
      getCumulativeSold(
        operations,
        stockRecords,
        fuelType,
        getDateBeforeBusinessDate(businessDate),
      ),
  );
}

export function getPreviousRemainingStock(
  stockRecords: FuelStockDayRecord[],
  operations: DailyOperation[],
  businessDate: string,
  fuelType: FuelType,
): number | null {
  return findOpeningStock(stockRecords, businessDate, fuelType, operations);
}

export function calculateFuelStock(
  businessDate: string,
  fuelType: FuelType,
  operations: DailyOperation[],
  stockRecords: FuelStockDayRecord[],
): FuelStockCalculation {
  const initial = getInitialStockInfo(stockRecords, fuelType);
  const hasTrackingData =
    initial.date !== null ||
    getSupplyRecords(stockRecords, fuelType).length > 0 ||
    getAcceptedReadings(operations, fuelType).length > 0;

  const openingStock = hasTrackingData
    ? findOpeningStock(stockRecords, businessDate, fuelType, operations)
    : null;

  const supplied = calculateFuelSupplyForDate(
    stockRecords,
    businessDate,
    fuelType,
  );

  const sold = calculateFuelSalesForDate(operations, businessDate, fuelType);

  const remainingStock =
    openingStock === null
      ? null
      : roundQuantity(openingStock + supplied - sold);

  const currentRecord = stockRecords.find(
    (record) =>
      record.businessDate === businessDate &&
      record.fuelType === fuelType,
  );

  const actualPhysicalStock =
    currentRecord && Number.isFinite(currentRecord.actualPhysicalStock)
      ? roundQuantity(Number(currentRecord.actualPhysicalStock))
      : null;

  const variance =
    remainingStock !== null && actualPhysicalStock !== null
      ? roundQuantity(actualPhysicalStock - remainingStock)
      : null;

  const isNegativeStock = remainingStock !== null && remainingStock < 0;
  const stockReference = getLatestStockReference(
    stockRecords,
    operations,
    fuelType,
    businessDate,
  );

  const status =
    remainingStock === null
      ? 'OK'
      : getStatus(remainingStock, stockReference);

  const statusText: FuelStockCalculation['statusText'] =
    status === 'PROBLEM'
      ? 'CHECK STOCK'
      : status === 'LOW'
        ? 'FUEL IS GETTING LOW'
        : 'STOCK OK';

  return {
    fuelType,
    businessDate,
    openingStock,
    supplied,
    sold,
    remainingStock,
    actualPhysicalStock,
    variance,
    hasCompleteSales: true,
    soldSinceStart: getCumulativeSold(
      operations,
      stockRecords,
      fuelType,
      businessDate,
    ),
    isNegativeStock,
    status,
    statusText,
  };
}

export function calculateFuelStockHistory(
  fuelType: FuelType,
  operations: DailyOperation[],
  stockRecords: FuelStockDayRecord[],
): FuelStockHistoryRow[] {
  const dates = new Set<string>();

  stockRecords
    .filter((record) => record.fuelType === fuelType)
    .forEach((record) => dates.add(record.businessDate));

  getSupplyRecords(stockRecords, fuelType).forEach((record) => {
    dates.add(record.businessDate);
  });

  getAcceptedReadings(operations, fuelType).forEach(({ operation }) => {
    dates.add(operation.businessDate);
  });

  return [...dates]
    .sort((a, b) => b.localeCompare(a))
    .map((businessDate) => {
      const calculation = calculateFuelStock(
        businessDate,
        fuelType,
        operations,
        stockRecords,
      );

      const supplyCount = getSupplyRecords(stockRecords, fuelType).filter(
        (record) => record.businessDate === businessDate,
      ).length;

      return {
        ...calculation,
        supplyCount,
      };
    });
}

export function createFuelSupplyRecord(
  businessDate: string,
  fuelType: FuelType,
  quantity: number,
  note?: string,
): FuelSupplyRecord {
  if (!businessDate || !Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('Fuel received quantity must be greater than zero.');
  }

  return {
    id: `supply-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    businessDate,
    fuelType,
    quantity: roundQuantity(quantity),
    note: note?.trim() || undefined,
    createdAt: new Date().toISOString(),
  };
}
