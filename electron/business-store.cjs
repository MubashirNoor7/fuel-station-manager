/* Authoritative business commands. Only the Electron main process owns this store. */
const { DatabaseSync } = require("node:sqlite");
const { randomUUID, createHash } = require("node:crypto");

const BUSINESSES = ["FUEL"];
const fail = (message) => {
  throw new Error(message);
};
const text = (value, label, max = 200) => {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    fail(`${label} is required (maximum ${max} characters).`);
  return value.trim();
};
const money = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 1e10)
    fail("Enter a positive amount up to Rs. 10 billion.");
  const paisa = Math.round(n * 100);
  if (paisa < 1) fail("Amount must be at least Rs. 0.01.");
  return paisa;
};
const date = (value) => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value
  )
    fail("Enter a valid date.");
  return value;
};
const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(
    new Date(),
  );

class BusinessStore {
  constructor(filename) {

    this.db = new DatabaseSync(filename);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT OR IGNORE INTO meta VALUES ('schema','1');
      CREATE TABLE IF NOT EXISTS masters (id TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS masters_kind ON masters(kind);
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY, business TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL,
        amount INTEGER NOT NULL DEFAULT 0, quantity REAL NOT NULL DEFAULT 0,
        customer TEXT, link TEXT, data TEXT NOT NULL, actor TEXT NOT NULL, created TEXT NOT NULL,
        reversed INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS documents_business_day ON documents(business,day);
      CREATE INDEX IF NOT EXISTS documents_customer ON documents(customer,day);
      CREATE INDEX IF NOT EXISTS documents_link ON documents(link);
      CREATE TABLE IF NOT EXISTS postings (document TEXT NOT NULL REFERENCES documents(id), account TEXT NOT NULL, amount INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS postings_account ON postings(account);
      CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, created TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS closed_days (business TEXT NOT NULL, day TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(business,day));
      CREATE TABLE IF NOT EXISTS petrol_records (
        kind TEXT NOT NULL,
        id TEXT NOT NULL,
        day TEXT,
        data TEXT NOT NULL,
        updated TEXT NOT NULL,
        PRIMARY KEY(kind,id)
      );
      CREATE INDEX IF NOT EXISTS petrol_records_kind_day ON petrol_records(kind,day);`);
    if (
      this.db.prepare("SELECT value FROM meta WHERE key='schema'").get()
        .value !== "1"
    )
      fail("Unsupported database version.");

    this.seedDefaults();
  }
  // First run: create the records a fresh database needs — the counter
  // cash account, the two daily shifts and the station settings with the
  // current fuel rates. Runs once; existing databases are untouched.
  seedDefaults() {
    if (this.db.prepare("SELECT COUNT(*) n FROM masters").get().n) return;
    this.put("account", { id: "cash-FUEL", name: "Counter Cash", business: "FUEL", type: "CASH", active: true });
    this.put("account", { id: "cash-manager", name: "Manager Cash", business: "SHARED", type: "CASH", active: true });
    this.put("shift", { id: "shift-a", name: "Shift A", order: 1, active: true });
    this.put("shift", { id: "shift-b", name: "Shift B", order: 2, active: true });
    this.put("settings", { id: "station", name: "My Petrol Pump", petrolRate: 278, cngRate: 215 });
    // First-run station record for the fuel screens (rates, shifts). The
    // fuel screens read this record; without it a rate change on a fresh
    // install would fail with "station is not set up yet".
    this.db
      .prepare(
        `INSERT INTO petrol_records(kind,id,day,data,updated) VALUES('station','station','',?,?)`,
      )
      .run(
        JSON.stringify({
          id: "station",
          stationName: "My Petrol Pump",
          address: "",
          phone: "",
          managerName: "",
          currency: "Rs.",
          rates: { PETROL: 278, CNG: 215 },
          security: { isPinSet: false },
          shifts: [
            { id: "shift-a", name: "Shift A", order: 1, isActive: true },
            { id: "shift-b", name: "Shift B", order: 2, isActive: true },
          ],
          shiftAssignments: [],
        }),
        new Date().toISOString(),
      );
  }
  getMeta(key) {
    const row = this.db.prepare("SELECT value FROM meta WHERE key=?").get(key);
    return row ? row.value : null;
  }
  setMeta(key, value) {
    this.db
      .prepare("INSERT OR REPLACE INTO meta (key,value) VALUES (?,?)")
      .run(key, String(value));
  }
  deleteMeta(key) {
    this.db.prepare("DELETE FROM meta WHERE key=?").run(key);
  }
  all(kind) {
    return this.db
      .prepare("SELECT data FROM masters WHERE kind=?")
      .all(kind)
      .map((r) => JSON.parse(r.data));
  }
  get(id, kind) {
    const r = this.db
      .prepare("SELECT kind,data FROM masters WHERE id=?")
      .get(id || "");
    if (!r || (kind && r.kind !== kind))
      fail("Record was not found. Refresh and try again.");
    return JSON.parse(r.data);
  }
  put(kind, item) {
    this.db
      .prepare(
        "INSERT INTO masters VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(item.id, kind, JSON.stringify(item));
  }
  audit(action, data) {
    this.db
      .prepare("INSERT INTO audit VALUES (?,?,?,?,?)")
      .run(
        randomUUID(),
        "owner",
        action,
        new Date().toISOString(),
        JSON.stringify(data),
      );
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  // Single-user build: there is one owner and no login. The owner can do
  // everything, so these hooks always allow. They exist so every call site
  // keeps one consistent check.
  user() {
    return { id: "owner", name: "Owner", role: "OWNER" };
  }
  allowed() {
    return true;
  }
  require() {}
  admin() {}
  assertWritesAllowed() {}
  saveMaster(p) {
    const allowed = [
      "customer",
      "category",
      "pump",
      "nozzle",
      "shift",
      "settings",
    ];
    if (!allowed.includes(p.kind)) fail("Unknown record type.");
    const previous = p.id ? this.get(p.id, p.kind) : null;
    const item = {
      ...(previous || {}),
      id: previous?.id || randomUUID(),
      name: text(p.name, "Name"),
      active: p.active !== false,
    };
    if (p.kind === "shift") {
      item.order = Number(p.order);
      if (!Number.isInteger(item.order) || item.order < 1 || item.order > 20)
        fail("Shift order must be 1 to 20.");
      if (
        item.active &&
        this.all("shift").some(
          (s) => s.id !== item.id && s.active && s.order === item.order,
        )
      )
        fail("Active shifts must have different order numbers.");
      if (
        previous &&
        previous.order !== item.order &&
        this.db
          .prepare(
            "SELECT id FROM documents WHERE kind='FUEL_SALE' AND json_extract(data,'$.shift')=? LIMIT 1",
          )
          .get(item.id)
      )
        fail("The order of a shift with accepted readings cannot change.");
    } else if (p.kind === "settings") {
      if (!previous) fail("Edit the existing station settings.");
      item.petrolRate = money(p.petrolRate) / 100;
      item.cngRate = money(p.cngRate) / 100;
      for (const key of ["address", "phone", "managerName"])
        item[key] = String(p[key] ?? previous?.[key] ?? "").trim().slice(0, 300);
    } else {
      item.business = p.business;
      if (!BUSINESSES.includes(item.business)) fail("Select a business.");
      if (previous && previous.business !== item.business)
        fail("Create a new record to change its business.");
      item.note = String(p.note || "").slice(0, 500);
      if (p.kind === "customer") {
        for (const key of ["fatherName", "cnic", "address"])
          item[key] = String(p[key] ?? previous?.[key] ?? "").trim().slice(0, key === "cnic" ? 50 : 300);
        item.dueDay = Number(p.dueDay || 1);
        item.phone = String(p.phone || "").slice(0, 50);
        item.vehicle = String(p.vehicle || "").slice(0, 100);
        if (
          !Number.isInteger(item.dueDay) ||
          item.dueDay < 1 ||
          item.dueDay > 28
        )
          fail("Due day must be between 1 and 28 of the following month.");
      }
      if (p.kind === "nozzle") {
        const pump = this.get(p.pumpId, "pump");
        if (!pump.active) fail("Select an active pump.");
        item.business = "FUEL";
        item.pumpId = pump.id;
        item.fuel = p.fuel === "CNG" ? "CNG" : "PETROL";
        item.opening = Number(p.opening);
        if (!Number.isFinite(item.opening) || item.opening < 0)
          fail("Invalid opening meter.");
        item.assignments = {};
        if (
          previous &&
          this.db
            .prepare(
              "SELECT id FROM documents WHERE kind='FUEL_SALE' AND link=? LIMIT 1",
            )
            .get(item.id) &&
          (previous.opening !== item.opening ||
            previous.fuel !== item.fuel ||
            previous.pumpId !== item.pumpId)
        )
          fail("A used nozzle cannot change meter origin, fuel or pump.");
      }
    }
    this.put(p.kind, item);
    // Fuel-rate sync: the old "Station and fuel rates" screen saves to
    // masters (kind='settings'), but the active Petrol Pump flow (App.tsx)
    // reads station.rates from petrol_records (kind='station'). Without
    // this sync a rate change never reaches Daily Operation. Runs inside
    // the same transaction, so both save or neither does.
    if (p.kind === "settings") this.syncSettingsRatesToPetrolStation(item);
    this.audit("MASTER_SAVE", {
      kind: p.kind,
      before: previous ? this.safeMaster(p.kind, previous) : null,
      after: this.safeMaster(p.kind, item),
    });
    return item.id;
  }
  syncSettingsRatesToPetrolStation(settings) {
    const petrolRate = Number(settings.petrolRate);
    const cngRate = Number(settings.cngRate);
    if (!Number.isFinite(petrolRate) || petrolRate <= 0) return;
    if (!Number.isFinite(cngRate) || cngRate <= 0) return;
    const row = this.db
      .prepare("SELECT data FROM petrol_records WHERE kind='station' AND id='station'")
      .get();
    if (!row) return; // no petrol station yet; nothing to sync
    const station = JSON.parse(row.data);
    station.rates = { PETROL: petrolRate, CNG: cngRate };
    this.db
      .prepare(
        `INSERT INTO petrol_records(kind,id,day,data,updated) VALUES(?,?,?,?,?)
         ON CONFLICT(kind,id) DO UPDATE SET day=excluded.day,data=excluded.data,updated=excluded.updated`,
      )
      .run("station", "station", "", JSON.stringify(station), new Date().toISOString());
    this.audit("PETROL_RATE_SYNC", { petrolRate, cngRate });
  }
  safeMaster(kind, item) {
    return item;
  }
  accountOpeningBalances(account) {
    try {
      const master = this.get(account, "account");
      return master.openingBalances && typeof master.openingBalances === "object"
        ? master.openingBalances
        : {};
    } catch {
      return {};
    }
  }
  accountOpeningTotal(account) {
    return Object.values(this.accountOpeningBalances(account)).reduce(
      (sum, value) => sum + Number(value || 0),
      0,
    );
  }
  balance(account) {
    return (
      this.accountOpeningTotal(account) +
      Number(
        this.db
          .prepare(
            "SELECT COALESCE(SUM(amount),0) AS n FROM postings WHERE account=?",
          )
          .get(account).n,
      )
    );
  }
  balanceThrough(account, day) {
    return (
      this.accountOpeningTotal(account) +
      Number(
        this.db
          .prepare(
            "SELECT COALESCE(SUM(p.amount),0) n FROM postings p JOIN documents d ON d.id=p.document WHERE p.account=? AND d.day<=?",
          )
          .get(account, day).n,
      )
    );
  }
  businessBalance(account, business) {
    return (
      Number(this.accountOpeningBalances(account)[business] || 0) +
      Number(
        this.db
          .prepare(
            "SELECT COALESCE(SUM(p.amount),0) n FROM postings p JOIN documents d ON d.id=p.document WHERE p.account=? AND d.business=?",
          )
          .get(account, business).n,
      )
    );
  }
  accountBusinessBalances(account) {
    const result = { ...this.accountOpeningBalances(account) };
    for (const row of this.db
      .prepare(
        "SELECT d.business, COALESCE(SUM(p.amount),0) amount FROM postings p JOIN documents d ON d.id=p.document WHERE p.account=? GROUP BY d.business",
      )
      .all(account)) {
      result[row.business] =
        Number(result[row.business] || 0) + Number(row.amount || 0);
    }
    return result;
  }
  validateAccountTimeline(document) {
    const business = this.db.prepare("SELECT business FROM documents WHERE id=?").get(document).business;
    for (const { account } of this.db
      .prepare("SELECT DISTINCT account FROM postings WHERE document=?")
      .all(document)) {
      const accountMaster = this.get(account, "account");
      if (accountMaster.business === "SHARED") {
        const minimum = (exclude) => Number(this.accountOpeningBalances(account)[business] || 0) +
          (this.db.prepare(`SELECT MIN(balance) n FROM (
            SELECT SUM(total) OVER (ORDER BY day ROWS UNBOUNDED PRECEDING) balance
            FROM (SELECT d.day, SUM(p.amount) total FROM postings p
              JOIN documents d ON d.id=p.document
              WHERE p.account=? AND d.business=? AND p.document<>? GROUP BY d.day)
          )`).get(account, business, exclude).n ?? 0);
        const before = minimum(document), after = minimum("");
        if ((before >= 0 && after < 0) || (before < 0 && after < before))
          fail("This business does not have enough money in this shared account on the selected date.");
      }
      const openingTotal = this.accountOpeningTotal(account);
      const minimumWithEntry =
        openingTotal +
        (this.db
          .prepare(
            `SELECT MIN(balance) n FROM (
               SELECT SUM(total) OVER (ORDER BY day ROWS UNBOUNDED PRECEDING) balance
               FROM (
                 SELECT d.day, SUM(p.amount) total
                 FROM postings p
                 JOIN documents d ON d.id=p.document
                 WHERE p.account=?
                 GROUP BY d.day
               )
             )`,
          )
          .get(account).n ?? 0);
      const minimumBeforeEntry =
        openingTotal +
        (this.db
          .prepare(
            `SELECT MIN(balance) n FROM (
               SELECT SUM(total) OVER (ORDER BY day ROWS UNBOUNDED PRECEDING) balance
               FROM (
                 SELECT d.day, SUM(p.amount) total
                 FROM postings p
                 JOIN documents d ON d.id=p.document
                 WHERE p.account=? AND p.document<>?
                 GROUP BY d.day
               )
             )`,
          )
          .get(account, document).n ?? 0);

      const madeNegative =
        minimumBeforeEntry >= 0 && minimumWithEntry < 0;
      const worsenedOldNegative =
        minimumBeforeEntry < 0 && minimumWithEntry < minimumBeforeEntry;

      if (madeNegative || worsenedOldNegative)
        fail(
          accountMaster.type === "BANK"
            ? "There is not enough bank balance for this withdrawal on the selected date."
            : "There is not enough cash available for this deposit on the selected date.",
        );
    }
  }
  account(id, business, outgoing = false, amount = 0) {
    const a = this.get(id, "account");
    if (!a.active) fail("Account is archived.");
    if (a.business !== "SHARED" && a.business !== business)
      fail("This account is not available for the selected business.");
    if (outgoing && this.balance(id) < amount)
      fail("There is not enough cash available for this business.");
    if (
      outgoing &&
      a.business === "SHARED" &&
      this.businessBalance(id, business) < amount
    )
      fail("This business does not have enough cash available.");
    return a;
  }
  validateCustomerTimeline(document) {
    const row = this.db
      .prepare("SELECT customer,kind,link FROM documents WHERE id=?")
      .get(document);
    const customer =
      row.kind === "REVERSAL"
        ? this.db
            .prepare("SELECT customer FROM documents WHERE id=?")
            .get(row.link)?.customer
        : row.customer;
    if (!customer) return;
    const minimum = this.db
      .prepare(
        "SELECT MIN(balance) n FROM (SELECT SUM(total) OVER (ORDER BY day ROWS UNBOUNDED PRECEDING) balance FROM (SELECT day,SUM(CASE WHEN kind='CREDIT' THEN amount WHEN kind='PAYMENT' THEN -amount ELSE 0 END) total FROM documents WHERE customer=? AND reversed=0 GROUP BY day))",
      )
      .get(customer).n;
    if (minimum < 0)
      fail(
        "This correction makes a past customer balance negative. Reverse the related payments first.",
      );
  }
  insert(p, kind, amount, postings = [], extra = {}) {
    const id = text(p.id || randomUUID(), "Request ID", 100);
    if (this.db.prepare("SELECT id FROM documents WHERE id=?").get(id))
      fail("This entry was already saved. Refresh before trying again.");
    const data = {
      ...extra,
      note: String(p.note || "").slice(0, 1000),
      account: p.account || null,
      to: p.to || null,
      category: p.category || null,
      categoryName: p.category ? this.get(p.category, "category").name : null,
    };
    this.db
      .prepare(
        "INSERT INTO documents (id,business,day,kind,amount,quantity,customer,link,data,actor,created) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        p.business,
        p.day,
        kind,
        amount,
        extra.quantity || 0,
        p.customer || null,
        extra.link || null,
        JSON.stringify(data),
        this.user().id,
        new Date().toISOString(),
      );
    for (const [account, value] of postings)
      this.db
        .prepare("INSERT INTO postings VALUES (?,?,?)")
        .run(id, account, value);
    this.audit(kind, { id, business: p.business, day: p.day });
    return id;
  }
  post(p) {
    const action = {
      INCOME: "income",
      EXPENSE: "expense",
      CREDIT: "credit",
      PAYMENT: "payment",
      FUEL_SALE: "fuel",
      SUPPLY: "stock",
      STOCK_CHECK: "stock",
    }[p.kind];
    if (!action) fail("Unknown transaction.");
    date(p.day);
    if (p.day > today()) fail("Financial entries cannot be future dated.");
    if (
      this.db
        .prepare("SELECT day FROM closed_days WHERE business=? AND day=?")
        .get(p.business, p.day)
    )
      fail(
        "This business day is closed. Reopen it with a reason.",
      );
    if (p.category) {
      const c = this.get(p.category, "category");
      if (!c.active || c.business !== p.business) fail("Invalid category.");
    }
    if (p.kind === "SUPPLY" || p.kind === "STOCK_CHECK") {
      if (p.business !== "FUEL")
        fail("Fuel stock belongs to the fuel business.");
      const quantity = Number(p.quantity);
      if (
        !Number.isFinite(quantity) ||
        quantity > 1e12 ||
        quantity < 0 ||
        (p.kind === "SUPPLY" && quantity === 0)
      )
        fail("Enter a valid fuel quantity.");
      return this.insert(p, p.kind, 0, [], {
        quantity: Math.round(quantity * 1000) / 1000,
        fuel: p.fuel === "CNG" ? "CNG" : "PETROL",
        isOpeningStock: p.isOpeningStock ? 1 : 0,
      });
    }
    if (p.kind === "FUEL_SALE") return this.acceptReading(p);
    const amount = money(p.amount);
    if (p.kind === "CREDIT") {
      const customer = this.get(p.customer, "customer");
      if (!customer.active || customer.business !== p.business)
        fail("Select an active customer of this business.");
      // FUEL udhaar uses the date-based flow (manager's register):
      // customer + date + amount, no sale link. Route through addUdhaar
      // so Customer accounts and Daily Operation behave the same.
      if (p.business === "FUEL") {
        const ids = this.addUdhaarInner({
          customer: p.customer,
          amount: p.amount,
          note: p.note,
          day: p.day,
          businessDate: p.day,
          id: p.id,
        });
        return ids[0];
      }
    }
    const a = this.account(
      p.account || "cash-FUEL",
      p.business,
      p.kind === "EXPENSE",
      amount,
    );
    let extra = { accountName: a.name };
    if (p.kind === "PAYMENT") {
      const customer = this.get(p.customer, "customer");
      if (customer.business !== p.business)
        fail("Customer belongs to a different business.");
      const due = Number(
        this.db
          .prepare(
            "SELECT COALESCE(SUM(CASE WHEN kind='CREDIT' THEN amount WHEN kind='PAYMENT' THEN -amount ELSE 0 END),0) n FROM documents WHERE customer=? AND reversed=0 AND day<=?",
          )
          .get(customer.id, p.day).n,
      );
      if (amount > due)
        fail("Payment exceeds this customer outstanding balance.");
      extra = { ...extra, customerName: customer.name };
    }
    if (p.kind === "INCOME" && p.business === "FUEL")
      fail("Fuel revenue is calculated from accepted nozzle readings.");
    // Fuel credit is routed through addUdhaarInner above and never reaches
    // here, so only expenses post a negative amount to cash.
    const postingAmount = p.kind === "EXPENSE" ? -amount : amount;
    return this.insert(
      p,
      p.kind,
      amount,
      [[a.id, postingAmount]],
      extra,
    );
  }
  readingRate(nozzle, shift, day) {
    // Replacing a cancelled reading keeps its original selling price.
    const original = this.db.prepare("SELECT data FROM documents WHERE kind='FUEL_SALE' AND link=? AND day=? AND json_extract(data,'$.shift')=? ORDER BY created DESC,id DESC LIMIT 1").get(nozzle.id, day, shift.id);
    const sameDay = original || this.db.prepare("SELECT data FROM documents WHERE kind='FUEL_SALE' AND day=? AND json_extract(data,'$.fuel')=? ORDER BY created,id LIMIT 1").get(day, nozzle.fuel);
    if (sameDay) return JSON.parse(sameDay.data).rate;
    const settings = this.get("station", "settings");
    return nozzle.fuel === "CNG" ? settings.cngRate : settings.petrolRate;
  }
  readingPreview(p) {
    this.require("FUEL", "view");
    date(p.day);
    const nozzle = this.get(p.nozzle, "nozzle"),
      shift = this.get(p.shift, "shift");
    const pump = this.get(nozzle.pumpId, "pump");
    const accepted = this.db
      .prepare(
        "SELECT id,data FROM documents WHERE kind='FUEL_SALE' AND link=? AND day=? AND reversed=0 AND json_extract(data,'$.shift')=?",
      )
      .get(nozzle.id, p.day, shift.id);
    const saved = accepted
      ? { id: accepted.id, ...JSON.parse(accepted.data) }
      : null;
    const previous = this.db
      .prepare(
        "SELECT data FROM documents WHERE kind='FUEL_SALE' AND link=? AND reversed=0 AND (day<? OR (day=? AND json_extract(data,'$.shiftOrder')<?)) ORDER BY day DESC,json_extract(data,'$.shiftOrder') DESC LIMIT 1",
      )
      .get(nozzle.id, p.day, p.day, shift.order);
    const earlier = this.all("shift")
      .filter((s) => s.active && s.order < shift.order)
      .sort((a, b) => a.order - b.order);
    const missing = earlier.find(
      (s) =>
        !this.db
          .prepare(
            "SELECT id FROM documents WHERE kind='FUEL_SALE' AND link=? AND day=? AND reversed=0 AND json_extract(data,'$.shift')=?",
          )
          .get(nozzle.id, p.day, s.id),
    );
    const override = this.all("assignment").find(
      (a) =>
        a.active &&
        a.day === p.day &&
        a.nozzle === nozzle.id &&
        a.shift === shift.id,
    );
    const staffId = override?.staff || nozzle.assignments?.[shift.id];
    const staff = this.all("staff").find((s) => s.id === staffId);
    const station = this.get("station", "settings");
    return {
      nozzle: nozzle.id,
      name: nozzle.name,
      pumpName: pump.name,
      fuel: nozzle.fuel,
      shift: shift.id,
      shiftName: shift.name,
      day: p.day,
      opening: saved
        ? saved.opening
        : missing
          ? null
          : previous
            ? JSON.parse(previous.data).closing
            : nozzle.opening,
      staffId: saved?.staff || staffId || "",
      staff: saved?.staffName || staff?.name || "Not selected",
      staffActive: !!staff?.active,
      assignmentId: override?.id || null,
      blockedBy:
        !saved && missing ? `Save ${missing.name} closing first.` : null,
      rate: saved?.rate ?? this.readingRate(nozzle, shift, p.day),
      accepted: saved,
    };
  }
  acceptReading(p) {
    if (p.business !== "FUEL") fail("Select Fuel.");
    const nozzle = this.get(p.nozzle, "nozzle");
    const pump = this.get(nozzle.pumpId, "pump");
    const shift = this.get(p.shift, "shift");
    if (!nozzle.active || !pump.active || !shift.active)
      fail("Nozzle, pump and shift must be active.");
    const previous = this.db
      .prepare(
        "SELECT * FROM documents WHERE kind='FUEL_SALE' AND link=? AND reversed=0 ORDER BY day DESC, CAST(json_extract(data,'$.shiftOrder') AS INTEGER) DESC LIMIT 1",
      )
      .get(nozzle.id);
    if (
      previous &&
      (previous.day > p.day ||
        (previous.day === p.day &&
          JSON.parse(previous.data).shiftOrder >= shift.order))
    )
      fail(
        "This nozzle already has this shift or a later accepted reading. Correct later readings first.",
      );
    for (const earlier of this.all("shift").filter(
      (s) => s.active && s.order < shift.order,
    )) {
      if (
        !this.db
          .prepare(
            "SELECT id FROM documents WHERE kind='FUEL_SALE' AND link=? AND day=? AND reversed=0 AND json_extract(data,'$.shift')=?",
          )
          .get(nozzle.id, p.day, earlier.id)
      )
        fail(`Accept ${earlier.name} for this nozzle first.`);
    }
    const previousOpening = previous
      ? JSON.parse(previous.data).closing
      : nozzle.opening;
    let opening = previousOpening;
    let openingReason = "";
    if (p.openingOverride !== undefined && p.openingOverride !== "") {
      this.require("FUEL", "correct");
      opening = Number(p.openingOverride);
      if (!Number.isFinite(opening) || opening < 0 || opening > 1e12)
        fail("Enter a valid new opening reading.");
      openingReason = text(p.openingReason, "Reason", 1000);
    }
    if (p.closing === "" || p.closing == null) fail("Enter the closing reading.");
    const closing = Number(p.closing);
    if (!Number.isFinite(closing) || closing < opening || closing > 1e12)
      fail(`Closing must be at least ${opening}.`);
    // The operator is optional: a reading without an assigned operator
    // still counts. The name is recorded when the caller provides one.
    const override = this.all("assignment").find(
      (a) =>
        a.active &&
        a.day === p.day &&
        a.nozzle === nozzle.id &&
        a.shift === shift.id,
    );
    const staffId = override?.staff || nozzle.assignments?.[shift.id];
    const staff = staffId ? this.get(staffId, "staff") : null;
    if (staff && !staff.active)
      fail("Assigned operator is inactive. Update the roster.");
    const rate = this.readingRate(nozzle, shift, p.day);
    const quantity = Math.round((closing - opening) * 1000) / 1000;
    const amount = Math.round(quantity * rate * 100);
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1e12)
      fail("The sale amount is too large. Check the meter readings and fuel rate.");
    return this.insert({ ...p, account: undefined }, "FUEL_SALE", amount, [], {
      link: nozzle.id,
      nozzleName: nozzle.name,
      pumpName: pump.name,
      fuel: nozzle.fuel,
      shift: shift.id,
      shiftName: shift.name,
      shiftOrder: shift.order,
      staff: staff?.id || "",
      staffName: staff?.name || String(p.operatorName || "").trim() || "Unassigned",
      opening,
      previousOpening,
      openingReason,
      closing,
      quantity,
      rate,
    });
  }
  customerBalance(id) {
    return Number(
      this.db
        .prepare(
          "SELECT COALESCE(SUM(CASE WHEN kind='CREDIT' THEN amount WHEN kind='PAYMENT' THEN -amount ELSE 0 END),0) n FROM documents WHERE customer=? AND reversed=0",
        )
        .get(id).n,
    );
  }
  report(p = {}) {
    const businesses = p.businesses || BUSINESSES;
    const from = date(p.from || today()),
      to = date(p.to || today());
    if (from > to) fail("Invalid report dates.");
    let customer = null;
    if (p.customer) {
      customer = this.get(p.customer, "customer");
    }
    const marks = businesses.map(() => "?").join(",") || "''";
    const kinds = Array.isArray(p.kinds)
      ? p.kinds.filter((k) =>
          [
            "INCOME",
            "EXPENSE",
            "FUEL_SALE",
            "COLLECTION",
            "CREDIT",
            "PAYMENT",
            "SUPPLY",
            "STOCK_CHECK",
            "REVERSAL",
          ].includes(k),
        )
      : [];
    const rows = this.db
      .prepare(
        `SELECT * FROM documents WHERE business IN (${marks}) AND day BETWEEN ? AND ?${customer ? " AND customer=?" : ""}${kinds.length ? ` AND kind IN (${kinds.map(() => "?").join(",")})` : ""} ORDER BY day,created,id`,
      )
      .all(
        ...businesses,
        from,
        to,
        ...(customer ? [customer.id] : []),
        ...kinds,
      )
      .map((r) => ({ ...r, data: JSON.parse(r.data) }));
    const opening = customer
      ? this.db
          .prepare(
            "SELECT COALESCE(SUM(CASE WHEN kind='CREDIT' THEN amount WHEN kind='PAYMENT' THEN -amount ELSE 0 END),0) n FROM documents WHERE customer=? AND day<? AND reversed=0",
          )
          .get(customer.id, from).n
      : null;
    return {
      station: this.get("station", "settings").name,
      from,
      to,
      customer,
      opening,
      rows,
    };
  }
  alerts(customers, asOf = today()) {
    const result = [];
    for (const c of customers) {
      const rows = this.db
        .prepare(
          "SELECT day,kind,amount FROM documents WHERE customer=? AND reversed=0 AND kind IN ('CREDIT','PAYMENT') AND day<=? ORDER BY day,created,id",
        )
        .all(c.id, asOf);
      let payments = rows
        .filter((r) => r.kind === "PAYMENT")
        .reduce((s, r) => s + r.amount, 0);
      const months = new Map();
      for (const r of rows.filter((r) => r.kind === "CREDIT"))
        months.set(
          r.day.slice(0, 7),
          (months.get(r.day.slice(0, 7)) || 0) + r.amount,
        );
      for (const [month, amount] of months) {
        const paid = Math.min(payments, amount);
        payments -= paid;
        const d = new Date(`${month}-01T12:00:00Z`);
        d.setUTCMonth(d.getUTCMonth() + 1);
        const dueDate = `${d.toISOString().slice(0, 7)}-${String(c.dueDay).padStart(2, "0")}`;
        if (amount > paid && asOf > dueDate)
          result.push({
            customer: c.id,
            name: c.name,
            business: c.business,
            month,
            dueDate,
            amount: amount - paid,
          });
      }
    }
    return result;
  }
  reverse(p) {
    const row = this.db
      .prepare("SELECT * FROM documents WHERE id=?")
      .get(p.document || "");
    if (!row || row.reversed || row.kind === "REVERSAL")
      fail("Entry cannot be reversed.");
    this.require(row.business, "correct");
    const reason = text(p.reason, "Correction reason", 1000);
    // v87 Defect 1: Petrol-synced documents must be corrected through the
    // petrol flow (Daily Operation), not generic reversal. Reversal would
    // leave the operation record and ledger disagreeing.
    let rowData = null;
    try { rowData = JSON.parse(row.data || "{}"); } catch {}
    if (rowData && rowData.petrolSync) {
      fail("This entry comes from Daily Operation. Correct it there instead of reversing it here.");
    }
    if (
      this.db
        .prepare("SELECT day FROM closed_days WHERE business=? AND day=?")
        .get(row.business, row.day)
    )
      fail("Reopen this day before correcting it.");
    // v87 Defect 1: Also enforce the petrol operation's CLOSED status, which is
    // a separate closure representation from the closed_days table.
    if (row.business === "FUEL") {
      const closedOp = this.db
        .prepare("SELECT id FROM petrol_records WHERE kind='operation' AND day=? AND json_extract(data,'$.status')='CLOSED'")
        .get(row.day);
      if (closedOp) fail("Reopen this day before correcting it.");
    }
    if (
      row.kind === "CREDIT" &&
      this.customerBalance(row.customer) < row.amount
    )
      fail("Reverse the related customer payments first.");
    if (row.kind === "FUEL_SALE") {
      if (
        this.db
          .prepare(
            "SELECT id FROM documents WHERE kind='CREDIT' AND link=? AND reversed=0",
          )
          .get(row.id)
      )
        fail("Reverse linked credit first.");
      const data = JSON.parse(row.data);
      // v87 Defect 7: Guard against missing shiftOrder (synced sales may not
      // populate it). Note: petrol-synced reversals are blocked above; this
      // is a safety net for any other FUEL_SALE.
      const shiftOrder = Number.isFinite(Number(data.shiftOrder)) ? Number(data.shiftOrder) : -1;
      if (
        this.db
          .prepare(
            "SELECT id FROM documents WHERE kind='FUEL_SALE' AND link=? AND reversed=0 AND (day>? OR (day=? AND json_extract(data,'$.shiftOrder')>?))",
          )
          .get(row.link, row.day, row.day, shiftOrder)
      )
        fail("Reverse later nozzle readings first.");
    }
    const original = this.db
      .prepare("SELECT account,amount FROM postings WHERE document=?")
      .all(row.id);
    for (const x of original)
      if (x.amount > 0 && this.balance(x.account) < x.amount)
        fail("Funds have moved. Reverse subsequent movements first.");
    const id = this.insert(
      { ...p, business: row.business, day: row.day, note: reason },
      "REVERSAL",
      row.amount,
      original.map((x) => [x.account, -x.amount]),
      { link: row.id, originalKind: row.kind },
    );
    this.db.prepare("UPDATE documents SET reversed=1 WHERE id=?").run(row.id);
    return id;
  }
  closeDay(p) {
    this.require(p.business, "close");
    date(p.day);
    const existingPetrolDay = p.business === "FUEL" && this.db
      .prepare("SELECT id FROM petrol_records WHERE kind='operation' AND day=? LIMIT 1")
      .get(p.day);
    if (p.day > today() && !existingPetrolDay) fail("Cannot close a future day.");
    if (
      p.business === "FUEL" &&
      (!this.all("nozzle").some(
        (n) => n.active && this.get(n.pumpId, "pump").active,
      ) ||
        !this.all("shift").some((s) => s.active))
    )
      fail("Set up active nozzles and shifts before closing Fuel.");
    if (p.business === "FUEL") {
      const missing = require("./fuel-workspace.cjs").daily(this, p.day).missing;
      if (missing.length) fail(`Before closing:\n${missing.join("\n")}`);
    }
    if (
      this.db
        .prepare("SELECT day FROM closed_days WHERE business=? AND day=?")
        .get(p.business, p.day)
    )
      fail("Day is already closed.");
    const a = this.account(p.account, p.business);
    if (a.type !== "CASH") fail("Select the counter cash account.");
    if (p.counted === "" || p.counted == null) fail("Enter counted cash, including zero.");
    const counted = Number(p.counted);
    if (!Number.isFinite(counted) || counted < 0)
      fail("Enter counted cash, including zero.");
    const expected = this.balanceThrough(a.id, p.day),
      actual = Math.round(counted * 100);
    const fuel =
      p.business === "FUEL"
        ? this.db
            .prepare(
              "SELECT COALESCE(SUM(CASE WHEN kind='FUEL_SALE' THEN amount WHEN kind='CREDIT' THEN -amount ELSE 0 END),0) expected, COALESCE(SUM(CASE WHEN kind='COLLECTION' THEN amount ELSE 0 END),0) received FROM documents WHERE business='FUEL' AND day=? AND reversed=0",
            )
            .get(p.day)
        : null;
    if (
      fuel &&
      fuel.expected !== fuel.received &&
      !String(p.reason || "").trim()
    )
      fail(
        "Explain the difference between fuel cash expected and staff collections.",
      );
    if (expected !== actual && !String(p.reason || "").trim())
      fail("Explain the cash shortage or excess.");
    const data = {
      account: a.id,
      expected,
      actual,
      variance: actual - expected,
      fuel,
      reason: String(p.reason || ""),
      actor: this.user().id,
      created: new Date().toISOString(),
    };
    this.db
      .prepare("INSERT INTO closed_days VALUES (?,?,?)")
      .run(p.business, p.day, JSON.stringify(data));
    this.audit("CLOSE_DAY", { business: p.business, day: p.day, ...data });
  }
  snapshot(p = {}) {
    // One screen's worth of data for the Customers, Expenses and History
    // pages: daily rows, totals and the master lists, fuel only.
    this.ensurePetrolLedgerSynced();
    const from = date(p.from || today()),
      to = date(p.to || today());
    if (from > to) fail("Start date must be before end date.");
    const page = Math.max(0, Math.floor(Number(p.page) || 0));
    const customerClause = p.customer ? " AND customer=?" : "";
    const kinds = Array.isArray(p.kinds)
      ? p.kinds.filter((k) =>
          [
            "INCOME",
            "EXPENSE",
            "FUEL_SALE",
            "COLLECTION",
            "CREDIT",
            "PAYMENT",
            "SUPPLY",
            "STOCK_CHECK",
            "REVERSAL",
          ].includes(k),
        )
      : [];
    const kindClause = kinds.length
      ? ` AND kind IN (${kinds.map(() => "?").join(",")})`
      : "";
    const args = [from, to, ...(p.customer ? [p.customer] : []), ...kinds];
    const where = `business='FUEL' AND day BETWEEN ? AND ?${customerClause}${kindClause}`;
    const rows = this.db
      .prepare(
        `SELECT * FROM documents WHERE ${where} ORDER BY day DESC,created DESC,id DESC LIMIT 100 OFFSET ?`,
      )
      .all(...args, page * 100)
      .map((r) => ({ ...r, data: JSON.parse(r.data) }));
    const total = this.db
      .prepare(`SELECT COUNT(*) n FROM documents WHERE ${where}`)
      .get(...args).n;
    const summary = this.db
      .prepare(
        `SELECT business,kind,SUM(amount) amount FROM documents WHERE ${where} AND reversed=0 AND kind!='REVERSAL' GROUP BY business,kind`,
      )
      .all(...args);
    const masters = {};
    for (const kind of ["customer", "category", "pump", "nozzle", "shift", "settings"])
      masters[kind] = this.all(kind).filter(
        (r) => !r.business || r.business === "FUEL",
      );
    masters.account = this.all("account").map((a) => ({
      ...a,
      balance: this.balance(a.id),
    }));
    masters.customer = this.all("customer")
      .filter((r) => r.business === "FUEL")
      .map((c) => ({
        ...c,
        balance: this.customerBalance(c.id),
      }));
    const stock = ["PETROL", "CNG"].map((fuel) => {
      const quantity = this.db
        .prepare(
          "SELECT COALESCE(SUM(CASE WHEN kind='SUPPLY' THEN quantity WHEN kind='FUEL_SALE' THEN -quantity ELSE 0 END),0) n FROM documents WHERE business='FUEL' AND reversed=0 AND day<=? AND json_extract(data,'$.fuel')=?",
        )
        .get(to, fuel).n;
      const supply = this.db
        .prepare(
          "SELECT quantity FROM documents WHERE kind='SUPPLY' AND reversed=0 AND day<=? AND json_extract(data,'$.fuel')=? ORDER BY day DESC,created DESC LIMIT 1",
        )
        .get(to, fuel);
      const physical = this.db
        .prepare(
          "SELECT quantity,day FROM documents WHERE kind='STOCK_CHECK' AND reversed=0 AND day<=? AND json_extract(data,'$.fuel')=? ORDER BY day DESC,created DESC LIMIT 1",
        )
        .get(to, fuel);
      return {
        fuel,
        quantity,
        status:
          quantity < 0 || (supply && quantity < supply.quantity * 0.2)
            ? "Check stock"
            : supply && quantity < supply.quantity * 0.5
              ? "Fuel is getting low"
              : supply
                ? "Stock OK"
                : "Opening stock not recorded",
        physical,
      };
    });
    const meters = masters.nozzle.map((n) => {
      const last = this.db
        .prepare(
          "SELECT data FROM documents WHERE kind='FUEL_SALE' AND link=? AND reversed=0 ORDER BY day DESC, json_extract(data,'$.shiftOrder') DESC LIMIT 1",
        )
        .get(n.id);
      return {
        id: n.id,
        last: last ? JSON.parse(last.data).closing : n.opening,
      };
    });
    const meterRows = masters.nozzle
      .filter((n) => n.active && this.get(n.pumpId, "pump").active)
      .flatMap((n) =>
        masters.shift
          .filter((s) => s.active)
          .sort((a, b) => a.order - b.order)
          .map((s) =>
            this.readingPreview({ nozzle: n.id, shift: s.id, day: to }),
          ),
      );
    const statementOpening = p.customer
      ? this.db
          .prepare(
            "SELECT COALESCE(SUM(CASE WHEN kind='CREDIT' THEN amount WHEN kind='PAYMENT' THEN -amount ELSE 0 END),0) n FROM documents WHERE customer=? AND reversed=0 AND day<?",
          )
          .get(p.customer, from).n
      : null;
    const categoryTotals = this.db
      .prepare(
        `SELECT json_extract(data,'$.category') category, kind, SUM(amount) amount FROM documents WHERE ${where} AND reversed=0 AND kind IN ('INCOME','EXPENSE') GROUP BY category,kind`,
      )
      .all(...args);
    const dashboard = p.dashboard
      ? {
          // Full date-range quantities, kept separate because L and kg cannot be added.
          fuelQuantities: (() => {
            const quantities = { PETROL: 0, CNG: 0 };
            const totals = this.db.prepare(
              `SELECT json_extract(data,'$.fuel') fuel, SUM(quantity) quantity
           FROM documents WHERE business='FUEL' AND day BETWEEN ? AND ?
             AND kind='FUEL_SALE' AND reversed=0
             AND json_extract(data,'$.fuel') IN ('PETROL','CNG')
           GROUP BY json_extract(data,'$.fuel')`,
            ).all(from, to);
            for (const row of totals) quantities[row.fuel] = Number(row.quantity);
            return quantities;
          })(),
          // Actual customer receipts only, so moving existing money cannot inflate receipts.
          receipts: this.db
            .prepare(
              `SELECT json_extract(a.data,'$.type') type, SUM(d.amount) amount FROM documents d JOIN masters a ON a.id=json_extract(d.data,'$.account') WHERE d.business='FUEL' AND d.day BETWEEN ? AND ? AND d.kind IN ('INCOME','PAYMENT') AND d.reversed=0 GROUP BY json_extract(a.data,'$.type')`,
            )
            .all(from, to),
        }
      : null;
    return {
      scope: { businesses: ["FUEL"], from, to },
      dashboard,
      user: this.user(),
      businesses: ["FUEL"],
      masters,
      rows,
      total,
      page,
      summary,
      stock,
      meters,
      meterRows,
      categoryTotals,
      alerts: this.alerts(masters.customer),
      statementOpening,
      closed: this.db
        .prepare(
          "SELECT * FROM closed_days WHERE business='FUEL' AND day BETWEEN ? AND ?",
        )
        .all(from, to)
        .map((r) => ({ ...r, data: JSON.parse(r.data) })),
    };
  }
  command(p) {
    return this.transaction(() => {
      if (p.type === "master") return this.saveMaster(p);
      if (p.type === "post") {
        const id = this.post(p);
        // Skip account timeline validation for date-based udhaar: the negative
        // cash posting is bookkeeping (cash not received). Sales may not be
        // recorded yet during the day; day-close validates udhaar <= sales.
        const isUdhaar = this.db
          .prepare("SELECT json_extract(data,'$.udhaar') u FROM documents WHERE id=?")
          .get(id)?.u === 1;
        if (!isUdhaar) this.validateAccountTimeline(id);
        this.validateCustomerTimeline(id);
        return id;
      }
      if (p.type === "reverse") {
        const id = this.reverse(p);
        this.validateAccountTimeline(id);
        this.validateCustomerTimeline(id);
        return id;
      }
      if (p.type === "close") return this.closeDay(p);
      if (p.type === "reopen") {
        date(p.day);
        if (this.db.prepare("SELECT 1 FROM closed_days WHERE business=? AND day=? AND json_extract(data,'$.historicalBatch') IS NOT NULL").get(p.business,p.day))
          fail('A recovered summary cannot be reopened as a normal detailed day.');
        const reason = text(p.reason, "Reason", 1000);
        this.db
          .prepare("DELETE FROM closed_days WHERE business=? AND day=?")
          .run(p.business, p.day);
        // v86 Bug 2: Also reopen the petrol operation record(s). Otherwise
        // their status stays CLOSED and the next save is rejected by the guard.
        if (p.business === "FUEL") {
          const ops = this.db
            .prepare("SELECT id, data FROM petrol_records WHERE kind='operation' AND day=?")
            .all(p.day);
          for (const op of ops) {
            let data = null;
            try { data = JSON.parse(op.data); } catch {}
            if (data && data.status === "CLOSED") {
              data.status = "OPEN";
              data.reopenedAt = new Date().toISOString();
              data.reopenReason = reason;
              this.db
                .prepare("UPDATE petrol_records SET data=? WHERE kind='operation' AND id=?")
                .run(JSON.stringify(data), op.id);
            }
          }
        }
        this.audit("REOPEN_DAY", { business: p.business, day: p.day, reason });
        return;
      }
      fail("Unknown command.");
    });
  }
  petrolSyncDocumentId(...parts) {
    return `petrol-sync-${createHash("sha256")
      .update(parts.map((part) => String(part ?? "")).join("|"))
      .digest("hex")
      .slice(0, 32)}`;
  }
  deletePetrolSyncedDocuments(sourceKind, sourceId) {
    const ids = this.db
      .prepare(
        `SELECT id FROM documents
         WHERE json_extract(data,'$.petrolSync')=1
           AND json_extract(data,'$.petrolSourceKind')=?
           AND json_extract(data,'$.petrolSourceId')=?`,
      )
      .all(sourceKind, sourceId)
      .map((row) => row.id);

    const deletePostings = this.db.prepare("DELETE FROM postings WHERE document=?");
    const deleteDocument = this.db.prepare("DELETE FROM documents WHERE id=?");
    for (const id of ids) {
      deletePostings.run(id);
      deleteDocument.run(id);
    }
  }
  insertPetrolSyncedDocument({
    id,
    day,
    kind,
    amount = 0,
    quantity = 0,
    link = null,
    data = {},
    postings = [],
  }) {
    const actor = this.user().id;
    this.db
      .prepare(
        "INSERT INTO documents (id,business,day,kind,amount,quantity,customer,link,data,actor,created) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        "FUEL",
        day,
        kind,
        amount,
        quantity,
        null,
        link,
        JSON.stringify(data),
        actor,
        new Date().toISOString(),
      );

    const insertPosting = this.db.prepare(
      "INSERT INTO postings(document,account,amount) VALUES (?,?,?)",
    );
    for (const [account, postingAmount] of postings) {
      insertPosting.run(id, account, postingAmount);
    }
  }
  syncPetrolOperationToLedger(operation) {
    if (!operation || typeof operation !== "object") return;
    if (operation.manualSummary) return;
    const sourceId = String(operation.id || "");
    if (!sourceId) return;
    const day = date(operation.businessDate);

    // UDHAAR_SAFETY (Fix 1): Capture sale IDs before delete, so we can validate
    // linked credits after re-creation. If a reading was removed or a sale was
    // corrected below its allocated credit, fail with a clear message instead
    // of creating orphaned links or negative cash.
    const oldSaleIds = this.db
      .prepare(
        `SELECT id FROM documents
         WHERE kind='FUEL_SALE' AND reversed=0
           AND json_extract(data,'$.petrolSync')=1
           AND json_extract(data,'$.petrolSourceKind')='operation'
           AND json_extract(data,'$.petrolSourceId')=?`,
      )
      .all(sourceId)
      .map((r) => r.id);

    this.deletePetrolSyncedDocuments("operation", sourceId);

    const readings = Array.isArray(operation.nozzleReadings)
      ? operation.nozzleReadings
      : [];
    readings.forEach((reading, index) => {
      if (reading?.closingAccepted !== true) return;

      const opening = Number(reading.openingMeter);
      const closing = Number(reading.closingMeter);
      const rate = Number(reading.rate);
      if (
        !Number.isFinite(opening) ||
        !Number.isFinite(closing) ||
        !Number.isFinite(rate) ||
        closing < opening ||
        rate < 0
      )
        fail("Invalid accepted Petrol Pump reading.");

      const quantity = Math.round((closing - opening) * 1000) / 1000;
      const calculatedAmount = Math.round(quantity * rate * 100);
      const savedAmount = Math.round(Number(reading.salesAmount) * 100);
      // v87 Defect 4: Never trust client-supplied salesAmount. It must match
      // the meter-derived amount within rounding tolerance, otherwise a
      // malformed payload could record wrong sales (e.g. Rs. 1 instead of
      // Rs. 1,000 for 10L @ Rs. 100).
      if (
        !Number.isSafeInteger(savedAmount) ||
        savedAmount < 0 ||
        Math.abs(savedAmount - calculatedAmount) > 1
      )
        fail("Reading sale amount does not match meters and rate.");
      const amount = calculatedAmount;
      if (amount < 0 || amount > 1e12)
        fail("Invalid Petrol Pump sale amount.");

      const docId = this.petrolSyncDocumentId(
        "operation",
        sourceId,
        "reading",
        reading.nozzleId || index,
        reading.shiftId || index,
        index,
      );

      this.insertPetrolSyncedDocument({
        id: docId,
        day,
        kind: "FUEL_SALE",
        amount,
        quantity,
        link: String(reading.nozzleId || ""),
        data: {
          petrolSync: 1,
          petrolSourceKind: "operation",
          petrolSourceId: sourceId,
          petrolChildId: `reading-${index}`,
          account: "cash-FUEL",
          nozzleName: String(reading.nozzleNameSnapshot || "Nozzle"),
          pumpName: String(reading.pumpNameSnapshot || "Pump"),
          fuel: reading.fuelType === "CNG" ? "CNG" : "PETROL",
          shift: String(reading.shiftId || ""),
          shiftName: String(reading.shiftNameSnapshot || ""),
          staff: String(reading.employeeId || ""),
          staffName: String(reading.employeeNameSnapshot || ""),
          opening,
          closing,
          quantity,
          rate,
          acceptedAt: reading.closingAcceptedAt || null,
          note: String(reading.closingAcceptanceNote || ""),
        },
        postings: [["cash-FUEL", amount]],
      });
    });

    const expenses = Array.isArray(operation.expenses) ? operation.expenses : [];
    expenses.forEach((expense, index) => {
      const rupees = Number(expense?.amount);
      if (!Number.isFinite(rupees) || rupees < 0) fail("Invalid Petrol Pump expense.");
      const amount = Math.round(rupees * 100);
      if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1e12)
        fail("Invalid Petrol Pump expense amount.");

      const childId = String(expense?.id || `expense-${index}`);
      const docId = this.petrolSyncDocumentId(
        "operation",
        sourceId,
        "expense",
        childId,
      );

      // New expenses deduct from station cash once, before the net cash handover.
      // Preserve historical manager-paid entries in their original account.
      const isManagerPaid = expense?.paidBy === 'manager';
      const collected = expense?.collectedCashUsed;
      if (collected !== undefined && (!Number.isFinite(collected) || collected < 0 || collected > rupees))
        fail("Invalid expense cash allocation.");
      const managerAmount = collected !== undefined ? Math.round(collected * 100) : (isManagerPaid ? amount : 0);
      const stationAmount = amount - managerAmount;
      const expenseAccount = managerAmount === amount ? "cash-manager" : "cash-FUEL";
      this.insertPetrolSyncedDocument({
        id: docId,
        day,
        kind: "EXPENSE",
        amount,
        data: {
          petrolSync: 1,
          petrolSourceKind: "operation",
          petrolSourceId: sourceId,
          petrolChildId: childId,
          account: expenseAccount,
          category: expense?.category || null,
          description: String(expense?.description || "Petrol Pump expense"),
          note: String(expense?.notes || expense?.description || ""),
          sourceTimestamp: expense?.dateTime || null,
          paidBy: expense?.paidBy || null,
          collectedCashUsed: managerAmount / 100,
        },
        postings: [
          ...(stationAmount ? [["cash-FUEL", -stationAmount]] : []),
          ...(managerAmount ? [["cash-manager", -managerAmount]] : []),
        ],
      });
    });

    const deposits = Array.isArray(operation.cashDeposits)
      ? operation.cashDeposits
      : [];
    deposits.forEach((deposit, index) => {
      const rupees = Number(deposit?.amount);
      if (!Number.isFinite(rupees) || rupees < 0)
        fail("Invalid Petrol Pump cash handover.");
      const amount = Math.round(rupees * 100);
      if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1e12)
        fail("Invalid Petrol Pump cash handover amount.");

      const childId = String(deposit?.id || `deposit-${index}`);
      const docId = this.petrolSyncDocumentId(
        "operation",
        sourceId,
        "deposit",
        childId,
      );

      this.insertPetrolSyncedDocument({
        id: docId,
        day,
        kind: "COLLECTION",
        amount,
        data: {
          petrolSync: 1,
          petrolSourceKind: "operation",
          petrolSourceId: sourceId,
          petrolChildId: childId,
          account: "cash-manager",
          fromAccount: "cash-FUEL",
          to: "cash-manager",
          staff: String(deposit?.employeeId || ""),
          staffName: String(deposit?.employeeNameSnapshot || ""),
          // v64: nozzle-based handover details.
          nozzleId: String(deposit?.nozzleId || ""),
          readingId: deposit?.readingId || null,
          readingSequence: deposit?.readingSequence || null,
          nozzleName: String(deposit?.nozzleNameSnapshot || ""),
          fuelType: String(deposit?.fuelType || ""),
          note: String(deposit?.note || "Nozzle cash handover"),
          sourceTimestamp: deposit?.timestamp || null,
        },
        postings: [
          ["cash-FUEL", -amount],
          ["cash-manager", amount],
        ],
      });
    });

    // UDHAAR_SAFETY (Fix 1, continued): Validate linked credits after re-creation.
    // Runs inside the caller's transaction - failure rolls back the entire save.
    if (oldSaleIds.length) {
      const placeholders = oldSaleIds.map(() => "?").join(",");
      // Orphaned: credit linked to a sale that no longer exists (reading removed).
      const orphaned = this.db
        .prepare(
          `SELECT c.id, json_extract(c.data,'$.customerName') AS customerName
           FROM documents c
           WHERE c.kind='CREDIT' AND c.reversed=0 AND c.day=?
             AND c.link IN (${placeholders})
             AND NOT EXISTS (SELECT 1 FROM documents s WHERE s.id=c.link AND s.kind='FUEL_SALE' AND s.reversed=0)`,
        )
        .all(day, ...oldSaleIds);
      if (orphaned.length) {
        const names = [
          ...new Set(orphaned.map((o) => o.customerName || "customer")),
        ].join(", ");
        fail(
          `Udhaar linked to a removed reading (${names}). Fix or remove the credit entry first, then save again.`,
        );
      }
      // Over-allocated: sale corrected below its total allocated credit.
      const over = this.db
        .prepare(
          `SELECT s.id, s.amount AS saleAmount,
                  (SELECT COALESCE(SUM(c.amount),0) FROM documents c WHERE c.kind='CREDIT' AND c.link=s.id AND c.reversed=0) AS creditTotal,
                  json_extract(s.data,'$.nozzleName') AS nozzleName
           FROM documents s
           WHERE s.id IN (${placeholders}) AND s.kind='FUEL_SALE' AND s.reversed=0
             AND (SELECT COALESCE(SUM(c.amount),0) FROM documents c WHERE c.kind='CREDIT' AND c.link=s.id AND c.reversed=0) > s.amount`,
        )
        .all(...oldSaleIds);
      if (over.length) {
        fail(
          `Sale corrected below credit amount (${over[0].nozzleName || "reading"}). Reduce the credit entry first, then save again.`,
        );
      }
    }
  }
  syncPetrolFuelStockToLedger(record) {
    if (!record || typeof record !== "object") return;
    const sourceId = String(record.id || "");
    if (!sourceId) return;
    const day = date(record.businessDate);
    const fuel = record.fuelType === "CNG" ? "CNG" : "PETROL";

    this.deletePetrolSyncedDocuments("fuelStock", sourceId);

    const supplies = Array.isArray(record.supplyRecords)
      ? record.supplyRecords
      : [];
    supplies.forEach((supply, index) => {
      const quantity = Number(supply?.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0)
        fail("Invalid Petrol Pump fuel delivery.");
      const supplyDay = date(supply?.businessDate || day);
      const childId = String(supply?.id || `supply-${index}`);
      const docId = this.petrolSyncDocumentId(
        "fuelStock",
        sourceId,
        "supply",
        childId,
      );

      this.insertPetrolSyncedDocument({
        id: docId,
        day: supplyDay,
        kind: "SUPPLY",
        quantity: Math.round(quantity * 1000) / 1000,
        data: {
          petrolSync: 1,
          petrolSourceKind: "fuelStock",
          petrolSourceId: sourceId,
          petrolChildId: childId,
          fuel,
          note: String(supply?.note || "Fuel received"),
          sourceTimestamp: supply?.createdAt || null,
        },
      });
    });

    if (
      record.actualPhysicalStock !== undefined &&
      record.actualPhysicalStock !== null
    ) {
      const quantity = Number(record.actualPhysicalStock);
      if (!Number.isFinite(quantity) || quantity < 0)
        fail("Invalid Petrol Pump physical stock.");
      const docId = this.petrolSyncDocumentId(
        "fuelStock",
        sourceId,
        "physical-check",
      );
      this.insertPetrolSyncedDocument({
        id: docId,
        day,
        kind: "STOCK_CHECK",
        quantity: Math.round(quantity * 1000) / 1000,
        data: {
          petrolSync: 1,
          petrolSourceKind: "fuelStock",
          petrolSourceId: sourceId,
          petrolChildId: "physical-check",
          fuel,
          note: String(record.physicalCheckNote || "Physical stock check"),
          sourceTimestamp: record.physicalCheckAt || null,
        },
      });
    }
  }
  ensurePetrolLedgerSynced() {
    if (this.getMeta("restore-review")) return;
    if (this.getMeta("petrol-ledger-sync-v1") === "1") return;

    return this.transaction(() => {
      const syncedIds = this.db
        .prepare(
          "SELECT id FROM documents WHERE json_extract(data,'$.petrolSync')=1",
        )
        .all()
        .map((row) => row.id);
      const deletePostings = this.db.prepare(
        "DELETE FROM postings WHERE document=?",
      );
      const deleteDocument = this.db.prepare("DELETE FROM documents WHERE id=?");
      for (const id of syncedIds) {
        deletePostings.run(id);
        deleteDocument.run(id);
      }

      const records = this.db
        .prepare(
          "SELECT kind,data FROM petrol_records WHERE kind IN ('operation','fuelStock') ORDER BY COALESCE(day,''),id",
        )
        .all();

      let operations = 0;
      let stockRecords = 0;
      for (const row of records) {
        const item = JSON.parse(row.data);
        if (row.kind === "operation") {
          this.syncPetrolOperationToLedger(item);
          operations += 1;
        } else {
          this.syncPetrolFuelStockToLedger(item);
          stockRecords += 1;
        }
      }

      this.setMeta("petrol-ledger-sync-v1", "1");
      this.audit("PETROL_LEDGER_SYNC", { operations, stockRecords });
      return { operations, stockRecords };
    });
  }
  petrolPermission(kind, write = false, item = null) {
    if (write) this.assertWritesAllowed();
    const allowed = ["station", "pump", "nozzle", "operation", "fuelStock"];
    if (!allowed.includes(kind)) fail("Unknown Petrol Pump record type.");
    if (!write) {
      this.require("FUEL", "view");
      return;
    }
    if (kind === "operation") {
      // Base operation (nozzle readings) needs FUEL/fuel.
      this.require("FUEL", "fuel");
      // Also check expenses dropped from the draft: a saved expense
      // cannot be silently deleted.
      if (item && typeof item === "object") {
        const newExpenses = Array.isArray(item.expenses) ? item.expenses : [];
        const newCash = Array.isArray(item.cashDeposits) ? item.cashDeposits : [];
        let oldExpenses = [], oldCash = [];
        let oldDataStr = null;
        if (item.id) {
          try {
            const old = this.db
              .prepare("SELECT data FROM petrol_records WHERE kind='operation' AND id=?")
              .get(String(item.id));
            if (old) {
              oldDataStr = old.data;
              const od = JSON.parse(old.data);
              oldExpenses = Array.isArray(od.expenses) ? od.expenses : [];
              oldCash = Array.isArray(od.cashDeposits) ? od.cashDeposits : [];
            }
          } catch {}
        }
        // v87 Defect 6: Only require expense/collection permission if the user
        // actually CHANGED expenses/cash, not merely because they exist.
        // A cashier adding a reading to a day with existing expenses must not
        // be blocked.
        const expensesChanged = JSON.stringify(newExpenses) !== JSON.stringify(oldExpenses);
        const cashChanged = JSON.stringify(newCash) !== JSON.stringify(oldCash);
        if (expensesChanged)
          this.require("FUEL", "expense");
        if (cashChanged)
          this.require("FUEL", "collection");
        if (item.status === "CLOSED")
          this.require("FUEL", "close");
        // v87 Defect 5: Correcting an accepted reading needs FUEL/correct.
        // The UI has a PIN prompt, but the backend must enforce it too.
        // Use the shared keyed() identity so legacy readings without
        // readingId are also protected (not just explicit IDs).
        const keyed = require('./reading-ledger.cjs').keyed;
        const newKeyed = new Map(keyed(item.nozzleReadings || []));
        let oldReadingsArr = [];
        try { oldReadingsArr = JSON.parse(oldDataStr || "{}").nozzleReadings || []; } catch {}
        const oldKeyed = new Map(keyed(oldReadingsArr));
        for (const [id, r] of newKeyed) {
          if (!r.closingAccepted) continue;
          const old = oldKeyed.get(id);
          if (!old || !old.closingAccepted) continue;
          const newCorr = Array.isArray(r.corrections) ? r.corrections.length : 0;
          const oldCorr = Array.isArray(old.corrections) ? old.corrections.length : 0;
          if (newCorr > oldCorr || r.closingMeter !== old.closingMeter) {
            this.require("FUEL", "correct");
            break;
          }
        }
      }
      return;
    }
    if (kind === "fuelStock") {
      this.require("FUEL", "stock");
      return;
    }
    // v86 Bug 4: Saving a reading updates the nozzle's lastClosingMeter as a side
    // effect. That meter sync only needs FUEL/fuel permission - not manage.
    // Structural nozzle changes (name, pump, active, etc.) still need manage.
    if (kind === "nozzle" && item && item.id) {
      try {
        const old = this.db
          .prepare("SELECT data FROM petrol_records WHERE kind='nozzle' AND id=?")
          .get(String(item.id));
        if (old) {
          const od = JSON.parse(old.data);
          const keys = new Set([...Object.keys(od), ...Object.keys(item)]);
          keys.delete("lastClosingMeter");
          keys.delete("lastClosingDay");
          keys.delete("updated");
          let onlyMeter = true;
          for (const k of keys) {
            if (JSON.stringify(od[k]) !== JSON.stringify(item[k])) { onlyMeter = false; break; }
          }
          if (onlyMeter) {
            this.require("FUEL", "fuel");
            return;
          }
        }
      } catch {}
    }
    this.require("FUEL", "manage");
  }
  petrolOperationTotals(item) {
    const credit = this.db.prepare("SELECT COALESCE(SUM(amount),0) n FROM documents WHERE business='FUEL' AND kind='CREDIT' AND day=? AND reversed=0").get(item.businessDate).n / 100;
    return require('./petrol-totals.cjs').operationTotals(item, credit);
  }
  petrolStateLoad() {
    this.require("FUEL", "view");
    this.ensurePetrolLedgerSynced();
    const grouped = {
      station: null,
      pumps: [],
      nozzles: [],
      employees: [],
      operations: [],
      fuelStock: [],
      rateChanges: [],
    };
    const rows = this.db
      .prepare("SELECT kind,id,day,data FROM petrol_records ORDER BY COALESCE(day,''),id")
      .all();
    for (const row of rows) {
      const item = JSON.parse(row.data);
      if (row.kind === "station") grouped.station = item;
      else if (row.kind === "pump") grouped.pumps.push(item);
      else if (row.kind === "nozzle") grouped.nozzles.push(item);
      else if (row.kind === "employee") grouped.employees.push(item);
      else if (row.kind === "operation") grouped.operations.push(this.petrolOperationTotals(item));
      else if (row.kind === "fuelStock") grouped.fuelStock.push(item);
      else if (row.kind === "rateChange") grouped.rateChanges.push(item);
    }
    // SHIFT_RENAME_MIGRATION (manager feedback): old "Morning Shift"/"Evening Shift"
    // names become "Shift A"/"Shift B". IDs are kept so existing operation
    // records still match. Persisted once.
    if (grouped.station && Array.isArray(grouped.station.shifts)) {
      let migrated = false;
      for (const s of grouped.station.shifts) {
        if (s.name === "Morning Shift") { s.name = "Shift A"; migrated = true; }
        else if (s.name === "Evening Shift") { s.name = "Shift B"; migrated = true; }
      }
      if (migrated) {
        this.db.prepare("UPDATE petrol_records SET data=? WHERE kind='station' AND id='station'")
          .run(JSON.stringify(grouped.station));
      }
    }
    return grouped;
  }
  petrolPutInner(kind, item) {
    if (!item || typeof item !== "object" || Array.isArray(item))
      fail("Invalid Petrol Pump record.");
    const id = kind === "station" ? "station" : text(String(item.id || ""), "Record ID", 200);
    if (item.manualSummary || this.db.prepare("SELECT 1 FROM petrol_records WHERE kind=? AND id=? AND json_extract(data,'$.manualSummary') IS NOT NULL").get(kind,id))
      fail('Historical summaries cannot be edited through normal petrol forms.');
    const day =
      kind === "operation" || kind === "fuelStock" ? date(item.businessDate) : null;
    const existingDatedRecord = day && this.db
      .prepare("SELECT day FROM petrol_records WHERE kind=? AND id=?")
      .get(kind, id);
    // A corrected PC clock must not strand records saved under the old clock.
    // Preserve all permission and closed-day checks below.
    if (day && day > today() && existingDatedRecord?.day !== day)
      fail("Business date cannot be in the future. Check your computer date.");

    // First-time init: a new petrol station created with zero rates picks up
    // rates already saved in the old "Station and fuel rates" settings
    // (masters kind='settings'). Without this, saving settings before first
    // opening Petrol Pump leaves the station at zero rates.
    if (kind === "station") {
      const existing = this.db
        .prepare("SELECT id FROM petrol_records WHERE kind='station' AND id='station'")
        .get();
      const rates = item.rates || {};
      const hasRates = Number(rates.PETROL) > 0 || Number(rates.CNG) > 0;
      if (!existing && !hasRates) {
        const s = this.db
          .prepare("SELECT data FROM masters WHERE id='station' AND kind='settings'")
          .get();
        if (s) {
          const settings = JSON.parse(s.data);
          const pr = Number(settings.petrolRate);
          const cr = Number(settings.cngRate);
          if (Number.isFinite(pr) && pr > 0 && Number.isFinite(cr) && cr > 0) {
            item = { ...item, rates: { PETROL: pr, CNG: cr } };
            this.audit("PETROL_RATE_INIT", { petrolRate: pr, cngRate: cr });
          }
        }
      }
    }

    if (kind === "operation" || kind === "fuelStock") {
      // Closed-day safety (Point 1): block any save to a day closed via closeDay().
      // Also check the OLD date: moving a record off a closed day is not allowed.
      const oldRec = this.db
        .prepare("SELECT day FROM petrol_records WHERE kind=? AND id=?")
        .get(kind, id);
      const daysToCheck = [day];
      if (oldRec?.day && oldRec.day !== day) daysToCheck.push(oldRec.day);
      for (const d of daysToCheck) {
        if (
          this.db
            .prepare("SELECT day FROM closed_days WHERE business='FUEL' AND day=?")
            .get(d)
        )
          fail("This business day is closed. Reopen it with a reason.");
      }
      if (kind === "operation") {
      // Status safety: a CLOSED operation cannot be reopened by saving with
      // status OPEN. Use the Reopen flow.
      if (oldRec?.day) {
        const oldData = this.db
          .prepare("SELECT data FROM petrol_records WHERE kind='operation' AND id=?")
          .get(id);
        let oldStatus = null;
        if (oldData) {
          try {
            oldStatus = JSON.parse(oldData.data)?.status;
          } catch {}
        }
        // v86 Bug 7: A closed day is fully immutable. The old check only blocked
        // reopening via status change, but expenses/cash/notes could still be
        // modified. Any change now requires the Reopen flow first.
        if (oldStatus === "CLOSED") {
          let oldJson = null;
          try { oldJson = JSON.parse(oldData.data); } catch {}
          const canonical = (value) => {
            if (Array.isArray(value)) return value.map(canonical);
            if (value && typeof value === "object") return Object.fromEntries(
              Object.keys(value).sort().filter((key) => value[key] !== undefined)
                .map((key) => [key, canonical(value[key])]),
            );
            return value;
          };
          const comparable = (value) => {
            const { updated, ...rest } = value || {};
            return JSON.stringify(canonical(rest));
          };
          const calculated = this.petrolOperationTotals(oldJson);
          const derived = ['grossSales','totalQuantity','totalExpenses','udhaarTotal','expectedNet','actualCollection','variance','reconciliationStatus','reconciliationText'];
          const sourceOnly = (value) => Object.fromEntries(Object.entries(value || {}).filter(([key]) => !derived.includes(key)));
          const changed = !oldJson || comparable(sourceOnly(oldJson)) !== comparable(sourceOnly(item)) ||
            derived.some((key) => item[key] !== undefined && item[key] !== oldJson[key] && item[key] !== calculated[key]);
          if (changed) fail("This day is closed. Reopen it with a reason.");
        }
      }
      const clash = this.db
        .prepare("SELECT id FROM petrol_records WHERE kind='operation' AND day=? AND id<>?")
        .get(day, id);
      if (clash) {
        // Legacy databases may already hold two records for one date (created
        // before this guard existed). Updating either of them must keep
        // working so corrections can be saved; only a NEW record, or moving
        // a record onto a taken date, is blocked. Nothing is ever deleted here.
        const current = this.db
          .prepare("SELECT day FROM petrol_records WHERE kind='operation' AND id=?")
          .get(id);
        if (!current || current.day !== day)
          fail("A daily operation for this date already exists. Open that day instead of creating a new one.");
      }
      }
    }

    // DUPLICATE_NOZZLE (manager feedback): block same nozzle name (case-insensitive).
    // Frontend also checks, but backend is the real guard.
    if (kind === "nozzle") {
      const nozzleName = String(item.name || "").trim().toLowerCase();
      if (!nozzleName) fail("Enter a nozzle name.");
      const nameClash = this.db
        .prepare(
          "SELECT id FROM petrol_records WHERE kind='nozzle' AND id<>? AND lower(trim(json_extract(data,'$.name')))=?"
        )
        .get(id, nozzleName);
      if (nameClash)
        fail(`"${String(item.name).trim()}" already exists. Use another name.`);
    }

    if (kind === "operation") {
      const previous = this.db.prepare("SELECT data FROM petrol_records WHERE kind='operation' AND id=?").get(id);
      const removedKey = `petrol-deleted-expenses:${id}`;
      const removed = new Set(JSON.parse(this.getMeta(removedKey) || '[]'));
      const incomingIds = new Set((item.expenses || []).map((e) => e.id));
      if ([...incomingIds].some((expenseId) => removed.has(expenseId)))
        fail('This draft contains a deleted expense. Reload the day before saving.');
      for (const expense of previous ? (JSON.parse(previous.data).expenses || []) : []) {
        if (!incomingIds.has(expense.id)) removed.add(expense.id);
      }
      this.setMeta(removedKey, JSON.stringify([...removed]));
      require('./reading-ledger.cjs').validateReadingLedger(previous ? JSON.parse(previous.data) : null, item);
      const oldReceipts = new Set(previous ? (JSON.parse(previous.data).cashDeposits || []).map((d) => d.id) : []);
      if ((item.cashDeposits || []).some((d) => !oldReceipts.has(d.id))) {
        const sales = (item.nozzleReadings || []).filter((r) => r.closingAccepted)
          .reduce((sum, r) => sum + Math.round(Number(r.salesAmount) * 100), 0);
        const stationExpenses = (item.expenses || []).reduce((sum, e) => sum + Math.round(
          (Number(e.amount) - (e.collectedCashUsed ?? (e.paidBy === 'manager' ? Number(e.amount) : 0))) * 100), 0);
        const credit = this.db.prepare("SELECT COALESCE(SUM(amount),0) n FROM documents WHERE business='FUEL' AND kind='CREDIT' AND day=? AND reversed=0").get(day).n;
        const received = (item.cashDeposits || []).reduce((sum, d) => sum + Math.round(Number(d.amount) * 100), 0);
        if (received > Math.max(0, sales - credit - stationExpenses))
          fail("Cash exceeds the day's remaining amount after expenses and credit.");
      }
      const oldReadings = new Map(require('./reading-ledger.cjs').keyed(previous ? JSON.parse(previous.data).nozzleReadings : []));
      for (const [readingId, reading] of require('./reading-ledger.cjs').keyed(item.nozzleReadings)) {
        const old = oldReadings.get(readingId);
        if (old && (reading.corrections || []).length > (old.corrections || []).length) {
          this.audit('PETROL_READING_CORRECTION', { operationId: id, readingId, before: old, after: reading });
        }
      }
    }

    // METER_CHAIN_GUARD: validate reading sequence and meter continuity
    // before saving an operation. Prevents double-counting when an earlier
    // reading's closing is changed after a later reading was accepted.
    if (kind === "operation" && Array.isArray(item.nozzleReadings)) {
      const byNozzle = new Map();
      item.nozzleReadings.forEach((r) => {
        if (!r || !r.nozzleId) return;
        const list = byNozzle.get(r.nozzleId) || [];
        list.push(r);
        byNozzle.set(r.nozzleId, list);
      });
      for (const [nozzleId, readings] of byNozzle) {
        // Only accepted readings form the meter chain. meterOrder is assigned
        // at accept time (0 = pending, not yet ordered).
        // Sort accepted by meterOrder for chain validation.
        const accepted = readings.filter((r) => r.closingAccepted);
        // v63: detect duplicate meterOrder (data corruption) before sorting.
        const seenOrders = new Set();
        for (const r of accepted) {
          const mo = r.meterOrder || 0;
          if (mo > 0) {
            if (seenOrders.has(mo))
              fail("Duplicate meter order detected. Contact support.");
            seenOrders.add(mo);
          }
        }
        const sorted = [...accepted].sort((a, b) => {
          // v63: unordered (0) goes LAST, not first. Mixed 0/positive values
          // previously sorted 0 first, causing false "Correct the later reading first."
          const moA = a.meterOrder || Infinity;
          const moB = b.meterOrder || Infinity;
          // Fallback to readingSequence for very old data without meterOrder
          if (moA === Infinity && moB === Infinity) {
            return (a.readingSequence || 0) - (b.readingSequence || 0);
          }
          return moA - moB;
        });
        for (let i = 1; i < sorted.length; i++) {
          const prev = sorted[i - 1];
          const curr = sorted[i];
          const prevClosing = Number(prev.closingMeter);
          const currOpening = Number(curr.openingMeter);
          if (!Number.isFinite(prevClosing) || !Number.isFinite(currOpening)) continue;
          // Allow exact match or approved meter reset (curr opening < prev closing
          // is allowed only if it's a fresh zero start).
          if (Math.abs(currOpening - prevClosing) > 0.001) {
            // Check if this is a legitimate meter reset (opening near zero).
            const isReset = currOpening < 1 && prevClosing > 1;
            if (!isReset) {
              fail(
                "Correct the later reading first."
              );
            }
          }
        }
      }
    }

    // STOCK_GUARD: block operation save if accepting would make fuel stock negative.
    // Only enforced when stock tracking data exists. Frontend also checks, but
    // backend is the real guard (mirrors the frontend calculateFuelStock logic).
    // v63: guard is scoped to NEWLY accepted quantities per fuel type. Previously
    // the guard checked ALL accepted readings, so a pre-existing petrol oversell
    // (or zero petrol stock with old sales) blocked even CNG readings.
    if (kind === "operation" && Array.isArray(item.nozzleReadings)) {
      const businessDate = item.businessDate;
      // Load stock records (v63: per-record parse so one corrupt record
      // does not silently disable the whole guard).
      let stockRecords = [];
      let stockRows = [];
      try {
        stockRows = this.db
          .prepare("SELECT id, data FROM petrol_records WHERE kind='fuelStock'")
          .all();
      } catch {}
      for (const r of stockRows) {
        try {
          stockRecords.push(JSON.parse(r.data));
        } catch {
          this.audit("STOCK_JSON_CORRUPT", { id: r.id });
        }
      }
      if (stockRecords.length > 0 && businessDate) {
        // Helper: quantity is ALWAYS calculated from meters for accepted readings.
        // Never trust supplied quantitySold (bypass risk: fake small value).
        const getQty = (r) => {
          if (!r.closingAccepted) return 0;
          const closing = Number(r.closingMeter);
          const opening = Number(r.openingMeter);
          if (Number.isFinite(closing) && Number.isFinite(opening) && closing > opening) {
            return closing - opening;
          }
          // Fallback to quantitySold if meters are invalid
          return Number(r.quantitySold) || 0;
        };
        // Group accepted quantities by fuel type from the operation being saved
        const soldByFuel = new Map();
        item.nozzleReadings.forEach((r) => {
          if (!r || !r.closingAccepted || !r.fuelType) return;
          const qty = getQty(r);
          if (qty <= 0) return;
          soldByFuel.set(r.fuelType, (soldByFuel.get(r.fuelType) || 0) + qty);
        });
        // v63: load previously saved operation to find NEWLY accepted quantities.
        // Only fuel types with new sales are checked; old oversell does not
        // brick the day for unrelated fuels (e.g. CNG blocked by petrol stock).
        const prevAcceptedByFuel = new Map();
        try {
          const prevRow = this.db
            .prepare("SELECT data FROM petrol_records WHERE kind='operation' AND id=?")
            .get(id);
          if (prevRow) {
            const prevOp = JSON.parse(prevRow.data);
            (prevOp.nozzleReadings || []).forEach((r) => {
              if (!r || !r.closingAccepted || !r.fuelType) return;
              const qty = getQty(r);
              if (qty <= 0) return;
              prevAcceptedByFuel.set(r.fuelType, (prevAcceptedByFuel.get(r.fuelType) || 0) + qty);
            });
          }
        } catch {}
        // For each fuel type, check stock
        for (const [fuelType, soldToday] of soldByFuel) {
          // v63: skip fuels with no NEW sales in this save.
          const prevAccepted = prevAcceptedByFuel.get(fuelType) || 0;
          if (soldToday <= prevAccepted + 0.001) continue;
          const fuelStocks = stockRecords.filter((s) => s.fuelType === fuelType);
          if (fuelStocks.length === 0) continue; // no tracking for this fuel
          // Find initial opening stock (earliest record with openingStock)
          const withOpening = fuelStocks
            .filter((s) => typeof s.openingStock === 'number' && Number.isFinite(s.openingStock) && s.openingStock >= 0)
            .sort((a, b) => String(a.businessDate).localeCompare(String(b.businessDate)) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
          const initialDate = withOpening[0]?.businessDate || null;
          if (initialDate && businessDate < initialDate) continue;
          const initialStock = withOpening[0]?.openingStock || 0;
          // Sum supplies up to and including businessDate
          // Field is supplyRecords (not supplies).
          let totalSupplied = 0;
          const seenSupplyIds = new Set();
          let hasSupply = false;
          fuelStocks.forEach((s) => {
            const supplies = Array.isArray(s.supplyRecords) ? s.supplyRecords : [];
            supplies.forEach((sup) => {
              if (sup.fuelType !== fuelType || !sup.businessDate ||
                  !Number.isFinite(sup.quantity) || sup.quantity <= 0 ||
                  seenSupplyIds.has(sup.id)) return;
              seenSupplyIds.add(sup.id);
              hasSupply = true;
              if (sup.businessDate > businessDate || (initialDate && sup.businessDate < initialDate)) return;
              totalSupplied += sup.quantity;
            });
          });
          if (!initialDate && !hasSupply) continue;
          // Sum sold on previous days AND same-day other operations (v69).
          // v69: Use JSON businessDate (not SQL day column) to match frontend.
          // Include: days before today (< businessDate) + same-day OTHER operations
          // (legacy duplicates / multi-op days). Exclude only the current operation.
          // v68 regression fix: v68 used < businessDate which ignored same-day others.
          let soldBefore = 0;
          try {
            const prevOps = this.db
              .prepare("SELECT data FROM petrol_records WHERE kind='operation' AND id <> ?")
              .all(id);
            prevOps.forEach((row) => {
              try {
                const op = JSON.parse(row.data);
                const opDate = String(op.businessDate || '');
                // v69: include up to and including today (but not future dates).
                if (!opDate || opDate > businessDate) return;
                if (initialDate && opDate < initialDate) return;
                soldBefore += Number(op.manualSummary?.fuel?.[fuelType]?.quantity || 0);
                (op.nozzleReadings || []).forEach((r) => {
                  if (!r.closingAccepted || r.fuelType !== fuelType) return;
                  soldBefore += getQty(r);
                });
              } catch {}
            });
          } catch {}
          const available = initialStock + totalSupplied - soldBefore;
          if (soldToday > available + 0.001) {
            const fuelName = fuelType === 'PETROL' ? 'Petrol' : 'CNG';
            fail(
              `Not enough ${fuelName} in stock. Available: ${Math.max(0, available).toFixed(1)} L. Add fuel supply first.`
            );
          }
        }
      }
    }

    this.db
      .prepare(
        `INSERT INTO petrol_records(kind,id,day,data,updated) VALUES(?,?,?,?,?)
         ON CONFLICT(kind,id) DO UPDATE SET day=excluded.day,data=excluded.data,updated=excluded.updated`,
      )
      .run(kind, id, day, JSON.stringify(kind === 'operation' ? this.petrolOperationTotals(item) : item), new Date().toISOString());

    if (kind === "operation") this.syncPetrolOperationToLedger(item);
    if (kind === "fuelStock") this.syncPetrolFuelStockToLedger(item);

    // DAY_CLOSE_UDHAAR_CHECK: when closing, total fuel udhaar must not exceed
    // total fuel sales for the day. This runs AFTER the operation and its
    // sales are saved (same transaction), so it sees the updated sales.
    // During the day incomplete readings are fine (udhaar is manager's
    // register), but at close the books must tally. On failure the whole
    // save rolls back.
    if (kind === "operation" && item.status === "CLOSED") {
      // Only fuel credit counts here.
      const dayUdhaar = this.db
        .prepare("SELECT COALESCE(SUM(amount),0) n FROM documents WHERE business='FUEL' AND kind='CREDIT' AND day=? AND reversed=0")
        .get(day).n / 100;
      const daySales = this.db
        .prepare("SELECT COALESCE(SUM(amount),0) n FROM documents WHERE business='FUEL' AND kind='FUEL_SALE' AND day=? AND reversed=0")
        .get(day).n / 100;
      if (dayUdhaar > daySales) {
        fail(
          `Day close blocked: total udhaar (Rs. ${dayUdhaar.toLocaleString()}) exceeds total fuel sales (Rs. ${daySales.toLocaleString()}) for ${day}. Correct the entries before closing.`
        );
      }
    }

    this.audit("PETROL_STATE_SAVE", { kind, id, day });
    return id;
  }
  petrolDeleteInner(kind, rawId) {
    if (kind === "station") fail("Station settings cannot be deleted.");
    const id = text(String(rawId || ""), "Record ID", 200);
    if (kind === "employee") {
      const row = this.db.prepare("SELECT data FROM petrol_records WHERE kind='employee' AND id=?").get(id);
      if (row) this.petrolPutInner("employee", { ...JSON.parse(row.data), isActive: false, deactivatedAt: new Date().toISOString() });
      return id;
    }
    // Permission check for delete: reuse the same granular checks as save.
    // A fuel-only user must not delete an operation that has expenses/cash.
    // NOTE: JSON parse is in try/catch, but permission fail() must NOT be
    // swallowed - it stays outside the try block.
    if (kind === "operation") {
      this.require("FUEL", "fuel");
      const recData = this.db
        .prepare("SELECT data FROM petrol_records WHERE kind='operation' AND id=?")
        .get(id);
      let d = null;
      if (recData) {
        try {
          d = JSON.parse(recData.data);
        } catch {}
      }
      if (d) {
        if (Array.isArray(d.expenses) && d.expenses.length > 0)
          this.require("FUEL", "expense");
        if (Array.isArray(d.cashDeposits) && d.cashDeposits.length > 0)
          this.require("FUEL", "collection");
      }
    }
    if (kind === "operation" || kind === "fuelStock") {
      // Closed-day safety: block deleting records from a closed day.
      const rec = this.db
        .prepare("SELECT day FROM petrol_records WHERE kind=? AND id=?")
        .get(kind, id);
      if (
        rec?.day &&
        this.db
          .prepare("SELECT day FROM closed_days WHERE business='FUEL' AND day=?")
          .get(rec.day)
      )
        fail("This business day is closed. Reopen it with a reason.");
      // UDHAAR_SAFETY (Fix B): Block deleting an operation that has linked
      // udhaar/credit entries. Deleting would orphan the credits and corrupt
      // cash (negative cash). Manager must fix/remove udhaar first.
      if (kind === "operation") {
        const linked = this.db
          .prepare(
            `SELECT c.id, json_extract(c.data,'$.customerName') AS customerName
             FROM documents c
             WHERE c.kind='CREDIT' AND c.reversed=0
               AND EXISTS (
                 SELECT 1 FROM documents s
                 WHERE s.id=c.link AND s.kind='FUEL_SALE' AND s.reversed=0
                   AND json_extract(s.data,'$.petrolSync')=1
                   AND json_extract(s.data,'$.petrolSourceKind')='operation'
                   AND json_extract(s.data,'$.petrolSourceId')=?
               )
             LIMIT 1`,
          )
          .get(id);
        if (linked)
          fail(
            `Cannot delete: credit entry exists for ${linked.customerName || "a customer"} on this day. Remove the credit entry first.`,
          );
      }
      this.deletePetrolSyncedDocuments(kind, id);
    }
    this.db.prepare("DELETE FROM petrol_records WHERE kind=? AND id=?").run(kind, id);
    this.audit("PETROL_STATE_DELETE", { kind, id });
    return id;
  }
  petrolStatePut(p) {
    const kind = String(p.kind || "");
    this.petrolPermission(kind, true, p.item);
    this.ensurePetrolLedgerSynced();
    return this.transaction(() => this.petrolPutInner(kind, p.item));
  }
  petrolStateDelete(p) {
    const kind = String(p.kind || "");
    this.petrolPermission(kind, true);
    this.ensurePetrolLedgerSynced();
    return this.transaction(() => this.petrolDeleteInner(kind, p.id));
  }
  // Mid-day fuel rate change: only users with FUEL "manage" permission
  // Only the owner can change rates. Old sales keep their old
  // rate (each reading snapshots its rate); new readings use the new rate.
  // The change is logged with who/when/old/new for History display.
  petrolRateChange(p) {
    this.require("FUEL", "manage");
    this.ensurePetrolLedgerSynced();
    const petrolRate = Number(p.petrolRate);
    const cngRate = Number(p.cngRate);
    if (!Number.isFinite(petrolRate) || petrolRate <= 0)
      fail("Enter a valid petrol rate.");
    if (!Number.isFinite(cngRate) || cngRate <= 0)
      fail("Enter a valid CNG rate.");
    const businessDate = p.businessDate ? date(p.businessDate) : today();
    if (businessDate > today()) fail("Rate change date cannot be in the future.");
    return this.transaction(() => {
      const sRow = this.db
        .prepare("SELECT data FROM petrol_records WHERE kind='station' AND id='station'")
        .get();
      // A database created before first-run seeding may have no station
      // record yet. Build one instead of failing the rate change.
      const station = sRow
        ? JSON.parse(sRow.data)
        : { id: "station", stationName: "My Petrol Pump", rates: {} };
      const oldPetrolRate = Number(station.rates?.PETROL) || 0;
      const oldCngRate = Number(station.rates?.CNG) || 0;
      const user = this.user(true);
      const changeId = `ratechange-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const record = {
        id: changeId,
        businessDate,
        timestamp: new Date().toISOString(),
        changedByUserId: user.id,
        changedByName: user.name || user.username || "Unknown",
        oldPetrolRate,
        newPetrolRate: petrolRate,
        oldCngRate,
        newCngRate: cngRate,
      };
      // 1. Log the change (History shows this).
      this.db
        .prepare(
          `INSERT INTO petrol_records(kind,id,day,data,updated) VALUES(?,?,?,?,?)`,
        )
        .run("rateChange", changeId, businessDate, JSON.stringify(record), new Date().toISOString());
      // 2. Update active station rates (new readings use these).
      station.rates = { PETROL: petrolRate, CNG: cngRate };
      this.db
        .prepare(
          `INSERT INTO petrol_records(kind,id,day,data,updated) VALUES(?,?,?,?,?)
           ON CONFLICT(kind,id) DO UPDATE SET day=excluded.day,data=excluded.data,updated=excluded.updated`,
        )
        .run("station", "station", "", JSON.stringify(station), new Date().toISOString());
      // 3. Keep old masters settings in sync (old flow reads these).
      const mRow = this.db
        .prepare("SELECT data FROM masters WHERE id='station' AND kind='settings'")
        .get();
      if (mRow) {
        const settings = JSON.parse(mRow.data);
        settings.petrolRate = petrolRate;
        settings.cngRate = cngRate;
        this.db
          .prepare("INSERT INTO masters VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data")
          .run("station", "settings", JSON.stringify(settings));
      }
      this.audit("PETROL_RATE_CHANGE", {
        businessDate,
        oldPetrolRate,
        newPetrolRate: petrolRate,
        oldCngRate,
        newCngRate: cngRate,
        changedBy: record.changedByName,
      });
      return record;
    });
  }
  // Udhaar (credit) entry for daily operation.
  // Manager records: "customer X took fuel worth Rs. Y on credit today".
  // Auto-allocates across today's accepted fuel sales (FUEL_SALE docs) with
  // unallocated amounts, oldest first. Requires FUEL "credit" permission
  // Each CREDIT reduces the cash-FUEL posting
  // (the sale was posted to cash in full) and increases customer outstanding.
  // Sale IDs are deterministic hashes, so operation re-save recreates the
  // same IDs and these links do not break. No duplicates: allocation is
  // checked inside the same transaction.
  addUdhaar(p) {
    this.assertWritesAllowed();
    this.require("FUEL", "credit");
    return this.transaction(() => this.addUdhaarInner(p));
  }
  addUdhaarInner(p) {
    const day = date(p.day || p.businessDate);
    if (day > today()) fail("Credit date cannot be in the future.");
    if (
      this.db
        .prepare("SELECT day FROM closed_days WHERE business=? AND day=?")
        .get("FUEL", day)
    )
      fail("This business day is closed. Reopen it to continue.");
    // Also block if the petrol operation for this day is CLOSED.
    const opClosed = this.db
      .prepare(
        "SELECT id FROM petrol_records WHERE kind='operation' AND day=? AND json_extract(data,'$.status')='CLOSED' LIMIT 1",
      )
      .get(day);
    if (opClosed)
      fail("This day is closed. Reopen it to continue.");
    const customer = this.get(p.customer, "customer");
    if (!customer.active || customer.business !== "FUEL")
      fail("Select an active fuel customer.");
    const amount = money(p.amount);
    const note = String(p.note || "").slice(0, 500);

    // Udhaar is manager's register: customer + date + amount.
    // NOT linked to any nozzle sale. A customer can take udhaar even if
    // today's sales are less than the credit amount (e.g. Rs. 600 sold,
    // Rs. 1,500 udhaar given). Expected cash = Sale - Udhaar - Expenses
    // works at day level via getUdhaarTotal(day).
    // Cash posting: reduces cash-FUEL (cash not received). Timeline validation
    // is skipped for udhaar (see command handler) because sales may not be
    // recorded yet during the day; day-close validates the totals.
    const id = this.insert(
      {
        id: p.id,
        customer: customer.id,
        account: "cash-FUEL",
        day,
        business: "FUEL",
        note,
      },
      "CREDIT",
      amount,
      [["cash-FUEL", -amount]],
      {
        customerName: customer.name,
        udhaar: 1,
      },
    );
    this.audit("UDHAAR", {
      customer: customer.id,
      customerName: customer.name,
      amount,
      day,
      count: 1,
    });
    return [id];
  }
  // FIX 2: Return total udhaar (CREDIT) for a business day, in Rs.
  // Used by Daily Operation to show correct expected cash: sale - udhaar - expenses.
  getUdhaarTotal(p) {
    // Single-user build: the owner is the only user, so this check
    // always allows. It is kept so every read goes through one check.
    // Only fuel credit counts in the total.
    this.require("FUEL", "view");
    const day = date(p.day || p.businessDate);
    const row = this.db
      .prepare(
        "SELECT COALESCE(SUM(amount),0) n FROM documents WHERE business='FUEL' AND kind='CREDIT' AND day=? AND reversed=0",
      )
      .get(day);
    return { total: (Number(row.n) || 0) / 100 };
  }
  // All-or-nothing save of several Petrol Pump records in one transaction.
  petrolStateBatch(p) {
    const ops = Array.isArray(p.ops) ? p.ops : [];
    if (ops.length === 0) return { saved: 0 };
    if (ops.length > 500) fail("Too many records in one save.");
    for (const op of ops) this.petrolPermission(String(op.kind || ""), true, op.item);
    this.ensurePetrolLedgerSynced();
    return this.transaction(() => {
      for (const op of ops) {
        const kind = String(op.kind || "");
        if (op.action === "delete") this.petrolDeleteInner(kind, op.id);
        else this.petrolPutInner(kind, op.item);
      }
      return { saved: ops.length };
    });
  }
  petrolStateImport(p) {
    this.admin();
    this.assertWritesAllowed();
    const data = p.data;
    if (!data || typeof data !== "object") fail("Invalid Petrol Pump migration data.");
    const existing = this.db.prepare("SELECT 1 n FROM petrol_records LIMIT 1").get();
    if (existing) fail("Petrol Pump SQLite storage already contains data.");
    const groups = [
      ["station", data.station ? [data.station] : []],
      ["pump", Array.isArray(data.pumps) ? data.pumps : []],
      ["nozzle", Array.isArray(data.nozzles) ? data.nozzles : []],
      ["employee", Array.isArray(data.employees) ? data.employees : []],
      ["operation", Array.isArray(data.operations) ? data.operations : []],
      ["fuelStock", Array.isArray(data.fuelStock) ? data.fuelStock : []],
    ];
    return this.transaction(() => {
      const insert = this.db.prepare(
        "INSERT INTO petrol_records(kind,id,day,data,updated) VALUES(?,?,?,?,?)",
      );
      let count = 0;
      for (const [kind, items] of groups) {
        for (const item of items) {
          if (!item || typeof item !== "object" || Array.isArray(item))
            fail("Invalid Petrol Pump migration record.");
          const id = kind === "station" ? "station" : text(String(item.id || ""), "Record ID", 200);
          const day =
            kind === "operation"
              ? date(item.businessDate)
              : kind === "fuelStock"
                ? date(item.businessDate)
                : null;
          insert.run(kind, id, day, JSON.stringify(item), new Date().toISOString());
          count += 1;
        }
      }
      const operations = Array.isArray(data.operations) ? data.operations : [];
      const fuelStock = Array.isArray(data.fuelStock) ? data.fuelStock : [];
      for (const operation of operations) this.syncPetrolOperationToLedger(operation);
      for (const record of fuelStock) this.syncPetrolFuelStockToLedger(record);
      this.setMeta("petrol-ledger-sync-v1", "1");

      this.audit("PETROL_STATE_IMPORT", {
        records: count,
        syncedOperations: operations.length,
        syncedFuelStock: fuelStock.length,
      });
      return {
        records: count,
        syncedOperations: operations.length,
        syncedFuelStock: fuelStock.length,
      };
    });
  }
  close() {
    this.db.close();
  }
}
module.exports = { BusinessStore, BUSINESSES, today };
