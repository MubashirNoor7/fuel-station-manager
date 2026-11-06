# Contributing

Thanks for helping. This app handles real money and stock for a petrol pump,
so correctness matters more than speed.

## Setup

Node.js 24 or later is required.

```sh
npm install
npm run build
npm run test:all
npm start
```

## Before opening a pull request

1. `npm run build` passes (this runs the TypeScript check).
2. `npm run test:all` passes.
3. Any change to how money, stock, readings or customer balances are
   calculated comes with a test that fails without the change.
4. Keep pull requests small and focused on one thing.

## Rules that must not break

- Money in the database is whole paisas (integers). Do not store rupees as floats.
- A saved reading keeps the rate it was saved with.
- A closed day can only change through the "reopen with a reason" flow, and
  that is written to the audit log.
- Exports must never turn text into a spreadsheet formula (see `electron/csv.cjs`).
- Tests must never touch a real database: use `:memory:` or a temp folder.

## Reporting bugs

Use the bug template. Never attach a real database or customer names; describe
the entries instead.
