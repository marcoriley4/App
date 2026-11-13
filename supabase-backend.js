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
    shared: !!r.shared, uploaded: ms(r.uploaded_at), by: r.by_name, source: r.source, url: url || null,
  });

  const mapDoc = (r) => ({
    id: r.id, type: r.type, number: r.number, status: r.status, items: r.items || [], taxRate: Number(r.tax_rate) || 0,
    notes: r.notes || '', dueDate: r.due_date || null, payLink: r.pay_link || '', payments: r.payments || [],
    created: ms(r.created_at), sentAt: ms(r.sent_at), respondedAt: ms(r.responded_at), respondedBy: r.responded_by || '',
    fromEstimateId: r.from_estimate || null,
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
    const { data: p } = await sb.from('profiles').select('id, role, name, email, phone').eq('id', user.id).maybeSingle();
    profile = p || { id: user.id, role: 'buyer', name: user.user_metadata?.name || '', email: user.email, phone: user.user_metadata?.phone || '' };
    return profile;
  }
  async function requireStaff() {
    const u = await me();
    if (!u || u.role !== 'staff') throw new Error('Please log in as Top Hat staff.');
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
          p_zip: job.zip || '', p_timeframe: job.timeframe || '', p_budget: job.budget || '',
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
          description: j.description, address: j.address, zip: j.zip || '', timeframe: j.timeframe, budget: j.budget, photos: [],
          scheduledFor: local16(j.scheduled_for), contractorName: j.contractor_name || null,
          sharedFiles: (j.shared_files || []).length,
        }));
      },
      async all() {
        await requireStaff();
        const [jobs, priv, files, people, papers] = await Promise.all([
          fetchAll(() => sb.from('jobs').select('*').order('created_at', { ascending: false })),
          fetchAll(() => sb.from('job_private').select('*')),
          fetchAll(() => sb.from('job_files').select('id, job_id, kind')),
          fetchAll(() => sb.from('profiles').select('id, name, email, phone')),
          fetchAll(() => sb.from('documents').select('id, job_id, type, number, status, items, tax_rate, due_date, payments')),
        ]);
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
            description: j.description, address: j.address, zip: j.zip, timeframe: j.timeframe, budget: j.budget, photos: [],
            contractorId: j.contractor_id, scheduledFor: local16(j.scheduled_for),
            price: num(p.price), crewPay: num(p.crew_pay), notes: p.notes || '', crewToken: p.crew_token || null,
            files: filesBy[j.id] || [], docs: docsBy[j.id] || [],
            buyer: peopleBy[j.buyer_id] || { name: 'Unknown', email: '', phone: '' },
          };
        });
      },
      async log(id) {
        await requireStaff();
        const rows = await fetchAll(() => sb.from('job_events').select('at, text').eq('job_id', id).order('at').order('id'));
        return rows.map((r) => ({ at: ms(r.at), text: r.text }));
      },
      async update(id, patch) {
        await requireStaff();
        const jobPatch = {}, privPatch = {};
        if ('status' in patch) jobPatch.status = patch.status;
        if ('contractorId' in patch) jobPatch.contractor_id = patch.contractorId;
        if ('scheduledFor' in patch) jobPatch.scheduled_for = patch.scheduledFor;
        if ('price' in patch) privPatch.price = patch.price;
        if ('crewPay' in patch) privPatch.crew_pay = patch.crewPay;
        if ('notes' in patch) privPatch.notes = patch.notes;
        if (Object.keys(jobPatch).length) must(await sb.from('jobs').update(jobPatch).eq('id', id));
        if (Object.keys(privPatch).length) must(await sb.from('job_private').update(privPatch).eq('job_id', id));
      },
    },

    files: {
      async list(jobId) {
        await requireStaff();
        const rows = must(await sb.from('job_files').select('*').eq('job_id', jobId).order('uploaded_at'));
        const urls = await signedUrls(rows.map((r) => r.path));
        return rows.map((r) => mapFile(r, urls[r.path]));
      },
      async upload(jobId, file, kind) {
        const u = await requireStaff();
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
        await requireStaff();
        const p = {};
        if ('kind' in patch) p.kind = patch.kind;
        if ('shared' in patch) p.shared = patch.shared;
        must(await sb.from('job_files').update(p).eq('id', fileId));
      },
      async remove(jobId, fileId) {
        await requireStaff();
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
        await requireStaff();
        return must(await sb.from('documents').select('*').eq('job_id', jobId).order('created_at')).map(mapDoc);
      },
      async save(jobId, doc) {
        await requireStaff();
        const row = {
          items: (doc.items || []).map((i) => ({ desc: String(i.desc || '').trim(), qty: Number(i.qty) || 0, price: Number(i.price) || 0 })),
          tax_rate: Number(doc.taxRate) || 0, notes: doc.notes || '', due_date: doc.dueDate || null, pay_link: (doc.payLink || '').trim(),
        };
        if (row.pay_link && !/^https:\/\//i.test(row.pay_link)) throw new Error('The card payment link must start with https://');
        if (doc.id) return mapDoc(must(await sb.from('documents').update(row).eq('id', doc.id).select().single()));
        return mapDoc(must(await sb.from('documents').insert({ ...row, job_id: jobId, type: doc.type, from_estimate: doc.fromEstimateId || null, number: 'pending' }).select().single()));
      },
      async send(jobId, docId) {
        await requireStaff();
        const r = await getDoc(docId);
        if (!(r.items || []).some((i) => i.desc && i.qty && i.price)) throw new Error('Add at least one line with a description, quantity and price.');
        must(await sb.from('documents').update({ status: 'sent' }).eq('id', docId));
      },
      async setStatus(jobId, docId, status) {
        const u = await requireStaff();
        must(await sb.from('documents').update({ status, responded_at: new Date().toISOString(), responded_by: `${u.name} (office)` }).eq('id', docId));
      },
      async remove(jobId, docId) {
        await requireStaff();
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
      async respond(docId, approve) {
        must(await sb.rpc('respond_estimate', { p_doc: docId, p_approve: !!approve }));
      },
    },

    crew: {
      async job(token) {
        if (!token) return null;
        const j = must(await sb.rpc('crew_job', { p_token: token }));
        if (!j) return null;
        const urls = await signedUrls((j.uploads || []).map((f) => f.path));
        return {
          number: j.number, trade: j.trade, status: j.status, address: j.address, zip: j.zip, description: j.description,
          scheduledFor: local16(j.scheduled_for), customerName: j.customer_name || '', customerPhone: j.customer_phone || '',
          crewName: j.crew_name || '',
          uploads: (j.uploads || []).map((f) => ({ id: f.id, name: f.name, mime: f.mime, stage: f.stage, note: f.note, uploaded: ms(f.uploaded_at), url: urls[f.path] || null })),
        };
      },
      async upload(token, file, { stage = '', note = '' } = {}) {
        tooBig(file);
        const path = `crew/${token}/${rid()}-${safeName(file.name)}`;
        try { await upload(path, file); }
        catch (e) { throw new Error(/access/i.test(e.message) ? 'This upload link is no longer active. Ask the Top Hat office for a new one.' : e.message); }
        must(await sb.rpc('crew_add_file', { p_token: token, p_path: path, p_name: file.name, p_mime: file.type || '', p_size: file.size, p_stage: stage, p_note: note }));
      },
    },

    contractors: {
      async list() {
        await requireStaff();
        const rows = await fetchAll(() => sb.from('contractors').select('*').order('name'));
        return rows.map((c) => ({ id: c.id, name: c.name, phone: c.phone, trades: c.trades || [], active: c.active }));
      },
      async save(c) {
        await requireStaff();
        if (!c.name || !c.name.trim()) throw new Error('Contractor needs a name.');
        const row = { name: c.name.trim(), phone: (c.phone || '').trim(), trades: c.trades || [], active: c.active !== false };
        if (c.id) must(await sb.from('contractors').update(row).eq('id', c.id));
        else must(await sb.from('contractors').insert(row));
      },
      async remove(id) {
        await requireStaff();
        must(await sb.from('contractors').delete().eq('id', id));
      },
    },

    async resetPreview() { /* preview only */ },
  };

  TH.api = api;
})();
