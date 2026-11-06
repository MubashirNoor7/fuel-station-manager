# Security policy

## Supported versions

Only the latest release is supported.

## Threat model (what this app does and does not protect against)

FuelStation Manager is a local, single-user desktop app.

It does:
- run the interface in a sandboxed window with `contextIsolation` on and
  `nodeIntegration` off, and accept requests only from its own main window;
- keep all data on the local computer (no network access by the app);
- neutralise spreadsheet-formula text in CSV exports.

It does **not**:
- have a login, so anyone with access to the running app can use it;
- encrypt the database file, so anyone with access to the file can read it.

Treat physical and Windows-account access to the computer as the security
boundary until an app lock is added.

## Reporting a vulnerability

Please report privately through GitHub:
<https://github.com/MubashirNoor7/fuel-station-manager/security/advisories/new>

Do not open a public issue for a vulnerability. Expect a first reply within a
few days. Please do not include real customer or business data in a report.
