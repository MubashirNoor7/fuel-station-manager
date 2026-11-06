const fs = require("node:fs");
const { dialog, BrowserWindow } = require("electron");
const fuel = require("./fuel-workspace.cjs");
const { toCsv } = require("./csv.cjs");
async function handleFuelRequest(store, p, window) {
  if (p.type === "fuelDraft") {
    const prefix = `fuel-draft:owner:`;
    if (p.action === "list") {
      const saved = store.db.prepare("SELECT key,value FROM meta WHERE key LIKE ?").all(prefix + "%");
      const drafts = [];
      const accepted = store.db.prepare("SELECT id FROM documents WHERE kind='FUEL_SALE' AND reversed=0 AND link=? AND day=? AND json_extract(data,'$.shift')=?");
      const remove = store.db.prepare("DELETE FROM meta WHERE key=?");
      for (const row of saved) {
        const draft = JSON.parse(row.value);
        if (accepted.get(draft.nozzle, draft.day, draft.shift)) remove.run(row.key);
        else drafts.push(draft);
      }
      return drafts.sort((a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")));
    }
    fuel.validDay(p.day);
    store.get(p.nozzle, "nozzle"); store.get(p.shift, "shift");
    const key = `${prefix}${p.day}:${p.nozzle}:${p.shift}`;
    if (p.action === "delete" || store.readingPreview(p).accepted) {
      store.db.prepare("DELETE FROM meta WHERE key=?").run(key); return null;
    }
    if (p.action !== "save") throw Error("Choose a draft action.");
    const draft = { day: p.day, nozzle: p.nozzle, shift: p.shift, closing: String(p.closing ?? "").slice(0, 40),
      note: String(p.note || "").slice(0, 1000), openingOverride: String(p.openingOverride ?? "").slice(0, 40),
      openingReason: String(p.openingReason || "").slice(0, 1000), savedAt: new Date().toISOString() };
    store.db.prepare("INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, JSON.stringify(draft));
    return draft;
  }
  if (p.type === "fuelView") {
    if (p.view === "daily") return fuel.daily(store, p.day);
    if (p.view === "stock") return fuel.stock(store, p);
    if (p.view === "history") return fuel.history(store, p);
    if (p.view === "correction") return fuel.dependencies(store, p.document);
    throw Error("Choose a petrol pump page.");
  }
  let headers, entries, html;
  if (p.view === "daily") {
    const d = fuel.daily(store, p.day);
    html = fuel.dailyHtml(d);
    headers = ["Date", "Pump", "Nozzle", "Shift", "Operator", "Fuel", "Opening", "Closing", "Quantity", "Rate Rs", "Sale Rs", "Opening change reason"];
    entries = d.readings.map((r) => [r.day, r.data.pumpName, r.data.nozzleName, r.data.shiftName, r.data.staffName, r.data.fuel, r.data.opening, r.data.closing, r.quantity, r.data.rate, r.amount / 100, r.data.openingReason]);
    entries.push([], ["Total sales Rs", d.sales / 100], ["Credit Rs", d.credit / 100], ["Cash expected Rs", d.expected / 100], ["Cash received Rs", d.received / 100], ["Expenses from received cash Rs", d.collectedExpenses / 100], ["Cash remaining Rs", d.cashRemaining / 100], ["Collection difference Rs", d.difference / 100], ["Expenses Rs", d.expenses / 100], [], ["Other entries", "Type", "Operator", "From account", "To account", "Note", "Amount Rs"]);
    entries.push(...d.records.filter((r) => r.kind !== "FUEL_SALE").map((r) => [r.day, r.kind, r.data.staffName, r.data.accountName, r.data.toName, r.data.note, r.amount / 100]));
  } else if (p.view === "stock") {
    const d = fuel.stock(store, { ...p, all: true });
    headers = ["Date", "Fuel", "Opening", "Received", "Sold", "Remaining", "Physical check", "Difference"];
    entries = d.days.map((r) => [r.day, d.fuel, r.opening, r.received, r.sold, r.remaining, r.physical, r.difference]);
  } else if (p.view === "history") {
    const d = fuel.history(store, { ...p, all: true });
    headers = ["Date", "Type", "Operator / customer", "Nozzle", "Shift", "Fuel", "Opening", "Closing", "Quantity", "Rate Rs", "Amount Rs", "Category", "From account", "To account", "Note", "State"];
    entries = d.rows.map((r) => [r.day, r.kind, r.data.staffName || r.data.customerName, r.data.nozzleName, r.data.shiftName, r.data.fuel, r.data.opening, r.data.closing, r.quantity, r.data.rate, r.amount / 100, r.data.categoryName, r.data.accountName, r.data.toName, r.data.note, r.reversed ? "Cancelled" : "Saved"]);
  } else throw Error("Choose a report.");
  if (p.format === "csv") {
    const choice = await dialog.showSaveDialog(window, { title: "Save report", defaultPath: `FuelStation-${p.view}-${p.day || p.to}.csv`, filters: [{ name: "CSV", extensions: ["csv"] }] });
    if (choice.canceled) return null;
    fs.writeFileSync(choice.filePath, toCsv([headers, ...entries]), "utf8");
    return "Report saved.";
  }
  if (p.format !== "print") throw Error("Choose Print or CSV.");
  if (!html) html = `<!doctype html><html><head><meta charset="utf-8"><title>FuelStation Manager Report</title><style>body{font:12px Arial}table{border-collapse:collapse;width:100%}th,td{border:1px solid #aaa;padding:6px}thead{display:table-header-group}tr{break-inside:avoid}@page{size:A4 landscape}</style></head><body><h1>${fuel.esc(store.get("station", "settings").name)}</h1><p>${fuel.esc(p.from)} to ${fuel.esc(p.to)}</p>${fuel.table(headers, entries)}</body></html>`;
  const printWindow = new BrowserWindow({ show: false, parent: window, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  try {
    await printWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    return await new Promise((resolve, reject) => printWindow.webContents.print({ silent: false, printBackground: true }, (ok, reason) => ok ? resolve("Report sent to printer.") : reject(Error(reason || "Printing was cancelled."))));
  } finally { if (!printWindow.isDestroyed()) printWindow.close(); }
}
module.exports = { handleFuelRequest };
