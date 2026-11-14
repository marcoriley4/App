# Top Hat Contracting

A job-request app for Top Hat Contracting. Customers post a job and create an account. Top Hat staff qualify each lead, schedule the work and send one of their own crews.

## How it works

**Customers** (`index.html`)
1. Pick the type of work (plumbing, roofing, painting…).
2. Describe the job: address, ZIP, timeframe, optional budget and up to 5 photos.
3. Create an account with name, mobile phone, email and password. The request is sent as soon as the account is created.
4. Check **My jobs** anytime to see the status (Received → Reviewing → Scheduled → Done), plus the date and the crew lead's name once it's scheduled.

**Top Hat staff** (`admin.html`)
- **Today** (the home screen) shows only what needs attention: new leads to call (with a Call button), new crew notes, approved estimates that need a crew and date, finished jobs that need an invoice, unpaid invoices, estimates waiting on the customer, and jobs on the schedule today and tomorrow. When nothing is waiting, it says "All caught up."
- **Each job opens with a summary** (customer, address, date, crew, price and profit) and a **Next step** card with one clear button: Call the customer → Send an estimate → Schedule a crew → Text the job to the crew → Mark finished → Send the invoice → Record payment. A **progress bar** (New → Qualifying → Scheduled → Working → Done) shows where the job is, and you can tap it to change the status. The rest of the job is split into tabs: **Overview, Money, Files, Notes & history**.
- **Jobs** lists every job with filters (Open, New, Scheduled, Done, Closed, All) and search. "Open" includes finished jobs that still need an invoice or payment. Cards show flags only when something needs attention.
- **Leads:** every request, with counts by status, an open-job value total, filters and search.
- **Lead details:** call, text or email the customer in one tap. Set the status, pick a crew (★ marks crews who do that kind of work), set the date, and keep internal notes the customer never sees. Each lead also keeps an activity history.
- **Job numbers:** every job gets a number like **TH-1042**. Search by number, name, phone or address.
- **Money (staff only):** each job has a **customer price** (what the customer pays) and a **crew pay** (what Top Hat pays the contractor). The app shows Top Hat's profit and margin.
- **Files, one folder per job:** upload estimates, contracts, invoices, receipts, permits and photos to the job. The file type is guessed from the file name and can be changed. A checklist shows whether the estimate, contract and invoice are in. The customer's own request photos are included.
- **Text job details to the crew:** opens a text message to the assigned crew lead with the job number, address, time, customer contact and job description filled in.
- **Crew photo upload link:** each assigned job gets a private link, included at the end of the crew text (there's also a **Copy link** button). The contractor taps it, with no app or password, sees the job basics, picks **Before / During / After**, adds an optional note and uploads photos. They land in that job's Files, labeled with who sent them. Reassigning the job to another crew makes a new link and turns the old one off.
- **Estimates & invoices:** create them from any job, prefilled with the customer, job number, address and description. Add line items and tax, then **Send to customer**. The customer sees it in My jobs and can **approve an estimate with one tap**, which also sets the job's customer price. You can **turn an approved estimate into an invoice** in one tap, and **record payments** by cash, check, Zelle, card, Venmo, Cash App or other, including partial payments. The invoice shows Partly paid, Paid or Overdue on its own. You can add an optional Square or Stripe **"Pay by card" link**, text or email the customer a link, void an invoice, and **print or save a PDF**. Approved estimates and paid invoices are locked. **Crew pay never appears** on any estimate or invoice.
- **Business tab:** company name, phone, email, address, license #, default tax rate, invoice due days, "how customers can pay" (Zelle, Venmo and so on), and default terms. All of these print on every estimate and invoice.
- **Crew notes:** the contractor on a job can write notes for the office ("need 2 more bundles", "customer not home") from their crew login (📝 Notes on each job) or the job's photo link. The office sees them in a **💬 Crew notes** card near the top of the job, with who wrote each one and when. The job shows **"💬 New crew note"** in the Leads list until someone opens it. Customers never see crew notes, and a contractor only sees their own.
- **Crew:** add, edit or deactivate your contractors and the trades they cover.
- **Crew login:** open a crew member and tap **Create invite link**, then **Text invite**. The link works once and only for that person. They set their own email and password, then sign in at `crew.html` to see **only the jobs assigned to them**: date, address, customer name and phone, and the job description. From there they can send photos and tap **Started** or **Finished**, which updates the job's status (shown in the job history with their name). They see their **own crew pay** and totals, and you can switch that off under **Business → Show crew their pay**. **Turn off login** removes access right away. Crew can still use the per-job photo link from the job text without logging in.

### Who sees what

| | Top Hat staff | Customer | Crew |
|---|---|---|---|
| Job details, address, schedule | ✓ | ✓ | ✓ (via text) |
| Customer price | ✓ | only in documents you share | **never** |
| Crew pay | ✓ | **never** | their own only (can be switched off) |
| Profit | ✓ | **never** | **never** |
| Internal (office) notes and activity | ✓ | never | never |
| Crew notes | ✓ | never | their own only |
| Estimates & invoices | ✓ (incl. drafts) | the ones you send (never drafts) | **never** |
| Files | ✓ | only files marked "Customer can see" | only the photos they uploaded |

Crew either sign in with their crew login, or just use the photo upload link from the job text. Neither includes prices, the customer's budget, staff notes or other files. On the upload page they see only the job basics and the photos they sent themselves. Crew photos start out hidden from the customer.

Status names: staff see *New lead, Qualifying, Scheduled, In progress, Completed, Not a fit*. Customers see *Received, Reviewing, Scheduled, In progress, Completed, Closed*.

## Preview mode (current)

Right now all data is saved in the browser (`localStorage`, with files in IndexedDB), so you can try the full flow on one device:

Everyone uses **one login** (the **Log in** button on the customer site, or `admin.html` / `crew.html` directly). After signing in, each account goes to its own area: **staff → staff area, customers → My jobs, crew → their crew jobs**.

In preview mode the login page has **"Try it as…"** buttons for three sample accounts:
- **Top Hat office** (staff): **office@tophat.demo** / **tophat**
- **Customer**: **dana@example.com** / **demo1234**
- **Contractor**: **ray@tophat.demo** / **crew1234**

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

`supabase/` also holds the security test that runs the schema against Postgres and checks each rule (109 checks).

## Run it locally

```sh
python3 -m http.server 8000
# customer site: http://localhost:8000
# staff area:    http://localhost:8000/admin.html
```

## Files

- `index.html`, `buyer.js`: customer site
- `admin.html`, `admin.js`: staff area
- `crew.html`, `crew.js`: crew sign-in and My jobs, crew invite setup, and the per-job photo upload page
- `data.js`: preview data layer (`TH.api`, browser storage), plus the lists of trades, timeframes, budgets and statuses
- `supabase-backend.js`: live data layer (same `TH.api`, backed by Supabase)
- `config.js`: Supabase project URL and publishable key (empty = preview mode)
- `supabase/schema.sql`: database setup and security rules
- `vendor/supabase-2.118.0.js`: Supabase JavaScript client (MIT license)
- `docs.js`: estimate and invoice totals, statuses, and the printable document
- `styles.css`: shared styling, including print styles for PDFs
