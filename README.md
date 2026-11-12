# Life Dashboard

A personal dashboard for your day, all on one page. It needs no build step, server or account.

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
- Light and dark themes (☾). They follow your system setting by default.

## Run it

Open `index.html` in a browser. To serve it locally instead:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Your data

Everything is saved in your browser's `localStorage` under the key `lifedash.v1`. Nothing leaves your device. Use **⚙ → Export backup** to save a JSON file, and **Import backup** to restore it on another device or browser.

## Files

- `index.html`: layout
- `styles.css`: styling, including light/dark themes and the phone layout
- `app.js`: all logic and saving
