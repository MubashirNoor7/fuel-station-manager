// Database backup. Run: node --test tests/backup.test.cjs
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { BusinessStore } = require("../electron/business-store.cjs");
const { backupDatabase } = require("../electron/backup.cjs");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fsm-backup-"));
}

test("backup of a live WAL database contains recent data and is readable", () => {
  const dir = tempDir();
  const store = new BusinessStore(path.join(dir, "live.sqlite"));
  store.audit("TEST_ENTRY", { n: 1 });
  const target = path.join(dir, "backup.sqlite");
  backupDatabase(store.db, target);

  const copy = new DatabaseSync(target);
  const row = copy.prepare("SELECT action FROM audit WHERE action='TEST_ENTRY'").get();
  assert.equal(row.action, "TEST_ENTRY");
  assert.equal(copy.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  copy.close();
  store.db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("backup can overwrite an older backup and leaves no temp file", () => {
  const dir = tempDir();
  const store = new BusinessStore(path.join(dir, "live.sqlite"));
  const target = path.join(dir, "backup.sqlite");
  fs.writeFileSync(target, "old junk");
  backupDatabase(store.db, target);
  assert.ok(fs.statSync(target).size > 1000);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp")), []);
  store.db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a failed backup keeps the older backup untouched", () => {
  const dir = tempDir();
  const store = new BusinessStore(":memory:");
  const target = path.join(dir, "missing-folder", "backup.sqlite");
  assert.throws(() => backupDatabase(store.db, target));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("empty target is rejected", () => {
  const store = new BusinessStore(":memory:");
  assert.throws(() => backupDatabase(store.db, ""), /Choose where/);
});
