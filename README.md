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
- **Lead details:** call, text or email the customer in one tap. Set the status, pick a crew (★ marks crews who do that kind of work), set the date, and keep internal notes the customer never sees. Each lead also keeps an activity history.
- **Job numbers:** every job gets a number like **TH-1042**. Search by number, name, phone or address.
- **Money (staff only):** each job has a **customer price** (what the customer pays) and a **crew pay** (what Top Hat pays the contractor). The app shows Top Hat's profit and margin.
- **Files, one folder per job:** upload estimates, contracts, invoices, receipts, permits and photos to the job. The file type is guessed from the file name and can be changed. A checklist shows whether the estimate, contract and invoice are in. The customer's own request photos are included.
- **Text job details to the crew:** opens a text message to the assigned crew lead with the job number, address, time, customer contact and job description filled in.
- **Crew photo upload link:** each assigned job gets a private link, included at the end of the crew text (there's also a **Copy link** button). The contractor taps it, with no app or password, sees the job basics, picks **Before / During / After**, adds an optional note and uploads photos. They land in that job's Files, labeled with who sent them. Reassigning the job to another crew makes a new link and turns the old one off.
- **Crew:** add, edit or deactivate your contractors and the trades they cover.

### Who sees what

| | Top Hat staff | Customer | Crew |
|---|---|---|---|
| Job details, address, schedule | ✓ | ✓ | ✓ (via text) |
| Customer price | ✓ | only in documents you share | **never** |
| Crew pay and profit | ✓ | **never** | **never** |
| Internal notes and activity | ✓ | never | never |
| Files | ✓ | only files marked "Customer can see" | only the photos they uploaded |

Crew don't log in. They receive the job text and use the photo upload link. Neither includes prices, the customer's budget, staff notes or other files. On the upload page they see only the job basics and the photos they sent themselves. Crew photos start out hidden from the customer.

Status names: staff see *New lead, Qualifying, Scheduled, In progress, Completed, Not a fit*. Customers see *Received, Reviewing, Scheduled, In progress, Completed, Closed*.

## Preview mode (current)

Right now all data is saved in the browser (`localStorage`, with files in IndexedDB), so you can try the full flow on one device:

1. Open `index.html` and request a job.
2. Open `admin.html` and log in with **office@tophat.demo** / **tophat**.

Sample leads and crew are included. Use **Reset preview data** at the bottom of the staff area to start over.

## Going live (Supabase)

The app switches from preview mode to the live database as soon as `config.js` has a Supabase project URL and publishable (anon) key.

1. Create a Supabase project.
2. Run `supabase/schema.sql` once in the project's SQL Editor. It creates the tables, job numbers, file storage and all the security rules, and refuses to run again once real jobs exist.
3. In **Authentication → Sign In / Providers → Email**, turn off **Confirm email**, so customers can send their request right after signing up. Set **Authentication → URL Configuration → Site URL** to the app's address.
4. Create staff logins under **Authentication → Users → Add user**. Then mark them as staff in the SQL Editor:
   ```sql
   update public.profiles set role = 'staff' where email = 'office@yourcompany.com';
   ```
5. Put the project URL and publishable key in `config.js`. Never use the secret / service_role key.

Who-sees-what is enforced by the database (row-level security and storage policies in `schema.sql`):
- Customers only reach their own jobs, through `my_jobs()`.
- Prices, crew pay and notes live in the staff-only `job_private` table.
- Crew reach a job only through its private upload code.

`supabase/` also holds the security test that runs the schema against Postgres and checks each rule.

## Run it locally

```sh
python3 -m http.server 8000
# customer site: http://localhost:8000
# staff area:    http://localhost:8000/admin.html
```

## Files

- `index.html`, `buyer.js`: customer site
- `admin.html`, `admin.js`: staff area
- `crew.html`, `crew.js`: crew photo upload page (opened from the link in the job text)
- `data.js`: preview data layer (`TH.api`, browser storage), plus the lists of trades, timeframes, budgets and statuses
- `supabase-backend.js`: live data layer (same `TH.api`, backed by Supabase)
- `config.js`: Supabase project URL and publishable key (empty = preview mode)
- `supabase/schema.sql`: database setup and security rules
- `vendor/supabase-2.118.0.js`: Supabase JavaScript client (MIT license)
- `styles.css`: shared styling
