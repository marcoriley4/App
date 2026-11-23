-- Update for the live database (run once in the SQL Editor): move the office's own settings
-- (goal, lead spend, message templates, building-department links, default markup) into a
-- table only the office can read. Customers and contractors can still read company details.
create table if not exists public.office_settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}' check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now()
);
alter table public.office_settings enable row level security;
drop policy if exists "office only" on public.office_settings;
create policy "office only" on public.office_settings for all to authenticated using (public.is_staff()) with check (public.is_staff());
revoke all on public.office_settings from anon;
grant select, insert, update on public.office_settings to authenticated;
revoke delete on public.office_settings from authenticated;
insert into public.office_settings (id, data)
  select 1, coalesce((select jsonb_object_agg(k, v) from jsonb_each(s.data) e(k, v)
    where k in ('goalMonthly', 'goalCount', 'goalRevenue', 'goalWhat', 'leadSpend', 'templates', 'permitPortals', 'defaultMarkup')), '{}'::jsonb)
  from public.settings s where s.id = 1
  on conflict (id) do update set data = public.office_settings.data || excluded.data;
update public.settings set data = data - array['goalMonthly', 'goalCount', 'goalRevenue', 'goalWhat', 'leadSpend', 'templates', 'permitPortals', 'defaultMarkup'] where id = 1;
select 'office settings moved' as done;
