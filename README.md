# Top Hat Contracting

A job-request app for Top Hat Contracting. Customers post a job and create an account. Top Hat staff qualify each lead, schedule the work and send one of their own crews.

## How it works

**Customers** (`index.html`)
1. Pick the type of work (plumbing, roofing, painting…).
2. Describe the job: address, ZIP, timeframe, optional budget and up to 5 photos.
3. Create an account with name, mobile phone, email and password. The request is sent as soon as the account is created.
4. Check **My jobs** anytime to see the status (Received → Reviewing → Scheduled → Done), plus the date and the crew lead's name once it's scheduled.

**Top Hat staff** (`admin.html`)
- **Leads:** every request, with counts by status, an open-job value total, filters and search.
- **Lead details:** call, text or email the customer in one tap. Set the status, pick a crew (★ marks crews who do that kind of work), set the date and estimated value, and keep internal notes the customer never sees. Each lead also keeps an activity history.
- **Text job details to the crew:** opens a text message to the assigned crew lead with the address, time, customer contact and job description filled in.
- **Crew:** add, edit or deactivate your contractors and the trades they cover.

Status names: staff see *New lead, Qualifying, Scheduled, In progress, Completed, Not a fit*. Customers see *Received, Reviewing, Scheduled, In progress, Completed, Closed*.

## Preview mode (current)

Right now all data is saved in the browser (`localStorage`), so you can try the full flow on one device:

1. Open `index.html` and request a job.
2. Open `admin.html` and log in with **office@tophat.demo** / **tophat**.

Sample leads and crew are included. Use **Reset preview data** at the bottom of the staff area to start over.

**Next step to go live:** connect a hosted database and login service (Supabase is the plan), so leads from any customer's phone reach the staff area. All data access goes through `TH.api` in `data.js`, so only that file changes.

## Run it locally

```sh
python3 -m http.server 8000
# customer site: http://localhost:8000
# staff area:    http://localhost:8000/admin.html
```

## Files

- `index.html`, `buyer.js`: customer site
- `admin.html`, `admin.js`: staff area
- `data.js`: data layer (`TH.api`), plus the lists of trades, timeframes, budgets and statuses
- `styles.css`: shared styling
