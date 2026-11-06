// Consistent copy of the live SQLite database.
//
// The app runs SQLite in WAL mode, so simply copying business.sqlite while the
// app is open can miss recent data that still sits in the -wal file.
// VACUUM INTO writes a complete, consistent snapshot instead.
const fs = require("node:fs");
const path = require("node:path");

function backupDatabase(db, target) {
  if (typeof target !== "string" || !target.trim())
    throw new Error("Choose where to save the backup.");
  const tmp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.tmp`,
  );
  try {
    fs.rmSync(tmp, { force: true });
    db.prepare("VACUUM INTO ?").run(tmp);
    // Written to a temp file first, so a failed backup never destroys an
    // older good backup that the user chose to overwrite.
    fs.renameSync(tmp, target);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
  return target;
}

module.exports = { backupDatabase };
