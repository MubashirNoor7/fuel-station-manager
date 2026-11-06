const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { BusinessStore } = require('../electron/business-store.cjs');

function fixture(t) {
  // 01:00 in Pakistan on 14 October; UTC is still 13 October.
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-13T20:00:00Z') });
  const s = new BusinessStore(':memory:');
  t.after(() => s.close());
  s.petrolStatePut({ kind: 'station', item: { id: 'station', stationName: 'Test', rates: { PETROL: 100, CNG: 100 } } });
  return s;
}
const operation = (id, businessDate) => ({ id, businessDate, status: 'OPEN', nozzleReadings: [], expenses: [], cashDeposits: [], rates: { PETROL: 100, CNG: 100 } });

test('closeDay directly closes an existing future petrol day but rejects an unknown future day', t => {
  const s = fixture(t);
  t.mock.timers.setTime(Date.parse('2026-10-14T20:00:00Z'));
  const master = (kind, extra = {}) => s.command({ type: 'master', kind, name: 'Test ' + kind, business: 'FUEL', ...extra });
  const pump = master('pump');
  const nozzle = master('nozzle', { pumpId: pump, fuel: 'PETROL', opening: 0 });
  s.petrolStatePut({ kind: 'operation', item: operation('future-close', '2026-10-15') });
  for (const shift of ['shift-a', 'shift-b']) s.command({ type: 'post', id: randomUUID(), kind: 'FUEL_SALE', business: 'FUEL', day: '2026-10-15', account: 'cash-manager', nozzle, shift, closing: 1 });
  t.mock.timers.setTime(Date.parse('2026-10-13T20:00:00Z'));
  const close = { type: 'close', business: 'FUEL', day: '2026-10-15', account: 'cash-manager', counted: 0, reason: 'Cash not handed over; original date retained after clock correction.' };
  assert.throws(() => s.command({ ...close, day: '2026-10-16' }), /future/);
  assert.throws(() => s.command({ ...close, reason: '' }), /difference|shortage|excess/i);
  s.command(close);
  assert.ok(s.db.prepare("SELECT day FROM closed_days WHERE business='FUEL' AND day=?").get(close.day));
  assert.throws(() => s.command(close), /already closed/);
});

test('Rate changes default to Pakistan date at 01:00, not the UTC date', t => {
  const s = fixture(t);
  s.petrolRateChange({ petrolRate: 110, cngRate: 120 });
  const row = s.db.prepare("SELECT day,data FROM petrol_records WHERE kind='rateChange'").get();
  assert.equal(row.day, '2026-10-14');
  assert.equal(JSON.parse(row.data).businessDate, '2026-10-14');
  assert.throws(() => s.petrolRateChange({ petrolRate: 150, cngRate: 160, businessDate: '2026-10-15' }), /future/);
  const station = JSON.parse(s.db.prepare("SELECT data FROM petrol_records WHERE kind='station'").get().data);
  assert.equal(station.rates.PETROL, 110);
});

test('Petrol allows today and earlier open days but rejects future operations and stock', t => {
  const s = fixture(t);
  s.petrolStatePut({ kind: 'operation', item: operation('old', '2026-10-13') });
  s.petrolStatePut({ kind: 'operation', item: operation('today', '2026-10-14') });
  assert.throws(() => s.petrolStatePut({ kind: 'operation', item: operation('future', '2026-10-15') }), /future/);
  assert.throws(() => s.petrolStatePut({ kind: 'fuelStock', item: { id: 'future-stock', businessDate: '2026-10-15', fuelType: 'PETROL', openingStock: 0, supplyRecords: [] } }), /future/);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM petrol_records WHERE kind='operation'").get().n, 2);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM petrol_records WHERE kind='fuelStock'").get().n, 0);
});

test('Future-date rejection rolls back earlier writes in the same batch', t => {
  const s = fixture(t);
  assert.throws(() => s.petrolStateBatch({ ops: [
    { action: 'put', kind: 'operation', item: operation('today', '2026-10-14') },
    { action: 'put', kind: 'operation', item: operation('future', '2026-10-15') },
  ] }), /future/);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM petrol_records WHERE kind='operation'").get().n, 0);
});

test('Existing future-dated records remain editable and an open operation can close after clock correction', t => {
  const s = fixture(t);
  t.mock.timers.setTime(Date.parse('2026-10-14T20:00:00Z'));
  const op = operation('existing', '2026-10-15');
  const stock = { id: 'existing-stock', businessDate: '2026-10-15', fuelType: 'PETROL', openingStock: 0, supplyRecords: [] };
  s.petrolStatePut({ kind: 'operation', item: op });
  s.petrolStatePut({ kind: 'fuelStock', item: stock });

  t.mock.timers.setTime(Date.parse('2026-10-13T20:00:00Z'));
  s.petrolStatePut({ kind: 'operation', item: { ...op, closingNotes: 'Checked after clock correction' } });
  s.petrolStatePut({ kind: 'fuelStock', item: { ...stock, note: 'Checked after clock correction' } });
  for (const [kind, item] of [['operation', op], ['fuelStock', stock]]) {
    assert.throws(() => s.petrolStatePut({ kind, item: { ...item, businessDate: '2026-10-16' } }), /future/);
    assert.throws(() => s.petrolStatePut({ kind, item: { ...item, id: 'new-' + item.id } }), /future/);
  }
  s.petrolStatePut({ kind: 'operation', item: { ...op, status: 'CLOSED' } });
  const saved = JSON.parse(s.db.prepare("SELECT data FROM petrol_records WHERE kind='operation' AND id=?").get(op.id).data);
  assert.equal(saved.status, 'CLOSED');
  assert.equal(saved.businessDate, '2026-10-15');
  assert.throws(() => s.petrolStatePut({ kind: 'operation', item: { ...op, closingNotes: 'Unauthorized closed-day edit' } }), /closed/i);
});
