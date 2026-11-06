// CSV export rules. Run: node --test tests/csv.test.cjs
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { csvCell, toCsv } = require("../electron/csv.cjs");

test("formula-like text gets a leading apostrophe", () => {
  for (const bad of ["=1+1", "+cmd", "-cmd", "@SUM(A1)", "\tTAB", "=HYPERLINK(\"http://x\")"]) {
    assert.ok(csvCell(bad).startsWith("\"'"), bad);
  }
});

test("plain numbers, including negative ones, are left alone", () => {
  assert.equal(csvCell("-120.50"), "\"-120.50\"");
  assert.equal(csvCell(-5), "\"-5\"");
  assert.equal(csvCell("350.00"), "\"350.00\"");
});

test("quotes are doubled and null becomes an empty cell", () => {
  assert.equal(csvCell("say \"hi\""), "\"say \"\"hi\"\"\"");
  assert.equal(csvCell(null), "\"\"");
  assert.equal(csvCell(undefined), "\"\"");
});

test("toCsv adds a BOM and CRLF row breaks", () => {
  const text = toCsv([["a", "b"], ["1", "2"]]);
  assert.ok(text.startsWith("\uFEFF"));
  assert.equal(text.slice(1), "\"a\",\"b\"\r\n\"1\",\"2\"");
});

test("exporting over an existing file replaces it (the save dialog allows this)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fsm-csv-"));
  const file = path.join(dir, "report.csv");
  fs.writeFileSync(file, "old");
  // This is exactly the call the export handlers make.
  fs.writeFileSync(file, toCsv([["new"]]), "utf8");
  assert.equal(fs.readFileSync(file, "utf8"), "\uFEFF\"new\"");
  fs.rmSync(dir, { recursive: true, force: true });
});
