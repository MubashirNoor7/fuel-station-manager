const { BusinessStore } = require("../electron/business-store.cjs");
const assert = require("node:assert");
const s = new BusinessStore(":memory:");
const op = (id, day, status = "OPEN") => ({ id, businessDate: day, cycleNumber: 1, startTime: "2026-10-01T00:00:00Z", status, rates: { PETROL: 1, CNG: 1 }, nozzleReadings: [], expenses: [], cashDeposits: [], totals: {}, });
const count = (k) => s.db.prepare("SELECT COUNT(*) n FROM petrol_records WHERE kind=?").get(k).n;
let r;
try {
  r = s.petrolStateBatch({ ops: [{ action: "put", kind: "station", item: { stationName: "S" } }, { action: "put", kind: "pump", item: { id: "p1", name: "Pump 1" } }] });
  assert.equal(r.saved, 2); console.log("1 ok: station+pump saved together");
  s.petrolStateBatch({ ops: [{ action: "put", kind: "pump", item: { id: "p1", name: "Pump 1" } }] });
  assert.equal(count("pump"), 1); console.log("2 ok: same id twice = still 1 pump");
  // atomic rollback: good pump + invalid record
  assert.throws(() => s.petrolStateBatch({ ops: [{ action: "put", kind: "pump", item: { id: "p2", name: "Pump 2" } }, { action: "put", kind: "pump", item: null }] }));
  assert.equal(count("pump"), 1); console.log("3 ok: failed batch rolled back (p2 NOT saved)");
  s.petrolStateBatch({ ops: [{ action: "put", kind: "operation", item: op("op-1", "2026-10-01") }] });
  assert.throws(() => s.petrolStateBatch({ ops: [{ action: "put", kind: "operation", item: op("op-2", "2026-10-01") }] }), /already exists/);
  assert.equal(count("operation"), 1); console.log("4 ok: second operation on same date rejected");
  s.petrolStateBatch({ ops: [{ action: "put", kind: "operation", item: op("op-1", "2026-10-01") }] });
  assert.equal(count("operation"), 1); console.log("5 ok: re-saving same op id updates, no duplicate");
  s.petrolStateBatch({ ops: [{ action: "put", kind: "operation", item: op("op-3", "2026-10-02") }] });
  assert.throws(() => s.petrolStateBatch({ ops: [{ action: "put", kind: "operation", item: op("op-3", "2026-10-01") }] }), /already exists/);
  console.log("6 ok: moving a day onto an existing date rejected");
  const loaded = s.petrolStateLoad(); assert.equal(loaded.operations.length, 2); console.log("7 ok: reload shows", loaded.operations.map(o=>o.businessDate).join(", "));
  console.log("ALL DB CHECKS PASSED");
} catch (e) { console.error("FAIL:", e.message); console.error(e.stack.split("\n").slice(0,4).join("\n")); process.exit(1); }
