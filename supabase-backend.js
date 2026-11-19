'use strict';
/*
 * Live backend: replaces the preview (browser-only) data layer with Supabase
 * when config.js has a project URL and key. Same methods as the preview
 * `TH.api`, so the screens don't change.
 *
 * Security is enforced by the database (supabase/schema.sql), not here:
 * customers and crew can only reach what its rules and functions allow.
 */
(function () {
  const cfg = window.TH_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabaseKey) return;
  if (!window.supabase || !window.TH) { console.error('Supabase library failed to load.'); return; }

  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  const BUCKET = 'job-files';
  const { guessKind, normEmail, validateSignUp, MAX_FILE_MB, DEFAULT_SETTINGS } = TH._util;

  /* ---------- helpers ---------- */
  const mapMaterial = (m) => ({ id: m.id, name: m.name, qty: m.qty || '', note: m.note || '', status: m.status, eta: m.eta || null, by: m.added_by || '', updatedBy: m.updated_by || '' });
  const mapBill = (b) => ({ id: b.id, step: b.step ?? null, label: b.label, amount: Number(b.amount), note: b.note || '', status: b.status, reason: b.reason || '',
    paidDate: b.paid_date || null, paidMethod: b.paid_method || '', by: b.by_name || '', at: Date.parse(b.created_at) || null, photos: Number(b.photos) || 0 });
  const mapDesign = (v) => v && ({ id: v.id, parentId: v.parent_id || null, source: v.source, prompt: v.prompt || '', by: v.by_name || '', at: Date.parse(v.created_at) || Date.now(), chosen: !!v.chosen, url: v.url || null });
  async function designCall(body) {
    const { data, error } = await sb.functions.invoke('design', { body });
    if (error) {
      let msg = error.message;
      try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (e) { /* not JSON */ }
      throw new Error(/Failed to send|fetch/i.test(msg) ? 'Can\'t reach the design studio. Check your connection and try again.' : msg);
    }
    return data || {};
  }
  function friendly(err) {
    const m = (err && (err.message || err.error_description || err.msg)) || String(err);
    if (/Invalid login credentials/i.test(m)) return 'That email and password don\'t match.';
    if (/already registered|already been registered|already exists/i.test(m)) return 'An account with that email already exists. Try logging in.';
    if (/Email not confirmed/i.test(m)) return 'Please confirm your email first. Check your inbox for a link from us.';
    if (/rate limit|too many/i.test(m)) return 'Too many attempts. Please wait a minute and try again.';
    if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) return 'Can\'t reach the server. Check your connection and try again.';
    if (/row-level security|permission denied|not authorized|violates/i.test(m)) return 'You don\'t have access to do that.';
    if (/Password should/i.test(m)) return 'Password must be at least 8 characters.';
    if (/maximum allowed size|Payload too large|exceeded/i.test(m)) return `That file is too big (max ${MAX_FILE_MB} MB).`;
    return m;
  }
  const must = ({ data, error }) => { if (error) throw new Error(friendly(error)); return data; };
  const ms = (t) => (t ? Date.parse(t) : null);
  const local16 = (t) => (t ? String(t).slice(0, 16) : null);
  const num = (v) => (v == null ? null : Number(v));
  const safeName = (n) => (String(n).replace(/[^\w.\-]+/g, '_').replace(/^_+/, '').slice(-80) || 'file');
  const rid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const tooBig = (file) => { if (file.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`"${file.name}" is over ${MAX_FILE_MB} MB.`); };

  // Supabase returns at most 1000 rows per request; page through larger tables.
  async function fetchAll(build) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const rows = must(await build().range(from, from + 999));
      out.push(...rows);
      if (rows.length < 1000) return out;
    }
  }
  async function signedUrls(paths) {
    if (!paths.length) return {};
    const res = must(await sb.storage.from(BUCKET).createSignedUrls(paths, 3600));
    return Object.fromEntries(res.filter((r) => r.signedUrl).map((r) => [r.path, r.signedUrl]));
  }
  async function upload(path, file) {
    must(await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false }));
  }
  const mapFile = (r, url) => ({
    id: r.id, name: r.name, mime: r.mime, size: Number(r.size) || 0, kind: r.kind, stage: r.stage || '', note: r.note || '',
    shared: !!r.shared, uploaded: ms(r.uploaded_at), by: r.by_name, source: r.source, billId: r.bill_id || null, url: url || null,
  });

  const mapDoc = (r) => ({
    id: r.id, type: r.type, number: r.number, status: r.status, items: r.items || [], taxRate: Number(r.tax_rate) || 0,
    notes: r.notes || '', dueDate: r.due_date || null, payLink: r.pay_link || '', payments: r.payments || [],
    created: ms(r.created_at), sentAt: ms(r.sent_at), respondedAt: ms(r.responded_at), respondedBy: r.responded_by || '',
    fromEstimateId: r.from_estimate || null,
    scheduleStep: r.schedule_step ?? null, scheduleBase: r.schedule_base == null ? null : Number(r.schedule_base),
    signature: r.signature ? { name: r.signature.name, image: r.signature.image, at: Date.parse(r.signature.at) || null, inPerson: !!r.signature.in_person, witness: r.signature.witness || '' } : null,
    reports: (r.reports || []).map((x) => ({ id: x.id, amount: Number(x.amount), method: x.method, note: x.note || '', by: x.reported_by || '', at: Date.parse(x.created_at) || null, status: x.status,
      signature: x.signature ? { name: x.signature.name, image: x.signature.image, at: Date.parse(x.signature.at) || null } : null })),
  });
  async function getDoc(docId) {
    const r = must(await sb.from('documents').select('*').eq('id', docId).maybeSingle());
    if (!r) throw new Error('Not found.');
    return r;
  }

  /* ---------- auth ---------- */
  let profile = null;
  async function me() {
    const { data } = await sb.auth.getSession();
    const user = data.session && data.session.user;
    if (!user) { profile = null; return null; }
    if (profile && profile.id === user.id) return profile;
    const { data: p } = await sb.from('profiles').select('id, role, name, email, phone, sales_id').eq('id', user.id).maybeSingle();
    if (p) p.salesId = p.sales_id || null;
    profile = p || { id: user.id, role: 'buyer', name: user.user_metadata?.name || '', email: user.email, phone: user.user_metadata?.phone || '' };
    return profile;
  }
  async function requireStaff() {
    const u = await me();
    if (!u || u.role !== 'staff') throw new Error('Please log in as Top Hat staff.');
    return u;
  }
  // Office area: staff, or a salesperson (the database limits them to their own clients).
  async function requireOffice() {
    const u = await me();
    if (!u || !['staff', 'sales'].includes(u.role)) throw new Error('Please log in as Top Hat staff.');
    return u;
  }

  let mine = new Map(); // customer's jobs from my_jobs(), for their shared files

  const api = {
    mode: 'live',

    auth: {
      me,
      async signUp({ name, email, phone, password }) {
        email = normEmail(email);
        validateSignUp({ name, email, phone, password });
        const data = must(await sb.auth.signUp({ email, password, options: { data: { name: name.trim(), phone: phone.trim() } } }));
        if (!data.session) {
          if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
            throw new Error('An account with that email already exists. Try logging in.');
          }
          throw new Error('Almost done! We emailed you a link to confirm your account. Tap it, then log in here and your request will be sent.');
        }
        profile = null;
        return me();
      },
      async signIn(email, password) {
        must(await sb.auth.signInWithPassword({ email: normEmail(email), password: password || '' }));
        profile = null;
        return me();
      },
      async signOut() { await sb.auth.signOut(); profile = null; mine = new Map(); },
    },

    jobs: {
      async create(job) {
        if (!(await me())) throw new Error('Please create an account first.');
        const rows = must(await sb.rpc('create_job', {
          p_trade: job.trade, p_description: job.description, p_address: job.address,
          p_zip: job.zip || '', p_state: job.state || TH.stateFromZip(job.zip) || '', p_timeframe: job.timeframe || '', p_budget: job.budget || '', p_style: job.style || '',
        }));
        const created = rows[0];
        // Request photos go into the job's folder. A failed photo never blocks the request.
        for (const [i, dataUrl] of (job.photos || []).entries()) {
          try {
            const blob = await (await fetch(dataUrl)).blob();
            const path = `${created.id}/customer/${rid()}.jpg`;
            await upload(path, blob);
            must(await sb.rpc('add_customer_file', { p_job: created.id, p_path: path, p_name: `Request photo ${i + 1}.jpg`, p_mime: blob.type || 'image/jpeg', p_size: blob.size }));
          } catch (e) { console.warn('Request photo upload failed:', e); }
        }
        return { id: created.id, number: created.number };
      },
      async mine() {
        if (!(await me())) return [];
        const list = must(await sb.rpc('my_jobs')) || [];
        mine = new Map(list.map((j) => [j.id, j]));
        return list.map((j) => ({
          id: j.id, number: j.number, trade: j.trade, status: j.status, created: ms(j.created_at),
          description: j.description, address: j.address, zip: j.zip || '', state: j.state || '', timeframe: j.timeframe, budget: j.budget, photos: [],
          scheduledFor: local16(j.scheduled_for), contractorName: j.contractor_name || null, stage: j.stage || null,
          visitAt: local16(j.visit_at), repName: j.rep_name || null,
          pm: j.pm_name ? { name: j.pm_name, phone: j.pm_phone || '' } : null,
          permit: { status: j.permit_status || 'none', number: j.permit_number || '', authorizedBy: j.permit_authorized_by || '', authorizedAt: ms(j.permit_authorized_at) || null },
          designCount: Number(j.design_count) || 0, style: j.style || '', materials: (j.materials || []).map(mapMaterial),
          review: j.review_requested_at || j.review_rating ? { requestedAt: ms(j.review_requested_at), rating: j.review_rating || null, comment: j.review_comment || '', at: ms(j.review_at) } : null,
          sharedFiles: (j.shared_files || []).length,
        }));
      },
      async all() {
        const u = await requireOffice();
        const [jobs, priv, files, people, papers, cnotes, costs] = await Promise.all([
          fetchAll(() => sb.from('jobs').select('*').order('created_at', { ascending: false })),
          fetchAll(() => sb.from('job_private').select('*')),
          fetchAll(() => sb.from('job_files').select('id, job_id, kind')),
          fetchAll(() => sb.from('profiles').select('id, name, email, phone')),
          fetchAll(() => sb.from('documents').select('id, job_id, type, number, status, items, tax_rate, due_date, payments, schedule_step, schedule_base, reports:payment_reports(id, amount, method, note, reported_by, created_at, status, signature)')),
          fetchAll(() => sb.from('crew_notes').select('id, job_id, created_at')),
          u.role === 'staff' ? fetchAll(() => sb.from('job_costs').select('job_id, crew_pay, crew_paid_date, crew_paid_method, crew_paid_note')) : Promise.resolve([]),
        ]);
        const designRows = await fetchAll(() => sb.from('design_versions').select('id, job_id, chosen, source'));
        const matRows = await fetchAll(() => sb.from('job_materials').select('*').order('created_at'));
        const matsBy = {};
        matRows.forEach((m) => { (matsBy[m.job_id] ||= []).push(mapMaterial(m)); });
        const billRows = u.role === 'staff' ? await fetchAll(() => sb.from('crew_bills').select('*').order('created_at')) : [];
        const billsBy = {};
        billRows.forEach((b) => { (billsBy[b.job_id] ||= []).push(mapBill(b)); });
        const designsBy = {};
        designRows.forEach((v) => { (designsBy[v.job_id] ||= []).push({ id: v.id, chosen: v.chosen, source: v.source }); });
        const costBy = Object.fromEntries(costs.map((c) => [c.job_id, c.crew_pay]));
        const paidBy = Object.fromEntries(costs.filter((c) => c.crew_paid_date).map((c) => [c.job_id, { date: c.crew_paid_date, method: c.crew_paid_method || 'Other', note: c.crew_paid_note || '' }]));
        const notesBy = {};
        cnotes.forEach((n) => { (notesBy[n.job_id] ||= []).push({ id: n.id, at: ms(n.created_at) }); });
        const docsBy = {};
        papers.forEach((r) => { (docsBy[r.job_id] ||= []).push(mapDoc(r)); });
        const privBy = Object.fromEntries(priv.map((p) => [p.job_id, p]));
        const peopleBy = Object.fromEntries(people.map((p) => [p.id, p]));
        const filesBy = {};
        files.forEach((f) => { (filesBy[f.job_id] ||= []).push({ id: f.id, kind: f.kind }); });
        return jobs.map((j) => {
          const p = privBy[j.id] || {};
          return {
            id: j.id, number: j.number, buyerId: j.buyer_id, trade: j.trade, status: j.status, created: ms(j.created_at),
            description: j.description, address: j.address, zip: j.zip, state: j.state || '', timeframe: j.timeframe, budget: j.budget, photos: [],
            contractorId: j.contractor_id, scheduledFor: local16(j.scheduled_for), visitAt: local16(j.visit_at),
            permit: { status: j.permit_status || 'none', number: j.permit_number || '', authorizedBy: j.permit_authorized_by || '', authorizedAt: ms(j.permit_authorized_at) || null,
              portalUrl: p.permit_portal || '', fee: p.permit_fee == null ? null : Number(p.permit_fee) },
            designs: designsBy[j.id] || [], crewBills: billsBy[j.id] || [], materials: matsBy[j.id] || [], style: j.style || '',
            review: j.review_requested_at || j.review_rating ? { requestedAt: ms(j.review_requested_at), requestedBy: j.review_requested_by || '', rating: j.review_rating || null, comment: j.review_comment || '', at: ms(j.review_at) } : null,
            salesId: j.sales_id || null,
            price: num(p.price), crewPay: num(costBy[j.id]), crewPaid: paidBy[j.id] || null, notes: p.notes || '', crewToken: p.crew_token || null,
            files: filesBy[j.id] || [], docs: docsBy[j.id] || [],
            crewNotes: notesBy[j.id] || [], crewNotesSeenAt: ms(p.crew_notes_seen_at) || 0,
            buyer: peopleBy[j.buyer_id] || { name: j.contact_name || 'Unknown', email: j.contact_email || '', phone: j.contact_phone || '' },
            hasAccount: !!j.buyer_id,
            stage: j.stage || null, progressAt: ms(j.progress_at), progressBy: j.progress_by || '', progressByCrew: !!j.progress_by_crew,
            crewResponse: j.crew_response || null, crewResponseNote: j.crew_response_note || '',
            startedAt: ms(j.started_at), finishedAt: ms(j.finished_at),
          };
        });
      },
      async crewNotes(id) {
        const u = await requireOffice();
        const rows = must(await sb.from('crew_notes').select('id, by_name, text, created_at').eq('job_id', id).order('created_at', { ascending: false }));
        if (u.role === 'staff') await sb.from('job_private').update({ crew_notes_seen_at: new Date().toISOString() }).eq('job_id', id);
        return rows.map((n) => ({ id: n.id, at: ms(n.created_at), by: n.by_name, text: n.text }));
      },
      // Office: enter a job for a customer who called in; optionally assign crew and date.
      async createForCustomer(input) {
        const staff = await requireOffice();
        const isSales = staff.role === 'sales';
        const name = String(input.name || '').trim();
        const phone = String(input.phone || '').trim();
        const email = normEmail(input.email);
        if (!name) throw new Error('Enter the customer’s name.');
        if (phone.replace(/\D/g, '').length < 10 && !/^\S+@\S+\.\S+$/.test(email)) throw new Error('Enter a phone number (with area code) or an email so you can reach them.');
        if (String(input.description || '').trim().length < 5) throw new Error('Describe the job in a few words.');
        if (!String(input.address || '').trim()) throw new Error('Enter the job address.');
        const scheduled = !isSales && input.contractorId && input.scheduledFor;
        const row = must(await sb.from('jobs').insert({
          buyer_id: input.customerId || null,
          contact_name: input.customerId ? '' : name, contact_phone: input.customerId ? '' : phone, contact_email: input.customerId ? '' : email,
          entered_by: staff.name || 'Office',
          trade: input.trade || 'other', description: input.description.trim(), address: input.address.trim(), zip: String(input.zip || '').trim(),
          state: String(input.state || TH.stateFromZip(input.zip) || '').toUpperCase(),
          timeframe: input.timeframe || '', status: scheduled ? 'scheduled' : input.agreed ? 'hot' : 'qualifying',
          contractor_id: isSales ? null : input.contractorId || null, scheduled_for: isSales ? null : input.scheduledFor || null,
          sales_id: isSales ? staff.salesId : input.salesId || null,
        }).select('id').single());
        if (input.price != null && input.price !== '') {
          const quote = '$' + Number(input.price).toLocaleString();
          must(await sb.from('job_private').update({ price: Number(input.price) }).eq('job_id', row.id));
          await sb.rpc('log_call', { p_job: row.id, p_outcome: input.agreed ? 'Agreed to the price' : 'Phone estimate', p_note: 'Phone estimate ' + quote });
        }
        return row.id;
      },
      async authorizePermit(jobId, name) {
        if (!(await me())) throw new Error('Please log in.');
        must(await sb.rpc('authorize_permit', { p_job: jobId, p_name: name || '' }));
      },
      async crewBill(jobId, billId, action, opts = {}) {
        await requireStaff();
        must(await sb.rpc('staff_crew_bill', { p_bill: billId, p_action: action, p_reason: opts.reason || '', p_date: opts.date || null, p_method: opts.method || '' }));
      },
      async logCall(id, outcome, note = '') {
        await requireOffice();
        if (!outcome) throw new Error('Pick how the call went.');
        must(await sb.rpc('log_call', { p_job: id, p_outcome: outcome, p_note: note || '' }));
      },
      async log(id) {
        await requireOffice();
        const rows = await fetchAll(() => sb.from('job_events').select('at, text').eq('job_id', id).order('at').order('id'));
        return rows.map((r) => ({ at: ms(r.at), text: r.text }));
      },
      async update(id, patch) {
        await requireOffice();
        const jobPatch = {}, privPatch = {};
        if ('salesId' in patch) jobPatch.sales_id = patch.salesId || null;
        if ('state' in patch) jobPatch.state = String(patch.state || '').toUpperCase();
        if ('status' in patch) jobPatch.status = patch.status;
        if ('stage' in patch) jobPatch.stage = patch.stage;
        if ('status' in patch || 'stage' in patch) {
          const staff = await me();
          Object.assign(jobPatch, { progress_at: new Date().toISOString(), progress_by: staff.name || 'Office', progress_by_crew: false });
        }
        if ('contractorId' in patch) jobPatch.contractor_id = patch.contractorId;
        if ('scheduledFor' in patch) jobPatch.scheduled_for = patch.scheduledFor;
        if ('visitAt' in patch) jobPatch.visit_at = patch.visitAt || null;
        if (patch.permit) {
          const pm = patch.permit;
          if ('status' in pm) jobPatch.permit_status = pm.status;
          if ('number' in pm) jobPatch.permit_number = String(pm.number || '').trim();
          if ('portalUrl' in pm) {
            if (pm.portalUrl && !/^https?:\/\//i.test(pm.portalUrl)) throw new Error('The building department link must start with https://');
            privPatch.permit_portal = pm.portalUrl || '';
          }
          if ('fee' in pm) privPatch.permit_fee = pm.fee === '' || pm.fee == null ? null : Number(pm.fee);
        }
        if ('price' in patch) privPatch.price = patch.price;
        if ('crewPay' in patch) must(await sb.from('job_costs').update({ crew_pay: patch.crewPay }).eq('job_id', id));
        if ('crewPaid' in patch) {
          const cp = patch.crewPaid;
          if (cp && !/^\d{4}-\d{2}-\d{2}$/.test(cp.date || '')) throw new Error('Pick the date you paid the crew.');
          must(await sb.from('job_costs').update(cp ? { crew_paid_date: cp.date, crew_paid_method: String(cp.method || 'Other').slice(0, 40), crew_paid_note: String(cp.note || '').trim().slice(0, 200) }
            : { crew_paid_date: null, crew_paid_method: '', crew_paid_note: '' }).eq('job_id', id));
        }
        if ('notes' in patch) privPatch.notes = patch.notes;
        if (Object.keys(jobPatch).length) must(await sb.from('jobs').update(jobPatch).eq('id', id));
        if (Object.keys(privPatch).length) must(await sb.from('job_private').update(privPatch).eq('job_id', id));
      },
    },

    files: {
      async list(jobId) {
        await requireOffice();
        const rows = must(await sb.from('job_files').select('*').eq('job_id', jobId).order('uploaded_at'));
        const urls = await signedUrls(rows.map((r) => r.path));
        return rows.map((r) => mapFile(r, urls[r.path]));
      },
      async upload(jobId, file, kind) {
        const u = await requireOffice();
        tooBig(file);
        const path = `${jobId}/staff/${rid()}-${safeName(file.name)}`;
        await upload(path, file);
        const { error } = await sb.from('job_files').insert({
          job_id: jobId, path, name: file.name, mime: file.type || 'application/octet-stream', size: file.size,
          kind: kind || guessKind(file.name, file.type || ''), source: 'staff', by_name: u.name,
        });
        if (error) { await sb.storage.from(BUCKET).remove([path]); throw new Error(friendly(error)); }
      },
      async update(jobId, fileId, patch) {
        await requireOffice();
        const p = {};
        if ('kind' in patch) p.kind = patch.kind;
        if ('shared' in patch) p.shared = patch.shared;
        must(await sb.from('job_files').update(p).eq('id', fileId));
      },
      async remove(jobId, fileId) {
        await requireOffice();
        const row = must(await sb.from('job_files').select('path').eq('id', fileId).maybeSingle());
        if (!row) return;
        must(await sb.from('job_files').delete().eq('id', fileId));
        await sb.storage.from(BUCKET).remove([row.path]);
      },
      async forCustomer(jobId) {
        const j = mine.get(jobId);
        if (!j) return [];
        const list = j.shared_files || [];
        const urls = await signedUrls(list.map((f) => f.path));
        return list.map((f) => ({ id: f.id, name: f.name, kind: f.kind, size: Number(f.size) || 0, uploaded: ms(f.uploaded_at), url: urls[f.path] || null }));
      },
    },

    settings: {
      async get() {
        const { data } = await sb.from('settings').select('data').eq('id', 1).maybeSingle();
        return { ...DEFAULT_SETTINGS, ...((data && data.data) || {}) };
      },
      async save(patch) {
        await requireStaff();
        const current = await api.settings.get();
        const next = { ...current, ...patch };
        must(await sb.from('settings').update({ data: next, updated_at: new Date().toISOString() }).eq('id', 1));
        return next;
      },
    },

    docs: {
      async list(jobId) {
        await requireOffice();
        return must(await sb.from('documents').select('*, reports:payment_reports(id, amount, method, note, reported_by, created_at, status, signature)').eq('job_id', jobId).order('created_at')).map(mapDoc);
      },
      async save(jobId, doc) {
        await requireOffice();
        const row = {
          items: (doc.items || []).map((i) => ({ desc: String(i.desc || '').trim(), qty: Number(i.qty) || 0, price: Number(i.price) || 0 })),
          tax_rate: Number(doc.taxRate) || 0, notes: doc.notes || '', due_date: doc.dueDate || null, pay_link: (doc.payLink || '').trim(),
        };
        if (row.pay_link && !/^https:\/\//i.test(row.pay_link)) throw new Error('The card payment link must start with https://');
        if (doc.id) return mapDoc(must(await sb.from('documents').update(row).eq('id', doc.id).select().single()));
        const step = doc.type === 'invoice' && Number.isInteger(doc.scheduleStep) ? doc.scheduleStep : null;
        return mapDoc(must(await sb.from('documents').insert({ ...row, job_id: jobId, type: doc.type, from_estimate: doc.fromEstimateId || null, number: 'pending',
          schedule_step: step, schedule_base: step == null ? null : Number(doc.scheduleBase) || 0 }).select().single()));
      },
      async send(jobId, docId) {
        await requireOffice();
        const r = await getDoc(docId);
        if (!(r.items || []).some((i) => i.desc && i.qty && i.price)) throw new Error('Add at least one line with a description, quantity and price.');
        must(await sb.from('documents').update({ status: 'sent' }).eq('id', docId));
      },
      async setStatus(jobId, docId, status, sig) {
        const u = await requireOffice();
        const row = { status, responded_at: new Date().toISOString(), responded_by: `${u.name} (office)` };
        if (status === 'approved' && sig) {
          row.signature = { name: String(sig.name || '').trim(), image: sig.image, at: new Date().toISOString(), in_person: true, witness: u.name };
          row.responded_by = `${row.signature.name} (signed in person)`;
        }
        must(await sb.from('documents').update(row).eq('id', docId));
      },
      async sign(docId, sig) {
        if (!(await me())) throw new Error('Please log in.');
        must(await sb.rpc('sign_document', { p_doc: docId, p_sig_name: String(sig?.name || ''), p_sig_image: sig?.image || '' }));
      },
      async reportPayment(docId, p) {
        if (!(await me())) throw new Error('Please log in.');
        must(await sb.rpc('report_payment', { p_doc: docId, p_amount: Number(p.amount) || 0, p_method: p.method || 'Other', p_note: p.note || '',
          p_sig_name: p.signature?.name || null, p_sig_image: p.signature?.image || null }));
      },
      async resolveReport(jobId, docId, reportId, received) {
        await requireStaff();
        must(await sb.rpc('resolve_payment_report', { p_report: reportId, p_received: !!received }));
      },
      async remove(jobId, docId) {
        await requireOffice();
        must(await sb.from('documents').delete().eq('id', docId));
      },
      async addPayment(jobId, docId, p) {
        await requireStaff();
        const amount = Math.round(Number(p.amount) * 100) / 100;
        if (!(amount > 0)) throw new Error('Enter the amount received.');
        const r = await getDoc(docId);
        const payments = [...(r.payments || []), { id: rid(), amount, method: p.method || 'Other', date: p.date || new Date().toISOString().slice(0, 10), note: (p.note || '').trim() }];
        must(await sb.from('documents').update({ payments }).eq('id', docId));
      },
      async removePayment(jobId, docId, paymentId) {
        await requireStaff();
        const r = await getDoc(docId);
        must(await sb.from('documents').update({ payments: (r.payments || []).filter((x) => x.id !== paymentId) }).eq('id', docId));
      },
      async mine() {
        if (!(await me())) return {};
        const byJob = must(await sb.rpc('my_documents')) || {};
        return Object.fromEntries(Object.entries(byJob).map(([k, list]) => [k, list.map(mapDoc)]));
      },
      async respond(docId, approve, sig) {
        must(await sb.rpc('respond_estimate', { p_doc: docId, p_approve: !!approve, p_sig_name: sig?.name || null, p_sig_image: sig?.image || null }));
      },
    },

    crew: {
      async job(token) {
        if (!token) return null;
        const j = must(await sb.rpc('crew_job', { p_token: token }));
        if (!j) return null;
        const urls = await signedUrls((j.uploads || []).map((f) => f.path));
        return {
          number: j.number, trade: j.trade, status: j.status, address: j.address, zip: j.zip, state: j.state || '', description: j.description,
          scheduledFor: local16(j.scheduled_for), customerName: j.customer_name || '', customerPhone: j.customer_phone || '',
          crewName: j.crew_name || '',
          uploads: (j.uploads || []).map((f) => ({ id: f.id, name: f.name, mime: f.mime, stage: f.stage, note: f.note, uploaded: ms(f.uploaded_at), url: urls[f.path] || null })),
          notes: (j.notes || []).map((n) => ({ id: n.id, at: ms(n.created_at), text: n.text })),
        };
      },
      async addNote(token, text) {
        must(await sb.rpc('crew_add_note', { p_token: token, p_job: null, p_text: text }));
      },
      async upload(token, file, { stage = '', note = '' } = {}) {
        tooBig(file);
        const path = `crew/${token}/${rid()}-${safeName(file.name)}`;
        try { await upload(path, file); }
        catch (e) { throw new Error(/access/i.test(e.message) ? 'This upload link is no longer active. Ask the Top Hat office for a new one.' : e.message); }
        must(await sb.rpc('crew_add_file', { p_token: token, p_path: path, p_name: file.name, p_mime: file.type || '', p_size: file.size, p_stage: stage, p_note: note }));
      },
    },

    materials: {
      async add(jobId, { name, qty = '', note = '' } = {}) {
        const u = await me(); if (!u) throw new Error('Please log in.');
        if (String(name || '').trim().length < 2) throw new Error('What material is it?');
        if (u.role === 'crew') return { id: must(await sb.rpc('crew_material_add', { p_job: jobId, p_name: name, p_qty: qty, p_note: note })) };
        const row = must(await sb.from('job_materials').insert({ job_id: jobId, name: String(name).trim().slice(0, 120), qty: String(qty || '').trim().slice(0, 40), note: String(note || '').trim().slice(0, 300), added_by: u.name || '', updated_by: u.name || '' }).select().single());
        return mapMaterial(row);
      },
      async update(jobId, id, patch = {}) {
        const u = await me(); if (!u) throw new Error('Please log in.');
        if (u.role === 'crew') {
          if (patch.status !== 'delivered' || Object.keys(patch).length !== 1) throw new Error('The office orders materials. You can mark them delivered.');
          must(await sb.rpc('crew_material_delivered', { p_item: id })); return;
        }
        const row = { updated_by: u.name || '', updated_at: new Date().toISOString() };
        if ('status' in patch) row.status = patch.status;
        if ('eta' in patch) row.eta = /^\d{4}-\d{2}-\d{2}$/.test(patch.eta || '') ? patch.eta : null;
        if ('note' in patch) row.note = String(patch.note || '').trim().slice(0, 300);
        if ('qty' in patch) row.qty = String(patch.qty || '').trim().slice(0, 40);
        must(await sb.from('job_materials').update(row).eq('id', id).eq('job_id', jobId));
      },
      async remove(jobId, id) {
        const u = await me(); if (!u || u.role === 'crew') throw new Error('Ask the office to remove it.');
        must(await sb.from('job_materials').delete().eq('id', id).eq('job_id', jobId));
      },
    },
    reviews: {
      async ask(jobId) { must(await sb.rpc('office_ask_review', { p_job: jobId })); },
      async leave(jobId, rating, comment = '') { must(await sb.rpc('customer_review', { p_job: jobId, p_rating: Math.round(Number(rating)) || null, p_comment: comment || '' })); },
    },

    contractors: {
      async list() {
        const u = await requireOffice();
        // Salespeople pick crews from a safe list: names, phones and trades (no logins or invite links).
        if (u.role !== 'staff') return (must(await sb.rpc('office_crew_list')) || []).map((c) => ({ id: c.id, name: c.name, phone: c.phone, trades: c.trades || [], active: c.active, state: c.state || '' }));
        const rows = await fetchAll(() => sb.from('contractors').select('*').order('name'));
        const ids = rows.map((c) => c.user_id).filter(Boolean);
        const emails = ids.length ? Object.fromEntries(must(await sb.from('profiles').select('id, email').in('id', ids)).map((p) => [p.id, p.email])) : {};
        return rows.map((c) => ({
          id: c.id, name: c.name, phone: c.phone, trades: c.trades || [], active: c.active, state: c.state || '',
          login: c.user_id ? 'active' : c.invite_code ? 'invited' : 'none', inviteCode: c.invite_code || null, loginEmail: emails[c.user_id] || '',
        }));
      },
      async save(c) {
        await requireStaff();
        if (!c.name || !c.name.trim()) throw new Error('Contractor needs a name.');
        const st = String(c.state || '').toUpperCase();
        const row = { name: c.name.trim(), phone: (c.phone || '').trim(), trades: c.trades || [], active: c.active !== false, state: TH.US_STATES.some(([x]) => x === st) ? st : '' };
        if (c.id) must(await sb.from('contractors').update(row).eq('id', c.id));
        else must(await sb.from('contractors').insert(row));
      },
      async remove(id) {
        await requireStaff();
        must(await sb.rpc('staff_revoke_crew', { p_contractor: id }));
        must(await sb.from('contractors').delete().eq('id', id));
      },
      async invite(id) {
        await requireStaff();
        return must(await sb.rpc('staff_invite_crew', { p_contractor: id }));
      },
      async revokeLogin(id) {
        await requireStaff();
        must(await sb.rpc('staff_revoke_crew', { p_contractor: id }));
      },
    },

    // Design studio: the design Edge Function checks access, calls the image AI with the server's key,
    // and stores the pictures. The key never reaches the browser.
    designs: {
      async list(jobId) { return ((await designCall({ action: 'list', job: jobId })).versions || []).map(mapDesign); },
      async addPhoto(jobId, photo) {
        const image = photo instanceof Blob ? await TH.shrinkImage(photo, 1280, 0.82) : photo;
        return mapDesign((await designCall({ action: 'photo', job: jobId, image })).version);
      },
      async generate(jobId, fromId, prompt) {
        if (String(prompt || '').trim().length < 3) throw new Error('Tell us what you want changed.');
        return mapDesign((await designCall({ action: 'generate', job: jobId, from: fromId, prompt })).version);
      },
      async choose(jobId, id) { await designCall({ action: 'choose', job: jobId, id }); },
      // Sign-up preview: works before they have an account (the server limits how many per day).
      async dream(photo, styleKey, extra = '') {
        if (!TH.styleOf(styleKey)) throw new Error('Pick a look first.');
        const r = await designCall({ action: 'dream', image: photo, style: styleKey, extra: String(extra || '').slice(0, 200) });
        return r.image;
      },
      async adopt(jobId, photo, image, prompt) { await designCall({ action: 'adopt', job: jobId, photo, image, prompt: prompt || '' }); },
    },

    crewPortal: {
      async inviteInfo(code) {
        if (!code || code.length < 32) return null;
        return must(await sb.rpc('crew_invite_info', { p_code: code })) || null;
      },
      async acceptInvite(code, { email, password }) {
        const info = await api.crewPortal.inviteInfo(code);
        if (!info) throw new Error('This invite link has already been used or was cancelled. Ask the office for a new one.');
        email = normEmail(email);
        if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Please enter a valid email address.');
        if (!password || password.length < 8) throw new Error('Password must be at least 8 characters.');
        const data = must(await sb.auth.signUp({ email, password, options: { data: { name: info.name } } }));
        if (!data.session) {
          if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
            throw new Error('That email already has an account. Use a different email, or ask the office.');
          }
          throw new Error('Check your email for a link to confirm your address, then open this invite again.');
        }
        const { error } = await sb.rpc('claim_crew_invite', { p_code: code });
        if (error) { await sb.auth.signOut(); profile = null; throw new Error(friendly(error)); }
        profile = null;
        return me();
      },
      async jobs() {
        const list = must(await sb.rpc('crew_my_jobs')) || [];
        const photoUrls = await signedUrls(list.flatMap((j) => [...(j.customer_photos || []), ...(j.uploads || []).map((f) => f.path)]));
        return list.map((j) => ({
          crewResponse: j.crew_response || null, crewResponseNote: j.crew_response_note || '',
          startedAt: ms(j.started_at), finishedAt: ms(j.finished_at),
          customerPhotos: (j.customer_photos || []).map((pth) => photoUrls[pth]).filter(Boolean),
          id: j.id, number: j.number, trade: j.trade, status: j.status, scheduledFor: local16(j.scheduled_for),
          address: j.address, zip: j.zip, state: j.state || '', description: j.description,
          customerName: j.customer_name || '', customerPhone: j.customer_phone || '',
          stage: j.stage || null, progressAt: ms(j.progress_at), progressBy: j.progress_by || '',
          crewToken: j.crew_token || null, crewPay: num(j.crew_pay), photos: Number(j.photos) || 0,
          uploads: (j.uploads || []).map((f) => ({ name: f.name, stage: f.stage || '', mime: f.mime || '', uploaded: ms(f.uploaded_at), url: photoUrls[f.path] || null })),
          crewPaid: j.crew_paid_date ? { date: j.crew_paid_date, method: j.crew_paid_method || 'Other' } : null,
          crewBills: (j.bills || []).map(mapBill), halfwayAt: ms(j.halfway_at), style: j.style || '', materials: (j.materials || []).map(mapMaterial),
          notes: (j.notes || []).map((n) => ({ id: n.id, at: ms(n.created_at), text: n.text })),
        }));
      },
      async halfway(jobId) { must(await sb.rpc('crew_halfway', { p_job: jobId })); },
      async bill(jobId, { step = null, amount = null, note = '', photos = [], token = '' } = {}) {
        photos = [...(photos || [])];
        if (!photos.length) throw new Error('Add at least one photo of the work so the office can see what you did.');
        if (photos.length > 12) throw new Error('Send up to 12 photos with a bill.');
        if (!token) throw new Error('Ask the office to reassign this job to you, then try again.');
        photos.forEach(tooBig);
        // Upload the photos into the job's files first; the bill then claims them.
        const paths = [];
        for (const f of photos) {
          const path = `crew/${token}/${rid()}-${safeName(f.name || 'photo.jpg')}`;
          await upload(path, f);
          must(await sb.rpc('crew_add_file', { p_token: token, p_path: path, p_name: f.name || 'photo.jpg', p_mime: f.type || 'image/jpeg', p_size: f.size, p_stage: '', p_note: 'Bill photo' }));
          paths.push(path);
        }
        const r = must(await sb.rpc('crew_bill', { p_job: jobId, p_step: step, p_amount: amount == null || amount === '' ? null : Number(amount), p_note: note || '', p_paths: paths }));
        return { ...r, amount: Number(r.amount) };
      },
      async addNote(jobId, text) {
        must(await sb.rpc('crew_add_note', { p_token: null, p_job: jobId, p_text: text }));
      },
      async setProgress(jobId, { status, stage } = {}) {
        must(await sb.rpc('crew_set_progress', { p_job: jobId, p_status: status || null, p_stage: stage === undefined ? null : stage }));
      },
      async setStatus(jobId, status) { return api.crewPortal.setProgress(jobId, { status }); },
      async respond(jobId, response, note = '') {
        must(await sb.rpc('crew_respond', { p_job: jobId, p_response: response, p_note: note || '' }));
      },
    },

    team: {
      async list() {
        const u = await requireOffice();
        const rows = await fetchAll(() => sb.from('salespeople').select('*').order('name'));
        const ids = rows.map((x) => x.user_id).filter(Boolean);
        const emails = u.role === 'staff' && ids.length ? Object.fromEntries(must(await sb.from('profiles').select('id, email').in('id', ids)).map((p) => [p.id, p.email])) : {};
        return rows.map((x) => ({ id: x.id, name: x.name, phone: x.phone, active: x.active,
          login: x.user_id ? 'active' : x.invite_code ? 'invited' : 'none', inviteCode: x.invite_code || null, loginEmail: emails[x.user_id] || '' }));
      },
      async save(x) {
        await requireStaff();
        if (!x.name || !x.name.trim()) throw new Error('Salesperson needs a name.');
        const row = { name: x.name.trim(), phone: (x.phone || '').trim(), active: x.active !== false };
        if (x.id) must(await sb.from('salespeople').update(row).eq('id', x.id));
        else must(await sb.from('salespeople').insert(row));
      },
      async remove(id) {
        await requireStaff();
        must(await sb.rpc('staff_revoke_sales', { p_sales: id }));
        must(await sb.from('salespeople').delete().eq('id', id));
      },
      async invite(id) { await requireStaff(); return must(await sb.rpc('staff_invite_sales', { p_sales: id })); },
      async revokeLogin(id) { await requireStaff(); must(await sb.rpc('staff_revoke_sales', { p_sales: id })); },
      // Everything happening on a salesperson's clients, newest first.
      async activity(id) {
        await requireStaff();
        const jobs = must(await sb.from('jobs').select('id, number, buyer_id, contact_name').eq('sales_id', id));
        if (!jobs.length) return { events: [] };
        const people = Object.fromEntries((must(await sb.from('profiles').select('id, name').in('id', jobs.map((j) => j.buyer_id).filter(Boolean)))).map((p) => [p.id, p.name]));
        const byId = Object.fromEntries(jobs.map((j) => [j.id, j]));
        const rows = must(await sb.from('job_events').select('job_id, at, text').in('job_id', jobs.map((j) => j.id)).order('at', { ascending: false }).limit(60));
        return { events: rows.map((r) => ({ at: ms(r.at), text: r.text, jobId: r.job_id, number: byId[r.job_id].number,
          customer: people[byId[r.job_id].buyer_id] || byId[r.job_id].contact_name || 'Customer' })) };
      },
      async inviteInfo(code) {
        if (!code || code.length < 32) return null;
        return must(await sb.rpc('sales_invite_info', { p_code: code })) || null;
      },
      async acceptInvite(code, { email, password }) {
        const info = await api.team.inviteInfo(code);
        if (!info) throw new Error('This invite link has already been used or was cancelled. Ask the office for a new one.');
        email = normEmail(email);
        if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Please enter a valid email address.');
        if (!password || password.length < 8) throw new Error('Password must be at least 8 characters.');
        const data = must(await sb.auth.signUp({ email, password, options: { data: { name: info.name } } }));
        if (!data.session) throw new Error('That email already has an account, or needs confirming. Use a different email, or ask the office.');
        const { error } = await sb.rpc('claim_sales_invite', { p_code: code });
        if (error) { await sb.auth.signOut(); profile = null; throw new Error(friendly(error)); }
        profile = null;
        return me();
      },
    },

    async resetPreview() { /* preview only */ },
  };

  TH.api = api;
})();
