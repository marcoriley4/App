# Life Dashboard

A personal dashboard for your phone. It installs to your home screen like an app and works offline. It needs no build step, server or account.

## What's on it

- **Today's one thing**: a single focus for the day. It clears itself each morning.
- **At a glance**: tasks done, habits checked today, your best streak, and money spent this month.
- **Tasks**: add, check off, delete, and clear completed tasks.
- **Habits**: a 7-day check-in grid with a 🔥 streak count for each habit. Double-click a habit name to remove it.
- **Wellbeing**: daily mood (1–5), water, sleep and exercise, plus a 14-day mood trend.
- **Goals**: number-based goals (e.g. 24 books) with +/− buttons and progress bars.
- **Money**: a monthly budget, quick expense logging by category, and a breakdown by category. The bar turns amber if you're spending faster than the month is passing, and red when you go over budget.
- **Journal**: one entry per day that saves as you type, with a list of past entries.
- **Settings (⚙)**: your name for the greeting, currency symbol, export/import backup, and reset.
- Light and dark themes (set in ⚙). They follow your phone's setting by default.

The app has a tab bar along the bottom: **Today** (focus, stats, tasks, goals), **Habits**, **Health**, **Money** and **Journal**.

## Put it on your phone

The app needs to be hosted on a web address once, for example with GitHub Pages. Then:

- **iPhone (Safari):** open the address, tap **Share**, then **Add to Home Screen**.
- **Android (Chrome):** open the address, tap **⋮**, then **Install app** (or **Add to Home screen**).

It opens full screen from its icon and keeps working with no connection.

## Run it locally

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

The offline support (`sw.js`) only runs when the app is served over http(s), not when you open the file directly.

## Your data

Everything is saved on your phone, in the browser's `localStorage` under the key `lifedash.v1`. Nothing leaves your device. Use **⚙ → Export** to save a backup file (on a phone this opens the share sheet, so you can save it to Files, Drive or email), and **Import** to restore it.

## Files

- `index.html`: layout
- `styles.css`: styling, including light/dark themes and the phone layout
- `app.js`: all logic and saving
- `manifest.webmanifest`, `icons/`: the app's name and home-screen icon
- `sw.js`: offline support (caches the app files)
