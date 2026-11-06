# Changelog

## Unreleased

### Fixed
- CSV export failed with an "already exists" error when saving over an existing
  file. Both exports now overwrite the file the user chose in the save dialog.
- CSV export turned negative numbers (for example a negative cash difference)
  into text by adding an apostrophe. Plain numbers are now left unchanged;
  only formula-like text is neutralised.

### Added
- *File → Back up database…* (Ctrl+B): consistent backup of the live database.
- Shared CSV helper (`electron/csv.cjs`) with tests; backup helper with tests.
- Continuous integration, Windows installer release workflow, issue and pull
  request templates, contributing guide, security policy, code of conduct.
- Windows installer target (NSIS) instead of an unpacked folder.

### Changed
- Developer tools are only available when running from source, not in the
  packaged app.
- README rewritten: removed unsupported claims, added limitations, backup and
  restore instructions.

## 0.1.0
- First public version.
