const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { BusinessStore } = require("../electron/business-store.cjs");

function fixture() {
  const s = new BusinessStore(":memory:");
  return s;
}

function saveOp(s, readings, day = "2026-10-05") {
  return s.petrolStatePut({
    kind: "operation",
    item: {
      id: "op-" + day,
      businessDate: day,
      status: "OPEN",
      nozzleReadings: readings,
    },
  });
}

function reading(nozzleId, fuelType, opening, closing, accepted = true) {
  const rate = fuelType === "PETROL" ? 390.66 : 380;
  const qty = closing - opening;
  return {
    nozzleId,
    fuelType,
    openingMeter: opening,
    closingMeter: closing,
    quantitySold: qty,
    rate,
    salesAmount: Math.round(qty * rate * 100) / 100,
    closingAccepted: accepted,
    readingSequence: 1,
    meterOrder: accepted ? 1 : 0,
  };
}

function saveStock(s, fuelType, openingStock, supplies = [], day = "2026-10-05") {
  return s.petrolStatePut({
    kind: "fuelStock",
    item: {
      id: `stock-${day}-${fuelType}`,
      businessDate: day,
      fuelType,
      openingStock,
      supplyRecords: supplies.map((q, i) => ({
        id: `sup-${i}`,
        businessDate: day,
        fuelType,
        quantity: q,
        createdAt: new Date().toISOString(),
      })),
    },
  });
}

test("v63: CNG reading accepted when petrol stock is 0 but CNG stock available", () => {
  const s = fixture();
  // Petrol: 0 stock. CNG: 9382 available.
  saveStock(s, "PETROL", 0);
  saveStock(s, "CNG", 9382);
  // Accept a CNG reading of 100kg. Should NOT be blocked by petrol stock.
  const result = saveOp(s, [reading("nozzle-cng-1", "CNG", 245150, 245250)]);
  assert.ok(result, "CNG reading should save, got: " + JSON.stringify(result));
  s.close();
});

test("v63: petrol reading still blocked when petrol stock insufficient", () => {
  const s = fixture();
  saveStock(s, "PETROL", 10); // only 10L
  saveStock(s, "CNG", 9382);
  // Try to accept 15L petrol sale. Should be blocked.
  assert.throws(
    () => saveOp(s, [reading("nozzle-pet-1", "PETROL", 1000, 1015)]),
    /Not enough Petrol in stock/
  );
  s.close();
});

test("v63: pre-existing petrol sales do not block new CNG readings", () => {
  const s = fixture();
  // No petrol stock tracking at first, accept petrol readings
  saveOp(s, [reading("nozzle-pet-1", "PETROL", 1000, 1050)]);
  // Now set up petrol stock with 0 opening (simulating Sammy's state)
  saveStock(s, "PETROL", 0);
  saveStock(s, "CNG", 9382);
  // Try to accept a CNG reading. The old petrol sale (50L) should NOT block it.
  const result = saveOp(s, [
    reading("nozzle-pet-1", "PETROL", 1000, 1050),
    reading("nozzle-cng-1", "CNG", 245150, 245250),
  ]);
  assert.ok(result, "CNG reading should save despite old petrol sale, got: " + JSON.stringify(result));
  s.close();
});

test("v63: new petrol sale still blocked when petrol already oversold", () => {
  const s = fixture();
  saveOp(s, [reading("nozzle-pet-1", "PETROL", 1000, 1050)]); // 50L, no tracking
  saveStock(s, "PETROL", 0); // 0 stock
  // Try to add MORE petrol sales. Should be blocked.
  assert.throws(
    () => saveOp(s, [
      reading("nozzle-pet-1", "PETROL", 1000, 1050),
      reading("nozzle-pet-2", "PETROL", 2000, 2010), // new 10L sale
    ]),
    /Not enough Petrol in stock/
  );
  s.close();
});


test('stock baseline excludes older sales and counts same-day sales', () => {
 const s=fixture(); try {
 saveOp(s,[reading('old','PETROL',1000,3323)],'2026-10-04');
 saveStock(s,'PETROL',5000,[5000]);
 saveOp(s,[reading('today','PETROL',0,7334)]);
 const correct = (before, closing) => {
   const after = reading('today','PETROL',0,closing);
   after.corrections = [...(before.corrections || []), { at: new Date().toISOString(), reason: 'Correct meter entry', previousClosing: before.closingMeter, closing, previousAmount: before.salesAmount, amount: after.salesAmount }];
   return after;
 };
 const corrected = correct(reading('today','PETROL',0,7334),8094);
 assert.doesNotThrow(()=>saveOp(s,[corrected]));
 assert.throws(()=>saveOp(s,[correct(corrected,10001)]),/Not enough Petrol/);
 } finally {s.close();}
});

test('supplies use their own date and duplicated supply IDs count once', () => {
 const s=fixture(); try {
 saveStock(s,'PETROL',10,[10]);
 saveStock(s,'PETROL',10,[10],'2026-10-06');
 assert.throws(()=>saveOp(s,[reading('n','PETROL',0,21)],'2026-10-06'),/Not enough Petrol/);
 assert.doesNotThrow(()=>saveOp(s,[reading('n','PETROL',0,20)],'2026-10-06'));
 } finally {s.close();}
});
