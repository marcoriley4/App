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

  // Sample data so the staff area isn't empty in preview mode.
  async function seed() {
    const now = Date.now();
    const H = 3600 * 1000;
    const pw = await hash('tophat');
    const buyerPw = await hash('demo1234');
    const c1 = uid(), c2 = uid(), c3 = uid();
    const b1 = uid(), b2 = uid();
    return {
      users: [
        { id: uid(), role: 'staff', name: 'Top Hat Office', email: 'office@tophat.demo', phone: '', password: pw, created: now },
        { id: b1, role: 'buyer', name: 'Dana Whitfield', email: 'dana@example.com', phone: '(555) 201-3344', password: buyerPw, created: now - 30 * H },
        { id: b2, role: 'buyer', name: 'Luis Romero', email: 'luis@example.com', phone: '(555) 410-9821', password: buyerPw, created: now - 75 * H },
      ],
      contractors: [
        { id: c1, name: 'Mike Alvarez', phone: '(555) 300-1122', trades: ['plumbing', 'hvac'], active: true },
        { id: c2, name: 'Sarah Kim', phone: '(555) 300-7788', trades: ['painting', 'drywall', 'flooring'], active: true },
        { id: c3, name: 'Ray Johnson', phone: '(555) 300-4455', trades: ['roofing', 'remodel', 'electrical'], active: true },
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
          number: 1003, files: [], contractorId: c3, crewToken: newToken(), scheduledFor: (() => { const t = new Date(now + 48 * H); t.setHours(9, 0, 0, 0); return new Date(t - t.getTimezoneOffset() * 60e3).toISOString().slice(0, 16); })(), price: 1800, crewPay: 1150, notes: 'Insurance claim filed.',
          log: [{ at: now - 70 * H, text: 'Lead received' }, { at: now - 60 * H, text: 'Status → Qualifying' }, { at: now - 40 * H, text: 'Status → Scheduled · Ray Johnson' }],
        },
      ],
      nextNumber: 1004,
    };
  }

  // Bring older preview data up to date.
  function migrate(d) {
    d.nextNumber = d.nextNumber || Math.max(1000, ...d.jobs.map((j) => j.number || 0)) + 1;
    d.jobs.slice().sort((a, b) => a.created - b.created).forEach((j) => {
      if (!j.number) j.number = d.nextNumber++;
      if (!j.files) j.files = [];
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

  async function withUrl(f) {
    const blob = await blobs.get(f.id).catch(() => null);
    return { ...f, url: blob ? URL.createObjectURL(blob) : null };
  }

  const api = {
    mode: 'preview',

    auth: {
      me,
      async signUp({ name, email, phone, password }) {
        const d = await db();
        email = normEmail(email);
        if (!name?.trim()) throw new Error('Please enter your name.');
        if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Please enter a valid email address.');
        if (digits(phone).length < 10) throw new Error('Please enter a phone number we can call, with area code.');
        if (!password || password.length < 8) throw new Error('Password must be at least 8 characters.');
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
          id: uid(), number: d.nextNumber++, buyerId: u.id, status: 'new', created: now, files: [],
          trade: job.trade, description: job.description.trim(), address: job.address.trim(), zip: (job.zip || '').trim(),
          timeframe: job.timeframe, budget: job.budget || '', photos: job.photos || [],
          contractorId: null, scheduledFor: null, price: null, crewPay: null, notes: '',
          log: [{ at: now, text: 'Lead received' }],
        };
        d.jobs.push(rec); writeDb(d);
        return rec;
      },
      // Buyer view: their own jobs, without internal notes.
      async mine() {
        const u = await me();
        if (!u) return [];
        const d = await db();
        return d.jobs.filter((j) => j.buyerId === u.id).sort((a, b) => b.created - a.created).map((j) => {
          const c = d.contractors.find((x) => x.id === j.contractorId);
          return {
            id: j.id, number: j.number, trade: j.trade, status: j.status, created: j.created, description: j.description, address: j.address,
            timeframe: j.timeframe, budget: j.budget, photos: j.photos, scheduledFor: j.scheduledFor,
            contractorName: c && ['scheduled', 'in_progress', 'completed'].includes(j.status) ? c.name : null,
            sharedFiles: j.files.filter((f) => f.shared).length,
          };
        });
      },
      // Staff view: everything, with buyer contact details attached.
      async all() {
        await requireStaff();
        const d = await db();
        return d.jobs.slice().sort((a, b) => b.created - a.created).map((j) => {
          const b = d.users.find((u) => u.id === j.buyerId);
          return { ...j, buyer: clean(b) || { name: 'Unknown', email: '', phone: '' } };
        });
      },
      async update(id, patch) {
        await requireStaff();
        const d = await db();
        const j = d.jobs.find((x) => x.id === id);
        if (!j) throw new Error('Job not found.');
        const label = (s) => STATUSES.find((x) => x.id === s)?.label || s;
        const cname = (cid) => d.contractors.find((c) => c.id === cid)?.name || 'nobody';
        if ('status' in patch && patch.status !== j.status) j.log.push({ at: Date.now(), text: `Status → ${label(patch.status)}` });
        if ('contractorId' in patch && patch.contractorId !== j.contractorId) {
          j.log.push({ at: Date.now(), text: `Assigned to ${cname(patch.contractorId)}` });
          // New crew → new upload link, so the previous crew's link stops working.
          j.crewToken = patch.contractorId ? newToken() : null;
        }
        if ('scheduledFor' in patch && patch.scheduledFor !== j.scheduledFor && patch.scheduledFor) j.log.push({ at: Date.now(), text: `Scheduled for ${new Date(patch.scheduledFor).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` });
        const usd = (n) => n == null ? 'cleared' : '$' + Number(n).toLocaleString();
        if ('price' in patch && patch.price !== j.price) j.log.push({ at: Date.now(), text: `Customer price → ${usd(patch.price)}` });
        if ('crewPay' in patch && patch.crewPay !== j.crewPay) j.log.push({ at: Date.now(), text: `Crew pay → ${usd(patch.crewPay)}` });
        for (const k of ['status', 'contractorId', 'scheduledFor', 'price', 'crewPay', 'notes']) if (k in patch) j[k] = patch[k];
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

    // Crew upload link: no login, the link's code is the key. Shows only safe job basics.
    crew: {
      async job(token) {
        const d = await db();
        const j = token && d.jobs.find((x) => x.crewToken && x.crewToken === token);
        if (!j || j.status === 'lost') return null;
        const c = d.contractors.find((x) => x.id === j.contractorId);
        const b = d.users.find((u) => u.id === j.buyerId);
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
        };
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
      async list() { await requireStaff(); return (await db()).contractors.slice(); },
      async save(c) {
        await requireStaff();
        if (!c.name?.trim()) throw new Error('Contractor needs a name.');
        const d = await db();
        const existing = d.contractors.find((x) => x.id === c.id);
        if (existing) Object.assign(existing, c);
        else d.contractors.push({ id: uid(), active: true, trades: [], ...c });
        writeDb(d);
      },
      async remove(id) {
        await requireStaff();
        const d = await db();
        d.contractors = d.contractors.filter((x) => x.id !== id);
        d.jobs.forEach((j) => { if (j.contractorId === id) j.contractorId = null; });
        writeDb(d);
      },
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

  window.TH = { api, TRADES, TIMEFRAMES, BUDGETS, STATUSES, FILE_KINDS, PHOTO_STAGES, el, ago, fmtWhen, find, shrinkImage };
})();
