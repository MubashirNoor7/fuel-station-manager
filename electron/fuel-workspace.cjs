// Read-only fuel views. Money writes still use BusinessStore commands.
const round = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
function validDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "") || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)
    throw Error("Choose a valid date.");
  return value;
}
function rows(store, sql, ...args) {
  return store.db.prepare(sql).all(...args).map((r) => ({ ...r, data: JSON.parse(r.data) }));
}
function daily(store, day) {
  store.require("FUEL", "view");
  validDay(day);
  const records = rows(store, "SELECT * FROM documents WHERE business='FUEL' AND day=? AND reversed=0 AND kind!='REVERSAL' ORDER BY created,id", day);
  const amount = (kind) => records.filter((r) => kind.includes(r.kind)).reduce((n, r) => n + r.amount, 0);
  const readings = records.filter((r) => r.kind === "FUEL_SALE");
  const missing = [];
  const nozzles = store.all("nozzle").filter((n) => n.active && store.get(n.pumpId, "pump").active);
  const shifts = store.all("shift").filter((s) => s.active).sort((a, b) => a.order - b.order);
  if (!nozzles.length) missing.push("Add an active nozzle.");
  if (!shifts.length) missing.push("Add an active shift.");
  for (const n of nozzles) for (const s of shifts) {
    if (!readings.some((r) => r.link === n.id && r.data.shift === s.id)) {
      const preview = store.readingPreview({ nozzle: n.id, shift: s.id, day });
      missing.push(`${n.name} / ${s.name}: save closing reading.`);
    }
  }
  const closedRow = store.db.prepare("SELECT data FROM closed_days WHERE business='FUEL' AND day=?").get(day);
  const sales = amount(["FUEL_SALE"]), credit = amount(["CREDIT"]), received = amount(["COLLECTION"]);
  const expenses = amount(["EXPENSE"]);
  const collectedExpenses = records.filter((r) => r.kind === "EXPENSE").reduce((sum, r) =>
    sum + (r.data.collectedCashUsed != null ? Math.round(Number(r.data.collectedCashUsed) * 100)
      : r.data.account === "cash-manager" ? r.amount : 0), 0);
  const cashRemaining = received - collectedExpenses;
  return { day, station: store.get("station", "settings"), records, readings, missing,
    sales, credit, received, expenses, collectedExpenses, cashRemaining, expected: sales - credit - expenses,
    difference: cashRemaining - (sales - credit - expenses), bachat: sales - expenses,
    petrol: round(readings.filter((r) => r.data.fuel === "PETROL").reduce((n, r) => n + r.quantity, 0)),
    cng: round(readings.filter((r) => r.data.fuel === "CNG").reduce((n, r) => n + r.quantity, 0)),
    closed: closedRow ? JSON.parse(closedRow.data) : null };
}
function history(store, p) {
  store.require("FUEL", "view");
  const from = validDay(p.from), to = validDay(p.to);
  if (from > to) throw Error("Start date must be before end date.");
  const clauses = ["business='FUEL'", "day BETWEEN ? AND ?", "kind!='REVERSAL'"], args = [from, to];
  if (p.fuel) { clauses.push("json_extract(data,'$.fuel')=?"); args.push(p.fuel); }
  if (p.shift) { clauses.push("json_extract(data,'$.shift')=?"); args.push(p.shift); }
  if (p.search) {
    clauses.push("(instr(lower(data),lower(?))>0 OR instr(day,?)>0)");
    args.push(String(p.search).slice(0, 200), String(p.search).slice(0, 200));
  }
  const where = clauses.join(" AND ");
  const page = Math.max(0, Math.floor(Number(p.page) || 0));
  const sums = store.db.prepare(`SELECT kind,SUM(amount) amount,SUM(quantity) quantity,json_extract(data,'$.fuel') fuel FROM documents WHERE ${where} AND reversed=0 GROUP BY kind,json_extract(data,'$.fuel')`).all(...args);
  const total = store.db.prepare(`SELECT COUNT(*) n FROM documents WHERE ${where}`).get(...args).n;
  return { from, to, page, total, sums, rows: rows(store, `SELECT * FROM documents WHERE ${where} ORDER BY day DESC,created DESC,id DESC${p.all ? "" : " LIMIT 50 OFFSET ?"}`, ...args, ...(p.all ? [] : [page * 50])) };
}
function stock(store, p) {
  store.require("FUEL", "view");
  const from = validDay(p.from), to = validDay(p.to), fuel = p.fuel === "CNG" ? "CNG" : "PETROL";
  if (from > to) throw Error("Start date must be before end date.");
  const opening = store.db.prepare("SELECT COALESCE(SUM(CASE WHEN kind='SUPPLY' THEN quantity WHEN kind='FUEL_SALE' THEN -quantity ELSE 0 END),0) n FROM documents WHERE business='FUEL' AND reversed=0 AND day<? AND json_extract(data,'$.fuel')=?").get(from, fuel).n;
  const movements = store.db.prepare("SELECT day, SUM(CASE WHEN kind='SUPPLY' THEN quantity ELSE 0 END) received, SUM(CASE WHEN kind='FUEL_SALE' THEN quantity ELSE 0 END) sold FROM documents WHERE business='FUEL' AND reversed=0 AND day BETWEEN ? AND ? AND json_extract(data,'$.fuel')=? AND kind IN ('SUPPLY','FUEL_SALE','STOCK_CHECK') GROUP BY day ORDER BY day").all(from, to, fuel);
  const checks = rows(store, "SELECT * FROM documents WHERE business='FUEL' AND reversed=0 AND day BETWEEN ? AND ? AND kind='STOCK_CHECK' AND json_extract(data,'$.fuel')=? ORDER BY created,id", from, to, fuel);
  const physical = new Map(checks.map((r) => [r.day, r.quantity]));
  let balance = round(opening);
  const days = movements.map((r) => {
    const start = balance;
    balance = round(balance + r.received - r.sold);
    const checked = physical.get(r.day);
    return { ...r, received: round(r.received), sold: round(r.sold), opening: start, remaining: balance,
      physical: checked ?? null, difference: checked == null ? null : round(checked - balance) };
  }).reverse();
  const page = Math.max(0, Math.floor(Number(p.page) || 0));
  const receiptArgs = [from, to, fuel];
  const search = p.search ? " AND instr(lower(data),lower(?))>0" : "";
  if (p.search) receiptArgs.push(String(p.search).slice(0, 200));
  const receiptWhere = "business='FUEL' AND reversed=0 AND day BETWEEN ? AND ? AND kind='SUPPLY' AND json_extract(data,'$.fuel')=?" + search;
  return { fuel, opening: round(opening), remaining: balance, total: days.length, page,
    received: round(movements.reduce((n, r) => n + r.received, 0)), sold: round(movements.reduce((n, r) => n + r.sold, 0)),
    soldSinceStart: round(store.db.prepare("SELECT COALESCE(SUM(quantity),0) n FROM documents WHERE business='FUEL' AND reversed=0 AND day<=? AND kind='FUEL_SALE' AND json_extract(data,'$.fuel')=?").get(to, fuel).n),
    days: p.all ? days : days.slice(page * 50, page * 50 + 50),
    receiptTotal: store.db.prepare(`SELECT COUNT(*) n FROM documents WHERE ${receiptWhere}`).get(...receiptArgs).n,
    receipts: rows(store, `SELECT * FROM documents WHERE ${receiptWhere} ORDER BY day DESC,created DESC,id DESC${p.all ? "" : " LIMIT 50 OFFSET ?"}`, ...receiptArgs, ...(p.all ? [] : [page * 50])) };
}
function dependencies(store, id) {
  store.require("FUEL", "correct");
  const row = store.db.prepare("SELECT * FROM documents WHERE id=? AND business='FUEL'").get(id);
  if (!row) throw Error("Entry was not found.");
  const data = JSON.parse(row.data);
  const blockers = [];
  if (store.db.prepare("SELECT day FROM closed_days WHERE business='FUEL' AND day=?").get(row.day)) blockers.push("Ask the owner to reopen this day.");
  if (row.kind === "FUEL_SALE") {
    const credits = store.db.prepare("SELECT day,amount FROM documents WHERE kind='CREDIT' AND link=? AND reversed=0").all(id);
    if (credits.length) blockers.push(`Correct ${credits.length} linked customer credit entries first.`);
    const later = rows(store, "SELECT * FROM documents WHERE kind='FUEL_SALE' AND link=? AND reversed=0 AND (day>? OR (day=? AND json_extract(data,'$.shiftOrder')>?)) ORDER BY day DESC,created DESC", row.link, row.day, row.day, data.shiftOrder);
    blockers.push(...later.map((r) => `Correct ${r.day} / ${r.data.shiftName} first.`));
  }
  if (row.reversed) blockers.push("This entry has already been cancelled.");
  return { row: { ...row, data }, blockers };
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (n) => `Rs. ${(Number(n || 0) / 100).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function table(headers, entries) {
  return `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${entries.map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}
function dailyHtml(d) {
  const entries = (kinds) => d.records.filter((r) => kinds.includes(r.kind));
  return `<!doctype html><html><head><meta charset="utf-8"><title>FuelStation Manager — Daily Report</title><style>body{font:13px Arial;color:#172c32;margin:25px}h1,h2{margin-bottom:8px}table{width:100%;border-collapse:collapse;margin:15px 0}th,td{border:1px solid #aaa;padding:6px;text-align:left}thead{display:table-header-group}tr{break-inside:avoid}.sign{display:flex;justify-content:space-between;margin-top:55px}@page{size:A4 landscape;margin:12mm}</style></head><body>
    <h1>${esc(d.station.name)}</h1><p>${esc(d.station.address)} · ${esc(d.station.phone)} · Manager: ${esc(d.station.managerName)}</p><h2>Daily Report - ${esc(d.day)}</h2><p>${d.closed ? "Closed" : "Open - totals may change"}</p>
    ${table(["Pump / nozzle", "Shift", "Operator", "Fuel", "Opening", "Closing", "Quantity", "Rate", "Sale", "Note"], d.readings.map((r) => [r.data.pumpName + " / " + r.data.nozzleName, r.data.shiftName, r.data.staffName, r.data.fuel, r.data.opening, r.data.closing, r.quantity, r.data.rate, money(r.amount), r.data.openingReason || r.data.note]))}
    ${table(["Total sales", "Fuel on credit", "Cash expected", "Cash received", "Expenses from received cash", "Cash remaining", "Difference", "Expenses", "Sales less expenses"], [[money(d.sales), money(d.credit), money(d.expected), money(d.received), money(d.collectedExpenses), money(d.cashRemaining), money(d.difference), money(d.expenses), money(d.bachat)]])}
    <p>Petrol: ${d.petrol} L · CNG: ${d.cng} kg. Sales less expenses is not final profit. Positive collection difference means extra cash; negative means short.</p>
    <h2>Expenses</h2>${table(["Type", "Operator", "Category", "Description", "Amount"], entries(["EXPENSE"]).map((r) => ["Expense", r.data.staffName, r.data.categoryName, r.data.note, money(r.amount)]))}
    <h2>Cash deposits</h2>${table(["Operator", "Account", "Time", "Note", "Amount"], entries(["COLLECTION"]).map((r) => [r.data.staffName, r.data.accountName, r.created, r.data.note, money(r.amount)]))}
    ${d.closed && !d.closed.imported ? `<h2>Cash count</h2>${table(["Expected in account", "Counted", "Difference", "Reason"], [[money(d.closed.expected),money(d.closed.actual),money(d.closed.variance),d.closed.reason]])}` : ""}
    ${d.closed?.imported ? `<p>Imported old day. Original actual collection: ${esc(d.closed.actual)} rupees. ${esc(d.closed.notes)}</p>` : ""}
    <div class="sign"><span>Prepared by: __________________</span><span>Checked by: __________________</span></div></body></html>`;
}
module.exports = { daily, history, stock, dependencies, dailyHtml, validDay, table, esc };
