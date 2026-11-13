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
- **Job numbers:** every job gets a number like **TH-1042**. Search by number, name, phone or address.
- **Money (staff only):** each job has a **customer price** (what the customer pays) and a **crew pay** (what Top Hat pays the contractor). The app shows Top Hat's profit and margin.
- **Files, one folder per job:** upload estimates, contracts, invoices, receipts, permits and photos to the job. The file type is guessed from the file name and can be changed. A checklist shows whether the estimate, contract and invoice are in. The customer's own request photos are included.
- **Text job details to the crew:** opens a text message to the assigned crew lead with the job number, address, time, customer contact and job description filled in.
- **Crew:** add, edit or deactivate your contractors and the trades they cover.

### Who sees what

| | Top Hat staff | Customer | Crew |
|---|---|---|---|
| Job details, address, schedule | ✓ | ✓ | ✓ (via text) |
| Customer price | ✓ | only in documents you share | **never** |
| Crew pay and profit | ✓ | **never** | **never** |
| Internal notes and activity | ✓ | never | never |
| Files | ✓ | only files marked "Customer can see" | **never** |

Crew don't log in. They only receive the job text, which never includes prices, the customer's budget, notes or files.

Status names: staff see *New lead, Qualifying, Scheduled, In progress, Completed, Not a fit*. Customers see *Received, Reviewing, Scheduled, In progress, Completed, Closed*.

## Preview mode (current)

Right now all data is saved in the browser (`localStorage`, with files in IndexedDB), so you can try the full flow on one device:

1. Open `index.html` and request a job.
2. Open `admin.html` and log in with **office@tophat.demo** / **tophat**.

Sample leads and crew are included. Use **Reset preview data** at the bottom of the staff area to start over.

**Next step to go live:** connect a hosted database, file storage and login service (Supabase is the plan), so leads and files are shared across every phone and computer. All data access goes through `TH.api` in `data.js`, so only that file changes. The staff-only rules above must then be enforced by the database's access rules, not just hidden in the screens.

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
