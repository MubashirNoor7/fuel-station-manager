// Core store tests for the fuel-only version. Uses only in-memory
// databases (one file-backed test at the end). Never touches live data.
// Run: node --test tests/business-store.test.cjs
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { BusinessStore } = require("../electron/business-store.cjs");

function fixture() {
  return new BusinessStore(":memory:");
}

const post = (s, p) =>
  s.command({
    type: "post",
    id: randomUUID(),
    day: "2026-01-10",
    business: "FUEL",
    account: "cash-FUEL",
    ...p,
  });

const master = (s, kind, p = {}) =>
  s.command({ type: "master", kind, name: "Test " + kind, business: "FUEL", ...p });

const op = (id, day, readings = [], extra = {}) => ({
  id,
  businessDate: day,
  status: "OPEN",
  nozzleReadings: readings,
  expenses: [],
  cashDeposits: [],
  rates: { PETROL: 278, CNG: 215 },
  ...extra,
});

const reading = (nozzleId, shiftId, opening, closing, fuelType = "PETROL", meterOrder = 1) => {
  const rate = fuelType === "PETROL" ? 278 : 215;
  return {
    nozzleId,
    shiftId,
    fuelType,
    openingMeter: opening,
    closingMeter: closing,
    quantitySold: closing - opening,
    rate,
    salesAmount: Math.round((closing - opening) * rate * 100) / 100,
    closingAccepted: true,
    readingSequence: 1,
    meterOrder,
  };
};

test("first run seeds cash accounts, shifts and settings", () => {
  const s = fixture();
  try {
    const accounts = s.all("account");
    assert.ok(accounts.some((a) => a.id === "cash-FUEL" && a.type === "CASH"));
    assert.ok(accounts.some((a) => a.id === "cash-manager" && a.type === "CASH"));
    const shifts = s.all("shift").filter((x) => x.active);
    assert.ok(shifts.some((x) => x.id === "shift-a"));
    assert.ok(shifts.some((x) => x.id === "shift-b"));
    const settings = s.get("station", "settings");
    assert.equal(settings.name, "My Petrol Pump");
    assert.equal(settings.petrolRate, 278);
  } finally {
    s.close();
  }
});

test("fuel sale amount is (closing - opening) x rate", () => {
  const s = fixture();
  try {
    const pump = master(s, "pump");
    const nozzle = master(s, "nozzle", { pumpId: pump, fuel: "PETROL", opening: 1000 });
    const id = post(s, { kind: "FUEL_SALE", nozzle, shift: "shift-a", closing: 1010 });
    const row = s.db.prepare("SELECT amount,quantity FROM documents WHERE id=?").get(id);
    assert.equal(row.quantity, 10);
    assert.equal(row.amount, 10 * 278 * 100);
  } finally {
    s.close();
  }
});

test("customer credit raises the balance, repayment lowers it, overpayment is rejected", () => {
  const s = fixture();
  try {
    const customer = master(s, "customer", { name: "Ali" });
    assert.equal(s.customerBalance(customer), 0);
    post(s, { kind: "CREDIT", customer, amount: 5000 });
    assert.equal(s.customerBalance(customer), 500000);
    post(s, { kind: "PAYMENT", customer, amount: 2000 });
    assert.equal(s.customerBalance(customer), 300000);
    assert.throws(() => post(s, { kind: "PAYMENT", customer, amount: 3001 }), /exceeds/);
    assert.equal(s.customerBalance(customer), 300000);
  } finally {
    s.close();
  }
});

test("customer details are optional: name alone is enough", () => {
  const s = fixture();
  try {
    const id = master(s, "customer", { name: "Sara" });
    const saved = s.get(id, "customer");
    assert.equal(saved.name, "Sara");
    assert.equal(saved.business, "FUEL");
    const snap = s.snapshot({ from: "2026-01-01", to: "2026-01-31" });
    assert.ok(snap.masters.customer.some((c) => c.id === id));
  } finally {
    s.close();
  }
});

test("day close is blocked when total udhaar exceeds total fuel sales", () => {
  const s = fixture();
  try {
    const customer = master(s, "customer", { name: "Ali" });
    s.petrolStatePut({
      kind: "operation",
      item: op("op-1", "2026-01-10", [reading("n1", "shift-a", 1000, 1010)]),
    });
    // Sales Rs. 2,780. Credit of Rs. 3,000 is more than the day's sales.
    const creditId = post(s, { kind: "CREDIT", customer, amount: 3000 });
    assert.throws(
      () =>
        s.petrolStatePut({
          kind: "operation",
          item: op("op-1", "2026-01-10", [reading("n1", "shift-a", 1000, 1010)], { status: "CLOSED" }),
        }),
      /Day close blocked/,
    );
    // Reverse the credit and the day closes.
    s.command({ type: "reverse", document: creditId, reason: "Wrong customer" });
    s.petrolStatePut({
      kind: "operation",
      item: op("op-1", "2026-01-10", [reading("n1", "shift-a", 1000, 1010)], { status: "CLOSED" }),
    });
    const saved = JSON.parse(
      s.db.prepare("SELECT data FROM petrol_records WHERE kind='operation' AND id='op-1'").get().data,
    );
    assert.equal(saved.status, "CLOSED");
  } finally {
    s.close();
  }
});

test("expenses reduce cash and reversing one restores it", () => {
  const s = fixture();
  try {
    // Accepted reading posts the sale to counter cash: 10L x Rs. 278.
    s.petrolStatePut({
      kind: "operation",
      item: op("op-1", "2026-01-10", [reading("n1", "shift-a", 1000, 1010)]),
    });
    assert.equal(s.balance("cash-FUEL"), 278000);
    const expenseId = post(s, { kind: "EXPENSE", amount: 500, note: "Tea" });
    assert.equal(s.balance("cash-FUEL"), 228000);
    s.command({ type: "reverse", document: expenseId, reason: "Wrong amount" });
    assert.equal(s.balance("cash-FUEL"), 278000);
  } finally {
    s.close();
  }
});

test("closing a day locks writes; reopening allows them again", () => {
  const s = fixture();
  try {
    const pump = master(s, "pump");
    const nozzle = master(s, "nozzle", { pumpId: pump, fuel: "PETROL", opening: 1000 });
    // One reading per shift so the day has nothing missing.
    s.petrolStatePut({
      kind: "operation",
      item: op("op-1", "2026-01-10", [
        reading(nozzle, "shift-a", 1000, 1010, "PETROL", 1),
        reading(nozzle, "shift-b", 1010, 1020, "PETROL", 2),
      ]),
    });
    // Sales: 20L x Rs. 278 = Rs. 5,560. Counted cash matches, reason given
    // because no cash was collected yet.
    s.command({
      type: "close",
      business: "FUEL",
      day: "2026-01-10",
      account: "cash-FUEL",
      counted: 5560,
      reason: "Cash counted.",
    });
    assert.throws(() => post(s, { kind: "EXPENSE", amount: 100 }), /closed/i);
    assert.throws(
      () =>
        s.petrolStatePut({
          kind: "operation",
          item: op("op-1", "2026-01-10", [reading("n1", "shift-a", 1000, 1010)]),
        }),
      /closed/i,
    );
    s.command({ type: "reopen", business: "FUEL", day: "2026-01-10", reason: "Fix a reading." });
    post(s, { kind: "EXPENSE", amount: 100, note: "After reopen" });
    assert.equal(s.balance("cash-FUEL"), 556000 - 10000);
  } finally {
    s.close();
  }
});

test("rate change applies to new readings only; old readings keep their rate", () => {
  const s = fixture();
  try {
    const pump = master(s, "pump");
    const n1 = master(s, "nozzle", { pumpId: pump, fuel: "PETROL", opening: 1000 });
    const n2 = master(s, "nozzle", { pumpId: pump, fuel: "PETROL", opening: 2000 });
    const first = post(s, { kind: "FUEL_SALE", nozzle: n1, shift: "shift-a", closing: 1010 });
    assert.equal(s.db.prepare("SELECT amount FROM documents WHERE id=?").get(first).amount, 10 * 278 * 100);
    s.petrolRateChange({ petrolRate: 300, cngRate: 215, businessDate: "2026-01-10" });
    const second = post(s, {
      kind: "FUEL_SALE",
      nozzle: n2,
      shift: "shift-a",
      day: "2026-01-11",
      closing: 2010,
    });
    assert.equal(s.db.prepare("SELECT amount FROM documents WHERE id=?").get(second).amount, 10 * 300 * 100);
    // The first reading still shows the old rate.
    assert.equal(s.db.prepare("SELECT amount FROM documents WHERE id=?").get(first).amount, 10 * 278 * 100);
  } finally {
    s.close();
  }
});

test("invalid values and duplicate requests leave no partial postings", () => {
  const s = fixture();
  try {
    const countPostings = () => s.db.prepare("SELECT COUNT(*) n FROM postings").get().n;
    assert.equal(countPostings(), 0);
    assert.throws(() => post(s, { kind: "EXPENSE", amount: -5 }), /positive/);
    assert.throws(() => post(s, { kind: "EXPENSE", amount: 0 }), /positive/);
    assert.equal(countPostings(), 0);
    const id = randomUUID();
    s.command({ type: "post", id, day: "2026-01-10", business: "FUEL", account: "cash-FUEL", kind: "CREDIT", customer: master(s, "customer", { name: "Ali" }), amount: 100 });
    assert.throws(
      () => s.command({ type: "post", id, day: "2026-01-10", business: "FUEL", account: "cash-FUEL", kind: "CREDIT", customer: master(s, "customer", { name: "Sara" }), amount: 100 }),
      /already saved/,
    );
  } finally {
    s.close();
  }
});

test("snapshot returns customers with balances and day rows", () => {
  const s = fixture();
  try {
    const customer = master(s, "customer", { name: "Ali" });
    post(s, { kind: "CREDIT", customer, amount: 1000 });
    s.petrolStatePut({
      kind: "operation",
      item: op("op-1", "2026-01-10", [reading("n1", "shift-a", 1000, 1010)]),
    });
    const snap = s.snapshot({ from: "2026-01-01", to: "2026-01-31" });
    const ali = snap.masters.customer.find((c) => c.id === customer);
    assert.equal(ali.balance, 100000);
    assert.ok(snap.rows.some((r) => r.kind === "CREDIT"));
    assert.ok(snap.rows.some((r) => r.kind === "FUEL_SALE"));
    assert.equal(snap.summary.find((r) => r.kind === "CREDIT").amount, 100000);
    assert.equal(snap.stock.find((x) => x.fuel === "PETROL").quantity, -10);
  } finally {
    s.close();
  }
});

test("database survives reopening with balances intact", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuel-station-"));
  const file = path.join(dir, "test.sqlite");
  const first = new BusinessStore(file);
  const customer = master(first, "customer", { name: "Ali" });
  post(first, { kind: "CREDIT", customer, amount: 2500 });
  first.close();
  const second = new BusinessStore(file);
  try {
    assert.equal(second.customerBalance(customer), 250000);
    assert.equal(second.get(customer, "customer").name, "Ali");
  } finally {
    second.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
