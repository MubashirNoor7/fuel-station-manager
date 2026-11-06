// Extra date-safety checks. Uses only in-memory databases. Never touches live data.
// Run: node --test tests/date-safety-extra.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { BusinessStore } = require('../electron/business-store.cjs');

const ROOT = path.join(__dirname, '..');
// Fixed clock: 14 Oct 2026 01:00 Pakistan (13 Oct 20:00 UTC).
const AT_0100_PK = Date.parse('2026-10-13T20:00:00Z');

function fixture(t, now = AT_0100_PK) {
  t.mock.timers.enable({ apis: ['Date'], now });
  const s = new BusinessStore(':memory:');
  t.after(() => s.close());
  s.petrolStatePut({ kind: 'station', item: { id: 'station', stationName: 'Test', rates: { PETROL: 100, CNG: 100 } } });
  return s;
}
const operation = (id, businessDate, extra = {}) => ({
  id, businessDate, status: 'OPEN', nozzleReadings: [], expenses: [], cashDeposits: [],
  rates: { PETROL: 100, CNG: 100 }, ...extra,
});
const credit = (s, day) => {
  const customer = s.command({ type: 'master', kind: 'customer', name: 'Test customer', business: 'FUEL' });
  return s.command({ type: 'post', id: randomUUID(), kind: 'CREDIT', day, business: 'FUEL', customer, amount: 100 });
};
const closeCmd = (s, business, day) =>
  s.command({ type: 'close', business, day, account: 'cash-' + business, counted: 0, reason: 'test' });


// ---------- A. Close day ----------
test('A1 Close FUEL on a future day with no petrol record is blocked', t => {
  const s = fixture(t);
  assert.throws(() => closeCmd(s, 'FUEL', '2026-10-16'), /future day/i);
});

test('A2 Close FUEL on an existing future-dated petrol day is NOT blocked by the future check', t => {
  const s = fixture(t, Date.parse('2026-10-15T20:00:00Z')); // PC wrongly says 16 Oct in Pakistan
  s.petrolStatePut({ kind: 'operation', item: operation('wrong-clock-day', '2026-10-16') });
  t.mock.timers.setTime(AT_0100_PK); // clock corrected back to 14 Oct
  // Closing may still fail for other reasons (no nozzles etc). It must not fail with the future message.
  let message = '';
  try { closeCmd(s, 'FUEL', '2026-10-16'); } catch (e) { message = String(e.message); }
  assert.doesNotMatch(message, /future day/i, 'future-day check wrongly blocks an existing petrol day: ' + message);
  assert.match(message, /nozzle|shift|Before closing|reading/i, 'expected a later, unrelated error, got: ' + message);
});

// ---------- B. Midnight boundary (Pakistan is UTC+5, no daylight saving) ----------
test('B1 One second before Pakistan midnight is still the old day', t => {
  const s = fixture(t, Date.parse('2026-10-13T18:59:59Z')); // 23:59:59 on 13 Oct PK
  credit(s, '2026-10-13');
  assert.throws(() => credit(s, '2026-10-14'), /future/i);
});

test('B2 At Pakistan midnight the new day is accepted and the next day is not', t => {
  const s = fixture(t, Date.parse('2026-10-13T19:00:00Z')); // 00:00:00 on 14 Oct PK
  credit(s, '2026-10-14');
  assert.throws(() => credit(s, '2026-10-15'), /future/i);
});

test('B3 Month and year boundary: 01:00 PK on 1 Jan uses 1 Jan, not 31 Dec', t => {
  const s = fixture(t, Date.parse('2026-12-31T20:00:00Z')); // 01:00 on 1 Jan 2027 PK
  s.petrolRateChange({ petrolRate: 111, cngRate: 121 });
  const row = s.db.prepare("SELECT day FROM petrol_records WHERE kind='rateChange'").get();
  assert.equal(row.day, '2027-01-01');
});

// ---------- C. Every money path rejects future dates ----------
test('C1 Expense is rejected for a future date', t => {
  const s = fixture(t);
  assert.throws(() => s.command({ type: 'post', id: randomUUID(), kind: 'EXPENSE', day: '2026-10-15', business: 'FUEL', account: 'cash-FUEL', amount: 100 }), /future/i);
});

test('C2 Credit (udhaar) with a future date is rejected', t => {
  const s = fixture(t);
  assert.throws(() => s.addUdhaar({ day: '2026-10-15', amount: 100 }), /future/i);
});

test('C3 Petrol operation with real readings and an expense saves today, rejects tomorrow', t => {
  const s = fixture(t);
  const reading = { nozzleId: 'n1', shiftId: 's1', openingMeter: 0, closingMeter: 10, rate: 100, salesAmount: 1000, closingAccepted: true };
  const expense = { id: 'e1', amount: 50, description: 'x', category: 'x' };
  s.petrolStatePut({ kind: 'operation', item: operation('today', '2026-10-14', { nozzleReadings: [reading], expenses: [expense] }) });
  assert.throws(() => s.petrolStatePut({ kind: 'operation', item: operation('tomorrow', '2026-10-15', { nozzleReadings: [reading], expenses: [expense] }) }), /future/i);
});

test('C4 Existing future-dated operation WITH ledger postings stays editable after the clock is corrected', t => {
  const s = fixture(t, Date.parse('2026-10-14T20:00:00Z'));
  const reading = { nozzleId: 'n1', shiftId: 's1', openingMeter: 0, closingMeter: 10, rate: 100, salesAmount: 1000, closingAccepted: true };
  const op = operation('future-with-sales', '2026-10-15', { nozzleReadings: [reading], expenses: [{ id: 'e1', amount: 50, description: 'x', category: 'x' }] });
  s.petrolStatePut({ kind: 'operation', item: op });
  t.mock.timers.setTime(AT_0100_PK);
  s.petrolStatePut({ kind: 'operation', item: { ...op, closingNotes: 'edited after clock fix' } });
  const saved = JSON.parse(s.db.prepare("SELECT data FROM petrol_records WHERE kind='operation' AND id=?").get(op.id).data);
  assert.equal(saved.businessDate, '2026-10-15');
  assert.equal(saved.closingNotes, 'edited after clock fix');
});

test('C5 A batch with one future record writes nothing', t => {
  const s = fixture(t);
  assert.throws(() => s.petrolStateBatch({ ops: [
    { action: 'put', kind: 'operation', item: operation('a', '2026-10-14') },
    { action: 'put', kind: 'fuelStock', item: { id: 'b', businessDate: '2026-10-20', fuelType: 'PETROL', openingStock: 0, supplyRecords: [] } },
  ] }), /future/i);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM petrol_records WHERE kind IN ('operation','fuelStock')").get().n, 0);
});

// ---------- D. Rate change policy ----------
test('D1 Rate change for today is accepted and updates the station rate', t => {
  const s = fixture(t);
  s.petrolRateChange({ petrolRate: 130, cngRate: 140, businessDate: '2026-10-14' });
  const station = JSON.parse(s.db.prepare("SELECT data FROM petrol_records WHERE kind='station'").get().data);
  assert.equal(station.rates.PETROL, 130);
});

test('D2 POLICY: rate change for TOMORROW is rejected (matters on the 1st and 16th)', t => {
  // This documents current behaviour. If you decide to allow 1 day ahead, change this test.
  const s = fixture(t);
  assert.throws(() => s.petrolRateChange({ petrolRate: 130, cngRate: 140, businessDate: '2026-10-15' }), /future/i);
});

// Windows clock is the date source; no independent clock verification is enabled.
test('E1 first launch with no trusted history cannot identify an already-wrong clock', t => {
  const s = fixture(t, Date.parse('2026-10-16T20:00:00Z')); // PC says 17 Oct, real date is 14 Oct
  credit(s, '2026-10-17');
  const n = s.db.prepare("SELECT COUNT(*) n FROM documents WHERE day='2026-10-17'").get().n;
  assert.equal(n, 1, 'if this fails, forward-clock protection was added: update this test');
});

test('E2 documents backward clock behaviour on an otherwise open empty day', t => {
  const s = fixture(t);
  credit(s, '2026-10-14');
  t.mock.timers.setTime(Date.parse('2026-10-10T07:00:00Z')); // clock rolled back to 10 Oct
  credit(s, '2026-10-10');
  const n = s.db.prepare("SELECT COUNT(*) n FROM documents WHERE day='2026-10-10'").get().n;
  assert.equal(n, 1, 'Windows clock remains the date source.');
});

// ---------- F. Static source checks (frontend and electron, no .bak files) ----------
function sourceFiles(dir, out = []) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, name.name);
    if (name.isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx|cjs)$/.test(name.name)) out.push(full);
  }
  return out;
}

test('F1 No source file computes "today" from UTC', () => {
  const bad = /new Date\(\)\s*\.toISOString\(\)\s*\.(slice\(\s*0\s*,\s*10\s*\)|split\(\s*['"]T['"]\s*\)\s*\[\s*0\s*\])/;
  const hits = [];
  for (const dir of ['src', 'electron']) {
    for (const file of sourceFiles(path.join(ROOT, dir))) {
      const text = fs.readFileSync(file, 'utf8');
      text.split('\n').forEach((line, i) => { if (bad.test(line)) hits.push(`${path.relative(ROOT, file)}:${i + 1}`); });
    }
  }
  assert.deepEqual(hits, [], 'UTC date used as today at: ' + hits.join(', '));
});


test('F3 Backend has exactly one definition of today()', () => {
  const text = fs.readFileSync(path.join(ROOT, 'electron/business-store.cjs'), 'utf8');
  assert.equal((text.match(/^const today\s*=/gm) || []).length, 1);
  assert.match(text, /timeZone:\s*"Asia\/Karachi"/);
});
