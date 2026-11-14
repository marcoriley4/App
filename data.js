'use strict';
/*
 * Data layer for Top Hat Contracting.
 *
 * Every screen talks to the app only through `TH.api` below. Right now it is
 * backed by the browser's localStorage ("preview mode") so the whole flow can
 * be tried on one device. To go live, swap in a backend with the same methods
 * (e.g. Supabase) and nothing in the screens has to change.
 */
(function () {
  const DB_KEY = 'tophat.db.v1';
  const SESSION_KEY = 'tophat.session.v1';

  const TRADES = [
    { id: 'plumbing', label: 'Plumbing', icon: '🚰' },
    { id: 'electrical', label: 'Electrical', icon: '💡' },
    { id: 'roofing', label: 'Roofing', icon: '🏠' },
    { id: 'hvac', label: 'Heating & AC', icon: '❄️' },
    { id: 'painting', label: 'Painting', icon: '🎨' },
    { id: 'drywall', label: 'Drywall', icon: '🧱' },
    { id: 'flooring', label: 'Flooring', icon: '🪵' },
    { id: 'remodel', label: 'Remodel', icon: '🛠️' },
    { id: 'landscaping', label: 'Landscaping', icon: '🌳' },
    { id: 'other', label: 'Something else', icon: '📋' },
  ];

  const TIMEFRAMES = [
    { id: 'asap', label: 'As soon as possible' },
    { id: '2weeks', label: 'Within 2 weeks' },
    { id: 'month', label: 'Within a month' },
    { id: 'flexible', label: "I'm flexible" },
  ];

  const BUDGETS = [
    { id: '', label: 'Not sure yet' },
    { id: 'u1k', label: 'Under $1,000' },
    { id: '1-5k', label: '$1,000 – $5,000' },
    { id: '5-15k', label: '$5,000 – $15,000' },
    { id: '15k+', label: '$15,000+' },
  ];

  const FILE_KINDS = [
    { id: 'estimate', label: 'Estimate', icon: '📝' },
    { id: 'invoice', label: 'Invoice', icon: '🧾' },
    { id: 'contract', label: 'Contract', icon: '✍️' },
    { id: 'receipt', label: 'Receipt', icon: '🧮' },
    { id: 'permit', label: 'Permit', icon: '📜' },
    { id: 'photo', label: 'Photo', icon: '📷' },
    { id: 'other', label: 'Other', icon: '📎' },
  ];
  const MAX_FILE_MB = 15;

  // Internal pipeline status → what staff see, and what the buyer sees.
  const STATUSES = [
    { id: 'new', label: 'New lead', buyer: 'Received' },
    { id: 'qualifying', label: 'Qualifying', buyer: 'Reviewing' },
    { id: 'scheduled', label: 'Scheduled', buyer: 'Scheduled' },
    { id: 'in_progress', label: 'In progress', buyer: 'In progress' },
    { id: 'completed', label: 'Completed', buyer: 'Completed' },
    { id: 'lost', label: 'Not a fit', buyer: 'Closed' },
  ];

  // Extra detail on a job's progress, shared by the office and the crew.
  // Each fits one status: "On the way" before work starts; the two holds while working.
  const STAGES = [
    { id: 'on_the_way', label: 'On the way', icon: '🚚', status: 'scheduled', buyer: 'Your crew is on the way' },
    { id: 'waiting_parts', label: 'Waiting on materials', icon: '⏸', status: 'in_progress', buyer: 'Paused while we get materials' },
    { id: 'return_visit', label: 'Needs another visit', icon: '🔁', status: 'in_progress', buyer: 'We’ll be back to finish' },
  ];
  const CREW_STATUSES = ['scheduled', 'in_progress', 'completed'];
  // Apply a progress change (status and/or stage), log it, and remember who made it.
  function applyProgress(j, { status, stage }, who, byCrew) {
    const label = (st) => STATUSES.find((x) => x.id === st)?.label || st;
    const next = status || j.status;
    let nextStage = stage === undefined ? (status && status !== j.status ? null : j.stage || null) : stage;
    if (nextStage && STAGES.find((x) => x.id === nextStage)?.status !== next) nextStage = null;
    const tag = byCrew ? ` (by ${who}, crew)` : '';
    if (next !== j.status) j.log.push({ at: Date.now(), text: `Status → ${label(next)}${tag}` });
    if ((nextStage || null) !== (j.stage || null) && (nextStage || next === j.status)) {
      j.log.push({ at: Date.now(), text: nextStage ? `${STAGES.find((x) => x.id === nextStage).label}${tag || ` (by ${who})`}` : `Cleared “${STAGES.find((x) => x.id === j.stage)?.label}”${tag}` });
    }
    if (next !== j.status || (nextStage || null) !== (j.stage || null)) {
      j.status = next; j.stage = nextStage;
      j.progressAt = Date.now(); j.progressBy = who; j.progressByCrew = !!byCrew;
    }
  }

  /* ---------- storage ---------- */
  function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
  // Long random code for a job's private crew upload link (unguessable).
  function newToken() {
    const a = new Uint8Array(16);
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => { a[i] = Math.random() * 256; });
    return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  const PHOTO_STAGES = [
    { id: 'before', label: 'Before' },
    { id: 'during', label: 'During' },
    { id: 'after', label: 'After' },
  ];
  function readDb() {
    try {
      const raw = localStorage.getItem(DB_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* unavailable or corrupt */ }
    return null;
  }
  function writeDb(db) {
    try { localStorage.setItem(DB_KEY, JSON.stringify(db)); }
    catch (e) { throw new Error('Your browser storage is full. Try fewer or smaller photos.'); }
  }
  function getSession() { try { return localStorage.getItem(SESSION_KEY); } catch (e) { return null; } }
  function setSession(id) { try { id ? localStorage.setItem(SESSION_KEY, id) : localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ } }

  // File contents live in IndexedDB (much more room than localStorage).
  const blobs = (() => {
    let opening;
    const open = () => opening || (opening = new Promise((res, rej) => {
      const r = indexedDB.open('tophat-files', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('blobs');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
    const run = async (mode, fn) => {
      const conn = await open();
      return new Promise((res, rej) => {
        const t = conn.transaction('blobs', mode);
        const req = fn(t.objectStore('blobs'));
        const fail = () => rej(t.error || new Error('Could not save the file. Storage may be full.'));
        t.oncomplete = () => res(req && req.result);
        t.onerror = fail;
        t.onabort = fail;
      });
    };
    return {
      put: (k, v) => run('readwrite', (s) => s.put(v, k)),
      get: (k) => run('readonly', (s) => s.get(k)),
      del: (k) => run('readwrite', (s) => s.delete(k)),
      clear: () => run('readwrite', (s) => s.clear()),
    };
  })();

  function guessKind(name, mime) {
    const n = name.toLowerCase();
    if (/invoice|bill/.test(n)) return 'invoice';
    if (/estimate|quote|bid|proposal/.test(n)) return 'estimate';
    if (/contract|agreement|signed/.test(n)) return 'contract';
    if (/receipt/.test(n)) return 'receipt';
    if (/permit/.test(n)) return 'permit';
    if (/^image\//.test(mime)) return 'photo';
    return 'other';
  }

  async function hash(s) {
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return 'x' + h; // insecure fallback for file://
  }

  const DEFAULT_SETTINGS = {
    name: 'Top Hat Contracting', phone: '', email: '', address: '', license: '',
    taxRate: 0, dueDays: 14, showCrewPay: true,
    paymentInstructions: 'We accept cash, check, Zelle, card, Venmo and Cash App.\nMake checks payable to Top Hat Contracting.',
    estimateTerms: 'This estimate is valid for 30 days. Work begins once the estimate is approved.',
    invoiceTerms: 'Thank you for choosing Top Hat Contracting!',
  };
  const isoDay = (ms) => new Date(ms - new Date(ms).getTimezoneOffset() * 60e3).toISOString().slice(0, 10);
  const docTotal = (doc) => {
    const sub = (doc.items || []).reduce((t, i) => t + (Number(i.qty) || 0) * (Number(i.price) || 0), 0);
    return Math.round(sub * (1 + (Number(doc.taxRate) || 0) / 100) * 100) / 100;
  };
  const usd = (n) => '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });

  // Sample data so the staff area isn't empty in preview mode.
  async function seed() {
    const now = Date.now();
    const H = 3600 * 1000;
    const pw = await hash('tophat');
    const buyerPw = await hash('demo1234');
    const c1 = uid(), c2 = uid(), c3 = uid(), cu3 = uid();
    const crewPw = await hash('crew1234');
    const b1 = uid(), b2 = uid();
    return {
      users: [
        { id: uid(), role: 'staff', name: 'Top Hat Office', email: 'office@tophat.demo', phone: '', password: pw, created: now },
        { id: b1, role: 'buyer', name: 'Dana Whitfield', email: 'dana@example.com', phone: '(555) 201-3344', password: buyerPw, created: now - 30 * H },
        { id: cu3, role: 'crew', contractorId: c3, name: 'Ray Johnson', email: 'ray@tophat.demo', phone: '(555) 300-4455', password: crewPw, created: now - 200 * H },
        { id: b2, role: 'buyer', name: 'Luis Romero', email: 'luis@example.com', phone: '(555) 410-9821', password: buyerPw, created: now - 75 * H },
      ],
      contractors: [
        { id: c1, name: 'Mike Alvarez', phone: '(555) 300-1122', trades: ['plumbing', 'hvac'], active: true },
        { id: c2, name: 'Sarah Kim', phone: '(555) 300-7788', trades: ['painting', 'drywall', 'flooring'], active: true },
        { id: c3, name: 'Ray Johnson', phone: '(555) 300-4455', trades: ['roofing', 'remodel', 'electrical'], active: true, userId: cu3, inviteCode: null },
      ],
      jobs: [
        {
          id: uid(), buyerId: b1, trade: 'plumbing', status: 'new', created: now - 2 * H,
          description: 'Kitchen sink is leaking under the cabinet. Water damage starting on the cabinet floor.',
          address: '42 Maple Ave, Springfield', zip: '62704', timeframe: 'asap', budget: 'u1k', photos: [],
          number: 1001, files: [], contractorId: null, scheduledFor: null, price: null, crewPay: null, notes: '',
          log: [{ at: now - 2 * H, text: 'Lead received' }],
        },
        {
          id: uid(), buyerId: b2, trade: 'painting', status: 'qualifying', created: now - 26 * H,
          description: 'Interior painting for 3 bedrooms and a hallway. Walls only, ceilings are fine.',
          address: '18 Oak Ridge Dr, Springfield', zip: '62711', timeframe: '2weeks', budget: '1-5k', photos: [],
          number: 1002, files: [], contractorId: null, scheduledFor: null, price: 3200, crewPay: null, notes: 'Called, wants a quote by Friday. Rooms are roughly 12x12.',
          log: [{ at: now - 26 * H, text: 'Lead received' }, { at: now - 20 * H, text: 'Status → Qualifying' }],
        },
        {
          id: uid(), buyerId: b1, trade: 'roofing', status: 'scheduled', created: now - 70 * H,
          description: 'A few shingles blew off in last week\'s storm. Need them replaced and the roof checked.',
          address: '42 Maple Ave, Springfield', zip: '62704', timeframe: '2weeks', budget: '1-5k', photos: [],
          number: 1003, files: [], docs: [{
            id: uid(), type: 'estimate', number: 'E-1003', status: 'approved', taxRate: 0, payments: [], dueDate: null, payLink: '',
            items: [
              { desc: 'Replace storm-damaged shingles (about 2 squares)', qty: 1, price: 1250 },
              { desc: 'Roof inspection and sealing', qty: 1, price: 350 },
              { desc: 'Debris haul-away', qty: 1, price: 200 },
            ],
            notes: DEFAULT_SETTINGS.estimateTerms, created: now - 55 * H, sentAt: now - 54 * H, respondedAt: now - 45 * H, respondedBy: 'Dana Whitfield',
          }],
          crewNotes: [{ id: uid(), at: now - 3 * H, contractorId: c3, by: 'Ray Johnson', text: 'Looked at it from the street. Will need about 2 extra bundles of shingles. Color match is “Weathered Wood”.' }],
          contractorId: c3, crewToken: newToken(), scheduledFor: (() => { const t = new Date(now + 48 * H); t.setHours(9, 0, 0, 0); return new Date(t - t.getTimezoneOffset() * 60e3).toISOString().slice(0, 16); })(), price: 1800, crewPay: 1150, notes: 'Insurance claim filed.',
          log: [{ at: now - 70 * H, text: 'Lead received' }, { at: now - 60 * H, text: 'Status → Qualifying' }, { at: now - 40 * H, text: 'Status → Scheduled · Ray Johnson' }],
        },
      ],
      nextNumber: 1004,
      settings: { ...DEFAULT_SETTINGS },
    };
  }

  // Bring older preview data up to date.
  function migrate(d) {
    d.settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
    d.nextNumber = d.nextNumber || Math.max(1000, ...d.jobs.map((j) => j.number || 0)) + 1;
    d.jobs.slice().sort((a, b) => a.created - b.created).forEach((j) => {
      if (!j.number) j.number = d.nextNumber++;
      if (!j.files) j.files = [];
      if (!j.docs) j.docs = [];
      if ('value' in j) { if (j.price == null) j.price = j.value; delete j.value; }
      if (!('crewPay' in j)) j.crewPay = null;
      if (j.contractorId && !j.crewToken) j.crewToken = newToken();
    });
    return d;
  }

  let dbPromise = null;
  function db() {
    if (!dbPromise) dbPromise = (async () => { let d = readDb(); if (!d) { d = await seed(); } migrate(d); writeDb(d); return d; })();
    return dbPromise;
  }
  function validateSignUp({ name, email, phone, password }) {
    if (!name?.trim()) throw new Error('Please enter your name.');
    if (!/^\S+@\S+\.\S+$/.test(normEmail(email))) throw new Error('Please enter a valid email address.');
    if (digits(phone).length < 10) throw new Error('Please enter a phone number we can call, with area code.');
    if (!password || password.length < 8) throw new Error('Password must be at least 8 characters.');
  }
  const clean = (u) => u && { id: u.id, role: u.role, name: u.name, email: u.email, phone: u.phone };
  const normEmail = (e) => String(e || '').trim().toLowerCase();
  const digits = (p) => String(p || '').replace(/\D/g, '');

  async function me() {
    const d = await db();
    const id = getSession();
    return clean(d.users.find((u) => u.id === id)) || null;
  }
  async function requireStaff() {
    const u = await me();
    if (!u || u.role !== 'staff') throw new Error('Please log in as Top Hat staff.');
    return u;
  }
  // Logged-in crew member and their contractor record.
  async function requireCrew() {
    const d = await db();
    const u = d.users.find((x) => x.id === getSession());
    const c = u && u.role === 'crew' && d.contractors.find((x) => x.id === u.contractorId && x.userId === u.id);
    if (!c) throw new Error('Your crew login is turned off. Ask the Top Hat office if this is a mistake.');
    return { d, u, c };
  }

  async function withUrl(f) {
    const blob = await blobs.get(f.id).catch(() => null);
    return { ...f, url: blob ? URL.createObjectURL(blob) : null };
  }

  const MAX_NOTE = 2000;
  // The customer on a job: their app account if they have one, otherwise the contact the office entered.
  const customerOf = (d, j) => {
    const u = j.buyerId && d.users.find((x) => x.id === j.buyerId);
    return u ? { name: u.name, email: u.email, phone: u.phone } : { name: j.contact?.name || 'Unknown', email: j.contact?.email || '', phone: j.contact?.phone || '' };
  };
  // Crew note on a job, written by the contractor currently assigned. Office sees all; customers never do.
  function pushCrewNote(d, j, text) {
    text = String(text || '').trim();
    if (!text) throw new Error('Write a note first.');
    if (text.length > MAX_NOTE) throw new Error(`Notes can be up to ${MAX_NOTE} characters.`);
    const c = d.contractors.find((x) => x.id === j.contractorId);
    j.crewNotes = j.crewNotes || [];
    const note = { id: uid(), at: Date.now(), text, contractorId: j.contractorId, by: c ? c.name : 'Crew' };
    j.crewNotes.push(note);
    j.log.push({ at: note.at, text: `${note.by} added a crew note` });
    writeDb(d);
    return note;
  }
  const ownNotes = (j) => (j.crewNotes || []).filter((n) => n.contractorId === j.contractorId)
    .map(({ id, at, text }) => ({ id, at, text }));

  const api = {
    mode: 'preview',

    auth: {
      me,
      async signUp({ name, email, phone, password }) {
        const d = await db();
        email = normEmail(email);
        validateSignUp({ name, email, phone, password });
        if (d.users.some((u) => u.email === email)) throw new Error('An account with that email already exists. Try logging in.');
        const user = { id: uid(), role: 'buyer', name: name.trim(), email, phone: phone.trim(), password: await hash(password), created: Date.now() };
        d.users.push(user); writeDb(d); setSession(user.id);
        return clean(user);
      },
      async signIn(email, password) {
        const d = await db();
        const u = d.users.find((x) => x.email === normEmail(email));
        if (!u || u.password !== await hash(password || '')) throw new Error('That email and password don\'t match.');
        setSession(u.id);
        return clean(u);
      },
      async signOut() { setSession(null); },
    },

    jobs: {
      async create(job) {
        const u = await me();
        if (!u) throw new Error('Please create an account first.');
        const d = await db();
        const now = Date.now();
        const rec = {
          id: uid(), number: d.nextNumber++, buyerId: u.id, status: 'new', created: now, files: [], docs: [],
          trade: job.trade, description: job.description.trim(), address: job.address.trim(), zip: (job.zip || '').trim(),
          timeframe: job.timeframe, budget: job.budget || '', photos: job.photos || [],
          contractorId: null, scheduledFor: null, price: null, crewPay: null, notes: '',
          log: [{ at: now, text: 'Lead received' }],
        };
        d.jobs.push(rec); writeDb(d);
        return rec;
      },
      // Office: enter a job for a customer who called in. Optionally assign a crew and date right away.
      async createForCustomer(input) {
        const staff = await requireStaff();
        const d = await db();
        const name = String(input.name || '').trim();
        if (!name) throw new Error('Enter the customer’s name.');
        if (digits(input.phone).length < 10 && !/^\S+@\S+\.\S+$/.test(normEmail(input.email))) throw new Error('Enter a phone number (with area code) or an email so you can reach them.');
        if (String(input.description || '').trim().length < 5) throw new Error('Describe the job in a few words.');
        if (!String(input.address || '').trim()) throw new Error('Enter the job address.');
        const existing = input.customerId ? d.users.find((u) => u.id === input.customerId && u.role === 'buyer') : null;
        const now = Date.now();
        const crewOk = input.contractorId && d.contractors.some((c) => c.id === input.contractorId);
        const rec = {
          id: uid(), number: d.nextNumber++, buyerId: existing ? existing.id : null,
          contact: existing ? null : { name, phone: String(input.phone || '').trim(), email: normEmail(input.email) },
          status: crewOk && input.scheduledFor ? 'scheduled' : 'qualifying', created: now, files: [], docs: [],
          trade: input.trade || 'other', description: input.description.trim(), address: input.address.trim(), zip: String(input.zip || '').trim(),
          timeframe: input.timeframe || '', budget: '', photos: [],
          contractorId: crewOk ? input.contractorId : null, crewToken: crewOk ? newToken() : null, scheduledFor: input.scheduledFor || null,
          price: null, crewPay: null, notes: '',
          log: [{ at: now, text: `Job entered by ${staff.name} (office)` }],
        };
        if (crewOk) rec.log.push({ at: now, text: `Assigned to ${d.contractors.find((c) => c.id === input.contractorId).name}` });
        d.jobs.push(rec); writeDb(d);
        return rec.id;
      },
      // Buyer view: their own jobs, without internal notes.
      async mine() {
        const u = await me();
        if (!u) return [];
        const d = await db();
        return d.jobs.filter((j) => j.buyerId === u.id).sort((a, b) => b.created - a.created).map((j) => {
          const c = d.contractors.find((x) => x.id === j.contractorId);
          return {
            id: j.id, number: j.number, trade: j.trade, status: j.status, created: j.created, description: j.description, address: j.address, zip: j.zip,
            timeframe: j.timeframe, budget: j.budget, photos: j.photos, scheduledFor: j.scheduledFor,
            contractorName: c && ['scheduled', 'in_progress', 'completed'].includes(j.status) ? c.name : null,
            stage: j.stage || null,
            sharedFiles: j.files.filter((f) => f.shared).length,
          };
        });
      },
      // Staff: every crew note on a job, newest first. Opening them marks them seen.
      async crewNotes(id) {
        await requireStaff();
        const d = await db();
        const j = d.jobs.find((x) => x.id === id);
        if (!j) return [];
        j.crewNotesSeenAt = Date.now();
        writeDb(d);
        return (j.crewNotes || []).slice().reverse().map((n) => ({ ...n }));
      },
      // Staff: a job's activity history, oldest first.
      async log(id) {
        await requireStaff();
        const j = (await db()).jobs.find((x) => x.id === id);
        return j ? j.log.slice() : [];
      },
      // Staff view: everything, with buyer contact details attached.
      async all() {
        await requireStaff();
        const d = await db();
        return d.jobs.slice().sort((a, b) => b.created - a.created).map((j) => {
          return { ...j, buyer: customerOf(d, j), hasAccount: !!j.buyerId };
        });
      },
      async update(id, patch) {
        await requireStaff();
        const d = await db();
        const j = d.jobs.find((x) => x.id === id);
        if (!j) throw new Error('Job not found.');
        const cname = (cid) => d.contractors.find((c) => c.id === cid)?.name || 'nobody';
        const staffUser = await me();
        if ('status' in patch || 'stage' in patch) applyProgress(j, { status: patch.status, stage: patch.stage }, staffUser.name, false);
        if ('contractorId' in patch && patch.contractorId !== j.contractorId) {
          j.log.push({ at: Date.now(), text: `Assigned to ${cname(patch.contractorId)}` });
          // New crew → new upload link, so the previous crew's link stops working.
          j.crewToken = patch.contractorId ? newToken() : null;
        }
        if ('scheduledFor' in patch && patch.scheduledFor !== j.scheduledFor && patch.scheduledFor) j.log.push({ at: Date.now(), text: `Scheduled for ${new Date(patch.scheduledFor).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` });
        const usd = (n) => n == null ? 'cleared' : '$' + Number(n).toLocaleString();
        if ('price' in patch && patch.price !== j.price) j.log.push({ at: Date.now(), text: `Customer price → ${usd(patch.price)}` });
        if ('crewPay' in patch && patch.crewPay !== j.crewPay) j.log.push({ at: Date.now(), text: `Crew pay → ${usd(patch.crewPay)}` });
        for (const k of ['contractorId', 'scheduledFor', 'price', 'crewPay', 'notes']) if (k in patch) j[k] = patch[k];
        writeDb(d);
        return j;
      },
    },

    files: {
      // Staff: every file in the job's folder, each with a temporary URL to open it.
      async list(jobId) {
        await requireStaff();
        const j = (await db()).jobs.find((x) => x.id === jobId);
        if (!j) return [];
        return Promise.all(j.files.map(withUrl));
      },
      async upload(jobId, file, kind) {
        const u = await requireStaff();
        if (file.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`"${file.name}" is over ${MAX_FILE_MB} MB.`);
        const d = await db();
        const j = d.jobs.find((x) => x.id === jobId);
        if (!j) throw new Error('Job not found.');
        const meta = { id: uid(), name: file.name, mime: file.type || 'application/octet-stream', size: file.size,
          kind: kind || guessKind(file.name, file.type || ''), shared: false, uploaded: Date.now(), by: u.name };
        await blobs.put(meta.id, file);
        j.files.push(meta);
        j.log.push({ at: Date.now(), text: `File added: ${meta.name}` });
        writeDb(d);
        return meta;
      },
      async update(jobId, fileId, patch) {
        await requireStaff();
        const d = await db();
        const j = d.jobs.find((x) => x.id === jobId);
        const f = j && j.files.find((x) => x.id === fileId);
        if (!f) throw new Error('File not found.');
        if ('shared' in patch && patch.shared !== f.shared) j.log.push({ at: Date.now(), text: `${f.name}: ${patch.shared ? 'shared with customer' : 'hidden from customer'}` });
        for (const k of ['kind', 'shared']) if (k in patch) f[k] = patch[k];
        writeDb(d);
      },
      async remove(jobId, fileId) {
        await requireStaff();
        const d = await db();
        const j = d.jobs.find((x) => x.id === jobId);
        const f = j && j.files.find((x) => x.id === fileId);
        if (!f) return;
        j.files = j.files.filter((x) => x !== f);
        j.log.push({ at: Date.now(), text: `File removed: ${f.name}` });
        writeDb(d);
        await blobs.del(fileId);
      },
      // Customer: only files staff chose to share, and only on their own job.
      async forCustomer(jobId) {
        const u = await me();
        const j = (await db()).jobs.find((x) => x.id === jobId);
        if (!u || !j || j.buyerId !== u.id) return [];
        return Promise.all(j.files.filter((f) => f.shared).map(async (f) => {
          const { id, name, kind, size, uploaded, url } = await withUrl(f);
          return { id, name, kind, size, uploaded, url };
        }));
      },
    },

    // Company details shown on estimates and invoices.
    settings: {
      async get() { return { ...(await db()).settings }; },
      async save(patch) {
        await requireStaff();
        const d = await db();
        d.settings = { ...d.settings, ...patch };
        writeDb(d);
        return { ...d.settings };
      },
    },

    // Estimates & invoices. Crew pay is never part of these.
    docs: {
      async list(jobId) {
        await requireStaff();
        const j = (await db()).jobs.find((x) => x.id === jobId);
        return j ? JSON.parse(JSON.stringify(j.docs)) : [];
      },
      async save(jobId, doc) {
        await requireStaff();
        const d = await db();
        const j = d.jobs.find((x) => x.id === jobId);
        if (!j) throw new Error('Job not found.');
        const fields = {
          items: (doc.items || []).map((i) => ({ desc: String(i.desc || '').trim(), qty: Number(i.qty) || 0, price: Number(i.price) || 0 })),
          taxRate: Number(doc.taxRate) || 0, notes: doc.notes || '', dueDate: doc.dueDate || null, payLink: (doc.payLink || '').trim(),
        };
        if (fields.items.some((i) => i.qty < 0 || i.price < 0) || fields.taxRate < 0) throw new Error('Amounts can’t be negative.');
        if (fields.payLink && !/^https:\/\//i.test(fields.payLink)) throw new Error('The card payment link must start with https://');
        let rec = doc.id && j.docs.find((x) => x.id === doc.id);
        if (rec) {
          const paid = (rec.payments || []).length > 0;
          if (!(rec.status === 'draft' || (rec.status === 'sent' && !paid))) throw new Error('This document is locked and can’t be edited.');
          Object.assign(rec, fields);
        } else {
          const prefix = doc.type === 'invoice' ? 'INV' : 'E';
          const n = j.docs.filter((x) => x.type === doc.type).length + 1;
          rec = { id: uid(), type: doc.type, number: `${prefix}-${j.number}${n > 1 ? '-' + n : ''}`, status: 'draft',
            payments: [], created: Date.now(), fromEstimateId: doc.fromEstimateId || null, ...fields };
          j.docs.push(rec);
          j.log.push({ at: Date.now(), text: `${doc.type === 'invoice' ? 'Invoice' : 'Estimate'} ${rec.number} created` });
        }
        writeDb(d);
        return JSON.parse(JSON.stringify(rec));
      },
      async send(jobId, docId) {
        await requireStaff();
        const d = await db();
        const j = d.jobs.find((x) => x.id === jobId);
        const rec = j && j.docs.find((x) => x.id === docId);
        if (!rec || rec.status !== 'draft') throw new Error('Only drafts can be sent.');
        if (!(rec.items || []).some((i) => i.desc && i.qty && i.price)) throw new Error('Add at least one line with a description, quantity and price.');
        rec.status = 'sent'; rec.sentAt = Date.now();
        j.log.push({ at: Date.now(), text: `${rec.number} sent to customer (${usd(docTotal(rec))})` });
        writeDb(d);
      },
      // Staff: mark an estimate approved/declined (e.g. customer said yes by phone), or void an invoice.
      async setStatus(jobId, docId, status) {
        const u = await requireStaff();
        const d = await db();
        const j = d.jobs.find((x) => x.id === jobId);
        const rec = j && j.docs.find((x) => x.id === docId);
        if (!rec) throw new Error('Not found.');
        const ok = rec.type === 'estimate' ? ['approved', 'declined'].includes(status) && rec.status === 'sent'
          : status === 'void' && rec.status !== 'void';
        if (!ok) throw new Error('That change isn’t allowed.');
        rec.status = status; rec.respondedAt = Date.now(); rec.respondedBy = `${u.name} (office)`;
        if (status === 'approved') { j.price = docTotal(rec); j.log.push({ at: Date.now(), text: `Customer price → ${usd(j.price)} (from ${rec.number})` }); }
        j.log.push({ at: Date.now(), text: `${rec.number} marked ${status} by office` });
        writeDb(d);
      },
      async remove(jobId, docId) {
        await requireStaff();
        const d = await db();
        const j = d.jobs.find((x) => x.id === jobId);
        const rec = j && j.docs.find((x) => x.id === docId);
        if (!rec) return;
        if (rec.status !== 'draft') throw new Error('Only drafts can be deleted. Void an invoice instead.');
        j.docs = j.docs.filter((x) => x !== rec);
        j.log.push({ at: Date.now(), text: `Draft ${rec.number} deleted` });
        writeDb(d);
      },
      async addPayment(jobId, docId, p) {
        await requireStaff();
        const d = await db();
        const j = d.jobs.find((x) => x.id === jobId);
        const rec = j && j.docs.find((x) => x.id === docId);
        if (!rec || rec.type !== 'invoice' || ['draft', 'void'].includes(rec.status)) throw new Error('Send the invoice before recording payments.');
        const amount = Math.round(Number(p.amount) * 100) / 100;
        if (!(amount > 0)) throw new Error('Enter the amount received.');
        rec.payments.push({ id: uid(), amount, method: p.method || 'Other', date: p.date || isoDay(Date.now()), note: (p.note || '').trim() });
        const paid = rec.payments.reduce((t, x) => t + x.amount, 0);
        j.log.push({ at: Date.now(), text: `Payment ${usd(amount)} (${p.method || 'Other'}) on ${rec.number}` });
        if (paid >= docTotal(rec)) j.log.push({ at: Date.now(), text: `${rec.number} paid in full` });
        writeDb(d);
      },
      async removePayment(jobId, docId, paymentId) {
        await requireStaff();
        const d = await db();
        const j = d.jobs.find((x) => x.id === jobId);
        const rec = j && j.docs.find((x) => x.id === docId);
        const pay = rec && rec.payments.find((x) => x.id === paymentId);
        if (!pay) return;
        rec.payments = rec.payments.filter((x) => x !== pay);
        j.log.push({ at: Date.now(), text: `Payment ${usd(pay.amount)} removed from ${rec.number}` });
        writeDb(d);
      },
      // Customer: everything sent to them (never drafts), keyed by job.
      async mine() {
        const u = await me();
        if (!u) return {};
        const d = await db();
        const out = {};
        d.jobs.filter((j) => j.buyerId === u.id).forEach((j) => {
          out[j.id] = j.docs.filter((x) => x.status !== 'draft').map((x) => {
            const { id, type, number, status, items, taxRate, notes, dueDate, payLink, payments, created, sentAt, respondedAt } = x;
            return JSON.parse(JSON.stringify({ id, type, number, status, items, taxRate, notes, dueDate, payLink, payments, created, sentAt, respondedAt }));
          });
        });
        return out;
      },
      async respond(docId, approve) {
        const u = await me();
        const d = await db();
        const j = u && d.jobs.find((x) => x.buyerId === u.id && x.docs.some((y) => y.id === docId));
        const rec = j && j.docs.find((x) => x.id === docId);
        if (!rec || rec.type !== 'estimate' || rec.status !== 'sent') throw new Error('This estimate can no longer be changed. Call us if you have questions.');
        rec.status = approve ? 'approved' : 'declined'; rec.respondedAt = Date.now(); rec.respondedBy = u.name;
        if (approve) { j.price = docTotal(rec); j.log.push({ at: Date.now(), text: `Customer price → ${usd(j.price)} (from ${rec.number})` }); }
        j.log.push({ at: Date.now(), text: `Customer ${approve ? 'approved' : 'declined'} ${rec.number}` });
        writeDb(d);
      },
    },

    // Crew upload link: no login, the link's code is the key. Shows only safe job basics.
    crew: {
      async job(token) {
        const d = await db();
        const j = token && d.jobs.find((x) => x.crewToken && x.crewToken === token);
        if (!j || j.status === 'lost') return null;
        const c = d.contractors.find((x) => x.id === j.contractorId);
        const b = customerOf(d, j);
        const mine = j.files.filter((f) => f.source === 'crew' && f.contractorId === j.contractorId);
        return {
          number: j.number, trade: j.trade, status: j.status, address: j.address, zip: j.zip,
          description: j.description, scheduledFor: j.scheduledFor,
          customerName: b ? b.name : '', customerPhone: b ? b.phone : '',
          crewName: c ? c.name : '',
          uploads: await Promise.all(mine.map(async (f) => {
            const { id, name, mime, stage, note, uploaded, url } = await withUrl(f);
            return { id, name, mime, stage, note, uploaded, url };
          })),
          notes: ownNotes(j),
        };
      },
      async addNote(token, text) {
        const d = await db();
        const j = token && d.jobs.find((x) => x.crewToken && x.crewToken === token);
        if (!j || j.status === 'lost') throw new Error('This link is no longer active. Ask the Top Hat office for a new one.');
        pushCrewNote(d, j, text);
      },
      async upload(token, file, { stage = '', note = '' } = {}) {
        const d = await db();
        const j = token && d.jobs.find((x) => x.crewToken && x.crewToken === token);
        if (!j || j.status === 'lost') throw new Error('This upload link is no longer active. Ask the Top Hat office for a new one.');
        if (file.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`"${file.name}" is over ${MAX_FILE_MB} MB.`);
        const c = d.contractors.find((x) => x.id === j.contractorId);
        const meta = { id: uid(), name: file.name, mime: file.type || 'application/octet-stream', size: file.size,
          kind: guessKind(file.name, file.type || ''), shared: false, uploaded: Date.now(),
          source: 'crew', contractorId: j.contractorId, by: c ? c.name : 'Crew', stage, note: note.trim() };
        await blobs.put(meta.id, file);
        j.files.push(meta);
        j.log.push({ at: Date.now(), text: `${meta.by} uploaded ${meta.name}${stage ? ` (${stage})` : ''}` });
        writeDb(d);
        return meta;
      },
    },

    contractors: {
      async list() {
        await requireStaff();
        const d = await db();
        return d.contractors.map((c) => {
          const u = c.userId && d.users.find((x) => x.id === c.userId);
          return { ...c, login: u ? 'active' : c.inviteCode ? 'invited' : 'none', loginEmail: u ? u.email : '' };
        });
      },
      async save(c) {
        await requireStaff();
        if (!c.name?.trim()) throw new Error('Contractor needs a name.');
        const d = await db();
        const fields = { name: c.name.trim(), phone: (c.phone || '').trim(), trades: c.trades || [], active: c.active !== false };
        const existing = d.contractors.find((x) => x.id === c.id);
        if (existing) Object.assign(existing, fields);
        else d.contractors.push({ id: uid(), userId: null, inviteCode: null, ...fields });
        writeDb(d);
      },
      async remove(id) {
        await requireStaff();
        const d = await db();
        const c = d.contractors.find((x) => x.id === id);
        if (c && c.userId) { const u = d.users.find((x) => x.id === c.userId); if (u) u.contractorId = null; }
        d.contractors = d.contractors.filter((x) => x.id !== id);
        d.jobs.forEach((j) => { if (j.contractorId === id) { j.contractorId = null; j.crewToken = null; } });
        writeDb(d);
      },
      // Staff: one-time invite code so this contractor can set up a crew login.
      async invite(id) {
        await requireStaff();
        const d = await db();
        const c = d.contractors.find((x) => x.id === id);
        if (!c) throw new Error('Contractor not found.');
        if (c.userId) throw new Error(`${c.name} already has a crew login.`);
        c.inviteCode = newToken();
        writeDb(d);
        return c.inviteCode;
      },
      // Staff: turn off a contractor's crew login (and any pending invite).
      async revokeLogin(id) {
        await requireStaff();
        const d = await db();
        const c = d.contractors.find((x) => x.id === id);
        if (!c) return;
        const u = c.userId && d.users.find((x) => x.id === c.userId);
        if (u) u.contractorId = null;
        c.userId = null; c.inviteCode = null;
        writeDb(d);
      },
    },

    // Crew login: invite → own password → see only their own assigned jobs. Never customer prices.
    crewPortal: {
      async inviteInfo(code) {
        const d = await db();
        const c = code && code.length >= 32 && d.contractors.find((x) => x.inviteCode === code);
        return c ? { name: c.name } : null;
      },
      async acceptInvite(code, { email, password }) {
        const d = await db();
        const c = code && code.length >= 32 && d.contractors.find((x) => x.inviteCode === code);
        if (!c) throw new Error('This invite link has already been used or was cancelled. Ask the office for a new one.');
        email = normEmail(email);
        if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Please enter a valid email address.');
        if (!password || password.length < 8) throw new Error('Password must be at least 8 characters.');
        if (d.users.some((u) => u.email === email)) throw new Error('That email already has an account. Use a different email, or ask the office.');
        const user = { id: uid(), role: 'crew', contractorId: c.id, name: c.name, email, phone: c.phone || '', password: await hash(password), created: Date.now() };
        d.users.push(user);
        c.userId = user.id; c.inviteCode = null;
        writeDb(d); setSession(user.id);
        return clean(user);
      },
      async jobs() {
        const { d, c } = await requireCrew();
        const showPay = d.settings.showCrewPay !== false;
        return d.jobs.filter((j) => j.contractorId === c.id && ['scheduled', 'in_progress', 'completed'].includes(j.status)).map((j) => {
          const b = customerOf(d, j);
          return {
            id: j.id, number: j.number, trade: j.trade, status: j.status, scheduledFor: j.scheduledFor,
            address: j.address, zip: j.zip, description: j.description,
            customerName: b.name || '', customerPhone: b.phone || '',
            stage: j.stage || null, progressAt: j.progressAt || null, progressBy: j.progressBy || '',
            crewToken: j.crewToken, crewPay: showPay ? j.crewPay : null,
            photos: j.files.filter((f) => f.source === 'crew' && f.contractorId === c.id).length,
            notes: ownNotes(j),
          };
        });
      },
      async addNote(jobId, text) {
        const { d, c } = await requireCrew();
        const j = d.jobs.find((x) => x.id === jobId && x.contractorId === c.id && ['scheduled', 'in_progress', 'completed'].includes(x.status));
        if (!j) throw new Error('You can only add notes to your own jobs.');
        pushCrewNote(d, j, text);
      },
      // { status?, stage? }: status moves between Scheduled / Working / Done; stage is null or a STAGES id.
      async setProgress(jobId, { status, stage } = {}) {
        const { d, c, u } = await requireCrew();
        const j = d.jobs.find((x) => x.id === jobId && x.contractorId === c.id);
        if (!j || !CREW_STATUSES.includes(j.status)) throw new Error('That update isn’t available for this job.');
        if (status && !CREW_STATUSES.includes(status)) throw new Error('That update isn’t available for this job.');
        if (stage && !STAGES.some((x) => x.id === stage && x.status === (status || j.status))) throw new Error('That update isn’t available right now.');
        applyProgress(j, { status, stage }, u.name, true);
        writeDb(d);
      },
      async setStatus(jobId, status) { return api.crewPortal.setProgress(jobId, { status }); },
    },

    async resetPreview() {
      try { localStorage.removeItem(DB_KEY); localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
      dbPromise = null;
      await blobs.clear().catch(() => {});
    },
  };

  /* ---------- shared UI helpers ---------- */
  function el(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'value') n.value = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k in n && typeof v !== 'string') n[k] = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) n.append(c);
    return n;
  }
  function ago(ts) {
    const s = (Date.now() - ts) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
    const days = Math.floor(s / 86400);
    return days === 1 ? 'yesterday' : `${days} days ago`;
  }
  const fmtWhen = (iso) => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const find = (list, id) => list.find((x) => x.id === id);

  // Shrink photos before saving so they fit in storage and upload fast.
  function shrinkImage(file, max = 1024, quality = 0.75) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that photo.')); };
      img.src = url;
    });
  }

  /* ---------- one login for everyone ---------- */
  // Where each kind of account goes after logging in.
  const HOME = { staff: 'admin.html', crew: 'crew.html', buyer: 'index.html#/jobs' };
  const here = () => location.pathname.split('/').pop() || 'index.html';
  function goHome(u, onCustomer) {
    const dest = HOME[u.role] || HOME.buyer;
    if (u.role === 'buyer' && onCustomer) return onCustomer(u);
    if (dest.split('#')[0] === here()) {
      const h = dest.split('#')[1];
      if (h) location.hash = h; // otherwise keep the tab they were heading to
      location.reload();
      return;
    }
    location.href = dest;
  }
  // Sample accounts for trying each side of the app (preview mode only).
  const DEMO_ACCOUNTS = [
    { icon: '🎩', label: 'Top Hat office', sub: 'Staff: leads, crew, estimates & invoices', email: 'office@tophat.demo', password: 'tophat' },
    { icon: '🏠', label: 'Customer', sub: 'Dana: her jobs, estimates & invoices', email: 'dana@example.com', password: 'demo1234' },
    { icon: '👷', label: 'Contractor', sub: 'Ray: his assigned jobs & pay', email: 'ray@tophat.demo', password: 'crew1234' },
  ];
  function loginForm({ title = 'Log in', note = '', onCustomer } = {}) {
    const errorBox = el('div', { class: 'error', hidden: !note, role: 'alert' }, note);
    const signIn = async (email, password, btn) => {
      if (btn) btn.disabled = true;
      try { goHome(await window.TH.api.auth.signIn(email, password), onCustomer); }
      catch (err) { errorBox.textContent = err.message; errorBox.hidden = false; if (btn) btn.disabled = false; }
    };
    const form = el('form', { class: 'card stack login-box', onsubmit: (e) => {
      e.preventDefault();
      const f = new FormData(form);
      signIn(f.get('email'), f.get('password'), form.querySelector('button[type=submit]'));
    } },
      el('h1', {}, title),
      el('p', { class: 'muted small' }, 'One login for everyone: customers, Top Hat staff and crew. We’ll take you to the right place.'),
      errorBox,
      el('label', { class: 'field' }, 'Email', el('input', { name: 'email', type: 'email', autocomplete: 'username', inputmode: 'email', required: true })),
      el('label', { class: 'field' }, 'Password', el('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true })),
      el('button', { class: 'gold block', type: 'submit' }, 'Log in'),
      el('p', { class: 'muted small', style: 'text-align:center' }, 'New customer? ', el('a', { href: 'index.html#/request' }, 'Request a job'), ' and create your account at the end. New crew? Ask the office for an invite.'),
    );
    if (window.TH.api.mode !== 'preview') return form;
    return el('div', { class: 'stack', style: 'gap:0' }, form,
      el('section', { class: 'card stack login-box' },
        el('h3', {}, 'Preview: try it as…'),
        el('p', { class: 'muted small' }, 'Sample accounts so you can see every side of the app.'),
        ...DEMO_ACCOUNTS.map((a) => el('button', { type: 'button', class: 'demo-acct', onclick: (e) => signIn(a.email, a.password, e.currentTarget) },
          el('span', { class: 'ic' }, a.icon),
          el('span', { class: 'body' }, el('b', {}, a.label), el('span', { class: 'muted small' }, a.sub)),
          el('span', { class: 'muted' }, '→')))));
  }

  window.TH = { STAGES, loginForm, goHome, _util: { guessKind, normEmail, digits, validateSignUp, MAX_FILE_MB, DEFAULT_SETTINGS }, api, TRADES, TIMEFRAMES, BUDGETS, STATUSES, FILE_KINDS, PHOTO_STAGES, el, ago, fmtWhen, find, shrinkImage };
})();
