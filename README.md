# Top Hat Contracting

A job-request app for Top Hat Contracting. Customers post a job and create an account. Top Hat staff qualify each lead, schedule the work and send one of their own crews.

### The business model: only hot leads get a visit

Reps and crews only go out to customers who have already agreed to the price, so nobody's time is wasted:

1. **Request:** the customer sends their project with measurements and photos (or the office enters a phone-in job).
2. **Phone estimate:** the office or a salesperson calls, goes over the job and quotes a price. On the job's **Next step** card they enter the price and tap what the customer said: **🔥 They agreed** (the job becomes a **Hot lead**), **🤔 Thinking it over** (stays in follow-up), or **👎 Not interested** (closed). A written estimate approved in the app also makes it a hot lead.
3. **Rep visit:** for a hot lead, pick a sales rep and a date and time for the walkthrough, then text the customer the visit time in one tap.
4. **Sold:** after the visit, tap **✅ Sold: pick crew & date** (or **Didn't close**). The crew takes it from there.

**💾 Saving designs (before & after):** in the Design studio, any picture can be saved with **💾 Save to the project** (customer, office or rep). Saving a design also saves the photo it started from as its **Before**, so everyone sees where it was and where it's going. They go into the job's **📸 Photos & papers** (labeled "🎨 Before" / "🎨 After (design)") and show as a **before / after slider** for everyone on the job (drag left to right to reveal the before, right to left to reveal the after): the office (top of Photos & papers), the customer (**🎨 Your design: before & after** on their job) and the contractor (on their job page). Several designs from the same photo share one Before. **Remove** takes a design back out; its Before goes too once no saved design uses it.

**🎨 Design studio (AI remodel pictures):** on **My jobs**, customers tap **Design studio**, take or upload a photo of the space, and describe what they want ("take out the center island, L-shaped kitchen along the north and south walls, white shaker cabinets, quartz counters"). Google's Gemini image AI returns a picture of the remodel. They keep asking for changes (each starts from the picture on screen, or any earlier one) until it's right, then tap **⭐ This is the one**. The office sees the chosen picture and every change on the job, and reps can open the same studio with the customer at the visit. Connect it once: as the office, open any job's **🎨 Design studio** and use **🔌 Connect Gemini to make pictures** (get a key at aistudio.google.com/apikey, paste it, tap Connect; the app checks it with Google). In preview the key is saved only in that browser; live, it's the server secret GEMINI_API_KEY (see Going live). Pictures are capped at 40 per job per day to keep costs down.

**📋 Building permits:** customers tap **Apply for me** on their job, tick the box and type their name to authorize Top Hat to apply. The job then shows on **Today → Permits to apply for**. Each job's **Building permit** card has **Find the building department** (a search for that town's permit site), the department's website (remembered for every job in that town), a printable **permit packet** with the property, owner, contractor, scope, job value, the chosen design and the owner's signature, and the status and permit number, which the customer sees. Every town has its own permit website and account (and many require the licensed contractor to apply), so the application itself is submitted on that site; there's no single national system to send it to automatically.

**✍️ Signatures on every estimate and invoice:** every printed estimate and invoice has a customer signature section: the signature once it's signed, or lines to sign (Signature, Printed name, Date) until then. Customers sign an estimate with **Review & sign estimate**; an invoice is signed when they **Pay now**, and any invoice or phone-approved estimate that still isn't signed shows **✍️ Sign invoice/estimate** on their job (even after the office records a cash or check payment). In the office, any unsigned invoice or estimate has **✍️ Customer signs here (in person)** so the rep can get the signature on their phone; it prints as "Signed in person with …". Each signature goes in the job's history.

**💳 Make a payment:** every unpaid invoice shows a big **Make a payment** button on the customer's job. It offers **Pay by card** (the card payment link from Business, or one pasted on that invoice), your Zelle/bank details, and **Pay now**, where they enter the amount and how they're paying, and sign to authorize it (the signature prints on the invoice; unsigned invoices print with signature lines). That shows on **Today → Payments to confirm** and on the invoice. Tap **Got it: record payment** once the money's in, or **Not received**. Fully automatic card payments (money in, invoice marked paid with no one tapping) need a Stripe account, which can be connected when the app goes live.

**🗺 Organized by state:** customers pick the state of their project when they request a job (it's filled in from the ZIP code, and they can change it). The office can filter **Jobs** and **📁 Customers** by state, and each job shows its state with a menu to change it (logged in the job's history). Contractors have a **State they work in**; the **Contractors** tab groups them by state, and the crew picker on a job lists that state's crews first and marks crews from other states. The office's new-job form fills the state in from the ZIP too. Spreadsheets include a State column. The state you pick on Jobs, Customers or Crew stays picked as you move between them.

**🌟 Design it while requesting the job (every request):** step 2 of every request is **Design it: before and after**: **1. your before photo**, then **2. your dream**: room projects (remodel, painting, flooring, drywall, other) pick the room and one of three looks; everything else (roofing, decks, siding, fencing…) describes it with one-tap ideas ("Charcoal architectural shingles"). **✨ Show me my dream roof / kitchen / deck** makes the AFTER from all their photos together (photo 1 is the main view; the others show the AI the whole room), shown as a before/after slider; they can change something and **🔁 Make it again**, then **❤️ Love it: next**. When they send the request, the before and after are saved to the job (and into Photos & papers for everyone, with the slider), the dream words go into the job details, and the office sees it on Today's new-lead row and at the top of the lead. If they skip the preview, it's made right after they send it. Sign-up allows 3 designs for new customers who aren't logged in (the buttons stop after the 3rd; more can be made in the Design studio after sign-up). Logged-in customers have no limit. Live: 3 per visitor and 300 per day, settable with DREAMS_PER_VISITOR / DREAMS_PER_DAY; preview: 3 per day per browser. The look templates are drawings in `img/styles/` (`<room>-<style>.svg`); drop in real photos with the same names to replace them.

**📦 Materials:** every job has a materials list: **🛒 Needs ordering → 📦 Ordered (with the arrival date) → ✅ Delivered**. The office and the job's salesperson add items and move them along; the contractor sees the list, adds what they need ("Tell the office I need this") and taps **It's here** when something arrives; the customer sees what's ordered and when it arrives. Today shows **Materials to order**, the Jobs list flags "🛒 2 to order", and every change goes in the job's history.

**👀 Reps run their projects; the owner oversees:** a salesperson's Today now includes everything on their projects (visits, scheduling, invoices to send, permits, materials, crew updates, reviews). The owner's Today keeps the money items (payments to confirm, crew bills, paying crews, crew pay) and anything with no salesperson, plus **Your reps' projects**: each rep's open projects and what's waiting on them. Tap a rep to see everything they're doing.

**⭐ Reviews:** only once a job is finished **and the last invoice is paid**, its Next step is **Ask for a review**: one tap opens a text to the customer with the link (and your Google review link from **Payments tab → Review link**). The customer rates the job 1 to 5 stars with a comment on their job page, then gets a button to post it on Google. Today shows **Ask for a review** and **New reviews**; each finished job shows the stars.

**🧰 Contractor skills:** each contractor is **Does it all (general)** or the trades they specialize in (concrete, decks & patios, fencing, siding, windows & doors, plus the usual trades). The Contractors tab groups them **by skill** (do-it-all first, then specialists like "Concrete only") or **by state**, with a skill filter. Do-it-all contractors get a ★ for every job in the crew picker.

**📅 Calendar on Today:** a month calendar shows every crew work day (green dot) and rep visit (blue dot). Tap a day to list its jobs with the time, customer, job number and crew or rep; tap one to open the job. **‹ ›** change the month and **Back to today** returns. Salespeople see their own clients' days.

**🌙 Light / dark mode:** the moon/sun button at the top of every page switches between light and dark. It starts with the phone's setting and remembers your choice on that phone.

**📁 Folders & records:**
- **Customers:** tap a customer's name on any job (or **Jobs → 📁 Customers**) for their folder: every job they've had, sorted into Active / Done / Closed, with total work, paid and owed, call/text/email, **+ New job for them**, **Print record** and a spreadsheet.
- **Salespeople** (Sales tab) and **contractors** (Contractors tab) have the same: their jobs by status, totals, and a spreadsheet. Each finished job shows whether the contractor has been paid.
- **Paying the crew:** on a job's Payments section, **💸 Mark crew paid** with the date and how (Zelle, check…). Today lists **Pay your crew** for finished jobs not marked paid.
- **Payments tab → Records for your books:** spreadsheets of every job, every payment received, and every crew payout.
- **Contractors → 📒 Records:** pick a year to see jobs done, earned and paid. One tap for a **spreadsheet for taxes**, a **printable year statement**, or **Download everything** (a zip with every photo they took, one folder per job, plus the spreadsheet).

**🧾 Contractors bill Top Hat (crew pay schedule):** a contractor's pay on a job is split into steps (default **30% when work starts, 30% halfway, 40% when finished**; change it in **Payments tab → Crew pay schedule**). On each job the contractor sees **💵 Bill Top Hat** with every step, its amount and status. Bills open **one at a time**: the first when they tap Start work; the halfway one after they tap **½ I'm halfway done** *and* the first bill is approved or paid; the last when the job is finished and the halfway bill is handled. Locked steps say what they're waiting on. When a step opens they tap **Bill now**, add **at least one photo of the work** (required, up to 12) and an optional note on what they finished; they can also **bill for extra work or materials** with their own amount, a description and photos. Amounts for steps are worked out from the crew pay, never typed. The office sees **Today → Crew bills to approve**, and on the job's Payments section each bill with its photos (tap one to see it full size; they're also saved in the job's Files), plus **Approve**, **Decline** (with a reason the contractor sees) or **💸 Mark paid** (date and method). When every step is paid, the job is marked crew paid. Approved bills waiting to be paid show under **Pay your crew**, and the contractor's Records count each payment as it's made.

**Payment schedule:** the job total is split into payments (default: **Insurance payment 50%**, due upon receipt of payment from the insurance company; **Framing 25%**, due upon completion of framing; **Roofing, insulation & sheetrock 15%**, due upon completion of that work; **Final: painting, finish work & cleanup 10%**, due upon final completion). Payments set to **“That part is done”** are billed when that part of the work is finished: while the job is in progress its Next step says “When framing is done, bill it” with a **✓ Framing done: create invoice** button (the Payments section has **✓ Done: invoice it** too), and once the job is finished any that weren't billed show as due. Change the names, percentages and timing in **Payments tab → Payment schedule**; it has to add up to 100%. Every job's **💵 Payments** section shows each payment with its invoice and status, and the job's **Next step** asks for each invoice as the job reaches that point (**Send the deposit invoice: $925**). One tap fills in the invoice for that payment. Estimates print the schedule, and each schedule invoice prints "Payment 1 of 3" with the full schedule. **Today → Invoices to send** lists every payment that's due.

Today shows each stage: new leads to call, **🔥 hot leads that need a rep visit**, **🤝 rep visits today and tomorrow**, **🤔 customers thinking it over**, and **visits done that need a crew**.


**Home page:** the slogan "You need it done… We make it happen.", the big start button, and **What are we building together?**: picture buttons, only for jobs with a real photo from tophatcontracting.com: Kitchens, Bathrooms, Interior remodeling, Garages, Decks, Patios, Concrete, Masonry, plus Something else. Each one starts the request already set to that job (`#/request?trade=decks`, `?trade=remodel&room=kitchen`). Photos are in `img/site/` (from the company website).

**The request (3 steps):** **1 Photos**: add up to 5 photos and the "Describe your project" box (+ measurements). **2 Design**: pick the look (no "Which room is it?": the room comes from the home-page button or what they wrote; otherwise every room's looks are shown), the ✨ design studio (Describe your design, Build my dream, before/after slider) and "Which level of finish closely meets your expectations?" (Not sure yet, Budget, Mid-grade, Premium). **3 Schedule and create account** (button: Create account; "Schedule" / "Send my request" when already logged in): pick a day to meet your project manager, the project address, and create the account (name, phone, email, password), then **Send my request**.


**Contractors: insurance, invoices and photos.** The office or the salesperson assigns the contractor on the job (**👷 Contractor & schedule**, or "Assign a contractor & date now"). Before their first bill the contractor uploads **proof of insurance** once (PDF or photo, with the date it runs out; they're asked again when it runs out). **Every bill** on the crew pay schedule (and every extra-work bill) needs **photos of the work** and **their own invoice to Top Hat** (PDF or photo). The office sees each bill's invoice and photos on the job's Payments tab, and each contractor's insurance (with a link, and a warning when it's missing or ran out) on the Contractors page. Live: `contractors.insurance_*` columns, `crew_set_insurance` / `crew_my_insurance`, files under `insurance/<contractor id>/`, and `crew_bill(..., p_invoice)`.


**Calendar appointments (Today tab).** Tap any day on the office calendar to make an appointment: pick the customer's job, a time, the contractor, the sales rep (office only; a salesperson books for their own clients) and notes. With a contractor it's saved as the job's work day (green dot; the job becomes Scheduled); with only a rep it's a rep visit (blue dot). Notes are added to the job's office notes with the date.


**Office tabs:** Today · Jobs · **Team** · Payments. Team holds both the **💼 Sales** team and the **👷 Contractors** (switch at the top). Old links to `#sales` / `#crew` open the right half.


**Contractor updates reach the customer.** Every tap the contractor makes moves the customer's job completion meter and its "Now:" line: confirmed (58%), **On my way** (62%, plus a gold "🚚 Ray is on the way!" alert at the top of the customer's job), started (70%), paused for materials / needs another visit, halfway (85%), finished (100%). The customer's My jobs page checks for updates every minute, so it changes without a reload. (Live: `my_jobs` returns `crew_confirmed`, `halfway_at`, `progress_at`. These are in-app alerts; text/push messages would need an SMS service.)

## How it works

**Customers** (`index.html`)
1. Answer one simple question per screen (most are a single tap that moves straight on): the first page is the before photo and design (no "type of work" page; a link can add ?trade=roofing, otherwise it's a remodel and the office can change it) → Details (address, ZIP and state, phone and email, and an optional budget; new customers also give their name and make a password here) → Date (tap a day, then **Send my request**, which also makes the new customer's account).
2. Design it, in this order: (1) before photo, (2) which room / look bubbles plus the "Describe your project" box (for the team) and measurements, (3) ✨ Build my dream with its own "Describe your design" box that the design studio uses: the AI after picture as a before/after slider (each corner label hides when its picture is slid away) (there's no separate "What would you like done?" step). Then the address, ZIP, a date on the calendar and an optional budget. The progress bar names every step (Photos · Design · Create account, 3 steps for everyone) and shows about how many minutes are left.
3. Create an account with name, mobile phone, email and password. The request is sent as soon as the account is created.
4. Check **My jobs** anytime to see the status (Received → Estimate call → Rep visit → Scheduled → Done), the rep visit time once it's booked, and the date and crew lead's name once the work is scheduled.

**Top Hat staff** (`admin.html`)
- **Today** (the home screen) shows only what needs attention: new leads to call (with a Call button), new crew notes, approved estimates that need a crew and date, finished jobs that need an invoice, unpaid invoices, estimates waiting on the customer, and jobs on the schedule today and tomorrow. When nothing is waiting, it says "All caught up."
- **Owner command center (Today, owner/office only):** money collected this month and year, profit on finished jobs ($ and %), what customers still owe, jobs in progress, leads this week, close rate, average customer rating, and a **goal tracker** (default 100 kitchens / $500,000 a year) with pace bars for the month, quarter and year. Change the goal under **Payments**.
- **Alerts card (Today):** jobs with no update in 7+ days, and contractors whose insurance has run out, runs out within 30 days, or was never uploaded.
- **Expired insurance blocks assigning:** a contractor whose insurance ran out shows "(insurance ran out)" and can't be picked for a job until they upload a new certificate.
- **Payments tab extras:** money-owed aging (Not due, 1–30, 31–60, 61–90, 90+ days) and **Download a full backup** (every job, customer, contractor and payment in one file).
- **Each job opens with a summary** (customer, address, date, crew, price and profit) and a **Next step** card with one clear button: Call the customer → Send an estimate → Schedule a crew → Text the job to the crew → Mark finished → Send the invoice → Record payment. A **progress bar** (New → Estimate → Hot lead → Scheduled → Working → Done) shows where the job is, and you can tap it to change the status. The rest of the job is split into tabs: **Overview, Money, Files, Notes & timeline**.
- **+ New job** (on Today and Jobs): enter a job for a customer who called or walked in. Fill in the customer's name, phone and optional email, the job, and optionally a crew and date. With a crew and date, the job is scheduled right away and shows up in that contractor's crew login. If the phone or email matches an existing customer account, the job is added to that account so they see it in My jobs. Customers entered this way don't have an app login, so estimates and invoices go to them as a PDF by text or email, and you tap **Mark approved** when they say yes.
- **Jobs** lists every job with filters (Open, New, 🔥 Hot, Scheduled, Done, Closed, All) and search. "Open" includes finished jobs that still need an invoice or payment. Cards show flags only when something needs attention.
- **Leads:** every request, with counts by status, an open-job value total, filters and search.
- **Lead details:** call, text or email the customer in one tap. Set the status, pick a crew (★ marks crews who do that kind of work), set the date, and keep internal notes the customer never sees. Each lead also keeps an activity history.
- **Job numbers:** every job gets a number like **TH-1042**. Search by number, name, phone or address.
- **Money (staff only):** each job has a **customer price** (what the customer pays) and a **crew pay** (what Top Hat pays the contractor). The app shows Top Hat's profit and margin.
- **Files, one folder per job:** upload estimates, contracts, invoices, receipts, permits and photos to the job. The file type is guessed from the file name and can be changed. A checklist shows whether the estimate, contract and invoice are in. The customer's own request photos are included.
- **Text job details to the crew:** opens a text message to the assigned crew lead with the job number, address, time, customer contact and job description filled in.
- **Crew photo upload link:** each assigned job gets a private link, included at the end of the crew text (there's also a **Copy link** button). The contractor taps it, with no app or password, sees the job basics, adds an optional note and uploads photos. They land in that job's Files, labeled with who sent them. Reassigning the job to another crew makes a new link and turns the old one off.
- **Estimates & invoices:** create them from any job, prefilled with the customer, job number, address and description. Add line items and tax, then **Send to customer**. The customer sees it in My jobs and can **approve an estimate with one tap**, which also sets the job's customer price. You can **turn an approved estimate into an invoice** in one tap, and **record payments** by cash, check, Zelle, card, Venmo, Cash App or other, including partial payments. The invoice shows Partly paid, Paid or Overdue on its own. You can add an optional Square or Stripe **"Pay by card" link**, text or email the customer a link, void an invoice, and **print or save a PDF**. Approved estimates and paid invoices are locked. **Crew pay never appears** on any estimate or invoice.
- **Business tab:** company name, phone, email, address, license #, default tax rate, invoice due days, "Payment terms & how to pay", with one box for estimates (e.g. Zelle only) and one for invoices (e.g. Zelle plus ACH details), and default terms. All of these print on every estimate and invoice.
- **Sales team:** the owner adds salespeople under **Sales** and sends each one a one-time invite link (`sales.html?invite=…`). Salespeople log in on the same login page and land in the office area, but see **only their own clients**:
  - **+ New job** for each call, and **📝 Log call** on any client with an outcome (talked, left voicemail, no answer, booked a visit, not interested) and a note. Calls are recorded with their name.
  - Notes, files, estimates, and running their own jobs: **assign the crew and date**, text the job to the crew, and move it through Scheduled → Working → Done. They pick crews from a list of names, phones and trades only, with no crew logins or invites.
  - They never see crew pay or profit, can't record payments, void invoices, change a job's salesperson, or open Business settings, the Sales/Crew tabs or other salespeople's clients.
  - When a salesperson schedules a job without crew pay, the owner's Today shows **"Set crew pay"**.
  - **Assign leads in bulk:** on **Jobs**, tap **💼 Assign leads to a salesperson**. It opens on the leads with no salesperson; tap the jobs you want (or **Select all**), pick the salesperson and tap **Assign**. Each job's history records the change, and the leads show up on that salesperson's Today and My clients right away. **No salesperson (unassign)** takes them back.
  - The owner's **Sales** tab shows each salesperson's clients, open leads, estimates, sold total and close rate. Tapping one shows **everything they're doing** (calls, new clients, estimates and updates, newest first) and their client list. Every job has a **Salesperson** the owner can assign or change, and the Jobs list can be filtered by salesperson.
- **Contractor job page, start to finish:** contractors see **My jobs** grouped as Today / Upcoming / Finished. Each job opens to one big **Next step** button: **✓ I'll be there** (or **Can't make it** with a reason, which alerts the office) → **🚚 On my way** (then offers to text the customer) → **▶ Start work** → **✓ Finish job** → **Done**, with their pay and time on the job. One-tap buttons are always there: **🧭 Directions, 📞 Call customer, 💬 Text customer** (ready-made texts: on my way, running late, I'm here, all done), **☎️ Call office, 📅 Add to calendar**. The page also has the customer's request photos, **💵 Bill Top Hat** (photos go with each bill), notes with one-tap starters (need more materials, customer not home, found extra work, running late), Waiting on materials / Needs another visit / Undo, and start and finish times. The office sees who confirmed, **"Crew can't make it"** on Today, and the time on the job.
- **Shared job progress (office ↔ crew):** both sides update the same progress, and changes show on the other side automatically, labeled with who made them and when. The crew get a progress bar (Scheduled → On the way → Working → Done) and buttons that match where the job is: **🚚 On my way**, **▶ Start work**, **⏸ Waiting on materials**, **🔁 Needs another visit**, **✓ Finished**, plus **↩ Undo** to step back. The office has the same options on the job's progress card. Crew updates show on **Today** ("New updates from your crew") and as a flag on the job card. The customer sees a friendly line ("Your crew is on the way", "We'll be back to finish").
- **Crew notes:** the contractor on a job can write notes for the office ("need 2 more bundles", "customer not home") from their crew login (📝 Notes on each job) or the job's photo link. The office sees them in a **💬 Crew notes** card near the top of the job, with who wrote each one and when. The job shows **"💬 New crew note"** in the Jobs list until someone opens it. Customers never see crew notes, and a contractor only sees their own.
- **Crew:** add, edit or deactivate your contractors and the trades they cover.
- **Crew login:** open a crew member and tap **Create invite link**, then **Text invite**. The link works once and only for that person. They set their own email and password, then sign in at `crew.html` to see **only the jobs assigned to them**: date, address, customer name and phone, and the job description. From there they can send photos and tap **Started** or **Finished**, which updates the job's status (shown in the job history with their name). They see their **own crew pay** and totals, and you can switch that off under **Payments tab → Show crew their pay**. **Turn off login** removes access right away. Crew can still use the per-job photo link from the job text without logging in.

### Who sees what

| | Top Hat staff | Customer | Crew |
|---|---|---|---|
| Job details, address, schedule | ✓ | ✓ | ✓ (via text) |
| Customer price | ✓ | only in documents you share | **never** |
| Crew pay | ✓ | **never** | their own only (can be switched off) |
| Profit | ✓ (owner/office) | **never** | **never** |
| Salespeople | everything on **their own** clients, including crews and dates, except crew pay, profit and payments | | |
| Internal (office) notes and activity | ✓ | never | never |
| Crew notes | ✓ | never | their own only |
| Estimates & invoices | ✓ (incl. drafts) | the ones you send (never drafts) | **never** |
| Files | ✓ | only files marked "Customer can see" | only the photos they uploaded |

Crew either sign in with their crew login, or just use the photo upload link from the job text. Neither includes prices, the customer's budget, staff notes or other files. On the upload page they see only the job basics and the photos they sent themselves. Crew photos start out hidden from the customer.

Status names: staff see *New lead, Qualifying, Scheduled, In progress, Completed, Not a fit*. Customers see *Received, Reviewing, Scheduled, In progress, Completed, Closed*.

## Preview mode (current)

Right now all data is saved in the browser (`localStorage`, with files in IndexedDB), so you can try the full flow on one device:

Everyone uses **one login** (the **Log in** button on the customer site, or `admin.html` / `crew.html` directly). After signing in, each account goes to its own area: **staff → staff area, customers → My jobs, crew → their crew jobs**.

In preview mode the login page has **"Try it as…"** buttons for the four sample accounts:
- **Top Hat office** (staff): **office@tophat.demo** / **tophat**
- **Salesperson**: **maria@tophat.demo** / **sales1234**
- **Customer**: **dana@example.com** / **demo1234**
- **Contractor**: **ray@tophat.demo** / **crew1234**

The preview starts **clean**: no jobs, just the four logins above (office, Maria the salesperson, Dana the customer, Ray the contractor). Ray is the only contractor and Maria the only salesperson until you add more. Use **Reset preview data** at the bottom of the staff area to go back to this clean start. (Automated tests set `localStorage['tophat.demo.quiet']` for a small 3-job sample or `localStorage['tophat.demo.busy']` for a busy week of about 20 jobs.)

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

`supabase/` also holds the security test that runs the schema against Postgres and checks each rule (166 checks).

### Turning on the AI design studio (live)

1. Get an API key at https://aistudio.google.com/apikey (Google account; billing on for image generation).
2. Deploy the server function and save the key as a secret (never in the code):
   `supabase functions deploy design` and `supabase secrets set GEMINI_API_KEY=...`
3. Optional secrets: `DESIGN_MODEL` (default `gemini-2.5-flash-image`; Google renames image models now and then) and `DESIGN_DAILY_LIMIT` (default 40 pictures per job per day).

## Run it locally

```sh
python3 -m http.server 8000
# customer site: http://localhost:8000
# staff area:    http://localhost:8000/admin.html
```

## Files

- `index.html`, `buyer.js`: customer site
- `admin.html`, `admin.js`: staff area
- `sales.html`, `sales.js`: salesperson invite (sets up a sales login)
- `crew.html`, `crew.js`: crew sign-in and My jobs, crew invite setup, and the per-job photo upload page
- `data.js`: preview data layer (`TH.api`, browser storage), plus the lists of trades, timeframes, budgets and statuses
- `supabase-backend.js`: live data layer (same `TH.api`, backed by Supabase)
- `config.js`: Supabase project URL and publishable key (empty = preview mode)
- `supabase/schema.sql`: database setup and security rules
- `vendor/supabase-2.118.0.js`: Supabase JavaScript client (MIT license)
- `vendor/jszip-3.10.1.min.js`: JSZip, for contractors' "Download everything" zip (MIT license; loaded only when used)
- `docs.js`: estimate and invoice totals, statuses, and the printable document
- `styles.css`: shared styling, including print styles for PDFs
