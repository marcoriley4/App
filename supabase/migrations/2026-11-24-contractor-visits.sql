-- Update for the live database (run once in the SQL Editor): a contractor can do the walkthrough visit
-- instead of a sales rep. They see the visit in their contractor login (time, address, customer, photos; never prices).
alter table public.jobs add column if not exists visit_contractor_id uuid references public.contractors(id) on delete set null;

create or replace function public.crew_my_visits() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare cid uuid := public.my_crew();
begin
  if cid is null then raise exception 'Your crew login is turned off. Ask the Top Hat office if this is a mistake.'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', j.id, 'number', j.number, 'trade', j.trade, 'visit_at', j.visit_at,
      'address', j.address, 'zip', j.zip, 'state', j.state, 'description', j.description, 'style', j.style,
      'customer_name', coalesce(b.name, j.contact_name), 'customer_phone', coalesce(b.phone, j.contact_phone),
      'customer_photos', (select coalesce(jsonb_agg(f.path order by f.uploaded_at), '[]'::jsonb) from public.job_files f
                           where f.job_id = j.id and f.source = 'customer' and f.mime like 'image/%')
    ) order by j.visit_at), '[]'::jsonb)
    from public.jobs j left join public.profiles b on b.id = j.buyer_id
    where j.visit_contractor_id = cid and j.visit_at is not null and j.status in ('new', 'qualifying', 'hot'));
end $$;
create or replace function public.crew_can_read_customer(p text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.job_files f join public.jobs j on j.id = f.job_id
                 where f.path = p and f.source in ('customer', 'design') and public.my_crew() is not null
                   and ((j.contractor_id = public.my_crew() and j.status in ('scheduled', 'in_progress', 'completed'))
                     or (j.visit_contractor_id = public.my_crew() and f.source = 'customer' and j.status in ('new', 'qualifying', 'hot'))));
$$;
create or replace function public.jobs_after_update() returns trigger
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
  if new.visit_contractor_id is distinct from old.visit_contractor_id then
    perform public.log_event(new.id, '🤝 Walkthrough by ' || coalesce((select name from public.contractors where id = new.visit_contractor_id) || ' (contractor)', 'the sales rep'));
  end if;
  if new.visit_at is distinct from old.visit_at then
    perform public.log_event(new.id, case when new.visit_at is null then '🤝 Rep visit cleared'
      else '🤝 Rep visit booked for ' || to_char(new.visit_at, 'Mon FMDD, YYYY FMHH12:MI AM') end);
  end if;
  return new;
end $$;
revoke execute on function public.crew_my_visits() from public, anon;
grant execute on function public.crew_my_visits() to authenticated;
select 'contractor visits added' as done;
