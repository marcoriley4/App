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
drop table if exists public.job_files, public.job_events, public.job_private, public.jobs, public.contractors, public.profiles cascade;
drop function if exists public.handle_new_user, public.is_staff, public.new_crew_token, public.owns_job,
  public.customer_can_read, public.crew_token_active, public.create_job, public.add_customer_file, public.my_jobs,
  public.crew_job, public.crew_add_file, public.jobs_after_insert, public.jobs_before_update, public.jobs_after_update,
  public.private_after_update, public.files_after_change, public.status_label, public.log_event, public.usd cascade;

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
  select case s when 'new' then 'New lead' when 'qualifying' then 'Qualifying' when 'scheduled' then 'Scheduled'
    when 'in_progress' then 'In progress' when 'completed' then 'Completed' when 'lost' then 'Not a fit' else s end;
$$;

-- ---------- people ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'buyer' check (role in ('buyer', 'staff')),
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
  created_at timestamptz not null default now()
);

-- ---------- jobs ----------
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity (start with 1001) unique,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  trade text not null,
  description text not null,
  address text not null,
  zip text not null default '',
  timeframe text not null default '',
  budget text not null default '',
  status text not null default 'new' check (status in ('new', 'qualifying', 'scheduled', 'in_progress', 'completed', 'lost')),
  contractor_id uuid references public.contractors(id) on delete set null,
  scheduled_for timestamp,
  created_at timestamptz not null default now()
);
create index on public.jobs (buyer_id);
create index on public.jobs (status);

-- Staff-only: money, notes, and the crew upload code.
create table public.job_private (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  price numeric(12, 2) check (price >= 0),
  crew_pay numeric(12, 2) check (crew_pay >= 0),
  notes text not null default '',
  crew_token text unique
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
  source text not null default 'staff' check (source in ('staff', 'customer', 'crew')),
  by_name text not null default '',
  contractor_id uuid references public.contractors(id) on delete set null,
  uploaded_at timestamptz not null default now()
);
create index on public.job_files (job_id);

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
  perform public.log_event(new.id, 'Lead received');
  return new;
end $$;
create trigger jobs_after_insert after insert on public.jobs
  for each row execute function public.jobs_after_insert();

create function public.jobs_after_update() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cname text;
begin
  if new.status is distinct from old.status then
    perform public.log_event(new.id, 'Status → ' || public.status_label(new.status));
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
  if new.crew_pay is distinct from old.crew_pay then
    perform public.log_event(new.job_id, 'Crew pay → ' || public.usd(new.crew_pay));
  end if;
  return new;
end $$;
create trigger private_after_update after update on public.job_private
  for each row execute function public.private_after_update();

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

create policy "own profile or staff" on public.profiles for select to authenticated using (id = auth.uid() or public.is_staff());
create policy "update own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "staff only" on public.contractors for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "staff only" on public.jobs for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "staff only" on public.job_private for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "staff only" on public.job_events for select to authenticated using (public.is_staff());
create policy "staff only" on public.job_files for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Belt and braces: the public (not logged in) role can't touch tables at all,
-- and logged-in users can only edit their own name and phone, never their role.
revoke all on public.profiles, public.contractors, public.jobs, public.job_private, public.job_events, public.job_files from anon;
revoke update on public.profiles from authenticated;
grant update (name, phone) on public.profiles to authenticated;
revoke insert, delete on public.profiles from authenticated;
revoke insert, update, delete on public.job_events from authenticated;

-- ---------- what customers can do ----------
create function public.owns_job(j text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.jobs where id::text = j and buyer_id = auth.uid());
$$;

create function public.create_job(p_trade text, p_description text, p_address text, p_zip text, p_timeframe text, p_budget text)
returns table (id uuid, number bigint)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Please create an account first.'; end if;
  if length(trim(coalesce(p_description, ''))) < 10 then raise exception 'Please describe the job in a sentence or two.'; end if;
  if length(trim(coalesce(p_address, ''))) = 0 then raise exception 'Please enter the address where the work is.'; end if;
  return query
    insert into public.jobs as j (buyer_id, trade, description, address, zip, timeframe, budget)
    values (auth.uid(), left(p_trade, 40), left(trim(p_description), 4000), left(trim(p_address), 300),
            left(trim(coalesce(p_zip, '')), 10), left(coalesce(p_timeframe, ''), 40), left(coalesce(p_budget, ''), 40))
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
    'description', j.description, 'address', j.address, 'timeframe', j.timeframe, 'budget', j.budget,
    'scheduled_for', j.scheduled_for,
    'contractor_name', case when j.status in ('scheduled', 'in_progress', 'completed') then c.name end,
    'shared_files', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'kind', f.kind, 'size', f.size,
                       'path', f.path, 'uploaded_at', f.uploaded_at) order by f.uploaded_at), '[]'::jsonb)
                     from public.job_files f where f.job_id = j.id and f.shared)
  ) order by j.created_at desc), '[]'::jsonb)
  from public.jobs j left join public.contractors c on c.id = j.contractor_id
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
    'number', j.number, 'trade', j.trade, 'status', j.status, 'address', j.address, 'zip', j.zip,
    'description', j.description, 'scheduled_for', j.scheduled_for,
    'customer_name', b.name, 'customer_phone', b.phone, 'crew_name', c.name,
    'uploads', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'mime', f.mime, 'stage', f.stage,
                  'note', f.note, 'path', f.path, 'uploaded_at', f.uploaded_at) order by f.uploaded_at), '[]'::jsonb)
                from public.job_files f where f.job_id = j.id and f.source = 'crew' and f.contractor_id is not distinct from j.contractor_id))
  from public.job_private p
  join public.jobs j on j.id = p.job_id
  join public.profiles b on b.id = j.buyer_id
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

-- ---------- function permissions ----------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.is_staff(), public.owns_job(text), public.customer_can_read(text),
  public.create_job(text, text, text, text, text, text), public.add_customer_file(uuid, text, text, text, bigint),
  public.my_jobs() to authenticated;
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
