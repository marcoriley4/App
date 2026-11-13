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
select t.ok(public.crew_job(current_setting('t.token'))::text !~ '1800|1150|Gate code|price|crew_pay|notes|ann@example', 'crew sees no prices, notes or customer email');
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

-- ========== Closed job: crew link off ==========
select set_config('request.jwt.claim.sub', :'S', false);
set role authenticated;
update public.jobs set status = 'lost';
reset role;
set role anon;
select t.ok(public.crew_job(current_setting('t.token2')) is null, 'crew link off when job marked Not a fit');
reset role;
select 'ALL CHECKS PASSED' as result;
