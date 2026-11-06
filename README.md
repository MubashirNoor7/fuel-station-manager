# FuelStation Manager

A desktop app for running one petrol pump, built with Electron, React
and SQLite. It opens straight to the dashboard — there is no sign-in. The
project is going online: cloud sync, an owner mobile app and an online
dashboard are on the roadmap below.

## What it does

- **Daily nozzle readings** — enter opening and closing meter readings per
  nozzle and shift. The sale is calculated as
  (closing − opening) × rate, and a reading cannot be accepted twice.
- **Fuel stock** — record opening stock and fuel supplies. A reading is blocked
  when there is not enough fuel in stock for it.
- **Fuel rates** — petrol and CNG rates with a rate history. Changing the rate
  only affects new readings; readings already saved keep their old rate.
- **Customers and credit (udhaar)** — keep a customer list with balances, give
  credit, receive repayments, and see each customer's statement with a running
  balance. A repayment larger than the balance is rejected.
- **Expenses** — record daily expenses with categories, and reverse an entry
  with a reason when a mistake is made.
- **Dashboard** — the day's totals at a glance: fuel sold, sales amount,
  credit given, expenses and expected cash.
- **History** — past days with their totals. A day can be closed once its
  readings are complete; closing is blocked when the day's total credit is
  more than the day's total fuel sales. A closed day can be reopened with a
  reason to fix an entry.
- **Print and export** — print the daily sheet, print the history report, or
  export the history as CSV.
- **Dates** — all dates use the Asia/Karachi timezone, so a day never flips at
  midnight UTC.

## Getting started

Node.js 24 or later is required.

```sh
npm install
npm run build    # type-check and build the frontend
npm start        # run the desktop app
npm run dev      # start the frontend dev server (port 3000)
```

To package a Windows app, run `npm run dist` (`electron-builder` is included
as a dev dependency; see the `build` section of `package.json`).

## Tests

```sh
npm run test:all   # calculations, store, readings, stock and date checks
```

The suites run against in-memory or temporary test databases and never touch real data.

## Roadmap

This is an early-stage project in active development. The project is growing
fast. The next steps take it online:

- **Cloud sync** — the same data on more than one device (desktop + mobile).
- **Mobile app for the owner** — check the pump from anywhere (the dashboard,
  on the phone).
- **Online dashboard** — view the same daily sales and stock from a browser.
- **Automatic daily backup to cloud** — the day's data saved to the cloud
  without anyone having to remember it.
- **SMS / WhatsApp alerts** — the owner gets the news when stock runs low or
  a day is not closed.
- **Online payment records** — when a customer pays online, the repayment is
  recorded automatically.

These are plans for what comes next, not features that exist today.
Contributions and feedback are welcome.

## License

MIT — see [LICENSE](LICENSE).
