// Protect confirmed readings and cash from stale whole-day drafts.
function keyed(readings = []) {
  const counters = new Map();
  return readings.map(r => {
    const group = JSON.stringify([r.nozzleId, r.shiftId || 'default-shift']);
    const seq = r.readingSequence > 0 ? r.readingSequence : (counters.get(group) || 0) + 1;
    counters.set(group, Math.max(seq, counters.get(group) || 0));
    return [r.readingId || `legacy:${JSON.stringify([r.nozzleId, r.shiftId || 'default-shift', seq])}`, r];
  });
}

function validateReadingLedger(previous, next) {
  const entries = keyed(next.nozzleReadings);
  const readings = new Map(entries);
  if (entries.length !== readings.size) throw Error('Duplicate reading ID. Reload the day before saving.');
  // v87 Defect 4: Derive sales and quantity from meters and rate. Never trust
  // client-supplied salesAmount/quantitySold - normalize them here so the
  // stored operation always has meter-consistent values.
  for (const [, reading] of readings) {
    if (!reading.closingAccepted) continue;
    const opening = Number(reading.openingMeter);
    const closing = Number(reading.closingMeter);
    const rate = Number(reading.rate);
    if (Number.isFinite(opening) && Number.isFinite(closing) && closing > opening && Number.isFinite(rate) && rate > 0) {
      const qty = Math.round((closing - opening) * 1000) / 1000;
      reading.quantitySold = qty;
      reading.salesAmount = Math.round(qty * rate * 100) / 100;
    }
  }
  // v86 Bug 3: A newly accepted reading must have a positive rate - never record a Rs. 0 sale.
  // Already-accepted (historical) readings are left untouched.
  const prevAccepted = new Set();
  for (const [id, old] of keyed(previous?.nozzleReadings)) {
    if (old.closingAccepted) prevAccepted.add(id);
  }
  for (const [id, reading] of readings) {
    if (reading.closingAccepted && !prevAccepted.has(id)) {
      if (!Number.isFinite(Number(reading.rate)) || Number(reading.rate) <= 0) {
        throw Error('Set fuel rates before saving readings (rate is zero).');
      }
    }
  }
  const previousReadings = new Map(keyed(previous?.nozzleReadings));
  for (const [id, reading] of entries) {
    if (!reading.closingAccepted) continue;
    const old = previousReadings.get(id);
    const isNewOrChanged = !old?.closingAccepted || old.openingMeter !== reading.openingMeter || old.closingMeter !== reading.closingMeter;
    // Existing zero-sale historical records remain intact; new acceptances and
    // meter corrections must satisfy the current strictly-increasing rule.
    if (isNewOrChanged && (!Number.isFinite(reading.openingMeter) || !Number.isFinite(reading.closingMeter) || reading.closingMeter <= reading.openingMeter)) {
      throw Error('Closing meter must be greater than the opening meter.');
    }
  }
  for (const [id, old] of keyed(previous?.nozzleReadings)) {
    if (!old.closingAccepted) continue;
    const current = readings.get(id);
    if (!current?.closingAccepted) throw Error('Saved readings cannot be unlocked or removed. Reload the day and use a correction.');
    for (const key of ['nozzleId', 'pumpId', 'employeeId', 'fuelType', 'openingMeter', 'rate', 'pumpNameSnapshot', 'nozzleNameSnapshot', 'employeeNameSnapshot']) {
      if (current[key] !== old[key]) throw Error('Saved reading details have changed. Reload the day; use a correction for the closing meter.');
    }
    const history = old.corrections || [], incoming = current.corrections || [];
    if (JSON.stringify(incoming.slice(0, history.length)) !== JSON.stringify(history)) throw Error('A newer correction is already saved. Reload the day.');
    const changed = current.closingMeter !== old.closingMeter || current.salesAmount !== old.salesAmount || current.quantitySold !== old.quantitySold;
    if (changed) {
      const correction = incoming[history.length];
      if (incoming.length !== history.length + 1 || !correction?.reason?.trim() || !correction.at || correction.previousClosing !== old.closingMeter || correction.previousAmount !== old.salesAmount || correction.closing !== current.closingMeter || correction.amount !== current.salesAmount) throw Error('A saved reading correction requires its previous values and a reason. Reload the day if it changed.');
    } else if (incoming.length !== history.length) {
      // A same-value correction is allowed but must still document the real prior values.
      const correction = incoming[history.length];
      if (incoming.length !== history.length + 1 || !correction?.reason?.trim() || correction.previousClosing !== old.closingMeter || correction.closing !== current.closingMeter || correction.previousAmount !== old.salesAmount || correction.amount !== current.salesAmount) throw Error('Invalid reading correction history.');
    }
  }
  const deposits = new Map((next.cashDeposits || []).map(d => [d.id, d]));
  if (deposits.size !== (next.cashDeposits || []).length) throw Error('Duplicate cash receipt.');
  for (const old of previous?.cashDeposits || []) {
    if (JSON.stringify(deposits.get(old.id)) !== JSON.stringify(old)) throw Error('Saved cash receipts cannot be replaced or removed by a draft. Reload the day.');
  }
  const oldDepositIds = new Set((previous?.cashDeposits || []).map(d => d.id));
  for (const deposit of next.cashDeposits || []) {
    if (oldDepositIds.has(deposit.id)) continue;
    if (!Number.isFinite(deposit.amount) || deposit.amount <= 0) throw Error('Enter a positive cash amount.');
    // v82: New cash receipts must link to a valid saved reading. Old unlinked
    // (legacy nozzle-level) cash already saved stays untouched, but no new
    // unlinked cash can be created - it would bypass the per-reading sale limit.
    const reading = readings.get(deposit.readingId);
    if (!deposit.readingId || !reading?.closingAccepted || reading.nozzleId !== deposit.nozzleId || reading.fuelType !== deposit.fuelType) throw Error('Cash must reference the selected saved reading.');
  }
  // v83: Only NEW deposits can trigger the over-collection block. Old deposits
  // are immutable (guarded above), so a historical overpayment must not block
  // unrelated saves for the rest of the day. Adding more cash to an already
  // overpaid reading is still blocked.
  const oldReceivedByReading = new Map();
  for (const d of previous?.cashDeposits || []) {
    if (!d.readingId) continue;
    oldReceivedByReading.set(d.readingId, Math.round(((oldReceivedByReading.get(d.readingId) || 0) + Number(d.amount)) * 100) / 100);
  }
  const newReceivedByReading = new Map();
  for (const d of next.cashDeposits || []) {
    if (oldDepositIds.has(d.id)) continue;
    if (!d.readingId) continue;
    newReceivedByReading.set(d.readingId, Math.round(((newReceivedByReading.get(d.readingId) || 0) + Number(d.amount)) * 100) / 100);
  }
  for (const [rid, newTotal] of newReceivedByReading) {
    const reading = readings.get(rid);
    if (!reading) continue;
    const sale = Number(reading.salesAmount);
    const oldTotal = oldReceivedByReading.get(rid) || 0;
    if (Math.round((oldTotal + newTotal) * 100) > Math.round(sale * 100)) {
      throw Error(
        'Cash for ' + (reading.pumpNameSnapshot || 'Pump') + ' - ' + (reading.nozzleNameSnapshot || 'Nozzle') +
        ', Reading ' + (reading.readingSequence || '?') +
        ' would exceed its sale. Sale: Rs. ' + sale.toLocaleString('en-US') +
        ', already received: Rs. ' + oldTotal.toLocaleString('en-US') +
        ', adding now: Rs. ' + newTotal.toLocaleString('en-US') + '.'
      );
    }
  }
}
module.exports = { validateReadingLedger, keyed };
