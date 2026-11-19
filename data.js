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
    { id: 'concrete', label: 'Concrete', icon: '🪨' },
    { id: 'decks', label: 'Decks & patios', icon: '🪚' },
    { id: 'fencing', label: 'Fencing', icon: '🚧' },
    { id: 'siding', label: 'Siding', icon: '🏘️' },
    { id: 'windows', label: 'Windows & doors', icon: '🪟' },
    { id: 'other', label: 'Something else', icon: '📋' },
  ];
  // What a contractor can do: "does it all" (general) or the trades they specialize in.
  const SKILLS = [{ id: 'allround', label: 'Does it all (general)', icon: '🧰' }, ...TRADES.filter((t) => t.id !== 'other')];
  const doesTrade = (c, trade) => (c.trades || []).includes('allround') || (c.trades || []).includes(trade);

  // Sample design styles customers pick from: three looks for each room.
  const STYLE_ROOMS = [
    { id: 'kitchen', label: 'Kitchen', icon: '🍳', words: ['kitchen', 'cabinet', 'countertop', 'island', 'backsplash'], styles: [
      { id: 'modern', name: 'Modern', desc: 'Flat white cabinets, black hardware, quartz counters' },
      { id: 'farmhouse', name: 'Farmhouse', desc: 'White shaker cabinets, wood accents, apron sink' },
      { id: 'classic', name: 'Classic warm', desc: 'Wood cabinets, cream counters, traditional trim' }] },
    { id: 'bathroom', label: 'Bathroom', icon: '🛁', words: ['bath', 'shower', 'tub', 'vanity', 'toilet'], styles: [
      { id: 'spa', name: 'Modern spa', desc: 'Walk-in glass shower, floating vanity, large tile' },
      { id: 'farmhouse', name: 'Farmhouse', desc: 'Shaker vanity, subway tile, black fixtures' },
      { id: 'classic', name: 'Classic', desc: 'Tub and shower, wood vanity, warm tones' }] },
    { id: 'living', label: 'Living room', icon: '🛋️', words: ['living', 'family room', 'den', 'fireplace'], styles: [
      { id: 'modern', name: 'Modern', desc: 'Clean lines, light walls, big windows' },
      { id: 'farmhouse', name: 'Farmhouse', desc: 'Shiplap wall, wood beams, cozy colors' },
      { id: 'classic', name: 'Traditional', desc: 'Fireplace with mantel, crown molding, rich colors' }] },
    { id: 'bedroom', label: 'Bedroom', icon: '🛏️', words: ['bedroom', 'closet', 'master'], styles: [
      { id: 'modern', name: 'Calm modern', desc: 'Soft gray walls, simple lines, wood floor' },
      { id: 'farmhouse', name: 'Cozy farmhouse', desc: 'Board-and-batten wall, warm wood, soft whites' },
      { id: 'classic', name: 'Classic', desc: 'Wainscoting, deep color, traditional trim' }] },
    { id: 'basement', label: 'Basement', icon: '🏚️', words: ['basement', 'lower level', 'rec room'], styles: [
      { id: 'family', name: 'Family room', desc: 'Open space, sectional, bright lighting' },
      { id: 'theater', name: 'Home theater', desc: 'Dark walls, big screen, theater seats' },
      { id: 'guest', name: 'Guest suite', desc: 'Bedroom corner, bath nearby, warm and finished' }] },
    { id: 'garage', label: 'Garage', icon: '🚗', words: ['garage', 'workshop', 'epoxy'], styles: [
      { id: 'clean', name: 'Clean & simple', desc: 'Painted walls, epoxy floor, bright lights' },
      { id: 'workshop', name: 'Workshop', desc: 'Workbench, pegboard, tool storage' },
      { id: 'showroom', name: 'Showroom', desc: 'Gray flake floor, slat wall, cabinets' }] },
  ];
  const STYLE_TRADES = ['remodel', 'painting', 'flooring', 'drywall', 'other'];
  // Which room the customer is talking about, from what they typed (or '' if we can't tell).
  const roomFromText = (t) => { const x = String(t || '').toLowerCase(); const r = STYLE_ROOMS.find((rm) => rm.words.some((w) => x.includes(w))); return r ? r.id : ''; };
  const styleOf = (key) => { const [room, id] = String(key || '').split('/'); const r = STYLE_ROOMS.find((x) => x.id === room); const st = r && r.styles.find((x) => x.id === id);
    return st ? { key: `${r.id}/${st.id}`, room: r, style: st, label: `${r.label}: ${st.name}`, img: `img/styles/${r.id}-${st.id}.svg` } : null; };
  const MATERIAL_STATUS = [
    { id: 'needed', label: 'Needs ordering', icon: '🛒' },
    { id: 'ordered', label: 'Ordered', icon: '📦' },
    { id: 'delivered', label: 'Delivered', icon: '✅' },
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
    { id: 'qualifying', label: 'Phone estimate', buyer: 'Estimate call' },
    // The customer agreed to the price on the phone (or approved the written estimate): worth sending a rep.
    { id: 'hot', label: 'Hot lead', buyer: 'Price agreed' },
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
      // Time on the job: first start, and when it was finished.
      if (next === 'in_progress' && !j.startedAt) j.startedAt = Date.now();
      if (next === 'completed' && j.status !== 'completed') j.finishedAt = Date.now();
      if (next !== 'completed') j.finishedAt = null;
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
  // US states (and DC). Jobs and contractors are organized by state.
  const US_STATES = [['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'],
    ['DE', 'Delaware'], ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'],
    ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'],
    ['MN', 'Minnesota'], ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'],
    ['NM', 'New Mexico'], ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'],
    ['RI', 'Rhode Island'], ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'],
    ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming']];
  const stateName = (code) => (US_STATES.find(([c]) => c === code) || [])[1] || '';
  const cleanState = (s) => { const c = String(s || '').trim().toUpperCase(); return US_STATES.some(([x]) => x === c) ? c : ''; };
  // Best guess of the state from the first 3 digits of a ZIP code (the customer can change it).
  const ZIP3 = [[5, 5, 'NY'], [10, 27, 'MA'], [28, 29, 'RI'], [30, 38, 'NH'], [39, 49, 'ME'], [50, 59, 'VT'], [60, 69, 'CT'], [70, 89, 'NJ'], [100, 149, 'NY'],
    [150, 196, 'PA'], [197, 199, 'DE'], [200, 200, 'DC'], [201, 201, 'VA'], [202, 205, 'DC'], [206, 219, 'MD'], [220, 246, 'VA'], [247, 268, 'WV'], [270, 289, 'NC'],
    [290, 299, 'SC'], [300, 319, 'GA'], [320, 349, 'FL'], [350, 369, 'AL'], [370, 385, 'TN'], [386, 397, 'MS'], [398, 399, 'GA'], [400, 427, 'KY'], [430, 459, 'OH'],
    [460, 479, 'IN'], [480, 499, 'MI'], [500, 528, 'IA'], [530, 549, 'WI'], [550, 567, 'MN'], [569, 569, 'DC'], [570, 577, 'SD'], [580, 588, 'ND'], [590, 599, 'MT'],
    [600, 629, 'IL'], [630, 658, 'MO'], [660, 679, 'KS'], [680, 693, 'NE'], [700, 714, 'LA'], [716, 729, 'AR'], [730, 732, 'OK'], [733, 733, 'TX'], [734, 749, 'OK'],
    [750, 799, 'TX'], [800, 816, 'CO'], [820, 831, 'WY'], [832, 838, 'ID'], [840, 847, 'UT'], [850, 865, 'AZ'], [870, 884, 'NM'], [885, 885, 'TX'], [889, 898, 'NV'],
    [900, 961, 'CA'], [967, 968, 'HI'], [970, 979, 'OR'], [980, 994, 'WA'], [995, 999, 'AK']];
  const stateFromZip = (zip) => { const z = String(zip || '').trim(); if (!/^\d{5}/.test(z)) return ''; const n = Number(z.slice(0, 3)); return (ZIP3.find(([a, b]) => n >= a && n <= b) || [])[2] || ''; };
  // "42 Maple Ave, Springfield, IL 62704"
  const addrLine = (j) => [j.address, [j.state, j.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
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
    estimatePaymentInstructions: 'We accept Zelle, check, cash and card.',
    // How a contractor's pay is split; they bill Top Hat at each step.
    crewPaySchedule: [
      { label: 'Work started', pct: 30, when: 'start' },
      { label: 'Halfway done', pct: 30, when: 'mid' },
      { label: 'Job finished', pct: 40, when: 'done' },
    ],
    // When each payment is due. Invoices are made from it during the job.
    paymentSchedule: [
      { label: 'Insurance payment', pct: 50, when: 'insurance' },
      { label: 'Framing', pct: 25, when: 'stage' },
      { label: 'Roofing, insulation & sheetrock', pct: 15, when: 'stage' },
      { label: 'Final: painting, finish work & cleanup', pct: 10, when: 'done' },
    ],
    paymentInstructions: 'We accept cash, check, Zelle, card, Venmo and Cash App.\nMake checks payable to Top Hat Contracting.',
    estimateTerms: 'This estimate is valid for 30 days. Work begins once the estimate is approved.',
    invoiceTerms: 'Thank you for choosing Top Hat Contracting!',
    reviewLink: '', // e.g. your Google review link; customers get it after they rate the job
  };
  const isoDay = (ms) => new Date(ms - new Date(ms).getTimezoneOffset() * 60e3).toISOString().slice(0, 10);
  const docTotal = (doc) => {
    const sub = (doc.items || []).reduce((t, i) => t + (Number(i.qty) || 0) * (Number(i.price) || 0), 0);
    return Math.round(sub * (1 + (Number(doc.taxRate) || 0) / 100) * 100) / 100;
  };
  const usd = (n) => '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });

  // Preview starts clean: just the four demo logins (office, salesperson, customer, contractor), no jobs.
  // Automated tests can ask for sample jobs with localStorage 'tophat.demo.quiet' (small) or 'tophat.demo.busy' (a busy week).
  async function seed() {
    const now = Date.now();
    const H = 3600 * 1000;
    const pw = await hash('tophat');
    const buyerPw = await hash('demo1234');
    const c1 = uid(), c2 = uid(), c3 = uid(), cu3 = uid();
    const crewPw = await hash('crew1234');
    const s1 = uid(), su1 = uid();
    const salesPw = await hash('sales1234');
    const b1 = uid(), b2 = uid();
    const data = {
      demoVersion: DEMO_VERSION,
      users: [
        { id: uid(), role: 'staff', name: 'Top Hat Office', email: 'office@tophat.demo', phone: '', password: pw, created: now },
        { id: b1, role: 'buyer', name: 'Dana Whitfield', email: 'dana@example.com', phone: '(555) 201-3344', password: buyerPw, created: now - 30 * H },
        { id: su1, role: 'sales', salesId: s1, name: 'Maria Lopez', email: 'maria@tophat.demo', phone: '(555) 444-1212', password: salesPw, created: now - 300 * H },
        { id: cu3, role: 'crew', contractorId: c3, name: 'Ray Johnson', email: 'ray@tophat.demo', phone: '(555) 300-4455', password: crewPw, created: now - 200 * H },
        ...(sampleDemo() ? [{ id: b2, role: 'buyer', name: 'Luis Romero', email: 'luis@example.com', phone: '(555) 410-9821', password: buyerPw, created: now - 75 * H }] : []),
      ],
      contractors: [
        ...(sampleDemo() ? [{ id: c1, name: 'Mike Alvarez', phone: '(555) 300-1122', trades: ['plumbing', 'hvac'], active: true },
          { id: c2, name: 'Sarah Kim', phone: '(555) 300-7788', trades: ['painting', 'drywall', 'flooring'], active: true }] : []),
        { id: c3, name: 'Ray Johnson', phone: '(555) 300-4455', trades: ['roofing', 'remodel', 'electrical'], active: true, userId: cu3, inviteCode: null },
      ],
      jobs: !sampleDemo() ? [] : [
        {
          id: uid(), buyerId: b1, trade: 'plumbing', status: 'new', created: now - 2 * H,
          description: 'Kitchen sink is leaking under the cabinet. Water damage starting on the cabinet floor.',
          address: '42 Maple Ave, Springfield', zip: '62704', timeframe: 'asap', budget: 'u1k', photos: [],
          number: 1001, files: [], contractorId: null, scheduledFor: null, price: null, crewPay: null, notes: '',
          log: [{ at: now - 2 * H, text: 'Lead received' }],
        },
        {
          id: uid(), buyerId: b2, trade: 'painting', status: 'hot', created: now - 26 * H,
          visitAt: (() => { const t = new Date(now + 24 * H); t.setHours(16, 0, 0, 0); return new Date(t - t.getTimezoneOffset() * 60e3).toISOString().slice(0, 16); })(),
          description: 'Interior painting for 3 bedrooms and a hallway. Walls only, ceilings are fine.',
          address: '18 Oak Ridge Dr, Springfield', zip: '62711', timeframe: '2weeks', budget: '1-5k', photos: [],
          number: 1002, files: [], salesId: s1, contractorId: null, scheduledFor: null, price: 3200, crewPay: null, notes: 'Agreed to $3,200 on the phone. Rooms are roughly 12x12.',
          log: [{ at: now - 26 * H, text: 'Lead received' }, { at: now - 22 * H, text: 'Salesperson → Maria Lopez' },
            { at: now - 21 * H, text: '📞 Call (Maria Lopez): Talked. Gave a phone estimate of $3,200.' }, { at: now - 20 * H, text: 'Status → Phone estimate' },
            { at: now - 19 * H, text: '📞 Phone estimate $3,200: customer agreed' }, { at: now - 19 * H, text: 'Status → Hot lead' }, { at: now - 18 * H, text: '🤝 Rep visit booked' }],
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
      nextNumber: sampleDemo() ? 1004 : 1001,
      team: [{ id: s1, name: 'Maria Lopez', phone: '(555) 444-1212', active: true, userId: su1, inviteCode: null }],
      settings: { ...DEFAULT_SETTINGS, phone: '(555) 867-5309', email: 'office@tophat.demo' },
    };
    if (busyDemo()) addBusyDemo(data, { c1, c2, c3, s1 });
    if (sampleDemo()) data.demoStates = true; else data.contractors.forEach((c) => { c.state = 'IL'; });
    return data;
  }

  // A busy week, so the preview shows every stage without setting anything up.
  // Tests can ask for the small sample by setting localStorage 'tophat.demo.quiet'.
  const flag = (k) => { try { return !!localStorage.getItem(k); } catch (e) { return false; } };
  const quietDemo = () => flag('tophat.demo.quiet');
  const busyDemo = () => flag('tophat.demo.busy') && !quietDemo();
  const sampleDemo = () => quietDemo() || busyDemo();
  const DEMO_VERSION = 5;
  function addBusyDemo(d, ids) {
    const now = Date.now();
    const H = 3600e3, DAY = 24 * H;
    const when = (days, h, m = 0) => { const t = new Date(now + days * DAY); t.setHours(h, m, 0, 0); return t; };
    const local = (t) => new Date(t - t.getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
    const dayKey = (t) => local(t).slice(0, 10);
    const fmt = (t) => t.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

    const crew = {
      ray: ids.c3, mike: ids.c1, sarah: ids.c2,
      derek: uid(), andre: uid(), jasmine: uid(), lou: uid(),
    };
    d.contractors.push(
      { id: crew.derek, name: 'Derek Coleman', phone: '(555) 300-2211', trades: ['roofing', 'remodel'], active: true },
      { id: crew.andre, name: 'Andre Mitchell', phone: '(555) 300-6633', trades: ['electrical', 'hvac'], active: true },
      { id: crew.jasmine, name: 'Jasmine Ortiz', phone: '(555) 300-9044', trades: ['painting', 'drywall'], active: true },
      { id: crew.lou, name: 'Lou Bianchi', phone: '(555) 300-5170', trades: ['flooring', 'landscaping'], active: true },
    );
    const crewName = (cid) => d.contractors.find((c) => c.id === cid).name;
    const sales = { maria: ids.s1, jake: uid(), tasha: uid() };
    d.team.push(
      { id: sales.jake, name: 'Jake Thornton', phone: '(555) 444-3090', active: true, userId: null, inviteCode: null },
      { id: sales.tasha, name: 'Tasha Green', phone: '(555) 444-7781', active: true, userId: null, inviteCode: null },
    );
    const salesName = (sid) => d.team.find((x) => x.id === sid).name;

    const estimate = (price, lines, status, createdMs) => ({
      id: uid(), type: 'estimate', number: '', status, taxRate: 0, payments: [], dueDate: null, payLink: '',
      items: lines.map(([desc, share]) => ({ desc, qty: 1, price: Math.round(price * share) })),
      notes: DEFAULT_SETTINGS.estimateTerms, created: createdMs, sentAt: createdMs + H,
      respondedAt: status === 'approved' ? createdMs + 5 * H : null, respondedBy: status === 'approved' ? 'Customer (by phone)' : null,
    });
    const STEP = [['Insurance payment', 50], ['Framing', 25], ['Roofing, insulation & sheetrock', 15], ['Final: painting, finish work & cleanup', 10]];
    const r2 = (n) => Math.round(n * 100) / 100;
    // One payment on the schedule. pays: [[amount or 'all', method, ms]]
    const pay = (base, est, step, sentMs, dueDays, pays = []) => step === 2 ? [inv(base, est, 2, sentMs, dueDays, pays), inv(base, est, 3, sentMs + 60e3, dueDays, pays)] : inv(base, est, step, sentMs, dueDays, pays);
    const inv = (base, est, step, sentMs, dueDays, pays = []) => {
      const amts = [r2(base * 0.5), r2(base * 0.25), r2(base * 0.15)]; amts.push(r2(base - amts[0] - amts[1] - amts[2]));
      return {
        id: uid(), type: 'invoice', number: '', status: 'sent', taxRate: 0, fromEstimateId: est ? est.id : null, scheduleStep: step, scheduleBase: base,
        items: [{ desc: `${STEP[step][0]}: ${STEP[step][1]}% of $${base.toLocaleString()}${est ? ' (estimate)' : ''}`, qty: 1, price: amts[step] }],
        notes: DEFAULT_SETTINGS.invoiceTerms, payLink: '', created: sentMs, sentAt: sentMs, dueDate: dayKey(new Date(sentMs + dueDays * DAY)),
        payments: pays.map(([amount, method, ms]) => ({ id: uid(), amount: amount === 'all' ? amts[step] : amount, method, date: dayKey(new Date(ms)), note: '' })),
      };
    };

    // One job, with a believable history for wherever it is now.
    function job(o) {
      const created = now - o.ago * H;
      const log = [{ at: created, text: o.salesId && o.phoneIn ? `Job entered by ${salesName(o.salesId)} (sales)` : 'Lead received' }];
      let t = created + 0.5 * H;
      const add = (text) => { t = Math.min(t + 2 * H, now - 60e3); log.push({ at: t, text }); };
      const reached = (st) => ['qualifying', 'hot', 'scheduled', 'in_progress', 'completed'].indexOf(st) <= ['qualifying', 'hot', 'scheduled', 'in_progress', 'completed'].indexOf(o.status);
      if (o.salesId && !o.phoneIn) add(`Salesperson → ${salesName(o.salesId)}`);
      if (o.status !== 'new' && o.status !== 'lost' && o.price != null) {
        add(`📞 Call (${o.salesId ? salesName(o.salesId) : 'Top Hat Office'}): ${reached('hot') ? 'Agreed to the price' : 'Thinking it over'}. Phone estimate $${o.price.toLocaleString()}`);
        add('Status → Phone estimate');
        if (reached('hot')) add('Status → Hot lead');
      }
      if (o.visitAt) add(`🤝 Rep visit booked for ${fmt(o.visitAt)}`);
      if (o.contractorId) { add(`Assigned to ${crewName(o.contractorId)}`); add(`Scheduled for ${fmt(o.when)}`); add('Status → Scheduled'); }
      if (o.crewResponse) log.push({ at: o.crewResponseAt, text: o.crewResponse === 'confirmed' ? `Confirmed by ${crewName(o.contractorId)} (crew)` : `${crewName(o.contractorId)} can’t make it: “${o.crewResponseNote}” (crew)` });
      if (o.startedAt) log.push({ at: o.startedAt, text: `Status → In progress (by ${crewName(o.contractorId)}, crew)` });
      if (o.finishedAt) log.push({ at: o.finishedAt, text: `Status → Completed (by ${crewName(o.contractorId)}, crew)` });
      (o.extraLog || []).forEach((x) => log.push(x));
      if (o.status === 'lost') log.push({ at: created + 4 * H, text: '📞 Call (Top Hat Office): Not interested. Went with a cheaper quote.' }, { at: created + 4 * H, text: 'Status → Not a fit' });
      log.sort((a, b) => a.at - b.at);
      const [name, phone, email] = o.who;
      return {
        id: uid(), number: 0, buyerId: o.buyerId || null, salesId: o.salesId || null,
        contact: o.buyerId ? null : { name, phone, email: email || '' },
        status: o.status, created, files: [], docs: (o.docs || []).flat(),
        trade: o.trade, description: o.desc, address: o.address, zip: o.zip || '62704', state: o.state || stateFromZip(o.zip || '62704'),
        timeframe: o.timeframe || '', budget: o.budget || '', photos: [],
        contractorId: o.contractorId || null, crewToken: o.contractorId ? newToken() : null,
        scheduledFor: o.when ? local(o.when) : null, visitAt: o.visitAt ? local(o.visitAt) : null,
        price: o.price ?? null, crewPay: o.crewPay ?? null, notes: o.notes || '',
        log, crewNotes: (o.crewNotes || []).map(([text, ms]) => ({ id: uid(), at: ms, contractorId: o.contractorId, by: crewName(o.contractorId), text })),
        crewNotesSeenAt: o.unseen ? 0 : now,
        stage: o.stage || null, progressAt: o.progressAt || (o.contractorId ? t : null), progressBy: o.progressBy || '', progressByCrew: !!o.progressByCrew,
        crewResponse: o.crewResponse || null, crewResponseNote: o.crewResponseNote || '', crewResponseAt: o.crewResponseAt || null,
        startedAt: o.startedAt || null, finishedAt: o.finishedAt || null, crewPaid: o.crewPaid || null,
      };
    }

    const kitchenEst = estimate(2450, [['Remove old tile and backer board', 0.3], ['New porcelain tile floor, 5 x 8 ft bathroom', 0.55], ['Materials and haul-away', 0.15]], 'sent', now - 30 * H);
    const hvacEst = estimate(7900, [['Remove old furnace and AC unit', 0.15], ['New 3-ton high-efficiency system, installed', 0.75], ['Permit and thermostat', 0.1]], 'approved', now - 50 * H);
    const roofEst = estimate(9200, [['Tear off 2 layers, 24 squares', 0.3], ['Architectural shingles, installed', 0.6], ['Dumpster and cleanup', 0.1]], 'approved', now - 20 * DAY);
    const floorEst = estimate(5100, [['Luxury vinyl plank, 620 sq ft installed', 0.8], ['Baseboard and transitions', 0.2]], 'approved', now - 22 * DAY);
    const panelEst = estimate(2900, [['200 amp panel upgrade', 0.85], ['Permit and inspection', 0.15]], 'approved', now - 40 * DAY);
    const bathEst = estimate(14500, [['Demo master bathroom', 0.1], ['Walk-in shower, tile and glass', 0.5], ['Vanity, toilet and fixtures', 0.3], ['Plumbing and electrical', 0.1]], 'approved', now - 75 * DAY);

    d.jobs.push(
      // New leads: call them with a phone estimate
      job({ who: ['Brenda Holt', '(555) 212-8890', 'brenda.holt@example.com'], ago: 0.4, status: 'new', trade: 'roofing',
        desc: 'Water stain on the bedroom ceiling after the last storm. Think the roof is leaking near the chimney.\n\nMeasurements: Two-story colonial, about 2,200 sq ft', address: '77 Chestnut St, Springfield', timeframe: dayKey(when(5, 9)), budget: '1-5k' }),
      job({ who: ['Kevin Osei', '(555) 318-4402', 'kosei@example.com'], ago: 5, status: 'new', trade: 'electrical',
        desc: 'Breakers keep tripping when the AC and microwave run together. Old fuse-style panel in the basement.', address: '310 Walnut Ave, Springfield', timeframe: 'flexible', budget: '1-5k' }),
      // Thinking it over / estimate waiting
      job({ who: ['Rachel Simmons', '(555) 671-2290', 'rsimmons@example.com'], ago: 52, status: 'qualifying', trade: 'remodel', salesId: sales.jake, price: 6800,
        desc: 'Refresh the kitchen: new countertops, backsplash and paint the cabinets.\n\nMeasurements: Kitchen about 12 x 14 ft, 22 ft of counter', address: '15 Birchwood Ct, Springfield', budget: '5-15k',
        notes: 'Liked the number. Wants to talk it over with her husband this weekend.' }),
      job({ who: ['Tom Becker', '(555) 433-1187', 'tbecker@example.com'], ago: 34, status: 'qualifying', trade: 'flooring', salesId: sales.tasha, price: 2450, docs: [kitchenEst],
        desc: 'Replace cracked bathroom floor tile.\n\nMeasurements: Bathroom 5 x 8 ft', address: '902 Lakeview Dr, Springfield', budget: '1-5k',
        notes: 'Wanted it in writing before saying yes. Estimate sent.' }),
      // Hot leads
      job({ who: ['Angela Price', '(555) 780-3345', 'aprice@example.com'], ago: 7, status: 'hot', trade: 'landscaping', salesId: sales.jake, price: 4200,
        desc: 'New paver patio off the back door, about 16 x 20 ft, with a small fire pit.', address: '48 Meadow Ln, Springfield', budget: '1-5k',
        notes: 'Agreed to $4,200 on the phone. Needs a visit to confirm grade and drainage.' }),
      job({ who: ['Marcus Hill', '(555) 290-6618', 'mhill@example.com'], ago: 28, status: 'hot', trade: 'flooring', salesId: sales.tasha, price: 5600, visitAt: new Date(now + 3 * H),
        desc: 'Hardwood throughout the first floor. Carpet comes out.\n\nMeasurements: Living 15 x 20, dining 12 x 12, hall 4 x 18', address: '1220 Summit Rd, Springfield', budget: '5-15k' }),
      job({ who: ['Linda Park', '(555) 365-9021', 'lindapark@example.com'], ago: 75, status: 'hot', trade: 'hvac', salesId: sales.maria, price: 7900, visitAt: when(-1, 15), docs: [hvacEst],
        desc: 'Furnace is 22 years old and the AC barely cools. Want both replaced before winter.', address: '64 Orchard Way, Springfield', budget: '5-15k',
        notes: 'Maria visited yesterday. Ready to go, wants it done next week.' }),
      // Scheduled
      job({ who: ['Frank Delgado', '(555) 520-7734', 'fdelgado@example.com'], ago: 6 * 24, status: 'scheduled', trade: 'roofing', salesId: sales.maria, price: 1350, crewPay: 850,
        contractorId: crew.ray, when: when(0, 8), crewResponse: 'confirmed', crewResponseAt: now - 30 * H,
        docs: [pay(1350, null, 0, now - 5 * DAY, 7, [['all', 'Zelle', now - 5 * DAY + 3 * H]])],
        stage: 'on_the_way', progressAt: now - 0.3 * H, progressBy: 'Ray Johnson', progressByCrew: true, unseen: true,
        desc: 'Gutters pulling away from the fascia on the front of the house. Replace 40 ft of gutter and two downspouts.', address: '5 Elm Pl, Springfield' }),
      job({ who: ['Nicole Brooks', '(555) 847-2093', 'nbrooks@example.com'], ago: 5 * 24, status: 'scheduled', trade: 'painting', salesId: sales.tasha, price: 3100, crewPay: 1900,
        docs: [pay(3100, null, 0, now - 2 * DAY, 7)],
        contractorId: crew.sarah, when: when(1, 9), crewResponse: 'declined', crewResponseNote: 'Truck is in the shop until Monday', crewResponseAt: now - 3 * H,
        progressAt: now - 3 * H, progressBy: 'Sarah Kim', progressByCrew: true,
        desc: 'Paint the exterior trim, front door and shutters.', address: '233 Hawthorne St, Springfield' }),
      job({ who: ['Omar Haddad', '(555) 614-5530', 'ohaddad@example.com'], ago: 4 * 24, status: 'scheduled', trade: 'electrical', salesId: sales.jake, price: 1850,
        contractorId: crew.andre, when: when(3, 10),
        desc: 'Add 6 recessed lights in the living room and a ceiling fan in the bedroom.', address: '19 Ridge Ct, Springfield' }),
      // Working
      job({ who: ['Sharon Whitley', '(555) 902-3317', 'swhitley@example.com'], ago: 16 * 24, status: 'in_progress', trade: 'remodel', salesId: sales.maria, price: 11800, crewPay: 7400,
        contractorId: crew.ray, when: when(-3, 8), crewResponse: 'confirmed', crewResponseAt: now - 8 * DAY, startedAt: msAt(-3, 8, 20),
        docs: [pay(11800, null, 0, now - 12 * DAY, 7, [['all', 'Check', now - 10 * DAY]]), pay(11800, null, 1, now - 1 * DAY, 7)],
        stage: 'waiting_parts', progressAt: now - 2 * H, progressBy: 'Ray Johnson', progressByCrew: true, unseen: true,
        crewNotes: [['Demo done. Subfloor under the tub was rotted, replaced a 4 x 5 section.', now - 2 * DAY], ['Vanity on backorder from the supplier, ETA Thursday. Tile is going in meanwhile.', now - 2 * H]],
        desc: 'Hall bathroom remodel: new tub surround, tile floor, vanity and lighting.', address: '88 Sycamore Dr, Springfield' }),
      job({ who: ['Paul Jensen', '(555) 248-6609', 'pjensen@example.com'], ago: 9 * 24, status: 'in_progress', trade: 'plumbing', price: 3400, crewPay: 2100,
        contractorId: crew.mike, when: when(-1, 7, 30), crewResponse: 'confirmed', crewResponseAt: now - 4 * DAY, startedAt: msAt(-1, 7, 45),
        docs: [pay(3400, null, 0, now - 8 * DAY, 7, [['all', 'Zelle', now - 7 * DAY]])],
        progressAt: msAt(-1, 7, 45), progressBy: 'Mike Alvarez', progressByCrew: true,
        desc: 'Replace galvanized supply lines with PEX from the meter to the kitchen and both bathrooms.', address: '410 Cedar Ave, Springfield' }),
      // Done: invoice and payments
      job({ who: ['Diane Morales', '(555) 733-0912', 'dmorales@example.com'], ago: 12 * 24, status: 'completed', trade: 'drywall', salesId: sales.tasha, price: 980, crewPay: 560,
        contractorId: crew.jasmine, when: when(-1, 9), crewResponse: 'confirmed', crewResponseAt: now - 6 * DAY, startedAt: msAt(-1, 9, 10), finishedAt: msAt(-1, 14, 40),
        docs: [pay(980, null, 0, now - 10 * DAY, 7, [['all', 'Cash', now - 9 * DAY]]), pay(980, null, 1, msAt(-1, 9, 30), 7, [['all', 'Zelle', msAt(-1, 12)]])],
        desc: 'Patch and texture a water-damaged ceiling in the living room, about 4 x 6 ft.', address: '27 Poplar St, Springfield' }),
      job({ crewPaid: { date: dayKey(new Date(now - 11 * DAY)), method: 'Zelle', note: '' }, who: ['Gregory Shaw', '(555) 456-2280', 'gshaw@example.com'], ago: 26 * 24, status: 'completed', trade: 'roofing', salesId: sales.jake, price: 9200, crewPay: 5900,
        contractorId: crew.derek, when: when(-13, 7), crewResponse: 'confirmed', crewResponseAt: now - 18 * DAY, startedAt: msAt(-13, 7, 15), finishedAt: msAt(-12, 16, 30),
        docs: [roofEst, pay(9200, roofEst, 0, now - 19 * DAY, 7, [['all', 'Check', now - 18 * DAY]]), pay(9200, roofEst, 1, msAt(-13, 9), 7, [['all', 'ACH', msAt(-13, 16)]]), pay(9200, roofEst, 2, msAt(-12, 18), 7)],
        desc: 'Full roof replacement after hail damage. Insurance job.', address: '1504 Prairie Rd, Springfield', notes: 'Insurance check expected. Follow up on payment.' }),
      job({ who: ['Yvonne Carter', '(555) 389-7710', 'ycarter@example.com'], ago: 28 * 24, status: 'completed', trade: 'flooring', salesId: sales.tasha, price: 5100, crewPay: 3300,
        contractorId: crew.lou, when: when(-16, 8), crewResponse: 'confirmed', crewResponseAt: now - 20 * DAY, startedAt: msAt(-16, 8, 5), finishedAt: msAt(-14, 15),
        docs: [floorEst, pay(5100, floorEst, 0, now - 21 * DAY, 7, [['all', 'Zelle', now - 21 * DAY]]), pay(5100, floorEst, 1, msAt(-16, 9), 7, [['all', 'Zelle', msAt(-15, 10)]]), pay(5100, floorEst, 2, msAt(-14, 17), 30, [[600, 'Zelle', msAt(-13, 11)]])],
        desc: 'Luxury vinyl plank in the living room, dining room and hallway.', address: '61 Willow Bend, Springfield' }),
      job({ crewPaid: { date: dayKey(new Date(now - 33 * DAY)), method: 'Zelle', note: '' }, who: ['Henry Walsh', '(555) 502-6644', 'hwalsh@example.com'], ago: 45 * 24, status: 'completed', trade: 'electrical', salesId: sales.maria, price: 2900, crewPay: 1750,
        contractorId: crew.ray, when: when(-36, 8), crewResponse: 'confirmed', crewResponseAt: now - 38 * DAY, startedAt: msAt(-36, 8, 10), finishedAt: msAt(-36, 15, 30),
        docs: [panelEst, pay(2900, panelEst, 0, now - 39 * DAY, 7, [['all', 'Check', now - 38 * DAY]]), pay(2900, panelEst, 1, msAt(-36, 8, 30), 7, [['all', 'Check', msAt(-36, 12)]]), pay(2900, panelEst, 2, msAt(-36, 17), 14, [['all', 'Check', msAt(-30, 10)]])],
        desc: 'Upgrade the 100 amp panel to 200 amp.', address: '8 Fox Run, Springfield' }),
      job({ crewPaid: { date: dayKey(new Date(now - 58 * DAY)), method: 'Check', note: 'Check #2114' }, who: ['Carla Nguyen', '(555) 677-4129', 'cnguyen@example.com'], ago: 80 * 24, status: 'completed', trade: 'remodel', salesId: sales.maria, price: 14500, crewPay: 9200,
        contractorId: crew.ray, when: when(-68, 8), crewResponse: 'confirmed', crewResponseAt: now - 70 * DAY, startedAt: msAt(-68, 8), finishedAt: msAt(-61, 16),
        docs: [bathEst, pay(14500, bathEst, 0, now - 72 * DAY, 7, [['all', 'ACH', now - 71 * DAY]]), pay(14500, bathEst, 1, msAt(-68, 9), 7, [['all', 'ACH', msAt(-66, 9)]]), pay(14500, bathEst, 2, msAt(-61, 17), 14, [['all', 'ACH', msAt(-58, 9)]])],
        desc: 'Master bathroom remodel with a walk-in shower.', address: '300 Highland Ave, Springfield' }),
      // Closed
      job({ who: ['Gary Fields', '(555) 118-5523', 'gfields@example.com'], ago: 8 * 24, status: 'lost', trade: 'hvac', price: 6200,
        desc: 'Want a quote for central air in a house that has none.', address: '72 Brookside Dr, Springfield' }),
    );
    function msAt(days, h, m = 0) { return when(days, h, m).getTime(); }

    // Number jobs oldest first, so job numbers read like a real history.
    d.jobs.sort((a, b) => a.created - b.created).forEach((j, i) => {
      j.number = 1001 + i;
      j.docs = j.docs || [];
      const count = {};
      j.docs.forEach((doc) => {
        count[doc.type] = (count[doc.type] || 0) + 1;
        doc.number = `${doc.type === 'invoice' ? 'INV' : 'E'}-${j.number}${count[doc.type] > 1 ? '-' + count[doc.type] : ''}`;
      });
    });
    d.jobs.reverse();
    d.nextNumber = 1001 + d.jobs.length;
  }

  // Bring older preview data up to date.
  function migrate(d) {
    d.jobs.forEach((j) => { if (j.state == null) j.state = stateFromZip(j.zip); });
    d.contractors.forEach((c) => { if (c.state == null) c.state = ''; });
    // The old 3-payment default (50/25/25) moves to the 4-payment insurance schedule.
    const ps = d.settings && d.settings.paymentSchedule;
    if (Array.isArray(ps) && ps.map((x) => `${x.label}|${x.pct}|${x.when}`).join() === 'Deposit|50|sold,Progress payment|25|start,Final payment|25|done') delete d.settings.paymentSchedule;
    d.settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
    if (!d.settings.phone && !d.settings.email) Object.assign(d.settings, { phone: '(555) 867-5309', email: 'office@tophat.demo' }); // sample contact so the buttons show
    d.team = d.team || [];
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

  // Preview data saved before a feature existed may lack its sample login. Add it, without touching anything else.
  async function addMissingSamples(d) {
    const now = Date.now();
    const has = (email) => d.users.some((u) => u.email === email);
    if (!has('maria@tophat.demo')) {
      let sp = d.team.find((x) => x.name === 'Maria Lopez' && !x.userId);
      if (!sp) { sp = { id: uid(), name: 'Maria Lopez', phone: '(555) 444-1212', active: true, userId: null, inviteCode: null }; d.team.push(sp); }
      const u = { id: uid(), role: 'sales', salesId: sp.id, name: 'Maria Lopez', email: 'maria@tophat.demo', phone: sp.phone, password: await hash('sales1234'), created: now };
      d.users.push(u); sp.userId = u.id;
      // Give her a client to work with: an open job nobody is assigned to.
      const lead = d.jobs.find((j) => !j.salesId && ['new', 'qualifying'].includes(j.status) && j.number !== 1001) || d.jobs.find((j) => !j.salesId && ['new', 'qualifying'].includes(j.status));
      if (lead) { lead.salesId = sp.id; lead.log.push({ at: now, text: 'Salesperson → Maria Lopez' }); }
    }
    if (!has('ray@tophat.demo')) {
      const c = d.contractors.find((x) => x.name === 'Ray Johnson' && !x.userId);
      if (c) {
        const u = { id: uid(), role: 'crew', contractorId: c.id, name: c.name, email: 'ray@tophat.demo', phone: c.phone, password: await hash('crew1234'), created: now };
        d.users.push(u); c.userId = u.id;
      }
    }
  }

  let dbPromise = null;
  function db() {
    if (!dbPromise) dbPromise = (async () => {
      let d = readDb();
      if (d && (d.demoVersion || 1) < DEMO_VERSION && !quietDemo()) { d = null; setSession(null); } // old preview sample → start clean
      if (!d) { d = await seed(); }
      migrate(d);
      if (d.demoStates) { // sample week: a few jobs and contractors across the river in Missouri
        delete d.demoStates;
        const MO = { 'Derek Coleman': 'MO', 'Andre Mitchell': 'MO', 'Lou Bianchi': 'MO' };
        d.contractors.forEach((c) => { c.state = MO[c.name] || 'IL'; });
        d.jobs.filter((j) => [1004, 1011, 1018].includes(j.number)).forEach((j) => { j.zip = '65804'; j.state = 'MO'; });
        // Skills: a do-it-all contractor and a few specialists.
        const ray = d.contractors.find((c) => c.name === 'Ray Johnson'); if (ray) ray.trades = ['allround', 'roofing', 'remodel'];
        d.contractors.push({ id: uid(), name: 'Tony Russo', phone: '(555) 300-7301', trades: ['concrete'], active: true, state: 'IL' },
          { id: uid(), name: 'Dave Novak', phone: '(555) 300-7302', trades: ['decks'], active: true, state: 'IL' },
          { id: uid(), name: 'Carlos Vega', phone: '(555) 300-7303', trades: ['fencing', 'decks'], active: true, state: 'MO' });
        // Materials and reviews on a few jobs.
        const at = Date.now(); const day = (n) => isoDay(at + n * 86400e3);
        const mat = (name, qty, status, eta, by) => ({ id: uid(), name, qty, status, eta: eta || null, note: '', by, at: at - 86400e3, updatedBy: by, updatedAt: at - 3600e3 });
        const byNo = (n) => d.jobs.find((j) => j.number === n);
        if (byNo(1005)) byNo(1005).materials = [mat('Shaker cabinet boxes', '12', 'ordered', day(3), 'Maria Lopez'), mat('Quartz countertop slab', '1', 'needed', null, 'Ray Johnson'), mat('Cabinet pulls, matte black', '24', 'delivered', null, 'Maria Lopez')];
        if (byNo(1009)) byNo(1009).materials = [mat('Architectural shingles, Weathered Wood', '28 bundles', 'ordered', day(1), 'Maria Lopez'), mat('Drip edge', '10 pcs', 'needed', null, 'Top Hat Office')];
        if (byNo(1013)) byNo(1013).materials = [mat('Shingles, Weathered Wood', '22 bundles', 'needed', null, 'Ray Johnson')];
        if (byNo(1001)) byNo(1001).review = { requestedAt: at - 9 * 86400e3, requestedBy: 'Maria Lopez', rating: 5, comment: 'Ray and his crew were on time and cleaned up every day. Kitchen looks amazing!', at: at - 8 * 86400e3, by: 'customer' };
        if (byNo(1002)) byNo(1002).review = { requestedAt: at - 2 * 86400e3, requestedBy: 'Top Hat Office' };
      } await addMissingSamples(d); writeDb(d); return d;
    })();
    return dbPromise;
  }
  function validateSignUp({ name, email, phone, password }) {
    if (!name?.trim()) throw new Error('Please enter your name.');
    if (!/^\S+@\S+\.\S+$/.test(normEmail(email))) throw new Error('Please enter a valid email address.');
    if (digits(phone).length < 10) throw new Error('Please enter a phone number we can call, with area code.');
    if (!password || password.length < 8) throw new Error('Password must be at least 8 characters.');
  }
  const clean = (u) => u && { id: u.id, role: u.role, name: u.name, email: u.email, phone: u.phone, salesId: u.salesId || null };
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

  // Office area: staff (owner/office) see everything; salespeople only the clients assigned to them.
  async function requireOffice() {
    const d = await db();
    const u = d.users.find((x) => x.id === getSession());
    if (u && u.role === 'staff') return { d, u: clean(u), isStaff: true, salesId: null };
    const sp = u && u.role === 'sales' && (d.team || []).find((x) => x.id === u.salesId && x.userId === u.id && x.active !== false);
    if (sp) return { d, u: clean(u), isStaff: false, salesId: sp.id };
    if (u && u.role === 'sales') throw new Error('Your sales login is turned off. Ask the Top Hat office if this is a mistake.');
    throw new Error('Please log in as Top Hat staff.');
  }
  async function officeJob(jobId) {
    const ctx = await requireOffice();
    const j = ctx.d.jobs.find((x) => x.id === jobId);
    if (!j || (!ctx.isStaff && j.salesId !== ctx.salesId)) throw new Error('Job not found.');
    return { ...ctx, j };
  }

  // Signatures on estimates: { name, image (PNG data URL), at, inPerson, witness }.
  function checkSignature(sig) {
    if (!sig) return null;
    const name = String(sig.name || '').trim().slice(0, 120);
    if (name.length < 3) throw new Error('Type your full name.');
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(sig.image || '') || sig.image.length > 300000) throw new Error('Please sign again.');
    return { name, image: sig.image, at: Date.now() };
  }
  const PAY_METHODS = ['Zelle', 'Bank transfer (ACH)', 'Check', 'Cash', 'Card', 'Venmo', 'Cash App', 'Other'];

  /* ---------- AI design studio ---------- */
  // The image model can change as Google releases new ones: set it with TH.ai.set (preview) or the server setting (live).
  const DEFAULT_IMAGE_MODEL = 'gemini-2.5-flash-image';
  const AI_KEY = 'tophat.ai.v1';
  // Preview only: the API key is kept in this browser. When live, the key is a server secret instead.
  function aiConfig() { try { return { model: DEFAULT_IMAGE_MODEL, ...(JSON.parse(localStorage.getItem(AI_KEY)) || {}) }; } catch (e) { return { model: DEFAULT_IMAGE_MODEL }; } }
  // Connect the AI design studio with the owner's own Gemini key (preview: saved in this browser only).
  // Checks the key with Google first, trying the stable picture model and then the newer one.
  // What a sign-up "dream" picture asks for (kept the same in supabase/functions/design).
  const dreamRequest = (look, extra) => `Redesign this ${look.room.label.toLowerCase()} in the ${look.style.name} style: ${look.style.desc}.${String(extra || '').trim() ? ' Also: ' + String(extra).trim().slice(0, 200) + '.' : ''}`;
  const IMAGE_MODELS = [DEFAULT_IMAGE_MODEL, 'gemini-3.1-flash-image'];
  async function connectAi(key) {
    key = String(key || '').trim();
    if (key.length < 20) throw new Error('Paste the whole key from Google AI Studio.');
    let last = '';
    for (const model of IMAGE_MODELS) {
      let res;
      try { res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`, { headers: { 'x-goog-api-key': key } }); }
      catch (e) { throw new Error('Couldn’t reach Google. Check your internet connection and try again.'); }
      if (res.ok) { setAiConfig({ key, model }); return model; }
      const out = await res.json().catch(() => ({}));
      last = out.error?.message || `error ${res.status}`;
      if ([400, 401, 403].includes(res.status)) throw new Error('Google didn’t accept that key: ' + last);
    }
    throw new Error('Your key works, but Google’s picture model isn’t available on it: ' + last);
  }
  function setAiConfig(cfg) { try { localStorage.setItem(AI_KEY, JSON.stringify({ key: String(cfg.key || '').trim(), model: String(cfg.model || '').trim() || DEFAULT_IMAGE_MODEL })); } catch (e) { /* ignore */ } }
  const blobToDataUrl = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
  // What we ask the image model. Kept the same in supabase/functions/design so preview and live behave alike.
  function designPrompt({ trade, description, earlier, request }) {
    return [
      'You are a photorealistic home remodeling visualizer for a contracting company.',
      'Edit the attached photo of the customer\'s space to show the remodel they describe.',
      'Keep the same room, camera angle, walls, windows, doors, ceiling and lighting unless they ask to change them. Make it look like a real photo of finished, buildable work with real materials. No text, labels or people in the picture.',
      trade ? `Type of project: ${trade}.` : '',
      description ? `What they told us about the job: ${String(description).slice(0, 600)}` : '',
      earlier && earlier.length ? `Changes already made in this picture: ${earlier.join(' | ').slice(0, 1500)}` : '',
      `Now make this change: ${request}`,
    ].filter(Boolean).join('\n');
  }
  async function callImageAI(ai, dataUrl, text) {
    const [, mime, b64] = String(dataUrl).match(/^data:([^;]+);base64,(.*)$/) || [];
    if (!b64) throw new Error('That picture couldn’t be read.');
    let res;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(ai.model || DEFAULT_IMAGE_MODEL)}:generateContent`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': ai.key },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mime, data: b64 } }, { text }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } }),
      });
    } catch (e) { throw new Error('Couldn’t reach the AI service. Check your internet connection and try again.'); }
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('The AI service said: ' + (out.error?.message || `error ${res.status}`));
    const parts = out.candidates?.[0]?.content?.parts || [];
    const img = parts.map((p) => p.inlineData || p.inline_data).find((x) => x && x.data);
    if (!img) {
      const said = parts.map((p) => p.text).filter(Boolean).join(' ').slice(0, 200);
      throw new Error(said ? 'The AI couldn’t make that picture: ' + said : 'The AI didn’t send back a picture. Try saying it a different way.');
    }
    return `data:${img.mimeType || img.mime_type || 'image/png'};base64,${img.data}`;
  }
  // Customers reach their own jobs; office and sales the jobs they can see.
  async function designJob(jobId) {
    const u = await me();
    if (!u) throw new Error('Please log in.');
    if (u.role === 'buyer') {
      const d = await db();
      const j = d.jobs.find((x) => x.id === jobId && x.buyerId === u.id);
      if (!j) throw new Error('Job not found.');
      return { d, j, u };
    }
    const { d, j } = await officeJob(jobId);
    return { d, j, u };
  }

  /* ---------- building permits ---------- */
  const PERMIT_STATUSES = [
    { id: 'none', label: 'Not started', buyer: '' },
    { id: 'authorized', label: 'Customer approved: apply', buyer: 'You approved it. We’ll apply for you.' },
    { id: 'preparing', label: 'Preparing the application', buyer: 'We’re getting the application ready.' },
    { id: 'applied', label: 'Applied: waiting on the town', buyer: 'Applied. Waiting on the building department.' },
    { id: 'approved', label: 'Approved', buyer: 'Approved' },
    { id: 'inspections', label: 'Inspections', buyer: 'Inspections underway' },
    { id: 'closed', label: 'Closed (final inspection passed)', buyer: 'Closed: final inspection passed' },
    { id: 'not_needed', label: 'Not needed', buyer: 'No permit needed for this job' },
  ];
  // The town or city, from "Street, City" addresses. Used to remember each building department's website.
  const placeOf = (address) => { const parts = String(address || '').split(',').map((x) => x.trim()).filter(Boolean); return parts.length > 1 ? parts[parts.length - 1].replace(/\s+\d{5}(-\d{4})?$/, '') : ''; };

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
          trade: job.trade, description: job.description.trim(), address: job.address.trim(), zip: (job.zip || '').trim(), state: cleanState(job.state) || stateFromZip(job.zip),
          style: styleOf(job.style) ? job.style : '',
          timeframe: job.timeframe, budget: job.budget || '', photos: job.photos || [],
          contractorId: null, scheduledFor: null, price: null, crewPay: null, notes: '',
          log: [{ at: now, text: 'Lead received' }],
        };
        d.jobs.push(rec); writeDb(d);
        return rec;
      },
      // Office: enter a job for a customer who called in. Optionally assign a crew and date right away.
      async createForCustomer(input) {
        const { u: staff, isStaff, salesId } = await requireOffice();
        const d = await db();
        const name = String(input.name || '').trim();
        if (!name) throw new Error('Enter the customer’s name.');
        if (digits(input.phone).length < 10 && !/^\S+@\S+\.\S+$/.test(normEmail(input.email))) throw new Error('Enter a phone number (with area code) or an email so you can reach them.');
        if (String(input.description || '').trim().length < 5) throw new Error('Describe the job in a few words.');
        if (!String(input.address || '').trim()) throw new Error('Enter the job address.');
        const existing = input.customerId ? d.users.find((u) => u.id === input.customerId && u.role === 'buyer') : null;
        const now = Date.now();
        const crewOk = input.contractorId && d.contractors.some((c) => c.id === input.contractorId);
        const owner = isStaff ? ((d.team || []).some((x) => x.id === input.salesId) ? input.salesId : null) : salesId;
        const rec = {
          id: uid(), number: d.nextNumber++, buyerId: existing ? existing.id : null, salesId: owner,
          contact: existing ? null : { name, phone: String(input.phone || '').trim(), email: normEmail(input.email) },
          status: crewOk && input.scheduledFor ? 'scheduled' : input.agreed ? 'hot' : 'qualifying', created: now, files: [], docs: [],
          trade: input.trade || 'other', description: input.description.trim(), address: input.address.trim(), zip: String(input.zip || '').trim(),
          state: cleanState(input.state) || stateFromZip(input.zip),
          timeframe: input.timeframe || '', budget: '', photos: [],
          contractorId: crewOk ? input.contractorId : null, crewToken: crewOk ? newToken() : null, scheduledFor: input.scheduledFor || null,
          price: input.price != null && input.price !== '' ? Number(input.price) : null, crewPay: null, notes: '', visitAt: null,
          log: [{ at: now, text: `Job entered by ${staff.name} (${isStaff ? 'office' : 'sales'})` }],
        };
        if (rec.price != null) rec.log.push({ at: now, text: `📞 Phone estimate ${'$' + rec.price.toLocaleString()}${input.agreed ? ': customer agreed' : ''}` });
        if (input.agreed && rec.status === 'hot') rec.log.push({ at: now, text: 'Status → Hot lead' });
        if (crewOk) rec.log.push({ at: now, text: `Assigned to ${d.contractors.find((c) => c.id === input.contractorId).name}` });
        d.jobs.push(rec); writeDb(d);
        return rec.id;
      },
      // Office: approve, decline or pay a contractor's bill. When their pay is all paid, the job counts as crew paid.
      async crewBill(jobId, billId, action, opts = {}) {
        const u = await requireStaff();
        const d = await db();
        const j = d.jobs.find((x) => x.id === jobId);
        const b = j && (j.crewBills || []).find((x) => x.id === billId);
        if (!b) throw new Error('Bill not found.');
        const name = d.contractors.find((x) => x.id === b.contractorId)?.name || 'Crew';
        if (action === 'approve' && b.status === 'submitted') { b.status = 'approved'; j.log.push({ at: Date.now(), text: `🧾 Approved ${name}’s bill: ${usd(b.amount)} “${b.label}”` }); }
        else if (action === 'decline' && ['submitted', 'approved'].includes(b.status)) {
          b.status = 'declined'; b.reason = String(opts.reason || '').trim().slice(0, 300);
          j.log.push({ at: Date.now(), text: `🧾 Declined ${name}’s bill: ${usd(b.amount)} “${b.label}”${b.reason ? ` (${b.reason})` : ''}` });
        } else if (action === 'paid' && ['submitted', 'approved'].includes(b.status)) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.date || '')) throw new Error('Pick the date you paid.');
          b.status = 'paid'; b.paidDate = opts.date; b.paidMethod = String(opts.method || 'Other').slice(0, 40);
          j.log.push({ at: Date.now(), text: `💸 Paid ${name} ${usd(b.amount)} for “${b.label}” (${b.paidMethod}) on ${b.paidDate}` });
          const paidSteps = j.crewBills.filter((x) => x.status === 'paid' && x.step != null).reduce((t, x) => t + x.amount, 0);
          if (j.crewPay != null && paidSteps >= j.crewPay - 0.01 && !j.crewPaid) j.crewPaid = { date: b.paidDate, method: b.paidMethod, note: 'All crew bills paid' };
        } else throw new Error('That bill can’t be changed now.');
        b.resolvedAt = Date.now(); b.resolvedBy = u.name;
        writeDb(d);
      },
      // Customer: "Yes, apply for my building permit." Their typed name is their signature.
      async authorizePermit(jobId, name) {
        const u = await me();
        const d = await db();
        const j = u && d.jobs.find((x) => x.id === jobId && x.buyerId === u.id);
        if (!j) throw new Error('Job not found.');
        name = String(name || '').trim();
        if (name.length < 3) throw new Error('Type your full name to sign.');
        const was = j.permit || { status: 'none' };
        j.permit = { ...was, status: ['none', 'not_needed'].includes(was.status) ? 'authorized' : was.status, authorizedBy: name, authorizedAt: Date.now() };
        j.log.push({ at: Date.now(), text: `📋 ${u.name} approved applying for the building permit (signed “${name}”)` });
        writeDb(d);
      },
      // Buyer view: their own jobs, without internal notes.
      async mine() {
        const u = await me();
        if (!u) return [];
        const d = await db();
        return d.jobs.filter((j) => j.buyerId === u.id).sort((a, b) => b.created - a.created).map((j) => {
          const c = d.contractors.find((x) => x.id === j.contractorId);
          return {
            id: j.id, number: j.number, trade: j.trade, status: j.status, created: j.created, description: j.description, address: j.address, zip: j.zip, state: j.state || '',
            timeframe: j.timeframe, budget: j.budget, photos: j.photos, scheduledFor: j.scheduledFor,
            visitAt: j.status === 'hot' ? j.visitAt || null : null,
            permit: j.permit ? { status: j.permit.status, number: j.permit.number || '', authorizedBy: j.permit.authorizedBy || '', authorizedAt: j.permit.authorizedAt || null } : { status: 'none' },
            designCount: (j.designs || []).length, style: j.style || '',
            materials: (j.materials || []).map(({ id, name, qty, status, eta }) => ({ id, name, qty, status, eta })),
            review: j.review ? { requestedAt: j.review.requestedAt || null, rating: j.review.rating || null, comment: j.review.comment || '', at: j.review.at || null } : null,
            repName: j.status === 'hot' && j.visitAt ? ((d.team || []).find((x) => x.id === j.salesId)?.name || '').split(' ')[0] || null : null,
            pm: (() => { const sp = j.status !== 'lost' && (d.team || []).find((x) => x.id === j.salesId && x.active !== false); return sp ? { name: sp.name, phone: sp.phone || '' } : null; })(),
            contractorName: c && ['scheduled', 'in_progress', 'completed'].includes(j.status) ? c.name : null,
            stage: j.stage || null,
            sharedFiles: j.files.filter((f) => f.shared).length,
          };
        });
      },
      // Staff: every crew note on a job, newest first. Opening them marks them seen.
      async crewNotes(id) {
        const { d, j, isStaff } = await officeJob(id);
        if (isStaff) { j.crewNotesSeenAt = Date.now(); writeDb(d); } // "seen" means seen by the office
        return (j.crewNotes || []).slice().reverse().map((n) => ({ ...n }));
      },
      // Staff: a job's activity history, oldest first.
      async log(id) {
        await officeJob(id);
        const j = (await db()).jobs.find((x) => x.id === id);
        return j ? j.log.slice() : [];
      },
      // Staff view: everything, with buyer contact details attached.
      async all() {
        const { d, isStaff, salesId } = await requireOffice();
        return d.jobs.filter((j) => isStaff || j.salesId === salesId).sort((a, b) => b.created - a.created).map((j) => (
          // Salespeople never see crew pay (so never profit either).
          { ...j, crewPay: isStaff ? j.crewPay : null, crewBills: isStaff ? j.crewBills || [] : [], crewPaid: isStaff ? j.crewPaid || null : null, buyer: customerOf(d, j), hasAccount: !!j.buyerId }));
      },
      // Office or sales: record a phone call and how it went.
      async logCall(id, outcome, note = '') {
        const { d, u, j } = await officeJob(id);
        if (!outcome) throw new Error('Pick how the call went.');
        note = String(note || '').trim().slice(0, 500);
        j.log.push({ at: Date.now(), text: `📞 Call (${u.name}): ${outcome}${note ? '. ' + note : ''}` });
        writeDb(d);
      },
      async update(id, patch) {
        const { isStaff } = await officeJob(id);
        const d = await db();
        const j = d.jobs.find((x) => x.id === id);
        if (!j) throw new Error('Job not found.');
        // Salespeople run their own jobs (crew, date, progress); crew pay and reassigning stay with the owner/office.
        if (!isStaff && ['crewPay', 'salesId', 'crewPaid'].some((k) => k in patch)) throw new Error('Only the office can set crew pay or change the salesperson.');
        if ('crewPaid' in patch) {
          const cp = patch.crewPaid;
          if (cp && !/^\d{4}-\d{2}-\d{2}$/.test(cp.date || '')) throw new Error('Pick the date you paid the crew.');
          j.crewPaid = cp ? { date: cp.date, method: String(cp.method || 'Other').slice(0, 40), note: String(cp.note || '').trim().slice(0, 200) } : null;
          j.log.push({ at: Date.now(), text: cp ? `💸 Crew paid ${j.crewPay != null ? '$' + Number(j.crewPay).toLocaleString() + ' ' : ''}(${j.crewPaid.method}) on ${cp.date}` : '💸 Crew payment cleared' });
        }
        if ('state' in patch && cleanState(patch.state) !== (j.state || '')) {
          j.state = cleanState(patch.state);
          j.log.push({ at: Date.now(), text: `State → ${stateName(j.state) || 'not set'}` });
        }
        if ('salesId' in patch && patch.salesId !== (j.salesId || null)) {
          const sp = (d.team || []).find((x) => x.id === patch.salesId);
          j.log.push({ at: Date.now(), text: `Salesperson → ${sp ? sp.name : 'nobody'}` });
          j.salesId = sp ? sp.id : null;
        }
        const cname = (cid) => d.contractors.find((c) => c.id === cid)?.name || 'nobody';
        const staffUser = await me();
        if ('status' in patch || 'stage' in patch) applyProgress(j, { status: patch.status, stage: patch.stage }, staffUser.name, false);
        if ('contractorId' in patch && patch.contractorId !== j.contractorId) {
          j.log.push({ at: Date.now(), text: `Assigned to ${cname(patch.contractorId)}` });
          // New crew → new upload link, so the previous crew's link stops working.
          j.crewToken = patch.contractorId ? newToken() : null;
          j.crewResponse = null; j.crewResponseNote = ''; j.crewResponseAt = null; // new crew needs to confirm
        }
        if ('visitAt' in patch && (patch.visitAt || null) !== (j.visitAt || null)) j.log.push({ at: Date.now(), text: patch.visitAt
          ? `🤝 Rep visit booked for ${new Date(patch.visitAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` : '🤝 Rep visit cleared' });
        if ('scheduledFor' in patch && patch.scheduledFor !== j.scheduledFor && patch.scheduledFor) j.log.push({ at: Date.now(), text: `Scheduled for ${new Date(patch.scheduledFor).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` });
        const usd = (n) => n == null ? 'cleared' : '$' + Number(n).toLocaleString();
        if ('price' in patch && patch.price !== j.price) j.log.push({ at: Date.now(), text: `Customer price → ${usd(patch.price)}` });
        if ('crewPay' in patch && patch.crewPay !== j.crewPay) j.log.push({ at: Date.now(), text: `Crew pay → ${usd(patch.crewPay)}` });
        if (patch.permit) {
          const was = j.permit || { status: 'none' };
          const next = { ...was };
          for (const k of ['status', 'number', 'portalUrl', 'fee', 'notes']) if (k in patch.permit) next[k] = patch.permit[k];
          if (!PERMIT_STATUSES.some((x) => x.id === next.status)) throw new Error('Pick a permit status.');
          if (next.portalUrl && !/^https?:\/\//i.test(next.portalUrl)) throw new Error('The building department link must start with https://');
          next.fee = next.fee === '' || next.fee == null ? null : Number(next.fee);
          if (next.status !== was.status) j.log.push({ at: Date.now(), text: `📋 Permit → ${PERMIT_STATUSES.find((x) => x.id === next.status).label}` });
          if ((next.number || '') !== (was.number || '') && next.number) j.log.push({ at: Date.now(), text: `📋 Permit # ${next.number}` });
          j.permit = next;
        }
        for (const k of ['contractorId', 'scheduledFor', 'visitAt', 'price', 'crewPay', 'notes']) if (k in patch) j[k] = patch[k] || (k === 'notes' ? '' : patch[k] === 0 ? 0 : null);
        writeDb(d);
        return j;
      },
    },

    files: {
      // Staff: every file in the job's folder, each with a temporary URL to open it.
      async list(jobId) {
        const { j } = await officeJob(jobId);
        return Promise.all(j.files.map(withUrl));
      },
      async upload(jobId, file, kind) {
        const { u } = await officeJob(jobId);
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
        await officeJob(jobId);
        const d = await db();
        const j = d.jobs.find((x) => x.id === jobId);
        const f = j && j.files.find((x) => x.id === fileId);
        if (!f) throw new Error('File not found.');
        if ('shared' in patch && patch.shared !== f.shared) j.log.push({ at: Date.now(), text: `${f.name}: ${patch.shared ? 'shared with customer' : 'hidden from customer'}` });
        for (const k of ['kind', 'shared']) if (k in patch) f[k] = patch[k];
        writeDb(d);
      },
      async remove(jobId, fileId) {
        await officeJob(jobId);
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
          const { id, name, kind, size, uploaded, url, source, mime, stage, designGroup } = await withUrl(f);
          return { id, name, kind, size, uploaded, url, source: source || '', mime, stage: stage || '', group: designGroup || '' };
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
        const { j } = await officeJob(jobId);
        return JSON.parse(JSON.stringify(j.docs));
      },
      async save(jobId, doc) {
        await officeJob(jobId);
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
            payments: [], created: Date.now(), fromEstimateId: doc.fromEstimateId || null,
            scheduleStep: doc.type === 'invoice' && Number.isInteger(doc.scheduleStep) ? doc.scheduleStep : null,
            scheduleBase: doc.type === 'invoice' && Number.isInteger(doc.scheduleStep) ? Number(doc.scheduleBase) || 0 : null, ...fields };
          j.docs.push(rec);
          j.log.push({ at: Date.now(), text: `${doc.type === 'invoice' ? 'Invoice' : 'Estimate'} ${rec.number} created` });
        }
        writeDb(d);
        return JSON.parse(JSON.stringify(rec));
      },
      async send(jobId, docId) {
        await officeJob(jobId);
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
      async setStatus(jobId, docId, status, sig) {
        const { u, isStaff } = await officeJob(jobId);
        const signature = status === 'approved' ? checkSignature(sig) : null;
        if (!isStaff && status === 'void') throw new Error('Only the office can void invoices.');
        const d = await db();
        const j = d.jobs.find((x) => x.id === jobId);
        const rec = j && j.docs.find((x) => x.id === docId);
        if (!rec) throw new Error('Not found.');
        const ok = rec.type === 'estimate' ? ['approved', 'declined'].includes(status) && rec.status === 'sent'
          : status === 'void' && rec.status !== 'void';
        if (!ok) throw new Error('That change isn’t allowed.');
        rec.status = status; rec.respondedAt = Date.now(); rec.respondedBy = signature ? `${signature.name} (signed in person)` : `${u.name} (${isStaff ? 'office' : 'sales'})`;
        if (signature) rec.signature = { ...signature, inPerson: true, witness: u.name };
        if (status === 'approved') { j.price = docTotal(rec); j.log.push({ at: Date.now(), text: `Customer price → ${usd(j.price)} (from ${rec.number})` }); }
        j.log.push({ at: Date.now(), text: `${rec.number} marked ${status} by ${u.name}` });
        if (status === 'approved' && ['new', 'qualifying'].includes(j.status)) applyProgress(j, { status: 'hot' }, u.name, false);
        writeDb(d);
      },
      async remove(jobId, docId) {
        await officeJob(jobId);
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
            const { id, type, number, status, items, taxRate, notes, dueDate, payLink, payments, created, sentAt, respondedAt, signature, scheduleStep, scheduleBase } = x;
            const reports = (x.reports || []).map(({ id: rid, amount, method, at, status: rs, signature: sg }) => ({ id: rid, amount, method, at, status: rs, signature: sg || null }));
            return JSON.parse(JSON.stringify({ id, type, number, status, items, taxRate, notes, dueDate, payLink, payments, created, sentAt, respondedAt, signature, scheduleStep, scheduleBase, reports }));
          });
        });
        return out;
      },
      // Customer: "I've sent my payment." The office confirms it when the money arrives.
      async reportPayment(docId, p) {
        const u = await me();
        const d = await db();
        const j = u && d.jobs.find((x) => x.buyerId === u.id && x.docs.some((y) => y.id === docId));
        const rec = j && j.docs.find((x) => x.id === docId);
        if (!rec || rec.type !== 'invoice' || ['draft', 'void'].includes(rec.status)) throw new Error('This invoice can’t take payments.');
        const amount = Math.round(Number(p.amount) * 100) / 100;
        if (!(amount > 0)) throw new Error('Enter how much you paid.');
        if (amount > docTotal(rec) * 2) throw new Error('That’s more than this invoice. Check the amount.');
        const method = PAY_METHODS.includes(p.method) ? p.method : 'Other';
        const signature = checkSignature(p.signature);
        (rec.reports ||= []).push({ id: uid(), amount, method, note: String(p.note || '').trim().slice(0, 300), at: Date.now(), by: u.name, status: 'pending', signature });
        j.log.push({ at: Date.now(), text: `💵 ${u.name} paid ${usd(amount)} by ${method} on ${rec.number}${signature ? ` (signed “${signature.name}”)` : ''}. Confirm it when it arrives.` });
        writeDb(d);
      },
      async resolveReport(jobId, docId, reportId, received) {
        const u = await requireStaff();
        const d = await db();
        const j = d.jobs.find((x) => x.id === jobId);
        const rec = j && j.docs.find((x) => x.id === docId);
        const r = rec && (rec.reports || []).find((x) => x.id === reportId && x.status === 'pending');
        if (!r) throw new Error('Already handled.');
        r.status = received ? 'confirmed' : 'not_received'; r.resolvedAt = Date.now(); r.resolvedBy = u.name;
        if (!received) j.log.push({ at: Date.now(), text: `💵 ${usd(r.amount)} by ${r.method} on ${rec.number}: not received yet` });
        writeDb(d);
        if (received) await api.docs.addPayment(jobId, docId, { amount: r.amount, method: r.method, date: isoDay(Date.now()), note: `Reported by ${r.by}${r.note ? ': ' + r.note : ''}` });
      },
      // Sign a document that's already out: an invoice (any time, paid or not) or an estimate approved by phone.
      // The customer signs in the app; the office or rep can have them sign in person on their phone.
      async sign(docId, sig, jobId = null) {
        const u = await me(); if (!u) throw new Error('Please log in.');
        const d = await db();
        let j, inPerson = false;
        if (u.role === 'buyer') j = d.jobs.find((x) => x.buyerId === u.id && x.docs.some((y) => y.id === docId));
        else { j = (await officeJob(jobId)).j; j = d.jobs.find((x) => x.id === j.id); inPerson = true; }
        const rec = j && j.docs.find((x) => x.id === docId);
        if (!rec) throw new Error('Not found.');
        if (rec.signature) throw new Error('This is already signed.');
        if (!(rec.type === 'invoice' ? !['draft', 'void'].includes(rec.status) : rec.status === 'approved')) throw new Error('This can’t be signed right now.');
        const signature = checkSignature(sig); if (!signature) throw new Error('Please sign first.');
        rec.signature = { ...signature, inPerson, witness: inPerson ? u.name : undefined };
        j.log.push({ at: Date.now(), text: `✍️ ${rec.number} signed “${signature.name}”${inPerson ? ` in person with ${u.name}` : ' in the app'}` });
        writeDb(d);
      },
      async respond(docId, approve, sig) {
        const u = await me();
        const d = await db();
        const j = u && d.jobs.find((x) => x.buyerId === u.id && x.docs.some((y) => y.id === docId));
        const rec = j && j.docs.find((x) => x.id === docId);
        if (!rec || rec.type !== 'estimate' || rec.status !== 'sent') throw new Error('This estimate can no longer be changed. Call us if you have questions.');
        const signature = approve ? checkSignature(sig) : null;
        rec.status = approve ? 'approved' : 'declined'; rec.respondedAt = Date.now(); rec.respondedBy = u.name;
        if (signature) rec.signature = { ...signature, inPerson: false };
        if (approve) { j.price = docTotal(rec); j.log.push({ at: Date.now(), text: `Customer price → ${usd(j.price)} (from ${rec.number})` }); }
        j.log.push({ at: Date.now(), text: `Customer ${approve ? 'approved' : 'declined'} ${rec.number}${signature ? ` (signed “${signature.name}”)` : ''}` });
        if (approve && ['new', 'qualifying'].includes(j.status)) applyProgress(j, { status: 'hot' }, u.name, false);
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
          number: j.number, trade: j.trade, status: j.status, address: j.address, zip: j.zip, state: j.state || '',
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

    // Materials on a job: what needs ordering, what's ordered, what's delivered.
    // Office and the job's salesperson manage the list; the contractor can add what they need and mark things delivered; customers see it.
    materials: {
      async _job(jobId) {
        const u = await me(); if (!u) throw new Error('Please log in.');
        const d = await db(); const j = d.jobs.find((x) => x.id === jobId);
        if (!j) throw new Error('Job not found.');
        if (u.role === 'crew') { const c = d.contractors.find((x) => x.userId === u.id); if (!c || j.contractorId !== c.id) throw new Error('That job isn’t assigned to you.'); return { d, j, u, role: 'crew' }; }
        if (u.role === 'staff') return { d, j, u, role: 'staff' };
        if (u.role === 'sales') { const sp = (d.team || []).find((x) => x.id === u.salesId && x.active !== false); if (!sp || j.salesId !== sp.id) throw new Error('Job not found.'); return { d, j, u, role: 'sales' }; }
        throw new Error('Only Top Hat and the crew can change materials.');
      },
      async add(jobId, { name, qty = '', note = '' } = {}) {
        const { d, j, u, role } = await api.materials._job(jobId);
        name = String(name || '').trim().slice(0, 120);
        if (name.length < 2) throw new Error('What material is it?');
        const m = { id: uid(), name, qty: String(qty || '').trim().slice(0, 40), note: String(note || '').trim().slice(0, 300), status: 'needed', eta: null, by: u.name, at: Date.now(), updatedBy: u.name, updatedAt: Date.now() };
        (j.materials ||= []).push(m);
        j.log.push({ at: Date.now(), text: `🛒 ${u.name}${role === 'crew' ? ' (crew)' : ''} added material: ${m.name}${m.qty ? ` (${m.qty})` : ''}` });
        writeDb(d); return { ...m };
      },
      async update(jobId, id, patch = {}) {
        const { d, j, u, role } = await api.materials._job(jobId);
        const m = (j.materials || []).find((x) => x.id === id); if (!m) throw new Error('That material isn’t on this job.');
        if (role === 'crew' && (Object.keys(patch).some((k) => k !== 'status') || patch.status !== 'delivered')) throw new Error('The office orders materials. You can mark them delivered.');
        if ('status' in patch) {
          if (!MATERIAL_STATUS.some((x) => x.id === patch.status)) throw new Error('Pick a status.');
          if (patch.status !== m.status) j.log.push({ at: Date.now(), text: `${MATERIAL_STATUS.find((x) => x.id === patch.status).icon} ${m.name}: ${MATERIAL_STATUS.find((x) => x.id === patch.status).label.toLowerCase()} (${u.name})` });
          m.status = patch.status;
        }
        if ('eta' in patch) m.eta = /^\d{4}-\d{2}-\d{2}$/.test(patch.eta || '') ? patch.eta : null;
        if ('note' in patch) m.note = String(patch.note || '').trim().slice(0, 300);
        if ('qty' in patch) m.qty = String(patch.qty || '').trim().slice(0, 40);
        m.updatedBy = u.name; m.updatedAt = Date.now();
        writeDb(d); return { ...m };
      },
      async remove(jobId, id) {
        const { d, j, role } = await api.materials._job(jobId);
        if (role === 'crew') throw new Error('Ask the office to remove it.');
        j.materials = (j.materials || []).filter((x) => x.id !== id); writeDb(d);
      },
    },

    // Reviews: the office or the job's salesperson asks; the customer rates the job.
    reviews: {
      async ask(jobId) {
        const { j, u } = await officeJob(jobId);
        const d = await db(); const jj = d.jobs.find((x) => x.id === j.id);
        jj.review = { ...(jj.review || {}), requestedAt: Date.now(), requestedBy: u.name };
        jj.log.push({ at: Date.now(), text: `⭐ ${u.name} asked the customer for a review` });
        writeDb(d);
      },
      async leave(jobId, rating, comment = '') {
        const u = await me(); const d = await db();
        const j = u && d.jobs.find((x) => x.id === jobId && x.buyerId === u.id);
        if (!j) throw new Error('Job not found.');
        if (j.status !== 'completed') throw new Error('You can review the job once it’s finished.');
        rating = Math.round(Number(rating));
        if (!(rating >= 1 && rating <= 5)) throw new Error('Tap 1 to 5 stars.');
        j.review = { ...(j.review || {}), rating, comment: String(comment || '').trim().slice(0, 1000), at: Date.now(), by: u.name };
        j.log.push({ at: Date.now(), text: `⭐ ${u.name} left a ${rating}-star review${j.review.comment ? `: “${j.review.comment}”` : ''}` });
        writeDb(d);
      },
    },

    contractors: {
      async list() {
        const ctx = await requireOffice();
        // Salespeople pick crews too, but only see names, phones and trades (no logins or invite links).
        if (!ctx.isStaff) return ctx.d.contractors.map(({ id, name, phone, trades, active, state }) => ({ id, name, phone, trades, active, state: state || '' }));
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
        const fields = { name: c.name.trim(), phone: (c.phone || '').trim(), trades: c.trades || [], active: c.active !== false, state: cleanState(c.state) };
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

    // Sales team: the owner/office manage salespeople and see everything they do.
    team: {
      async list() {
        const ctx = await requireOffice();
        const d = ctx.d;
        return (d.team || []).filter((x) => ctx.isStaff || x.id === ctx.salesId).map((x) => {
          const u = x.userId && d.users.find((y) => y.id === x.userId);
          return { ...x, login: u ? 'active' : x.inviteCode ? 'invited' : 'none', loginEmail: u ? u.email : '' };
        });
      },
      async save(x) {
        await requireStaff();
        if (!x.name?.trim()) throw new Error('Salesperson needs a name.');
        const d = await db();
        const fields = { name: x.name.trim(), phone: (x.phone || '').trim(), active: x.active !== false };
        const existing = (d.team || []).find((y) => y.id === x.id);
        if (existing) Object.assign(existing, fields);
        else d.team.push({ id: uid(), userId: null, inviteCode: null, ...fields });
        writeDb(d);
      },
      async remove(id) {
        await requireStaff();
        const d = await db();
        const x = d.team.find((y) => y.id === id);
        if (x && x.userId) { const u = d.users.find((y) => y.id === x.userId); if (u) u.salesId = null; }
        d.team = d.team.filter((y) => y.id !== id);
        d.jobs.forEach((j) => { if (j.salesId === id) j.salesId = null; });
        writeDb(d);
      },
      async invite(id) {
        await requireStaff();
        const d = await db();
        const x = d.team.find((y) => y.id === id);
        if (!x) throw new Error('Salesperson not found.');
        if (x.userId) throw new Error(`${x.name} already has a login.`);
        x.inviteCode = newToken();
        writeDb(d);
        return x.inviteCode;
      },
      async revokeLogin(id) {
        await requireStaff();
        const d = await db();
        const x = d.team.find((y) => y.id === id);
        if (!x) return;
        const u = x.userId && d.users.find((y) => y.id === x.userId);
        if (u) u.salesId = null;
        x.userId = null; x.inviteCode = null;
        writeDb(d);
      },
      // Everything happening on a salesperson's clients, newest first.
      async activity(id) {
        await requireStaff();
        const d = await db();
        const mine = d.jobs.filter((j) => j.salesId === id);
        const events = mine.flatMap((j) => j.log.map((l) => ({ ...l, jobId: j.id, number: j.number, customer: customerOf(d, j).name })))
          .sort((a, b) => b.at - a.at).slice(0, 60);
        return { events };
      },
      inviteInfo: async (code) => {
        const d = await db();
        const x = code && code.length >= 32 && (d.team || []).find((y) => y.inviteCode === code);
        return x ? { name: x.name } : null;
      },
      async acceptInvite(code, { email, password }) {
        const d = await db();
        const x = code && code.length >= 32 && (d.team || []).find((y) => y.inviteCode === code);
        if (!x) throw new Error('This invite link has already been used or was cancelled. Ask the office for a new one.');
        email = normEmail(email);
        if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Please enter a valid email address.');
        if (!password || password.length < 8) throw new Error('Password must be at least 8 characters.');
        if (d.users.some((u) => u.email === email)) throw new Error('That email already has an account. Use a different email, or ask the office.');
        const user = { id: uid(), role: 'sales', salesId: x.id, name: x.name, email, phone: x.phone || '', password: await hash(password), created: Date.now() };
        d.users.push(user);
        x.userId = user.id; x.inviteCode = null;
        writeDb(d); setSession(user.id);
        return clean(user);
      },
    },

    // Crew login: invite → own password → see only their own assigned jobs. Never customer prices.
    // Design studio: photos of a space, and AI pictures of the remodel the customer describes.
    // Customers use it on their own jobs; the office and reps on theirs (e.g. at the rep visit).
    designs: {
      async list(jobId) {
        const { j } = await designJob(jobId);
        return Promise.all((j.designs || []).map(async (v) => {
          const blob = await blobs.get('design:' + v.id).catch(() => null);
          return { ...v, saved: !!v.savedFileId && j.files.some((f) => f.id === v.savedFileId), url: blob ? URL.createObjectURL(blob) : null };
        }));
      },
      // Save a design to the job's Photos & papers, shared with the customer, office, rep and contractor.
      // Saving a design also saves the photo it started from, as its "before", so everyone sees where it was and where it's going.
      async save(jobId, id, name = 'Design') {
        const { d, j, u } = await designJob(jobId);
        const v = (j.designs || []).find((x) => x.id === id);
        if (!v) throw new Error('Not found.');
        let root = v; while (root && root.source !== 'photo' && root.parentId) root = j.designs.find((x) => x.id === root.parentId) || null;
        const group = (root || v).id;
        const keep = async (ver, stage, label) => {
          if (ver.savedFileId && j.files.some((f) => f.id === ver.savedFileId)) return false;
          const blob = await blobs.get('design:' + ver.id).catch(() => null);
          if (!blob) throw new Error('That picture is missing.');
          const meta = { id: uid(), name: `${String(label).slice(0, 80)}.${/png/.test(blob.type) ? 'png' : 'jpg'}`, mime: blob.type || 'image/png', size: blob.size, kind: 'photo', shared: true,
            uploaded: Date.now(), by: u.name, source: 'design', designId: ver.id, stage, designGroup: group, note: ver.prompt || '' };
          await blobs.put(meta.id, blob);
          j.files.push(meta); ver.savedFileId = meta.id;
          return true;
        };
        const before = root && root !== v ? await keep(root, 'before', `Before - ${name}`) : false;
        const after = await keep(v, v.source === 'photo' ? 'before' : 'after', v.source === 'photo' ? `Before - ${name}` : `After - ${name}`);
        if (before || after) j.log.push({ at: Date.now(), text: `💾 ${u.name} saved ${name}${before ? ' and its before photo' : ''} from the design studio to Photos & papers` });
        writeDb(d);
      },
      // Take a design back out. Its before photo goes too, unless another saved design still uses it.
      async unsave(jobId, id) {
        const { d, j, u } = await designJob(jobId);
        const v = (j.designs || []).find((x) => x.id === id);
        if (!v || !v.savedFileId) return;
        const drop = async (ver) => { j.files = j.files.filter((f) => f.id !== ver.savedFileId); await blobs.del(ver.savedFileId).catch(() => {}); delete ver.savedFileId; };
        const file = j.files.find((f) => f.id === v.savedFileId);
        await drop(v);
        if (file && file.stage === 'after') {
          const stillUsed = j.files.some((f) => f.source === 'design' && f.stage === 'after' && f.designGroup === file.designGroup);
          const beforeFile = !stillUsed && j.files.find((f) => f.source === 'design' && f.stage === 'before' && f.designGroup === file.designGroup);
          const beforeVer = beforeFile && j.designs.find((x) => x.savedFileId === beforeFile.id);
          if (beforeVer) await drop(beforeVer);
        }
        j.log.push({ at: Date.now(), text: `💾 ${u.name} removed a saved design from Photos & papers` });
        writeDb(d);
      },
      // Start from a photo: the customer's request photo (data URL) or a new upload (File).
      async addPhoto(jobId, photo) {
        const { d, j, u } = await designJob(jobId);
        const blob = photo instanceof Blob ? await (await fetch(await shrinkImage(photo, 1280, 0.82))).blob() : await (await fetch(photo)).blob();
        const v = { id: uid(), parentId: null, source: 'photo', prompt: '', by: u.name, at: Date.now(), chosen: false };
        await blobs.put('design:' + v.id, blob);
        (j.designs ||= []).push(v);
        j.log.push({ at: Date.now(), text: `🎨 Design studio: photo added by ${u.name}` });
        writeDb(d);
        return v;
      },
      // Make a new picture from an earlier one, following the customer's words.
      async generate(jobId, fromId, prompt) {
        const { d, j, u } = await designJob(jobId);
        prompt = String(prompt || '').trim().slice(0, 1500);
        if (prompt.length < 3) throw new Error('Tell us what you want changed.');
        const from = (j.designs || []).find((v) => v.id === fromId);
        const src = from && await blobs.get('design:' + from.id).catch(() => null);
        if (!src) throw new Error('Pick a photo to start from.');
        const ai = aiConfig();
        if (!ai.key && !window.TH_AI_MOCK) throw new Error('The AI pictures aren’t connected yet. The office connects Gemini at the top of the Design studio.');
        const steps = [];
        for (let v = from; v && v.source === 'ai'; v = j.designs.find((x) => x.id === v.parentId)) steps.unshift(v.prompt);
        const instruction = designPrompt({ trade: (TRADES.find((t) => t.id === j.trade) || {}).label, description: j.description, earlier: steps, request: prompt });
        const out = window.TH_AI_MOCK ? await window.TH_AI_MOCK(await blobToDataUrl(src), instruction) : await callImageAI(ai, await blobToDataUrl(src), instruction);
        const blob = await (await fetch(out)).blob();
        const v = { id: uid(), parentId: from.id, source: 'ai', prompt, by: u.name, at: Date.now(), chosen: false };
        await blobs.put('design:' + v.id, blob);
        j.designs.push(v);
        writeDb(d);
        return v;
      },
      // Sign-up: their photo in the look they picked, before they've even sent the request (nothing saved yet).
      async dream(photo, styleKey, extra = '') {
        const look = styleOf(styleKey);
        if (!look) throw new Error('Pick a look first.');
        if (!photo) throw new Error('Add a photo of your space first.');
        const ai = aiConfig();
        if (!ai.key && !window.TH_AI_MOCK) throw new Error('Picture previews aren’t turned on yet. We’ll still see the look you picked.');
        let used = { day: '', n: 0 };
        try { used = JSON.parse(localStorage.getItem('tophat.dreams') || '{}'); } catch (e) {}
        const today = isoDay(Date.now());
        if (used.day !== today) used = { day: today, n: 0 };
        if (used.n >= 8) throw new Error('That’s all the previews for today. Send your request and your project manager will make more with you.');
        const instruction = designPrompt({ trade: 'Remodel', description: '', earlier: [], request: dreamRequest(look, extra) });
        const out = window.TH_AI_MOCK ? await window.TH_AI_MOCK(photo, instruction) : await callImageAI(ai, photo, instruction);
        used.n++; try { localStorage.setItem('tophat.dreams', JSON.stringify(used)); } catch (e) {}
        return shrinkImage(await (await fetch(out)).blob(), 1280, 0.82);
      },
      // After they send the request: save their photo and the dream picture to the job, marked as the one they picked.
      async adopt(jobId, photo, image, prompt) {
        const { d, j, u } = await designJob(jobId);
        const save = async (src, v) => { await blobs.put('design:' + v.id, await (await fetch(src)).blob()); (j.designs ||= []).push(v); return v; };
        const ph = await save(photo, { id: uid(), parentId: null, source: 'photo', prompt: '', by: u.name, at: Date.now(), chosen: false });
        await save(image, { id: uid(), parentId: ph.id, source: 'ai', prompt: String(prompt || '').slice(0, 1500), by: u.name, at: Date.now(), chosen: true });
        j.designs.forEach((x) => { x.chosen = x.source === 'ai' && x.parentId === ph.id; });
        j.log.push({ at: Date.now(), text: `🌟 ${u.name} designed their dream ${(styleOf(j.style) || {}).room?.label?.toLowerCase() || 'room'} while signing up` });
        writeDb(d);
      },
      // "This is the one": the design the office should quote and build.
      async choose(jobId, id) {
        const { d, j, u } = await designJob(jobId);
        const v = (j.designs || []).find((x) => x.id === id);
        if (!v) throw new Error('Not found.');
        j.designs.forEach((x) => { x.chosen = x.id === id; });
        j.log.push({ at: Date.now(), text: `⭐ Design picked by ${u.name}${v.prompt ? `: “${v.prompt.slice(0, 120)}”` : ''}` });
        writeDb(d);
      },
    },

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
        return Promise.all(d.jobs.filter((j) => j.contractorId === c.id && ['scheduled', 'in_progress', 'completed'].includes(j.status)).map(async (j) => {
          const b = customerOf(d, j);
          // Photos the customer sent with their request, so the crew knows what they're walking into.
          const custFiles = await Promise.all(j.files.filter((f) => f.source === 'customer' && /^image\//.test(f.mime)).map(withUrl));
          const designFiles = await Promise.all(j.files.filter((f) => f.source === 'design').map(withUrl));
          return {
            crewResponse: j.crewResponse || null, crewResponseNote: j.crewResponseNote || '',
            startedAt: j.startedAt || null, finishedAt: j.finishedAt || null,
            customerPhotos: [...(j.photos || []), ...custFiles.map((f) => f.url).filter(Boolean)],
            designPhotos: designFiles.map((f) => ({ url: f.url, name: f.name, stage: f.stage || 'after', group: f.designGroup || f.id })).filter((f) => f.url),
            id: j.id, number: j.number, trade: j.trade, status: j.status, scheduledFor: j.scheduledFor,
            address: j.address, zip: j.zip, state: j.state || '', description: j.description,
            customerName: b.name || '', customerPhone: b.phone || '',
            stage: j.stage || null, progressAt: j.progressAt || null, progressBy: j.progressBy || '',
            crewToken: j.crewToken, crewPay: showPay ? j.crewPay : null, style: j.style || '',
            materials: (j.materials || []).map((m) => ({ ...m })),
            photos: j.files.filter((f) => f.source === 'crew' && f.contractorId === c.id).length,
            uploads: await Promise.all(j.files.filter((f) => f.source === 'crew' && f.contractorId === c.id).map(async (f) => {
              const w = await withUrl(f); return { name: f.name, stage: f.stage || '', uploaded: f.uploaded, mime: f.mime, url: w.url };
            })),
            crewPaid: showPay && j.crewPaid ? { date: j.crewPaid.date, method: j.crewPaid.method } : null,
            crewBills: showPay ? (j.crewBills || []).filter((x) => x.contractorId === c.id).map((x) => ({ ...x })) : [],
            halfwayAt: j.halfwayAt || null,
            notes: ownNotes(j),
          };
        }));
      },
      // Crew: "I'm halfway done." Unlocks the halfway bill and tells the office.
      async halfway(jobId) {
        const { d, c, u } = await requireCrew();
        const j = d.jobs.find((x) => x.id === jobId && x.contractorId === c.id && x.status === 'in_progress');
        if (!j) throw new Error('Start the job first.');
        if (!j.halfwayAt) { j.halfwayAt = Date.now(); j.log.push({ at: Date.now(), text: `½ Halfway done (by ${u.name}, crew)` }); writeDb(d); }
      },
      // Crew bills Top Hat for a step on the crew pay schedule, or for extra work/materials.
      async bill(jobId, { step = null, amount, note = '', photos = [] } = {}) {
        const { d, c, u } = await requireCrew();
        photos = [...(photos || [])];
        if (!photos.length) throw new Error('Add at least one photo of the work so the office can see what you did.');
        if (photos.length > 12) throw new Error('Send up to 12 photos with a bill.');
        for (const f of photos) {
          if (!/^image\//.test(f.type || '')) throw new Error(`"${f.name}" isn’t a photo.`);
          if (f.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`"${f.name}" is over ${MAX_FILE_MB} MB.`);
        }
        const j = d.jobs.find((x) => x.id === jobId && x.contractorId === c.id && ['scheduled', 'in_progress', 'completed'].includes(x.status));
        if (!j) throw new Error('That job isn’t assigned to you.');
        if (d.settings.showCrewPay === false) throw new Error('Ask the office about billing for this job.');
        note = String(note || '').trim().slice(0, 500);
        const bills = (j.crewBills ||= []);
        let rec;
        if (step == null) {
          const amt = Math.round(Number(amount) * 100) / 100;
          if (!(amt > 0) || amt > 100000) throw new Error('Enter the amount for the extra work or materials.');
          if (note.length < 3) throw new Error('Say what the extra work or materials were.');
          rec = { label: 'Extra work / materials', step: null, amount: amt };
        } else {
          if (j.crewPay == null) throw new Error('The office hasn’t set your pay for this job yet.');
          const steps = (d.settings.crewPaySchedule && d.settings.crewPaySchedule.length ? d.settings.crewPaySchedule : DEFAULT_SETTINGS.crewPaySchedule);
          const s = steps[step];
          if (!s) throw new Error('That payment isn’t on the schedule.');
          const reached = { start: ['in_progress', 'completed'], mid: j.halfwayAt ? ['in_progress', 'completed'] : ['completed'], done: ['completed'] }[s.when] || ['completed'];
          if (!reached.includes(j.status)) throw new Error(s.when === 'done' ? 'Finish the job first, then bill for it.' : s.when === 'mid' ? 'Tap “I’m halfway done” first, then bill for it.' : 'Start the job first, then bill for it.');
          if (bills.some((x) => x.step === step && x.status !== 'declined')) throw new Error('You’ve already billed for that.');
          // One at a time: the step before has to be approved or paid first.
          if (step > 0 && !bills.some((x) => x.step === step - 1 && ['approved', 'paid'].includes(x.status))) throw new Error(`Wait until Top Hat approves “${steps[step - 1].label}”, then bill for this one.`);
          let left = Math.round(j.crewPay * 100) / 100; let amt = 0;
          steps.forEach((x, i) => { const a = i === steps.length - 1 ? left : Math.round(j.crewPay * (Number(x.pct) || 0)) / 100; left = Math.round((left - a) * 100) / 100; if (i === step) amt = a; });
          rec = { label: s.label, step, amount: amt };
        }
        const bill = { id: uid(), ...rec, note, contractorId: c.id, by: u.name, at: Date.now(), status: 'submitted', reason: '', paidDate: null, paidMethod: '', photos: photos.length };
        // The photos go into the job's files, tied to this bill.
        for (const [i, f] of photos.entries()) {
          const meta = { id: uid(), name: f.name || `bill-photo-${i + 1}.jpg`, mime: f.type, size: f.size, kind: 'photo', shared: false, uploaded: Date.now(),
            source: 'crew', contractorId: c.id, by: u.name, stage: '', note: `Bill: ${bill.label}`, billId: bill.id };
          await blobs.put(meta.id, f);
          j.files.push(meta);
        }
        bills.push(bill);
        j.log.push({ at: Date.now(), text: `🧾 ${u.name} billed ${usd(bill.amount)} for “${bill.label}” with ${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}${note ? `: ${note}` : ''}` });
        writeDb(d);
        return { ...bill };
      },
      // Crew confirms they'll do the job, or tells the office they can't (with a reason).
      async respond(jobId, response, note = '') {
        const { d, c, u } = await requireCrew();
        const j = d.jobs.find((x) => x.id === jobId && x.contractorId === c.id && x.status === 'scheduled');
        if (!j || !['confirmed', 'declined'].includes(response)) throw new Error('That isn’t available for this job.');
        note = String(note || '').trim().slice(0, 500);
        if (response === 'declined' && !note) throw new Error('Tell the office why, so they can plan.');
        j.crewResponse = response; j.crewResponseNote = note; j.crewResponseAt = Date.now();
        j.progressAt = Date.now(); j.progressBy = u.name; j.progressByCrew = true;
        if (response === 'confirmed') j.log.push({ at: Date.now(), text: `${u.name} confirmed the job` });
        else pushCrewNote(d, j, `Can’t make it: ${note}`);
        if (response === 'declined') j.log.push({ at: Date.now(), text: `${u.name} can’t make it` });
        writeDb(d);
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
  // A customer can pick a date on the calendar instead of a timeframe; it is saved as YYYY-MM-DD.
  const dateLabel = (id) => {
    const d = new Date(id + 'T12:00:00');
    return 'By ' + d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  };
  const find = (list, id) => list.find((x) => x.id === id)
    || (list === TIMEFRAMES && /^\d{4}-\d{2}-\d{2}$/.test(id || '') ? { id, label: dateLabel(id) } : undefined);

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
  const HOME = { staff: 'admin.html', sales: 'admin.html', crew: 'crew.html', buyer: 'index.html#/jobs' };
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
  // Black-and-white line icons that match the Top Hat logo.
  const ICONS = {
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
    house: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/>',
    worker: '<path d="M6.5 10.5a5.5 5.5 0 0 1 11 0"/><path d="M4.5 10.5h15"/><path d="M12 5v2.5"/><path d="M8 10.5v1.5a4 4 0 0 0 8 0v-1.5"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>',
    dollar: '<circle cx="12" cy="12" r="9"/><path d="M15 9.4c-.6-.9-1.7-1.4-3-1.4-1.7 0-3 .9-3 2s1.3 1.8 3 2 3 .9 3 2-1.3 2-3 2c-1.3 0-2.4-.5-3-1.4"/><path d="M12 6.5v11"/>',
    toolbox: '<path d="M3 9h18v10H3z"/><path d="M8 9V6h8v3"/><path d="M3 13.5h18"/><path d="M10 13.5v2h4v-2"/>',
  };
  function icon(name) {
    const s = document.createElement('span');
    s.className = 'line-ic';
    s.setAttribute('aria-hidden', 'true');
    if (name === 'logo') { const img = document.createElement('img'); img.src = 'img/logo-mark.png'; img.alt = ''; s.append(img); s.classList.add('logo-ic'); return s; }
    s.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
    return s;
  }

  const DEMO_ACCOUNTS = [
    { icon: 'logo', label: 'Top Hat office', sub: 'Staff: leads, crew, estimates & invoices', email: 'office@tophat.demo', password: 'tophat' },
    { icon: 'phone', label: 'Salesperson', sub: 'Maria: her own clients, calls & estimates', email: 'maria@tophat.demo', password: 'sales1234' },
    { icon: 'house', label: 'Customer', sub: 'Dana: her jobs, estimates & invoices', email: 'dana@example.com', password: 'demo1234' },
    { icon: 'worker', label: 'Contractor', sub: 'Ray: his assigned jobs & pay', email: 'ray@tophat.demo', password: 'crew1234' },
  ];
  function loginForm({ title = 'Log in', note = '', onCustomer } = {}) {
    const errorBox = el('div', { class: 'error', hidden: !note, role: 'alert' }, note);
    const demoError = el('div', { class: 'error', hidden: true, role: 'alert' });
    const signIn = async (email, password, btn, isDemo) => {
      if (btn) btn.disabled = true;
      try { goHome(await window.TH.api.auth.signIn(email, password), onCustomer); }
      catch (err) {
        const box = isDemo ? demoError : errorBox;
        box.textContent = isDemo ? `${err.message} Tap “Reset preview data” at the bottom of the staff area, then try again.` : err.message;
        box.hidden = false; box.scrollIntoView({ block: 'center', behavior: 'smooth' });
        if (btn) btn.disabled = false;
      }
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
        demoError,
        ...DEMO_ACCOUNTS.map((a) => el('button', { type: 'button', class: 'demo-acct', onclick: (e) => signIn(a.email, a.password, e.currentTarget, true) },
          icon(a.icon),
          el('span', { class: 'body' }, el('b', {}, a.label), el('span', { class: 'muted small' }, a.sub)),
          el('span', { class: 'muted' }, '→')))));
  }

  // Spreadsheets for taxes and books: rows of values → a CSV file that opens in Excel, Numbers or Google Sheets.
  const csv = (rows) => '\ufeff' + rows.map((r) => r.map((v) => {
    const t = v == null ? '' : String(v);
    return /[",\n\r]/.test(t) || /^[=+\-@]/.test(t) ? `"${(/^[=+\-@]/.test(t) ? "'" : '') + t.replace(/"/g, '""')}"` : t;
  }).join(',')).join('\r\n');
  function download(name, data, type = 'text/csv;charset=utf-8') {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  // Load the zip library only when someone downloads their files.
  let zipLib = null;
  const loadZip = () => zipLib || (zipLib = new Promise((res, rej) => {
    if (window.JSZip) return res(window.JSZip);
    const sc = document.createElement('script'); sc.src = 'vendor/jszip-3.10.1.min.js'; sc.onload = () => res(window.JSZip); sc.onerror = () => { zipLib = null; rej(new Error('Couldn’t load the zip tool. Check your connection.')); };
    document.head.append(sc);
  }));

  // Saved designs as Before → After, grouped by the photo they started from. files: [{ url, name, stage, group }]
  function beforeAfter(files, { title = '🎨 Before & after' } = {}) {
    const list = (files || []).filter((f) => f.url);
    if (!list.length) return null;
    const groups = [];
    list.forEach((f) => { const k = f.group || f.url; let g = groups.find((x) => x.k === k); if (!g) { g = { k, before: null, after: [] }; groups.push(g); } if (f.stage === 'before') g.before = f; else g.after.push(f); });
    const pic = (f, label) => el('a', { class: 'ba-pic', href: f.url, target: '_blank', rel: 'noopener' }, el('img', { src: f.url, alt: `${label}: ${f.name}` }), el('span', { class: 'ba-tag ' + label.toLowerCase() }, label));
    return el('div', { class: 'stack', style: 'gap:8px' }, el('b', { class: 'small' }, title),
      ...groups.map((g) => el('div', { class: 'ba-row' }, g.before ? pic(g.before, 'Before') : null, g.before && g.after.length ? el('span', { class: 'ba-arrow', 'aria-hidden': 'true' }, '→') : null,
        ...g.after.map((f) => pic(f, 'After')))));
  }

  // Materials list on a job, shared by every screen.
  // mode: 'office' (add, order, set arrival date, remove) · 'crew' (add what's needed, mark delivered) · 'customer' (read only)
  function materialsCard(job, { mode = 'customer', onChange = () => {} } = {}) {
    const list = job.materials || [];
    const st = (id) => MATERIAL_STATUS.find((x) => x.id === id) || MATERIAL_STATUS[0];
    const fmt = (d) => (d ? new Date(d + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');
    const errorBox = el('div', { class: 'error', hidden: true, role: 'alert' });
    const run = async (fn) => { try { await fn(); onChange(); } catch (e) { errorBox.textContent = e.message; errorBox.hidden = false; } };
    const counts = MATERIAL_STATUS.map((x) => [x, list.filter((m) => m.status === x.id).length]).filter(([, n]) => n);
    const row = (m) => {
      const s = st(m.status);
      const sub = [m.qty ? `Qty ${m.qty}` : null, m.status === 'ordered' && m.eta ? `arriving ${fmt(m.eta)}` : null, m.note || null].filter(Boolean).join(' · ');
      let actions = null;
      if (mode === 'office') {
        const sel = el('select', { 'aria-label': `Status of ${m.name}`, onchange: (e) => run(() => api.materials.update(job.id, m.id, { status: e.target.value })) },
          ...MATERIAL_STATUS.map((x) => el('option', { value: x.id, selected: x.id === m.status }, `${x.icon} ${x.label}`)));
        const eta = m.status === 'ordered' ? el('input', { type: 'date', value: m.eta || '', 'aria-label': `When ${m.name} arrives`, onchange: (e) => run(() => api.materials.update(job.id, m.id, { eta: e.target.value })) }) : null;
        actions = el('div', { class: 'mat-actions' }, sel, eta,
          el('button', { type: 'button', class: 'icon x', 'aria-label': `Remove ${m.name}`, onclick: () => { if (confirm(`Remove ${m.name}?`)) run(() => api.materials.remove(job.id, m.id)); } }, '✕'));
      } else if (mode === 'crew' && m.status === 'ordered') {
        actions = el('button', { type: 'button', class: 'ghost small', onclick: () => run(() => api.materials.update(job.id, m.id, { status: 'delivered' })) }, '✅ It’s here');
      }
      return el('li', { class: 'mat ' + m.status },
        el('span', { class: 'mat-ic', 'aria-hidden': 'true' }, s.icon),
        el('span', { class: 'mat-body' }, el('b', {}, m.name), el('span', { class: 'mat-st' }, s.label), sub ? el('span', { class: 'muted small' }, sub) : null),
        actions);
    };
    let form = null;
    if (mode !== 'customer') {
      const name = el('input', { placeholder: mode === 'crew' ? 'What do you need? e.g. 2 bundles of shingles' : 'Material, e.g. Quartz countertop', 'aria-label': 'Material', maxlength: '120' });
      const qty = el('input', { placeholder: 'Qty', 'aria-label': 'Quantity', maxlength: '40' });
      form = el('form', { class: 'mat-add', onsubmit: (e) => { e.preventDefault(); run(() => api.materials.add(job.id, { name: name.value, qty: qty.value })); } },
        el('div', { class: 'mat-add-row' }, name, qty), el('button', { type: 'submit', class: 'ghost block' }, mode === 'crew' ? '+ Tell the office I need this' : '+ Add material'));
    }
    return el('section', { class: 'card stack materials-card' },
      el('div', { class: 'row' }, el('h3', { style: 'flex:1' }, '📦 Materials'),
        counts.length ? el('span', { class: 'mat-sum' }, ...counts.map(([x, n]) => el('span', { class: 'pill mat-pill ' + x.id }, `${x.icon} ${n}`))) : null),
      el('p', { class: 'muted small' }, mode === 'customer' ? 'What’s been ordered for your project and when it arrives.'
        : mode === 'crew' ? 'What’s ordered and what’s here. Need something? Add it and the office will order it.'
          : 'Everything for this job: what needs ordering, what’s ordered, and what’s delivered. The crew and customer see it too.'),
      list.length ? el('ul', { class: 'mat-list' }, ...list.map(row)) : el('p', { class: 'muted small' }, mode === 'customer' ? 'Nothing ordered yet.' : 'No materials added yet.'),
      errorBox, form);
  }

  // Light / dark mode button in the top bar. Starts with the phone's setting; a tap picks one and it's remembered.
  function setupTheme() {
    const btn = document.getElementById('themeBtn');
    if (!btn) return;
    const mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
    const now = () => document.documentElement.dataset.theme || (mq && mq.matches ? 'dark' : 'light');
    const draw = () => { const dark = now() === 'dark'; btn.textContent = dark ? '☀️' : '🌙'; btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode'); btn.title = btn.getAttribute('aria-label'); };
    btn.addEventListener('click', () => {
      const next = now() === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('tophat.theme', next); } catch (e) {}
      draw();
    });
    if (mq && mq.addEventListener) mq.addEventListener('change', draw);
    draw();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupTheme); else setupTheme();

  window.TH = { beforeAfter, dreamRequest, materialsCard, SKILLS, doesTrade, STYLE_ROOMS, STYLE_TRADES, roomFromText, styleOf, MATERIAL_STATUS, US_STATES, stateName, stateFromZip, addrLine, csv, download, loadZip, PAY_METHODS, PERMIT_STATUSES, placeOf, ai: { config: aiConfig, set: setAiConfig, connect: connectAi, disconnect: () => { try { localStorage.removeItem(AI_KEY); } catch (e) {} }, DEFAULT_IMAGE_MODEL }, STAGES, icon, loginForm, goHome, _util: { guessKind, normEmail, digits, validateSignUp, MAX_FILE_MB, DEFAULT_SETTINGS }, api, TRADES, TIMEFRAMES, BUDGETS, STATUSES, FILE_KINDS, PHOTO_STAGES, el, ago, fmtWhen, find, shrinkImage };
})();
