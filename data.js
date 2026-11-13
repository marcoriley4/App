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
          contractorId: null, scheduledFor: null, value: null, notes: '',
          log: [{ at: now - 2 * H, text: 'Lead received' }],
        },
        {
          id: uid(), buyerId: b2, trade: 'painting', status: 'qualifying', created: now - 26 * H,
          description: 'Interior painting for 3 bedrooms and a hallway. Walls only, ceilings are fine.',
          address: '18 Oak Ridge Dr, Springfield', zip: '62711', timeframe: '2weeks', budget: '1-5k', photos: [],
          contractorId: null, scheduledFor: null, value: 3200, notes: 'Called, wants a quote by Friday. Rooms are roughly 12x12.',
          log: [{ at: now - 26 * H, text: 'Lead received' }, { at: now - 20 * H, text: 'Status → Qualifying' }],
        },
        {
          id: uid(), buyerId: b1, trade: 'roofing', status: 'scheduled', created: now - 70 * H,
          description: 'A few shingles blew off in last week\'s storm. Need them replaced and the roof checked.',
          address: '42 Maple Ave, Springfield', zip: '62704', timeframe: '2weeks', budget: '1-5k', photos: [],
          contractorId: c3, scheduledFor: new Date(now + 48 * H).toISOString().slice(0, 16), value: 1800, notes: 'Insurance claim filed.',
          log: [{ at: now - 70 * H, text: 'Lead received' }, { at: now - 60 * H, text: 'Status → Qualifying' }, { at: now - 40 * H, text: 'Status → Scheduled · Ray Johnson' }],
        },
      ],
    };
  }

  let dbPromise = null;
  function db() {
    if (!dbPromise) dbPromise = (async () => { let d = readDb(); if (!d) { d = await seed(); writeDb(d); } return d; })();
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
          id: uid(), buyerId: u.id, status: 'new', created: now,
          trade: job.trade, description: job.description.trim(), address: job.address.trim(), zip: (job.zip || '').trim(),
          timeframe: job.timeframe, budget: job.budget || '', photos: job.photos || [],
          contractorId: null, scheduledFor: null, value: null, notes: '',
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
            id: j.id, trade: j.trade, status: j.status, created: j.created, description: j.description, address: j.address,
            timeframe: j.timeframe, budget: j.budget, photos: j.photos, scheduledFor: j.scheduledFor,
            contractorName: c && ['scheduled', 'in_progress', 'completed'].includes(j.status) ? c.name : null,
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
        if ('contractorId' in patch && patch.contractorId !== j.contractorId) j.log.push({ at: Date.now(), text: `Assigned to ${cname(patch.contractorId)}` });
        if ('scheduledFor' in patch && patch.scheduledFor !== j.scheduledFor && patch.scheduledFor) j.log.push({ at: Date.now(), text: `Scheduled for ${new Date(patch.scheduledFor).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` });
        for (const k of ['status', 'contractorId', 'scheduledFor', 'value', 'notes']) if (k in patch) j[k] = patch[k];
        writeDb(d);
        return j;
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

  window.TH = { api, TRADES, TIMEFRAMES, BUDGETS, STATUSES, el, ago, fmtWhen, find, shrinkImage };
})();
