-- Update for the live database (run once in the SQL Editor): contractors can have a photo,
-- and customers see it next to "Project manager" on their job.
alter table public.contractors drop constraint if exists contractors_profile_check;
alter table public.contractors add constraint contractors_profile_check check (jsonb_typeof(profile) = 'object' and length(profile::text) <= 100000);

create or replace function public.crew_set_profile(p jsonb) returns void
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
    -- Their photo (a small JPEG the app makes), shown to customers next to "Project manager".
    'photo', case when coalesce(p->>'photo', '') ~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$' and length(p->>'photo') <= 80000 then p->>'photo' else '' end,
    'days_off', coalesce((select jsonb_agg(distinct v::int) from jsonb_array_elements_text(case when jsonb_typeof(p->'days_off') = 'array' then p->'days_off' else '[]'::jsonb end) v where v ~ '^[0-6]$'), '[]'::jsonb),
    'blocked', coalesce((select jsonb_agg(distinct v) from (select v from jsonb_array_elements_text(case when jsonb_typeof(p->'blocked') = 'array' then p->'blocked' else '[]'::jsonb end) v
      where v ~ '^\d{4}-\d{2}-\d{2}$' and v >= to_char(current_date, 'YYYY-MM-DD') limit 120) x), '[]'::jsonb));
  update public.contractors set profile = clean where id = cid;
end $$;
create or replace function public.my_jobs() returns jsonb
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
    'contractor_photo', case when j.status <> 'lost' then nullif(c.profile->>'photo', '') end,
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
select 'contractor photos added' as done;
