# App
Build an app that can connect contractors to buyers.

## Groundwork website

A static website (plain HTML, CSS and JavaScript, no build step) that connects buyers with contractors.

- **Find contractors**: search and filter by trade, rating and keyword, then open a profile and request a quote.
- **Job board**: buyers' open jobs, where contractors can send quotes.
- **Post a job**: buyers post a job, which appears on the board right away.

### Run it

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

Contractor and job data is sample data. Jobs you post are saved in your browser's `localStorage`. There is no backend yet.
