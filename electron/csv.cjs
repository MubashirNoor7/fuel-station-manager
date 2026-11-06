// Shared CSV helpers for every export in the app.
//
// Two rules live here so they are the same everywhere:
//  1. Text that a spreadsheet could run as a formula (starts with = + - @ tab
//     or carriage return) gets a leading apostrophe, so a customer or note
//     named "=HYPERLINK(...)" cannot execute when the file is opened.
//  2. Plain numbers, including negative ones such as "-120.50", are NOT
//     touched. Otherwise a negative difference would be exported as text.
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

function csvCell(value) {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s) && !PLAIN_NUMBER.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}

// Returns the full file text: UTF-8 BOM (so Excel reads Urdu/Unicode names
// correctly) followed by CRLF-separated rows.
function toCsv(rows) {
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

module.exports = { csvCell, toCsv };
