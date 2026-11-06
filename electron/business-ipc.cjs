const { ipcMain, dialog, app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { BusinessStore } = require("./business-store.cjs");

function installBusinessIpc(getWindow) {
  const directory = path.join(app.getPath("userData"), "business-data");
  fs.mkdirSync(directory, { recursive: true });
  const store = new BusinessStore(path.join(directory, "business.sqlite"));

  ipcMain.handle("business:request", async (event, p) => {
    try {
      if (
        event.sender !== getWindow()?.webContents ||
        event.senderFrame !== event.sender.mainFrame
      )
        throw new Error("Untrusted request.");
      if (!p || typeof p !== "object") throw new Error("Invalid request.");
      let data;
      switch (p.type) {
        case "status":
          data = { user: store.user() };
          break;
        case "snapshot":
          data = store.snapshot(p);
          break;
        case "fuelView":
        case "fuelExport":
        case "fuelDraft":
          data = await require("./fuel-ipc.cjs").handleFuelRequest(store, p, getWindow());
          break;
        case "petrolStateLoad":
          data = store.petrolStateLoad();
          break;
        case "petrolStatePut":
          data = store.petrolStatePut(p);
          break;
        case "petrolStateDelete":
          data = store.petrolStateDelete(p);
          break;
        case "petrolRateChange":
          data = store.petrolRateChange(p);
          break;
        case "addUdhaar":
          data = store.addUdhaar(p);
          break;
        case "getUdhaarTotal":
          data = store.getUdhaarTotal(p);
          break;
        case "petrolStateBatch":
          data = store.petrolStateBatch(p);
          break;
        case "petrolStateImport":
          data = store.petrolStateImport(p);
          break;
        case "exportLogs": {
          const result = await dialog.showSaveDialog(getWindow(), {
            title: "Save activity logs",
            defaultPath: `Activity-logs-${Date.now()}.txt`,
            filters: [{ name: "Text file", extensions: ["txt"] }],
          });
          if (result.canceled || !result.filePath) { data = null; break; }
          const file = fs.openSync(result.filePath, "w", 0o600);
          try {
            fs.writeSync(file, "Activity logs\nTimes are shown in Pakistan time.\n\n");
            for (const row of store.db.prepare("SELECT * FROM audit ORDER BY created,id").iterate()) {
              const time = new Date(row.created).toLocaleString("en-GB", { timeZone: "Asia/Karachi" });
              const action = String(row.action).replaceAll("_", " ").toLowerCase();
              fs.writeSync(file, `${time} | ${row.actor || "Owner"} | ${action}\nDetails: ${row.data}\n\n`);
            }
          } finally {
            fs.closeSync(file);
          }
          data = "Logs saved. Open the text file to view activity.";
          break;
        }
        case "report": {
          const report = store.report(p);
          if (p.format === "csv") {
            const result = await dialog.showSaveDialog(getWindow(), {
              title: "Export complete report",
              defaultPath: `Business-report-${report.from}-${report.to}.csv`,
              filters: [{ name: "CSV", extensions: ["csv"] }],
            });
            if (result.canceled) return { ok: true, data: null };
            const csv = (value) =>
              `"${String(value ?? "")
                .replace(/^[=+\-@\t\r]/, (c) => `'${c}`)
                .replaceAll('"', '""')}"`;
            const rows = [
              [
                "Date",
                "Type",
                "Amount Rs.",
                "Note",
                "Customer / operator",
                "Account",
                "State",
                "Record ID",
                "Recorded at",
                "Pump",
                "Nozzle",
                "Shift",
                "Opening reading",
                "Closing reading",
                "Fuel quantity",
                "Rate Rs.",
              ],
              ...report.rows.map((r) => [
                r.day,
                r.kind,
                (r.amount / 100).toFixed(2),
                r.data.note,
                r.data.customerName || r.data.staffName,
                r.data.accountName || r.data.account,
                r.reversed ? "Reversed" : "Recorded",
                r.id,
                r.created,
                r.data.pumpName,
                r.data.nozzleName,
                r.data.shiftName,
                r.data.opening,
                r.data.closing,
                r.data.quantity,
                r.data.rate,
              ]),
            ];
            fs.writeFileSync(
              result.filePath,
              "\uFEFF" + rows.map((row) => row.map(csv).join(",")).join("\r\n"),
              { encoding: "utf8", flag: "wx" },
            );
            data = "Complete date-range report exported.";
          } else {
            const escape = (value) =>
              String(value ?? "").replace(
                /[&<>"']/g,
                (c) =>
                  ({
                    "&": "&amp;",
                    "<": "&lt;",
                    ">": "&gt;",
                    '"': "&quot;",
                    "'": "&#39;",
                  })[c],
              );
            let balance = report.opening || 0;
            const html = `<!doctype html><html><head><meta charset="utf-8"><title>Business statement</title><style>body{font:12px Arial;color:#172c32}h1{font-size:20px}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #ccc;text-align:left}thead{display:table-header-group}tr{break-inside:avoid}small{color:#666}</style></head><body><h1>${escape(report.station)}</h1><h2>${escape(report.customer?.name || "Business transactions")}</h2><p>${escape(report.from)} to ${escape(report.to)}</p>${report.customer ? `<p>Opening balance: Rs. ${(report.opening / 100).toFixed(2)}</p>` : ""}<table><thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Rs.</th><th>${report.customer ? "Balance Rs." : "State"}</th></tr></thead><tbody>${report.rows
              .map((r) => {
                const meterDetails =
                  r.kind === "FUEL_SALE"
                    ? `<br><small>${escape(r.data.pumpName)} / ${escape(r.data.nozzleName)} · ${escape(r.data.shiftName)}<br>Opening: ${escape(r.data.opening)} · Closing: ${escape(r.data.closing)}<br>Fuel sold: ${escape(r.data.quantity)} ${r.data.fuel === "CNG" ? "kg" : "L"} · Rate: Rs. ${escape(r.data.rate)}</small>`
                    : "";
                if (!r.reversed)
                  balance +=
                    r.kind === "CREDIT"
                      ? r.amount
                      : r.kind === "PAYMENT"
                        ? -r.amount
                        : 0;
                return `<tr><td>${escape(r.day)}</td><td>${escape(r.kind)}</td><td>${escape(r.data.note)}${meterDetails}<br><small>${escape(r.data.staffName || r.data.customerName || "")}${r.reversed ? " (Reversed)" : ""}</small></td><td>${(r.amount / 100).toFixed(2)}</td><td>${report.customer ? (balance / 100).toFixed(2) : r.reversed ? "Reversed" : "Recorded"}</td></tr>`;
              })
              .join(
                "",
              )}</tbody></table><p>All ${report.rows.length} records in the selected range.</p></body></html>`;
            const printWindow = new BrowserWindow({
              show: false,
              webPreferences: {
                sandbox: true,
                contextIsolation: true,
                nodeIntegration: false,
              },
            });
            await printWindow.loadURL(
              `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
            );
            await new Promise((resolve, reject) =>
              printWindow.webContents.print(
                { silent: false, printBackground: true },
                (ok, reason) => {
                  printWindow.close();
                  if (ok || reason === "cancelled") resolve();
                  else
                    reject(new Error(reason || "Printing was not completed."));
                },
              ),
            );
            data = "Print dialog completed.";
          }
          store.audit("REPORT", {
            from: report.from,
            to: report.to,
            records: report.rows.length,
            format: p.format,
          });
          break;
        }
        default:
          data = store.command(p);
      }
      return { ok: true, data };
    } catch (e) {
      return {
        ok: false,
        error: e.message || "The operation could not be saved.",
      };
    }
  });
  return store;
}
module.exports = { installBusinessIpc };
