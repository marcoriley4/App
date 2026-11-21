-- =====================================================================
-- Top Hat Contracting: database setup for Supabase
--
-- Run once in a new Supabase project (SQL Editor → paste → Run).
-- It recreates the app's own tables, so it refuses to run once real jobs
-- exist (to protect your data). Changes after go-live need a migration.
--
-- Who can see what is enforced HERE, by the database, not by the app:
--   • Customers: only their own jobs (through my_jobs()), and only files
--     staff marked "Customer can see". Never prices, crew pay or notes.
--   • Crew: no login. Only the job basics and their own uploads, through
--     the job's private upload code (crew_job / crew_add_file).
--   • Staff (profiles.role = 'staff'): everything.
--   • Money and notes live in job_private, which only staff can read.
-- =====================================================================

-- ---------- safety: never wipe a database that already has jobs ----------
do $$
declare has_jobs boolean := false;
begin
  if to_regclass('public.jobs') is not null then
    execute 'select exists (select 1 from public.jobs)' into has_jobs;
  end if;
  if has_jobs then
    raise exception 'Stopped: this database already has jobs. Running setup again would erase them.';
  end if;
end $$;

-- ---------- clean slate for re-runs ----------
drop trigger if exists on_auth_user_created on auth.users;
drop table if exists public.office_records, public.job_messages, public.design_dreams, public.job_materials, public.crew_bills, public.payment_reports, public.design_versions, public.job_costs, public.salespeople, public.crew_notes, public.documents, public.settings, public.job_files, public.job_events, public.job_private, public.jobs, public.contractors, public.profiles cascade;
drop function if exists public.handle_new_user, public.is_staff, public.new_crew_token, public.owns_job,
  public.customer_can_read, public.crew_token_active, public.create_job, public.add_customer_file, public.my_jobs,
  public.crew_job, public.crew_add_file, public.jobs_after_insert, public.jobs_before_update, public.jobs_after_update,
  public.private_after_update, public.files_after_change, public.status_label, public.log_event, public.usd,
  public.doc_total, public.doc_paid, public.docs_before, public.docs_after, public.my_documents, public.respond_estimate,
  public.my_crew, public.staff_invite_crew, public.staff_revoke_crew, public.crew_invite_info, public.claim_crew_invite,
  public.crew_my_jobs, public.crew_set_status, public.crew_set_progress, public.crew_add_note,
  public.jobs_before_update, public.stage_label, public.crew_respond, public.crew_can_read_customer,
  public.my_sales, public.can_access_job, public.office_can_see_profile, public.office_can_access_path, public.sales_guard,
  public.private_guard, public.costs_after_update, public.log_call, public.staff_invite_sales, public.staff_revoke_sales,
  public.sales_invite_info, public.claim_sales_invite, public.office_crew_list,
  public.authorize_permit, public.can_design, public.permit_label, public.report_payment, public.resolve_payment_report, public.crew_bill, public.staff_crew_bill, public.crew_halfway,
  public.crew_material_add, public.crew_material_delivered, public.job_materials_log, public.sign_document, public.office_ask_review, public.customer_review,
  public.crew_my_insurance, public.crew_set_insurance, public.crew_owns_insurance_path, public.log_message,
  public.crew_my_profile, public.crew_set_profile, public.crew_set_w9, public.crew_sign_lien, public.crew_punch, public.crew_punch_done cascade;

-- ---------- helpers ----------
create function public.new_crew_token() returns text
language sql volatile set search_path = '' as $$
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
$$;

create function public.usd(n numeric) returns text
language sql immutable set search_path = '' as $$
  select case when n is null then 'cleared'
              when n = trunc(n) then '$' || to_char(n, 'FM999,999,999,990')
              else '$' || to_char(n, 'FM999,999,999,990.00') end;
$$;

create function public.status_label(s text) returns text
language sql immutable set search_path = '' as $$
  select case s when 'new' then 'New lead' when 'qualifying' then 'Phone estimate' when 'hot' then 'Hot lead' when 'scheduled' then 'Scheduled'
    when 'in_progress' then 'In progress' when 'completed' then 'Completed' when 'lost' then 'Not a fit' else s end;
$$;

-- ---------- people ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'buyer' check (role in ('buyer', 'staff', 'crew', 'sales')),
  name text not null default '',
  email text not null default '',
  phone text not null default '',
  created_at timestamptz not null default now()
);

-- Every new login gets a customer profile. Role is never taken from sign-up data.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, name, email, phone)
  values (new.id,
          left(coalesce(new.raw_user_meta_data->>'name', ''), 120),
          coalesce(new.email, ''),
          left(coalesce(new.raw_user_meta_data->>'phone', ''), 40));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'staff');
$$;

create table public.contractors (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  phone text not null default '',
  trades text[] not null default '{}',
  active boolean not null default true,
  state text not null default '' check (state = '' or state ~ '^[A-Z]{2}$'),   -- state they work in
  user_id uuid unique references public.profiles(id) on delete set null,   -- their crew login, if any
  invite_code text unique,                                                 -- one-time crew login invite
  -- Proof of insurance (uploaded by the contractor, needed before they can bill Top Hat).
  insurance_path text check (insurance_path is null or insurance_path like 'insurance/%'),
  insurance_name text not null default '' check (length(insurance_name) <= 200),
  insurance_expires date,
  insurance_at timestamptz,
  -- The contractor's own details (they keep these up to date in their login): business name, email, license # / state / expiry,
  -- service area, days of the week they don't work and dates they're booked elsewhere.
  profile jsonb not null default '{}' check (jsonb_typeof(profile) = 'object' and length(profile::text) <= 20000),
  -- W-9 (for the 1099), stored next to their insurance under insurance/<contractor id>/.
  w9_path text check (w9_path is null or w9_path like 'insurance/%'),
  w9_name text not null default '' check (length(w9_name) <= 200),
  w9_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.profiles add column contractor_id uuid references public.contractors(id) on delete set null;

-- Salespeople: log in to the office area and see only the clients assigned to them.
create table public.salespeople (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  phone text not null default '',
  active boolean not null default true,
  user_id uuid unique references public.profiles(id) on delete set null,
  invite_code text unique,
  created_at timestamptz not null default now()
);
alter table public.profiles add column sales_id uuid references public.salespeople(id) on delete set null;

-- The logged-in salesperson's record (null if not sales, turned off, or inactive).
create function public.my_sales() returns uuid
language sql stable security definer set search_path = '' as $$
  select s.id from public.salespeople s join public.profiles p on p.id = s.user_id
   where p.id = auth.uid() and p.role = 'sales' and p.sales_id = s.id and s.active;
$$;

-- ---------- jobs ----------
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity (start with 1001) unique,
  buyer_id uuid references public.profiles(id) on delete cascade,  -- null when the office entered it for a customer without the app
  contact_name text not null default '',
  contact_phone text not null default '',
  contact_email text not null default '',
  entered_by text not null default '',
  trade text not null,
  description text not null,
  address text not null,
  zip text not null default '',
  state text not null default '' check (state = '' or state ~ '^[A-Z]{2}$'),   -- 2-letter state, to organize leads by state
  style text not null default '' check (style = '' or style ~ '^[a-z]{2,20}/[a-z]{2,20}$'),   -- sample style the customer picked, e.g. kitchen/farmhouse
  review_requested_at timestamptz,
  review_requested_by text not null default '',
  review_rating smallint check (review_rating between 1 and 5),
  review_comment text not null default '' check (length(review_comment) <= 1000),
  review_at timestamptz,
  timeframe text not null default '',
  budget text not null default '',
  -- 'hot' = the customer agreed to the phone estimate (or approved it in writing): worth a rep visit.
  status text not null default 'new' check (status in ('new', 'qualifying', 'hot', 'scheduled', 'in_progress', 'completed', 'lost')),
  contractor_id uuid references public.contractors(id) on delete set null,
  sales_id uuid references public.salespeople(id) on delete set null,   -- the salesperson who owns this client
  scheduled_for timestamp,
  end_date date,        -- expected finish (set by the office/sales; the customer sees it with the start date)
  visit_at timestamp,   -- the sales rep's walkthrough with a hot lead
  -- Building permit: the customer's OK (typed-name signature) and the status/number they can see.
  permit_status text not null default 'none' check (permit_status in ('none', 'authorized', 'preparing', 'applied', 'approved', 'inspections', 'closed', 'not_needed')),
  permit_number text not null default '' check (length(permit_number) <= 60),
  permit_authorized_by text not null default '',
  permit_authorized_at timestamptz,
  -- Extra progress detail shared by office and crew, and who last changed progress.
  stage text check (stage in ('on_the_way', 'waiting_parts', 'return_visit')),
  progress_at timestamptz,
  progress_by text not null default '',
  progress_by_crew boolean not null default false,
  -- The assigned contractor's answer, and time on the job.
  crew_response text check (crew_response in ('confirmed', 'declined')),
  crew_response_note text not null default '',
  crew_response_at timestamptz,
  started_at timestamptz,
  halfway_at timestamptz,            -- contractor tapped "I'm halfway done" (unlocks the halfway crew bill)
  finished_at timestamptz,
  -- Lead details (office and sales): where it came from, qualifying answers, why it didn't close, do-not-contact.
  source text not null default '' check (source = '' or source ~ '^[a-z_]{2,20}$'),
  homeowner boolean,
  decision_makers text not null default '' check (length(decision_makers) <= 200),
  lost_reason text not null default '' check (length(lost_reason) <= 200),
  do_not_contact boolean not null default false,
  first_contact_at timestamptz,      -- first call/text/email to the customer (speed to lead)
  created_at timestamptz not null default now(),
  check (buyer_id is not null or length(trim(contact_name)) > 0)
);
create index on public.jobs (buyer_id);
create index on public.jobs (status);

-- Staff-only: money, notes, and the crew upload code.
create table public.job_private (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  price numeric(12, 2) check (price >= 0),
  notes text not null default '',
  crew_token text unique,
  crew_notes_seen_at timestamptz,                     -- when the office last opened the crew notes
  permit_portal text not null default '' check (permit_portal = '' or permit_portal ~* '^https?://'),
  permit_fee numeric(10, 2) check (permit_fee >= 0)
);

-- Design studio pictures. They live in storage at <job>/design/<id>.<ext>.
-- Only the design Edge Function writes them (it checks can_design first).
create table public.design_versions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  parent_id uuid references public.design_versions(id) on delete set null,
  source text not null check (source in ('photo', 'ai')),
  prompt text not null default '' check (length(prompt) <= 1500),
  path text not null,
  by_name text not null default '',
  by_user uuid references auth.users(id) on delete set null,
  chosen boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.design_versions (job_id, created_at);

-- Owner/office only: what the crew is paid. Kept apart so salespeople can work with prices but never see it.
create table public.job_costs (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  crew_pay numeric(12, 2) check (crew_pay >= 0),
  -- When the office paid the contractor (for both sets of books).
  crew_paid_date date,
  crew_paid_method text not null default '' check (length(crew_paid_method) <= 40),
  crew_paid_note text not null default '' check (length(crew_paid_note) <= 200)
);

create table public.job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.jobs(id) on delete cascade,
  at timestamptz not null default now(),
  text text not null
);
create index on public.job_events (job_id);

create table public.job_files (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  path text not null unique,
  name text not null,
  mime text not null default 'application/octet-stream',
  size bigint not null default 0,
  kind text not null default 'other' check (kind in ('estimate', 'invoice', 'contract', 'receipt', 'permit', 'photo', 'other')),
  stage text not null default '' check (stage in ('', 'before', 'during', 'after')),
  note text not null default '',
  shared boolean not null default false,
  source text not null default 'staff' check (source in ('staff', 'customer', 'crew', 'design')),
  design_id uuid unique references public.design_versions(id) on delete cascade,   -- a design saved from the studio (shared with everyone on the job)
  design_group uuid,                 -- saved designs: the photo they started from, so before and after show together (stage = before / after)
  by_name text not null default '',
  contractor_id uuid references public.contractors(id) on delete set null,
  uploaded_at timestamptz not null default now()
);
create index on public.job_files (job_id);

-- Notes the assigned contractor writes for the office. Office reads them; customers never do.
-- Sign-up "dream" previews (before the customer has an account): one row per picture, so the design
-- function can cap them per visitor and per day. Only the server (service role) touches it.
create table public.design_dreams (
  id bigint generated always as identity primary key,
  visitor text not null,
  created_at timestamptz not null default now()
);
create index on public.design_dreams (visitor, created_at);
alter table public.design_dreams enable row level security;
revoke all on public.design_dreams from anon, authenticated;

-- Materials for a job: what needs ordering, what's ordered (and when it arrives), what's delivered.
-- Office and the job's salesperson manage it directly; crew go through crew_material_add / crew_material_delivered; customers see it in my_jobs().
create table public.job_materials (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 120),
  qty text not null default '' check (length(qty) <= 40),
  note text not null default '' check (length(note) <= 300),
  status text not null default 'needed' check (status in ('needed', 'ordered', 'delivered')),
  eta date,
  added_by text not null default '',
  updated_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.job_materials (job_id);

create table public.crew_notes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  contractor_id uuid references public.contractors(id) on delete set null,
  by_name text not null default '',
  text text not null check (length(trim(text)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index on public.crew_notes (job_id);

-- Texts, emails and calls with the customer. Written only through log_message / log_call.
create table public.job_messages (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  at timestamptz not null default now(),
  by_name text not null default '',
  by_user uuid references auth.users(id) on delete set null,
  channel text not null check (channel in ('text', 'email', 'call')),
  dir text not null check (dir in ('in', 'out')),
  body text not null check (length(body) between 1 and 2000)
);
create index on public.job_messages (job_id, at);

-- Office-only records (owner/office staff): price book, estimate templates and costs, job tasks and punch lists,
-- walkthrough sign-offs, expenses and supplier bills, commission, suppliers, staff, company licenses and insurance,
-- tickets, how-to guides and equipment. Sales, crews and customers can't see or change any of it.
create table public.office_records (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('price_item', 'est_template', 'est_cost', 'task', 'walkthrough', 'expense', 'commission_rule', 'commission_paid',
                                     'vendor', 'staff', 'company_doc', 'ticket', 'sop', 'asset', 'crew_review')),
  job_id uuid references public.jobs(id) on delete cascade,
  data jsonb not null default '{}' check (jsonb_typeof(data) = 'object' and length(data::text) <= 400000),
  by_name text not null default '' check (length(by_name) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.office_records (kind);
create index on public.office_records (job_id);

-- ---------- activity history (written by the database, so it can't be skipped) ----------
create function public.log_event(j uuid, msg text) returns void
language sql security definer set search_path = '' as $$
  insert into public.job_events (job_id, text) values (j, msg);
$$;

create function public.jobs_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.job_private (job_id, crew_token)
  values (new.id, case when new.contractor_id is null then null else public.new_crew_token() end);
  insert into public.job_costs (job_id) values (new.id);
  perform public.log_event(new.id, case when new.entered_by <> '' then 'Job entered by ' || new.entered_by
    || case when new.sales_id is not null and not public.is_staff() then ' (sales)' else ' (office)' end else 'Lead received' end);
  if new.sales_id is not null then
    perform public.log_event(new.id, 'Salesperson → ' || coalesce((select name from public.salespeople where id = new.sales_id), 'sales'));
  end if;
  if new.contractor_id is not null then
    perform public.log_event(new.id, 'Assigned to ' || coalesce((select name from public.contractors where id = new.contractor_id), 'crew'));
  end if;
  return new;
end $$;
create trigger jobs_after_insert after insert on public.jobs
  for each row execute function public.jobs_after_insert();

create function public.permit_label(st text) returns text
language sql immutable set search_path = '' as $$
  select case st when 'none' then 'Not started' when 'authorized' then 'Customer approved: apply' when 'preparing' then 'Preparing the application'
    when 'applied' then 'Applied: waiting on the town' when 'approved' then 'Approved' when 'inspections' then 'Inspections'
    when 'closed' then 'Closed (final inspection passed)' when 'not_needed' then 'Not needed' else st end;
$$;

create function public.stage_label(st text) returns text
language sql immutable set search_path = '' as $$
  select case st when 'on_the_way' then 'On the way' when 'waiting_parts' then 'Waiting on materials'
                 when 'return_visit' then 'Needs another visit' else st end;
$$;

-- Keep progress detail consistent: "On the way" only while Scheduled, the holds only while Working.
create function public.jobs_before_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status and new.stage is not distinct from old.stage then new.stage := null; end if;
  if new.stage is not null and not ((new.stage = 'on_the_way' and new.status = 'scheduled')
     or (new.stage in ('waiting_parts', 'return_visit') and new.status = 'in_progress')) then
    new.stage := null;
  end if;
  if (new.status, new.stage) is distinct from (old.status, old.stage) and new.progress_at is not distinct from old.progress_at then
    new.progress_at := now();
  end if;
  -- A new crew has to confirm for themselves.
  if new.contractor_id is distinct from old.contractor_id then
    new.crew_response := null; new.crew_response_note := ''; new.crew_response_at := null;
  end if;
  -- Time on the job.
  if new.status = 'in_progress' and new.started_at is null then new.started_at := now(); end if;
  if new.status = 'completed' and old.status is distinct from 'completed' then new.finished_at := now(); end if;
  if new.status <> 'completed' then new.finished_at := null; end if;
  return new;
end $$;
create trigger jobs_before_update before update on public.jobs
  for each row execute function public.jobs_before_update();

-- Office area access: staff reach every job; a salesperson only jobs assigned to them.
create function public.can_access_job(j uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_staff() or exists (select 1 from public.jobs x where x.id = j and x.sales_id is not null and x.sales_id = public.my_sales());
$$;
create function public.office_can_see_profile(pid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.jobs x where x.buyer_id = pid and public.can_access_job(x.id));
$$;

-- Salespeople run their own jobs (crew, date, progress) but can't hand a job to another salesperson.
create function public.sales_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if public.is_staff() or public.my_sales() is null then return new; end if;
  if tg_op = 'INSERT' and new.sales_id is distinct from public.my_sales() then
    raise exception 'Salespeople add jobs for themselves.';
  end if;
  if tg_op = 'UPDATE' and new.sales_id is distinct from old.sales_id then
    raise exception 'Only the office can change the salesperson.';
  end if;
  -- Lead details are the office's (owner's request).
  if tg_op = 'UPDATE' and (new.source, new.homeowner, new.decision_makers, new.lost_reason, new.do_not_contact)
       is distinct from (old.source, old.homeowner, old.decision_makers, old.lost_reason, old.do_not_contact) then
    raise exception 'Only the office can change lead details.';
  end if;
  return new;
end $$;
create trigger jobs_sales_guard before insert or update on public.jobs
  for each row execute function public.sales_guard();

create function public.private_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if pg_trigger_depth() > 1 then return new; end if; -- changes made by the app's own triggers (e.g. a new crew link)
  if not public.is_staff() and auth.uid() is not null and public.my_sales() is not null
     and (new.crew_token is distinct from old.crew_token or new.crew_notes_seen_at is distinct from old.crew_notes_seen_at) then
    raise exception 'Only the office can change that.';
  end if;
  return new;
end $$;
create trigger private_guard before update on public.job_private
  for each row execute function public.private_guard();

create function public.jobs_after_update() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cname text;
begin
  if new.status is distinct from old.status then
    perform public.log_event(new.id, 'Status → ' || public.status_label(new.status)
      || case when new.progress_by_crew and new.progress_by <> '' then ' (by ' || new.progress_by || ', crew)' else '' end);
  end if;
  if new.stage is distinct from old.stage and (new.stage is not null or new.status is not distinct from old.status) then
    perform public.log_event(new.id, case when new.stage is null then 'Cleared “' || public.stage_label(old.stage) || '”' else public.stage_label(new.stage) end
      || case when new.progress_by <> '' then ' (by ' || new.progress_by || case when new.progress_by_crew then ', crew' else '' end || ')' else '' end);
  end if;
  if new.sales_id is distinct from old.sales_id then
    perform public.log_event(new.id, 'Salesperson → ' || coalesce((select name from public.salespeople where id = new.sales_id), 'nobody'));
  end if;
  if new.contractor_id is distinct from old.contractor_id then
    select name into cname from public.contractors where id = new.contractor_id;
    perform public.log_event(new.id, 'Assigned to ' || coalesce(cname, 'nobody'));
    -- New crew → new upload link; the previous crew's link stops working.
    update public.job_private
       set crew_token = case when new.contractor_id is null then null else public.new_crew_token() end
     where job_id = new.id;
  end if;
  if new.scheduled_for is distinct from old.scheduled_for and new.scheduled_for is not null then
    perform public.log_event(new.id, 'Scheduled for ' || to_char(new.scheduled_for, 'Mon FMDD, YYYY FMHH12:MI AM'));
  end if;
  if new.permit_status is distinct from old.permit_status and new.permit_authorized_at is not distinct from old.permit_authorized_at then
    perform public.log_event(new.id, '📋 Permit → ' || public.permit_label(new.permit_status));
  end if;
  if new.permit_number is distinct from old.permit_number and new.permit_number <> '' then
    perform public.log_event(new.id, '📋 Permit # ' || new.permit_number);
  end if;
  if new.source is distinct from old.source then
    perform public.log_event(new.id, 'Lead source → ' || case when new.source = '' then 'not set' else new.source end);
  end if;
  if new.homeowner is distinct from old.homeowner then
    perform public.log_event(new.id, 'Homeowner → ' || case when new.homeowner is null then 'not asked' when new.homeowner then 'yes' else 'no (renter / other)' end);
  end if;
  if new.lost_reason is distinct from old.lost_reason and new.lost_reason <> '' then
    perform public.log_event(new.id, 'Why it didn’t close: ' || new.lost_reason);
  end if;
  if new.do_not_contact is distinct from old.do_not_contact then
    perform public.log_event(new.id, case when new.do_not_contact then '🚫 Customer asked not to be contacted' else 'OK to contact again' end);
  end if;
  if new.visit_at is distinct from old.visit_at then
    perform public.log_event(new.id, case when new.visit_at is null then '🤝 Rep visit cleared'
      else '🤝 Rep visit booked for ' || to_char(new.visit_at, 'Mon FMDD, YYYY FMHH12:MI AM') end);
  end if;
  return new;
end $$;
create trigger jobs_after_update after update on public.jobs
  for each row execute function public.jobs_after_update();

create function public.private_after_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.price is distinct from old.price then
    perform public.log_event(new.job_id, 'Customer price → ' || public.usd(new.price));
  end if;
  return new;
end $$;
create trigger private_after_update after update on public.job_private
  for each row execute function public.private_after_update();

create function public.costs_after_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.crew_pay is distinct from old.crew_pay then
    perform public.log_event(new.job_id, 'Crew pay → ' || public.usd(new.crew_pay));
  end if;
  if new.crew_paid_date is distinct from old.crew_paid_date then
    perform public.log_event(new.job_id, case when new.crew_paid_date is null then '💸 Crew payment cleared'
      else '💸 Crew paid ' || coalesce(public.usd(new.crew_pay) || ' ', '') || '(' || new.crew_paid_method || ') on ' || to_char(new.crew_paid_date, 'Mon FMDD, YYYY') end);
  end if;
  return new;
end $$;
create trigger costs_after_update after update on public.job_costs
  for each row execute function public.costs_after_update();

create function public.files_after_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_event(new.job_id,
      case when new.source = 'crew' then new.by_name || ' uploaded ' || new.name || case when new.stage <> '' then ' (' || new.stage || ')' else '' end
           when new.source = 'customer' then 'Customer added ' || new.name
           else 'File added: ' || new.name end);
  elsif tg_op = 'UPDATE' and new.shared is distinct from old.shared then
    perform public.log_event(new.job_id, new.name || ': ' || case when new.shared then 'shared with customer' else 'hidden from customer' end);
  elsif tg_op = 'DELETE' then
    perform public.log_event(old.job_id, 'File removed: ' || old.name);
  end if;
  return null;
end $$;
create trigger files_after_change after insert or update or delete on public.job_files
  for each row execute function public.files_after_change();

-- ---------- row level security ----------
alter table public.profiles enable row level security;
alter table public.contractors enable row level security;
alter table public.jobs enable row level security;
alter table public.job_private enable row level security;
alter table public.job_events enable row level security;
alter table public.job_files enable row level security;
alter table public.crew_notes enable row level security;
alter table public.job_messages enable row level security;
alter table public.office_records enable row level security;
create policy "office only" on public.office_records for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "office read" on public.job_messages for select to authenticated using (public.is_staff());

create policy "own profile or staff" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff() or (public.my_sales() is not null and public.office_can_see_profile(id)));
create policy "update own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "staff only" on public.contractors for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "office read" on public.jobs for select to authenticated using (public.can_access_job(id));
create policy "office add" on public.jobs for insert to authenticated with check (public.is_staff() or (public.my_sales() is not null and sales_id = public.my_sales()));
create policy "office edit" on public.jobs for update to authenticated using (public.can_access_job(id)) with check (public.is_staff() or sales_id = public.my_sales());
create policy "staff delete" on public.jobs for delete to authenticated using (public.is_staff());
create policy "office read" on public.job_private for select to authenticated using (public.can_access_job(job_id));
create policy "office edit" on public.job_private for update to authenticated using (public.can_access_job(job_id)) with check (public.can_access_job(job_id));
create policy "staff only" on public.job_costs for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "office read" on public.job_events for select to authenticated using (public.can_access_job(job_id));
create policy "office files" on public.job_files for all to authenticated using (public.can_access_job(job_id)) with check (public.can_access_job(job_id));
create policy "office read" on public.crew_notes for select to authenticated using (public.can_access_job(job_id));
alter table public.salespeople enable row level security;
alter table public.job_costs enable row level security;
create policy "staff all, sales self" on public.salespeople for select to authenticated using (public.is_staff() or id = public.my_sales());
create policy "staff edit" on public.salespeople for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "staff delete" on public.crew_notes for delete to authenticated using (public.is_staff());

-- Belt and braces: the public (not logged in) role can't touch tables at all,
-- and logged-in users can only edit their own name and phone, never their role.
revoke all on public.profiles, public.contractors, public.jobs, public.job_private, public.job_events, public.job_files, public.crew_notes, public.salespeople, public.job_costs from anon;
revoke insert, delete on public.job_private from authenticated;
revoke insert, update on public.crew_notes from authenticated;
revoke update on public.profiles from authenticated;
grant update (name, phone) on public.profiles to authenticated;
revoke insert, delete on public.profiles from authenticated;
revoke insert, update, delete on public.job_events from authenticated;
revoke all on public.job_messages from anon;
revoke all on public.office_records from anon;
grant select, insert, update, delete on public.office_records to authenticated;
revoke insert, update, delete on public.job_messages from authenticated;

-- ---------- what customers can do ----------
create function public.owns_job(j text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.jobs where id::text = j and buyer_id = auth.uid());
$$;

create function public.create_job(p_trade text, p_description text, p_address text, p_zip text, p_state text, p_timeframe text, p_budget text, p_style text)
returns table (id uuid, number bigint)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Please create an account first.'; end if;
  if length(trim(coalesce(p_description, ''))) < 10 then raise exception 'Please describe the job in a sentence or two.'; end if;
  if length(trim(coalesce(p_address, ''))) = 0 then raise exception 'Please enter the address where the work is.'; end if;
  if upper(trim(coalesce(p_state, ''))) !~ '^[A-Z]{2}$' then raise exception 'Pick the state the project is in.'; end if;
  return query
    insert into public.jobs as j (buyer_id, source, trade, description, address, zip, state, timeframe, budget, style)
    values (auth.uid(), 'website', left(p_trade, 40), left(trim(p_description), 4000), left(trim(p_address), 300),
            left(trim(coalesce(p_zip, '')), 10), case when upper(trim(coalesce(p_state, ''))) ~ '^[A-Z]{2}$' then upper(trim(p_state)) else '' end,
            left(coalesce(p_timeframe, ''), 40), left(coalesce(p_budget, ''), 40),
            case when coalesce(p_style, '') ~ '^[a-z]{2,20}/[a-z]{2,20}$' then p_style else '' end)
    returning j.id, j.number;
end $$;

create function public.add_customer_file(p_job uuid, p_path text, p_name text, p_mime text, p_size bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.owns_job(p_job::text) then raise exception 'Not your job.'; end if;
  if p_path not like p_job::text || '/customer/%' then raise exception 'Bad file path.'; end if;
  insert into public.job_files (job_id, path, name, mime, size, kind, source, by_name)
  select p_job, p_path, left(p_name, 200), left(coalesce(p_mime, ''), 100), coalesce(p_size, 0), 'photo', 'customer', p.name
    from public.profiles p where p.id = auth.uid();
end $$;

-- Customer's own jobs: safe fields only. No prices, crew pay, notes or crew code.
create function public.my_jobs() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', j.id, 'number', j.number, 'trade', j.trade, 'status', j.status, 'created_at', j.created_at,
    'description', j.description, 'address', j.address, 'zip', j.zip, 'state', j.state, 'timeframe', j.timeframe, 'budget', j.budget,
    'scheduled_for', j.scheduled_for, 'end_date', j.end_date, 'stage', j.stage,
    'visit_at', case when j.status = 'hot' then j.visit_at end,
    'permit_status', j.permit_status, 'permit_number', j.permit_number,
    'permit_authorized_by', j.permit_authorized_by, 'permit_authorized_at', j.permit_authorized_at,
    'design_count', (select count(*) from public.design_versions v where v.job_id = j.id), 'style', j.style,
    'materials', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'qty', m.qty, 'status', m.status, 'eta', m.eta) order by m.created_at), '[]'::jsonb)
                  from public.job_materials m where m.job_id = j.id),
    'review_requested_at', j.review_requested_at, 'review_rating', j.review_rating, 'review_comment', j.review_comment, 'review_at', j.review_at,
    'rep_name', case when j.status = 'hot' and j.visit_at is not null then split_part(sp.name, ' ', 1) end,
    'pm_name', case when j.status <> 'lost' and sp.active then sp.name end,
    'pm_phone', case when j.status <> 'lost' and sp.active then sp.phone end,
    'contractor_name', case when j.status <> 'lost' then c.name end,   -- the customer sees who's assigned
    -- The contractor's progress, so the customer's meter and alerts follow every tap they make.
    'crew_confirmed', j.crew_response = 'confirmed', 'halfway_at', j.halfway_at, 'progress_at', j.progress_at,
    'shared_files', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'kind', f.kind, 'size', f.size,
                       'path', f.path, 'uploaded_at', f.uploaded_at, 'source', f.source, 'mime', f.mime, 'stage', f.stage, 'design_group', f.design_group) order by f.uploaded_at), '[]'::jsonb)
                     from public.job_files f where f.job_id = j.id and f.shared)
  ) order by j.created_at desc), '[]'::jsonb)
  from public.jobs j left join public.contractors c on c.id = j.contractor_id
    left join public.salespeople sp on sp.id = j.sales_id
  where j.buyer_id = auth.uid();
$$;

create function public.customer_can_read(p text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.job_files f join public.jobs j on j.id = f.job_id
                 where f.path = p and j.buyer_id = auth.uid() and (f.shared or f.source = 'customer'));
$$;

-- ---------- what crew can do (no login; the upload code is the key) ----------
create function public.crew_token_active(t text) returns boolean
language sql stable security definer set search_path = '' as $$
  select length(coalesce(t, '')) >= 32 and exists (
    select 1 from public.job_private p join public.jobs j on j.id = p.job_id
     where p.crew_token = t and j.status <> 'lost');
$$;

create function public.crew_job(p_token text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'number', j.number, 'trade', j.trade, 'status', j.status, 'address', j.address, 'zip', j.zip, 'state', j.state,
    'description', j.description, 'scheduled_for', j.scheduled_for,
    'customer_name', coalesce(b.name, j.contact_name), 'customer_phone', coalesce(b.phone, j.contact_phone), 'crew_name', c.name,
    'uploads', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'mime', f.mime, 'stage', f.stage,
                  'note', f.note, 'path', f.path, 'uploaded_at', f.uploaded_at) order by f.uploaded_at), '[]'::jsonb)
                from public.job_files f where f.job_id = j.id and f.source = 'crew' and f.contractor_id is not distinct from j.contractor_id),
    'notes', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'text', n.text, 'created_at', n.created_at) order by n.created_at), '[]'::jsonb)
                from public.crew_notes n where n.job_id = j.id and n.contractor_id is not distinct from j.contractor_id))
  from public.job_private p
  join public.jobs j on j.id = p.job_id
  left join public.profiles b on b.id = j.buyer_id
  left join public.contractors c on c.id = j.contractor_id
  where public.crew_token_active(p_token) and p.crew_token = p_token;
$$;

create function public.crew_add_file(p_token text, p_path text, p_name text, p_mime text, p_size bigint, p_stage text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare jid uuid; cid uuid; cname text;
begin
  if not public.crew_token_active(p_token) then
    raise exception 'This upload link is no longer active. Ask the Top Hat office for a new one.';
  end if;
  if p_path not like 'crew/' || p_token || '/%' then raise exception 'Bad file path.'; end if;
  select j.id, j.contractor_id, c.name into jid, cid, cname
    from public.job_private p join public.jobs j on j.id = p.job_id left join public.contractors c on c.id = j.contractor_id
   where p.crew_token = p_token;
  insert into public.job_files (job_id, path, name, mime, size, kind, stage, note, source, by_name, contractor_id)
  values (jid, p_path, left(p_name, 200), left(coalesce(p_mime, ''), 100), coalesce(p_size, 0),
          case when p_mime like 'image/%' then 'photo' else 'other' end,
          case when p_stage in ('before', 'during', 'after') then p_stage else '' end,
          left(coalesce(p_note, ''), 500), 'crew', coalesce(cname, 'Crew'), cid);
end $$;

-- ---------- estimates & invoices ----------
-- Company details printed on every estimate and invoice (one row).
create table public.settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
insert into public.settings (id, data) values (1, jsonb_build_object(
  'name', 'Top Hat Contracting', 'phone', '', 'email', '', 'address', '', 'license', '',
  'taxRate', 0, 'dueDays', 14, 'showCrewPay', true,
  'estimatePaymentInstructions', 'We accept Zelle, check, cash and card.',
  'paymentInstructions', E'We accept cash, check, Zelle, card, Venmo and Cash App.\nMake checks payable to Top Hat Contracting.',
  'estimateTerms', 'This estimate is valid for 30 days. Work begins once the estimate is approved.',
  'invoiceTerms', 'Thank you for choosing Top Hat Contracting!'));

-- Customer-facing documents. Only the customer price lives here; crew pay never does.
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  type text not null check (type in ('estimate', 'invoice')),
  number text not null unique,
  status text not null default 'draft' check (status in ('draft', 'sent', 'approved', 'declined', 'void')),
  items jsonb not null default '[]' check (jsonb_typeof(items) = 'array'),
  tax_rate numeric(6, 3) not null default 0 check (tax_rate >= 0),
  notes text not null default '',
  due_date date,
  pay_link text not null default '' check (pay_link = '' or pay_link ~* '^https://'),
  payments jsonb not null default '[]' check (jsonb_typeof(payments) = 'array'),
  from_estimate uuid references public.documents(id) on delete set null,
  -- An invoice for one payment on the payment schedule: which payment, and the job total it was worked out from.
  schedule_step smallint check (schedule_step between 0 and 19),
  schedule_base numeric(12, 2) check (schedule_base >= 0),
  -- Estimate signature: { name, image (PNG data URL), at, in_person, witness }. Set once, when approved.
  signature jsonb check (signature is null or (jsonb_typeof(signature) = 'object' and length(signature->>'name') between 3 and 120 and (signature->>'image') ~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' and length(signature->>'image') <= 300000)),
  check (type = 'invoice' or schedule_step is null),
  change_order boolean not null default false,   -- an estimate for extra work on a sold job; approving it adds to the price
  check (type = 'estimate' or not change_order),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  responded_at timestamptz,
  responded_by text not null default ''
);
create index on public.documents (job_id);

-- Payments the customer says they sent, until the office confirms them.
create table public.payment_reports (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references public.documents(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  method text not null default 'Other',
  note text not null default '' check (length(note) <= 300),
  reported_by text not null default '',
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'not_received')),
  -- The customer's signature authorizing the payment: { name, image (PNG data URL), at }.
  signature jsonb check (signature is null or (jsonb_typeof(signature) = 'object' and length(signature->>'name') between 3 and 120 and (signature->>'image') ~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' and length(signature->>'image') <= 300000)),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text not null default ''
);
create index on public.payment_reports (doc_id);

-- Contractors bill Top Hat for each step of the crew pay schedule (or extra work/materials). Office only; crew go through crew_bill().
create table public.crew_bills (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  contractor_id uuid not null references public.contractors(id) on delete cascade,
  step smallint check (step between 0 and 19),          -- null = extra work / materials
  label text not null check (length(label) between 1 and 60),
  amount numeric(12, 2) not null check (amount > 0 and amount <= 100000),
  note text not null default '' check (length(note) <= 500),
  status text not null default 'submitted' check (status in ('submitted', 'approved', 'declined', 'paid')),
  reason text not null default '' check (length(reason) <= 300),
  paid_date date,
  paid_method text not null default '' check (length(paid_method) <= 40),
  by_name text not null default '',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text not null default '',
  -- Lien waiver: the contractor signs once they're paid for this bill. { name, image, at }
  lien_sig jsonb check (lien_sig is null or (jsonb_typeof(lien_sig) = 'object' and length(lien_sig->>'name') between 3 and 120
    and (lien_sig->>'image') ~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' and length(lien_sig->>'image') <= 300000))
);
create index on public.crew_bills (job_id);
-- Photos the contractor sent with a bill (required), so the office can see the work.
alter table public.job_files add column bill_id uuid references public.crew_bills(id) on delete set null;
create index on public.job_files (bill_id);
alter table public.crew_bills enable row level security;
create policy "staff reads crew bills" on public.crew_bills for select to authenticated using (public.is_staff());
revoke all on public.crew_bills from anon;
revoke insert, update, delete on public.crew_bills from authenticated;
alter table public.payment_reports enable row level security;
create policy "office reads reports" on public.payment_reports for select to authenticated using (public.can_access_job(job_id));
revoke all on public.payment_reports from anon;
revoke insert, update, delete on public.payment_reports from authenticated;

create function public.doc_total(items jsonb, tax numeric) returns numeric
language sql immutable set search_path = '' as $$
  select round(coalesce((select sum(coalesce((i->>'qty')::numeric, 0) * coalesce((i->>'price')::numeric, 0))
                         from jsonb_array_elements(items) i), 0) * (1 + coalesce(tax, 0) / 100), 2);
$$;
create function public.doc_paid(payments jsonb) returns numeric
language sql immutable set search_path = '' as $$
  select coalesce((select sum((p->>'amount')::numeric) from jsonb_array_elements(payments) p), 0);
$$;

-- Numbers (E-1042, INV-1042, INV-1042-2…) and the rules about what can change when.
create function public.docs_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare jn bigint; n int;
begin
  if exists (select 1 from jsonb_array_elements(new.items) i
             where coalesce((i->>'qty')::numeric, 0) < 0 or coalesce((i->>'price')::numeric, 0) < 0) then
    raise exception 'Amounts can''t be negative.';
  end if;
  if exists (select 1 from jsonb_array_elements(new.payments) p where coalesce((p->>'amount')::numeric, 0) <= 0) then
    raise exception 'Payment amounts must be more than zero.';
  end if;
  if tg_op = 'INSERT' then
    if new.change_order and not public.is_staff() then raise exception 'Only the office can write change orders.'; end if;
    select number into jn from public.jobs where id = new.job_id;
    select count(*) + 1 into n from public.documents where job_id = new.job_id and type = new.type and change_order = new.change_order;
    new.number := case when new.type = 'invoice' then 'INV-' when new.change_order then 'CO-' else 'E-' end || jn || case when n > 1 then '-' || n else '' end;
    new.status := 'draft';
    new.payments := '[]';
    return new;
  end if;
  new.job_id := old.job_id; new.type := old.type; new.number := old.number; new.created_at := old.created_at; new.change_order := old.change_order;
  new.schedule_step := old.schedule_step; new.schedule_base := old.schedule_base;
  if new.signature is distinct from old.signature and not (
       (old.type = 'estimate' and old.status = 'sent' and new.status = 'approved' and old.signature is null)
    -- signed afterwards: an invoice that's out, or an estimate approved by phone
    or (old.signature is null and new.signature is not null and new.status = old.status
        and ((old.type = 'invoice' and old.status not in ('draft', 'void')) or (old.type = 'estimate' and old.status = 'approved')))) then
    raise exception 'A signature is added only when the estimate is approved, or to an invoice or approved estimate that isn''t signed yet.';
  end if;
  if (new.items, new.tax_rate) is distinct from (old.items, old.tax_rate)
     and not (old.status = 'draft' or (old.status = 'sent' and jsonb_array_length(old.payments) = 0)) then
    raise exception 'This document is locked and can''t be edited.';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'draft' and new.status = 'sent')
    or (old.type = 'estimate' and old.status = 'sent' and new.status in ('approved', 'declined'))
    or (old.type = 'invoice' and old.status <> 'void' and new.status = 'void')) then
    raise exception 'That change isn''t allowed.';
  end if;
  if new.payments is distinct from old.payments and (old.type <> 'invoice' or old.status in ('draft', 'void')) then
    raise exception 'Send the invoice before recording payments.';
  end if;
  if public.my_sales() is not null and not public.is_staff() and (new.payments is distinct from old.payments or new.status = 'void') then
    raise exception 'Only the office can record payments or void invoices.';
  end if;
  if new.status = 'sent' and old.status = 'draft' then new.sent_at := now(); end if;
  return new;
end $$;
create trigger docs_before before insert or update on public.documents
  for each row execute function public.docs_before();

create function public.docs_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare total numeric; last jsonb;
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'Only drafts can be deleted. Void an invoice instead.'; end if;
    perform public.log_event(old.job_id, 'Draft ' || old.number || ' deleted');
    return old;
  end if;
  total := public.doc_total(new.items, new.tax_rate);
  if tg_op = 'INSERT' then
    perform public.log_event(new.job_id, case when new.type = 'invoice' then 'Invoice ' else 'Estimate ' end || new.number || ' created');
    return new;
  end if;
  if new.status is distinct from old.status then
    if new.status = 'sent' then
      perform public.log_event(new.job_id, new.number || ' sent to customer (' || public.usd(total) || ')');
    else
      perform public.log_event(new.job_id, new.number || ' ' || new.status || coalesce(nullif(' by ' || new.responded_by, ' by '), ''));
    end if;
    if new.status = 'approved' and new.change_order then
      -- A change order adds to the price the customer already agreed to.
      update public.job_private set price = coalesce(price, 0) + total where job_id = new.job_id;
    elsif new.status = 'approved' then
      update public.job_private set price = total + coalesce((select sum(public.doc_total(x.items, x.tax_rate)) from public.documents x
        where x.job_id = new.job_id and x.change_order and x.status = 'approved'), 0) where job_id = new.job_id;
      -- Agreed to the price in writing: it's a hot lead, ready for a rep visit.
      update public.jobs set status = 'hot' where id = new.job_id and status in ('new', 'qualifying');
    end if;
  end if;
  if jsonb_array_length(new.payments) > jsonb_array_length(old.payments) then
    last := new.payments -> -1;
    perform public.log_event(new.job_id, 'Payment ' || public.usd((last->>'amount')::numeric) || ' (' || coalesce(last->>'method', 'Other') || ') on ' || new.number);
    if public.doc_paid(new.payments) >= total and public.doc_paid(old.payments) < total then
      perform public.log_event(new.job_id, new.number || ' paid in full');
    end if;
  elsif jsonb_array_length(new.payments) < jsonb_array_length(old.payments) then
    perform public.log_event(new.job_id, 'Payment removed from ' || new.number);
  end if;
  return new;
end $$;
create trigger docs_after after insert or update or delete on public.documents
  for each row execute function public.docs_after();

alter table public.settings enable row level security;
alter table public.documents enable row level security;
create policy "logged in can read" on public.settings for select to authenticated using (true);
create policy "staff edit" on public.settings for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "office only" on public.documents for all to authenticated using (public.can_access_job(job_id)) with check (public.can_access_job(job_id));
revoke all on public.settings, public.documents from anon;
revoke insert, delete on public.settings from authenticated;

-- Customer: everything sent to them on their own jobs (never drafts), keyed by job.
create function public.my_documents() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(job_id, docs), '{}'::jsonb) from (
    select d.job_id, jsonb_agg(jsonb_build_object(
      'id', d.id, 'type', d.type, 'number', d.number, 'status', d.status, 'items', d.items, 'tax_rate', d.tax_rate,
      'notes', d.notes, 'due_date', d.due_date, 'pay_link', d.pay_link, 'payments', d.payments,
      'created_at', d.created_at, 'sent_at', d.sent_at, 'responded_at', d.responded_at,
      'schedule_step', d.schedule_step, 'schedule_base', d.schedule_base, 'signature', d.signature, 'change_order', d.change_order,
      'reports', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'amount', r.amount, 'method', r.method, 'created_at', r.created_at, 'status', r.status, 'signature', r.signature) order by r.created_at), '[]'::jsonb)
                    from public.payment_reports r where r.doc_id = d.id)) order by d.created_at) as docs
    from public.documents d join public.jobs j on j.id = d.job_id
    where j.buyer_id = auth.uid() and d.status <> 'draft'
    group by d.job_id) x;
$$;

-- Customer: approve or decline an estimate that was sent to them.
create function public.respond_estimate(p_doc uuid, p_approve boolean, p_sig_name text default null, p_sig_image text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare who text; sig jsonb;
begin
  if not exists (select 1 from public.documents d join public.jobs j on j.id = d.job_id
                 where d.id = p_doc and j.buyer_id = auth.uid() and d.type = 'estimate' and d.status = 'sent') then
    raise exception 'This estimate can no longer be changed. Call us if you have questions.';
  end if;
  select name into who from public.profiles where id = auth.uid();
  if p_approve and p_sig_image is not null then
    sig := jsonb_build_object('name', left(trim(coalesce(p_sig_name, '')), 120), 'image', p_sig_image, 'at', now(), 'in_person', false);
  end if;
  update public.documents
     set status = case when p_approve then 'approved' else 'declined' end,
         responded_at = now(), responded_by = coalesce(who, 'customer') || ' (customer)', signature = sig
   where id = p_doc;
end $$;

-- Customer: "I've sent my payment." Waits for the office to confirm it arrived.
create function public.report_payment(p_doc uuid, p_amount numeric, p_method text, p_note text, p_sig_name text default null, p_sig_image text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare d record; who text; amt numeric := round(coalesce(p_amount, 0), 2);
begin
  select x.id, x.job_id, x.number, x.status, x.type, public.doc_total(x.items, x.tax_rate) as total into d
    from public.documents x join public.jobs j on j.id = x.job_id where x.id = p_doc and j.buyer_id = auth.uid();
  if d.id is null or d.type <> 'invoice' or d.status in ('draft', 'void') then raise exception 'This invoice can’t take payments.'; end if;
  if amt <= 0 then raise exception 'Enter how much you paid.'; end if;
  if amt > d.total * 2 then raise exception 'That’s more than this invoice. Check the amount.'; end if;
  select name into who from public.profiles where id = auth.uid();
  insert into public.payment_reports (doc_id, job_id, amount, method, note, reported_by, signature)
  values (d.id, d.job_id, amt, case when p_method in ('Zelle', 'Bank transfer (ACH)', 'Check', 'Cash', 'Card', 'Venmo', 'Cash App') then p_method else 'Other' end,
          left(trim(coalesce(p_note, '')), 300), coalesce(who, 'Customer'),
          case when p_sig_image is not null then jsonb_build_object('name', left(trim(coalesce(p_sig_name, '')), 120), 'image', p_sig_image, 'at', now()) end);
  perform public.log_event(d.job_id, '💵 ' || coalesce(who, 'Customer') || ' paid ' || public.usd(amt) || ' on ' || d.number
    || case when p_sig_image is not null then ' (signed “' || left(trim(coalesce(p_sig_name, '')), 120) || '”)' else '' end || '. Confirm it when it arrives.');
end $$;

-- Sign an invoice (any time it's out) or an estimate approved by phone. The customer signs in the app;
-- the office or the job's salesperson can have them sign in person (marked with who was there).
create function public.sign_document(p_doc uuid, p_sig_name text, p_sig_image text) returns void
language plpgsql security definer set search_path = '' as $$
declare d record; who text; nm text := left(trim(coalesce(p_sig_name, '')), 120); mine boolean; office boolean;
begin
  select x.* into d from public.documents x where x.id = p_doc;
  if d.id is null then raise exception 'Not found.'; end if;
  mine := exists (select 1 from public.jobs j where j.id = d.job_id and j.buyer_id = auth.uid());
  office := not mine and public.can_access_job(d.job_id);
  if not mine and not office then raise exception 'Not found.'; end if;
  if d.signature is not null then raise exception 'This is already signed.'; end if;
  if not ((d.type = 'invoice' and d.status not in ('draft', 'void')) or (d.type = 'estimate' and d.status = 'approved')) then raise exception 'This can’t be signed right now.'; end if;
  if length(nm) < 3 then raise exception 'Type your full name.'; end if;
  select name into who from public.profiles where id = auth.uid();
  update public.documents set signature = jsonb_build_object('name', nm, 'image', p_sig_image, 'at', now(), 'in_person', office, 'witness', case when office then coalesce(who, 'Top Hat') end)
   where id = p_doc;
  perform public.log_event(d.job_id, '✍️ ' || d.number || ' signed “' || nm || '”' || case when office then ' in person with ' || coalesce(who, 'Top Hat') else ' in the app' end);
end $$;

-- Crew: bill Top Hat for a step of the crew pay schedule (amount worked out here), or for extra work/materials.
create function public.crew_bill(p_job uuid, p_step int, p_amount numeric, p_note text, p_paths text[], p_invoice text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare cid uuid := public.my_crew(); j record; pay numeric; steps jsonb; n int; s jsonb; i int := 0; amt numeric; left_amt numeric; show_pay boolean;
  who text; lbl text; nt text := left(trim(coalesce(p_note, '')), 500); rec public.crew_bills; linked int; ins record;
begin
  if cid is null then raise exception 'Your crew login is turned off. Ask the Top Hat office if this is a mistake.'; end if;
  -- Proof of insurance on file (and not run out) before any bill.
  select insurance_path, insurance_expires into ins from public.contractors where id = cid;
  if ins.insurance_path is null then raise exception 'Upload your proof of insurance first. Top Hat needs it before your first bill.'; end if;
  if ins.insurance_expires is not null and ins.insurance_expires < current_date then
    raise exception 'Your proof of insurance ran out on %. Upload the new one first.', ins.insurance_expires; end if;
  -- Their own invoice to Top Hat is required with every bill.
  if coalesce(p_invoice, '') = '' then raise exception 'Attach your invoice to Top Hat.'; end if;
  if coalesce(cardinality(p_paths), 0) = 0 then raise exception 'Add at least one photo of the work so the office can see what you did.'; end if;
  if cardinality(p_paths) > 12 then raise exception 'Send up to 12 photos with a bill.'; end if;
  select x.id, x.status, x.halfway_at into j from public.jobs x where x.id = p_job and x.contractor_id = cid and x.status in ('scheduled', 'in_progress', 'completed');
  if j.id is null then raise exception 'That job isn’t assigned to you.'; end if;
  select coalesce((data->>'showCrewPay')::boolean, true), coalesce(data->'crewPaySchedule', '[]'::jsonb) into show_pay, steps from public.settings where id = 1;
  if not coalesce(show_pay, true) then raise exception 'Ask the office about billing for this job.'; end if;
  select name into who from public.contractors where id = cid;
  if p_step is null then
    amt := round(coalesce(p_amount, 0), 2);
    if amt <= 0 or amt > 100000 then raise exception 'Enter the amount for the extra work or materials.'; end if;
    if length(nt) < 3 then raise exception 'Say what the extra work or materials were.'; end if;
    lbl := 'Extra work / materials';
  else
    select crew_pay into pay from public.job_costs where job_id = p_job;
    if pay is null then raise exception 'The office hasn’t set your pay for this job yet.'; end if;
    if jsonb_typeof(steps) <> 'array' or jsonb_array_length(steps) = 0 then
      steps := '[{"label":"Work started","pct":30,"when":"start"},{"label":"Halfway done","pct":30,"when":"mid"},{"label":"Job finished","pct":40,"when":"done"}]';
    end if;
    n := jsonb_array_length(steps);
    if p_step < 0 or p_step >= n then raise exception 'That payment isn’t on the schedule.'; end if;
    s := steps -> p_step;
    if not (j.status = 'completed'
            or ((s->>'when') = 'start' and j.status = 'in_progress')
            or ((s->>'when') = 'mid' and j.status = 'in_progress' and j.halfway_at is not null)) then
      raise exception '%', case when s->>'when' = 'done' then 'Finish the job first, then bill for it.'
        when s->>'when' = 'mid' then 'Tap “I’m halfway done” first, then bill for it.' else 'Start the job first, then bill for it.' end;
    end if;
    if exists (select 1 from public.crew_bills where job_id = p_job and step = p_step and status <> 'declined') then raise exception 'You’ve already billed for that.'; end if;
    -- One at a time: the step before has to be approved or paid first.
    if p_step > 0 and not exists (select 1 from public.crew_bills where job_id = p_job and step = p_step - 1 and status in ('approved', 'paid')) then
      raise exception 'Wait until Top Hat approves “%”, then bill for this one.', coalesce(steps -> (p_step - 1) ->> 'label', 'the one before');
    end if;
    left_amt := pay;
    for i in 0 .. n - 1 loop
      amt := case when i = n - 1 then left_amt else round(pay * coalesce((steps -> i ->> 'pct')::numeric, 0) / 100, 2) end;
      left_amt := left_amt - amt;
      exit when i = p_step;
    end loop;
    lbl := left(coalesce(nullif(trim(s->>'label'), ''), 'Payment ' || (p_step + 1)), 60);
  end if;
  insert into public.crew_bills (job_id, contractor_id, step, label, amount, note, by_name) values (p_job, cid, p_step, lbl, amt, nt, coalesce(who, 'Crew')) returning * into rec;
  -- Claim the photos they just uploaded for this job (only their own, not already on another bill).
  update public.job_files set bill_id = rec.id, note = left('Bill: ' || lbl, 500)
   where job_id = p_job and contractor_id = cid and source = 'crew' and kind = 'photo' and bill_id is null and path = any(p_paths);
  get diagnostics linked = row_count;
  if linked = 0 then raise exception 'Add at least one photo of the work so the office can see what you did.'; end if;
  -- Claim their invoice (uploaded for this job, not on another bill).
  update public.job_files set bill_id = rec.id, kind = 'invoice', note = left('Contractor invoice: ' || lbl, 500)
   where job_id = p_job and contractor_id = cid and source = 'crew' and bill_id is null and path = p_invoice and not (path = any(p_paths));
  if not found then raise exception 'Attach your invoice to Top Hat.'; end if;
  perform public.log_event(p_job, '🧾 ' || coalesce(who, 'Crew') || ' billed ' || public.usd(amt) || ' for “' || lbl || '” with their invoice and ' || linked || case when linked = 1 then ' photo' else ' photos' end
    || case when nt <> '' then ': ' || nt else '' end);
  return jsonb_build_object('id', rec.id, 'label', rec.label, 'amount', rec.amount, 'step', rec.step, 'status', rec.status, 'photos', linked);
end $$;

-- Crew: their proof of insurance (one per contractor). The file goes in storage under insurance/<contractor id>/.
create function public.crew_my_insurance() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  select jsonb_build_object('contractor', c.id, 'path', c.insurance_path, 'name', c.insurance_name, 'expires', c.insurance_expires, 'at', c.insurance_at) into r
    from public.contractors c where c.id = public.my_crew();
  return r;
end $$;
-- Storage check: is this file in the signed-in crew member's own insurance folder?
create function public.crew_owns_insurance_path(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare cid uuid := public.my_crew();
begin
  return cid is not null and p_name like 'insurance/' || cid || '/%' and p_name not like '%..%';
end $$;
create function public.crew_set_insurance(p_path text, p_name text, p_expires date) returns void
language plpgsql security definer set search_path = '' as $$
declare cid uuid := public.my_crew();
begin
  if cid is null then raise exception 'Your crew login is turned off. Ask the Top Hat office if this is a mistake.'; end if;
  if p_path is null or p_path not like 'insurance/' || cid || '/%' or p_path like '%..%' then raise exception 'Bad file path.'; end if;
  if p_expires is null then raise exception 'Enter the date your insurance runs out.'; end if;
  if p_expires < current_date then raise exception 'That insurance has already run out. Upload your current one.'; end if;
  update public.contractors set insurance_path = p_path, insurance_name = left(coalesce(p_name, ''), 200), insurance_expires = p_expires, insurance_at = now() where id = cid;
end $$;

-- Crew: their own details (business, email, license, service area, days off, booked dates) and W-9.
create function public.crew_my_profile() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  return (select jsonb_build_object('contractor', c.id, 'name', c.name, 'phone', c.phone, 'trades', c.trades, 'profile', c.profile,
    'w9_path', c.w9_path, 'w9_name', c.w9_name, 'w9_at', c.w9_at)
  from public.contractors c where c.id = public.my_crew());
end $$;
create function public.crew_set_profile(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare cid uuid := public.my_crew(); clean jsonb;
begin
  if cid is null then raise exception 'Your crew login is turned off. Ask the Top Hat office if this is a mistake.'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Bad details.'; end if;
  clean := jsonb_build_object(
    'business', left(trim(coalesce(p->>'business', '')), 120),
    'email', left(trim(coalesce(p->>'email', '')), 120),
    'license_number', left(trim(coalesce(p->>'license_number', '')), 60),
    'license_state', case when upper(coalesce(p->>'license_state', '')) ~ '^[A-Z]{2}$' then upper(p->>'license_state') else '' end,
    'license_expires', case when coalesce(p->>'license_expires', '') ~ '^\d{4}-\d{2}-\d{2}$' then p->>'license_expires' else '' end,
    'service_area', left(trim(coalesce(p->>'service_area', '')), 200),
    'notes', left(trim(coalesce(p->>'notes', '')), 500),
    'days_off', coalesce((select jsonb_agg(distinct v::int) from jsonb_array_elements_text(case when jsonb_typeof(p->'days_off') = 'array' then p->'days_off' else '[]'::jsonb end) v where v ~ '^[0-6]$'), '[]'::jsonb),
    'blocked', coalesce((select jsonb_agg(distinct v) from (select v from jsonb_array_elements_text(case when jsonb_typeof(p->'blocked') = 'array' then p->'blocked' else '[]'::jsonb end) v
      where v ~ '^\d{4}-\d{2}-\d{2}$' and v >= to_char(current_date, 'YYYY-MM-DD') limit 120) x), '[]'::jsonb));
  update public.contractors set profile = clean where id = cid;
end $$;
create function public.crew_set_w9(p_path text, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare cid uuid := public.my_crew();
begin
  if cid is null then raise exception 'Your crew login is turned off. Ask the Top Hat office if this is a mistake.'; end if;
  if p_path is null or p_path not like 'insurance/' || cid || '/%' or p_path like '%..%' then raise exception 'Bad file path.'; end if;
  update public.contractors set w9_path = p_path, w9_name = left(coalesce(p_name, ''), 200), w9_at = now() where id = cid;
end $$;
-- Crew: sign the lien waiver for a bill Top Hat has paid.
create function public.crew_sign_lien(p_bill uuid, p_name text, p_image text) returns void
language plpgsql security definer set search_path = '' as $$
declare cid uuid := public.my_crew(); b record; nm text := left(trim(coalesce(p_name, '')), 120);
begin
  if cid is null then raise exception 'Your crew login is turned off. Ask the Top Hat office if this is a mistake.'; end if;
  select * into b from public.crew_bills where id = p_bill and contractor_id = cid;
  if b.id is null then raise exception 'Bill not found.'; end if;
  if b.status <> 'paid' then raise exception 'You sign the lien waiver once Top Hat has paid this bill.'; end if;
  if b.lien_sig is not null then raise exception 'You already signed this lien waiver.'; end if;
  if length(nm) < 3 then raise exception 'Type your full name.'; end if;
  update public.crew_bills set lien_sig = jsonb_build_object('name', nm, 'image', p_image, 'at', now()) where id = p_bill;
  perform public.log_event(b.job_id, '📝 Lien waiver signed by ' || nm || ' for ' || public.usd(b.amount) || ' (“' || b.label || '”)');
end $$;
-- Crew: the punch list the office made for their job, and checking items off.
create function public.crew_punch(p_job uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.my_crew() is null or not exists (select 1 from public.jobs where id = p_job and contractor_id = public.my_crew()) then raise exception 'Job not found.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'text', r.data->>'text', 'done', coalesce((r.data->>'done')::boolean, false), 'doneBy', coalesce(r.data->>'doneBy', '')) order by r.created_at)
    from public.office_records r where r.kind = 'task' and r.job_id = p_job and coalesce((r.data->>'punch')::boolean, false)), '[]'::jsonb);
end $$;
create function public.crew_punch_done(p_id uuid, p_done boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare r record; who text;
begin
  select x.id, x.job_id, x.data into r from public.office_records x join public.jobs j on j.id = x.job_id
   where x.id = p_id and x.kind = 'task' and coalesce((x.data->>'punch')::boolean, false) and j.contractor_id = public.my_crew() and public.my_crew() is not null;
  if r.id is null then raise exception 'Not found.'; end if;
  select name into who from public.contractors where id = public.my_crew();
  update public.office_records set updated_at = now(), data = data || jsonb_build_object('done', coalesce(p_done, false),
    'doneBy', case when p_done then coalesce(who, 'Crew') else '' end, 'doneAt', case when p_done then (extract(epoch from now()) * 1000)::bigint else null end) where id = p_id;
  perform public.log_event(r.job_id, case when p_done then '✅ ' || coalesce(who, 'Crew') || ' finished punch item: ' else '↩ Punch item reopened by ' || coalesce(who, 'crew') || ': ' end || left(r.data->>'text', 120));
end $$;

-- Crew: "I'm halfway done." Unlocks the halfway bill and tells the office.
create function public.crew_halfway(p_job uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare cid uuid := public.my_crew(); who text;
begin
  if cid is null then raise exception 'Your crew login is turned off. Ask the Top Hat office if this is a mistake.'; end if;
  if not exists (select 1 from public.jobs where id = p_job and contractor_id = cid and status = 'in_progress') then raise exception 'Start the job first.'; end if;
  select name into who from public.contractors where id = cid;
  update public.jobs set halfway_at = now() where id = p_job and halfway_at is null;
  if found then perform public.log_event(p_job, '½ Halfway done (by ' || coalesce(who, 'crew') || ', crew)'); end if;
end $$;

-- Office: approve, decline or pay a crew bill. When the crew pay is all paid, the job is marked crew paid.
create function public.staff_crew_bill(p_bill uuid, p_action text, p_reason text, p_date date, p_method text) returns void
language plpgsql security definer set search_path = '' as $$
declare b record; who text; cname text; paid_steps numeric; pay numeric;
begin
  if not public.is_staff() then raise exception 'Only the office can do that.'; end if;
  select * into b from public.crew_bills where id = p_bill for update;
  if b.id is null then raise exception 'Bill not found.'; end if;
  select name into who from public.profiles where id = auth.uid();
  select name into cname from public.contractors where id = b.contractor_id;
  if p_action = 'approve' and b.status = 'submitted' then
    update public.crew_bills set status = 'approved', resolved_at = now(), resolved_by = coalesce(who, 'Office') where id = b.id;
    perform public.log_event(b.job_id, '🧾 Approved ' || coalesce(cname, 'crew') || '’s bill: ' || public.usd(b.amount) || ' “' || b.label || '”');
  elsif p_action = 'decline' and b.status in ('submitted', 'approved') then
    update public.crew_bills set status = 'declined', reason = left(trim(coalesce(p_reason, '')), 300), resolved_at = now(), resolved_by = coalesce(who, 'Office') where id = b.id;
    perform public.log_event(b.job_id, '🧾 Declined ' || coalesce(cname, 'crew') || '’s bill: ' || public.usd(b.amount) || ' “' || b.label || '”');
  elsif p_action = 'paid' and b.status in ('submitted', 'approved') then
    if p_date is null then raise exception 'Pick the date you paid.'; end if;
    update public.crew_bills set status = 'paid', paid_date = p_date, paid_method = left(coalesce(nullif(trim(p_method), ''), 'Other'), 40), resolved_at = now(), resolved_by = coalesce(who, 'Office') where id = b.id;
    perform public.log_event(b.job_id, '💸 Paid ' || coalesce(cname, 'crew') || ' ' || public.usd(b.amount) || ' for “' || b.label || '”');
    select coalesce(sum(amount), 0) into paid_steps from public.crew_bills where job_id = b.job_id and status = 'paid' and step is not null;
    select crew_pay into pay from public.job_costs where job_id = b.job_id;
    if pay is not null and paid_steps >= pay - 0.01 then
      update public.job_costs set crew_paid_date = p_date, crew_paid_method = left(coalesce(nullif(trim(p_method), ''), 'Other'), 40), crew_paid_note = 'All crew bills paid'
       where job_id = b.job_id and crew_paid_date is null;
    end if;
  else
    raise exception 'That bill can’t be changed now.';
  end if;
end $$;

-- Office: the money arrived (record it as a payment) or it didn't.
create function public.resolve_payment_report(p_report uuid, p_received boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare r record; who text;
begin
  if not public.is_staff() then raise exception 'Only the office can confirm payments.'; end if;
  select * into r from public.payment_reports where id = p_report and status = 'pending' for update;
  if r.id is null then raise exception 'Already handled.'; end if;
  select name into who from public.profiles where id = auth.uid();
  update public.payment_reports set status = case when p_received then 'confirmed' else 'not_received' end, resolved_at = now(), resolved_by = coalesce(who, 'Office')
   where id = r.id;
  if p_received then
    update public.documents set payments = payments || jsonb_build_array(jsonb_build_object('id', replace(gen_random_uuid()::text, '-', ''), 'amount', r.amount, 'method', r.method,
      'date', current_date, 'note', 'Reported by ' || r.reported_by || case when r.note <> '' then ': ' || r.note else '' end))
     where id = r.doc_id;
  else
    perform public.log_event(r.job_id, '💵 ' || public.usd(r.amount) || ' by ' || r.method || ': not received yet');
  end if;
end $$;

-- ---------- crew logins ----------
-- The logged-in crew member's contractor record (null if not crew, or login turned off).
create function public.my_crew() returns uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.contractors c join public.profiles p on p.id = c.user_id
   where p.id = auth.uid() and p.role = 'crew' and p.contractor_id = c.id;
$$;

-- Office: make a one-time invite code for a contractor.
create function public.staff_invite_crew(p_contractor uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare code text;
begin
  if not public.is_staff() then raise exception 'Please log in as Top Hat staff.'; end if;
  if exists (select 1 from public.contractors where id = p_contractor and user_id is not null) then
    raise exception 'This crew member already has a login.';
  end if;
  update public.contractors set invite_code = public.new_crew_token() where id = p_contractor returning invite_code into code;
  if code is null then raise exception 'Contractor not found.'; end if;
  return code;
end $$;

-- Office: turn off a crew login (and any pending invite).
create function public.staff_revoke_crew(p_contractor uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'Please log in as Top Hat staff.'; end if;
  update public.profiles set contractor_id = null where id = (select user_id from public.contractors where id = p_contractor);
  update public.contractors set user_id = null, invite_code = null where id = p_contractor;
end $$;

create function public.crew_invite_info(p_code text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('name', name) from public.contractors
   where length(coalesce(p_code, '')) >= 32 and invite_code = p_code and user_id is null;
$$;

-- New account + invite code → crew login linked to that contractor. The code works once.
create function public.claim_crew_invite(p_code text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.contractors;
begin
  if auth.uid() is null then raise exception 'Please create your login first.'; end if;
  select * into c from public.contractors
   where length(coalesce(p_code, '')) >= 32 and invite_code = p_code and user_id is null for update;
  if c.id is null then raise exception 'This invite link has already been used or was cancelled. Ask the office for a new one.'; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and role <> 'buyer')
     or exists (select 1 from public.jobs where buyer_id = auth.uid()) then
    raise exception 'That email already has an account. Use a different email, or ask the office.';
  end if;
  update public.profiles set role = 'crew', contractor_id = c.id,
         name = coalesce(nullif(name, ''), c.name), phone = coalesce(nullif(phone, ''), c.phone)
   where id = auth.uid();
  update public.contractors set user_id = auth.uid(), invite_code = null where id = c.id;
end $$;

-- Crew: their own assigned jobs only. Their pay (if the office allows), never the customer price.
create function public.crew_my_jobs() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare cid uuid := public.my_crew(); show_pay boolean;
begin
  if cid is null then raise exception 'Your crew login is turned off. Ask the Top Hat office if this is a mistake.'; end if;
  select coalesce((data->>'showCrewPay')::boolean, true) into show_pay from public.settings where id = 1;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', j.id, 'number', j.number, 'trade', j.trade, 'status', j.status, 'scheduled_for', j.scheduled_for,
      'stage', j.stage, 'progress_at', j.progress_at, 'progress_by', j.progress_by,
      'crew_response', j.crew_response, 'crew_response_note', j.crew_response_note,
      'started_at', j.started_at, 'finished_at', j.finished_at, 'halfway_at', j.halfway_at,
      'customer_photos', (select coalesce(jsonb_agg(f.path order by f.uploaded_at), '[]'::jsonb) from public.job_files f
                           where f.job_id = j.id and f.source = 'customer' and f.mime like 'image/%'),
      'design_photos', (select coalesce(jsonb_agg(jsonb_build_object('path', f.path, 'name', f.name, 'stage', f.stage, 'design_group', f.design_group) order by f.uploaded_at), '[]'::jsonb) from public.job_files f
                           where f.job_id = j.id and f.source = 'design'),
      'address', j.address, 'zip', j.zip, 'state', j.state, 'description', j.description, 'style', j.style,
      'materials', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'qty', m.qty, 'note', m.note, 'status', m.status, 'eta', m.eta) order by m.created_at), '[]'::jsonb)
                    from public.job_materials m where m.job_id = j.id),
      'customer_name', coalesce(b.name, j.contact_name), 'customer_phone', coalesce(b.phone, j.contact_phone), 'crew_token', p.crew_token,
      'crew_pay', case when coalesce(show_pay, true) then (select k.crew_pay from public.job_costs k where k.job_id = j.id) end,
      'photos', (select count(*) from public.job_files f where f.job_id = j.id and f.source = 'crew' and f.contractor_id = cid),
      'uploads', (select coalesce(jsonb_agg(jsonb_build_object('path', f.path, 'name', f.name, 'stage', f.stage, 'mime', f.mime, 'uploaded_at', f.uploaded_at) order by f.uploaded_at), '[]'::jsonb)
                    from public.job_files f where f.job_id = j.id and f.source = 'crew' and f.contractor_id = cid),
      'crew_paid_date', case when coalesce(show_pay, true) then (select k.crew_paid_date from public.job_costs k where k.job_id = j.id) end,
      'bills', case when coalesce(show_pay, true) then (select coalesce(jsonb_agg(jsonb_build_object('id', cb.id, 'step', cb.step, 'label', cb.label, 'amount', cb.amount, 'note', cb.note,
                  'status', cb.status, 'reason', cb.reason, 'paid_date', cb.paid_date, 'paid_method', cb.paid_method, 'created_at', cb.created_at,
                  'photos', (select count(*) from public.job_files f where f.bill_id = cb.id and f.kind <> 'invoice'),
                  'invoice', exists (select 1 from public.job_files f where f.bill_id = cb.id and f.kind = 'invoice'), 'lien', cb.lien_sig is not null) order by cb.created_at), '[]'::jsonb)
                  from public.crew_bills cb where cb.job_id = j.id and cb.contractor_id = cid) else '[]'::jsonb end,
      'crew_paid_method', case when coalesce(show_pay, true) then (select k.crew_paid_method from public.job_costs k where k.job_id = j.id) end,
      'notes', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'text', n.text, 'created_at', n.created_at) order by n.created_at), '[]'::jsonb)
                  from public.crew_notes n where n.job_id = j.id and n.contractor_id = cid)
    ) order by j.scheduled_for nulls last), '[]'::jsonb)
    from public.jobs j
    join public.job_private p on p.job_id = j.id
    left join public.profiles b on b.id = j.buyer_id
    where j.contractor_id = cid and j.status in ('scheduled', 'in_progress', 'completed'));
end $$;

-- Crew: update progress on their own job. Status moves between Scheduled / Working / Done (either way);
-- stage is null, 'on_the_way' (while Scheduled), or 'waiting_parts' / 'return_visit' (while Working).
create function public.crew_set_progress(p_job uuid, p_status text, p_stage text) returns void
language plpgsql security definer set search_path = '' as $$
declare cid uuid := public.my_crew(); cur text; nxt text; who text;
begin
  if cid is null then raise exception 'Your crew login is turned off. Ask the Top Hat office if this is a mistake.'; end if;
  select status into cur from public.jobs where id = p_job and contractor_id = cid for update;
  nxt := coalesce(p_status, cur);
  if cur is null or cur not in ('scheduled', 'in_progress', 'completed') or nxt not in ('scheduled', 'in_progress', 'completed') then
    raise exception 'That update isn''t available for this job.';
  end if;
  if p_stage is not null and not ((p_stage = 'on_the_way' and nxt = 'scheduled')
     or (p_stage in ('waiting_parts', 'return_visit') and nxt = 'in_progress')) then
    raise exception 'That update isn''t available right now.';
  end if;
  select name into who from public.profiles where id = auth.uid();
  update public.jobs set status = nxt, stage = p_stage, progress_at = now(),
         progress_by = coalesce(who, 'Crew'), progress_by_crew = true
   where id = p_job;
end $$;

-- Crew: confirm they'll do a scheduled job, or tell the office they can't (reason required).
create function public.crew_respond(p_job uuid, p_response text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare cid uuid := public.my_crew(); who text; note text := left(trim(coalesce(p_note, '')), 500);
begin
  if cid is null then raise exception 'Your crew login is turned off. Ask the Top Hat office if this is a mistake.'; end if;
  if p_response not in ('confirmed', 'declined') or not exists (
       select 1 from public.jobs where id = p_job and contractor_id = cid and status = 'scheduled') then
    raise exception 'That isn''t available for this job.';
  end if;
  if p_response = 'declined' and note = '' then raise exception 'Tell the office why, so they can plan.'; end if;
  select name into who from public.contractors where id = cid;
  update public.jobs set crew_response = p_response, crew_response_note = note, crew_response_at = now(),
         progress_at = now(), progress_by = coalesce(who, 'Crew'), progress_by_crew = true
   where id = p_job;
  if p_response = 'confirmed' then
    perform public.log_event(p_job, coalesce(who, 'Crew') || ' confirmed the job');
  else
    insert into public.crew_notes (job_id, contractor_id, by_name, text) values (p_job, cid, coalesce(who, 'Crew'), 'Can’t make it: ' || note);
    perform public.log_event(p_job, coalesce(who, 'Crew') || ' can’t make it');
  end if;
end $$;

-- Logged-in crew may open the customer's request photos, only on jobs assigned to them.
create function public.crew_can_read_customer(p text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.job_files f join public.jobs j on j.id = f.job_id
                 where f.path = p and f.source in ('customer', 'design') and j.contractor_id = public.my_crew()
                   and j.status in ('scheduled', 'in_progress', 'completed'));
$$;

-- Crew: add a note to their job, from the job's photo link (p_token) or their crew login (p_job).
create function public.crew_add_note(p_token text, p_job uuid, p_text text) returns void
language plpgsql security definer set search_path = '' as $$
declare jid uuid; cid uuid; cname text;
begin
  if length(trim(coalesce(p_text, ''))) = 0 then raise exception 'Write a note first.'; end if;
  if length(p_text) > 2000 then raise exception 'Notes can be up to 2000 characters.'; end if;
  if p_token is not null then
    if not public.crew_token_active(p_token) then
      raise exception 'This link is no longer active. Ask the Top Hat office for a new one.';
    end if;
    select j.id, j.contractor_id into jid, cid
      from public.job_private p join public.jobs j on j.id = p.job_id where p.crew_token = p_token;
  else
    cid := public.my_crew();
    if cid is null then raise exception 'Your crew login is turned off. Ask the Top Hat office if this is a mistake.'; end if;
    select id into jid from public.jobs
     where id = p_job and contractor_id = cid and status in ('scheduled', 'in_progress', 'completed');
    if jid is null then raise exception 'You can only add notes to your own jobs.'; end if;
  end if;
  select name into cname from public.contractors where id = cid;
  insert into public.crew_notes (job_id, contractor_id, by_name, text) values (jid, cid, coalesce(cname, 'Crew'), trim(p_text));
  perform public.log_event(jid, coalesce(cname, 'Crew') || ' added a crew note');
end $$;

-- ---------- sales team ----------
-- Office or salesperson: record a phone call on a job they can reach.
create function public.log_call(p_job uuid, p_outcome text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare who text; note text := left(trim(coalesce(p_note, '')), 500);
begin
  if not public.can_access_job(p_job) then raise exception 'Job not found.'; end if;
  if length(trim(coalesce(p_outcome, ''))) = 0 then raise exception 'Pick how the call went.'; end if;
  select name into who from public.profiles where id = auth.uid();
  perform public.log_event(p_job, '📞 Call (' || coalesce(who, 'office') || '): ' || left(trim(p_outcome), 40) || case when note <> '' then '. ' || note else '' end);
  insert into public.job_messages (job_id, by_name, by_user, channel, dir, body)
    values (p_job, coalesce(who, 'Office'), auth.uid(), 'call', 'out', left(trim(p_outcome), 40) || case when note <> '' then '. ' || note else '' end);
  update public.jobs set first_contact_at = now() where id = p_job and first_contact_at is null;
end $$;

-- Office or salesperson: save a text or email to the job's conversation (sent from their phone, or the customer's reply).
create function public.log_message(p_job uuid, p_channel text, p_dir text, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare who text; b text := left(trim(coalesce(p_body, '')), 2000);
begin
  if not public.is_staff() then raise exception 'Only the office can do that.'; end if;
  if not public.can_access_job(p_job) then raise exception 'Job not found.'; end if;
  if p_channel not in ('text', 'email', 'call') or p_dir not in ('in', 'out') then raise exception 'Bad message.'; end if;
  if b = '' then raise exception 'Type the message first.'; end if;
  if p_dir = 'out' and (select do_not_contact from public.jobs where id = p_job) then raise exception 'This customer asked not to be contacted.'; end if;
  select name into who from public.profiles where id = auth.uid();
  insert into public.job_messages (job_id, by_name, by_user, channel, dir, body) values (p_job, coalesce(who, 'Office'), auth.uid(), p_channel, p_dir, b);
  if p_dir = 'out' then update public.jobs set first_contact_at = now() where id = p_job and first_contact_at is null; end if;
  perform public.log_event(p_job, case p_channel when 'email' then '✉️ Email' when 'call' then '📞 Call' else '💬 Text' end
    || case when p_dir = 'in' then ' from the customer' else ' sent by ' || coalesce(who, 'office') end);
end $$;

-- Customer: "apply for my building permit". Their typed full name is the signature.
create function public.authorize_permit(p_job uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare nm text := left(trim(coalesce(p_name, '')), 120); who text;
begin
  if not public.owns_job(p_job::text) then raise exception 'Job not found.'; end if;
  if length(nm) < 3 then raise exception 'Type your full name to sign.'; end if;
  select name into who from public.profiles where id = auth.uid();
  update public.jobs set permit_authorized_by = nm, permit_authorized_at = now(),
    permit_status = case when permit_status in ('none', 'not_needed') then 'authorized' else permit_status end
   where id = p_job;
  perform public.log_event(p_job, '📋 ' || coalesce(who, 'Customer') || ' approved applying for the building permit (signed “' || nm || '”)');
end $$;

-- Design studio: the customer on their own job, or office/sales on theirs. Checked by the design Edge Function.
create function public.can_design(p_job uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.owns_job(p_job::text) or public.can_access_job(p_job);
$$;

create function public.staff_invite_sales(p_sales uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare code text;
begin
  if not public.is_staff() then raise exception 'Please log in as Top Hat staff.'; end if;
  if exists (select 1 from public.salespeople where id = p_sales and user_id is not null) then raise exception 'This salesperson already has a login.'; end if;
  update public.salespeople set invite_code = public.new_crew_token() where id = p_sales returning invite_code into code;
  if code is null then raise exception 'Salesperson not found.'; end if;
  return code;
end $$;

create function public.staff_revoke_sales(p_sales uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'Please log in as Top Hat staff.'; end if;
  update public.profiles set sales_id = null where id = (select user_id from public.salespeople where id = p_sales);
  update public.salespeople set user_id = null, invite_code = null where id = p_sales;
end $$;

create function public.sales_invite_info(p_code text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('name', name) from public.salespeople
   where length(coalesce(p_code, '')) >= 32 and invite_code = p_code and user_id is null;
$$;

create function public.claim_sales_invite(p_code text) returns void
language plpgsql security definer set search_path = '' as $$
declare x public.salespeople;
begin
  if auth.uid() is null then raise exception 'Please create your login first.'; end if;
  select * into x from public.salespeople
   where length(coalesce(p_code, '')) >= 32 and invite_code = p_code and user_id is null for update;
  if x.id is null then raise exception 'This invite link has already been used or was cancelled. Ask the office for a new one.'; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and role <> 'buyer')
     or exists (select 1 from public.jobs where buyer_id = auth.uid()) then
    raise exception 'That email already has an account. Use a different email, or ask the office.';
  end if;
  update public.profiles set role = 'sales', sales_id = x.id,
         name = coalesce(nullif(name, ''), x.name), phone = coalesce(nullif(phone, ''), x.phone)
   where id = auth.uid();
  update public.salespeople set user_id = auth.uid(), invite_code = null where id = x.id;
end $$;

-- Crew list for picking a crew: names, phones and trades only (no logins or invite links).
create function public.office_crew_list() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when public.is_staff() or public.my_sales() is not null then
    (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'phone', phone, 'trades', trades, 'active', active, 'state', state) order by name), '[]'::jsonb)
       from public.contractors)
  else '[]'::jsonb end;
$$;

-- Files: a salesperson reaches files on their own clients' jobs.
create function public.office_can_access_path(p text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.job_files f where f.path = p and public.can_access_job(f.job_id))
      or (split_part(p, '/', 1) ~ '^[0-9a-f-]{36}$' and split_part(p, '/', 2) = 'staff'
          and public.can_access_job(split_part(p, '/', 1)::uuid));
$$;

-- ---------- design studio pictures: read-only to the people on the job ----------
alter table public.design_versions enable row level security;
create policy "design read" on public.design_versions for select to authenticated using (public.can_design(job_id));
revoke all on public.design_versions from anon;
revoke insert, update, delete on public.design_versions from authenticated;

-- ---------- function permissions ----------
revoke execute on all functions in schema public from public, anon, authenticated;
-- Materials: office and the job's salesperson read and change them; crew add what they need and mark things delivered.
alter table public.job_materials enable row level security;
create policy "office reads materials" on public.job_materials for select to authenticated using (public.can_access_job(job_id));
create policy "office adds materials" on public.job_materials for insert to authenticated with check (public.can_access_job(job_id));
create policy "office changes materials" on public.job_materials for update to authenticated using (public.can_access_job(job_id)) with check (public.can_access_job(job_id));
create policy "office removes materials" on public.job_materials for delete to authenticated using (public.can_access_job(job_id));
revoke all on public.job_materials from anon;

create function public.crew_material_add(p_job uuid, p_name text, p_qty text, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare cid uuid := public.my_crew(); who text; nm text := trim(coalesce(p_name, '')); rid uuid;
begin
  if cid is null then raise exception 'Your crew login is turned off. Ask the Top Hat office if this is a mistake.'; end if;
  if not exists (select 1 from public.jobs where id = p_job and contractor_id = cid and status in ('scheduled', 'in_progress', 'completed')) then raise exception 'That job isn’t assigned to you.'; end if;
  if length(nm) < 2 then raise exception 'What material is it?'; end if;
  select name into who from public.contractors where id = cid;
  insert into public.job_materials (job_id, name, qty, note, added_by, updated_by) values (p_job, left(nm, 120), left(trim(coalesce(p_qty, '')), 40), left(trim(coalesce(p_note, '')), 300), coalesce(who, 'Crew'), coalesce(who, 'Crew')) returning id into rid;
  return rid;
end $$;

create function public.crew_material_delivered(p_item uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare cid uuid := public.my_crew(); who text; m record;
begin
  if cid is null then raise exception 'Your crew login is turned off. Ask the Top Hat office if this is a mistake.'; end if;
  select x.* into m from public.job_materials x join public.jobs j on j.id = x.job_id where x.id = p_item and j.contractor_id = cid;
  if m.id is null then raise exception 'That material isn’t on your job.'; end if;
  select name into who from public.contractors where id = cid;
  update public.job_materials set status = 'delivered', updated_by = coalesce(who, 'Crew'), updated_at = now() where id = p_item and status <> 'delivered';
end $$;

-- Every material added or moved along goes into the job's history.
create function public.job_materials_log() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_event(new.job_id, '🛒 ' || coalesce(nullif(new.added_by, ''), 'Office') || ' added material: ' || new.name || case when new.qty <> '' then ' (' || new.qty || ')' else '' end);
  elsif new.status is distinct from old.status then
    perform public.log_event(new.job_id, case new.status when 'ordered' then '📦 ' when 'delivered' then '✅ ' else '🛒 ' end || new.name || ': '
      || case new.status when 'needed' then 'needs ordering' else new.status end || ' (' || coalesce(nullif(new.updated_by, ''), 'Office') || ')');
  end if;
  return new;
end $$;
create trigger job_materials_log after insert or update on public.job_materials for each row execute function public.job_materials_log();

-- Reviews: the office or the job's salesperson asks; the customer rates the finished job.
create function public.office_ask_review(p_job uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare who text;
begin
  if not public.can_access_job(p_job) then raise exception 'Job not found.'; end if;
  select name into who from public.profiles where id = auth.uid();
  update public.jobs set review_requested_at = now(), review_requested_by = coalesce(who, 'Office') where id = p_job and status = 'completed';
  if not found then raise exception 'You can ask for a review once the job is finished.'; end if;
  perform public.log_event(p_job, '⭐ ' || coalesce(who, 'Office') || ' asked the customer for a review');
end $$;

create function public.customer_review(p_job uuid, p_rating int, p_comment text) returns void
language plpgsql security definer set search_path = '' as $$
declare who text; c text := left(trim(coalesce(p_comment, '')), 1000);
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then raise exception 'Tap 1 to 5 stars.'; end if;
  select name into who from public.profiles where id = auth.uid();
  update public.jobs set review_rating = p_rating, review_comment = c, review_at = now() where id = p_job and buyer_id = auth.uid() and status = 'completed';
  if not found then raise exception 'You can review the job once it’s finished.'; end if;
  perform public.log_event(p_job, '⭐ ' || coalesce(who, 'Customer') || ' left a ' || p_rating || '-star review' || case when c <> '' then ': “' || c || '”' else '' end);
end $$;

grant select, insert, update, delete on public.job_materials to authenticated;
grant execute on function public.crew_material_add(uuid, text, text, text), public.crew_material_delivered(uuid),
  public.office_ask_review(uuid), public.customer_review(uuid, int, text), public.sign_document(uuid, text, text) to authenticated;

grant execute on function public.is_staff(), public.owns_job(text), public.customer_can_read(text),
  public.create_job(text, text, text, text, text, text, text, text), public.add_customer_file(uuid, text, text, text, bigint),
  public.my_jobs(), public.my_documents(), public.respond_estimate(uuid, boolean, text, text),
  public.staff_invite_crew(uuid), public.staff_revoke_crew(uuid), public.claim_crew_invite(text),
  public.crew_my_jobs(), public.crew_set_progress(uuid, text, text), public.crew_respond(uuid, text, text),
  public.crew_can_read_customer(text), public.my_sales(), public.can_access_job(uuid), public.office_can_see_profile(uuid),
  public.office_can_access_path(text), public.log_call(uuid, text, text), public.log_message(uuid, text, text, text), public.staff_invite_sales(uuid), public.staff_revoke_sales(uuid),
  public.claim_sales_invite(text), public.office_crew_list(), public.authorize_permit(uuid, text), public.can_design(uuid),
  public.report_payment(uuid, numeric, text, text, text, text), public.resolve_payment_report(uuid, boolean),
  public.crew_bill(uuid, int, numeric, text, text[], text), public.crew_my_insurance(), public.crew_set_insurance(text, text, date), public.crew_owns_insurance_path(text), public.staff_crew_bill(uuid, text, text, date, text), public.crew_halfway(uuid),
  public.crew_my_profile(), public.crew_set_profile(jsonb), public.crew_set_w9(text, text), public.crew_sign_lien(uuid, text, text), public.crew_punch(uuid), public.crew_punch_done(uuid, boolean) to authenticated;
grant execute on function public.sales_invite_info(text) to anon, authenticated;
grant execute on function public.crew_invite_info(text) to anon, authenticated;
grant execute on function public.crew_add_note(text, uuid, text) to anon, authenticated;
grant execute on function public.crew_token_active(text), public.crew_job(text),
  public.crew_add_file(text, text, text, text, bigint, text, text) to anon, authenticated;
-- Trigger and helper functions run with the table owner's rights; no one needs to call them directly.

-- ---------- file storage ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('job-files', 'job-files', false, 15728640)
on conflict (id) do update set public = false, file_size_limit = 15728640;

drop policy if exists "th staff all files" on storage.objects;
drop policy if exists "th customer upload request photos" on storage.objects;
drop policy if exists "th customer read shared" on storage.objects;
drop policy if exists "th crew upload" on storage.objects;
drop policy if exists "th crew read own" on storage.objects;
drop policy if exists "th crew read customer photos" on storage.objects;
drop policy if exists "th sales files" on storage.objects;

create policy "th sales files" on storage.objects for all to authenticated
  using (bucket_id = 'job-files' and public.my_sales() is not null and public.office_can_access_path(name))
  with check (bucket_id = 'job-files' and public.my_sales() is not null and public.office_can_access_path(name));
create policy "th staff all files" on storage.objects for all to authenticated
  using (bucket_id = 'job-files' and public.is_staff())
  with check (bucket_id = 'job-files' and public.is_staff());

-- Customers: upload photos with their request, into their own job's folder.
create policy "th customer upload request photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'job-files' and (storage.foldername(name))[2] = 'customer' and public.owns_job((storage.foldername(name))[1]));

-- Customers: open only files on their job that staff shared, plus their own request photos.
create policy "th customer read shared" on storage.objects for select to authenticated
  using (bucket_id = 'job-files' and (public.customer_can_read(name)
         or ((storage.foldername(name))[2] = 'customer' and public.owns_job((storage.foldername(name))[1]))));

-- Crew: upload into the folder for their job's current upload code, and see what's there.
create policy "th crew upload" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'job-files' and (storage.foldername(name))[1] = 'crew' and public.crew_token_active((storage.foldername(name))[2]));
create policy "th crew read own" on storage.objects for select to anon, authenticated
  using (bucket_id = 'job-files' and (storage.foldername(name))[1] = 'crew' and public.crew_token_active((storage.foldername(name))[2]));
-- Crew: their own proof of insurance, under insurance/<their contractor id>/ (the office reads it through "th staff all files").
drop policy if exists "th crew insurance upload" on storage.objects;
drop policy if exists "th crew insurance read" on storage.objects;
create policy "th crew insurance upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'job-files' and public.crew_owns_insurance_path(name));
create policy "th crew insurance read" on storage.objects for select to authenticated
  using (bucket_id = 'job-files' and public.crew_owns_insurance_path(name));
create policy "th crew read customer photos" on storage.objects for select to authenticated
  using (bucket_id = 'job-files' and public.crew_can_read_customer(name));
