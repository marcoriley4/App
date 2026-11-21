\set ON_ERROR_STOP on
\c tophat_test
-- ids
\set S '11111111-1111-1111-1111-111111111111'
\set A '22222222-2222-2222-2222-222222222222'
\set B '33333333-3333-3333-3333-333333333333'

insert into auth.users (id, email, raw_user_meta_data) values
  (:'S', 'office@tophat.test', '{"name":"Office"}'),
  (:'A', 'ann@example.com', '{"name":"Ann Buyer","phone":"(555) 111-2222","role":"staff"}'),
  (:'B', 'bob@example.com', '{"name":"Bob Buyer","phone":"(555) 333-4444"}');
update public.profiles set role = 'staff' where id = :'S';
select t.ok((select role from public.profiles where id = :'A') = 'buyer', 'sign-up cannot make itself staff via metadata');

-- ========== Customer A ==========
select set_config('request.jwt.claim.sub', :'A', false);
set role authenticated;
do $$ begin
  begin perform public.create_job('plumbing', 'Leaky faucet in the kitchen', '1 Main St', '62701', '', 'asap', 'u1k', ''); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'a request needs a state'); end;
end $$;
create temp table ids as select * from public.create_job('plumbing', 'Leaky faucet in the kitchen', '1 Main St', '62701', 'il', 'asap', 'u1k', 'kitchen/modern');
select t.ok((public.my_jobs()->0->>'state') = 'IL', 'customer job keeps its state');
select t.ok((public.my_jobs()->0->>'style') = 'kitchen/modern', 'customer job keeps the style they picked');
select t.ok((select number from ids) = 1001, 'first job number is 1001');
select t.ok((select count(*) from public.jobs) = 0, 'customer cannot read jobs table directly');
select t.ok((select count(*) from public.job_private) = 0, 'customer cannot read prices/notes');
select t.ok((select count(*) from public.job_events) = 0, 'customer cannot read activity');
select t.ok((select count(*) from public.office_records) = 0, 'customer cannot read office records');
do $$ begin
  begin insert into public.office_records (kind, data) values ('vendor', '{"name":"x"}'); perform t.ok(false, 'x');
  exception when insufficient_privilege or check_violation then perform t.ok(true, 'customer cannot add office records'); end;
end $$;
select t.ok((select count(*) from public.contractors) = 0, 'customer cannot read crew list');
select t.ok(jsonb_array_length(public.my_jobs()) = 1, 'customer sees own job via my_jobs');
do $$ begin
  begin update public.profiles set role = 'staff' where id = auth.uid(); perform t.ok(false, 'role change blocked');
  exception when insufficient_privilege then perform t.ok(true, 'customer cannot change own role'); end;
  begin insert into public.jobs (buyer_id, trade, description, address) values (auth.uid(), 'x', 'xxxxxxxxxxxx', 'y'); perform t.ok(false, 'direct job insert blocked');
  exception when insufficient_privilege then perform t.ok(true, 'customer cannot insert jobs directly'); end;
  begin perform public.log_event(gen_random_uuid(), 'x'); perform t.ok(false, 'log_event blocked');
  exception when insufficient_privilege then perform t.ok(true, 'customer cannot call internal functions'); end;
end $$;
update public.profiles set name = 'Ann B.' where id = :'A';
select t.ok((select name from public.profiles where id = :'A') = 'Ann B.', 'customer can edit own name');
-- request photo upload into own job folder
insert into storage.objects (bucket_id, name) select 'job-files', id || '/customer/p1.jpg' from ids;
select public.add_customer_file(id, id || '/customer/p1.jpg', 'p1.jpg', 'image/jpeg', 1000) from ids;
do $$ begin
  begin insert into storage.objects (bucket_id, name) select 'job-files', id || '/staff/x.pdf' from ids; perform t.ok(false, 'staff folder upload blocked');
  exception when insufficient_privilege then perform t.ok(true, 'customer cannot upload into staff folder'); end;
end $$;
reset role;

-- ========== Customer B (someone else) ==========
select set_config('request.jwt.claim.sub', :'B', false);
set role authenticated;
select t.ok(jsonb_array_length(public.my_jobs()) = 0, 'other customer sees none of A''s jobs');
select t.ok((select count(*) from storage.objects) = 0, 'other customer cannot see A''s files');
do $$ begin
  begin insert into storage.objects (bucket_id, name) select 'job-files', (select id from public.jobs limit 1)::text || '/customer/evil.jpg'; perform t.ok(false, 'x');
  exception when insufficient_privilege then perform t.ok(true, 'other customer cannot upload into A''s job'); end;
end $$;
reset role;

-- ========== Staff ==========
select set_config('request.jwt.claim.sub', :'S', false);
set role authenticated;
select t.ok((select count(*) from public.jobs) = 1, 'staff sees all jobs');
insert into public.contractors (name, phone, trades) values ('Mike Alvarez', '(555) 300-1122', '{plumbing}'), ('Ray Johnson', '(555) 300-4455', '{roofing}');
update public.jobs set status = 'qualifying';
update public.jobs set contractor_id = (select id from public.contractors where name = 'Mike Alvarez'), status = 'scheduled', scheduled_for = '2026-11-16T09:30';
update public.job_private set price = 1800, notes = 'Gate code 1234';
update public.job_costs set crew_pay = 1150.50;
select t.ok((select crew_token from public.job_private) is not null, 'assigning crew creates upload code');
select t.ok((select count(*) from public.job_events) >= 6, 'activity history written automatically');
select t.ok(exists (select 1 from public.job_events where text = 'Crew pay → $1,150.50'), 'money formatted in history');
select t.ok(exists (select 1 from public.job_events where text = 'Scheduled for Nov 16, 2026 9:30 AM'), 'schedule formatted in history');
insert into storage.objects (bucket_id, name) select 'job-files', id || '/staff/estimate.pdf' from public.jobs;
insert into public.job_files (job_id, path, name, kind, source, by_name) select id, id || '/staff/estimate.pdf', 'estimate.pdf', 'estimate', 'staff', 'Office' from public.jobs;
insert into storage.objects (bucket_id, name) select 'job-files', id || '/staff/margin.xlsx' from public.jobs;
insert into public.job_files (job_id, path, name, kind, source, by_name) select id, id || '/staff/margin.xlsx', 'margin.xlsx', 'other', 'staff', 'Office' from public.jobs;
update public.job_files set shared = true where name = 'estimate.pdf';
select set_config('t.token', (select crew_token from public.job_private), false);
select set_config('t.job', (select id::text from public.jobs), false);
reset role;

-- ========== Customer A again ==========
select set_config('request.jwt.claim.sub', :'A', false);
set role authenticated;
select t.ok((public.my_jobs()->0->>'contractor_name') = 'Mike Alvarez', 'customer sees crew name once scheduled');
select t.ok(public.my_jobs()::text !~ '1800|1150|Gate code|crew_token|price|crew_pay', 'customer data has no prices, notes or crew code');
select t.ok(jsonb_array_length(public.my_jobs()->0->'shared_files') = 1, 'customer sees only the shared file');
select t.ok((select count(*) from storage.objects where name like '%estimate.pdf') = 1, 'customer can open shared estimate');
select t.ok((select count(*) from storage.objects where name like '%margin.xlsx') = 0, 'customer cannot open unshared file');
select t.ok((select count(*) from storage.objects where name like '%/customer/p1.jpg') = 1, 'customer can open own request photo');
reset role;

-- ========== Crew (not logged in) ==========
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select t.ok(public.crew_job(current_setting('t.token')) is not null, 'crew link opens job');
select t.ok(public.crew_job(current_setting('t.token'))::text !~ '1800|1150|Gate code|price|crew_pay|ann@example', 'crew sees no prices, office notes or customer email');
select t.ok(public.crew_job('nope') is null, 'bad crew code shows nothing');
select t.ok(public.crew_job(left(current_setting('t.token'), 20)) is null, 'partial crew code shows nothing');
select t.ok((select count(*) from storage.objects) = 0, 'crew cannot see office or customer files');
insert into storage.objects (bucket_id, name) values ('job-files', 'crew/' || current_setting('t.token') || '/before1.jpg');
select public.crew_add_file(current_setting('t.token'), 'crew/' || current_setting('t.token') || '/before1.jpg', 'before1.jpg', 'image/jpeg', 2000, 'before', 'North side');
select t.ok(jsonb_array_length(public.crew_job(current_setting('t.token'))->'uploads') = 1, 'crew sees own upload');
select t.ok((select count(*) from storage.objects) = 1, 'crew can open only their folder');
do $$ begin
  begin perform * from public.jobs; perform t.ok(false, 'x');
  exception when insufficient_privilege then perform t.ok(true, 'crew cannot read jobs table'); end;
  begin perform * from public.job_private; perform t.ok(false, 'x');
  exception when insufficient_privilege then perform t.ok(true, 'crew cannot read prices table'); end;
  begin perform public.crew_add_file(current_setting('t.token'), current_setting('t.job') || '/staff/evil.pdf', 'evil.pdf', 'application/pdf', 1, '', ''); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'crew cannot file into office folder'); end;
  begin insert into storage.objects (bucket_id, name) values ('job-files', current_setting('t.job') || '/staff/evil.pdf'); perform t.ok(false, 'x');
  exception when insufficient_privilege then perform t.ok(true, 'crew cannot upload into office folder'); end;
  begin perform public.create_job('x', 'xxxxxxxxxxxxx', 'y', '', 'IL', '', '', ''); perform t.ok(false, 'x');
  exception when insufficient_privilege then perform t.ok(true, 'not-logged-in cannot create jobs'); end;
end $$;
reset role;

-- ========== Staff reassigns: old crew link dies ==========
select set_config('request.jwt.claim.sub', :'S', false);
set role authenticated;
select t.ok((select count(*) from public.job_files where source = 'crew' and stage = 'before' and by_name = 'Mike Alvarez') = 1, 'staff sees crew upload labeled');
update public.jobs set contractor_id = (select id from public.contractors where name = 'Ray Johnson');
select t.ok((select crew_token from public.job_private) <> current_setting('t.token'), 'reassign makes a new upload code');
select set_config('t.token2', (select crew_token from public.job_private), false);
reset role;

select set_config('request.jwt.claim.sub', '', false);
set role anon;
select t.ok(public.crew_job(current_setting('t.token')) is null, 'old crew link stops working');
do $$ begin
  begin insert into storage.objects (bucket_id, name) values ('job-files', 'crew/' || current_setting('t.token') || '/late.jpg'); perform t.ok(false, 'x');
  exception when insufficient_privilege then perform t.ok(true, 'old crew link cannot upload'); end;
end $$;
select t.ok(jsonb_array_length(public.crew_job(current_setting('t.token2'))->'uploads') = 0, 'new crew does not see previous crew uploads');
reset role;

-- ========== Estimates & invoices ==========
select set_config('request.jwt.claim.sub', :'S', false);
set role authenticated;
insert into public.documents (job_id, type, items, tax_rate)
  values (current_setting('t.job')::uuid, 'estimate', '[{"desc":"Labor","qty":1,"price":300},{"desc":"Parts","qty":2,"price":45.5}]', 8);
select set_config('t.est', (select id::text from public.documents where type = 'estimate'), false);
select t.ok((select number from public.documents where id = current_setting('t.est')::uuid) = 'E-1001', 'estimate numbered from job number');
reset role;
select t.ok(public.doc_total((select items from public.documents where id = current_setting('t.est')::uuid), 8) = 422.28, 'estimate total with tax is right');

select set_config('request.jwt.claim.sub', :'A', false);
set role authenticated;
select t.ok(public.my_documents() = '{}'::jsonb, 'customer cannot see draft estimates');
select t.ok((select count(*) from public.documents) = 0, 'customer cannot read documents table');
select t.ok((select data->>'name' from public.settings) = 'Top Hat Contracting', 'customer can read company details');
update public.settings set data = '{}';
reset role;
select t.ok((select data->>'name' from public.settings) = 'Top Hat Contracting', 'customer cannot change company details');

select set_config('request.jwt.claim.sub', :'S', false);
set role authenticated;
update public.documents set status = 'sent' where id = current_setting('t.est')::uuid;
select t.ok((select sent_at is not null from public.documents where id = current_setting('t.est')::uuid), 'sending stamps the date');
reset role;

select set_config('request.jwt.claim.sub', :'A', false);
set role authenticated;
select t.ok(jsonb_array_length(public.my_documents() -> current_setting('t.job')) = 1, 'customer sees sent estimate');
select t.ok(public.my_documents()::text !~ '1150|crew_pay|Gate code', 'customer documents have no crew pay or notes');
update public.documents set status = 'approved';
select t.ok((public.my_documents() -> current_setting('t.job') -> 0 ->> 'status') = 'sent', 'customer cannot change status directly');
reset role;

select set_config('request.jwt.claim.sub', :'B', false);
set role authenticated;
do $$ begin
  begin perform public.respond_estimate(current_setting('t.est')::uuid, true); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'other customer cannot approve someone else''s estimate'); end;
end $$;
select t.ok(public.my_documents() = '{}'::jsonb, 'other customer sees no documents');
reset role;

select set_config('request.jwt.claim.sub', :'A', false);
set role authenticated;
select public.respond_estimate(current_setting('t.est')::uuid, true);
select t.ok((public.my_documents() -> current_setting('t.job') -> 0 ->> 'status') = 'approved', 'customer approves own estimate');
do $$ begin
  begin perform public.respond_estimate(current_setting('t.est')::uuid, false); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'approved estimate cannot be changed again'); end;
end $$;
reset role;

select set_config('request.jwt.claim.sub', :'S', false);
set role authenticated;
select t.ok((select price from public.job_private) = 422.28, 'approval sets the customer price');
select t.ok((select crew_pay from public.job_costs) = 1150.50, 'approval leaves crew pay alone');
select t.ok(exists (select 1 from public.job_events where text like 'E-1001 approved by Ann B. (customer)'), 'approval logged with who');
select t.ok((select status from public.jobs where id = current_setting('t.job')::uuid) = 'scheduled', 'approval never moves a scheduled job backwards');
do $$ begin
  begin update public.documents set items = '[]' where id = current_setting('t.est')::uuid; perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'approved estimate is locked'); end;
  begin insert into public.documents (job_id, type, items) values (current_setting('t.job')::uuid, 'estimate', '[{"desc":"x","qty":1,"price":-5}]'); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'negative prices refused'); end;
end $$;
insert into public.documents (job_id, type, items, tax_rate, from_estimate, due_date)
  select job_id, 'invoice', items, tax_rate, id, current_date + 14 from public.documents where id = current_setting('t.est')::uuid;
select set_config('t.inv', (select id::text from public.documents where type = 'invoice'), false);
select t.ok((select number from public.documents where type = 'invoice') = 'INV-1001', 'invoice numbered');
do $$ begin
  begin update public.documents set payments = '[{"amount":10,"method":"Cash"}]' where id = current_setting('t.inv')::uuid; perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'no payments on an unsent invoice'); end;
end $$;
update public.documents set status = 'sent' where id = current_setting('t.inv')::uuid;
update public.documents set payments = payments || '[{"id":"p1","amount":200,"method":"Zelle","date":"2026-11-13"}]' where id = current_setting('t.inv')::uuid;
update public.documents set payments = payments || '[{"id":"p2","amount":222.28,"method":"Check","date":"2026-11-13","note":"check #1042"}]' where id = current_setting('t.inv')::uuid;
select t.ok(exists (select 1 from public.job_events where text = 'Payment $222.28 (Check) on INV-1001'), 'payment logged');
select t.ok(exists (select 1 from public.job_events where text = 'INV-1001 paid in full'), 'paid in full logged');
do $$ begin
  begin delete from public.documents where id = current_setting('t.inv')::uuid; perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'sent invoice cannot be deleted'); end;
  begin update public.documents set status = 'draft' where id = current_setting('t.inv')::uuid; perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'sent invoice cannot go back to draft'); end;
end $$;
insert into public.documents (job_id, type) values (current_setting('t.job')::uuid, 'estimate');
select t.ok(exists (select 1 from public.documents where number = 'E-1001-2'), 'second estimate gets -2');
delete from public.documents where number = 'E-1001-2';
select t.ok(not exists (select 1 from public.documents where number = 'E-1001-2'), 'draft can be deleted');
reset role;

select set_config('request.jwt.claim.sub', :'A', false);
set role authenticated;
select t.ok((public.my_documents() -> current_setting('t.job'))::text ~ 'INV-1001' and (public.my_documents() -> current_setting('t.job'))::text ~ 'check #1042', 'customer sees invoice and payments');
reset role;

select set_config('request.jwt.claim.sub', '', false);
set role anon;
do $$ begin
  begin perform * from public.documents; perform t.ok(false, 'x');
  exception when insufficient_privilege then perform t.ok(true, 'crew cannot read estimates or invoices'); end;
  begin perform * from public.settings; perform t.ok(false, 'x');
  exception when insufficient_privilege then perform t.ok(true, 'not-logged-in cannot read settings'); end;
  begin perform public.my_documents(); perform t.ok(false, 'x');
  exception when insufficient_privilege then perform t.ok(true, 'not-logged-in cannot list documents'); end;
end $$;
select t.ok(public.crew_job(current_setting('t.token2'))::text !~ 'E-1001|INV-1001|422', 'crew link shows no documents or totals');
reset role;

-- ========== Crew logins ==========
\set C '44444444-4444-4444-4444-444444444444'
\set D '55555555-5555-5555-5555-555555555555'
insert into auth.users (id, email, raw_user_meta_data) values (:'C', 'ray@crew.test', '{"name":"Ray J"}'), (:'D', 'dave@crew.test', '{}');

select set_config('request.jwt.claim.sub', :'A', false);
set role authenticated;
do $$ begin
  begin perform public.staff_invite_crew((select id from public.contractors limit 1)); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'customer cannot create crew invites'); end;
end $$;
reset role;

select set_config('request.jwt.claim.sub', :'S', false);
set role authenticated;
select set_config('t.invite', public.staff_invite_crew((select id from public.contractors where name = 'Ray Johnson')), false);
select t.ok(length(current_setting('t.invite')) >= 32, 'office makes a long invite code');
reset role;

select set_config('request.jwt.claim.sub', '', false);
set role anon;
select t.ok((public.crew_invite_info(current_setting('t.invite'))->>'name') = 'Ray Johnson', 'invite link shows who it is for');
select t.ok(public.crew_invite_info(left(current_setting('t.invite'), 20)) is null, 'partial invite code shows nothing');
do $$ begin
  begin perform public.crew_my_jobs(); perform t.ok(false, 'x');
  exception when insufficient_privilege then perform t.ok(true, 'not-logged-in cannot list crew jobs'); end;
end $$;
reset role;

select set_config('request.jwt.claim.sub', :'A', false);
set role authenticated;
do $$ begin
  begin perform public.claim_crew_invite(current_setting('t.invite')); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'existing customer account cannot become crew'); end;
  begin perform public.crew_my_jobs(); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'customer cannot list crew jobs'); end;
end $$;
reset role;

select set_config('request.jwt.claim.sub', :'C', false);
set role authenticated;
select public.claim_crew_invite(current_setting('t.invite'));
select t.ok((select role from public.profiles where id = :'C') = 'crew', 'invite turns new login into crew');
select t.ok(jsonb_array_length(public.crew_my_jobs()) = 1, 'crew sees their assigned job');
select t.ok(public.crew_my_jobs()::text ~ '1150.5', 'crew sees their own pay');
select t.ok((public.crew_my_jobs()->0->>'crew_paid_date') is null, 'not paid yet shows as not paid');
update public.job_costs set crew_paid_date = current_date;
select t.ok((public.crew_my_jobs()->0->>'crew_paid_date') is null, 'crew cannot mark themselves paid');
reset role;
select set_config('request.jwt.claim.sub', :'S', false);
set role authenticated;
update public.job_costs set crew_paid_date = '2026-11-10', crew_paid_method = 'Zelle' where job_id = current_setting('t.job')::uuid;
select t.ok(exists (select 1 from public.job_events where text like '💸 Crew paid $1,150.50 (Zelle) on Nov 10, 2026'), 'crew payout logged');
reset role;
select set_config('request.jwt.claim.sub', :'C', false);
set role authenticated;
select t.ok((public.crew_my_jobs()->0->>'crew_paid_date') = '2026-11-10', 'crew sees the day they were paid');
-- Crew bills: billing for a step and for extras
reset role;
select set_config('request.jwt.claim.sub', :'S', false);
set role authenticated;
update public.job_costs set crew_paid_date = null, crew_paid_method = '' where job_id = current_setting('t.job')::uuid;
update public.jobs set status = 'in_progress' where id = current_setting('t.job')::uuid;
reset role;
-- A photo the crew just uploaded for the job (bills need at least one).
create function t.pic() returns text language plpgsql security definer as $$
declare tok text := (select crew_token from public.job_private where job_id = current_setting('t.job')::uuid); p text;
begin p := 'crew/' || tok || '/' || gen_random_uuid() || '.jpg';
  perform public.crew_add_file(tok, p, 'work.jpg', 'image/jpeg', 1000, '', ''); return p; end $$;
grant execute on function t.pic() to authenticated;
-- Their invoice to Top Hat (a PDF the crew just uploaded for the job; every bill needs one).
create function t.inv() returns text language plpgsql security definer as $$
declare tok text := (select crew_token from public.job_private where job_id = current_setting('t.job')::uuid); p text;
begin p := 'crew/' || tok || '/' || gen_random_uuid() || '-invoice.pdf';
  perform public.crew_add_file(tok, p, 'invoice.pdf', 'application/pdf', 1000, '', 'Contractor invoice'); return p; end $$;
grant execute on function t.inv() to authenticated;
select set_config('request.jwt.claim.sub', :'C', false);
set role authenticated;
-- Proof of insurance: needed before any bill, only their own folder, not run out.
do $$ begin
  begin perform public.crew_bill(current_setting('t.job')::uuid, 0, null, '', array[t.pic()], t.inv()); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'crew cannot bill before uploading proof of insurance'); end;
  begin perform public.crew_set_insurance('insurance/' || gen_random_uuid() || '/x.pdf', 'x.pdf', current_date + 30); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'crew cannot save insurance under another contractor''s folder'); end;
  begin perform public.crew_set_insurance('crew/x/x.pdf', 'x.pdf', current_date + 30); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'insurance must live in the insurance folder'); end;
  begin perform public.crew_set_insurance('insurance/' || (public.crew_my_insurance()->>'contractor') || '/old.pdf', 'old.pdf', current_date - 1); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'insurance that already ran out is refused'); end;
end $$;
select public.crew_set_insurance('insurance/' || (public.crew_my_insurance()->>'contractor') || '/ins.pdf', 'ins.pdf', current_date + 365);
select t.ok((public.crew_my_insurance()->>'name') = 'ins.pdf', 'crew saves their proof of insurance');
do $$ begin
  begin perform public.crew_bill(current_setting('t.job')::uuid, 0, null, '', array[t.pic()], ''); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'crew bill needs their invoice'); end;
  begin perform public.crew_bill(current_setting('t.job')::uuid, 0, null, '', array[t.pic()], 'crew/x/never-uploaded.pdf'); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'crew bill cannot point at an invoice that was never uploaded'); end;
end $$;
do $$ begin
  begin perform public.crew_bill(current_setting('t.job')::uuid, 2, null, '', array[t.pic()], t.inv()); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'crew cannot bill the finish step before finishing'); end;
end $$;
do $$ begin
  begin perform public.crew_bill(current_setting('t.job')::uuid, 0, null, '', array[]::text[], t.inv()); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'crew bill needs at least one photo'); end;
  begin perform public.crew_bill(current_setting('t.job')::uuid, 0, null, '', null, t.inv()); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'crew bill with no photo list is refused'); end;
  begin perform public.crew_bill(current_setting('t.job')::uuid, 0, null, '', array['crew/x/not-uploaded.jpg'], t.inv()); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'crew bill cannot point at a photo that was never uploaded'); end;
end $$;
select t.ok((public.crew_bill(current_setting('t.job')::uuid, 0, 99999, 'Started', array[t.pic()], t.inv())->>'amount')::numeric = 345.15, 'crew bill amount comes from the schedule, not what they type');
select t.ok((public.crew_my_jobs()->0->'bills'->0->>'photos')::int = 1, 'crew sees how many photos went with a bill');
reset role;
select t.ok((select count(*) from public.job_files where kind = 'invoice' and bill_id is not null and source = 'crew') = 1, 'the bill claims their invoice as an invoice file');
select set_config('request.jwt.claim.sub', :'C', false);
set role authenticated;
do $$ begin
  begin perform public.crew_bill(current_setting('t.job')::uuid, 0, null, '', array[t.pic()], t.inv()); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'crew cannot bill the same step twice'); end;
  begin perform public.crew_bill(current_setting('t.job')::uuid, null, 0, 'x', array[t.pic()], t.inv()); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'extra bill needs an amount'); end;
end $$;
do $$ begin
  begin perform public.crew_bill(current_setting('t.job')::uuid, 1, null, '', array[t.pic()], t.inv()); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'halfway bill locked until they tap halfway done'); end;
end $$;
select public.crew_halfway(current_setting('t.job')::uuid);
select t.ok((public.crew_my_jobs()->0->>'halfway_at') is not null, 'crew marks halfway done');
do $$ begin
  begin perform public.crew_bill(current_setting('t.job')::uuid, 1, null, '', array[t.pic()], t.inv()); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'halfway bill locked until the first bill is approved'); end;
end $$;
select public.crew_bill(current_setting('t.job')::uuid, null, 120, 'Two extra bundles of shingles', array[t.pic()], t.inv());
select t.ok(jsonb_array_length(public.crew_my_jobs()->0->'bills') = 2, 'crew sees their bills');
select t.ok((select count(*) from public.crew_bills) = 0, 'crew cannot read the bills table directly');
do $$ begin
  begin perform public.staff_crew_bill((select (public.crew_my_jobs()->0->'bills'->0->>'id')::uuid), 'paid', '', current_date, 'Zelle'); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'crew cannot mark their own bill paid'); end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', :'S', false);
set role authenticated;
select t.ok((select count(*) from public.crew_bills where status = 'submitted') = 2, 'office sees new crew bills');
select t.ok((select count(*) from public.job_files f join public.crew_bills b on b.id = f.bill_id where b.status = 'submitted' and f.kind <> 'invoice') = 2, 'office sees the photos sent with each bill');
select t.ok((select count(*) from public.job_files f join public.crew_bills b on b.id = f.bill_id where b.status = 'submitted' and f.kind = 'invoice') = 2, 'office sees the contractor''s invoice with each bill');
select t.ok((select insurance_name from public.contractors where insurance_path is not null limit 1) = 'ins.pdf', 'office sees the contractor''s proof of insurance');
select public.staff_crew_bill((select id from public.crew_bills where step = 0), 'approve', '', null, '');
select public.staff_crew_bill((select id from public.crew_bills where step = 0), 'paid', '', '2026-11-12', 'Zelle');
select t.ok((select status from public.crew_bills where step = 0) = 'paid', 'office approves and pays a crew bill');
select t.ok((select crew_paid_date from public.job_costs where job_id = current_setting('t.job')::uuid) is null, 'part-paid job is not marked fully paid');
select public.staff_crew_bill((select id from public.crew_bills where step is null), 'decline', 'Not approved ahead of time', null, '');
select t.ok(exists (select 1 from public.job_events where text like '🧾 Declined Ray Johnson’s bill%'), 'declined bill logged');
reset role;
select set_config('request.jwt.claim.sub', :'C', false);
set role authenticated;
select t.ok((select x->>'reason' from jsonb_array_elements(public.crew_my_jobs()->0->'bills') x where x->>'step' is null) = 'Not approved ahead of time', 'crew sees why a bill was declined');
select t.ok((public.crew_bill(current_setting('t.job')::uuid, 1, null, 'Halfway', array[t.pic()], t.inv())->>'amount')::numeric = 345.15, 'halfway bill opens once the first is paid');
do $$ begin
  begin perform public.crew_bill(current_setting('t.job')::uuid, 2, null, '', array[t.pic()], t.inv()); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'finish bill still locked while working'); end;
end $$;
-- Their own details, W-9 and lien waivers
select public.crew_set_profile('{"business":"Ray J Roofing LLC","license_number":"104.0188","license_state":"il","license_expires":"2027-03-01","days_off":[0,6,9,"x"],"blocked":["2099-01-02","1999-01-01","bad"],"role":"staff"}');
select t.ok((public.crew_my_profile()->'profile'->>'license_state') = 'IL' and (public.crew_my_profile()->'profile'->'days_off') = '[0, 6]'::jsonb
  and (public.crew_my_profile()->'profile'->'blocked') = '["2099-01-02"]'::jsonb and not (public.crew_my_profile()->'profile' ? 'role'), 'crew profile is cleaned (state, days off, future dates, no extra keys)');
do $$ begin
  begin perform public.crew_set_w9('insurance/' || gen_random_uuid() || '/w9.pdf', 'w9.pdf'); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'crew can only save a W-9 in their own folder'); end;
  begin perform public.crew_sign_lien((select (x->>'id')::uuid from jsonb_array_elements(public.crew_my_jobs()->0->'bills') x where x->>'step' = '1'), 'Ray Johnson', 'data:image/png;base64,AAAA'); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'no lien waiver before the bill is paid'); end;
end $$;
select public.crew_set_w9('insurance/' || (public.crew_my_profile()->>'contractor') || '/w9.pdf', 'w9.pdf');
select t.ok((public.crew_my_profile()->>'w9_name') = 'w9.pdf', 'crew saves their W-9');
select public.crew_sign_lien((select (x->>'id')::uuid from jsonb_array_elements(public.crew_my_jobs()->0->'bills') x where x->>'step' = '0'), 'Ray Johnson', 'data:image/png;base64,AAAA');
select t.ok((select x->>'lien' from jsonb_array_elements(public.crew_my_jobs()->0->'bills') x where x->>'step' = '0') = 'true', 'crew signs the lien waiver for a paid bill');
do $$ begin
  begin perform public.crew_sign_lien((select (x->>'id')::uuid from jsonb_array_elements(public.crew_my_jobs()->0->'bills') x where x->>'step' = '0'), 'Ray Johnson', 'data:image/png;base64,AAAA'); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'a lien waiver is signed once'); end;
end $$;
reset role;
-- Punch list: the office writes it, the assigned contractor sees and checks it off
select set_config('request.jwt.claim.sub', :'S', false);
set role authenticated;
insert into public.office_records (kind, job_id, data) values ('task', current_setting('t.job')::uuid, '{"text":"Touch up flashing","punch":true,"done":false}'),
  ('task', current_setting('t.job')::uuid, '{"text":"Office-only task","punch":false,"done":false}');
select t.ok(exists (select 1 from public.job_events where text like '📝 Lien waiver signed by Ray Johnson%'), 'office sees the lien waiver in the history');
reset role;
select set_config('request.jwt.claim.sub', :'C', false);
set role authenticated;
select t.ok(jsonb_array_length(public.crew_punch(current_setting('t.job')::uuid)) = 1, 'crew sees only the punch list, not office tasks');
select public.crew_punch_done((public.crew_punch(current_setting('t.job')::uuid)->0->>'id')::uuid, true);
select t.ok((public.crew_punch(current_setting('t.job')::uuid)->0->>'done') = 'true', 'crew checks off a punch item');
select t.ok((select count(*) from public.office_records) = 0, 'crew still cannot read office records directly');
do $$ begin
  begin perform public.crew_punch(gen_random_uuid()); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'crew cannot read punch lists of other jobs'); end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', :'S', false);
set role authenticated;
update public.jobs set status = 'scheduled' where id = current_setting('t.job')::uuid;
reset role;
select set_config('request.jwt.claim.sub', :'C', false);
set role authenticated;
select t.ok(public.crew_my_jobs()->0 ? 'uploads', 'crew gets a list of their own photos for their records');
select t.ok(public.crew_my_jobs()::text !~ '422.28|"price"|Gate code|ann@example|E-1001|INV-1001', 'crew never sees customer price, notes, email or documents');
select t.ok((select count(*) from public.jobs) = 0 and (select count(*) from public.job_private) = 0 and (select count(*) from public.documents) = 0 and (select count(*) from public.contractors) = 0,
  'crew cannot read any tables directly');
select public.crew_set_progress(current_setting('t.job')::uuid, null, 'on_the_way');
select t.ok((public.crew_my_jobs()->0->>'stage') = 'on_the_way', 'crew can mark on the way');
select public.crew_set_progress(current_setting('t.job')::uuid, 'in_progress', null);
select t.ok((public.crew_my_jobs()->0->>'stage') is null, 'starting work clears on the way');
select public.crew_set_progress(current_setting('t.job')::uuid, null, 'waiting_parts');
do $$ begin
  begin perform public.crew_set_progress(current_setting('t.job')::uuid, null, 'on_the_way'); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'on the way only allowed before work starts'); end;
end $$;
select public.crew_set_progress(current_setting('t.job')::uuid, null, null);
select public.crew_set_progress(current_setting('t.job')::uuid, 'completed', null);
select public.crew_set_progress(current_setting('t.job')::uuid, 'in_progress', null);
select t.ok((public.crew_my_jobs()->0->>'progress_by') = 'Ray J', 'crew can undo finished and is named on the update');
do $$ begin
  begin perform public.crew_set_progress(current_setting('t.job')::uuid, 'lost', null); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'crew can only mark started or finished'); end;
  begin perform public.crew_set_progress(gen_random_uuid(), 'completed', null); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'crew cannot update jobs that are not theirs'); end;
end $$;
reset role;
select t.ok((select status from public.jobs where id = current_setting('t.job')::uuid) = 'in_progress', 'crew marked job started');
select t.ok(exists (select 1 from public.job_events where text = 'Waiting on materials (by Ray J, crew)'), 'crew progress logged with name');
select t.ok(exists (select 1 from public.job_events where text = 'Status → Completed (by Ray J, crew)'), 'crew status change logged with name');
select set_config('request.jwt.claim.sub', :'A', false);
set role authenticated;
select t.ok(public.my_jobs()::text !~ 'progress_by|"Ray J"', 'customer sees no internal update details');
reset role;
select set_config('request.jwt.claim.sub', :'S', false);
set role authenticated;
update public.jobs set stage = 'return_visit', progress_by = 'Office' where id = current_setting('t.job')::uuid;
select t.ok((select stage from public.jobs where id = current_setting('t.job')::uuid) = 'return_visit', 'office can set progress detail too');
update public.jobs set status = 'scheduled' where id = current_setting('t.job')::uuid;
select t.ok((select stage from public.jobs where id = current_setting('t.job')::uuid) is null, 'changing status clears a detail that no longer fits');
update public.jobs set status = 'in_progress' where id = current_setting('t.job')::uuid;
reset role;

select set_config('request.jwt.claim.sub', :'D', false);
set role authenticated;
do $$ begin
  begin perform public.claim_crew_invite(current_setting('t.invite')); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'invite code works only once'); end;
end $$;
reset role;

-- ---- crew notes ----
select set_config('request.jwt.claim.sub', :'C', false);
set role authenticated;
select public.crew_add_note(null, current_setting('t.job')::uuid, 'Need 2 more bundles of shingles');
select t.ok((public.crew_my_jobs()->0->'notes'->0->>'text') = 'Need 2 more bundles of shingles', 'crew sees their own note (login)');
do $$ begin
  begin perform public.crew_add_note(null, gen_random_uuid(), 'x'); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'crew cannot note jobs that are not theirs'); end;
  begin perform public.crew_add_note(null, current_setting('t.job')::uuid, '   '); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'empty note refused'); end;
end $$;
select t.ok((select count(*) from public.crew_notes) = 0, 'crew cannot read the notes table directly');
reset role;

select set_config('request.jwt.claim.sub', '', false);
set role anon;
select public.crew_add_note(current_setting('t.token2'), null, 'Customer not home, back at 3');
select t.ok(jsonb_array_length(public.crew_job(current_setting('t.token2'))->'notes') = 2, 'photo-link page shows the crew''s notes');
do $$ begin
  begin perform public.crew_add_note(current_setting('t.token'), null, 'old link'); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'old photo link cannot add notes'); end;
  begin perform public.crew_add_note(null, current_setting('t.job')::uuid, 'anon by job id'); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'not-logged-in cannot add notes without the link'); end;
  begin perform * from public.crew_notes; perform t.ok(false, 'x');
  exception when insufficient_privilege then perform t.ok(true, 'not-logged-in cannot read notes'); end;
end $$;
reset role;

select set_config('request.jwt.claim.sub', :'A', false);
set role authenticated;
select t.ok((select count(*) from public.crew_notes) = 0, 'customer cannot read crew notes');
select t.ok(public.my_jobs()::text !~ 'shingles|not home', 'customer job view has no crew notes');
reset role;

select set_config('request.jwt.claim.sub', :'S', false);
set role authenticated;
select t.ok((select count(*) from public.crew_notes where by_name = 'Ray Johnson') = 2, 'office sees crew notes with who wrote them');
select t.ok(exists (select 1 from public.job_events where text = 'Ray Johnson added a crew note'), 'crew note logged in history');
update public.job_private set crew_notes_seen_at = now();
select t.ok((select crew_notes_seen_at is not null from public.job_private), 'office can mark notes seen');
reset role;

-- ---- office-entered job for a customer without the app ----
select set_config('request.jwt.claim.sub', :'S', false);
set role authenticated;
insert into public.jobs (contact_name, contact_phone, contact_email, entered_by, trade, description, address, zip, status, contractor_id, scheduled_for)
  values ('Pat Phone', '(555) 777-8888', 'pat@example.com', 'Office', 'hvac', 'Furnace not starting', '9 Elm St', '62701', 'scheduled',
          (select id from public.contractors where name = 'Ray Johnson'), '2026-11-20T10:00');
select set_config('t.pjob', (select id::text from public.jobs where contact_name = 'Pat Phone'), false);
select t.ok((select crew_token from public.job_private where job_id = current_setting('t.pjob')::uuid) is not null, 'office job with a crew gets an upload link');
select t.ok(exists (select 1 from public.job_events where job_id = current_setting('t.pjob')::uuid and text = 'Job entered by Office (office)'), 'office-entered job logged');
do $$ begin
  begin insert into public.jobs (trade, description, address) values ('x', 'no customer at all', 'y'); perform t.ok(false, 'x');
  exception when check_violation then perform t.ok(true, 'job needs a customer account or a contact name'); end;
end $$;
reset role;

select set_config('request.jwt.claim.sub', :'C', false);
set role authenticated;
select t.ok(public.crew_my_jobs()::text ~ 'Pat Phone' and public.crew_my_jobs()::text ~ '777-8888', 'crew sees phone-in customer name and phone');
select t.ok(public.crew_my_jobs()::text !~ 'pat@example', 'crew does not see phone-in customer email');
reset role;

select set_config('request.jwt.claim.sub', :'A', false);
set role authenticated;
select t.ok(public.my_jobs()::text !~ 'Pat Phone|Furnace', 'other customers never see office-entered jobs');
reset role;

-- ---- crew confirms / declines, time on job, customer photos ----
select set_config('request.jwt.claim.sub', :'S', false);
set role authenticated;
update public.jobs set status = 'scheduled' where id = current_setting('t.pjob')::uuid;
reset role;
select set_config('request.jwt.claim.sub', :'C', false);
set role authenticated;
do $$ begin
  begin perform public.crew_respond(current_setting('t.pjob')::uuid, 'declined', ''); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'declining needs a reason'); end;
  begin perform public.crew_respond(gen_random_uuid(), 'confirmed', ''); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'crew cannot confirm jobs that are not theirs'); end;
end $$;
select public.crew_respond(current_setting('t.pjob')::uuid, 'declined', 'Out sick Friday');
select t.ok((select x->>'crew_response' from jsonb_array_elements(public.crew_my_jobs()) x where x->>'id' = current_setting('t.pjob')) = 'declined', 'crew can say they can''t make it');
select public.crew_respond(current_setting('t.pjob')::uuid, 'confirmed', '');
select public.crew_set_progress(current_setting('t.pjob')::uuid, 'in_progress', null);
select public.crew_set_progress(current_setting('t.pjob')::uuid, 'completed', null);
select t.ok((select (x->>'started_at') is not null and (x->>'finished_at') is not null from jsonb_array_elements(public.crew_my_jobs()) x where x->>'id' = current_setting('t.pjob')), 'start and finish times recorded');
select public.crew_set_progress(current_setting('t.pjob')::uuid, 'in_progress', null);
select t.ok((select (x->>'finished_at') is null from jsonb_array_elements(public.crew_my_jobs()) x where x->>'id' = current_setting('t.pjob')), 'undoing finish clears the finish time');
reset role;
select set_config('request.jwt.claim.sub', :'S', false);
set role authenticated;
select t.ok(exists (select 1 from public.crew_notes where text = 'Can’t make it: Out sick Friday'), 'office gets the can''t-make-it reason as a note');
select t.ok(exists (select 1 from public.job_events where text = 'Ray Johnson confirmed the job'), 'confirmation logged');
update public.jobs set contractor_id = (select id from public.contractors where name = 'Mike Alvarez') where id = current_setting('t.pjob')::uuid;
select t.ok((select crew_response from public.jobs where id = current_setting('t.pjob')::uuid) is null, 'reassigning clears the previous crew''s answer');
update public.jobs set contractor_id = (select id from public.contractors where name = 'Ray Johnson') where id = current_setting('t.pjob')::uuid;
reset role;
-- customer photo on Ann's job (assigned to Ray) is readable by Ray's login, not by anon or other customers
select t.ok(public.crew_can_read_customer((select path from public.job_files where source = 'customer' limit 1)) is false, 'helper is false without a crew login');
select set_config('request.jwt.claim.sub', :'C', false);
set role authenticated;
select t.ok((select count(*) from storage.objects where name like '%/customer/%') = 1, 'crew can open customer request photos on their job');
select t.ok(jsonb_array_length((select x->'customer_photos' from jsonb_array_elements(public.crew_my_jobs()) x where x->>'id' = current_setting('t.job'))) = 1, 'crew job lists customer photos');
reset role;
select set_config('request.jwt.claim.sub', :'B', false);
set role authenticated;
select t.ok((select count(*) from storage.objects where name like '%/customer/%') = 0, 'other customers still cannot open them');
reset role;

update public.settings set data = data || '{"showCrewPay": false}';
select set_config('request.jwt.claim.sub', :'C', false);
set role authenticated;
select t.ok(public.crew_my_jobs()::text !~ '1150', 'crew pay hidden when office switches it off');
reset role;
update public.settings set data = data || '{"showCrewPay": true}';

select set_config('request.jwt.claim.sub', :'S', false);
set role authenticated;
select public.staff_revoke_crew((select id from public.contractors where name = 'Ray Johnson'));
reset role;
select set_config('request.jwt.claim.sub', :'C', false);
set role authenticated;
do $$ begin
  begin perform public.crew_my_jobs(); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'turned-off crew login sees nothing'); end;
  begin perform public.crew_set_progress(current_setting('t.job')::uuid, 'completed', null); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'turned-off crew login cannot update jobs'); end;
end $$;
reset role;

-- ========== Sales team ==========
\set E '66666666-6666-6666-6666-666666666666'
\set F '77777777-7777-7777-7777-777777777777'
insert into auth.users (id, email, raw_user_meta_data) values (:'E', 'maria@sales.test', '{"name":"Maria L"}'), (:'F', 'sam@sales.test', '{"name":"Sam S"}');
select set_config('request.jwt.claim.sub', :'S', false);
set role authenticated;
insert into public.salespeople (name, phone) values ('Maria Lopez', '(555) 444-1212'), ('Sam Smith', '(555) 444-3434');
select set_config('t.maria', (select id::text from public.salespeople where name = 'Maria Lopez'), false);
select set_config('t.sam', (select id::text from public.salespeople where name = 'Sam Smith'), false);
select set_config('t.minv', public.staff_invite_sales(current_setting('t.maria')::uuid), false);
select set_config('t.sinv', public.staff_invite_sales(current_setting('t.sam')::uuid), false);
-- the office assigns Ann's job to Maria
update public.jobs set sales_id = current_setting('t.maria')::uuid where id = current_setting('t.job')::uuid;
reset role;
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select t.ok((public.sales_invite_info(current_setting('t.minv'))->>'name') = 'Maria Lopez', 'sales invite shows who it is for');
do $$ begin
  begin perform public.claim_sales_invite(current_setting('t.minv')); perform t.ok(false, 'x');
  exception when insufficient_privilege then perform t.ok(true, 'not-logged-in cannot claim a sales invite'); end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', :'E', false);
set role authenticated;
select public.claim_sales_invite(current_setting('t.minv'));
reset role;
select set_config('request.jwt.claim.sub', :'F', false);
set role authenticated;
select public.claim_sales_invite(current_setting('t.sinv'));
reset role;
select t.ok((select role from public.profiles where id = :'E') = 'sales', 'invite makes a sales login');

-- Maria (sales)
select set_config('request.jwt.claim.sub', :'E', false);
set role authenticated;
select t.ok((select count(*) from public.jobs) = 1, 'salesperson sees only her assigned job');
select t.ok((select count(*) from public.job_costs) = 0, 'salesperson never sees crew pay');
select t.ok((select count(*) from public.contractors) = 0, 'salesperson cannot read the crew table directly');
select t.ok(jsonb_array_length(public.office_crew_list()) = 2 and public.office_crew_list()::text !~ 'invite_code|user_id', 'salesperson gets crew names to pick from, without logins or invites');
select t.ok((select count(*) from public.profiles where id = :'A') = 1 and (select count(*) from public.profiles where id = :'B') = 0, 'salesperson sees her client''s profile, not other customers');
select t.ok((select count(*) from public.job_events) > 0 and (select count(*) from public.documents) > 0, 'salesperson sees her client''s history and estimates');
update public.job_private set notes = 'Maria: follow up Monday';
select t.ok((select notes from public.job_private) = 'Maria: follow up Monday', 'salesperson can edit notes on her job');
do $$ begin
  begin update public.job_private set crew_token = 'x' || crew_token; perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'salesperson cannot change the crew link'); end;
  begin update public.jobs set sales_id = current_setting('t.sam')::uuid; perform t.ok(false, 'x');
  exception when raise_exception or check_violation or insufficient_privilege then perform t.ok(true, 'salesperson cannot hand her job to someone else'); end;
  begin update public.documents set status = 'void' where type = 'invoice'; perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'salesperson cannot void invoices'); end;
  begin update public.documents set payments = '[]' where type = 'invoice'; perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'salesperson cannot change payments'); end;
  begin update public.settings set data = '{}'; perform t.ok((select data->>'name' from public.settings) = 'Top Hat Contracting', 'salesperson cannot change company details'); end;
end $$;
-- her own new client from a phone call
insert into public.jobs (sales_id, contact_name, contact_phone, entered_by, trade, description, address, status)
  values (current_setting('t.maria')::uuid, 'Kim Caller', '(555) 909-1010', 'Maria L', 'painting', 'Repaint exterior trim', '7 Pine Ct', 'qualifying');
select t.ok((select count(*) from public.jobs) = 2, 'salesperson adds her own clients');
-- she schedules her client with a crew and a date
update public.jobs set contractor_id = (select (x->>'id')::uuid from jsonb_array_elements(public.office_crew_list()) x where x->>'name' = 'Mike Alvarez'),
       scheduled_for = '2026-11-21T09:00', status = 'scheduled' where contact_name = 'Kim Caller';
select t.ok((select status from public.jobs where contact_name = 'Kim Caller') = 'scheduled', 'salesperson can assign a crew and date');
select t.ok((select crew_token from public.job_private p join public.jobs j on j.id = p.job_id where j.contact_name = 'Kim Caller') is not null, 'assigning creates the crew photo link');
select t.ok((select count(*) from public.job_costs) = 0, 'still no crew pay for the salesperson');
select public.log_call((select id from public.jobs where contact_name = 'Kim Caller'), 'Left voicemail', 'Try Monday');
select t.ok(exists (select 1 from public.job_events where text = '📞 Call (Maria L): Left voicemail. Try Monday'), 'calls are logged with her name');
select t.ok((select count(*) from public.job_messages) = 0, 'salesperson cannot read the message log (office only)');
select t.ok((select count(*) from public.office_records) = 0, 'salesperson cannot read office records');
do $$ begin
  begin insert into public.office_records (kind, data) values ('price_item', '{"name":"x","cost":1}'); perform t.ok(false, 'x');
  exception when insufficient_privilege or check_violation then perform t.ok(true, 'salesperson cannot add office records'); end;
  begin insert into public.documents (job_id, type, items, change_order) select id, 'estimate', '[{"desc":"Extra","qty":1,"price":50}]', true from public.jobs where contact_name = 'Kim Caller'; perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'salesperson cannot write change orders'); end;
end $$;
do $$ begin
  begin perform public.log_message((select id from public.jobs where contact_name = 'Kim Caller'), 'text', 'out', 'Hi'); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'salesperson cannot use office texting'); end;
  begin update public.jobs set source = 'angi' where contact_name = 'Kim Caller'; perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'salesperson cannot change lead details'); end;
  begin insert into public.job_messages (job_id, channel, dir, body) select id, 'text', 'out', 'x' from public.jobs where contact_name = 'Kim Caller'; perform t.ok(false, 'x');
  exception when insufficient_privilege then perform t.ok(true, 'messages are only written through the app functions'); end;
end $$;
insert into public.documents (job_id, type, items) select id, 'estimate', '[{"desc":"Trim","qty":1,"price":900}]' from public.jobs where contact_name = 'Kim Caller';
update public.documents set status = 'sent' where number like 'E-%' and job_id = (select id from public.jobs where contact_name = 'Kim Caller');
select t.ok(exists (select 1 from public.documents where status = 'sent' and job_id = (select id from public.jobs where contact_name = 'Kim Caller')), 'salesperson can create and send estimates');
insert into storage.objects (bucket_id, name) select 'job-files', id || '/staff/site.jpg' from public.jobs where contact_name = 'Kim Caller';
insert into public.job_files (job_id, path, name, source, by_name) select id, id || '/staff/site.jpg', 'site.jpg', 'staff', 'Maria L' from public.jobs where contact_name = 'Kim Caller';
select t.ok((select count(*) from storage.objects where name like '%/staff/site.jpg') = 1, 'salesperson can upload and open files on her clients');
select t.ok((select count(*) from storage.objects where name like '%estimate.pdf') = 1, 'salesperson can open files on her assigned job');
do $$ begin
  begin insert into public.jobs (sales_id, contact_name, trade, description, address) values (current_setting('t.sam')::uuid, 'X', 'x', 'xxxxx', 'y'); perform t.ok(false, 'x');
  exception when raise_exception or insufficient_privilege or check_violation then perform t.ok(true, 'salesperson cannot add jobs for someone else'); end;
  begin perform public.log_call(current_setting('t.pjob')::uuid, 'Talked', ''); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'salesperson cannot touch jobs that are not hers'); end;
end $$;
reset role;

-- Sam (other salesperson) sees none of Maria's work
select set_config('request.jwt.claim.sub', :'F', false);
set role authenticated;
select t.ok((select count(*) from public.jobs) = 0 and (select count(*) from public.documents) = 0 and (select count(*) from public.job_events) = 0, 'other salespeople see none of her clients');
select t.ok((select count(*) from public.job_messages) = 0, 'other salespeople cannot read her messages');
select t.ok((select count(*) from storage.objects) = 0, 'other salespeople cannot open her files');
reset role;

-- Customer and crew can't use sales tools
select set_config('request.jwt.claim.sub', :'A', false);
set role authenticated;
do $$ begin
  begin perform public.log_call(current_setting('t.job')::uuid, 'Talked', ''); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'customers cannot log calls'); end;
end $$;
select t.ok((select count(*) from public.job_messages) = 0, 'customers cannot read the office''s message log');
reset role;

-- Owner sees everything, including who did what
select set_config('request.jwt.claim.sub', :'S', false);
set role authenticated;
select t.ok((select count(*) from public.jobs where sales_id = current_setting('t.maria')::uuid) = 2, 'owner sees all of Maria''s clients');
select t.ok(exists (select 1 from public.job_events where text = 'Job entered by Maria L (sales)'), 'owner sees which jobs sales entered');
select t.ok((select count(*) from public.job_messages where channel = 'call') = 1, 'office sees calls in the message log');
select t.ok((select first_contact_at from public.jobs where contact_name = 'Kim Caller') is not null, 'first call sets the speed-to-lead time');
select public.log_message((select id from public.jobs where contact_name = 'Kim Caller'), 'text', 'out', 'Hi Kim, see you Monday');
select public.log_message((select id from public.jobs where contact_name = 'Kim Caller'), 'text', 'in', 'Great, thanks');
select t.ok((select count(*) from public.job_messages) = 3, 'office saves texts and replies');
update public.jobs set source = 'angi', homeowner = true, do_not_contact = true where contact_name = 'Kim Caller';
select t.ok(exists (select 1 from public.job_events where text = '🚫 Customer asked not to be contacted'), 'do-not-contact is logged');
do $$ begin
  begin perform public.log_message((select id from public.jobs where contact_name = 'Kim Caller'), 'text', 'out', 'one more'); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'no texts to a do-not-contact customer'); end;
end $$;
update public.jobs set do_not_contact = false where contact_name = 'Kim Caller';
-- Office records (price book, expenses, suppliers…)
insert into public.office_records (kind, job_id, data, by_name) select 'expense', id, '{"amount":120,"category":"Materials"}', 'Office' from public.jobs where contact_name = 'Kim Caller';
insert into public.office_records (kind, data) values ('price_item', '{"name":"Cabinet install","cost":80,"price":140}');
select t.ok((select count(*) from public.office_records where kind in ('expense', 'price_item')) = 2, 'office keeps its own records');
-- Change orders add to the agreed price
update public.documents set status = 'approved' where number like 'E-%' and job_id = (select id from public.jobs where contact_name = 'Kim Caller');
select t.ok((select price from public.job_private p join public.jobs j on j.id = p.job_id where j.contact_name = 'Kim Caller') = 900, 'approved estimate sets the price');
insert into public.documents (job_id, type, items, change_order) select id, 'estimate', '[{"desc":"Extra trim","qty":1,"price":200}]', true from public.jobs where contact_name = 'Kim Caller';
select t.ok(exists (select 1 from public.documents where number like 'CO-%'), 'change orders are numbered CO-');
update public.documents set status = 'sent' where number like 'CO-%';
update public.documents set status = 'approved' where number like 'CO-%';
select t.ok((select price from public.job_private p join public.jobs j on j.id = p.job_id where j.contact_name = 'Kim Caller') = 1100, 'approved change order adds to the price');
select public.staff_revoke_sales(current_setting('t.maria')::uuid);
reset role;
select set_config('request.jwt.claim.sub', :'E', false);
set role authenticated;
select t.ok((select count(*) from public.jobs) = 0, 'turned-off sales login sees nothing');
reset role;

-- ========== Payment schedule invoices ==========
select set_config('request.jwt.claim.sub', :'S', false);
set role authenticated;
insert into public.documents (job_id, type, items, schedule_step, schedule_base)
  values (current_setting('t.job')::uuid, 'invoice', '[{"desc":"Deposit: 50% of $422.28","qty":1,"price":211.14}]', 0, 422.28);
select set_config('t.dep', (select id::text from public.documents where schedule_step = 0), false);
select t.ok((select schedule_base from public.documents where id = current_setting('t.dep')::uuid) = 422.28, 'deposit invoice remembers the job total');
update public.documents set schedule_step = 2, schedule_base = 1 where id = current_setting('t.dep')::uuid;
select t.ok((select schedule_step from public.documents where id = current_setting('t.dep')::uuid) = 0, 'which payment an invoice is for cannot be changed later');
do $$ begin
  begin insert into public.documents (job_id, type, items, schedule_step) values (current_setting('t.job')::uuid, 'estimate', '[]', 0); perform t.ok(false, 'x');
  exception when check_violation then perform t.ok(true, 'only invoices can be schedule payments'); end;
end $$;
update public.documents set status = 'sent' where id = current_setting('t.dep')::uuid;
reset role;
select set_config('request.jwt.claim.sub', :'A', false);
set role authenticated;
select t.ok(public.my_documents()::text ~ '"schedule_step": 0', 'customer sees which payment the invoice is for');
-- "I've sent my payment"
select public.report_payment(current_setting('t.dep')::uuid, 100, 'Zelle', 'conf 123', 'Ann Buyer', 'data:image/png;base64,iVBORw0KGgo=');
select t.ok(public.my_documents()::text ~ '"name": "Ann Buyer"', 'customer''s signature saved with the payment');
select t.ok(public.my_documents()::text ~ '"status": "pending"', 'customer sees their reported payment as pending');
select t.ok((select count(*) from public.payment_reports) = 0, 'customer cannot read the reports table directly');
do $$ begin
  begin perform public.report_payment(current_setting('t.dep')::uuid, 0, 'Zelle', ''); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'reported payment must be more than zero'); end;
  begin perform public.resolve_payment_report((select id from public.payment_reports limit 1), true); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'customer cannot confirm their own payment'); end;
end $$;
do $$ begin
  begin insert into public.payment_reports (doc_id, job_id, amount) values (current_setting('t.dep')::uuid, current_setting('t.job')::uuid, 5); perform t.ok(false, 'x');
  exception when insufficient_privilege then perform t.ok(true, 'customer cannot write reports directly'); end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', :'B', false);
set role authenticated;
do $$ begin
  begin perform public.report_payment(current_setting('t.dep')::uuid, 50, 'Zelle', ''); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'other customer cannot report a payment on A''s invoice'); end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', :'S', false);
set role authenticated;
select t.ok((select count(*) from public.payment_reports where status = 'pending') = 1, 'office sees the reported payment');
select public.resolve_payment_report((select id from public.payment_reports limit 1), true);
select t.ok((select (payments->0->>'amount')::numeric from public.documents where id = current_setting('t.dep')::uuid) = 100, 'confirming records the payment on the invoice');
select t.ok((select status from public.payment_reports limit 1) = 'confirmed', 'report marked confirmed');
do $$ begin
  begin perform public.resolve_payment_report((select id from public.payment_reports limit 1), true); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'a report cannot be confirmed twice'); end;
end $$;
reset role;

-- ========== Building permit + design studio ==========
select set_config('request.jwt.claim.sub', :'B', false);
set role authenticated;
do $$ begin
  begin perform public.authorize_permit(current_setting('t.job')::uuid, 'Bob Buyer'); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'other customer cannot approve a permit on someone else''s job'); end;
end $$;
select t.ok(not public.can_design(current_setting('t.job')::uuid), 'other customer cannot use the design studio on A''s job');
reset role;
select set_config('request.jwt.claim.sub', :'A', false);
set role authenticated;
do $$ begin
  begin perform public.authorize_permit(current_setting('t.job')::uuid, ' '); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'permit approval needs a typed name'); end;
end $$;
select public.authorize_permit(current_setting('t.job')::uuid, 'Ann Buyer');
select t.ok((select x->>'permit_status' from jsonb_array_elements(public.my_jobs()) x where x->>'id' = current_setting('t.job')) = 'authorized', 'customer approves the permit');
select t.ok((select x->>'permit_authorized_by' from jsonb_array_elements(public.my_jobs()) x where x->>'id' = current_setting('t.job')) = 'Ann Buyer', 'signature saved');
update public.jobs set permit_status = 'approved';
select t.ok((select x->>'permit_status' from jsonb_array_elements(public.my_jobs()) x where x->>'id' = current_setting('t.job')) = 'authorized', 'customer cannot set the permit status');
select t.ok(public.can_design(current_setting('t.job')::uuid), 'customer can use the design studio on own job');
do $$ begin
  begin insert into public.design_versions (job_id, source, path) values (current_setting('t.job')::uuid, 'photo', 'x'); perform t.ok(false, 'x');
  exception when insufficient_privilege then perform t.ok(true, 'customer cannot write design rows directly'); end;
end $$;
reset role;
-- The design Edge Function writes with the service role (here: the table owner).
insert into public.design_versions (job_id, source, path, prompt) values (current_setting('t.job')::uuid, 'ai', current_setting('t.job') || '/design/a.png', 'L-shaped kitchen');
select set_config('request.jwt.claim.sub', :'A', false);
set role authenticated;
select t.ok((select count(*) from public.design_versions) = 1, 'customer sees own design pictures');
select t.ok((select (x->>'design_count')::int from jsonb_array_elements(public.my_jobs()) x where x->>'id' = current_setting('t.job')) = 1, 'my_jobs counts design pictures');
reset role;
select set_config('request.jwt.claim.sub', :'B', false);
set role authenticated;
select t.ok((select count(*) from public.design_versions) = 0, 'other customer sees no design pictures');
reset role;
select set_config('request.jwt.claim.sub', :'S', false);
set role authenticated;
select t.ok((select count(*) from public.design_versions) = 1, 'office sees design pictures');
do $$ begin
  begin update public.design_versions set chosen = true; perform t.ok(false, 'x');
  exception when insufficient_privilege then perform t.ok(true, 'office cannot change design rows directly either'); end;
end $$;
update public.jobs set permit_status = 'applied', permit_number = 'BP-77' where id = current_setting('t.job')::uuid;
update public.job_private set permit_portal = 'https://permits.example.gov', permit_fee = 185 where job_id = current_setting('t.job')::uuid;
select t.ok(exists (select 1 from public.job_events where text = '📋 Permit → Applied: waiting on the town'), 'permit status change logged');
select t.ok(exists (select 1 from public.job_events where text = '📋 Permit # BP-77'), 'permit number logged');
do $$ begin
  begin update public.job_private set permit_portal = 'javascript:alert(1)' where job_id = current_setting('t.job')::uuid; perform t.ok(false, 'x');
  exception when check_violation then perform t.ok(true, 'permit website must be a web link'); end;
end $$;
reset role;
set role anon;
select set_config('t.cj', coalesce(public.crew_job(current_setting('t.token2'))::text, ''), false);
reset role;
select t.ok(current_setting('t.cj') !~ 'permit|BP-77|design', 'crew link shows no permit or design details');

-- ========== Hot lead: phone estimate agreed, rep visit booked ==========
select set_config('request.jwt.claim.sub', :'S', false);
set role authenticated;
insert into public.jobs (buyer_id, trade, description, address, status) values (:'A', 'painting', 'Paint three bedrooms', '5 Elm St', 'qualifying');
select set_config('t.hot', (select id::text from public.jobs where description = 'Paint three bedrooms'), false);
insert into public.documents (job_id, type, items) values (current_setting('t.hot')::uuid, 'estimate', '[{"desc":"Paint 3 rooms","qty":1,"price":3200}]');
update public.documents set status = 'sent' where job_id = current_setting('t.hot')::uuid;
select set_config('t.hotest', (select id::text from public.documents where job_id = current_setting('t.hot')::uuid), false);
reset role;
select set_config('request.jwt.claim.sub', :'A', false);
set role authenticated;
select public.respond_estimate(current_setting('t.hotest')::uuid, true, 'Ann Buyer', 'data:image/png;base64,iVBORw0KGgo=');
select t.ok((select x->>'name' from jsonb_each(public.my_documents()) j, jsonb_array_elements(j.value) e, lateral (select e->'signature' as x) s where e->>'id' = current_setting('t.hotest')) = 'Ann Buyer', 'customer''s signature saved on the estimate');
select t.ok((select x->>'status' from jsonb_array_elements(public.my_jobs()) x where x->>'id' = current_setting('t.hot')) = 'hot', 'approving the estimate makes it a hot lead');
select t.ok((select x->>'visit_at' from jsonb_array_elements(public.my_jobs()) x where x->>'id' = current_setting('t.hot')) is null, 'no visit time before one is booked');
reset role;
select set_config('request.jwt.claim.sub', :'S', false);
set role authenticated;
update public.jobs set visit_at = '2030-05-01 16:00' where id = current_setting('t.hot')::uuid;
do $$ begin
  begin update public.documents set signature = '{"name":"Someone Else","image":"data:image/png;base64,AAAA"}' where id = current_setting('t.hotest')::uuid; perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'a signature cannot be changed after approval'); end;
end $$;
insert into public.documents (job_id, type, items) values (current_setting('t.hot')::uuid, 'estimate', '[{"desc":"Extra closet","qty":1,"price":500}]');
update public.documents set status = 'sent' where job_id = current_setting('t.hot')::uuid and status = 'draft';
select set_config('t.est2', (select id::text from public.documents where job_id = current_setting('t.hot')::uuid and status = 'sent' and type = 'estimate'), false);
select t.ok(exists (select 1 from public.job_events where job_id = current_setting('t.hot')::uuid and text like '🤝 Rep visit booked for May 1, 2030%'), 'rep visit logged');
select t.ok(exists (select 1 from public.job_events where job_id = current_setting('t.hot')::uuid and text = 'Status → Hot lead'), 'hot lead logged');
reset role;
select set_config('request.jwt.claim.sub', :'A', false);
set role authenticated;
select t.ok((select x->>'visit_at' from jsonb_array_elements(public.my_jobs()) x where x->>'id' = current_setting('t.hot')) like '2030-05-01%', 'customer sees the rep visit time');
do $$ begin
  begin perform public.respond_estimate(current_setting('t.est2')::uuid, true, 'Ann Buyer', 'javascript:alert(1)'); perform t.ok(false, 'x');
  exception when check_violation then perform t.ok(true, 'a signature must be a PNG picture'); end;
end $$;
select t.ok((select x::text from jsonb_array_elements(public.my_jobs()) x where x->>'id' = current_setting('t.hot')) !~ '3200|price', 'customer job data still has no price');
reset role;

-- ========== Materials and reviews ==========
-- (Ray's crew login was turned off above; turn it back on for these checks.)
reset role;
update public.contractors set user_id = :'C' where name = 'Ray Johnson';
update public.profiles set role = 'crew', contractor_id = (select id from public.contractors where name = 'Ray Johnson') where id = :'C';
select set_config('request.jwt.claim.sub', :'S', false);
set role authenticated;
update public.jobs set contractor_id = (select id from public.contractors where name = 'Ray Johnson'), status = 'in_progress' where id = current_setting('t.job')::uuid;
insert into public.job_materials (job_id, name, qty, status) values (current_setting('t.job')::uuid, 'Quartz slab', '1', 'ordered');
select t.ok((select count(*) from public.job_materials where job_id = current_setting('t.job')::uuid) = 1, 'office adds materials');
do $$ begin
  begin perform public.office_ask_review(current_setting('t.job')::uuid); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'no review request before the job is finished'); end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', :'C', false);
set role authenticated;
select t.ok(public.crew_material_add(current_setting('t.job')::uuid, 'Drip edge', '10', '') is not null, 'crew adds a material they need');
select t.ok((select count(*) from public.job_materials) = 0, 'crew cannot read the materials table directly');
select t.ok(jsonb_array_length(public.crew_my_jobs()->0->'materials') = 2, 'crew sees the job''s materials');
select public.crew_material_delivered((select (x->>'id')::uuid from jsonb_array_elements(public.crew_my_jobs()->0->'materials') x where x->>'name' = 'Quartz slab'));
do $$ begin
  begin insert into public.job_materials (job_id, name) values (current_setting('t.job')::uuid, 'Sneaky'); perform t.ok(false, 'x');
  exception when insufficient_privilege then perform t.ok(true, 'crew cannot insert materials directly'); end;
end $$;
reset role;
select t.ok((select status from public.job_materials where name = 'Quartz slab') = 'delivered', 'crew marks a material delivered');
select t.ok(exists (select 1 from public.job_events where text like '✅ Quartz slab: delivered%') and exists (select 1 from public.job_events where text like '🛒 % added material: Drip edge%'), 'material changes go into the job history');
select set_config('request.jwt.claim.sub', :'A', false);
set role authenticated;
select t.ok((select count(*) from public.job_materials) = 0, 'customer cannot read the materials table directly');
select t.ok(jsonb_array_length((select x->'materials' from jsonb_array_elements(public.my_jobs()) x where x->>'id' = current_setting('t.job'))) = 2, 'customer sees materials on their job');
do $$ begin
  begin perform public.customer_review(current_setting('t.job')::uuid, 5, 'Great'); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'no review before the job is finished'); end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', :'S', false);
set role authenticated;
update public.jobs set status = 'completed' where id = current_setting('t.job')::uuid;
select public.office_ask_review(current_setting('t.job')::uuid);
select t.ok((select review_requested_at from public.jobs where id = current_setting('t.job')::uuid) is not null, 'office asks for a review');
reset role;
select set_config('request.jwt.claim.sub', :'B', false);
set role authenticated;
do $$ begin
  begin perform public.customer_review(current_setting('t.job')::uuid, 1, 'Bad'); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'another customer cannot review someone else''s job'); end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', :'A', false);
set role authenticated;
do $$ begin
  begin perform public.customer_review(current_setting('t.job')::uuid, 9, ''); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'rating must be 1 to 5'); end;
end $$;
select public.customer_review(current_setting('t.job')::uuid, 5, 'Great job');
select t.ok((select (x->>'review_rating')::int from jsonb_array_elements(public.my_jobs()) x where x->>'id' = current_setting('t.job')) = 5, 'customer rates the finished job');
reset role;

-- ========== Signing invoices ==========
select set_config('request.jwt.claim.sub', :'B', false);
set role authenticated;
do $$ begin
  begin perform public.sign_document(current_setting('t.inv')::uuid, 'Bob Other', 'data:image/png;base64,iVBORw0KGgo='); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'another customer cannot sign someone else''s invoice'); end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', :'A', false);
set role authenticated;
select public.sign_document(current_setting('t.inv')::uuid, 'Ann Buyer', 'data:image/png;base64,iVBORw0KGgo=');
select t.ok(public.my_documents()::text like '%"name": "Ann Buyer"%', 'customer sees their signature on the invoice');
do $$ begin
  begin perform public.sign_document(current_setting('t.inv')::uuid, 'Ann Buyer', 'data:image/png;base64,iVBORw0KGgo='); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'an invoice is signed only once'); end;
  begin update public.documents set signature = null where id = current_setting('t.inv')::uuid; perform t.ok(true, 'customer update is a no-op');
  exception when others then perform t.ok(true, 'customer cannot clear a signature'); end;
end $$;
reset role;
select t.ok((select signature->>'name' from public.documents where id = current_setting('t.inv')::uuid) = 'Ann Buyer', 'customer signs their invoice in the app, and it stays');

-- ========== Closed job: crew link off ==========
select set_config('request.jwt.claim.sub', :'S', false);
set role authenticated;
update public.jobs set status = 'lost';
reset role;
set role anon;
select t.ok(public.crew_job(current_setting('t.token2')) is null, 'crew link off when job marked Not a fit');
reset role;
select 'ALL CHECKS PASSED' as result;
