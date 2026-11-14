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
create temp table ids as select * from public.create_job('plumbing', 'Leaky faucet in the kitchen', '1 Main St', '62701', 'asap', 'u1k');
select t.ok((select number from ids) = 1001, 'first job number is 1001');
select t.ok((select count(*) from public.jobs) = 0, 'customer cannot read jobs table directly');
select t.ok((select count(*) from public.job_private) = 0, 'customer cannot read prices/notes');
select t.ok((select count(*) from public.job_events) = 0, 'customer cannot read activity');
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
update public.job_private set price = 1800, crew_pay = 1150.50, notes = 'Gate code 1234';
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
  begin perform public.create_job('x', 'xxxxxxxxxxxxx', 'y', '', '', ''); perform t.ok(false, 'x');
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
select t.ok((select crew_pay from public.job_private) = 1150.50, 'approval leaves crew pay alone');
select t.ok(exists (select 1 from public.job_events where text like 'E-1001 approved by Ann B. (customer)'), 'approval logged with who');
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
select t.ok(public.crew_my_jobs()::text !~ '422.28|"price"|Gate code|ann@example|E-1001|INV-1001', 'crew never sees customer price, notes, email or documents');
select t.ok((select count(*) from public.jobs) = 0 and (select count(*) from public.job_private) = 0 and (select count(*) from public.documents) = 0 and (select count(*) from public.contractors) = 0,
  'crew cannot read any tables directly');
select public.crew_set_status(current_setting('t.job')::uuid, 'in_progress');
do $$ begin
  begin perform public.crew_set_status(current_setting('t.job')::uuid, 'lost'); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'crew can only mark started or finished'); end;
  begin perform public.crew_set_status(gen_random_uuid(), 'completed'); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'crew cannot update jobs that are not theirs'); end;
end $$;
reset role;
select t.ok((select status from public.jobs where id = current_setting('t.job')::uuid) = 'in_progress', 'crew marked job started');
select t.ok(exists (select 1 from public.job_events where text = 'Updated by Ray J (crew)'), 'crew update logged with name');

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
  begin perform public.crew_set_status(current_setting('t.job')::uuid, 'completed'); perform t.ok(false, 'x');
  exception when raise_exception then perform t.ok(true, 'turned-off crew login cannot update jobs'); end;
end $$;
reset role;

-- ========== Closed job: crew link off ==========
select set_config('request.jwt.claim.sub', :'S', false);
set role authenticated;
update public.jobs set status = 'lost';
reset role;
set role anon;
select t.ok(public.crew_job(current_setting('t.token2')) is null, 'crew link off when job marked Not a fit');
reset role;
select 'ALL CHECKS PASSED' as result;
