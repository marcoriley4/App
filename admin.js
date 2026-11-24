'use strict';
/* Top Hat staff area: qualify leads, schedule jobs, assign crews. */
(function () {
  const { api, TRADES, TIMEFRAMES, BUDGETS, STATUSES, FILE_KINDS, PHOTO_STAGES, el, ago, fmtWhen, find } = TH;
  const view = document.getElementById('view');
  const drawerRoot = document.getElementById('drawerRoot');
  const OPEN = ['new', 'qualifying', 'hot', 'scheduled', 'in_progress'];

  let tab = 'today';
  let filter = 'open';
  let search = '';
  let jobs = [];
  let crew = [];
  let settings = {};
  let team = [];
  let records = []; // office-only: price book, templates, tasks, expenses, suppliers, staff, licenses, tickets, how-to, equipment
  let meUser = null;
  let isStaff = true; // false for salespeople
  const docs = TH.docs;
  const siteUrl = () => new URL('index.html', location.href).href;
  const addDays = (n) => { const d = new Date(Date.now() + n * 86400e3); return new Date(d - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 10); };
  const owedOn = (j) => (j.docs || []).reduce((t, d) => t + docs.owed(d), 0);

  if (api.mode === 'preview') {
    document.getElementById('previewBanner').hidden = false;
    document.getElementById('footer').append(
      'Preview mode · ',
      el('button', { class: 'link small', onclick: async () => {
        if (!confirm('Erase all preview data and start over with the sample leads?')) return;
        await api.resetPreview(); location.reload();
      } }, 'Reset preview data'),
    );
  }

  const tradeOf = (id) => find(TRADES, id) || TRADES.at(-1);
  const statusOf = (id) => find(STATUSES, id);
  const money = (n) => (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString();
  const jobNo = (j) => `TH-${j.number}`;
  const addrOf = (j) => TH.addrLine(j);
  const stateOptions = (sel, empty = '— State —') => [el('option', { value: '' }, empty), ...TH.US_STATES.map(([c, n]) => el('option', { value: c, selected: c === sel }, n))];
  // States that appear in a list, sorted by name, with how many of each ('' = no state).
  const statesIn = (list, of) => { const m = new Map(); list.forEach((x) => { const k = of(x) || ''; m.set(k, (m.get(k) || 0) + 1); });
    return [...m.entries()].sort((a, b) => (!a[0]) - (!b[0]) || TH.stateName(a[0]).localeCompare(TH.stateName(b[0]))); };
  const usableState = (groups) => (groups.some(([g]) => (g || 'none') === stateFilter) ? stateFilter : '');
  const kindOf = (id) => find(FILE_KINDS, id) || FILE_KINDS.at(-1);
  const fileSize = (n) => n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
  const num = (v) => (v === '' || v == null ? null : Number(v));
  let fileUrls = [];
  const releaseUrls = () => { fileUrls.forEach((u) => URL.revokeObjectURL(u)); fileUrls = []; };
  const initials = (name) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const telHref = (p) => 'tel:' + String(p).replace(/[^\d+]/g, '');
  const smsHref = (p, body) => 'sms:' + String(p).replace(/[^\d+]/g, '') + (body ? '?&body=' + encodeURIComponent(body) : '');

  function closeDrawer() { releaseUrls(); drawerRoot.replaceChildren(); document.body.style.overflow = ''; render(); }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drawerRoot.firstChild) closeDrawer(); });

  /* ---------- boot ---------- */
  async function boot() {
    const me = await api.auth.me();
    const nav = document.getElementById('nav');
    if (!me || !['staff', 'sales'].includes(me.role)) {
      nav.replaceChildren(el('a', { class: 'btn ghost small', href: 'index.html' }, 'Customer site'));
      return loginView(me);
    }
    nav.replaceChildren(
      el('a', { class: 'btn ghost small', href: 'index.html', target: '_blank' }, el('span', { class: 'wide-only' }, 'Customer site'), el('span', { class: 'narrow-only' }, '🌐 Site')),
      el('button', { class: 'link small', onclick: async () => { await api.auth.signOut(); location.reload(); } }, 'Log out'),
    );
    meUser = me; isStaff = me.role === 'staff';
    if (!isStaff) document.querySelector('.logo small').textContent = 'Sales';
    try { await load(); } catch (err) { await api.auth.signOut(); return loginView(null, err.message); }
    if (!(isStaff ? MAIN_TABS : SALES_TABS).some(([id]) => id === tab)) tab = 'today';
    render();
  }
  async function load() { [jobs, crew, settings, team, records] = await Promise.all([api.jobs.all(), api.contractors.list(), api.settings.get(), api.team.list(), isStaff ? api.records.list().catch(() => []) : Promise.resolve([])]); }
  const recs = (kind, jobId) => records.filter((r) => r.kind === kind && (jobId === undefined || r.jobId === jobId));

  function loginView(me, note) {
    view.replaceChildren(TH.loginForm({ note: note || (me ? `You're signed in as ${me.email}, which isn't a staff account. Log in with a staff account, or open your own area.` : '') }));
  }

  /* ---------- main ---------- */
  // Sales and Contractors are one tab, "Team", with a switch inside (owner's request).
  const MAIN_TABS = [['today', 'Today', '📅'], ['jobs', 'Jobs', '🗂️'], ['inbox', 'Inbox', '💬'], ['team', 'Team', '👥'], ['reports', 'Office', '🏢'], ['business', 'Payments', '💳']];
  let teamPart = 'sales'; // which half of Team is showing: 'sales' or 'crew'
  const SALES_TABS = [['today', 'Today', '📅'], ['jobs', 'My clients', '🗂️']];
  if (MAIN_TABS.some(([id]) => id === location.hash.slice(1))) tab = location.hash.slice(1);
  if (['sales', 'crew'].includes(location.hash.slice(1))) { tab = 'team'; teamPart = location.hash.slice(1); } // old links
  const salesName = (id) => team.find((x) => x.id === id)?.name;
  let stateFilter = ''; // jobs, customers and crew: show one state ('' = all, 'none' = no state set)
  let picking = false; const picked = new Set(); let jobsMsg = ''; // office: pick several leads and assign them to a salesperson at once
  let salesFilter = ''; // owner: show one salesperson's jobs ('' = everyone, 'none' = unassigned)

  // What needs attention, grouped in plain language. Shared by Today and the job cards.
  const hasNewNote = (j) => (j.crewNotes || []).some((n) => n.at > (j.crewNotesSeenAt || 0));
  // Anything new from the crew: a note, or a progress update they made.
  const crewUpdatedAt = (j) => (j.progressByCrew && j.progressAt > (j.crewNotesSeenAt || 0) ? j.progressAt : 0);
  const hasCrewNews = (j) => hasNewNote(j) || !!crewUpdatedAt(j);
  const stageOf = (id) => (TH.STAGES || []).find((x) => x.id === id);
  const progressText = (j) => (j.stage ? `${stageOf(j.stage).icon} ${stageOf(j.stage).label}` : ({ scheduled: 'Scheduled', in_progress: 'Working', completed: 'Done' })[j.status] || statusOf(j.status).label);
  const estWith = (j, st) => (j.docs || []).find((d) => d.type === 'estimate' && d.status === st);
  const liveInvoices = (j) => (j.docs || []).filter((d) => d.type === 'invoice' && d.status !== 'void');
  // Payment schedule on a job: the total it's based on, and each payment with its invoice once made.
  const approvedEstOf = (j) => (j.docs || []).filter((d) => d.type === 'estimate' && d.status === 'approved' && !d.changeOrder).at(-1);
  // Approved change orders add to the job total.
  const changeOrdersTotal = (j) => (j.docs || []).filter((d) => d.changeOrder && d.status === 'approved').reduce((t, d) => t + docs.totals(d).total, 0);
  const jobTotal = (j) => { const e = approvedEstOf(j); return e ? docs.totals(e).total + changeOrdersTotal(j) : Number(j.price) || 0; };
  // When each kind of payment shows as due. A "stage" payment is billed when that part of the work is done (tap it on the job); it nags once the job is finished.
  const DUE_FROM = { insurance: ['scheduled', 'in_progress', 'completed'], sold: ['scheduled', 'in_progress', 'completed'], start: ['in_progress', 'completed'], stage: ['completed'], mid: ['in_progress', 'completed'], done: ['completed'] };
  function planOf(j) {
    const total = jobTotal(j);
    if (!total || j.status === 'lost') return [];
    const invs = liveInvoices(j);
    const billedInFull = invs.some((d) => d.scheduleStep == null && d.status !== 'draft' && docs.totals(d).total >= total - 0.01);
    return docs.schedule(settings, total).map((p) => {
      const inv = invs.find((d) => d.scheduleStep === p.index) || null;
      return { ...p, inv, covered: !!inv || billedInFull, due: (DUE_FROM[p.when] || DUE_FROM.done).includes(j.status) };
    });
  }
  // The next payment that's due but not sent yet (a draft counts as not sent).
  // Finished and every invoice paid: now it's time to ask for a review.
  const paidUp = (j) => j.status === 'completed' && liveInvoices(j).length > 0 && owedOn(j) <= 0.005 && !needsInvoice(j) && !liveInvoices(j).some((d) => d.status === 'draft');
  const nextDue = (j) => planOf(j).find((p) => p.due && (!p.covered || p.inv?.status === 'draft')) || null;
  const needsInvoice = (j) => !!nextDue(j);
  // Crew money on a job: their pay plus approved extras, and what's been paid so far.
  const crewBillsOf = (j, sts) => (j.crewBills || []).filter((b) => sts.includes(b.status));
  const crewOwedTotal = (j) => (Number(j.crewPay) || 0) + crewBillsOf(j, ['approved', 'paid']).filter((b) => b.step == null).reduce((t, b) => t + Number(b.amount), 0);
  const crewPaidOn = (j) => { const p = crewBillsOf(j, ['paid']).reduce((t, b) => t + Number(b.amount), 0); return j.crewPaid ? Math.max(p, crewOwedTotal(j)) : p; };
  const reportsOf = (j) => (j.docs || []).flatMap((d) => (d.reports || []).filter((r) => r.status === 'pending').map((r) => ({ r, d })));
  const visitPassed = (j) => !!j.visitAt && new Date(j.visitAt).getTime() < Date.now();
  // Sold: the rep has been out (or the customer approved in writing). Time to pick a crew.
  const needsScheduling = (j) => (j.status === 'hot' && visitPassed(j)) || (['new', 'qualifying'].includes(j.status) && !!estWith(j, 'approved'));
  const needsVisit = (j) => j.status === 'hot' && !j.visitAt;
  const dayKey = (ms) => { const x = new Date(ms); return new Date(x - x.getTimezoneOffset() * 60e3).toISOString().slice(0, 10); };
  const timeOf = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const crewName = (j) => find(crew, j.contractorId)?.name;
  // Who does the walkthrough: the contractor booked for it, or the job's sales rep.
  const visitWhoName = (j) => (j.visitContractorId ? (find(crew, j.visitContractorId)?.name || 'Contractor') + ' (contractor)' : salesName(j.salesId));

  // Approved estimate totals: what a salesperson has sold.
  const soldTotal = (list) => list.reduce((t, j) => t + (j.docs || []).filter((d) => d.type === 'estimate' && d.status === 'approved').reduce((u, d) => u + docs.totals(d).total, 0), 0);

  function buckets() {
    const open = jobs.filter((j) => j.status !== 'lost');
    const today = dayKey(Date.now()), tomorrow = dayKey(Date.now() + 86400e3);
    return [
      { id: 'new', icon: '🔔', title: 'New leads: call with a phone estimate', why: 'Go over their photos and measurements and give them a price.', call: true,
        list: open.filter((j) => j.status === 'new').sort((a, b) => a.created - b.created),
        line: (j) => isStaff ? `${tradeOf(j.trade).label} · ${srcLabel(j.source)} · ${j.firstContactAt ? 'came in ' + ago(j.created) : '⏱ waiting ' + fmtDur(Date.now() - j.created)}` : `${tradeOf(j.trade).label} · came in ${ago(j.created)}` },
      { id: 'replies', icon: '↩️', title: 'Customers waiting on a reply', why: 'They texted or emailed back. Answer from the job’s Messages box.',
        list: open.filter(needsReply), line: (j) => `“${j.lastMessage.body.slice(0, 70)}” · ${ago(j.lastMessage.at)}` },
      { id: 'hotbook', icon: '🔥', title: 'Hot leads: book the visit', why: 'They agreed to the price. Send a sales rep or a contractor out for the walkthrough.',
        list: open.filter(needsVisit), line: (j) => `${tradeOf(j.trade).label}${j.price != null ? ' · agreed ' + money(j.price) : ''}${salesName(j.salesId) ? ' · ' + salesName(j.salesId) : ''}` },
      { id: 'declined', icon: '🙅', title: 'Crew can’t make it', why: 'Pick another crew or a new date.',
        list: open.filter((j) => j.status === 'scheduled' && j.crewResponse === 'declined'),
        line: (j) => `${crewName(j) || 'Crew'}: “${j.crewResponseNote || 'no reason given'}”` },
      { id: 'crewpay', icon: '💵', title: 'Set crew pay', why: 'Jobs a salesperson scheduled with no crew pay yet. Your crew sees their pay.', info: true,
        list: isStaff ? open.filter((j) => j.contractorId && ['scheduled', 'in_progress', 'completed'].includes(j.status) && j.crewPay == null && j.salesId) : [],
        line: (j) => `${salesName(j.salesId) || 'Sales'} scheduled ${crewName(j) || 'a crew'}` },
      { id: 'notes', icon: '👷', title: 'New updates from your crew', why: 'Progress updates and notes from the job.',
        list: jobs.filter(hasCrewNews).sort((a, b) => Math.max(crewUpdatedAt(b), 0) - Math.max(crewUpdatedAt(a), 0)),
        line: (j) => [crewUpdatedAt(j) ? `${j.progressBy}: ${progressText(j)}` : null, hasNewNote(j) ? 'new note' : null].filter(Boolean).join(' · ') },
      { id: 'visits', icon: '🤝', title: 'Visits today & tomorrow', why: 'Walkthroughs with customers who agreed to the price (sales rep or contractor).', info: true,
        list: open.filter((j) => j.status === 'hot' && j.visitAt && !visitPassed(j) && [today, tomorrow].includes(j.visitAt.slice(0, 10))).sort((a, b) => a.visitAt.localeCompare(b.visitAt)),
        line: (j) => `${j.visitAt.slice(0, 10) === today ? 'Today' : 'Tomorrow'} ${timeOf(j.visitAt)} · ${visitWhoName(j) || 'Nobody picked'}` },
      { id: 'followup', icon: '🤔', title: 'Thinking it over', why: 'Got a phone estimate but haven’t agreed yet. Follow up.', info: true,
        list: open.filter((j) => j.status === 'qualifying' && !estWith(j, 'sent') && !estWith(j, 'approved')),
        line: (j) => `${tradeOf(j.trade).label}${j.price != null ? ' · quoted ' + money(j.price) : ''}` },
      { id: 'schedule', icon: '✅', title: 'Rep visit done: schedule the crew', why: 'Sold? Pick who’s doing the work and when. Didn’t close? Mark it on the job.',
        list: open.filter(needsScheduling), line: (j) => `${tradeOf(j.trade).label}${j.price != null ? ' · ' + money(j.price) : ''}` },
      { id: 'invoice', icon: '🧾', title: 'Invoices to send', why: 'The next payment on the schedule is due.',
        list: jobs.filter(needsInvoice), line: (j) => { const p = nextDue(j); return `${p.label} · ${docs.usd(p.amount)}${p.inv ? ' · draft' : ''}`; } },
      { id: 'permits', icon: '📋', title: 'Permits to apply for', why: 'The customer approved it. Apply on the building department’s website.',
        list: open.filter((j) => j.permit?.status === 'authorized'), line: (j) => `${TH.placeOf(j.address) || j.zip} · signed by ${j.permit.authorizedBy}` },
      { id: 'reported', icon: '💵', title: 'Payments to confirm', why: 'The customer says they paid. Check your account, then record it.',
        list: isStaff ? jobs.filter((j) => reportsOf(j).length) : [],
        line: (j) => reportsOf(j).map(({ r, d }) => `${docs.usd(r.amount)} by ${r.method} · ${d.number}`).join(' · ') },
      { id: 'crewbills', icon: '🧾', title: 'Crew bills to approve', why: 'A contractor billed you for work they finished.',
        list: isStaff ? jobs.filter((j) => crewBillsOf(j, ['submitted']).length) : [],
        line: (j) => crewBillsOf(j, ['submitted']).map((b) => `${crewName(j) || 'Crew'}: ${b.label} ${docs.usd(b.amount)}`).join(' · ') },
      { id: 'paycrew', icon: '💸', title: 'Pay your crew', why: 'Approved crew bills, and finished jobs where the contractor hasn’t been paid.', info: true,
        list: isStaff ? jobs.filter((j) => crewBillsOf(j, ['approved']).length || (j.status === 'completed' && j.contractorId && j.crewPay != null && crewPaidOn(j) < crewOwedTotal(j) - 0.01 && !crewBillsOf(j, ['submitted']).length)) : [],
        line: (j) => `${crewName(j) || 'Crew'} · ${money(crewBillsOf(j, ['approved']).reduce((t, b) => t + Number(b.amount), 0) || (crewOwedTotal(j) - crewPaidOn(j)))} to pay` },
      { id: 'unpaid', icon: '💵', title: 'Waiting for payment', why: 'Invoices with money still owed.',
        list: jobs.filter((j) => owedOn(j) > 0).sort((a, b) => owedOn(b) - owedOn(a)),
        line: (j) => `${docs.usd(owedOn(j))} due${liveInvoices(j).some((d) => docs.state(d) === 'overdue') ? ' · OVERDUE' : ''}` },
      { id: 'waiting', icon: '⏳', title: 'Waiting on the customer', why: 'Estimates sent, not approved yet.', info: true,
        list: open.filter((j) => estWith(j, 'sent')), line: (j) => `${estWith(j, 'sent').number} · ${docs.usd(docs.totals(estWith(j, 'sent')).total)}` },
      { id: 'materials', icon: '🛒', title: 'Materials to order', why: 'Things a job needs that haven’t been ordered yet.',
        list: open.filter((j) => j.status !== 'completed' && (j.materials || []).some((m) => m.status === 'needed')),
        line: (j) => (j.materials || []).filter((m) => m.status === 'needed').map((m) => m.name + (m.qty ? ` (${m.qty})` : '')).join(', ') },
      { id: 'reviews', icon: '⭐', title: 'Ask for a review', why: 'Finished and paid in full, and the customer hasn’t been asked yet.',
        list: jobs.filter((j) => paidUp(j) && !j.review?.requestedAt && !j.review?.rating && (j.finishedAt || j.created) > Date.now() - 90 * 86400e3),
        line: (j) => `${tradeOf(j.trade).label} · finished ${ago(j.finishedAt || j.created)}` },
      { id: 'newreviews', icon: '🌟', title: 'New reviews', why: 'What customers said this week.', info: true,
        list: jobs.filter((j) => j.review?.rating && j.review.at > Date.now() - 7 * 86400e3),
        line: (j) => `${'★'.repeat(j.review.rating)}${j.review.comment ? ` “${j.review.comment.slice(0, 60)}${j.review.comment.length > 60 ? '…' : ''}”` : ''}` },
      { id: 'soon', icon: '📅', title: 'On the schedule today & tomorrow', why: 'Make sure the crew is set.', info: true,
        list: open.filter((j) => ['scheduled', 'in_progress'].includes(j.status) && j.scheduledFor && [today, tomorrow].includes(j.scheduledFor.slice(0, 10)))
          .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor)),
        line: (j) => `${j.scheduledFor.slice(0, 10) === today ? 'Today' : 'Tomorrow'} ${timeOf(j.scheduledFor)} · ${crewName(j) || 'No crew yet'}` },
    ];
  }
  // Salespeople only see what's theirs to act on: calls to make and estimates waiting.
  const SALES_BUCKETS = ['new', 'hotbook', 'visits', 'followup', 'declined', 'schedule', 'invoice', 'permits', 'materials', 'notes', 'waiting', 'soon', 'reviews', 'newreviews'];
  // Salespeople run their own projects; the owner oversees. These are the rep's job when the project has a salesperson.
  const REP_BUCKETS = ['hotbook', 'visits', 'followup', 'declined', 'schedule', 'invoice', 'permits', 'materials', 'notes', 'waiting', 'soon', 'reviews'];
  const myBuckets = () => buckets().filter((b) => isStaff || SALES_BUCKETS.includes(b.id))
    .map((b) => (isStaff && REP_BUCKETS.includes(b.id) ? { ...b, list: b.list.filter((j) => !j.salesId) } : b));
  const REP_LABELS = { hotbook: ['visit to book', 'visits to book'], declined: ['crew can’t make it', 'crews can’t make it'], schedule: ['sold job to schedule', 'sold jobs to schedule'],
    invoice: ['invoice to send', 'invoices to send'], permits: ['permit to apply for', 'permits to apply for'], materials: ['job needs materials ordered', 'jobs need materials ordered'],
    notes: ['crew update', 'crew updates'], reviews: ['review to ask for', 'reviews to ask for'] };
  const repLabel = (id, n) => `${n} ${(REP_LABELS[id] || [id, id])[n === 1 ? 0 : 1]}`;
  // Owner's oversight: what each rep has waiting on their projects.
  function oversightCard() {
    const all = buckets().filter((b) => REP_BUCKETS.includes(b.id) && !b.info);
    const reps = team.filter((x) => x.active !== false).map((x) => {
      const items = all.map((b) => [b, b.list.filter((j) => j.salesId === x.id)]).filter(([, l]) => l.length);
      return { x, items, waiting: items.reduce((t, [, l]) => t + l.length, 0), projects: jobs.filter((j) => j.salesId === x.id && OPEN.includes(j.status)).length };
    }).filter((r) => r.projects || r.waiting);
    if (!reps.length) return null;
    return el('section', { class: 'card stack oversight' },
      el('div', { class: 'todo-head' }, el('span', { class: 'todo-ic' }, '👀'),
        el('div', { style: 'flex:1;min-width:0' }, el('h3', {}, 'Your reps’ projects'), el('p', { class: 'muted small' }, 'Each rep runs their own projects. Here’s what’s waiting on each of them. Tap a rep to see everything.'))),
      ...reps.map((r) => el('button', { type: 'button', class: 'rep-row', onclick: () => salesDetail(r.x.id) },
        el('span', { class: 'avatar' }, initials(r.x.name)),
        el('span', { class: 'body' }, el('b', {}, r.x.name), el('span', { class: 'muted small' }, `${r.projects} open project${r.projects === 1 ? '' : 's'}`),
          r.items.length ? el('span', { class: 'flags' }, ...r.items.map(([b, l]) => el('span', { class: 'flag' + (['invoice', 'materials', 'declined', 'schedule'].includes(b.id) ? ' hot' : '') }, `${b.icon} ${repLabel(b.id, l.length)}`)))
            : el('span', { class: 'small good-text' }, '✓ Nothing waiting')),
        el('span', { class: 'todo-count' + (r.waiting ? '' : ' zero') }, String(r.waiting)))));
  }
  const attentionCount = () => myBuckets().filter((b) => !b.info).reduce((t, b) => t + b.list.length, 0);

  function render() {
    const todo = attentionCount();
    const newCount = jobs.filter((j) => j.status === 'new').length;
    const tabs = el('div', { class: 'tabs-bar main-tabs', role: 'tablist', style: 'margin-top:8px' },
      ...(isStaff ? MAIN_TABS : SALES_TABS).map(([id, label, icon]) => el('button', { role: 'tab', 'aria-current': String(tab === id), onclick: () => { tab = id; history.replaceState(null, '', '#' + id); render(); } },
        el('span', { class: 'tab-ic', 'aria-hidden': 'true' }, icon,
          id === 'today' && todo ? el('span', { class: 'count hot' }, String(todo)) : null,
          id === 'jobs' && newCount ? el('span', { class: 'count' }, String(newCount)) : null,
          id === 'inbox' && jobs.filter(needsReply).length ? el('span', { class: 'count hot' }, String(jobs.filter(needsReply).length)) : null),
        el('span', { class: 'tab-lbl' }, label))));
    if (tab === 'sales' || tab === 'crew') { teamPart = tab; tab = 'team'; }
    const teamSwitch = () => el('div', { class: 'tabs-bar team-switch', role: 'group', 'aria-label': 'Team' },
      ...[['sales', '💼 Sales'], ['crew', '👷 Contractors']].map(([id, label]) => el('button', { type: 'button', 'aria-pressed': String(teamPart === id),
        class: teamPart === id ? 'on' : '', onclick: () => { teamPart = id; render(); } }, label)));
    const body = tab === 'today' ? todayView() : tab === 'jobs' ? leadsView()
      : tab === 'inbox' ? inboxView() : tab === 'reports' ? officeView()
      : tab === 'team' ? [teamSwitch(), ...[].concat(teamPart === 'crew' ? crewView() : salesTeamView())] : businessView();
    view.replaceChildren(tabs, el('div', { class: 'stack', style: 'margin:16px 0' }, ...[].concat(body)));
    if (tab === 'today') fillDreams();
  }

  /* ---------- today ---------- */
  // Calendar on Today: crew work days and rep visits. Tap a day to see it, tap a job to open it.
  let calMonth = null; let calDay = null;
  function calendarCard() {
    const todayK = dayKey(Date.now());
    if (!calDay) calDay = todayK;
    if (!calMonth) calMonth = calDay.slice(0, 7);
    const events = [];
    jobs.filter((j) => j.status !== 'lost').forEach((j) => {
      if (j.scheduledFor && ['scheduled', 'in_progress', 'completed'].includes(j.status)) events.push({ j, at: j.scheduledFor, kind: 'work' });
      if (j.visitAt) events.push({ j, at: j.visitAt, kind: 'visit' });
    });
    const byDay = {};
    events.forEach((e) => { (byDay[e.at.slice(0, 10)] ||= []).push(e); });
    Object.values(byDay).forEach((l) => l.sort((a, b) => a.at.localeCompare(b.at)));
    const [y, m] = calMonth.split('-').map(Number);
    const first = new Date(y, m - 1, 1); const days = new Date(y, m, 0).getDate();
    const pad = (n) => String(n).padStart(2, '0');
    const card = el('section', { class: 'card stack cal-card' });
    const draw = () => {
      const cells = [];
      for (let i = 0; i < first.getDay(); i++) cells.push(el('span', { class: 'tcal-blank' }));
      for (let d = 1; d <= days; d++) {
        const k = `${y}-${pad(m)}-${pad(d)}`; const ev = byDay[k] || [];
        cells.push(el('button', { type: 'button', class: 'tcal-cell' + (k === calDay ? ' on' : '') + (k === todayK ? ' today' : '') + (ev.length ? ' has' : ''),
          'aria-label': `${new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}: ${ev.length ? ev.length + (ev.length === 1 ? ' job' : ' jobs') : 'nothing'}`,
          'aria-pressed': String(k === calDay), onclick: () => { calDay = k; draw(); apptDialog(k); } },
          el('span', { class: 'tcal-num' }, String(d)),
          ev.length ? el('span', { class: 'tcal-dots' }, ...ev.slice(0, 3).map((e) => el('i', { class: e.kind }))) : null,
          ev.length > 3 ? el('span', { class: 'tcal-more' }, `+${ev.length - 3}`) : null));
      }
      const list = byDay[calDay] || [];
      const dayName = new Date(calDay + 'T12:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
      const go = (dm) => { const d = new Date(y, m - 1 + dm, 1); calMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; render(); };
      card.replaceChildren(...[
        el('div', { class: 'row' }, el('h3', { style: 'flex:1' }, '📅 Calendar'),
          el('span', { class: 'tcal-key' }, el('i', { class: 'work' }), 'Crew', el('i', { class: 'visit' }), 'Visit')),
        el('div', { class: 'tcal-head' },
          el('button', { type: 'button', class: 'ghost small', 'aria-label': 'Previous month', onclick: () => go(-1) }, '‹'),
          el('b', {}, first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })),
          el('button', { type: 'button', class: 'ghost small', 'aria-label': 'Next month', onclick: () => go(1) }, '›')),
        el('div', { class: 'tcal-grid' }, ...['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((x) => el('span', { class: 'tcal-dow' }, x)), ...cells),
        calMonth !== todayK.slice(0, 7) || calDay !== todayK ? el('button', { type: 'button', class: 'link small', style: 'align-self:center', onclick: () => { calDay = todayK; calMonth = todayK.slice(0, 7); render(); } }, 'Back to today') : null,
        el('div', { class: 'tcal-day' },
          el('b', {}, calDay === todayK ? `Today · ${dayName}` : dayName),
          list.length ? el('div', { class: 'tcal-list' }, ...list.map((e) => {
            const who = e.kind === 'work' ? (crewName(e.j) ? '👷 ' + crewName(e.j) : '👷 No crew yet') : '🤝 Visit' + (visitWhoName(e.j) ? ' · ' + visitWhoName(e.j) : '');
            return el('button', { type: 'button', class: 'tcal-item ' + e.kind, onclick: () => openLead(e.j.id, 'overview') },
              el('span', { class: 'tcal-time' }, new Date(e.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })),
              el('span', { class: 'body' }, el('b', {}, `${e.j.buyer.name}`), el('span', { class: 'muted small' }, `${tradeOf(e.j.trade).icon} ${tradeOf(e.j.trade).label} · ${jobNo(e.j)}`), el('span', { class: 'small' }, who)),
              el('span', { class: 'chev', 'aria-hidden': 'true' }, '›'));
          })) : el('p', { class: 'muted small' }, 'Nothing scheduled this day.'))].filter(Boolean));
    };
    draw();
    return card;
  }

  // Tap a day on the calendar: make an appointment. Pick the customer's job, a time, the contractor, the sales rep, and notes.
  // Saved on the job: contractor + work day (green on the calendar), or a rep visit (blue) when only a rep is picked.
  function apptDialog(day) {
    const open = jobs.filter((j) => !['lost', 'completed'].includes(j.status))
      .sort((a, b) => a.buyer.name.localeCompare(b.buyer.name) || a.number - b.number);
    const dayName = new Date(day + 'T12:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    const err = el('div', { class: 'error', hidden: true, role: 'alert' });
    const jobSel = el('select', { 'aria-label': 'Customer' }, el('option', { value: '' }, 'Pick the customer'),
      ...open.map((j) => el('option', { value: j.id }, `${j.buyer.name} · ${jobNo(j)} · ${tradeOf(j.trade).label}`)));
    const time = el('input', { type: 'time', value: '09:00', 'aria-label': 'Time' });
    const crewSel = el('select', { 'aria-label': 'Contractor' }, el('option', { value: '' }, 'No contractor'),
      ...crew.filter((c) => c.active).sort((a, c) => a.name.localeCompare(c.name)).map((c) => el('option', { value: c.id, disabled: insuranceExpired(c.id) }, `${c.name}${c.state ? ` · ${c.state}` : ''}${insuranceExpired(c.id) ? ' (insurance ran out)' : ''}${offTag(c.id, day)}`)));
    const repSel = isStaff ? el('select', { 'aria-label': 'Sales rep' }, el('option', { value: '' }, 'No sales rep'),
      ...team.filter((x) => x.active !== false).map((x) => el('option', { value: x.id }, x.name))) : null;
    const notes = el('textarea', { rows: 3, maxlength: '1000', placeholder: 'What’s happening? e.g. measure the deck, bring tile samples', 'aria-label': 'Notes' });
    // Picking a customer fills in who's already on their job.
    jobSel.addEventListener('change', () => { const j = open.find((x) => x.id === jobSel.value); if (!j) return;
      if (j.contractorId) crewSel.value = j.contractorId; if (repSel && j.salesId) repSel.value = j.salesId; });
    const dlg = el('dialog', { class: 'appt-dialog', 'aria-label': `New appointment on ${dayName}` });
    const close = () => { dlg.close(); dlg.remove(); };
    const save = async (e) => {
      const btn = e.currentTarget; err.hidden = true;
      const j = open.find((x) => x.id === jobSel.value);
      if (!j) { err.textContent = 'Pick the customer.'; err.hidden = false; return; }
      if (!crewSel.value && !(repSel ? repSel.value : j.salesId)) { err.textContent = 'Pick a contractor or a sales rep.'; err.hidden = false; return; }
      if (!/^\d{2}:\d{2}$/.test(time.value)) { err.textContent = 'Pick a time.'; err.hidden = false; return; }
      const at = `${day}T${time.value}`;
      const patch = {};
      if (repSel && repSel.value !== (j.salesId || '')) patch.salesId = repSel.value || null;
      if (crewSel.value) {
        patch.contractorId = crewSel.value; patch.scheduledFor = at;
        if (['new', 'qualifying', 'hot'].includes(j.status)) patch.status = 'scheduled';
      } else patch.visitAt = at; // only a rep: a rep visit
      const txt = notes.value.trim();
      if (txt) patch.notes = [j.notes || '', `📅 ${new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}: ${txt}`].filter(Boolean).join('\n\n');
      btn.disabled = true;
      try { await api.jobs.update(j.id, patch); close(); await load(); calDay = day; calMonth = day.slice(0, 7); render(); }
      catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
    };
    dlg.append(el('div', { class: 'stack' },
      el('div', { class: 'row' }, el('h3', { style: 'flex:1' }, `📅 New appointment`), el('button', { type: 'button', class: 'ghost small', 'aria-label': 'Close', onclick: close }, '✕')),
      el('p', { class: 'muted small', style: 'margin:0' }, dayName),
      el('label', { class: 'field' }, 'Customer', jobSel,
        el('button', { type: 'button', class: 'link small', style: 'align-self:flex-start', onclick: () => { close(); newJobForm(); } }, 'New customer? Add their job first')),
      el('label', { class: 'field' }, 'Time', time),
      el('label', { class: 'field' }, '👷 Contractor', crewSel),
      repSel ? el('label', { class: 'field' }, '💼 Sales rep', repSel) : null,
      el('label', { class: 'field' }, '📝 Notes', notes),
      el('p', { class: 'muted small', style: 'margin:0' }, 'With a contractor it’s a work day (green). With only a sales rep it’s a rep visit (blue).'),
      err,
      el('div', { class: 'row', style: 'gap:8px' },
        el('button', { type: 'button', class: 'ghost', style: 'flex:1', onclick: close }, 'Cancel'),
        el('button', { type: 'button', class: 'gold', style: 'flex:2', onclick: save }, 'Save appointment'))));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    dlg.addEventListener('change', () => { err.hidden = true; }); dlg.addEventListener('input', () => { err.hidden = true; });
    document.body.append(dlg); dlg.showModal();
  }


  /* ---------- owner command center (office checklist 1.1–1.3) ---------- */
  const monthlyGoal = () => Number(settings.goalMonthly) || 300000; // sales goal per month
  const WON = ['scheduled', 'in_progress', 'completed'];
  const paymentsOf = () => jobs.flatMap((j) => liveInvoices(j).flatMap((d) => (d.payments || []).map((p) => ({ j, date: String(p.date || '').slice(0, 10), amount: Number(p.amount) || 0 }))));
  const isKitchen = (j) => String(j.style || '').startsWith('kitchen/') || /kitchen/i.test(j.description || '');
  const soldAt = (j) => j.scheduledFor ? Date.parse(j.scheduledFor) : j.created; // when it became a sale (best guess)
  // Insurance problems: ran out, runs out within 30 days, or none on file (only the office sees insurance).
  const insuranceIssues = () => [...crew.filter((c) => c.active && 'insurance' in c).flatMap((c) => {
    const pf = c.profile || {}; const t = dayKey(Date.now()); const soon = dayKey(Date.now() + 30 * 864e5); const out = [];
    if (pf.license_expires && pf.license_expires <= soon) out.push({ c, kind: pf.license_expires < t ? 'out' : 'soon', text: `contractor license ${pf.license_expires < t ? 'ran out' : 'runs out'} ${docs.fmtDate(pf.license_expires)}` });
    if (!c.w9 && jobs.some((j) => j.contractorId === c.id && (j.crewBills || []).some((b) => b.status === 'paid'))) out.push({ c, kind: 'w9', text: 'no W-9 yet (needed for their 1099)' });
    return out; }), ...crew.filter((c) => c.active && 'insurance' in c).map((c) => {
    const ins = c.insurance; const t = dayKey(Date.now()); const soon = dayKey(Date.now() + 30 * 864e5);
    if (!ins) return { c, kind: 'none', text: 'no proof of insurance' };
    if (ins.expires && ins.expires < t) return { c, kind: 'out', text: `insurance ran out ${docs.fmtDate(ins.expires)}` };
    if (ins.expires && ins.expires <= soon) return { c, kind: 'soon', text: `insurance runs out ${docs.fmtDate(ins.expires)}` };
    return null; }).filter(Boolean)];
  // Contractor's own availability: weekdays off and dates they're booked (they set these in their login).
  const crewOff = (cid, when) => { const c = crew.find((x) => x.id === cid); const pf = c && c.profile; if (!pf || !when) return false;
    const day = String(when).slice(0, 10); return (pf.blocked || []).includes(day) || (pf.days_off || []).includes(new Date(day + 'T12:00').getDay()); };
  const offTag = (cid, when) => (crewOff(cid, when) ? ' (off that day)' : '');
  const crewRating = (cid) => { const r = recs('crew_review').filter((x) => x.contractorId === cid); return r.length ? { avg: r.reduce((t, x) => t + (Number(x.stars) || 0), 0) / r.length, n: r.length } : null; };
  const lienOf = (b) => (b.lien && typeof b.lien === 'object' ? b.lien : b.lienSig || null);
  const insuranceExpired = (cid) => { const c = crew.find((x) => x.id === cid); return !!(c && c.insurance && c.insurance.expires && c.insurance.expires < dayKey(Date.now())); };
  // No update in 7 days on a job that should be moving.
  const stalledJobs = () => jobs.filter((j) => ['scheduled', 'in_progress', 'hot', 'qualifying'].includes(j.status)
    && Date.now() - (j.progressAt || j.created) > 7 * 864e5 && !(j.status === 'scheduled' && j.scheduledFor && Date.parse(j.scheduledFor) > Date.now()));

  function companyCard() {
    const now = new Date(); const y = now.getFullYear(); const ym = dayKey(Date.now()).slice(0, 7);
    const q = Math.floor(now.getMonth() / 3); const inQ = (k) => k.slice(0, 4) === String(y) && Math.floor((Number(k.slice(5, 7)) - 1) / 3) === q;
    const pays = paymentsOf();
    const collected = (f) => pays.filter((p) => f(p.date)).reduce((t, p) => t + p.amount, 0);
    const wonThisYear = jobs.filter((j) => WON.includes(j.status) && new Date(soldAt(j)).getFullYear() === y);
    const finished = jobs.filter((j) => j.status === 'completed' && j.price != null && j.crewPay != null);
    const profit = finished.reduce((t, j) => t + (j.price - j.crewPay - expensesOf(j.id) - (j.crewBills || []).filter((b) => b.step == null && ['approved', 'paid'].includes(b.status)).reduce((s, b) => s + Number(b.amount), 0)), 0);
    const profitPct = finished.reduce((t, j) => t + j.price, 0) ? Math.round(profit / finished.reduce((t, j) => t + j.price, 0) * 100) : null;
    const leads7 = jobs.filter((j) => Date.now() - j.created < 7 * 864e5).length;
    const decided = jobs.filter((j) => WON.includes(j.status) || j.status === 'lost');
    const closeRate = decided.length ? Math.round(jobs.filter((j) => WON.includes(j.status)).length / decided.length * 100) : null;
    const rated = jobs.filter((j) => j.review && j.review.rating);
    const avg = rated.length ? (rated.reduce((t, j) => t + j.review.rating, 0) / rated.length).toFixed(1) : null;
    // Goal: monthly sales (owner's goal: $300,000 a month). Quarter = 3 months, year = 12.
    const gMonth = monthlyGoal();
    const soldRev = (list) => list.reduce((t, j) => t + (Number(j.price) || 0), 0);
    const inMonth = wonThisYear.filter((j) => dayKey(soldAt(j)).slice(0, 7) === ym), inQuarter = wonThisYear.filter((j) => inQ(dayKey(soldAt(j))));
    // How far through the month / quarter / year we are today, for the "on pace" marker.
    const daysIn = (a, b) => Math.round((b - a) / 864e5);
    const mStart = new Date(y, now.getMonth(), 1), qStart = new Date(y, q * 3, 1), yStart = new Date(y, 0, 1);
    const paceOf = (start, end) => Math.min(1, (daysIn(start, now) + 1) / daysIn(start, end));
    const paces = { month: paceOf(mStart, new Date(y, now.getMonth() + 1, 1)), quarter: paceOf(qStart, new Date(y, q * 3 + 3, 1)), year: paceOf(yStart, new Date(y + 1, 0, 1)) };
    const bar = (have, goal, pace) => el('div', { class: 'goal-bar' }, el('span', { style: `width:${Math.min(100, Math.round(have / goal * 100))}%` }), el('i', { style: `left:${Math.min(100, Math.round(pace * 100))}%`, title: 'Where you should be today' }));
    const goalRow = (label, have, goal, fmt, pace) => el('div', { class: 'goal-row' },
      el('div', { class: 'row' }, el('b', {}, label), el('span', { class: 'spacer' }), el('span', {}, `${fmt(have)} of ${fmt(goal)}`)),
      bar(have, goal, pace),
      el('span', { class: 'muted small' }, have >= goal * pace ? `✓ On pace (${fmt(Math.round(goal * pace))} by today)` : `Behind pace: ${fmt(Math.round(goal * pace))} by today`));
    const tile = (v, k) => el('div', { class: 'kpi' }, el('b', {}, v), el('span', {}, k));
    return el('section', { class: 'card stack company-card' },
      el('div', { class: 'row' }, el('h3', { style: 'flex:1' }, '🎩 Company'), el('span', { class: 'muted small' }, String(y))),
      el('div', { class: 'kpis company-kpis' },
        tile(money(collected((d) => d.slice(0, 7) === ym)), 'Collected this month'),
        tile(money(collected((d) => d.slice(0, 4) === String(y))), 'Collected this year'),
        tile(money(profit) + (profitPct != null ? ` · ${profitPct}%` : ''), 'Profit on finished jobs'),
        tile(money(jobs.reduce((t, j) => t + owedOn(j), 0)), 'Owed to you'),
        tile(String(jobs.filter((j) => j.status === 'in_progress').length), 'Jobs in progress'),
        tile(String(leads7), 'Leads this week'),
        tile(closeRate == null ? '—' : closeRate + '%', 'Close rate'),
        tile(avg ? `${avg} ★` : '—', `Average rating${rated.length ? ` (${rated.length})` : ''}`),
        tile('—', 'Cash in bank (connect bank)')),
      el('h3', {}, `🎯 Goal: ${money(gMonth)} a month in sales`),
      goalRow(`Sold in ${now.toLocaleDateString(undefined, { month: 'long' })}`, soldRev(inMonth), gMonth, money, paces.month),
      goalRow('Sold this quarter', soldRev(inQuarter), gMonth * 3, money, paces.quarter),
      goalRow(`Sold in ${y}`, soldRev(wonThisYear), gMonth * 12, money, paces.year),
      el('p', { class: 'muted small', style: 'margin:0' }, 'Change the goal on the Payments tab. Profit = customer price − crew pay − approved extras − job expenses, on finished jobs.'));
  }

  // Alerts the owner wants: stalled jobs and contractor insurance (overdue invoices and new leads are already in the lists below).
  function alertsCard() {
    const stalled = stalledJobs(); const ins = insuranceIssues().filter((x) => x.kind !== 'none' || jobs.some((j) => j.contractorId === x.c.id && WON.includes(j.status) && j.status !== 'completed'));
    const oa = isStaff ? officeAlerts() : [];
    if (!stalled.length && !ins.length && !oa.length) return null;
    return el('section', { class: 'card stack alerts-card' },
      el('h3', {}, '⚠️ Needs a look'),
      ...stalled.slice(0, 8).map((j) => el('button', { type: 'button', class: 'alert-row', onclick: () => openLead(j.id, 'overview') },
        el('b', {}, `🐢 ${j.buyer.name} · ${jobNo(j)}`), el('span', { class: 'muted small' }, `No update in ${Math.floor((Date.now() - (j.progressAt || j.created)) / 864e5)} days · ${find(STATUSES, j.status)?.label || j.status}`))),
      ...ins.map((x) => el('button', { type: 'button', class: 'alert-row', onclick: () => { tab = 'team'; teamPart = 'crew'; render(); } },
        el('b', {}, `${x.kind === 'out' ? '⛔' : '🛡'} ${x.c.name}`), el('span', { class: 'muted small' }, x.text))),
      ...oa.map((x) => el('button', { type: 'button', class: 'alert-row', onclick: () => { tab = 'reports'; officePart = x.part; history.replaceState(null, '', '#reports'); render(); } },
        el('b', {}, `${x.icon} ${x.title}`), el('span', { class: 'muted small' }, x.text))));
  }

  /* ---------- leads, messages & reports (CRM checklist 1, 2, 14 · office checklist 2, 6) ---------- */
  const LEAD_OPEN = ['new', 'qualifying', 'hot'];
  const JOB_EXPENSE_CATS = ['Materials', 'Permits & fees', 'Dumpster / disposal', 'Equipment rental', 'Extra labor', 'Fuel & delivery', 'Other'];
  const OVERHEAD_CATS = ['Rent / office', 'Trucks & fuel', 'Insurance', 'Angi / lead fees', 'Marketing & ads', 'Software & phone', 'Payroll (office)', 'Tools & equipment', 'Accounting & legal', 'Other'];
  const expensesOf = (jid) => recs('expense', jid).reduce((t, x) => t + (Number(x.amount) || 0), 0);
  const srcLabel = (id) => TH.sourceLabel(id);
  const normAddr = (j) => String(j.address || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const fmtDur = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 1440)} days`; };
  const speedOf = (j) => (j.firstContactAt ? j.firstContactAt - j.created : null);
  // The same person asking twice (same phone, email or address on another open lead).
  function dupesOf(j) {
    const ph = digitsOnly(j.buyer.phone), em = String(j.buyer.email || '').toLowerCase(), ad = normAddr(j);
    return jobs.filter((x) => x.id !== j.id && (LEAD_OPEN.includes(x.status) || Math.abs(x.created - j.created) < 30 * 864e5) && x.status !== 'lost'
      && ((ph.length >= 10 && digitsOnly(x.buyer.phone) === ph) || (em && String(x.buyer.email || '').toLowerCase() === em) || (ad.length > 6 && normAddr(x) === ad)));
  }
  // Hot / warm / cold for open leads, from their answers.
  function leadTemp(j) {
    if (!LEAD_OPEN.includes(j.status)) return null;
    if (j.status === 'hot') return { id: 'hot', label: '🔥 Hot' };
    let s = 0;
    if (j.homeowner === true) s += 2; else if (j.homeowner === false) s -= 3;
    const tf = j.timeframe || '';
    if (['asap', '2weeks'].includes(tf) || (/^\d{4}-\d{2}-\d{2}$/.test(tf) && Date.parse(tf) - Date.now() < 45 * 864e5)) s += 2;
    else if (tf === 'month') s += 1; else if (tf === 'flexible') s -= 1;
    if ((j.designs || []).length) s += 1;
    if (['mid', 'premium'].includes(j.budget)) s += 1;
    if (j.price != null) s += 1;
    if (Date.now() - j.created > 21 * 864e5) s -= 2;
    return s >= 4 ? { id: 'hot', label: '🔥 Hot' } : s >= 2 ? { id: 'warm', label: '🌤 Warm' } : { id: 'cold', label: '❄️ Cold' };
  }
  // Fill a template: {first} {company} {phone} {job} {trade}.
  const fillTemplate = (body, j) => String(body || '').replace(/\{(\w+)\}/g, (m, k) => ({
    first: (j.buyer.name || '').split(' ')[0] || 'there', company: settings.name || 'Top Hat Contracting', phone: settings.phone || '',
    job: jobNo(j), trade: tradeOf(j.trade).label.toLowerCase() }[k] ?? m));
  const templatesOf = () => (Array.isArray(settings.templates) && settings.templates.length ? settings.templates : TH.DEFAULT_TEMPLATES);
  const needsReply = (j) => j.lastMessage && j.lastMessage.dir === 'in';
  // Follow-up: open lead with no call/text/email in 2+ days.
  const lastTouch = (j) => Math.max(j.firstContactAt || 0, j.lastMessage?.at || 0);
  const needsFollowUp = (j) => ['qualifying', 'hot'].includes(j.status) && !j.doNotContact && lastTouch(j) && Date.now() - lastTouch(j) > 2 * 864e5 && !j.visitAt;

  // Lead details on the job: temperature, source, homeowner, decision makers, do-not-contact, speed to lead, duplicates.
  function leadBox(j, update) {
    const temp = leadTemp(j); const dupes = dupesOf(j); const sp = speedOf(j);
    const yn = (val, label) => el('button', { type: 'button', class: 'chip', 'aria-pressed': String(j.homeowner === val), onclick: () => update({ homeowner: j.homeowner === val ? null : val }) }, label);
    return el('div', { class: 'stack lead-box', style: 'gap:8px' },
      el('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px' },
        temp ? el('span', { class: 'pill temp-' + temp.id }, temp.label) : null,
        el('select', { class: 'inline-select', 'aria-label': 'Lead source', onchange: (e) => update({ source: e.target.value }) },
          el('option', { value: '' }, 'Where did they find us?'), ...TH.LEAD_SOURCES.map((x) => el('option', { value: x.id, selected: x.id === j.source }, `📣 ${x.label}`)))),
      el('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px' }, el('span', { class: 'small' }, '🏠 Homeowner?'), yn(true, 'Yes'), yn(false, 'No (renter / other)')),
      el('label', { class: 'mini-field' }, el('span', { class: 'muted small' }, '👥 Who decides (spouse, landlord…)'),
        el('input', { class: 'inline-select', 'aria-label': 'Decision makers', maxlength: '200', value: j.decisionMakers || '', placeholder: 'e.g. Wife Karen has to see it', onchange: (e) => update({ decisionMakers: e.target.value }) })),
      el('p', { class: 'small ' + (sp == null && LEAD_OPEN.includes(j.status) && Date.now() - j.created > 15 * 60e3 ? 'bad-text' : 'muted'), style: 'margin:0' },
        sp != null ? `⏱ First contact ${fmtDur(sp)} after the lead came in` : LEAD_OPEN.includes(j.status) ? `⏱ Not contacted yet · waiting ${fmtDur(Date.now() - j.created)}` : '⏱ No contact recorded'),
      dupes.length ? el('div', { class: 'dupe-warn small' }, '⚠️ Possible duplicate: ',
        ...dupes.slice(0, 3).flatMap((x, i) => [i ? ', ' : '', el('button', { type: 'button', class: 'link small', onclick: () => openLead(x.id, 'overview') }, `${jobNo(x)} (${statusOf(x.status).label})`)])) : null,
      el('label', { class: 'dnc-row small' },
        el('input', { type: 'checkbox', checked: !!j.doNotContact, 'aria-label': 'Do not contact', onchange: (e) => update({ doNotContact: e.target.checked }) }),
        el('span', {}, '🚫 Do not contact (they asked us to stop calling or texting)')));
  }

  // Conversation with the customer: texts, emails and calls, plus a box to send one from your phone using a template.
  function convoBox(j, messages, after) {
    const b = j.buyer; let channel = b.phone ? 'text' : 'email';
    const err = el('div', { class: 'error', hidden: true, role: 'alert' });
    const body = el('textarea', { rows: 3, 'aria-label': 'Message', placeholder: 'Type a message, or tap a ready-made one above' });
    const chips = el('div', { class: 'stage-chips' });
    const chanBtns = el('div', { class: 'row', style: 'gap:6px' });
    const draw = () => {
      chanBtns.replaceChildren(...[['text', '💬 Text', b.phone], ['email', '✉️ Email', b.email]].filter((x) => x[2]).map(([id, label]) =>
        el('button', { type: 'button', class: 'chip', 'aria-pressed': String(channel === id), onclick: () => { channel = id; draw(); } }, label)));
      chips.replaceChildren(...templatesOf().filter((t) => (t.channel || 'text') === channel || channel === 'email').map((t) =>
        el('button', { type: 'button', class: 'chip', onclick: () => { body.value = fillTemplate(t.body, j); body.focus(); } }, t.name)));
    };
    draw();
    const save = async (dir, btn) => {
      err.hidden = true; btn.disabled = true;
      try {
        await api.jobs.addMessage(j.id, { channel, dir, body: body.value });
        if (dir === 'out') {
          const href = channel === 'email' ? `mailto:${b.email}?subject=${encodeURIComponent(`${settings.name || 'Top Hat Contracting'} · ${jobNo(j)}`)}&body=${encodeURIComponent(body.value)}` : smsHref(b.phone, body.value);
          const a = el('a', { href, hidden: true }); document.body.append(a); try { a.click(); } catch (e) {} a.remove();
        }
        after();
      } catch (e) { err.textContent = e.message; err.hidden = false; btn.disabled = false; }
    };
    let showAll = false;
    const list = el('div', { class: 'convo' });
    const drawList = () => {
      const shown = showAll ? messages : messages.slice(-6);
      list.replaceChildren(...[
        messages.length > shown.length ? el('button', { type: 'button', class: 'link small', onclick: () => { showAll = true; drawList(); } }, `Show all ${messages.length}`) : null,
        ...shown.map((m) => el('div', { class: 'msg ' + (m.dir === 'in' ? 'in' : 'out') + (m.channel === 'call' ? ' call' : '') },
          el('p', {}, m.channel === 'call' ? `📞 ${m.body}` : m.body),
          el('span', { class: 'muted small' }, `${m.channel === 'email' ? '✉️ ' : m.channel === 'text' ? '💬 ' : ''}${m.dir === 'in' ? (b.name || 'Customer') : m.by} · ${ago(m.at)}`))),
        messages.length ? null : el('p', { class: 'muted small' }, 'No texts or emails saved yet.')].filter(Boolean));
    };
    drawList();
    return el('section', { class: 'card stack convo-card', id: 'convo' },
      el('div', { class: 'row' }, el('h3', { style: 'flex:1' }, '💬 Messages'), needsReply(j) ? el('span', { class: 'flag hot' }, 'Customer replied') : null),
      list,
      j.doNotContact ? el('p', { class: 'small bad-text' }, '🚫 This customer asked not to be contacted. Uncheck “Do not contact” above if they say it’s OK again.')
        : (b.phone || b.email) ? el('div', { class: 'stack', style: 'gap:8px' }, chanBtns, chips, body, err,
          el('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
            el('button', { type: 'button', style: 'flex:1', onclick: (e) => save('out', e.currentTarget) }, channel === 'email' ? 'Send email' : 'Send text'),
            el('button', { type: 'button', class: 'ghost', style: 'flex:1', onclick: (e) => save('in', e.currentTarget) }, 'Save their reply')),
          el('p', { class: 'muted small', style: 'margin:0' }, 'Send opens your phone’s messages (or email) with this filled in, and saves it here. Paste what the customer writes back with “Save their reply” so the whole team sees it.'))
        : el('p', { class: 'muted small' }, 'No phone or email for this customer.'));
  }

  // Inbox: replies waiting, leads to call (fastest first), follow-ups due, and the latest messages.
  function inboxView() {
    const box = el('div', { class: 'stack' }, el('p', { class: 'muted' }, 'Loading messages…'));
    const row = (j, text, flag) => el('button', { type: 'button', class: 'alert-row', onclick: () => openLead(j.id, 'overview') },
      el('b', {}, `${j.buyer.name} · ${jobNo(j)}`, flag ? el('span', { class: 'flag hot', style: 'margin-left:6px' }, flag) : null), el('span', { class: 'muted small' }, text));
    const callList = jobs.filter((j) => j.status === 'new' && !j.firstContactAt && !j.doNotContact).sort((a, b) => a.created - b.created);
    const replies = jobs.filter(needsReply).sort((a, b) => b.lastMessage.at - a.lastMessage.at);
    const follow = jobs.filter(needsFollowUp).sort((a, b) => lastTouch(a) - lastTouch(b));
    const card = (title, why, items) => el('section', { class: 'card stack' }, el('h3', {}, title), el('p', { class: 'muted small', style: 'margin:0' }, why),
      ...(items.length ? items : [el('p', { class: 'small good-text' }, '✓ Nothing waiting')]));
    api.jobs.recentMessages(80).then((msgs) => {
      const latest = []; const seen = new Set();
      msgs.forEach((m) => { if (!seen.has(m.jobId)) { seen.add(m.jobId); latest.push(m); } });
      box.replaceChildren(
        card('↩️ Customers waiting on a reply', 'Their last message came in and nobody has answered yet.', replies.map((j) => row(j, `“${j.lastMessage.body.slice(0, 80)}” · ${ago(j.lastMessage.at)}`, 'Reply'))),
        card('📞 Call list: new leads not contacted yet', 'Oldest first. The faster you call, the more you close.', callList.map((j) => row(j, `${tradeOf(j.trade).label} · ${srcLabel(j.source)} · waiting ${fmtDur(Date.now() - j.created)}`))),
        card('🔁 Follow up', 'Leads with no call, text or email in 2+ days.', follow.map((j) => row(j, `${statusOf(j.status).label} · last contact ${ago(lastTouch(j))}`))),
        el('section', { class: 'card stack' }, el('h3', {}, '💬 Latest messages'),
          ...(latest.length ? latest.slice(0, 30).map((m) => { const j = jobs.find((x) => x.id === m.jobId); return j ? row(j, `${m.dir === 'in' ? '⬅ ' : '➡ '}${m.channel === 'call' ? '📞 ' : ''}${m.body.slice(0, 90)} · ${ago(m.at)}`) : null; })
            : [el('p', { class: 'muted small' }, 'Texts, emails and calls you save on a job show up here.')])),
        el('p', { class: 'muted small' }, 'Texts and emails go out from your own phone for now. When a texting service (like Twilio) is connected, they’ll send and arrive here automatically.'));
    }).catch((e) => box.replaceChildren(el('p', { class: 'error' }, e.message)));
    return box;
  }

  // Reports (owner/office): pipeline, sales vs goal, lead sources, reps, speed to lead, profit, lost reasons, sales tax, 1099s.
  let reportYear = new Date().getFullYear();
  function reportsView() {
    const y = reportYear; const inYear = (ms) => ms && new Date(ms).getFullYear() === y;
    const pct = (a, b) => (b ? Math.round(a / b * 100) + '%' : '—');
    const MONTHS = Array.from({ length: 12 }, (_, i) => new Date(y, i, 1).toLocaleString(undefined, { month: 'short' }));
    const valueOf = (j) => jobTotal(j) || Number(j.price) || 0;
    const table = (head, rows, foot) => el('div', { class: 'report-scroll' }, el('table', { class: 'report-table' },
      el('thead', {}, el('tr', {}, ...head.map((h) => el('th', {}, h)))),
      el('tbody', {}, ...rows.map((r) => el('tr', {}, ...r.map((c) => el('td', {}, c ?? '—'))))),
      foot ? el('tfoot', {}, el('tr', {}, ...foot.map((c) => el('td', {}, c ?? '')))) : null));
    const section = (title, why, head, rows, foot, extra) => el('section', { class: 'card stack report' },
      el('div', { class: 'row' }, el('h3', { style: 'flex:1' }, title),
        el('button', { type: 'button', class: 'ghost small', onclick: () => TH.download(`top-hat-${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${y}.csv`, TH.csv([head, ...rows, ...(foot ? [foot] : [])])) }, '⬇ CSV')),
      why ? el('p', { class: 'muted small', style: 'margin:0' }, why) : null, extra || null, table(head, rows, foot));
    const leadsY = jobs.filter((j) => inYear(j.created));
    const won = (j) => WON.includes(j.status);
    const decided = (list) => list.filter((j) => won(j) || j.status === 'lost');

    // 1. Pipeline by stage (everything open, any year).
    const STG = [['new', 'New lead'], ['qualifying', 'Phone estimate'], ['hot', 'Hot lead'], ['scheduled', 'Scheduled'], ['in_progress', 'In progress']];
    const pipeRows = STG.map(([s, label]) => { const l = jobs.filter((j) => j.status === s); return [label, l.length, money(l.reduce((t, j) => t + valueOf(j), 0))]; });
    const pipeAll = jobs.filter((j) => OPEN.includes(j.status));

    // 2. Sales by month vs goal.
    const gMonth = monthlyGoal();
    const pays = paymentsOf();
    const monthRows = MONTHS.map((m, i) => {
      const sold = jobs.filter((j) => won(j) && inYear(soldAt(j)) && new Date(soldAt(j)).getMonth() === i);
      const coll = pays.filter((p) => p.date.slice(0, 4) === String(y) && Number(p.date.slice(5, 7)) === i + 1).reduce((t, p) => t + p.amount, 0);
      const rev = sold.reduce((t, j) => t + valueOf(j), 0);
      return [m, String(sold.length), money(rev), pct(rev, gMonth), money(coll)];
    });
    const soldY = jobs.filter((j) => won(j) && inYear(soldAt(j)));
    const revY = soldY.reduce((t, j) => t + valueOf(j), 0);

    // 3. Lead sources: leads, sold, close rate, money, spend and cost per lead/sale.
    const spendAll = settings.leadSpend || {}; const spendY = spendAll[y] || {};
    const srcIds = [...new Set([...TH.LEAD_SOURCES.map((x) => x.id), ...leadsY.map((j) => j.source || '')])];
    const srcRows = srcIds.map((id) => {
      const l = leadsY.filter((j) => (j.source || '') === id); const w = l.filter(won); const spend = Number(spendY[id]) || 0;
      if (!l.length && !spend) return null;
      const rev = w.reduce((t, j) => t + valueOf(j), 0);
      return [srcLabel(id), l.length, w.length, pct(w.length, decided(l).length), money(rev), spend ? money(spend) : '—', spend && l.length ? money(spend / l.length) : '—', spend && w.length ? money(spend / w.length) : '—', spend ? (rev / spend).toFixed(1) + '×' : '—'];
    }).filter(Boolean);
    const spendSaved = el('span', { class: 'saved-note', hidden: true }, 'Saved ✓');
    const spendForm = el('details', { class: 'spend-edit' }, el('summary', { class: 'small' }, `✏️ Enter what you spent on leads in ${y}`),
      el('div', { class: 'two', style: 'margin-top:8px' }, ...TH.LEAD_SOURCES.map((x) => el('label', { class: 'field' }, x.label,
        el('input', { type: 'number', min: '0', step: '1', inputmode: 'decimal', 'data-src': x.id, value: spendY[x.id] ?? '', placeholder: '$ this year' })))),
      el('div', { class: 'row' }, el('button', { type: 'button', onclick: async (e) => {
        const next = { ...spendY }; e.currentTarget.closest('details').querySelectorAll('input[data-src]').forEach((i) => { if (i.value === '') delete next[i.dataset.src]; else next[i.dataset.src] = Number(i.value) || 0; });
        settings = await api.settings.save({ leadSpend: { ...spendAll, [y]: next } }); render();
      } }, 'Save spend'), spendSaved));

    // 4. Sales reps.
    const reps = [...team.map((x) => [x.id, x.name]), [null, 'No salesperson (office)']];
    const repRows = reps.map(([id, name]) => {
      const l = leadsY.filter((j) => (j.salesId || null) === id); if (!l.length) return null;
      const w = l.filter(won); const sp = l.map(speedOf).filter((v) => v != null);
      return [name, l.length, w.length, pct(w.length, decided(l).length), money(w.reduce((t, j) => t + valueOf(j), 0)), sp.length ? fmtDur(sp.reduce((a, b) => a + b, 0) / sp.length) : '—'];
    }).filter(Boolean);

    // 5. Speed to lead.
    const sp = leadsY.map(speedOf).filter((v) => v != null).sort((a, b) => a - b);
    const notYet = leadsY.filter((j) => j.firstContactAt == null && LEAD_OPEN.includes(j.status)).length;
    const speedRows = [['Average time to first contact', sp.length ? fmtDur(sp.reduce((a, b) => a + b, 0) / sp.length) : '—'],
      ['Middle (median)', sp.length ? fmtDur(sp[Math.floor(sp.length / 2)]) : '—'],
      ['Contacted within 5 minutes', pct(sp.filter((v) => v <= 5 * 60e3).length, sp.length)],
      ['Contacted within 1 hour', pct(sp.filter((v) => v <= 60 * 60e3).length, sp.length)],
      ['Open leads never contacted', String(notYet)]];

    // 6. Profit by month and by type of work (finished jobs).
    const done = jobs.filter((j) => j.status === 'completed' && inYear(j.finishedAt || soldAt(j)));
    const extras = (j) => (j.crewBills || []).filter((b) => b.step == null && ['approved', 'paid'].includes(b.status)).reduce((s, b) => s + Number(b.amount), 0);
    const pl = (l) => { const rev = l.reduce((t, j) => t + valueOf(j), 0); const cost = l.reduce((t, j) => t + (Number(j.crewPay) || 0) + extras(j) + expensesOf(j.id), 0); return [l.length, money(rev), money(cost), money(rev - cost), pct(rev - cost, rev)]; };
    const plMonth = MONTHS.map((m, i) => [m, ...pl(done.filter((j) => new Date(j.finishedAt || soldAt(j)).getMonth() === i))]).filter((r) => r[1]);
    const plTrade = [...new Set(done.map((j) => j.trade))].map((t) => [tradeOf(t).label, ...pl(done.filter((j) => j.trade === t))]);

    // 7. Why leads didn't close.
    const lost = leadsY.filter((j) => j.status === 'lost');
    const lostRows = [...new Set(lost.map((j) => j.lostReason || 'No reason picked'))].map((r) => [r, lost.filter((j) => (j.lostReason || 'No reason picked') === r).length, pct(lost.filter((j) => (j.lostReason || 'No reason picked') === r).length, lost.length)]).sort((a, b) => b[1] - a[1]);

    // 8. Sales tax collected (the tax share of each payment on an invoice).
    const taxRows = MONTHS.map((m, i) => {
      let tax = 0, gross = 0;
      jobs.forEach((j) => liveInvoices(j).forEach((d) => { const t = docs.totals(d); (d.payments || []).forEach((p) => {
        const k = String(p.date || ''); if (k.slice(0, 4) !== String(y) || Number(k.slice(5, 7)) !== i + 1) return;
        gross += Number(p.amount) || 0; if (t.total) tax += (Number(p.amount) || 0) * t.tax / t.total; }); }));
      return [m, money(gross), '$' + tax.toFixed(2)];
    });

    // 9. Contractor payments for 1099s ($600 or more in the year).
    const paidTo = {};
    jobs.forEach((j) => {
      if (!j.contractorId) return;
      let billed = 0;
      (j.crewBills || []).filter((b) => b.status === 'paid' && String(b.paidDate || '').slice(0, 4) === String(y)).forEach((b) => { billed += Number(b.amount); paidTo[j.contractorId] = (paidTo[j.contractorId] || 0) + Number(b.amount); });
      if (j.crewPaid && String(j.crewPaid.date).slice(0, 4) === String(y)) { const rest = crewOwedTotal(j) - crewBillsOf(j, ['paid']).reduce((t, b) => t + Number(b.amount), 0); if (rest > 0) paidTo[j.contractorId] = (paidTo[j.contractorId] || 0) + rest; }
    });
    const tenRows = Object.entries(paidTo).sort((a, b) => b[1] - a[1]).map(([cid, amt]) => { const c = find(crew, cid) || {}; return [c.name || 'Unknown', c.phone || '', money(amt), amt >= 600 ? '✅ Needs a 1099' : 'Under $600']; });

    const years = [...new Set([new Date().getFullYear(), ...jobs.map((j) => new Date(j.created).getFullYear())])].sort((a, b) => b - a);
    return [
      el('div', { class: 'row' }, el('h2', { style: 'flex:1' }, '📊 Reports'),
        el('select', { class: 'inline-select', 'aria-label': 'Year', onchange: (e) => { reportYear = Number(e.target.value); render(); } }, ...years.map((yy) => el('option', { value: yy, selected: yy === y }, String(yy))))),
      section('Pipeline by stage', 'Every open job right now and what it’s worth (approved estimate, or the price you quoted).', ['Stage', 'Jobs', 'Value'], pipeRows,
        ['Total', pipeAll.length, money(pipeAll.reduce((t, j) => t + valueOf(j), 0))]),
      section(`Sales by month vs goal (${money(gMonth)} a month)`, 'Sold = scheduled, in progress or done, by start date. Collected = payments received that month.',
        ['Month', 'Jobs sold', 'Sold', 'Of the goal', 'Collected'], monthRows,
        ['Year', String(soldY.length), money(revY), pct(revY, gMonth * 12), money(pays.filter((p) => p.date.slice(0, 4) === String(y)).reduce((t, p) => t + p.amount, 0))]),
      section('Lead sources', 'Which sources bring leads that buy. Enter what you spend on each (Angi, ads…) to see the cost per lead and per sale.',
        ['Source', 'Leads', 'Sold', 'Close rate', 'Sold $', 'Spent', 'Per lead', 'Per sale', 'Return'], srcRows, null, spendForm),
      section('Sales reps', 'Leads that came in this year, by who owns them.', ['Rep', 'Leads', 'Sold', 'Close rate', 'Sold $', 'Speed to lead'], repRows),
      section('Speed to lead', 'Time from a lead coming in to the first call, text or email.', ['', ''], speedRows),
      section('Profit by month', 'Finished jobs. Cost = crew pay, approved extras and job expenses (materials, permits…).', ['Month', 'Jobs', 'Revenue', 'Cost', 'Profit', 'Margin'], plMonth),
      (() => { const oh = recs('expense', null).filter((x) => String(x.date).slice(0, 4) === String(y));
        const rows = MONTHS.map((m, i) => { const jobsP = done.filter((j) => new Date(j.finishedAt || soldAt(j)).getMonth() === i).reduce((t, j) => t + valueOf(j) - (Number(j.crewPay) || 0) - extras(j) - expensesOf(j.id), 0);
          const ov = oh.filter((x) => Number(String(x.date).slice(5, 7)) === i + 1).reduce((t, x) => t + (Number(x.amount) || 0), 0); return [m, money(jobsP), money(ov), money(jobsP - ov)]; });
        return section('Net profit by month (after overhead)', 'Profit on finished jobs minus overhead (rent, trucks, Angi fees… on the Office tab → Expenses & bills).', ['Month', 'Job profit', 'Overhead', 'Net profit'], rows); })(),
      section('Overhead by category', null, ['Category', 'Spent'], OVERHEAD_CATS.map((c) => [c, recs('expense', null).filter((x) => x.category === c && String(x.date).slice(0, 4) === String(y)).reduce((t, x) => t + (Number(x.amount) || 0), 0)]).filter((r) => r[1]).map((r) => [r[0], money(r[1])])),
      section('Profit by type of work', null, ['Work', 'Jobs', 'Revenue', 'Cost', 'Profit', 'Margin'], plTrade),
      section('Why leads didn’t close', 'Pick a reason when you close a lead as “Not a fit”.', ['Reason', 'Leads', 'Share'], lostRows),
      section('Sales tax collected', 'The tax part of each invoice payment received.', ['Month', 'Payments', 'Sales tax'], taxRows),
      section('Contractor payments (1099)', 'Paid to each contractor this year. $600 or more needs a 1099-NEC by January 31.', ['Contractor', 'Phone', 'Paid', '1099'], tenRows),
    ];
  }

  /* ---------- Office tab (office only): reports + the company's own records (office checklist 3, 4, 5, 7, 8, 9, 10, 11) ---------- */
  let officePart = 'reports';
  const OFFICE_PARTS = [['reports', '📊 Reports'], ['bills', '💸 Expenses & bills'], ['pricebook', '📗 Price book'], ['commission', '💼 Commission'], ['vendors', '🏪 Suppliers'],
    ['staff', '👥 Office staff'], ['compliance', '📜 Licenses & insurance'], ['tickets', '🛠 Tickets'], ['sops', '📘 How-to'], ['assets', '🚚 Equipment']];
  const dueSoon = (k, days) => k && k <= dayKey(Date.now() + days * 864e5);
  const isPast = (k) => k && k < dayKey(Date.now());
  // Bills to pay: any expense with a due date that isn't paid yet (supplier bills, overhead).
  const billsDue = () => recs('expense').filter((x) => x.dueDate && !x.paidDate).sort((a, b) => String(a.dueDate).localeCompare(b.dueDate));
  // Company paperwork / equipment dates coming up within 30 days (or already passed).
  const officeAlerts = () => [
    ...recs('company_doc').filter((x) => x.expires && dueSoon(x.expires, 30)).map((x) => ({ icon: isPast(x.expires) ? '⛔' : '📜', title: `${x.name}${x.number ? ' #' + x.number : ''}`, text: `${isPast(x.expires) ? 'ran out' : 'runs out'} ${docs.fmtDate(x.expires)}`, part: 'compliance' })),
    ...recs('asset').filter((x) => x.dueDate && dueSoon(x.dueDate, 30)).map((x) => ({ icon: '🚚', title: x.name, text: `${x.dueWhat || 'renewal'} ${isPast(x.dueDate) ? 'was due' : 'due'} ${docs.fmtDate(x.dueDate)}`, part: 'assets' })),
    ...billsDue().filter((x) => dueSoon(x.dueDate, 7)).map((x) => ({ icon: '💸', title: `${x.vendor || x.category} · ${money(Number(x.amount) || 0)}`, text: `bill ${isPast(x.dueDate) ? 'overdue since' : 'due'} ${docs.fmtDate(x.dueDate)}`, part: 'bills' })),
    ...(recs('ticket').filter((x) => x.status !== 'closed').length ? [{ icon: '🛠', title: `${recs('ticket').filter((x) => x.status !== 'closed').length} open ticket(s)`, text: 'complaints, warranty or callbacks waiting', part: 'tickets' }] : []),
  ];

  // A simple list + form for one kind of office record. fields: [{ k, label, type, options, hint, full }]
  function recordSection(kind, cfg) {
    const errBox = el('div', { class: 'error', hidden: true, role: 'alert' });
    const holder = el('div');
    const list = (cfg.list ? cfg.list() : recs(kind)).slice().sort(cfg.sort || ((a, b) => String(a.name || a.title || '').localeCompare(String(b.name || b.title || ''))));
    const form = (rec) => {
      const inputs = {};
      const f = el('form', { class: 'card stack record-form', onsubmit: async (e) => {
        e.preventDefault();
        const out = { ...(rec || {}) };
        for (const fd of cfg.fields) {
          const i = inputs[fd.k];
          out[fd.k] = fd.type === 'check' ? i.checked : fd.type === 'number' ? (i.value === '' ? null : Number(i.value)) : String(i.value || '').trim();
        }
        const missing = cfg.fields.find((fd) => fd.required && !out[fd.k] && out[fd.k] !== 0);
        if (missing) { errBox.textContent = `Fill in “${missing.label}”.`; errBox.hidden = false; return; }
        try { await api.records.save(kind, cfg.beforeSave ? cfg.beforeSave(out) : out, cfg.jobOf ? cfg.jobOf(out) : (rec && rec.jobId) || null); await load(); render(); }
        catch (err) { errBox.textContent = err.message; errBox.hidden = false; }
      } },
        el('div', { class: 'row' }, el('h3', { style: 'flex:1' }, rec ? `Edit ${cfg.noun}` : `New ${cfg.noun}`), el('button', { type: 'button', class: 'link small', onclick: () => holder.replaceChildren() }, 'Close')),
        errBox,
        el('div', { class: 'record-grid' }, ...cfg.fields.map((fd) => {
          const v = rec ? rec[fd.k] : fd.default;
          const input = fd.type === 'select' ? el('select', { name: fd.k }, ...(typeof fd.options === 'function' ? fd.options() : fd.options).map((o) => { const [val, lab] = Array.isArray(o) ? o : [o, o]; return el('option', { value: val, selected: String(val) === String(v ?? '') }, lab); }))
            : fd.type === 'textarea' ? el('textarea', { name: fd.k, rows: fd.rows || 4, value: v ?? '', maxlength: '20000' })
            : fd.type === 'check' ? el('input', { type: 'checkbox', name: fd.k, checked: rec && rec[fd.k] != null ? !!rec[fd.k] : !!fd.default })
            : el('input', { name: fd.k, type: fd.type || 'text', value: v ?? '', ...(fd.type === 'number' ? { inputmode: 'decimal', step: 'any', min: '0' } : {}), ...(fd.list ? { list: fd.list } : {}), placeholder: fd.placeholder || '' });
          inputs[fd.k] = input;
          return fd.type === 'check' ? el('label', { class: 'dnc-row small' + (fd.full ? ' full' : '') }, input, el('span', {}, fd.label))
            : el('label', { class: 'field' + (fd.full || fd.type === 'textarea' ? ' full' : '') }, fd.label, fd.hint ? el('span', { class: 'hint' }, fd.hint) : null, input);
        })),
        el('datalist', { id: 'vendorNames' }, ...recs('vendor').map((v) => el('option', { value: v.name }))),
        el('div', { class: 'row', style: 'gap:8px' }, el('button', { type: 'submit', style: 'flex:1' }, 'Save'),
          rec ? el('button', { type: 'button', class: 'ghost', style: 'color:var(--bad)', onclick: async () => { if (!confirm(`Delete this ${cfg.noun}?`)) return; await api.records.remove(rec.id); await load(); render(); } }, 'Delete') : null));
      holder.replaceChildren(f); f.scrollIntoView({ block: 'start', behavior: 'smooth' });
    };
    return el('section', { class: 'card stack' },
      el('div', { class: 'row' }, el('h3', { style: 'flex:1' }, cfg.title), el('button', { type: 'button', class: 'gold small', onclick: () => form(null) }, `+ ${cfg.addLabel || 'Add'}`)),
      cfg.intro ? el('p', { class: 'muted small', style: 'margin:0' }, cfg.intro) : null,
      cfg.top || null,
      holder,
      ...(list.length ? list.map((r) => { const [t1, t2, flag] = cfg.line(r); return el('button', { type: 'button', class: 'alert-row', onclick: () => form(r) },
        el('b', {}, t1, flag ? el('span', { class: 'flag' + (/⛔|overdue|ran out/i.test(flag) ? ' hot' : ''), style: 'margin-left:6px' }, flag) : null), t2 ? el('span', { class: 'muted small' }, t2) : null); })
        : [el('p', { class: 'muted small' }, cfg.empty || 'Nothing here yet.')]),
      cfg.csv && list.length ? el('button', { type: 'button', class: 'ghost small', style: 'align-self:flex-start', onclick: () => TH.download(`top-hat-${kind}-${docs.todayKey()}.csv`, TH.csv([cfg.fields.map((fd) => fd.label), ...list.map((r) => cfg.fields.map((fd) => r[fd.k] ?? ''))])) }, '⬇ CSV') : null);
  }

  // Commission (CRM 11.4 · office 4.1–4.2): a rule per rep, earned on finished jobs, and what's been paid.
  function commissionView() {
    const y = reportYear;
    const ruleOf = (sid) => recs('commission_rule').find((r) => r.salesId === sid);
    const profitOf = (j) => jobTotal(j) - crewOwedTotal(j) - expensesOf(j.id);
    const earnedOn = (j, rule) => Math.round((rule.basis === 'profit' ? Math.max(0, profitOf(j)) : jobTotal(j)) * (Number(rule.pct) || 0)) / 100;
    const paidOn = (sid, jid) => recs('commission_paid').filter((p) => p.salesId === sid && p.jobId === jid).reduce((t, p) => t + (Number(p.amount) || 0), 0);
    return [
      el('p', { class: 'muted small' }, 'Office only. Set each rep’s rate, then pay commission on finished jobs. Reps don’t see this.'),
      ...team.map((x) => {
        const rule = ruleOf(x.id) || { salesId: x.id, pct: '', basis: 'sale' };
        const pctIn = el('input', { type: 'number', min: '0', max: '100', step: '0.5', inputmode: 'decimal', value: rule.pct ?? '', 'aria-label': `${x.name} commission percent`, style: 'width:90px' });
        const basisSel = el('select', { 'aria-label': `${x.name} commission basis` }, el('option', { value: 'sale', selected: rule.basis !== 'profit' }, '% of the sale'), el('option', { value: 'profit', selected: rule.basis === 'profit' }, '% of the profit'));
        const done = jobs.filter((j) => j.salesId === x.id && j.status === 'completed' && new Date(j.finishedAt || soldAt(j)).getFullYear() === y);
        const rows = rule.pct ? done.map((j) => { const earned = earnedOn(j, rule); const paid = paidOn(x.id, j.id); return { j, earned, paid }; }) : [];
        const owed = rows.reduce((t, r) => t + Math.max(0, r.earned - r.paid), 0);
        return el('section', { class: 'card stack' },
          el('div', { class: 'row' }, el('h3', { style: 'flex:1' }, `💼 ${x.name}`), rule.pct ? el('b', {}, `${money(owed)} owed`) : null),
          el('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;align-items:center' }, pctIn, el('span', {}, '%'), basisSel,
            el('button', { type: 'button', class: 'ghost small', onclick: async () => { await api.records.save('commission_rule', { ...rule, salesId: x.id, pct: Number(pctIn.value) || 0, basis: basisSel.value }); await load(); render(); } }, 'Save rate')),
          rule.pct ? el('div', { class: 'report-scroll' }, el('table', { class: 'report-table' },
            el('thead', {}, el('tr', {}, ...['Job', 'Customer', rule.basis === 'profit' ? 'Profit' : 'Sale', 'Earned', 'Paid', ''].map((h) => el('th', {}, h)))),
            el('tbody', {}, ...rows.map((r) => el('tr', {}, el('td', {}, jobNo(r.j)), el('td', {}, r.j.buyer.name), el('td', {}, money(rule.basis === 'profit' ? profitOf(r.j) : jobTotal(r.j))),
              el('td', {}, money(r.earned)), el('td', {}, money(r.paid)),
              el('td', {}, r.earned - r.paid > 0.005 ? el('button', { type: 'button', class: 'ghost small', onclick: async () => {
                await api.records.save('commission_paid', { salesId: x.id, jobId: r.j.id, amount: Math.round((r.earned - r.paid) * 100) / 100, date: docs.todayKey() }, r.j.id); await load(); render(); } }, 'Mark paid') : '✓')))),
            el('tfoot', {}, el('tr', {}, el('td', {}, 'Total'), el('td', {}, `${rows.length} jobs`), el('td', {}, ''), el('td', {}, money(rows.reduce((t, r) => t + r.earned, 0))), el('td', {}, money(rows.reduce((t, r) => t + r.paid, 0))), el('td', {}, ''))))) : el('p', { class: 'muted small' }, 'No rate set yet.'),
          rule.pct && rows.length ? el('button', { type: 'button', class: 'ghost small', style: 'align-self:flex-start', onclick: () => TH.download(`commission-${x.name.replace(/\W+/g, '-').toLowerCase()}-${y}.csv`,
            TH.csv([['Job', 'Customer', 'Finished', rule.basis === 'profit' ? 'Profit' : 'Sale', 'Rate %', 'Earned', 'Paid', 'Owed'],
              ...rows.map((r) => [jobNo(r.j), r.j.buyer.name, r.j.finishedAt ? dayKey(r.j.finishedAt) : '', rule.basis === 'profit' ? profitOf(r.j) : jobTotal(r.j), rule.pct, r.earned, r.paid, Math.max(0, r.earned - r.paid)])])) }, '⬇ Commission statement (CSV)') : null);
      }),
      team.length ? null : el('p', { class: 'muted' }, 'Add salespeople on the Team tab first.'),
    ];
  }

  // The ballpark price customers see at the end of sign-up: your ranges for each kind of job and finish level.
  function ballparkEditor() {
    const table = TH.ballparkTable(settings);
    const saved = el('span', { class: 'saved-note', hidden: true }, 'Saved ✓');
    const on = el('input', { type: 'checkbox', checked: settings.ballparkOn !== false, 'aria-label': 'Show ballpark prices at sign-up' });
    const num = (k, f, i, v) => el('input', { type: 'number', min: '0', step: f === 'size' ? '10' : '500', inputmode: 'numeric', value: v, 'data-k': k, 'data-f': f, 'data-i': i ?? '', 'aria-label': `${table[k].label} ${f}${i != null ? (i ? ' high' : ' low') : ''}` });
    const rows = Object.entries(table).map(([k, r]) => el('details', { class: 'bp-edit' },
      el('summary', {}, el('b', {}, r.label), el('span', { class: 'muted small' }, ` · ${money(r.mid[0])}–${money(r.mid[1])} mid-grade${r.size ? ` · ${r.size} sq ft typical` : ''}`)),
      el('div', { class: 'bp-grid' },
        el('span', { class: 'small' }, 'Typical size (sq ft)'), num(k, 'size', null, r.size), el('span'),
        ...[['budget', 'Budget'], ['mid', 'Mid-grade'], ['premium', 'Premium']].flatMap(([f, l]) => [el('span', { class: 'small' }, `${l} $`), num(k, f, 0, r[f][0]), num(k, f, 1, r[f][1])]))));
    const box = el('section', { class: 'card stack' },
      el('div', { class: 'row' }, el('h3', { style: 'flex:1' }, '💵 Ballpark prices at sign-up'), saved),
      el('p', { class: 'muted small', style: 'margin:0' }, 'At the end of sign-up the customer sees a price range for Budget, Mid-grade and Premium, with the level they picked highlighted. The range grows or shrinks with the size they enter, compared with the typical size. Set your own numbers; the office sees what each customer was shown on their job.'),
      el('label', { class: 'dnc-row small' }, on, el('span', {}, 'Show customers a ballpark price at the end of sign-up')),
      ...rows,
      el('button', { type: 'button', onclick: async () => {
        const out = {};
        box.querySelectorAll('input[data-k]').forEach((i) => { const k = i.dataset.k, f = i.dataset.f; out[k] ||= {}; const v = Math.max(0, Number(i.value) || 0);
          if (f === 'size') out[k].size = v; else { out[k][f] ||= [0, 0]; out[k][f][Number(i.dataset.i)] = v; } });
        for (const r of Object.values(out)) for (const f of ['budget', 'mid', 'premium']) if (r[f] && r[f][1] < r[f][0]) r[f] = [r[f][1], r[f][0]];
        settings = await api.settings.save({ ballpark: out, ballparkOn: on.checked }); saved.hidden = false; setTimeout(() => { saved.hidden = true; }, 1600);
      } }, 'Save ballpark prices'));
    return box;
  }

  function officeView() {
    const switcher = el('div', { class: 'office-switch', role: 'group', 'aria-label': 'Office sections' }, ...OFFICE_PARTS.map(([id, label]) =>
      el('button', { type: 'button', class: 'chip', 'aria-pressed': String(officePart === id), onclick: () => { officePart = id; render(); } }, label)));
    const yes = (v) => (v ? 'Yes' : 'No');
    const parts = {
      reports: () => reportsView(),
      commission: () => commissionView(),
      bills: () => {
        const bills = billsDue();
        const overhead = recs('expense', null);
        return [
          el('section', { class: 'card stack' }, el('h3', {}, `💸 Bills to pay (${bills.length})`),
            el('p', { class: 'muted small', style: 'margin:0' }, 'Supplier and other bills with a due date that aren’t paid yet. Contractor bills are on each job and on Today.'),
            ...(bills.length ? bills.map((x) => { const jb = x.jobId && jobs.find((q) => q.id === x.jobId); return el('div', { class: 'task-row' },
              el('span', { style: 'flex:1' }, el('b', {}, `${money(Number(x.amount) || 0)} · ${x.vendor || x.category}`),
                el('span', { class: 'small ' + (isPast(x.dueDate) ? 'bad-text' : 'muted'), style: 'display:block' }, `${isPast(x.dueDate) ? 'Overdue since' : 'Due'} ${docs.fmtDate(x.dueDate)}${jb ? ' · ' + jobNo(jb) : ' · overhead'}${x.invoiceNo ? ' · bill #' + x.invoiceNo : ''}`)),
              el('button', { type: 'button', class: 'ghost small', onclick: async () => { await api.records.save('expense', { ...x, paidDate: docs.todayKey() }, x.jobId); await load(); render(); } }, 'Mark paid')); })
              : [el('p', { class: 'small good-text' }, '✓ No bills waiting')])),
          recordSection('expense', { title: '🏢 Overhead & company expenses', noun: 'expense', addLabel: 'Add expense', csv: true,
            intro: 'Costs that aren’t for one job: rent, trucks, insurance, Angi fees, ads, software, office payroll. Job costs go on the job (Payments tab). Add a due date to track it as a bill to pay.',
            list: () => overhead, sort: (a, b) => String(b.date).localeCompare(String(a.date)),
            fields: [{ k: 'amount', label: 'Amount ($)', type: 'number', required: true }, { k: 'category', label: 'Category', type: 'select', options: OVERHEAD_CATS },
              { k: 'vendor', label: 'Paid to', list: 'vendorNames', placeholder: 'e.g. Angi' }, { k: 'date', label: 'Date', type: 'date', default: docs.todayKey() },
              { k: 'dueDate', label: 'Due date (if it’s a bill)', type: 'date' }, { k: 'paidDate', label: 'Paid on', type: 'date' },
              { k: 'invoiceNo', label: 'Bill / invoice #' }, { k: 'recurring', label: 'Every month', type: 'check', default: false }, { k: 'note', label: 'Note', full: true }],
            line: (x) => [`${money(Number(x.amount) || 0)} · ${x.category}`, [docs.fmtDate(x.date), x.vendor, x.recurring ? 'monthly' : '', x.note].filter(Boolean).join(' · '), x.dueDate && !x.paidDate ? (isPast(x.dueDate) ? 'overdue' : 'to pay') : ''] }),
        ];
      },
      pricebook: () => [ballparkEditor(),
        recordSection('price_item', { title: '📗 Price book', noun: 'price book item', addLabel: 'Add item', csv: true,
          intro: 'Your standard items with your cost and your price. Add them to any estimate in one tap (📗 Price book in the estimate). Costs are office only.',
          fields: [{ k: 'name', label: 'Item', required: true, full: true, placeholder: 'e.g. Base cabinet install' }, { k: 'trade', label: 'Type of work', type: 'select', options: () => TRADES.map((t) => [t.id, t.label]) },
            { k: 'unit', label: 'Unit', placeholder: 'each, sq ft, linear ft, hour' }, { k: 'cost', label: 'Your cost ($)', type: 'number' }, { k: 'price', label: 'Customer price ($)', type: 'number', required: true },
            { k: 'category', label: 'Group', placeholder: 'e.g. Cabinets, Tile, Labor' }, { k: 'supplier', label: 'Supplier', list: 'vendorNames' }],
          line: (x) => [x.name, `${money(Number(x.price) || 0)}${x.unit ? ' / ' + x.unit : ''} · cost ${money(Number(x.cost) || 0)}${Number(x.price) ? ` · ${Math.round((Number(x.price) - (Number(x.cost) || 0)) / Number(x.price) * 100)}% margin` : ''} · ${tradeOf(x.trade).label}${x.supplier ? ' · ' + x.supplier : ''}`] }),
        recordSection('est_template', { title: '📋 Estimate templates (Good · Better · Best)', noun: 'template', addLabel: 'Add template',
          intro: 'Ready-made estimates, e.g. Kitchen Good / Better / Best. Write one line per row as: description | qty | price | your cost. Start any estimate from one (📋 Template).',
          beforeSave: (x) => ({ ...x, items: String(x.lines || '').split('\n').map((l) => l.split('|').map((p) => p.trim())).filter((p) => p[0]).map(([desc, qty, price, cost]) => ({ desc, qty: Number(qty) || 1, price: Number(String(price || '').replace(/[$,]/g, '')) || 0, cost: Number(String(cost || '').replace(/[$,]/g, '')) || 0 })) }),
          fields: [{ k: 'name', label: 'Name', required: true, placeholder: 'e.g. Kitchen remodel' }, { k: 'trade', label: 'Type of work', type: 'select', options: () => TRADES.map((t) => [t.id, t.label]) },
            { k: 'tier', label: 'Level', type: 'select', options: [['good', 'Good'], ['better', 'Better'], ['best', 'Best'], ['', 'One option']] },
            { k: 'lines', label: 'Lines', type: 'textarea', rows: 6, hint: 'description | qty | price | your cost', placeholder: 'Demo & haul-away | 1 | 1800 | 900\nStock cabinets | 1 | 8500 | 6200' },
            { k: 'scope', label: 'Scope of work', type: 'textarea', rows: 4 }],
          line: (x) => [`${x.tier ? ({ good: '🥉 Good', better: '🥈 Better', best: '🥇 Best' }[x.tier]) + ' · ' : ''}${x.name}`, `${tradeOf(x.trade).label} · ${(x.items || []).length} lines · ${money((x.items || []).reduce((t, i) => t + i.qty * i.price, 0))}`] }),
      ],
      vendors: () => recordSection('vendor', { title: '🏪 Suppliers & vendors', noun: 'supplier', addLabel: 'Add supplier', csv: true,
        intro: 'Who you buy from: account numbers, your rep, and payment terms. Bills you owe them show under Expenses & bills.',
        fields: [{ k: 'name', label: 'Company', required: true }, { k: 'what', label: 'What they supply', placeholder: 'e.g. Lumber, cabinets, tile' },
          { k: 'rep', label: 'Your rep' }, { k: 'phone', label: 'Phone', type: 'tel' }, { k: 'email', label: 'Email', type: 'email' }, { k: 'account', label: 'Account #' },
          { k: 'terms', label: 'Payment terms', placeholder: 'e.g. Net 30, 2% 10' }, { k: 'website', label: 'Website / ordering link' }, { k: 'notes', label: 'Notes', type: 'textarea', rows: 3 }],
        line: (x) => { const owe = billsDue().filter((b) => b.vendor === x.name).reduce((t, b) => t + (Number(b.amount) || 0), 0);
          return [x.name, [x.what, x.rep, x.phone, x.account ? 'acct ' + x.account : '', x.terms].filter(Boolean).join(' · '), owe ? `${money(owe)} to pay` : '']; } }),
      staff: () => recordSection('staff', { title: '👥 Office staff & employees', noun: 'person', addLabel: 'Add person', csv: true,
        intro: 'Everyone who works for Top Hat besides sales reps and contractors (they’re on the Team tab). Don’t store Social Security numbers here: keep W-4 and I-9 forms with your payroll company.',
        sort: (a, b) => (b.active !== false) - (a.active !== false) || String(a.name).localeCompare(b.name),
        fields: [{ k: 'name', label: 'Name', required: true }, { k: 'title', label: 'Job title', placeholder: 'e.g. Office manager' }, { k: 'phone', label: 'Phone', type: 'tel' }, { k: 'email', label: 'Email', type: 'email' },
          { k: 'start', label: 'Start date', type: 'date' }, { k: 'pay', label: 'Pay', type: 'select', options: ['Hourly', 'Salary', 'Owner', 'Contract'] }, { k: 'rate', label: 'Rate ($)', type: 'number' },
          { k: 'emergency', label: 'Emergency contact' }, { k: 'onboarding', label: 'Onboarding checklist', type: 'textarea', rows: 4, default: '[ ] W-4 and I-9 sent to payroll\n[ ] App login\n[ ] Keys / truck\n[ ] Safety training\n[ ] Read the How-to library' },
          { k: 'active', label: 'Works here now', type: 'check', default: true }, { k: 'notes', label: 'Notes', type: 'textarea', rows: 3 }],
        line: (x) => [x.name, [x.title, x.phone, x.start ? 'since ' + docs.fmtDate(x.start) : '', x.pay].filter(Boolean).join(' · '), x.active === false ? 'former' : ''] }),
      compliance: () => recordSection('company_doc', { title: '📜 Licenses, insurance & certifications', noun: 'license or policy', addLabel: 'Add', csv: true,
        intro: 'Top Hat’s own contractor licenses, general liability, workers comp, bonds and certifications (like EPA lead-safe). You get a warning on Today 30 days before one runs out. Contractor insurance is on each contractor.',
        sort: (a, b) => String(a.expires || '9999').localeCompare(String(b.expires || '9999')),
        fields: [{ k: 'type', label: 'Type', type: 'select', options: ['Contractor license', 'General liability insurance', 'Workers comp insurance', 'Commercial auto insurance', 'Surety bond', 'EPA lead-safe (RRP) certification', 'Business registration', 'Other'] },
          { k: 'name', label: 'Name', required: true, placeholder: 'e.g. Illinois roofing license' }, { k: 'number', label: 'Number / policy #' }, { k: 'state', label: 'State / city' },
          { k: 'company', label: 'Issued by / insurer' }, { k: 'amount', label: 'Coverage ($)', type: 'number' }, { k: 'expires', label: 'Runs out', type: 'date' }, { k: 'notes', label: 'Notes', type: 'textarea', rows: 2 }],
        line: (x) => [x.name, [x.type, x.number ? '#' + x.number : '', x.state, x.expires ? 'runs out ' + docs.fmtDate(x.expires) : ''].filter(Boolean).join(' · '), x.expires && isPast(x.expires) ? '⛔ ran out' : x.expires && dueSoon(x.expires, 30) ? 'renew soon' : ''] }),
      tickets: () => recordSection('ticket', { title: '🛠 Complaints, warranty & callbacks', noun: 'ticket', addLabel: 'New ticket', csv: true,
        intro: 'When a customer calls with a problem after or during a job. Track it until it’s fixed, and what the callback cost you.',
        jobOf: (x) => x.jobId || null,
        sort: (a, b) => (a.status === 'closed') - (b.status === 'closed') || b.at - a.at,
        fields: [{ k: 'jobId', label: 'Job', type: 'select', options: () => [['', '— Pick the job —'], ...jobs.filter((q) => q.status !== 'lost').sort((a, b) => b.created - a.created).map((q) => [q.id, `${jobNo(q)} · ${q.buyer.name}`])] },
          { k: 'type', label: 'Type', type: 'select', options: ['Complaint', 'Warranty claim', 'Callback / rework', 'Question'] }, { k: 'status', label: 'Status', type: 'select', options: [['open', 'Open'], ['scheduled', 'Fix scheduled'], ['closed', 'Fixed / closed']] },
          { k: 'what', label: 'What’s wrong', type: 'textarea', rows: 3, required: true }, { k: 'fixDate', label: 'Fix date', type: 'date' }, { k: 'cost', label: 'Cost to fix ($)', type: 'number' }, { k: 'notes', label: 'Notes', type: 'textarea', rows: 2 }],
        line: (x) => { const q = jobs.find((y) => y.id === x.jobId); return [`${x.type}${q ? ` · ${q.buyer.name} · ${jobNo(q)}` : ''}`, `${String(x.what || '').slice(0, 90)}${x.cost ? ' · cost ' + money(x.cost) : ''}`, x.status === 'closed' ? '' : x.status === 'scheduled' ? 'scheduled' : 'open']; } }),
      sops: () => recordSection('sop', { title: '📘 How-to library', noun: 'guide', addLabel: 'Add guide',
        intro: 'How Top Hat does things: step-by-step guides, the sales script and answers to objections, what the AI phone agent should say, and your company info sheet.',
        sort: (a, b) => String(a.category).localeCompare(b.category) || String(a.title).localeCompare(b.title),
        fields: [{ k: 'title', label: 'Title', required: true, full: true }, { k: 'category', label: 'Kind', type: 'select', options: ['How we do it (SOP)', 'Sales script', 'Objections & answers', 'AI phone agent', 'Company info', 'Training'] },
          { k: 'body', label: 'Guide', type: 'textarea', rows: 10 }],
        line: (x) => [x.title, `${x.category} · updated ${ago(x.updatedAt || x.at)}`] }),
      assets: () => recordSection('asset', { title: '🚚 Trucks, tools & subscriptions', noun: 'item', addLabel: 'Add item', csv: true,
        intro: 'Company vehicles, tools and equipment, and software you pay for. Put the next registration, service or renewal date to get a reminder.',
        sort: (a, b) => String(a.type).localeCompare(b.type) || String(a.name).localeCompare(b.name),
        fields: [{ k: 'type', label: 'Kind', type: 'select', options: ['Vehicle', 'Tool / equipment', 'Software subscription'] }, { k: 'name', label: 'Name', required: true, placeholder: 'e.g. 2019 F-250, Dewalt saw, QuickBooks' },
          { k: 'detail', label: 'Plate / serial / login email' }, { k: 'who', label: 'Who has it' }, { k: 'cost', label: 'Cost ($)', type: 'number' }, { k: 'monthly', label: 'Monthly cost ($)', type: 'number' },
          { k: 'dueDate', label: 'Next date', type: 'date' }, { k: 'dueWhat', label: 'What’s due', placeholder: 'registration, oil change, renewal' }, { k: 'notes', label: 'Notes', type: 'textarea', rows: 2 }],
        line: (x) => [x.name, [x.type, x.detail, x.who, x.monthly ? money(x.monthly) + '/mo' : '', x.dueDate ? `${x.dueWhat || 'next'} ${docs.fmtDate(x.dueDate)}` : ''].filter(Boolean).join(' · '), x.dueDate && dueSoon(x.dueDate, 30) ? (isPast(x.dueDate) ? 'overdue' : 'due soon') : ''] }),
    };
    return [switcher, ...[].concat((parts[officePart] || parts.reports)())];
  }

  // Today's to-do list (office and sales): everything waiting, in the order to do it.
  const TODO_ORDER = [
    ['declined', 'Find another contractor or date for'], ['replies', 'Reply to'], ['new', 'Call new lead'], ['reported', 'Confirm the payment from'],
    ['visits', 'Visit with'], ['soon', 'On the schedule:'], ['hotbook', 'Book the visit for'], ['schedule', 'Schedule the contractor for'],
    ['crewbills', 'Approve the contractor bill on'], ['paycrew', 'Pay the contractor for'], ['invoice', 'Send the next invoice to'], ['crewpay', 'Set contractor pay for'],
    ['notes', 'Read the crew update on'], ['permits', 'Apply for the permit for'], ['materials', 'Order materials for'], ['followup', 'Follow up with'],
    ['waiting', 'Check on the estimate with'], ['unpaid', 'Collect payment from'], ['reviews', 'Ask for a review from'],
  ];
  function todayTodo() {
    const today = dayKey(Date.now());
    const bs = Object.fromEntries(myBuckets().map((b) => [b.id, b]));
    const items = [];
    for (const [id, verb] of TODO_ORDER) {
      const b = bs[id]; if (!b) continue;
      let list = b.list;
      // Appointments: only today's go on today's list, earliest first.
      if (id === 'visits') list = list.filter((j) => (j.visitAt || '').slice(0, 10) === today).sort((a, c) => a.visitAt.localeCompare(c.visitAt));
      if (id === 'soon') list = list.filter((j) => (j.scheduledFor || '').slice(0, 10) === today);
      if (id === 'unpaid') list = list.filter((j) => liveInvoices(j).some((d) => docs.owed(d) > 0 && d.dueDate && d.dueDate < today)); // only overdue
      for (const j of list) items.push({ key: `${id}:${j.id}`, icon: b.icon, text: `${verb} ${j.buyer.name}`, sub: `${jobNo(j)} · ${b.line(j)}`, open: () => openLead(j.id, 'overview'),
        action: ['new', 'replies', 'followup'].includes(id) && j.buyer.phone && !j.doNotContact ? { label: '📞 Call', href: telHref(j.buyer.phone) } : null });
    }
    if (isStaff) {
      jobs.filter(needsFollowUp).filter((j) => !items.some((x) => x.key.endsWith(':' + j.id) && x.key.startsWith('followup')))
        .forEach((j) => items.push({ key: `touch:${j.id}`, icon: '🔁', text: `Follow up with ${j.buyer.name}`, sub: `${jobNo(j)} · no contact in ${Math.floor((Date.now() - lastTouch(j)) / 864e5)} days`, open: () => openLead(j.id, 'overview'),
          action: j.buyer.phone && !j.doNotContact ? { label: '📞 Call', href: telHref(j.buyer.phone) } : null }));
      stalledJobs().forEach((j) => items.push({ key: `stalled:${j.id}`, icon: '🐢', text: `Check on ${j.buyer.name}’s job`, sub: `${jobNo(j)} · no update in ${Math.floor((Date.now() - (j.progressAt || j.created)) / 864e5)} days`, open: () => openLead(j.id, 'overview') }));
      officeAlerts().forEach((x, i) => items.push({ key: `office:${x.part}:${x.title}`, icon: x.icon, text: x.title, sub: x.text, open: () => { tab = 'reports'; officePart = x.part; history.replaceState(null, '', '#reports'); render(); } }));
      insuranceIssues().filter((x) => x.kind !== 'none').forEach((x) => items.push({ key: `crew:${x.kind}:${x.c.id}`, icon: '🛡', text: `${x.c.name}: ${x.text}`, sub: 'Ask them to update it in their contractor login', open: () => { tab = 'team'; teamPart = 'crew'; render(); } }));
    }
    return TH.todoCard({ who: meUser.id, items });
  }

  // Today blocks that need action fast get the red header (owner: titles have to grab attention).
  const URGENT_BUCKETS = ['new', 'replies', 'declined', 'reported', 'crewbills', 'hotbook'];
  function todayView() {
    const bs = myBuckets();
    const today = dayKey(Date.now()), weekEnd = dayKey(Date.now() + 7 * 86400e3);
    const thisWeek = jobs.filter((j) => ['scheduled', 'in_progress'].includes(j.status) && j.scheduledFor && j.scheduledFor.slice(0, 10) >= today && j.scheduledFor.slice(0, 10) <= weekEnd).length;
    const kpi = (v, k) => el('div', { class: 'kpi' }, el('b', {}, String(v)), el('span', {}, k));
    const h = new Date().getHours();
    const sections = bs.filter((b) => b.list.length).map((b) => el('section', { class: 'card todo' + (b.info ? ' info' : URGENT_BUCKETS.includes(b.id) ? ' urgent' : ''), 'data-bucket': b.id },
      el('div', { class: 'todo-head' },
        el('span', { class: 'todo-ic' }, b.icon),
        el('div', { style: 'flex:1;min-width:0' }, el('h3', {}, b.title), el('p', { class: 'muted small' }, b.why)),
        el('span', { class: 'todo-count' }, String(b.list.length))),
      el('div', { class: 'todo-list' }, ...b.list.slice(0, 8).map((j) => el('div', { class: 'todo-row' },
        (j.designs || []).some((v) => v.chosen) && ['new', 'qualifying', 'hot'].includes(j.status)
          ? el('button', { type: 'button', class: 'todo-dream', 'data-dream': j.id, 'aria-label': `See ${j.buyer.name}’s dream design`, onclick: () => openLead(j.id, 'overview') }) : null,
        el('button', { type: 'button', class: 'todo-open', onclick: () => openLead(j.id, 'overview') },
          el('b', {}, j.buyer.name), el('span', { class: 'muted small' }, `${jobNo(j)} · ${b.line(j)}`)),
        b.call && j.buyer.phone ? el('a', { class: 'btn gold small', href: telHref(j.buyer.phone) }, '📞 Call')
          : el('button', { type: 'button', class: 'ghost small', onclick: () => openLead(j.id, 'overview') }, 'Open')))),
      b.list.length > 8 ? el('p', { class: 'muted small', style: 'margin-top:8px' }, `+ ${b.list.length - 8} more in Jobs`) : null));
    return [
      el('div', { class: 'row', style: 'align-items:flex-end' },
        el('div', { style: 'flex:1;min-width:0' }, el('h1', {}, h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'),
          el('p', { class: 'muted' }, new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))),
        el('button', { class: 'gold', onclick: () => newJobForm() }, '+ New job')),
      todayTodo(),
      isStaff ? el('div', { class: 'kpis three' }, kpi(bs[0].list.length, 'New leads'), kpi(thisWeek, 'Jobs this week'), kpi(money(jobs.reduce((t, j) => t + owedOn(j), 0)), 'Owed to you'))
        : el('div', { class: 'kpis three' }, kpi(jobs.filter((j) => ['new', 'qualifying'].includes(j.status)).length, 'Open leads'),
          kpi(jobs.filter((j) => estWith(j, 'sent')).length, 'Estimates out'), kpi(money(soldTotal(jobs)), 'Sold')),
      isStaff ? companyCard() : null,
      isStaff ? alertsCard() : null,
      calendarCard(),
      isStaff ? oversightCard() : null,
      ...(sections.length ? sections : [el('div', { class: 'card caught-up' },
        el('div', { style: 'font-size:2.4rem' }, '🎉'), el('h2', {}, 'All caught up'), el('p', { class: 'muted' }, 'Nothing needs your attention right now.'))]),
      el('button', { class: 'ghost block', onclick: () => { tab = 'jobs'; history.replaceState(null, '', '#jobs'); render(); } }, 'See all jobs →'),
    ];
  }
  // Fill in the little dream pictures on Today once the page is drawn.
  async function fillDreams() {
    for (const b of document.querySelectorAll('.todo-dream:not(.ready)')) {
      b.classList.add('ready');
      try { const v = (await api.designs.list(b.dataset.dream)).find((x) => x.chosen); if (v && v.url) b.append(el('img', { src: v.url, alt: '' })); else b.remove(); } catch (e) { b.remove(); }
    }
  }

  /* ---------- jobs list ---------- */
  const FILTERS = [
    ['open', 'Open', (j) => OPEN.includes(j.status) || needsInvoice(j) || owedOn(j) > 0], // not finished until invoiced and paid
    ['new', 'New', (j) => j.status === 'new'],
    ['hot', '🔥 Hot', (j) => j.status === 'hot'],
    ['active', 'Scheduled', (j) => ['scheduled', 'in_progress'].includes(j.status)],
    ['completed', 'Done', (j) => j.status === 'completed'],
    ['lost', 'Closed', (j) => j.status === 'lost'],
    ['all', 'All', () => true],
  ];
  function leadsView() {
    if (!FILTERS.some(([id]) => id === filter)) filter = 'open';
    const filterBar = el('div', { class: 'tabs-bar' }, ...FILTERS.map(([id, label, fn]) =>
      el('button', { 'aria-current': String(filter === id), onclick: () => { filter = id; render(); } }, label, el('span', { class: 'count' }, String(jobs.filter(fn).length)))));
    const matches = (j, q) => !q || [jobNo(j), String(j.number), j.buyer.name, j.buyer.phone, j.buyer.email, j.address, j.zip, j.state, TH.stateName(j.state), j.description, tradeOf(j.trade).label].join(' ').toLowerCase().includes(q);
    const byStatus = FILTERS.find(([id]) => id === filter)[2];
    const sf = usableState(statesIn(jobs, (j) => j.state));
    const inState = (st) => !sf || (sf === 'none' ? !st : st === sf);
    const inFilter = (j) => byStatus(j) && inState(j.state) && (!salesFilter || (salesFilter === 'none' ? !j.salesId : j.salesId === salesFilter));
    const salesSel = isStaff && team.length ? el('select', { 'aria-label': 'Salesperson', onchange: (e) => { salesFilter = e.target.value; render(); } },
      el('option', { value: '' }, 'All salespeople'), el('option', { value: 'none', selected: salesFilter === 'none' }, 'No salesperson'),
      ...team.map((x) => el('option', { value: x.id, selected: salesFilter === x.id }, `💼 ${x.name}`))) : null;
    const stateSel = jobs.length ? el('select', { 'aria-label': 'State', onchange: (e) => { stateFilter = e.target.value; render(); } },
      el('option', { value: '' }, `🗺 All states (${jobs.length})`),
      ...statesIn(jobs, (j) => j.state).map(([c, n]) => el('option', { value: c || 'none', selected: sf === (c || 'none') }, `${c ? TH.stateName(c) : 'No state set'} (${n})`))) : null;
    const canPick = isStaff && team.some((x) => x.active !== false);
    const errorBox = el('div', { class: 'error', hidden: true, role: 'alert' });
    const flash = (msg) => { jobsMsg = msg; render(); };
    const msgBox = jobsMsg ? el('div', { class: 'callout', role: 'status' }, jobsMsg) : null; jobsMsg = '';
    const shown = () => { const q = search.trim().toLowerCase(); return jobs.filter((j) => inFilter(j) && matches(j, q)); };
    // Bar for assigning the picked leads.
    const pickBar = el('div', { class: 'pick-bar', hidden: !picking });
    const drawPickBar = () => {
      pickBar.hidden = !picking;
      if (!picking) return;
      const repSel = el('select', { 'aria-label': 'Assign to' }, el('option', { value: '' }, '— Pick a salesperson —'),
        ...team.filter((x) => x.active !== false).map((x) => el('option', { value: x.id }, `💼 ${x.name}`)), el('option', { value: 'none' }, 'No salesperson (unassign)'));
      const list = shown(); const allOn = list.length && list.every((j) => picked.has(j.id));
      pickBar.replaceChildren(
        el('div', { class: 'row' }, el('b', { style: 'flex:1' }, picked.size ? `${picked.size} selected` : 'Tap jobs to select them'),
          el('button', { type: 'button', class: 'link small', onclick: () => { list.forEach((j) => (allOn ? picked.delete(j.id) : picked.add(j.id))); refresh(); } }, allOn ? 'Clear these' : `Select all ${list.length}`)),
        el('div', { class: 'row' }, repSel,
          el('button', { type: 'button', class: 'gold', disabled: !picked.size, onclick: async (e) => {
            if (!repSel.value) { repSel.focus(); errorBox.textContent = 'Pick who to assign them to.'; errorBox.hidden = false; return; }
            const btn = e.currentTarget; btn.disabled = true; errorBox.hidden = true;
            const ids = [...picked]; const to = repSel.value === 'none' ? null : repSel.value; let done = 0;
            for (const id of ids) { try { if ((find(jobs, id)?.salesId || null) !== to) await api.jobs.update(id, { salesId: to }); done++; } catch (err) { errorBox.textContent = err.message; errorBox.hidden = false; } }
            picking = false; picked.clear(); await load();
            flash(`💼 ${done} ${done === 1 ? 'job' : 'jobs'} ${to ? 'assigned to ' + salesName(to) : 'unassigned'}.`);
          } }, 'Assign')),
        el('button', { type: 'button', class: 'link small', onclick: () => { picking = false; picked.clear(); render(); } }, 'Cancel'));
    };
    const renderList = () => {
      const list = shown();
      return el('div', { class: 'leads' + (picking ? ' picking' : '') },
        list.length ? list.map((j) => leadCard(j, picking ? { on: picked.has(j.id), toggle: () => { picked.has(j.id) ? picked.delete(j.id) : picked.add(j.id); refresh(); } } : null))
          : [el('div', { class: 'card muted' }, search.trim() ? 'No jobs match your search.' : 'No jobs here right now.')]);
    };
    const refresh = () => { const l = renderList(); listWrap.replaceWith(l); listWrap = l; drawPickBar(); };
    let listWrap = renderList();
    const searchBox = el('input', { type: 'search', placeholder: 'Search name, phone, address, job #…', value: search, 'aria-label': 'Search jobs',
      oninput: (e) => { search = e.target.value; refresh(); } });
    drawPickBar();
    return [el('div', { class: 'row' }, el('h2', { style: 'flex:1' }, isStaff ? 'Jobs' : 'My clients'),
      el('button', { class: 'ghost', onclick: customersList }, '📁 Customers'), el('button', { class: 'gold', onclick: () => newJobForm() }, '+ New job')),
      canPick && !picking ? el('button', { type: 'button', class: 'ghost block assign-btn', onclick: () => { picking = true; picked.clear(); if (filter === 'open' && !salesFilter) salesFilter = 'none'; render(); } }, '💼 Assign leads to a salesperson') : null,
      msgBox, filterBar, salesSel || stateSel ? el('div', { class: 'two filters' }, stateSel, salesSel) : null, searchBox, listWrap, errorBox, pickBar];
  }

  function leadCard(j, pick) {
    const t = tradeOf(j.trade);
    const c = find(crew, j.contractorId);
    const flags = [
      j.status === 'scheduled' && j.crewResponse === 'declined' ? ['🙅 Crew can’t make it', 'hot'] : null,
      j.status === 'scheduled' && j.contractorId && !j.crewResponse ? ['⏳ Crew hasn’t confirmed', ''] : null,
      hasCrewNews(j) ? ['👷 New crew update', 'hot'] : null,
      j.stage ? [`${stageOf(j.stage).icon} ${stageOf(j.stage).label}`, ''] : null,
      needsVisit(j) ? ['🔥 Book the rep visit', 'hot'] : null,
      j.permit?.status === 'authorized' ? ['📋 Apply for permit', 'hot'] : null,
      reportsOf(j).length ? ['💵 Payment reported', 'hot'] : null,
      isStaff && crewBillsOf(j, ['submitted']).length ? ['🧾 Crew bill', 'hot'] : null,
      (j.designs || []).some((v) => v.chosen) ? ['🎨 Design picked', ''] : null,
      j.status === 'hot' && j.visitAt && !visitPassed(j) ? [`🤝 Visit ${fmtWhen(j.visitAt)}`, ''] : null,
      needsScheduling(j) ? ['✅ Sold? Schedule the crew', 'hot'] : null,
      needsInvoice(j) ? [`🧾 ${nextDue(j).label} invoice due`, 'hot'] : null,
      owedOn(j) > 0 ? [`💵 ${docs.usd(owedOn(j))} due`, 'hot'] : null,
      estWith(j, 'sent') ? ['⏳ Estimate sent', ''] : null,
      (j.materials || []).some((m) => m.status === 'needed') && j.status !== 'completed' ? [`🛒 ${(j.materials || []).filter((m) => m.status === 'needed').length} to order`, 'hot'] : null,
      paidUp(j) && !j.review?.requestedAt && !j.review?.rating ? ['⭐ Ask for a review', ''] : null,
      j.review?.rating ? [`${'★'.repeat(j.review.rating)} review`, ''] : null,
    ].filter(Boolean);
    return el('button', { class: 'lead' + (j.status === 'new' && !pick ? ' new-dot' : '') + (pick ? ' pickable' + (pick.on ? ' picked' : '') : ''),
      ...(pick ? { 'aria-pressed': String(pick.on) } : {}), onclick: pick ? pick.toggle : () => openLead(j.id) },
      pick ? el('span', { class: 'pick-box', 'aria-hidden': 'true' }, pick.on ? '✓' : '') : el('span', { class: 'ic' }, t.icon),
      el('span', { class: 'body' },
        el('span', { class: 'line1' }, el('b', {}, j.buyer.name), el('span', { class: 'spacer' }), el('span', { class: `pill s-${j.status}` }, statusOf(j.status).label)),
        el('span', { class: 'muted small' }, `${t.label} · ${jobNo(j)} · ${[j.state, j.zip].filter(Boolean).join(' ') || j.address}${j.status === 'new' ? ' · ' + ago(j.created) : ''}`),
        j.scheduledFor || c || (isStaff && j.salesId) ? el('span', { class: 'small' }, [j.scheduledFor ? '📅 ' + fmtWhen(j.scheduledFor) : null, c ? '👷 ' + c.name : null, isStaff && salesName(j.salesId) ? '💼 ' + salesName(j.salesId) : null].filter(Boolean).join('   ')) : null,
        flags.length ? el('span', { class: 'flags' }, ...flags.map(([txt, cls]) => el('span', { class: 'flag ' + cls }, txt))) : null),
    );
  }

  /* ---------- one job ---------- */
  let leadTab = 'overview';
  let openId = null;
  async function openLead(id, tabName) {
    const j = jobs.find((x) => x.id === id);
    if (!j) return;
    if (tabName) leadTab = tabName; else if (openId !== id) leadTab = 'overview';
    openId = id;
    releaseUrls();
    const [files, history, jobDocs, crewNotes, designs, messages] = await Promise.all([api.files.list(j.id), api.jobs.log(j.id), api.docs.list(j.id), api.jobs.crewNotes(j.id), api.designs.list(j.id).catch(() => []), (isStaff ? api.jobs.messages(j.id) : Promise.resolve([])).catch(() => [])]);
    j.crewNotesSeenAt = Date.now(); // opened → no longer "new"
    fileUrls = [...files.map((f) => f.url), ...designs.map((v) => v.url)].filter(Boolean);
    const t = tradeOf(j.trade);
    const close = closeDrawer;
    const b = j.buyer;
    const first = (b.name || '').split(' ')[0] || 'the customer';
    const assigned = find(crew, j.contractorId);

    const savedNote = el('span', { class: 'saved-note', hidden: true }, 'Saved ✓');
    const flashSaved = () => { savedNote.hidden = false; setTimeout(() => { savedNote.hidden = true; }, 1600); };
    const errorBox = el('div', { class: 'error', hidden: true, role: 'alert' });
    async function update(patch) {
      try {
        await api.jobs.update(j.id, patch);
        await load();
        flashSaved();
        openLead(j.id);
      } catch (err) { errorBox.textContent = err.message; errorBox.hidden = false; }
    }

    // Summary: who, where, when, crew, money, at a glance.
    // Log a call: who called, how it went. Shows in the job history and the owner's Sales view.
    let callOutcome = '';
    const callNote = el('input', { type: 'text', placeholder: 'Quick note (optional)', autocomplete: 'off', maxlength: '500' });
    const outcomeBtns = el('div', { class: 'stage-chips' });
    const drawOutcomes = () => outcomeBtns.replaceChildren(...['Talked', 'Left voicemail', 'No answer', 'Booked a visit', 'Not interested'].map((o) =>
      el('button', { type: 'button', class: 'chip', 'aria-pressed': String(callOutcome === o), onclick: () => { callOutcome = o; drawOutcomes(); } }, o)));
    drawOutcomes();
    const callBox = el('div', { class: 'call-box stack', hidden: true },
      el('b', { class: 'small' }, 'How did the call go?'), outcomeBtns, callNote,
      el('button', { type: 'button', onclick: async (e) => {
        e.currentTarget.disabled = true;
        try { await api.jobs.logCall(j.id, callOutcome, callNote.value); await load(); flashSaved(); openLead(j.id); }
        catch (err) { errorBox.textContent = err.message; errorBox.hidden = false; e.currentTarget.disabled = false; }
      } }, 'Save call'));
    const lastCall = history.slice().reverse().find((l) => l.text.startsWith('📞 Call'));
    const summary = el('section', { class: 'card stack summary' },
      el('div', { class: 'row' }, el('span', { class: 'avatar' }, initials(b.name)),
        el('div', { style: 'flex:1;min-width:0' },
          el('h2', {}, el('button', { type: 'button', class: 'name-link', onclick: () => openCustomer(customerKey(j)) }, b.name)),
          el('p', { class: 'muted small' }, `${t.icon} ${t.label} · ${jobNo(j)} · `,
            el('button', { type: 'button', class: 'link small', onclick: () => openCustomer(customerKey(j)) }, (() => { const n = jobsOfCustomer(customerKey(j)).length; return `📁 ${n} job${n === 1 ? '' : 's'} with us`; })())))),
      // Phone and email spelled out in blue: tap to call or email (owner's request, instead of Call / Email buttons).
      (b.phone || b.email) && !j.doNotContact ? el('div', { class: 'contact-links' },
        b.phone ? el('a', { href: telHref(b.phone), 'aria-label': `Call ${b.name} at ${b.phone}` }, `📞 ${b.phone}`) : null,
        b.email ? el('a', { href: `mailto:${b.email}?subject=${encodeURIComponent('Your ' + t.label.toLowerCase() + ' request with Top Hat Contracting')}`, 'aria-label': `Email ${b.name}` }, `✉️ ${b.email}`) : null) : null,
      el('div', { class: 'contact' },
        j.doNotContact ? el('span', { class: 'flag hot' }, '🚫 Do not contact') : null,
        el('button', { type: 'button', class: 'ghost small', onclick: () => { callBox.hidden = !callBox.hidden; } }, '📝 Log call'),
        b.phone && !j.doNotContact ? el('a', { class: 'btn ghost small', href: smsHref(b.phone) }, '💬 Text') : null,
        isStaff && (b.phone || b.email) && !j.doNotContact ? el('button', { type: 'button', class: 'ghost small', onclick: () => { leadTab = 'overview'; renderTab(); document.getElementById('convo')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, '📋 Templates') : null),
      callBox,
      el('ul', { class: 'facts' },
        isStaff ? el('li', {}, el('span', { class: 'fi' }, '💼'), team.length
          ? el('select', { class: 'inline-select', 'aria-label': 'Salesperson', onchange: (e) => update({ salesId: e.target.value || null }) },
            el('option', { value: '' }, 'No salesperson'), ...team.map((x) => el('option', { value: x.id, selected: x.id === j.salesId }, x.name)))
          : el('span', { class: 'muted' }, 'No sales team yet')) : null,
        // Contractor: pick right here (office and sales). Saved as soon as it changes.
        el('li', {}, el('span', { class: 'fi' }, '👷'), el('span', { class: 'stack', style: 'gap:2px;min-width:0' },
          el('select', { class: 'inline-select', 'aria-label': 'Contractor', onchange: (e) => {
            const patch = { contractorId: e.target.value || null };
            if (patch.contractorId && j.scheduledFor && ['new', 'qualifying', 'hot'].includes(j.status)) patch.status = 'scheduled';
            update(patch);
          } },
            el('option', { value: '' }, 'Assign a contractor'),
            ...crew.filter((c) => c.active || c.id === j.contractorId)
              .sort((a, c) => ((!!j.state && c.state === j.state) - (!!j.state && a.state === j.state)) || (TH.doesTrade(c, j.trade) - TH.doesTrade(a, j.trade)) || a.name.localeCompare(c.name))
              .map((c) => el('option', { value: c.id, selected: c.id === j.contractorId, disabled: insuranceExpired(c.id) && c.id !== j.contractorId }, `${TH.doesTrade(c, j.trade) ? '★ ' : ''}${c.name}${c.state ? ` · ${c.state}` : ''}${insuranceExpired(c.id) ? ' (insurance ran out)' : ''}${offTag(c.id, j.scheduledFor)}`))),
          assigned && j.status === 'scheduled' ? el('span', { class: 'small ' + (j.crewResponse === 'declined' ? 'bad-text' : 'muted') },
            j.crewResponse === 'confirmed' ? '✓ confirmed' : j.crewResponse === 'declined' ? `can’t make it: “${j.crewResponseNote}”` : 'not confirmed yet') : null)),
        lastCall ? el('li', {}, el('span', { class: 'fi' }, '📞'), el('span', { class: 'muted' }, `${lastCall.text.replace(/^📞 Call /, 'Last call ')} · ${ago(lastCall.at)}`)) : null,
        el('li', {}, el('span', { class: 'fi' }, '📍'), el('a', { href: 'https://maps.google.com/?q=' + encodeURIComponent(addrOf(j)), target: '_blank', rel: 'noopener' }, addrOf(j))),
        el('li', {}, el('span', { class: 'fi' }, '🗺'), el('select', { class: 'inline-select' + (j.state ? '' : ' warn'), 'aria-label': 'State', onchange: (e) => update({ state: e.target.value }) }, ...stateOptions(j.state, 'No state set'))),
        j.visitAt ? el('li', {}, el('span', { class: 'fi' }, '🤝'), el('span', {}, `Rep visit ${fmtWhen(j.visitAt)}${salesName(j.salesId) ? ' · ' + salesName(j.salesId) : ''}`)) : null,
        // Start date (and expected finish) right on the customer card: change it here, saved right away.
        el('li', {}, el('span', { class: 'fi' }, '📅'), el('span', { class: 'date-pair' },
          el('label', { class: 'mini-field' }, el('span', { class: 'muted small' }, 'Start date'),
            el('input', { type: 'datetime-local', class: 'inline-select', 'aria-label': 'Start date', value: j.scheduledFor || '', onchange: (e) => {
              const patch = { scheduledFor: e.target.value || null };
              if (patch.scheduledFor && j.contractorId && ['new', 'qualifying', 'hot'].includes(j.status)) patch.status = 'scheduled';
              update(patch); } })),
          el('label', { class: 'mini-field' }, el('span', { class: 'muted small' }, 'End date'),
            el('input', { type: 'date', class: 'inline-select', 'aria-label': 'End date', value: j.endDate || '', min: (j.scheduledFor || '').slice(0, 10), onchange: (e) => {
              if (e.target.value && j.scheduledFor && e.target.value < j.scheduledFor.slice(0, 10)) { errorBox.textContent = 'The end date can’t be before the start date.'; errorBox.hidden = false; e.target.value = j.endDate || ''; return; }
              update({ endDate: e.target.value || null }); } })))),
        j.startedAt ? el('li', {}, el('span', { class: 'fi' }, '⏱'), el('span', {},
          `Started ${new Date(j.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`,
          j.finishedAt ? ` · finished after ${(() => { const m = Math.round((j.finishedAt - j.startedAt) / 60000); return m < 60 ? m + ' min' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm'; })()}` : '')) : null,
        el('li', {}, el('span', { class: 'fi' }, '💲'), j.price != null
          ? el('span', {}, `${money(j.price)} ${['new', 'qualifying'].includes(j.status) ? 'phone estimate' : j.status === 'hot' ? 'agreed price' : 'customer price'}`, j.crewPay != null ? el('span', { class: 'muted' }, ` · ${money(j.price - j.crewPay)} profit`) : null)
          : el('span', { class: 'muted' }, 'No price yet'))),
    );
    const convo = isStaff ? convoBox(j, messages, async () => { await load(); openLead(j.id); }) : null;

    // What the customer asked for
    // Design studio: the customer's AI pictures, and the one they picked.
    const chosen = designs.find((v) => v.chosen);
    const aiCount = designs.filter((v) => v.source === 'ai').length;
    // A lead with a dream picture: show it right under the next step, so the call starts from the same picture.
    const dreamFirst = !!chosen && ['new', 'qualifying', 'hot'].includes(j.status);
    const designCard = el('section', { class: 'card stack' + (dreamFirst ? ' dream-card' : '') },
      el('div', { class: 'row' }, el('h3', {}, dreamFirst ? `🌟 ${first}’s dream ${TH.styleOf(j.style) ? TH.styleOf(j.style).room.label.toLowerCase() + ' · ' + TH.styleOf(j.style).style.name : 'design'}` : '🎨 Design studio'), el('span', { class: 'spacer' }), aiCount ? el('span', { class: 'pill' }, `${aiCount} design${aiCount === 1 ? '' : 's'}`) : null),
      chosen ? el('figure', { class: 'design-chosen' },
        // Before and after: the customer's own photo (the start of this design) next to the one they picked, as a slider.
        (() => { let root = chosen; while (root && root.parentId) root = designs.find((y) => y.id === root.parentId) || null;
          return root && root !== chosen && root.url
            ? TH.beforeAfter([{ url: root.url, name: 'Their photo', stage: 'before', group: 'chosen' }, { url: chosen.url, name: 'The one they picked', stage: 'after', group: 'chosen' }], { title: 'Before & after: slide to compare' })
            : el('a', { href: chosen.url, target: '_blank', rel: 'noopener' }, el('img', { src: chosen.url, alt: 'The customer’s chosen design' })); })(),
        el('figcaption', {}, el('b', {}, '⭐ The one they picked'), el('ol', { class: 'studio-steps' },
          ...(() => { const out = []; for (let x = chosen; x && x.source === 'ai'; x = designs.find((y) => y.id === x.parentId)) out.unshift(x); return out; })().map((v) => el('li', {}, v.prompt)))))
        : el('p', { class: 'muted small' }, designs.length ? `${designs.length} picture${designs.length === 1 ? '' : 's'} so far. They haven’t picked one yet.` : `${j.hasAccount ? first + ' can' : 'You can'} upload a photo of the space and describe the remodel. The AI shows a picture of it, and you keep changing it until it’s right.`),
      el('button', { type: 'button', class: 'ghost', onclick: () => openStudio(j) }, designs.length ? 'Open the design studio' : '🎨 Start a design'),
    );

    // Building permit: customer's OK, the town's website, the packet, and the permit number.
    const pm = j.permit || { status: 'none' };
    const place = TH.placeOf(j.address);
    const savedPortal = (settings.permitPortals || {})[place.toLowerCase()] || '';
    const portalIn = el('input', { type: 'url', inputmode: 'url', placeholder: 'https://… the building department’s permit website', value: pm.portalUrl || savedPortal });
    const permitSel = el('select', { 'aria-label': 'Permit status' }, ...TH.PERMIT_STATUSES.map((x) => el('option', { value: x.id, selected: x.id === pm.status }, x.label)));
    const numIn = el('input', { placeholder: 'e.g. BP-2026-01542', value: pm.number || '', 'aria-label': 'Permit number' });
    const feeIn = el('input', { type: 'number', inputmode: 'decimal', min: '0', step: '0.01', placeholder: 'e.g. 185', value: pm.fee ?? '', 'aria-label': 'Permit fee' });
    const remember = place && isStaff ? el('input', { type: 'checkbox', checked: !savedPortal }) : null;
    const portalNow = pm.portalUrl || savedPortal;
    const permitCard = el('section', { class: 'card stack' },
      el('div', { class: 'row' }, el('h3', {}, '📋 Building permit'), el('span', { class: 'spacer' }), el('span', { class: 'pill' + (pm.status === 'authorized' ? ' s-hot' : '') }, (TH.PERMIT_STATUSES.find((x) => x.id === pm.status) || {}).label || pm.status)),
      pm.authorizedAt ? el('p', { class: 'small' }, `✅ ${pm.authorizedBy} approved applying on ${new Date(pm.authorizedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}.`)
        : el('p', { class: 'muted small' }, j.hasAccount ? `Waiting for ${first}’s OK. They approve it on their My jobs page (“Apply for me”), or sign the packet below.` : `${first} doesn’t use the app: have them sign the permit packet below.`),
      el('div', { class: 'row', style: 'flex-wrap:wrap' },
        el('a', { class: 'btn ghost small', target: '_blank', rel: 'noopener', href: 'https://www.google.com/search?q=' + encodeURIComponent(`${place || ''} ${j.state || ''} ${j.zip || ''} building department permit apply online`.trim()) }, '🔎 Find the building department'),
        portalNow ? el('a', { class: 'btn ghost small', target: '_blank', rel: 'noopener', href: portalNow }, '🏛 Open their permit website') : null,
        el('button', { type: 'button', class: 'ghost small', onclick: () => permitPacket(j, chosen) }, '📄 Permit packet (PDF)')),
      el('label', { class: 'field' }, `Building department website${place ? ` for ${place}` : ''}`, portalIn),
      remember ? el('label', { class: 'row small', style: 'font-weight:600' }, remember, `Use this website for every job in ${place}`) : null,
      el('div', { class: 'two' }, el('label', { class: 'field' }, 'Status', permitSel), el('label', { class: 'field' }, 'Permit #', numIn)),
      el('label', { class: 'field' }, 'Permit fee ($)', feeIn),
      el('button', { type: 'button', onclick: async () => {
        const url = portalIn.value.trim();
        await update({ permit: { status: permitSel.value, number: numIn.value.trim(), fee: feeIn.value, portalUrl: url } });
        if (remember?.checked && url && /^https?:\/\//i.test(url)) settings = await api.settings.save({ permitPortals: { ...(settings.permitPortals || {}), [place.toLowerCase()]: url } });
      } }, 'Save permit'),
      el('p', { class: 'muted small' }, 'Every town has its own permit website and account, so the application is submitted there. The packet has everything it asks for, and the customer sees the status and permit number in the app.'),
    );

    // What the customer asked for: shown inside the summary box at the top (owner's request), not as its own card.
    function askedFor() { return el('div', { class: 'stack asked-for', style: 'gap:8px' },
      el('h3', {}, 'What the customer asked for'),
      el('p', { style: 'white-space:pre-wrap' }, j.description),
      TH.styleOf(j.style) ? el('div', { class: 'style-chosen' }, el('img', { src: TH.styleOf(j.style).img, alt: '' }),
        el('span', {}, el('span', { class: 'muted small' }, 'Style they picked'), el('b', {}, TH.styleOf(j.style).label))) : null,
      ['new', 'qualifying', 'hot'].includes(j.status) && j.buyer.phone ? el('a', { class: 'btn ghost small', style: 'align-self:flex-start',
        href: smsHref(j.buyer.phone, `Hi ${first}, here are some style ideas from ${settings.name || 'Top Hat Contracting'}. Pick the look you like best and tell us: ${new URL('index.html#/styles' + (TH.styleOf(j.style) ? '?room=' + TH.styleOf(j.style).room.id : ''), location.href).href}`) }, '🖼️ Text them style ideas') : null,
      el('dl', { class: 'dl' },
        el('dt', {}, 'Ideal start date'), el('dd', {}, find(TIMEFRAMES, j.timeframe)?.label || '—'),
        el('dt', {}, 'Level of finish'), el('dd', {}, find(BUDGETS, j.budget)?.label || 'Not sure yet'),
        el('dt', {}, 'Requested'), el('dd', {}, `${new Date(j.created).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} (${ago(j.created)})`)),
    ); }

    // Progress: tap a step to change it.
    const FLOW = [['new', 'New'], ['qualifying', 'Estimate'], ['hot', 'Hot'], ['scheduled', 'Booked'], ['in_progress', 'Working'], ['completed', 'Done']];
    const at = FLOW.findIndex(([s]) => s === j.status);
    const progress = el('section', { class: 'card stack' },
      el('div', { class: 'row' }, el('h3', {}, 'Progress'), el('span', { class: 'spacer' }), savedNote),
      el('div', { class: 'stepper', role: 'group', 'aria-label': 'Job status' }, ...FLOW.map(([s, label], i) =>
        el('button', { type: 'button', class: i < at ? 'done' : i === at ? 'on' : '', 'aria-pressed': String(i === at), 'aria-label': `Status: ${label}`, onclick: () => j.status !== s && update({ status: s }) },
          el('span', { class: 'dot' }, i < at ? '✓' : String(i + 1)), el('span', { class: 'lbl' }, label)))),
      (TH.STAGES || []).some((x) => x.status === j.status) ? el('div', { class: 'stage-chips' },
        ...TH.STAGES.filter((x) => x.status === j.status).map((x) => el('button', { type: 'button', class: 'chip', 'aria-pressed': String(j.stage === x.id),
          onclick: () => update({ stage: j.stage === x.id ? null : x.id }) }, `${x.icon} ${x.label}`))) : null,
      j.progressAt ? el('p', { class: 'small last-update' + (j.progressByCrew ? ' crew' : '') },
        `Last update: ${progressText(j)} · ${j.progressByCrew ? `${j.progressBy} (crew)` : j.progressBy || 'office'} · ${ago(j.progressAt)}`) : null,
      el('div', { class: 'row' },
        isStaff && j.status === 'lost' ? el('div', { class: 'stack', style: 'gap:6px;flex-basis:100%' }, el('b', { class: 'small' }, 'Why didn’t it close?'),
          el('div', { class: 'stage-chips' }, ...TH.LOST_REASONS.map((r) => el('button', { type: 'button', class: 'chip', 'aria-pressed': String(j.lostReason === r), onclick: () => update({ lostReason: r }) }, r)))) : null,
        el('p', { class: 'muted small', style: 'flex:1' }, j.status === 'lost' ? 'Closed as “Not a fit”. Tap a step to reopen.' : `The customer sees: “${j.stage ? stageOf(j.stage).buyer : statusOf(j.status).buyer}”`),
        j.status !== 'lost' ? el('button', { type: 'button', class: 'link small', style: 'color:var(--bad)', onclick: () => { if (confirm('Close this job as “Not a fit”?')) update({ status: 'lost' }); } }, 'Not a fit') : null,
        // Owner/office only: delete the job for good (it asks twice).
        isStaff ? el('button', { type: 'button', class: 'link small', style: 'color:var(--bad)', onclick: async () => {
          if (!confirm(`Delete ${jobNo(j)} (${b.name}) for good? Its photos, designs, estimates and invoices are deleted too. This can’t be undone.`)) return;
          if (prompt('Type DELETE to confirm.', '') !== 'DELETE') return;
          try { await api.jobs.remove(j.id); await load(); closeDrawer(); }
          catch (err) { errorBox.textContent = err.message; errorBox.hidden = false; }
        } }, '🗑 Delete job') : null),
    );

    // Crew & schedule
    const sameSt = (c) => !!j.state && c.state === j.state;
    const sortedCrew = crew.filter((c) => c.active || c.id === j.contractorId)
      .sort((a, c) => (sameSt(c) - sameSt(a)) || (TH.doesTrade(c, j.trade) - TH.doesTrade(a, j.trade)) || a.name.localeCompare(c.name));
    const crewSel = el('select', { name: 'contractorId' },
      el('option', { value: '' }, '— Not assigned —'),
      ...sortedCrew.map((c) => el('option', { value: c.id, selected: c.id === j.contractorId, disabled: insuranceExpired(c.id) && c.id !== j.contractorId }, `${insuranceExpired(c.id) ? '⛔ ' : ''}${TH.doesTrade(c, j.trade) ? '★ ' : ''}${c.name}${c.state ? ` · ${c.state}` : ''}${j.state && c.state && c.state !== j.state ? ' (other state)' : ''}${offTag(c.id, j.scheduledFor)}`)));
    const whenInput = el('input', { type: 'datetime-local', name: 'scheduledFor', value: j.scheduledFor || '' });
    const endInput = el('input', { type: 'date', name: 'endDate', value: j.endDate || '' }); // expected finish: the customer sees it
    const crewLink = j.crewToken ? new URL(`crew.html?t=${j.crewToken}`, location.href).href : null;
    // Sent to the crew lead. Never include prices, budget or notes here.
    const dispatchText = assigned && [
      `Top Hat job ${jobNo(j)}: ${t.label}`,
      j.scheduledFor ? `When: ${fmtWhen(j.scheduledFor)}` : null,
      `Customer: ${b.name} ${b.phone}`,
      `Address: ${addrOf(j)}`,
      `Details: ${j.description}`,
      crewLink ? `Upload job photos here: ${crewLink}` : null,
    ].filter(Boolean).join('\n');
    const setup = el('form', { class: 'card stack', onsubmit: (e) => {
      e.preventDefault();
      if (endInput.value && whenInput.value && endInput.value < whenInput.value.slice(0, 10)) { errorBox.textContent = 'The expected finish can’t be before the start date.'; errorBox.hidden = false; return; }
      const patch = { contractorId: crewSel.value || null, scheduledFor: whenInput.value || null, endDate: endInput.value || null };
      if (patch.contractorId && patch.scheduledFor && ['new', 'qualifying', 'hot'].includes(j.status)) patch.status = 'scheduled';
      update(patch);
    } },
      el('h3', {}, '👷 Contractor & schedule'),
      el('label', { class: 'field' }, 'Contractor', el('span', { class: 'hint' }, `★ = does this kind of work${j.state ? ` · contractors in ${TH.stateName(j.state)} first` : ''}`), crewSel),
      el('label', { class: 'field' }, 'Start date & time', whenInput),
      el('label', { class: 'field' }, 'Expected finish', el('span', { class: 'hint' }, 'The customer sees the start and finish dates'), endInput),
      el('button', { type: 'submit' }, 'Save contractor & date'),
      ['scheduled', 'in_progress'].includes(j.status) ? null : el('p', { class: 'muted small' }, 'Picking a crew and a date moves the job to “Scheduled”.'),
      assigned?.phone ? el('a', { class: 'btn ghost', href: smsHref(assigned.phone, dispatchText) }, `💬 Text job details to ${assigned.name.split(' ')[0]}`) : null,
      crewLink ? el('div', { class: 'crew-link' },
        el('span', { class: 'small' }, `📷 ${assigned ? assigned.name.split(' ')[0] + '’s' : 'Crew'} photo link`),
        el('button', { type: 'button', class: 'ghost small', onclick: async (e) => {
          try { await navigator.clipboard.writeText(crewLink); e.target.textContent = 'Copied ✓'; }
          catch { prompt('Copy this link:', crewLink); }
        } }, 'Copy link')) : null,
    );
    // Crew & schedule only where it's used: sold hot leads, scheduled and working jobs (or when a step asks for it).
    let setupWanted = j.status === 'scheduled' || j.status === 'in_progress' || (j.status === 'hot' && visitPassed(j));
    const focusSetup = () => { setupWanted = true; leadTab = 'overview'; renderTab(); setup.scrollIntoView({ block: 'start', behavior: 'smooth' }); crewSel.focus(); };

    // Notes from the crew (customers never see these)
    const crewNotesCard = () => el('section', { class: 'card stack' },
      el('div', { class: 'row' }, el('h3', {}, '💬 Crew notes'), el('span', { class: 'spacer' }), crewNotes.length ? el('span', { class: 'pill' }, String(crewNotes.length)) : null),
      crewNotes.length ? el('ul', { class: 'crew-notes' }, ...crewNotes.map((n) => el('li', {},
        el('span', { class: 'muted small' }, `${n.by} · ${new Date(n.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} (${ago(n.at)})`),
        el('p', {}, n.text))))
        : el('p', { class: 'muted small' }, 'No notes from the crew yet. The contractor on this job can add notes from their crew login or the job’s photo link.'),
      el('p', { class: 'muted small' }, 'Customers never see crew notes.'),
    );

    // Money (staff only)
    const priceInput = el('input', { type: 'number', name: 'price', inputmode: 'decimal', min: '0', step: '1', placeholder: 'e.g. 2500', value: j.price ?? '' });
    const payInput = el('input', { type: 'number', name: 'crewPay', inputmode: 'decimal', min: '0', step: '1', placeholder: 'e.g. 1600', value: j.crewPay ?? '' });
    const profitOut = el('div', { class: 'profit' });
    const showProfit = () => {
      const pr = num(priceInput.value), pay = num(payInput.value);
      if (pr == null || pay == null) { profitOut.className = 'profit'; profitOut.replaceChildren(el('span', { class: 'muted small' }, 'Enter both prices to see your profit.')); return; }
      const profit = pr - pay;
      profitOut.className = 'profit' + (profit < 0 ? ' neg' : '');
      profitOut.replaceChildren(el('span', {}, 'Top Hat profit'), el('b', {}, money(profit)), el('span', { class: 'small' }, pr ? `${Math.round((profit / pr) * 100)}% margin` : ''));
    };
    showProfit();
    const moneyCard = el('form', { class: 'card stack money', oninput: showProfit, onsubmit: (e) => {
      e.preventDefault();
      const price = num(priceInput.value), crewPay = num(payInput.value);
      if ((price != null && price < 0) || (crewPay != null && crewPay < 0)) { errorBox.textContent = 'Prices can’t be negative.'; errorBox.hidden = false; return; }
      update(isStaff ? { price, crewPay } : { price });
    } },
      el('div', { class: 'row' }, el('h3', {}, 'Prices'), el('span', { class: 'spacer' }), el('span', { class: 'pill lock' }, '🔒 Staff only')),
      el('div', { class: 'two' },
        el('label', { class: 'field' }, 'Customer price', el('span', { class: 'hint' }, 'What the customer pays'), priceInput),
        isStaff ? el('label', { class: 'field' }, 'Crew pay', el('span', { class: 'hint' }, 'What you pay the crew'), payInput) : el('span')),
      isStaff ? profitOut : null,
      isStaff && j.contractorId ? (() => {
        const paidDate = el('input', { type: 'date', value: j.crewPaid?.date || docs.todayKey(), 'aria-label': 'Date you paid the crew' });
        const paidHow = el('select', { 'aria-label': 'How you paid the crew' }, ...['Zelle', 'Check', 'Cash', 'Bank transfer (ACH)', 'Venmo', 'Cash App', 'Other'].map((m) => el('option', { selected: m === j.crewPaid?.method }, m)));
        return el('div', { class: 'crew-paid' + (j.crewPaid ? ' done' : '') },
          j.crewPaid ? [el('span', {}, `💸 ${crewName(j) || 'Crew'} paid ${j.crewPay != null ? money(j.crewPay) + ' ' : ''}on ${docs.fmtDate(j.crewPaid.date)} · ${j.crewPaid.method}`),
            el('button', { type: 'button', class: 'link small', onclick: () => update({ crewPaid: null }) }, 'Undo')]
            : [el('b', { class: 'small' }, `Paid ${crewName(j) || 'the crew'}?`), el('div', { class: 'two' }, paidDate, paidHow),
              el('button', { type: 'button', class: 'ghost', onclick: () => update({ crewPaid: { date: paidDate.value, method: paidHow.value } }) }, '💸 Mark crew paid')]);
      })() : null,
      el('button', { type: 'submit' }, 'Save prices'),
      el('p', { class: 'muted small' }, 'The crew never sees the customer price or your profit. The customer never sees crew pay.'),
    );

    // Estimates & invoices
    const approvedEst = jobDocs.find((x) => x.type === 'estimate' && x.status === 'approved' && !x.changeOrder);
    const invoiceBase = approvedEst && !jobDocs.some((x) => x.type === 'invoice' && x.fromEstimateId === approvedEst.id) ? approvedEst : null;
    const docsCard = el('section', { class: 'card stack' },
      el('h3', {}, 'Estimates & invoices'),
      jobDocs.length ? el('div', { class: 'doc-list' }, ...jobDocs.map((dc) => {
        const tt = docs.totals(dc);
        return el('button', { type: 'button', class: 'doc-row', onclick: () => openDoc(j.id, dc.id) },
          el('span', { class: 'ic' }, dc.type === 'invoice' ? '🧾' : dc.changeOrder ? '➕' : '📝'),
          el('span', { class: 'body' }, el('b', {}, dc.changeOrder ? `Change order ${dc.number}` : dc.number),
            el('span', { class: 'muted small' }, dc.type === 'invoice' && !['draft', 'void'].includes(dc.status) ? `${docs.usd(tt.total)} · ${docs.usd(Math.max(0, tt.balance))} due` : docs.usd(tt.total))),
          el('span', { class: `pill ${docs.pillClass(dc)}` }, docs.label(dc)));
      })) : el('p', { class: 'muted small' }, 'None yet. They’re filled in with this job’s details. Crew pay never appears on them.'),
      el('div', { class: 'row' },
        el('button', { type: 'button', class: 'ghost', style: 'flex:1', onclick: () => openDoc(j.id, null, 'estimate') }, '+ Estimate'),
        el('button', { type: 'button', class: 'ghost', style: 'flex:1', onclick: () => openDoc(j.id, null, 'invoice', invoiceBase) }, '+ Invoice')),
      isStaff && (approvedEst || ['scheduled', 'in_progress', 'completed'].includes(j.status)) ? el('button', { type: 'button', class: 'ghost', onclick: () => openDoc(j.id, null, 'estimate', null, null, { changeOrder: true }) }, '➕ Change order (extra work the customer signs)') : null,
    );

    // Files: this job's folder
    const uploadNote = el('span', { class: 'muted small', hidden: true }, 'Uploading…');
    const has = (k) => files.some((f) => f.kind === k);
    async function fileUpdate(fileId, patch) {
      try { await api.files.update(j.id, fileId, patch); await load(); flashSaved(); openLead(j.id); }
      catch (err) { errorBox.textContent = err.message; errorBox.hidden = false; }
    }
    const filesCard = el('section', { class: 'card stack' },
      el('div', { class: 'row' }, el('h3', {}, `Files · ${jobNo(j)}`), el('span', { class: 'spacer' }), uploadNote),
      TH.beforeAfter(files.filter((f) => f.source === 'design').map((f) => ({ url: f.url, name: f.name, stage: f.stage, group: f.designGroup })), { title: '🎨 Saved designs: before & after (everyone on the job sees these)' }),
      el('label', { class: 'btn gold' }, '+ Add files or photos',
        el('input', { type: 'file', multiple: true, hidden: true, onchange: async (e) => {
          const picked = [...e.target.files];
          if (!picked.length) return;
          uploadNote.hidden = false;
          try { for (const f of picked) await api.files.upload(j.id, f); }
          catch (err) { errorBox.textContent = err.message; errorBox.hidden = false; }
          await load(); openLead(j.id);
        } })),
      el('div', { class: 'checks' }, ...['estimate', 'contract', 'invoice'].map((k) =>
        el('span', { class: 'pill' + (has(k) ? ' s-completed' : '') }, `${has(k) ? '✓' : '○'} ${kindOf(k).label}`))),
      files.length ? el('ul', { class: 'files' }, ...files.map((f) => {
        const k = kindOf(f.kind);
        return el('li', {},
          el('span', { class: 'ic' }, k.icon),
          el('div', { class: 'body' },
            f.url ? el('a', { href: f.url, target: '_blank', rel: 'noopener', download: /^(image\/|application\/pdf)/.test(f.mime) ? null : f.name }, f.name) : el('span', {}, f.name + ' (missing)'),
            el('div', { class: 'meta' },
              el('select', { 'aria-label': `Type of ${f.name}`, onchange: (e) => fileUpdate(f.id, { kind: e.target.value }) },
                ...FILE_KINDS.map((x) => el('option', { value: x.id, selected: x.id === f.kind }, x.label))),
              f.stage && f.source !== 'design' ? el('span', { class: 'pill' }, (find(PHOTO_STAGES, f.stage) || {}).label || f.stage) : null,
              f.source === 'design' ? el('span', { class: 'pill s-scheduled' }, f.stage === 'before' ? '🎨 Before' : '🎨 After (design)') : null,
              el('span', {}, `${fileSize(f.size)} · ${new Date(f.uploaded).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}${f.source === 'crew' ? ` · from ${f.by}` : f.source === 'customer' ? ` · from customer${f.by ? ` (${f.by})` : ''}` : ''}`)),
            f.note ? el('p', { class: 'small', style: 'font-style:italic' }, `“${f.note}”`) : null,
            el('label', { class: 'share' },
              el('input', { type: 'checkbox', checked: f.shared, onchange: (e) => fileUpdate(f.id, { shared: e.target.checked }) }),
              f.shared ? 'Customer can see this' : 'Customer can’t see this')),
          el('button', { type: 'button', class: 'icon', 'aria-label': `Delete ${f.name}`, onclick: async () => {
            if (!confirm(`Delete "${f.name}" from ${jobNo(j)}? This can't be undone.`)) return;
            await api.files.remove(j.id, f.id); await load(); openLead(j.id);
          } }, '✕'));
      })) : el('p', { class: 'muted small' }, 'No files yet. Add estimates, contracts, invoices, receipts, permits and job photos here.'),
      el('p', { class: 'muted small' }, '🔒 Files are staff-only unless you tick “Customer can see”. Crew never see files.'),
      j.photos?.length ? el('div', { class: 'stack', style: 'gap:6px' }, el('b', { class: 'small' }, 'Photos from the customer’s request'),
        el('div', { class: 'photo-row' }, ...j.photos.map((src, i) => el('a', { href: src, target: '_blank' }, el('img', { src, alt: `Customer photo ${i + 1}` }))))) : null,
    );

    // Office notes + activity
    const notes = el('textarea', { placeholder: 'Private office notes. Customers and crew never see these.', value: j.notes || '', rows: 4 });
    const notesCard = el('section', { class: 'card stack' },
      el('h3', {}, '🔒 Office notes'),
      notes,
      el('button', { type: 'button', class: 'ghost', onclick: () => update({ notes: notes.value }) }, 'Save notes'),
    );
    const log = el('section', { class: 'card stack' },
      el('h3', {}, 'Activity'),
      el('ul', { class: 'log' }, ...history.slice().reverse().map((l) => el('li', {},
        el('span', {}, new Date(l.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })), el('span', {}, l.text)))),
    );

    // Crew bills: what the contractor billed Top Hat for this job. Approve, decline, pay.
    const crewBillsCard = isStaff && (j.contractorId || (j.crewBills || []).length) ? (() => {
      const bills = (j.crewBills || []).slice().sort((a, b) => b.at - a.at);
      const PILL = { submitted: ['New: needs your OK', 's-hot'], approved: ['Approved: to pay', 's-scheduled'], paid: ['Paid', 's-completed'], declined: ['Declined', 's-lost'] };
      const act = (b, action, opts) => async (e) => { e.currentTarget.disabled = true; try { await api.jobs.crewBill(j.id, b.id, action, opts && opts()); await load(); openLead(j.id, 'money'); } catch (err) { errorBox.textContent = err.message; errorBox.hidden = false; e.currentTarget.disabled = false; } };
      return el('section', { class: 'card stack' },
        el('div', { class: 'row' }, el('h3', {}, `🧾 ${crewName(j) ? crewName(j).split(' ')[0] + '’s' : 'Crew'} bills`), el('span', { class: 'spacer' }),
          el('span', { class: 'muted small' }, `${money(crewPaidOn(j))} paid of ${money(crewOwedTotal(j))}`)),
        bills.length ? el('div', { class: 'stack', style: 'gap:8px' }, ...bills.map((b) => {
          const date = el('input', { type: 'date', value: docs.todayKey(), 'aria-label': 'Date paid' });
          const how = el('select', { 'aria-label': 'How you paid' }, ...['Zelle', 'Check', 'Cash', 'Bank transfer (ACH)', 'Venmo', 'Cash App', 'Other'].map((m) => el('option', {}, m)));
          return el('div', { class: 'crew-bill' + (b.status === 'submitted' ? ' new' : '') },
            el('div', { class: 'row' }, el('b', { style: 'flex:1' }, `${b.label} · ${docs.usd(b.amount)}`), el('span', { class: `pill ${PILL[b.status][1]}` }, PILL[b.status][0])),
            el('div', { class: 'muted small' }, `Billed by ${b.by} · ${ago(b.at)}${b.paidDate ? ` · paid ${docs.fmtDate(b.paidDate)} (${b.paidMethod})` : ''}`),
            b.status === 'paid' ? el('div', { class: 'small ' + (lienOf(b) ? 'good-text' : 'muted') }, lienOf(b) ? `📝 Lien waiver signed${lienOf(b).name ? ' by ' + lienOf(b).name : ''}${lienOf(b).at ? ' · ' + docs.fmtDate(dayKey(lienOf(b).at)) : ''}` : '📝 Lien waiver not signed yet (they sign it in their login)') : null,
            b.note ? el('div', { class: 'small' }, `“${b.note}”`) : null,
            (() => { const inv = files.find((f) => f.billId === b.id && f.kind === 'invoice');
              return inv ? el('div', { class: 'small' }, '📄 Their invoice: ', inv.url ? el('a', { href: inv.url, target: '_blank', rel: 'noopener' }, inv.name) : inv.name) : null; })(),
            (() => { const pics = files.filter((f) => f.billId === b.id && f.kind !== 'invoice');
              return pics.length ? el('div', { class: 'photo-row bill-photos', style: 'flex-wrap:wrap' }, ...pics.map((f, i) => f.url && /^image\//.test(f.mime)
                ? el('a', { href: f.url, target: '_blank', rel: 'noopener' }, el('img', { src: f.url, alt: `${b.label} photo ${i + 1}` }))
                : el('span', { class: 'pill' }, '📎 ' + f.name)))
                : null; })(),
            b.status === 'declined' && b.reason ? el('div', { class: 'small bad-text' }, `Declined: ${b.reason}`) : null,
            b.status === 'submitted' ? el('div', { class: 'row' },
              el('button', { type: 'button', class: 'gold small', style: 'flex:1', onclick: act(b, 'approve') }, '✓ Approve'),
              el('button', { type: 'button', class: 'ghost small', style: 'flex:1', onclick: async (e) => { const reason = prompt('Why are you declining this bill? (The contractor sees this.)', ''); if (reason === null) return; await act(b, 'decline', () => ({ reason }))(e); } }, 'Decline')) : null,
            ['submitted', 'approved'].includes(b.status) ? el('div', { class: 'stack', style: 'gap:6px' }, el('div', { class: 'two' }, date, how),
              el('button', { type: 'button', class: 'ghost', onclick: act(b, 'paid', () => ({ date: date.value, method: how.value })) }, `💸 Mark paid · ${docs.usd(b.amount)}`)) : null);
        })) : el('p', { class: 'muted small' }, 'No bills yet. The contractor bills you from their job page as they finish each part (Payments tab → Crew pay schedule).'));
    })() : null;

    // Payment schedule: each payment, its invoice, and a button to make the next one.
    const plan = planOf(j);
    const due = nextDue(j);
    const invoiceStep = (p) => p.inv
      ? { icon: '🧾', title: `Finish and send the ${p.label.toLowerCase()} invoice`, why: `${p.inv.number} is saved as a draft. ${docs.usd(p.amount)}, payment ${p.index + 1} of ${plan.length}.`, act: ['Open the invoice', () => openDoc(j.id, p.inv.id)] }
      : { icon: '🧾', title: `Send the ${p.label.toLowerCase()} invoice: ${docs.usd(p.amount)}`, why: `Payment ${p.index + 1} of ${plan.length} on the schedule (${Number(p.pct)}%, ${p.whenLabel.toLowerCase()}).`,
        act: ['🧾 Create invoice', () => openDoc(j.id, null, 'invoice', null, { index: p.index })] };
    const scheduleCard = el('section', { class: 'card stack' },
      el('div', { class: 'row' }, el('h3', {}, '💵 Payment schedule'), el('span', { class: 'spacer' }),
        plan.length ? el('span', { class: 'muted small' }, `Job total ${docs.usd(jobTotal(j))}`) : null),
      plan.length ? el('ol', { class: 'sched-list' }, ...plan.map((p) => el('li', { class: p.due && (!p.covered || p.inv?.status === 'draft') ? 'due' : p.inv && docs.state(p.inv) === 'paid' ? 'paid' : '' },
        el('span', { class: 'n' }, p.inv && docs.state(p.inv) === 'paid' ? '✓' : String(p.index + 1)),
        el('span', { class: 'body' }, el('b', {}, p.label), el('span', { class: 'amt' }, docs.usd(p.amount)), el('span', { class: 'muted small' }, `${Number(p.pct)}% · ${p.whenLabel}`)),
        p.inv ? el('button', { type: 'button', class: `pill ${docs.pillClass(p.inv)}`, onclick: () => openDoc(j.id, p.inv.id) }, `${p.inv.number} · ${docs.label(p.inv)}`)
          : p.covered ? el('span', { class: 'muted small' }, 'Billed in full')
          : el('button', { type: 'button', class: (p.due ? 'gold' : 'ghost') + ' small', onclick: () => openDoc(j.id, null, 'invoice', null, { index: p.index }) }, p.due ? 'Create invoice' : p.when === 'stage' ? '✓ Done: invoice it' : 'Bill early'))))
        : el('p', { class: 'muted small' }, 'Once the job has a price (or an approved estimate), each payment shows up here with a button to invoice it.'),
      el('p', { class: 'muted small' }, isStaff ? 'Change the payments and percentages in the Payments tab → Payment schedule.' : 'The office sets the payments and percentages.'),
    );

    // Next step: one clear action based on where the job is.
    const sentEst = jobDocs.find((d) => d.type === 'estimate' && d.status === 'sent');
    const draftEst = jobDocs.find((d) => d.type === 'estimate' && d.status === 'draft');
    const invs = jobDocs.filter((d) => d.type === 'invoice' && d.status !== 'void');
    const draftInv = invs.find((d) => d.status === 'draft');
    const owedInv = invs.find((d) => docs.owed(d) > 0);
    const crewFirst = assigned ? assigned.name.split(' ')[0] : '';
    let step;
    if (j.status === 'lost') {
      step = { icon: '🚫', title: 'This job is closed (Not a fit).', act: ['Reopen as a new lead', () => update({ status: 'new' })], ghost: true };
    } else if (['new', 'qualifying'].includes(j.status) && !approvedEst && !sentEst && !draftEst) {
      // The heart of the business: price it on the phone first. Only a "yes" earns a rep visit.
      const quoteIn = el('input', { type: 'number', inputmode: 'decimal', min: '0', step: '1', placeholder: 'e.g. 3200', value: j.price ?? '', 'aria-label': 'Price you quoted' });
      const quoted = () => { const v = num(quoteIn.value); return v != null && v > 0 ? v : null; };
      const need = () => { errorBox.textContent = 'Enter the price you quoted first.'; errorBox.hidden = false; quoteIn.focus(); };
      const outcome = async (label, patch) => {
        try { await api.jobs.logCall(j.id, label, quoted() != null ? `Phone estimate ${money(quoted())}` : ''); await update(patch); }
        catch (err) { errorBox.textContent = err.message; errorBox.hidden = false; }
      };
      step = { icon: '📞', title: j.status === 'new' ? `Call ${first} with a phone estimate` : `Follow up with ${first}`,
        why: 'Go over the job, their photos and measurements, and give them a price. Only customers who agree to the numbers get a rep visit.',
        href: b.phone ? telHref(b.phone) : b.email ? `mailto:${b.email}` : null, label: b.phone ? `📞 Call ${first}` : `✉️ Email ${first}`,
        extra: el('div', { class: 'quote-box stack' },
          el('label', { class: 'field' }, 'Price you quoted on the phone', quoteIn),
          el('b', { class: 'small' }, 'What did they say?'),
          el('button', { type: 'button', class: 'gold block', onclick: () => { if (quoted() == null) return need(); outcome('Agreed to the price', { price: quoted(), status: 'hot' }); } }, '🔥 They agreed: make it a hot lead'),
          el('div', { class: 'row' },
            el('button', { type: 'button', class: 'ghost', style: 'flex:1', onclick: () => outcome('Thinking it over', { price: quoted(), status: 'qualifying' }) }, '🤔 Thinking it over'),
            el('button', { type: 'button', class: 'ghost', style: 'flex:1', onclick: () => { if (confirm(`Close ${jobNo(j)}? ${first} isn’t interested.`)) outcome('Not interested', { price: quoted(), status: 'lost' }); } }, '👎 Not interested'))),
        second: ['Prefer it in writing? Send an estimate they can approve in the app', () => openDoc(j.id, null, 'estimate')] };
    } else if (['new', 'qualifying'].includes(j.status) && !approvedEst) {
      if (sentEst) step = { icon: '⏳', title: `Waiting for ${first} to approve ${sentEst.number}`,
        why: j.hasAccount ? 'Once they approve it, the job becomes a hot lead. Nudge them with a text.' : `${first} doesn’t use the app. When they say yes, open the estimate and tap “Mark approved”.`,
        href: b.phone ? smsHref(b.phone, j.hasAccount
          ? `Hi ${first}, just checking in on estimate ${sentEst.number} from ${settings.name || 'Top Hat Contracting'}. You can view and approve it here: ${siteUrl()}#/jobs`
          : `Hi ${first}, just checking in on estimate ${sentEst.number} from ${settings.name || 'Top Hat Contracting'} (${docs.usd(docs.totals(sentEst).total)}). Reply YES to approve, or call us with any questions.`) : null,
        label: `💬 Remind ${first}`, second: ['Open the estimate', () => openDoc(j.id, sentEst.id)] };
      else step = { icon: '📝', title: `Finish and send estimate ${draftEst.number}`, why: 'It’s saved as a draft. The customer can’t see it yet.', act: ['Open the estimate', () => openDoc(j.id, draftEst.id)] };
    } else if (['new', 'qualifying'].includes(j.status) && approvedEst) {
      step = { icon: '✅', title: `${first} approved ${approvedEst.number}`, why: 'They agreed to the price. Make it a hot lead and book the rep visit.', act: ['🔥 Make it a hot lead', () => update({ status: 'hot' })] };
    } else if (j.status === 'hot') {
      // Book (or change) the rep visit.
      const repSel = isStaff ? el('select', { 'aria-label': 'Rep' }, el('option', { value: '' }, team.length ? '— Pick a rep —' : 'No sales reps yet'),
        ...team.filter((x) => x.active !== false || x.id === j.salesId).map((x) => el('option', { value: x.id, selected: x.id === j.salesId }, x.name))) : null;
      const visitIn = el('input', { type: 'datetime-local', value: j.visitAt || '', 'aria-label': 'Visit date and time' });
      // Who goes out for the walkthrough: a sales rep, or a contractor (owner's request).
      let who = j.visitContractorId ? 'crew' : 'rep';
      const visitCrewSel = el('select', { 'aria-label': 'Contractor for the visit' }, el('option', { value: '' }, '— Pick a contractor —'),
        ...crew.filter((c) => c.active || c.id === j.visitContractorId).sort((a, c) => (TH.doesTrade(c, j.trade) - TH.doesTrade(a, j.trade)) || a.name.localeCompare(c.name))
          .map((c) => el('option', { value: c.id, selected: c.id === j.visitContractorId, disabled: insuranceExpired(c.id) && c.id !== j.visitContractorId },
            `${TH.doesTrade(c, j.trade) ? '★ ' : ''}${c.name}${insuranceExpired(c.id) ? ' (insurance ran out)' : ''}${offTag(c.id, j.visitAt)}`)));
      const repField = repSel ? el('label', { class: 'field' }, 'Sales rep', repSel) : null;
      const crewField = el('label', { class: 'field' }, 'Contractor', el('span', { class: 'hint' }, 'They see the visit in their contractor login (time, address, customer, photos). Never prices.'), visitCrewSel);
      const whoChips = el('div', { class: 'stage-chips', role: 'radiogroup', 'aria-label': 'Who goes out' });
      const drawWho = () => {
        whoChips.replaceChildren(...[['rep', '💼 Sales rep'], ['crew', '👷 Contractor']].map(([id, label]) => el('button', { type: 'button', class: 'chip', role: 'radio', 'aria-checked': String(who === id), 'aria-pressed': String(who === id), onclick: () => { who = id; drawWho(); } }, label)));
        if (repField) repField.hidden = who !== 'rep'; crewField.hidden = who !== 'crew';
      };
      drawWho();
      visitIn.addEventListener('change', () => [...visitCrewSel.options].forEach((o) => { const c = crew.find((x) => x.id === o.value); if (c) o.textContent = `${TH.doesTrade(c, j.trade) ? '★ ' : ''}${c.name}${insuranceExpired(c.id) ? ' (insurance ran out)' : ''}${offTag(c.id, visitIn.value)}`; }));
      const visitForm = el('div', { class: 'quote-box stack', hidden: !!j.visitAt },
        el('b', { class: 'small' }, 'Who’s going out?'), whoChips,
        repField, crewField,
        el('label', { class: 'field' }, 'Visit date & time', el('span', { class: 'hint' }, 'Tap the box to pick the day and time.'), visitIn),
        el('button', { type: 'button', class: 'gold block', onclick: () => {
          if (!visitIn.value) { errorBox.textContent = 'Pick the date and time for the visit.'; errorBox.hidden = false; return; }
          if (who === 'crew' && !visitCrewSel.value) { errorBox.textContent = 'Pick the contractor who is going out.'; errorBox.hidden = false; return; }
          update({ visitAt: visitIn.value, visitContractorId: who === 'crew' ? visitCrewSel.value : null, ...(who === 'rep' && repSel ? { salesId: repSel.value || null } : {}) });
        } }, j.visitAt ? 'Save visit' : 'Book the visit'));
      const visitCrew = j.visitContractorId ? find(crew, j.visitContractorId) : null;
      const visitWho = visitCrew ? visitCrew.name : salesName(j.salesId);
      const repFirst = (visitWho || 'Your project manager').split(' ')[0];
      const visitText = j.visitAt && `Hi ${first}, this is ${settings.name || 'Top Hat Contracting'}. ${repFirst} will come out ${fmtWhen(j.visitAt)} to walk through your ${t.label.toLowerCase()} project at ${j.address}. Reply if that time doesn’t work.`;
      if (!j.visitAt) step = { icon: '🔥', title: 'Hot lead: book the visit', why: `${first} agreed to ${j.price != null ? money(j.price) : 'the price'}. Pick a sales rep or a contractor, and a time for the walkthrough.`, extra: visitForm };
      else if (!visitPassed(j)) step = { icon: '🤝', title: `Visit ${fmtWhen(j.visitAt)}`, why: `${visitWho ? visitWho + (visitCrew ? ' (contractor)' : '') : 'Nobody picked yet'} walks through the project with ${first}. Let them know the time.`,
        href: b.phone ? smsHref(b.phone, visitText) : null, label: `💬 Text ${first} the visit time`,
        extra: visitForm, second: ['Change the visit', () => { visitForm.hidden = !visitForm.hidden; }],
        third: ['Visit done: sold, pick crew & date', focusSetup] };
      else step = { icon: '✅', title: 'How did the visit go?', why: `If ${first} is ready to go, pick the crew and date. The crew never sees your prices.`,
        act: ['✅ Sold: pick crew & date', focusSetup], extra: visitForm,
        second: ['Didn’t close: mark it closed', async () => { if (!confirm(`Close ${jobNo(j)} as not sold?`)) return; try { await api.jobs.logCall(j.id, 'Didn’t close at the visit', ''); } catch {} update({ status: 'lost' }); }],
        third: ['Book another visit', () => { visitForm.hidden = !visitForm.hidden; }] };
    } else if (j.status === 'scheduled') {
      if (!assigned || !j.scheduledFor) step = { icon: '👷', title: 'Pick a crew and a date', act: ['Pick crew & date', focusSetup] };
      else if (j.crewResponse === 'declined') step = { icon: '🙅', title: `${crewFirst} can’t make it`, why: j.crewResponseNote ? `“${j.crewResponseNote}”` : 'Pick another crew or a new date.', act: ['Pick another crew or date', focusSetup] };
      else if (due) step = { ...invoiceStep(due), second: ['Work has started', () => update({ status: 'in_progress' })] };
      else if (j.stage === 'on_the_way') step = { icon: '🚚', title: `${crewFirst} is on the way`, why: 'They’ll mark the work started when they get there. You can too.', act: ['▶ Work has started', () => update({ status: 'in_progress' })] };
      else step = { icon: '📲', title: `Send the job to ${crewFirst}`, why: 'Texts them the date, address, customer phone, job details and photo link. Never prices.',
        href: assigned.phone ? smsHref(assigned.phone, dispatchText) : null, label: `💬 Text job to ${crewFirst}`, second: ['Work has started', () => update({ status: 'in_progress' })] };
    } else if (j.status === 'in_progress' && j.stage === 'waiting_parts') {
      step = { icon: '⏸', title: 'Paused: waiting on materials', why: 'Check the crew notes for what’s needed. Resume when the materials are in.', act: ['▶ Work resumed', () => update({ stage: null })] };
    } else if (j.status === 'in_progress' && j.stage === 'return_visit') {
      step = { icon: '🔁', title: 'Needs another visit', why: 'Set the date for the return visit, then let the customer know.', act: ['Pick the return date', focusSetup], second: ['Back to work (no visit needed)', () => update({ stage: null })] };
    } else if (j.status === 'in_progress' && due) {
      step = { ...invoiceStep(due), second: ['✓ Mark job finished', () => update({ status: 'completed' })] };
    } else if (j.status === 'in_progress' && plan.find((p) => p.when === 'stage' && !p.covered)) {
      const p = plan.find((x) => x.when === 'stage' && !x.covered);
      step = { icon: '🧱', title: `When ${p.label.toLowerCase()} is done, bill it`, why: `Payment ${p.index + 1} of ${plan.length}: ${docs.usd(p.amount)} (${Number(p.pct)}%), due upon completion of ${p.label.toLowerCase()}.`,
        act: ['🧾 Create invoice', () => openDoc(j.id, null, 'invoice', null, { index: p.index })], second: ['✓ Mark job finished', () => update({ status: 'completed' })] };
    } else if (j.status === 'in_progress') {
      step = { icon: '🔨', title: 'Work in progress', why: `${crewFirst || 'The crew'} can update progress from their crew login, or you can here.`, act: ['✓ Mark job finished', () => update({ status: 'completed' })] };
    } else if (j.status === 'completed') {
      if (due) step = invoiceStep(due);
      else if (owedInv) step = { icon: '💵', title: `Collect payment: ${docs.usd(docs.owed(owedInv))} due`, why: `Record it when ${first} pays: cash, check, Zelle, card, Venmo or Cash App.`, act: ['Record a payment', () => openDoc(j.id, owedInv.id)] };
      else if (draftInv) step = { icon: '🧾', title: `Finish and send invoice ${draftInv.number}`, act: ['Open the invoice', () => openDoc(j.id, draftInv.id)] };
      else if (!invs.length && !plan.length) step = { icon: '🧾', title: 'Job finished: send the invoice', why: invoiceBase ? `It starts from approved estimate ${invoiceBase.number}.` : 'Add the work and the total.', act: ['+ Create invoice', () => openDoc(j.id, null, 'invoice', invoiceBase)] };
      else if (!j.review?.requestedAt && !j.review?.rating) step = { icon: '⭐', title: `Paid in full. Ask ${first} for a review`, why: 'Happy customers bring the next ones. One tap opens a text with the link.', act: ['⭐ Ask for a review', () => reviewCard && reviewCard.querySelector('a.btn').click()] };
      else step = { icon: '🎉', title: 'All done: paid in full', why: j.review?.rating ? `${first} gave it ${'★'.repeat(j.review.rating)}.` : 'Nice work.' };
    }
    // Back one step, in case someone tapped the wrong thing.
    const ORDER = ['new', 'qualifying', 'hot', 'scheduled', 'in_progress', 'completed'];
    const backStep = j.stage
      ? { label: `Undo “${stageOf(j.stage).label}”`, patch: { stage: null } }
      : ORDER.indexOf(j.status) > 0 ? { label: `Back to ${statusOf(ORDER[ORDER.indexOf(j.status) - 1]).label}`, patch: { status: ORDER[ORDER.indexOf(j.status) - 1] } } : null;
    const backBtn = backStep ? el('button', { type: 'button', class: 'back-step', onclick: () => {
      if (confirm(`${backStep.label}?\n\n${jobNo(j)} goes back one step. Nothing else changes: invoices, notes and photos stay.`)) update(backStep.patch);
    } }, `← ${backStep.label}`) : null;
    const nextCard = step ? el('section', { class: 'card next-step' },
      el('span', { class: 'eyebrow' }, 'Next step'),
      el('div', { class: 'row', style: 'align-items:flex-start' }, el('span', { class: 'next-ic' }, step.icon),
        el('div', { style: 'flex:1;min-width:0' }, el('h3', {}, step.title), step.why ? el('p', { class: 'muted small' }, step.why) : null)),
      step.href ? el('a', { class: 'btn gold block', href: step.href }, step.label)
        : step.act ? el('button', { type: 'button', class: (step.ghost ? 'ghost' : 'gold') + ' block', onclick: step.act[1] }, step.act[0]) : null,
      step.extra || null,
      step.second ? el('button', { type: 'button', class: 'link', onclick: step.second[1] }, step.second[0]) : null,
      step.third ? el('button', { type: 'button', class: 'link', onclick: step.third[1] }, step.third[0]) : null,
      backBtn,
    ) : null;

    // Reviews: ask after the job; see what they said.
    const reviewText = `Hi ${first}, thanks for choosing ${settings.name || 'Top Hat Contracting'}! How did we do? You can rate your job here: ${siteUrl()}#/jobs${settings.reviewLink ? `\nOr leave us a Google review: ${settings.reviewLink}` : ''}`;
    const askHref = j.buyer.phone ? smsHref(j.buyer.phone, reviewText) : j.buyer.email ? `mailto:${j.buyer.email}?subject=${encodeURIComponent('How did we do?')}&body=${encodeURIComponent(reviewText)}` : null;
    const askBtn = (label, cls) => el('a', { class: `btn ${cls} block`, href: askHref || '#', onclick: async (e) => { if (!askHref) e.preventDefault(); try { await api.reviews.ask(j.id); } catch {} setTimeout(async () => { await load(); openLead(j.id); }, 400); } }, label);
    const reviewCard = j.review?.rating || paidUp(j) ? el('section', { class: 'card stack review-card' },
      el('h3', {}, '⭐ Customer review'),
      j.review?.rating ? [el('div', { class: 'stars-show', 'aria-label': `${j.review.rating} out of 5 stars` }, '★'.repeat(j.review.rating) + '☆'.repeat(5 - j.review.rating)),
        j.review.comment ? el('p', {}, `“${j.review.comment}”`) : null, el('p', { class: 'muted small' }, `${ago(j.review.at)}`)]
        : j.review?.requestedAt ? [el('p', { class: 'muted small' }, `Asked ${ago(j.review.requestedAt)} by ${j.review.requestedBy}. No rating yet.`), askBtn('⭐ Ask again', 'ghost')]
          : [el('p', { class: 'muted small' }, 'The job is finished. Ask the customer how it went: they can rate it in the app' + (settings.reviewLink ? ' and post a Google review.' : '.')), askBtn(`⭐ Ask ${first} for a review`, 'gold')]) : null;
    const materialsCard = j.status !== 'lost' ? TH.materialsCard(j, { mode: 'office', onChange: async () => { await load(); openLead(j.id); } }) : null;

    // ---------- office only: tasks & punch list, final walkthrough, expenses (CRM checklist 7.3, 7.7, 7.8, 11.3) ----------
    const recSave = async (kind, rec) => { try { await api.records.save(kind, rec, j.id); await load(); flashSaved(); openLead(j.id); } catch (err) { errorBox.textContent = err.message; errorBox.hidden = false; } };
    const recDel = async (id) => { try { await api.records.remove(id); await load(); openLead(j.id); } catch (err) { errorBox.textContent = err.message; errorBox.hidden = false; } };
    const taskList = (punch) => {
      const list = recs('task', j.id).filter((x) => !!x.punch === punch).sort((a, b) => (a.done - b.done) || a.at - b.at);
      const input = el('input', { placeholder: punch ? 'e.g. Touch up paint by the window' : 'e.g. Order cabinets', 'aria-label': punch ? 'New punch list item' : 'New task', maxlength: '200' });
      const add = () => input.value.trim() && recSave('task', { text: input.value.trim().slice(0, 200), punch, done: false });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
      return el('div', { class: 'stack', style: 'gap:6px' },
        el('b', {}, punch ? `🔧 Punch list (${list.filter((x) => !x.done).length} open)` : `✅ Tasks (${list.filter((x) => !x.done).length} to do)`),
        ...list.map((x) => el('div', { class: 'task-row' + (x.done ? ' done' : '') },
          el('input', { type: 'checkbox', checked: !!x.done, 'aria-label': x.text, onchange: (e) => recSave('task', { ...x, done: e.target.checked, doneBy: e.target.checked ? meUser.name : '', doneAt: e.target.checked ? Date.now() : null }) }),
          el('span', { style: 'flex:1' }, x.text, x.done && x.doneBy ? el('span', { class: 'muted small' }, ` · ${x.doneBy}`) : null),
          el('button', { type: 'button', class: 'link small', 'aria-label': `Remove ${x.text}`, onclick: () => recDel(x.id) }, '✕'))),
        el('div', { class: 'row', style: 'gap:6px' }, input, el('button', { type: 'button', class: 'ghost small', onclick: add }, 'Add')));
    };
    const openPunch = recs('task', j.id).filter((x) => x.punch && !x.done).length;
    const tasksCard = isStaff && j.status !== 'lost' ? el('section', { class: 'card stack' },
      el('h3', {}, '📋 Tasks & punch list'),
      el('p', { class: 'muted small', style: 'margin:0' }, 'Office only. Tasks are the steps to get the job done; the punch list is the small fixes before the final walkthrough.'),
      taskList(false), taskList(true)) : null;
    // Rate the contractor's work once the job is done (office only; averaged on the Team tab).
    const myReview = assigned ? recs('crew_review', j.id).find((x) => x.contractorId === assigned.id) : null;
    const rateCard = isStaff && assigned && j.status === 'completed' ? el('section', { class: 'card stack' },
      el('h3', {}, `⭐ Rate ${assigned.name}’s work`),
      el('div', { class: 'stage-chips' }, ...[1, 2, 3, 4, 5].map((n) => el('button', { type: 'button', class: 'chip', 'aria-pressed': String(myReview?.stars === n), 'aria-label': `${n} star${n === 1 ? '' : 's'}`,
        onclick: () => recSave('crew_review', { ...(myReview || {}), contractorId: assigned.id, stars: n, note: myReview?.note || '' }) }, '★'.repeat(n)))),
      el('input', { placeholder: 'Note (optional): on time, clean, quality…', maxlength: '200', value: myReview?.note || '', 'aria-label': 'Rating note',
        onchange: (e) => myReview && recSave('crew_review', { ...myReview, note: e.target.value }) }),
      el('p', { class: 'muted small', style: 'margin:0' }, 'Only the office sees ratings. The average shows on the contractor in Team → Contractors.')) : null;
    const walk = recs('walkthrough', j.id).at(-1);
    const walkArea = el('div', { class: 'stack' });
    const walkBtn = el('button', { type: 'button', class: 'gold', onclick: () => {
      walkArea.replaceChildren(docs.signaturePad({ name: b.name || '', title: 'Final walkthrough', submitLabel: `Sign for ${first === 'the customer' ? 'the customer' : first}`,
        agree: `By signing, the customer confirms they walked through the finished work on ${jobNo(j)} with us${openPunch ? ` and that ${openPunch} punch list item${openPunch === 1 ? ' is' : 's are'} still to be finished` : ' and it is complete'}.`,
        onCancel: () => walkArea.replaceChildren(walkBtn),
        onSign: async (sig) => recSave('walkthrough', { name: sig.name, image: sig.image, signedAt: Date.now(), witness: meUser.name, openPunch }) }));
      walkArea.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } }, '✍️ Final walkthrough: customer signs here');
    walkArea.append(walkBtn);
    const walkCard = isStaff && ['in_progress', 'completed'].includes(j.status) ? el('section', { class: 'card stack' },
      el('h3', {}, '🏁 Final walkthrough'),
      walk ? el('div', { class: 'stack', style: 'gap:6px' },
        el('p', { class: 'small good-text', style: 'margin:0' }, `✅ Signed by ${walk.name} on ${new Date(walk.signedAt || walk.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · with ${walk.witness}${walk.openPunch ? ` · ${walk.openPunch} punch item${walk.openPunch === 1 ? '' : 's'} open then` : ''}`),
        walk.image ? el('img', { src: walk.image, alt: `Signature of ${walk.name}`, class: 'sig-img' }) : null)
        : el('div', { class: 'stack' }, el('p', { class: 'muted small', style: 'margin:0' }, openPunch ? `⚠️ ${openPunch} punch list item${openPunch === 1 ? ' is' : 's are'} still open. You can still sign; it’s noted.` : 'Walk the finished job with the customer, then have them sign on your phone.'), walkArea)) : null;
    // Expenses on this job: materials, permits, dumpster… They come off the job's profit in the reports.
    const jobExp = recs('expense', j.id).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const expTotal = jobExp.reduce((t, x) => t + (Number(x.amount) || 0), 0);
    const expForm = el('form', { class: 'stack', style: 'gap:6px', onsubmit: async (e) => {
      e.preventDefault(); const f = new FormData(e.currentTarget);
      const amount = Number(f.get('amount')); if (!(amount > 0)) { errorBox.textContent = 'Enter the amount.'; errorBox.hidden = false; return; }
      let receipt = null; const file = f.get('receipt');
      if (file && file.size) { try { const m = await api.files.upload(j.id, file, 'receipt'); receipt = (m && m.name) || file.name; } catch (err) { errorBox.textContent = err.message; errorBox.hidden = false; return; } }
      recSave('expense', { date: f.get('date') || docs.todayKey(), category: f.get('category'), vendor: String(f.get('vendor') || '').trim().slice(0, 80), amount, note: String(f.get('note') || '').trim().slice(0, 200), receipt });
    } },
      el('div', { class: 'two' },
        el('label', { class: 'field' }, 'Amount ($)', el('input', { name: 'amount', type: 'number', inputmode: 'decimal', min: '0.01', step: '0.01', required: true })),
        el('label', { class: 'field' }, 'Category', el('select', { name: 'category' }, ...JOB_EXPENSE_CATS.map((c) => el('option', {}, c))))),
      el('div', { class: 'two' },
        el('label', { class: 'field' }, 'Paid to', el('input', { name: 'vendor', list: 'vendorList', placeholder: 'e.g. Home Depot' })),
        el('label', { class: 'field' }, 'Date', el('input', { name: 'date', type: 'date', value: docs.todayKey() }))),
      el('datalist', { id: 'vendorList' }, ...recs('vendor').map((v) => el('option', { value: v.name }))),
      el('label', { class: 'field' }, 'Note (optional)', el('input', { name: 'note', maxlength: '200' })),
      el('label', { class: 'field' }, 'Receipt photo (optional)', el('input', { name: 'receipt', type: 'file', accept: 'image/*,application/pdf' })),
      el('button', { type: 'submit', class: 'ghost' }, '+ Add expense'));
    const expensesCard = isStaff ? el('section', { class: 'card stack' },
      el('div', { class: 'row' }, el('h3', { style: 'flex:1' }, '💸 Job expenses'), el('b', {}, money(expTotal))),
      el('p', { class: 'muted small', style: 'margin:0' }, `Office only. Materials, permits, dumpster, rentals… ${j.price != null ? `Profit after crew pay and expenses: ${money(jobTotal(j) - crewOwedTotal(j) - expTotal)}.` : ''}`),
      ...jobExp.map((x) => el('div', { class: 'task-row' }, el('span', { style: 'flex:1' }, el('b', {}, `${money(Number(x.amount) || 0)} · ${x.category}`),
        el('span', { class: 'muted small', style: 'display:block' }, [docs.fmtDate(x.date), x.vendor, x.note, x.receipt ? '🧾 receipt in Files' : ''].filter(Boolean).join(' · '))),
        el('button', { type: 'button', class: 'link small', 'aria-label': 'Remove expense', onclick: () => confirm('Remove this expense?') && recDel(x.id) }, '✕'))),
      el('details', {}, el('summary', { class: 'small', style: 'cursor:pointer;font-weight:700' }, '+ Add an expense'), expForm)) : null;

    // The lead and what they asked for: in "The job" tab (owner: out of the summary at the top).
    const aboutCard = el('section', { class: 'card stack about-job' }, isStaff ? leadBox(j, update) : null, askedFor());

    // Tabs keep the job short and easy to scan.
    // Each section says what's inside, so it's clear where a tap leads.
    const TABS = [
      ['overview', '📋', 'The job', 'Next step, customer, crew & date'],
      ['money', '💵', 'Payments', isStaff ? 'Price, invoices & crew pay' : 'Price, estimates & invoices'],
      ['files', '📸', `Photos & papers${files.length ? ` (${files.length})` : ''}`, 'Pictures, estimates, permits'],
      ['history', '🗒️', 'Notes & timeline', 'Notes and everything that happened'],
    ];
    const tabsBar = el('div', { class: 'lead-tabs', role: 'tablist', 'aria-label': 'Job sections' });
    const tabBody = el('div', { class: 'stack' });
    function renderTab() {
      tabsBar.replaceChildren(...TABS.map(([id, icon, label, sub]) => el('button', { type: 'button', role: 'tab', 'data-tab': id, 'aria-selected': String(leadTab === id), 'aria-current': String(leadTab === id), onclick: () => { leadTab = id; renderTab(); } },
        el('span', { class: 'tab-ic', 'aria-hidden': 'true' }, icon), el('span', { class: 'tab-txt' }, el('b', {}, label), el('span', {}, sub)))));
      const content = {
        overview: [dreamFirst ? designCard : null, nextCard, aboutCard, walk || !['in_progress', 'completed'].includes(j.status) ? null : walkCard, isStaff && (LEAD_OPEN.includes(j.status) || needsReply(j)) ? convo : null, reviewCard, progress, isStaff && (LEAD_OPEN.includes(j.status) || needsReply(j)) ? null : convo, materialsCard, tasksCard, walk ? walkCard : null, rateCard, crewNotes.length ? crewNotesCard() : null, setupWanted ? setup : null, dreamFirst ? null : designCard, permitCard,
          !setupWanted && ['new', 'qualifying', 'hot'].includes(j.status) ? el('button', { type: 'button', class: 'link small', style: 'align-self:flex-start', onclick: focusSetup }, '👷 Assign a contractor & date now (skip the visit)') : null],
        money: [scheduleCard, crewBillsCard, docsCard, moneyCard, expensesCard],
        files: [filesCard],
        history: [notesCard, crewNotesCard(), log],
      }[leadTab] || [];
      tabBody.replaceChildren(...content.filter(Boolean));
    }
    renderTab();

    const panel = el('div', { class: 'panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Job ${jobNo(j)}: ${b.name}` },
      el('div', { class: 'panel-head' },
        el('button', { class: 'ghost small', onclick: close, 'aria-label': 'Close' }, '← Back'),
        el('b', { style: 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, `${jobNo(j)} · ${t.icon} ${t.label}`),
        el('span', { class: `pill s-${j.status}` }, statusOf(j.status).label)),
      el('div', { class: 'panel-body' }, errorBox, summary, tabsBar, tabBody),
    );
    const scroll = drawerRoot.querySelector('.panel')?.scrollTop || 0;
    drawerRoot.replaceChildren(el('div', { class: 'drawer', onclick: (e) => { if (e.target === e.currentTarget) close(); } }, panel));
    panel.scrollTop = scroll;
    document.body.style.overflow = 'hidden';
  }


  /* ---------- folders & records: everything for one customer, salesperson or contractor ---------- */
  const digitsOnly = (v) => String(v || '').replace(/\D/g, '');
  // Same person across jobs: their app account, or (for phone-in customers) their phone, then email, then name.
  const customerKey = (j) => j.buyerId ? 'u:' + j.buyerId : digitsOnly(j.buyer.phone).length >= 10 ? 'p:' + digitsOnly(j.buyer.phone).slice(-10)
    : j.buyer.email ? 'e:' + j.buyer.email.toLowerCase() : 'n:' + (j.buyer.name || '').trim().toLowerCase();
  const jobsOfCustomer = (key) => jobs.filter((j) => customerKey(j) === key).sort((a, b) => b.created - a.created);
  const paidOn = (j) => liveInvoices(j).reduce((t, d) => t + docs.totals(d).paid, 0);
  const billedOn = (j) => liveInvoices(j).filter((d) => d.status !== 'draft').reduce((t, d) => t + docs.totals(d).total, 0);
  const dateOf = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '');
  const jobRows = (list, { pay = isStaff } = {}) => [
    ['Job #', 'Created', 'Customer', 'Phone', 'Email', 'Address', 'State', 'ZIP', 'Type of work', 'Status', 'Salesperson', 'Contractor', 'Scheduled', 'Finished',
      'Job total', 'Invoiced', 'Paid', 'Owed', ...(pay ? ['Crew pay', 'Crew paid on', 'Crew paid by'] : [])],
    ...list.map((j) => [jobNo(j), dateOf(j.created), j.buyer.name, j.buyer.phone, j.buyer.email, j.address, j.state || '', j.zip, tradeOf(j.trade).label, statusOf(j.status).label,
      salesName(j.salesId) || '', crewName(j) || '', (j.scheduledFor || '').replace('T', ' '), dateOf(j.finishedAt),
      jobTotal(j) || '', billedOn(j) || '', paidOn(j) || '', owedOn(j) || '', ...(pay ? [j.crewPay ?? '', j.crewPaid?.date || '', j.crewPaid?.method || ''] : [])]),
  ];
  const fileSafe = (s) => String(s || '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'records';
  const downloadJobs = (list, name, opts) => TH.download(`${fileSafe(name)}-${docs.todayKey()}.csv`, TH.csv(jobRows(list, opts)));
  const folderSection = (title, list, empty) => el('section', { class: 'card stack' },
    el('div', { class: 'row' }, el('h3', {}, title), el('span', { class: 'spacer' }), el('span', { class: 'pill' }, String(list.length))),
    list.length ? el('div', { class: 'leads' }, ...list.map(leadCard)) : el('p', { class: 'muted small' }, empty));
  const kpiRow = (pairs) => el('div', { class: 'kpis three' }, ...pairs.map(([v, k]) => el('div', { class: 'kpi' }, el('b', {}, String(v)), el('span', {}, k))));
  function drawer(title, body, back = closeDrawer) {
    releaseUrls();
    const panel = el('div', { class: 'panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      el('div', { class: 'panel-head' }, el('button', { class: 'ghost small', onclick: back }, '← Back'), el('b', { style: 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, title)),
      el('div', { class: 'panel-body' }, ...body.filter(Boolean)));
    drawerRoot.replaceChildren(el('div', { class: 'drawer', onclick: (e) => { if (e.target === e.currentTarget) closeDrawer(); } }, panel));
    document.body.style.overflow = 'hidden';
  }

  // One customer's folder: every job they've had, what they've paid, what they owe.
  function openCustomer(key) {
    const list = jobsOfCustomer(key);
    if (!list.length) return;
    const b = list[0].buyer;
    const first = (b.name || '').split(' ')[0] || 'them';
    const active = list.filter((j) => !['completed', 'lost'].includes(j.status));
    const done = list.filter((j) => j.status === 'completed');
    const closed = list.filter((j) => j.status === 'lost');
    const sum = (f) => list.reduce((t, j) => t + f(j), 0);
    const printRecord = () => docs.viewSheet(el('article', { class: 'doc-sheet permit-sheet' },
      el('header', { class: 'doc-head' }, el('div', { class: 'doc-co' }, el('img', { class: 'doc-logo-img', src: 'img/logo.jpg', alt: '' }), el('div', { class: 'doc-logo' }, el('b', {}, settings.name || 'Top Hat Contracting'))),
        el('div', { class: 'doc-title' }, el('h1', {}, 'Customer record'), el('dl', {}, el('dt', {}, 'Printed'), el('dd', {}, docs.fmtDate(Date.now()))))),
      el('section', { class: 'doc-notes' }, el('h4', {}, 'Customer'), el('div', {}, b.name), ...[b.phone, b.email].filter(Boolean).map((x) => el('div', {}, x))),
      el('table', { class: 'doc-items' }, el('thead', {}, el('tr', {}, ...['Job', 'Date', 'Work', 'Status', 'Total', 'Paid'].map((h, i) => el('th', { class: i > 3 ? 'num' : '' }, h)))),
        el('tbody', {}, ...list.map((j) => el('tr', {}, el('td', {}, jobNo(j)), el('td', {}, docs.fmtDate(j.created)), el('td', {}, `${tradeOf(j.trade).label}, ${j.address}`),
          el('td', {}, statusOf(j.status).label), el('td', { class: 'num' }, jobTotal(j) ? docs.usd(jobTotal(j)) : '—'), el('td', { class: 'num' }, paidOn(j) ? docs.usd(paidOn(j)) : '—'))))),
      el('div', { class: 'doc-totals' }, el('dl', {}, el('dt', {}, 'Paid'), el('dd', {}, docs.usd(sum(paidOn))), el('dt', { class: 'big' }, 'Owed'), el('dd', { class: 'big' }, docs.usd(sum(owedOn))))),
      el('footer', { class: 'doc-foot' }, `${settings.name || 'Top Hat Contracting'} · Customer record`)), `Customer record: ${b.name}`);
    drawer(`📁 ${b.name}`, [
      el('section', { class: 'card stack' },
        el('div', { class: 'row' }, el('span', { class: 'avatar' }, initials(b.name || '?')),
          el('div', { style: 'flex:1;min-width:0' }, el('h2', {}, b.name), el('p', { class: 'muted small' }, [b.phone, b.email].filter(Boolean).join(' · ') || 'No contact info'))),
        el('div', { class: 'contact' },
          b.phone ? el('a', { class: 'btn ghost small', href: telHref(b.phone) }, '📞 Call') : null,
          b.phone ? el('a', { class: 'btn ghost small', href: smsHref(b.phone) }, '💬 Text') : null,
          b.email ? el('a', { class: 'btn ghost small', href: `mailto:${b.email}` }, '✉️ Email') : null),
        kpiRow([[list.length, `Job${list.length === 1 ? '' : 's'}`], [money(sum((j) => (j.status === 'lost' ? 0 : jobTotal(j)))), 'Total work'], [money(sum(paidOn)), 'Paid'],
          [money(sum(owedOn)), 'Owed'], [active.length, 'Active'], [done.length, 'Done']]),
        el('div', { class: 'row', style: 'flex-wrap:wrap' },
          el('button', { type: 'button', class: 'ghost small', onclick: () => newJobForm({ name: b.name, phone: b.phone, email: b.email }) }, `+ New job for ${first}`),
          el('button', { type: 'button', class: 'ghost small', onclick: printRecord }, '🖨 Print record'),
          el('button', { type: 'button', class: 'ghost small', onclick: () => downloadJobs(list, b.name) }, '⬇ Spreadsheet'))),
      folderSection('Active', active, 'Nothing in progress.'),
      folderSection('Done', done, 'No finished jobs yet.'),
      closed.length ? folderSection('Closed', closed, '') : null,
    ]);
  }

  // Every customer, with their folder one tap away.
  function customersList() {
    const map = new Map();
    jobs.forEach((j) => { const k = customerKey(j); const c = map.get(k) || { key: k, b: j.buyer, jobs: [], last: 0 }; c.jobs.push(j); c.last = Math.max(c.last, j.created); map.set(k, c); });
    const all = [...map.values()].sort((a, b) => b.last - a.last);
    const listWrap = el('div', { class: 'leads' });
    const search = el('input', { type: 'search', placeholder: 'Search name, phone, email…', 'aria-label': 'Search customers', oninput: () => draw() });
    // A customer's state: the state of their most recent job.
    all.forEach((c) => { c.state = (c.jobs.slice().sort((a, b) => b.created - a.created).find((j) => j.state) || {}).state || ''; });
    const stSel = el('select', { 'aria-label': 'State', onchange: () => { stateFilter = stSel.value; draw(); } },
      el('option', { value: '' }, `🗺 All states (${all.length})`),
      ...statesIn(all, (c) => c.state).map(([c, n]) => el('option', { value: c || 'none', selected: stateFilter === (c || 'none') }, `${c ? TH.stateName(c) : 'No state set'} (${n})`)));
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      const sf = usableState(statesIn(all, (c) => c.state));
      const shown = all.filter((c) => (!sf || (sf === 'none' ? !c.state : c.state === sf))
        && (!q || [c.b.name, c.b.phone, c.b.email, c.state, TH.stateName(c.state)].join(' ').toLowerCase().includes(q)));
      listWrap.replaceChildren(...(shown.length ? shown.map((c) => {
        const owed = c.jobs.reduce((t, j) => t + owedOn(j), 0);
        const open = c.jobs.filter((j) => !['completed', 'lost'].includes(j.status)).length;
        return el('button', { class: 'lead', onclick: () => openCustomer(c.key) },
          el('span', { class: 'ic' }, '📁'),
          el('span', { class: 'body' },
            el('span', { class: 'line1' }, el('b', {}, c.b.name || 'Unknown'), el('span', { class: 'spacer' }), el('span', { class: 'pill' }, `${c.jobs.length} job${c.jobs.length === 1 ? '' : 's'}`)),
            el('span', { class: 'muted small' }, [c.state ? TH.stateName(c.state) : null, c.b.phone, open ? `${open} active` : 'nothing active', `last ${ago(c.last)}`].filter(Boolean).join(' · ')),
            owed > 0 ? el('span', { class: 'flags' }, el('span', { class: 'flag hot' }, `💵 ${docs.usd(owed)} owed`)) : null));
      }) : [el('div', { class: 'card muted' }, 'No customers match.')]));
    };
    draw();
    drawer(`📁 Customers (${all.length})`, [
      el('p', { class: 'muted small' }, 'Every customer has a folder with all their jobs: active, done and closed, with what they’ve paid.'),
      stSel, search, listWrap]);
  }

  /* ---------- design studio for a job (office, or a rep with the customer) ---------- */
  function openStudio(j) {
    releaseUrls();
    const panel = el('div', { class: 'panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Design studio for ${jobNo(j)}` },
      el('div', { class: 'panel-head' },
        el('button', { class: 'ghost small', onclick: async () => { await load(); openLead(j.id); } }, `← ${jobNo(j)}`),
        el('b', { style: 'flex:1' }, '🎨 Design studio')),
      el('div', { class: 'panel-body' }, TH.studio({ jobId: j.id, trade: j.trade, photos: j.photos || [], canConnect: isStaff, styleLabel: TH.styleOf(j.style)?.label || '' })));
    drawerRoot.replaceChildren(el('div', { class: 'drawer' }, panel));
    document.body.style.overflow = 'hidden';
  }

  /* ---------- building permit packet: everything the town's application asks for ---------- */
  function permitPacket(j, chosen) {
    const b = j.buyer;
    const est = approvedEstOf(j);
    const value = jobTotal(j);
    const pm = j.permit || {};
    const row = (k, v) => [el('dt', {}, k), el('dd', {}, v || '—')];
    const sheet = el('article', { class: 'doc-sheet permit-sheet' },
      el('header', { class: 'doc-head' },
        el('div', { class: 'doc-co' }, el('img', { class: 'doc-logo-img', src: 'img/logo.jpg', alt: '' }), el('div', { class: 'doc-logo' }, el('b', {}, settings.name || 'Top Hat Contracting'))),
        el('div', { class: 'doc-title' }, el('h1', {}, 'Building permit'), el('dl', {}, ...row('Packet date', docs.fmtDate(Date.now())), ...row('Job', jobNo(j))))),
      el('section', { class: 'doc-notes' }, el('h4', {}, 'Property'), el('dl', { class: 'dl' },
        ...row('Address', addrOf(j)), ...row('Building department', TH.placeOf(j.address)),
        ...row('Department website', pm.portalUrl || (settings.permitPortals || {})[TH.placeOf(j.address).toLowerCase()]))),
      el('section', { class: 'doc-notes' }, el('h4', {}, 'Owner'), el('dl', { class: 'dl' }, ...row('Name', b.name), ...row('Phone', b.phone), ...row('Email', b.email))),
      el('section', { class: 'doc-notes' }, el('h4', {}, 'Contractor'), el('dl', { class: 'dl' },
        ...row('Company', settings.name || 'Top Hat Contracting'), ...row('License #', settings.license), ...row('Phone', settings.phone), ...row('Email', settings.email), ...row('Address', settings.address))),
      el('section', { class: 'doc-notes' }, el('h4', {}, 'Scope of work'), el('dl', { class: 'dl' },
        ...row('Type of work', tradeOf(j.trade).label), ...row('Estimated job value', value ? docs.usd(value) + (est ? ` (estimate ${est.number})` : '') : ''),
        ...row('Planned start', j.scheduledFor ? fmtWhen(j.scheduledFor) : ''), ...row('Permit #', pm.number)),
        el('p', { style: 'white-space:pre-wrap' }, j.description),
        est ? el('ul', {}, ...est.items.filter((i) => i.desc).map((i) => el('li', {}, i.desc))) : null),
      chosen?.url ? el('section', { class: 'doc-notes' }, el('h4', {}, 'Design the owner picked (illustration)'), el('img', { class: 'permit-design', src: chosen.url, alt: '' })) : null,
      el('section', { class: 'doc-notes' }, el('h4', {}, 'Owner authorization'),
        el('p', {}, `I authorize ${settings.name || 'Top Hat Contracting'} to apply for the building permit for the work above at my property, and to act for me with the building department on this permit.`),
        pm.authorizedAt ? el('p', {}, el('b', {}, `Signed electronically: ${pm.authorizedBy}`), ` · ${new Date(pm.authorizedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} (in the Top Hat app)`)
          : el('div', { class: 'sign-lines' }, el('div', {}, 'Owner signature'), el('div', {}, 'Printed name'), el('div', {}, 'Date'))),
      el('section', { class: 'doc-notes' }, el('h4', {}, 'Usually needed with the application'),
        el('ul', {}, ...['Site plan or drawing of the work (with measurements)', 'Contractor license and proof of insurance', 'Signed estimate or contract', 'Photos of the existing space', 'Product or material specs (e.g. cabinets, windows, roofing)'].map((x) => el('li', {}, '☐ ' + x)))),
      el('footer', { class: 'doc-foot' }, `${settings.name || 'Top Hat Contracting'} · Permit packet for ${jobNo(j)}`),
    );
    docs.viewSheet(sheet, `Permit packet ${jobNo(j)}`);
  }

  /* ---------- office enters a new job (phone call, walk-in…) ---------- */
  function newJobForm(pre = {}) {
    // Customers who already have an app account (so the job shows on their My jobs page).
    const accounts = [...new Map(jobs.filter((j) => j.hasAccount && j.buyerId).map((j) => [j.buyerId, { id: j.buyerId, ...j.buyer }])).values()];
    const digitsOf = (v) => String(v || '').replace(/\D/g, '');
    const errorBox = el('div', { class: 'error', hidden: true, role: 'alert' });
    const nameIn = el('input', { name: 'name', autocomplete: 'off', required: true, value: pre.name || '' });
    const phoneIn = el('input', { name: 'phone', type: 'tel', inputmode: 'tel', autocomplete: 'off', placeholder: '(555) 123-4567', value: pre.phone || '' });
    const emailIn = el('input', { name: 'email', type: 'email', inputmode: 'email', autocomplete: 'off', placeholder: 'Optional', value: pre.email || '' });
    const matchBox = el('div');
    let match = null;
    const findMatch = () => {
      const ph = digitsOf(phoneIn.value), em = emailIn.value.trim().toLowerCase();
      match = accounts.find((a) => (ph.length >= 10 && digitsOf(a.phone) === ph) || (em && a.email.toLowerCase() === em)) || null;
      matchBox.replaceChildren(...(match ? [el('label', { class: 'match-box' },
        el('input', { type: 'checkbox', name: 'useAccount', checked: true }),
        el('span', {}, el('b', {}, `Existing customer: ${match.name}`), el('span', { class: 'muted small', style: 'display:block' }, 'Add this job to their account so they see it in My jobs.')))] : []));
      if (match && !nameIn.value.trim()) nameIn.value = match.name;
    };
    phoneIn.addEventListener('input', findMatch);
    if (pre.phone || pre.email) findMatch();
    emailIn.addEventListener('input', findMatch);

    const sortedCrew = crew.filter((c) => c.active).sort((a, b) => a.name.localeCompare(b.name));
    const tradeSel = el('select', { name: 'trade', onchange: () => {
      const tr = tradeSel.value;
      [...crewSel.options].forEach((o) => { const c = crew.find((x) => x.id === o.value); if (c) o.textContent = `${TH.doesTrade(c, tr) ? '★ ' : ''}${c.name}`; });
    } }, ...TRADES.map((t) => el('option', { value: t.id }, `${t.icon} ${t.label}`)));
    const crewSel = el('select', { name: 'contractorId' }, el('option', { value: '' }, '— Decide later —'),
      ...sortedCrew.map((c) => el('option', { value: c.id, disabled: insuranceExpired(c.id) }, `${TH.doesTrade(c, TRADES[0].id) ? '★ ' : ''}${c.name}${insuranceExpired(c.id) ? ' (insurance ran out)' : ''}`)));

    const form = el('form', { class: 'panel-body', novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        const id = await api.jobs.createForCustomer({
          customerId: match && f.get('useAccount') === 'on' ? match.id : null,
          name: f.get('name'), phone: f.get('phone'), email: f.get('email'),
          salesId: f.get('salesId') || null,
          trade: f.get('trade'), description: f.get('description'), address: f.get('address'), zip: f.get('zip'), state: f.get('state'),
          timeframe: f.get('timeframe'), contractorId: f.get('contractorId') || null, scheduledFor: f.get('scheduledFor') || null,
          price: num(f.get('price')), agreed: f.get('agreed') === 'on',
          source: f.get('source'), homeowner: f.get('homeowner') === 'yes' ? true : f.get('homeowner') === 'no' ? false : null, decisionMakers: f.get('decisionMakers'),
        });
        await load();
        openLead(id, 'overview');
      } catch (err) { errorBox.textContent = err.message; errorBox.hidden = false; errorBox.scrollIntoView({ block: 'center' }); btn.disabled = false; }
    } },
      errorBox,
      el('section', { class: 'card stack' },
        el('h3', {}, '1. Customer'),
        el('label', { class: 'field' }, 'Name', nameIn),
        el('div', { class: 'two' }, el('label', { class: 'field' }, 'Phone', phoneIn), el('label', { class: 'field' }, 'Email', emailIn)),
        matchBox,
        !isStaff ? null : el('div', { class: 'two' },
          el('label', { class: 'field' }, 'Where did they find us?', el('select', { name: 'source' }, ...TH.LEAD_SOURCES.map((x) => el('option', { value: x.id, selected: x.id === (pre.source || 'phone') }, x.label)))),
          el('label', { class: 'field' }, 'Homeowner?', el('select', { name: 'homeowner' }, el('option', { value: '' }, 'Didn’t ask'), el('option', { value: 'yes' }, 'Yes'), el('option', { value: 'no' }, 'No (renter / other)')))),
        !isStaff ? null : el('label', { class: 'field' }, 'Who decides', el('input', { name: 'decisionMakers', maxlength: '200', autocomplete: 'off', placeholder: 'Optional, e.g. husband and wife together' }))),
      el('section', { class: 'card stack' },
        el('h3', {}, '2. The job'),
        el('label', { class: 'field' }, 'Type of work', tradeSel),
        el('label', { class: 'field' }, 'What needs to be done', el('textarea', { name: 'description', rows: 3, placeholder: 'e.g. Replace water heater in garage. 40 gal gas.' })),
        el('div', { class: 'two' },
          el('label', { class: 'field', style: 'grid-column:1/-1' }, 'Address', el('input', { name: 'address', autocomplete: 'off', placeholder: 'Street, city' })),
          el('label', { class: 'field' }, 'ZIP', el('input', { name: 'zip', inputmode: 'numeric', maxlength: '5', autocomplete: 'off',
            oninput: (e) => { const st = form.querySelector('select[name=state]'); const g = TH.stateFromZip(e.target.value); if (g && !st.dataset.picked) st.value = g; } })),
          el('label', { class: 'field' }, 'State', el('select', { name: 'state', onchange: (e) => { e.target.dataset.picked = '1'; } }, ...stateOptions(''))),
          el('label', { class: 'field' }, 'Needed', el('select', { name: 'timeframe' }, ...TIMEFRAMES.map((t) => el('option', { value: t.id }, t.label)))))),
      el('section', { class: 'card stack' },
        el('h3', {}, '3. Phone estimate ', el('span', { class: 'muted small', style: 'font-weight:400' }, '(if you gave one)')),
        el('label', { class: 'field' }, 'Price you quoted', el('input', { name: 'price', type: 'number', inputmode: 'decimal', min: '0', step: '1', placeholder: 'e.g. 3200' })),
        el('label', { class: 'match-box' }, el('input', { type: 'checkbox', name: 'agreed' }),
          el('span', {}, el('b', {}, '🔥 They agreed to this price'), el('span', { class: 'muted small', style: 'display:block' }, 'Makes it a hot lead, ready for a rep visit.')))),
      isStaff && team.length ? el('section', { class: 'card stack' },
        el('h3', {}, 'Sales rep ', el('span', { class: 'muted small', style: 'font-weight:400' }, '(optional)')),
        el('select', { name: 'salesId' }, el('option', { value: '' }, '— None —'), ...team.filter((x) => x.active !== false).map((x) => el('option', { value: x.id }, x.name)))) : null,
      el('section', { class: 'card stack' },
        el('h3', {}, '4. Crew & date ', el('span', { class: 'muted small', style: 'font-weight:400' }, '(only if it’s already sold)')),
        el('p', { class: 'muted small' }, 'Usually you’ll do this after the rep visit. Pick both and the job is scheduled right away.'),
        el('label', { class: 'field' }, 'Crew', el('span', { class: 'hint' }, '★ = does this kind of work'), crewSel),
        el('label', { class: 'field' }, 'Date & time', el('input', { name: 'scheduledFor', type: 'datetime-local' }))),
      el('button', { type: 'submit', class: 'gold block' }, 'Create job'),
    );
    drawerRoot.replaceChildren(el('div', { class: 'drawer', onclick: (e) => { if (e.target === e.currentTarget) closeDrawer(); } },
      el('div', { class: 'panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'New job' },
        el('div', { class: 'panel-head' }, el('button', { class: 'ghost small', onclick: closeDrawer }, '← Cancel'), el('b', {}, 'New job')),
        form)));
    document.body.style.overflow = 'hidden';
    nameIn.focus();
  }

  /* ---------- estimate / invoice editor ---------- */
  async function openDoc(jobId, docId, type, fromEstimate, sched, opts = {}) {
    const j = jobs.find((x) => x.id === jobId);
    if (!j) return;
    const t = tradeOf(j.trade);
    const list = await api.docs.list(jobId);
    let doc = docId && list.find((x) => x.id === docId);
    if (!doc) {
      const firstOfType = !list.some((x) => x.type === type);
      doc = {
        type, status: 'new', payments: [], number: type === 'invoice' ? 'New invoice' : 'New estimate',
        items: fromEstimate ? fromEstimate.items.map((i) => ({ ...i })) : [{ desc: `${t.label}: ${j.description}`.slice(0, 300), qty: 1, price: firstOfType && j.price ? j.price : '' }],
        taxRate: fromEstimate ? fromEstimate.taxRate : (Number(settings.taxRate) || 0),
        notes: type === 'invoice' ? (settings.invoiceTerms || '') : (settings.estimateTerms || ''),
        dueDate: type === 'invoice' ? addDays(Number(settings.dueDays) || 14) : null,
        payLink: '', fromEstimateId: fromEstimate ? fromEstimate.id : null,
      };
      if (opts.changeOrder && type === 'estimate') Object.assign(doc, { changeOrder: true, number: 'New change order', items: [{ desc: '', qty: 1, price: '' }],
        notes: 'Extra work the customer asked for. Once approved, this amount is added to the job total and billed with the remaining payments.' });
      const p = sched && planOf(j)[sched.index];
      if (p) {
        const est = approvedEstOf(j);
        Object.assign(doc, {
          number: `New ${p.label.toLowerCase()} invoice`, scheduleStep: p.index, scheduleBase: jobTotal(j), taxRate: 0, fromEstimateId: est ? est.id : null,
          items: [{ desc: `${p.label}: ${Number(p.pct)}% of ${docs.usd(jobTotal(j))}${est ? ` (estimate ${est.number})` : ''}\n${t.label} at ${j.address}`, qty: 1, price: p.amount }],
        });
      }
    }
    type = doc.type;
    const isInv = type === 'invoice';
    const isNew = doc.status === 'new';
    const canEdit = isNew || docs.editable(doc);
    const errorBox = el('div', { class: 'error', hidden: true, role: 'alert' });
    const fail = (err) => { errorBox.textContent = err.message; errorBox.hidden = false; errorBox.scrollIntoView({ block: 'center' }); };
    const reopen = async (id) => { await load(); openDoc(jobId, id); };

    const items = (doc.items || []).map((i) => ({ ...i }));
    // Office only: your cost on each line (never printed or shown to the customer or sales), kept beside the estimate.
    const showCost = isStaff && type === 'estimate';
    const costRec = showCost && doc.id ? recs('est_cost').find((r) => r.docId === doc.id) : null;
    if (showCost) items.forEach((it, i) => { if (it.cost == null) it.cost = costRec?.costs?.[i] ?? ''; });
    const taxInput = el('input', { type: 'number', inputmode: 'decimal', min: '0', step: '0.01', value: doc.taxRate ?? 0, disabled: !canEdit, oninput: () => renderTotals() });
    const notesInput = el('textarea', { rows: 3, value: doc.notes || '', disabled: !canEdit });
    const dueInput = isInv ? el('input', { type: 'date', value: doc.dueDate || '', disabled: !canEdit }) : null;
    const linkInput = isInv ? el('input', { type: 'url', inputmode: 'url', placeholder: 'https://square.link/… (optional)', value: doc.payLink || '', disabled: !canEdit }) : null;
    const current = () => ({ ...doc, items, taxRate: Number(taxInput.value) || 0, notes: notesInput.value, dueDate: dueInput ? dueInput.value || null : null, payLink: linkInput ? linkInput.value : '' });

    const totalsBox = el('dl', { class: 'tot' });
    function renderTotals() {
      const tt = docs.totals(current());
      totalsBox.replaceChildren(...[
        el('dt', {}, 'Subtotal'), el('dd', {}, docs.usd(tt.subtotal)),
        el('dt', {}, 'Tax'), el('dd', {}, docs.usd(tt.tax)),
        el('dt', { class: 'big' }, 'Total'), el('dd', { class: 'big' }, docs.usd(tt.total)),
        isInv && tt.paid ? el('dt', {}, 'Paid') : null, isInv && tt.paid ? el('dd', {}, docs.usd(tt.paid)) : null,
        isInv && !isNew ? el('dt', { class: 'big' }, 'Balance due') : null, isInv && !isNew ? el('dd', { class: 'big' }, docs.usd(Math.max(0, tt.balance))) : null].filter(Boolean));
      if (showCost) {
        const cost = items.reduce((t, i) => t + (Number(i.qty) || 0) * (Number(i.cost) || 0), 0);
        marginBox.textContent = cost ? `🔒 Office only · your cost ${docs.usd(cost)} · profit ${docs.usd(tt.subtotal - cost)} · margin ${tt.subtotal ? Math.round((tt.subtotal - cost) / tt.subtotal * 100) : 0}% · markup ${Math.round((tt.subtotal - cost) / cost * 100)}%`
          : '🔒 Office only: add your cost on each line to see the profit and margin.';
      }
    }
    const marginBox = el('p', { class: 'small margin-box' });
    const itemsWrap = el('div', { class: 'items-edit' });
    function renderItems() {
      itemsWrap.replaceChildren(...[...items.map((it, idx) => {
        const amt = el('span', { class: 'amt' });
        const upd = () => { amt.textContent = docs.usd((Number(it.qty) || 0) * (Number(it.price) || 0)); renderTotals(); };
        upd();
        return el('div', { class: 'item-row' },
          el('textarea', { rows: 2, placeholder: 'Description, e.g. Labor, Materials, Haul-away…', value: it.desc || '', disabled: !canEdit, 'aria-label': `Line ${idx + 1} description`, oninput: (e) => { it.desc = e.target.value; } }),
          el('div', { class: 'item-nums' },
            el('label', {}, 'Qty', el('input', { type: 'number', inputmode: 'decimal', min: '0', step: 'any', value: it.qty, disabled: !canEdit, oninput: (e) => { it.qty = e.target.value; upd(); } })),
            el('label', {}, 'Price ($)', el('input', { type: 'number', inputmode: 'decimal', min: '0', step: '0.01', value: it.price, disabled: !canEdit, oninput: (e) => { it.price = e.target.value; upd(); } })),
            showCost ? el('label', { class: 'cost-in' }, 'Your cost', el('input', { type: 'number', inputmode: 'decimal', min: '0', step: '0.01', value: it.cost ?? '', disabled: !canEdit, 'aria-label': `Line ${idx + 1} your cost`, oninput: (e) => { it.cost = e.target.value; renderTotals(); } })) : null,
            amt,
            canEdit && items.length > 1 ? el('button', { type: 'button', class: 'icon', 'aria-label': `Remove line ${idx + 1}`, onclick: () => { items.splice(idx, 1); renderItems(); renderTotals(); } }, '✕') : null));
      }), canEdit ? el('button', { type: 'button', class: 'ghost small', onclick: () => { items.push({ desc: '', qty: 1, price: '' }); renderItems(); renderTotals(); itemsWrap.querySelector('.item-row:last-of-type textarea').focus(); } }, '+ Add line') : null].filter(Boolean));
    }
    renderItems(); renderTotals();

    // Office tools for estimates: price book, good/better/best templates, markup and a scope of work.
    const toolBox = el('div', { class: 'stack' });
    const estTools = showCost && canEdit ? (() => {
      const markupIn = el('input', { type: 'number', inputmode: 'decimal', min: '0', step: '1', value: settings.defaultMarkup ?? 35, 'aria-label': 'Markup percent', style: 'width:80px' });
      const pick = (title, rows) => toolBox.replaceChildren(el('div', { class: 'card stack est-pick' }, el('div', { class: 'row' }, el('b', { style: 'flex:1' }, title), el('button', { type: 'button', class: 'link small', onclick: () => toolBox.replaceChildren() }, 'Close')),
        ...(rows.length ? rows : [el('p', { class: 'muted small' }, 'Nothing yet. Add them on the Office tab → Price book.')])));
      const addLine = (it) => { if (items.length === 1 && !items[0].desc && !Number(items[0].price)) items.splice(0, 1); items.push(it); renderItems(); renderTotals(); };
      return el('div', { class: 'est-tools stack' },
        el('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
          el('button', { type: 'button', class: 'ghost small', onclick: () => {
            const search = el('input', { type: 'search', placeholder: 'Search the price book', 'aria-label': 'Search the price book' });
            const list = el('div', { class: 'stack', style: 'gap:6px' });
            const draw = () => list.replaceChildren(...recs('price_item').filter((p) => !search.value || `${p.name} ${p.category || ''}`.toLowerCase().includes(search.value.toLowerCase()))
              .sort((a, b) => ((a.trade === j.trade) ? 0 : 1) - ((b.trade === j.trade) ? 0 : 1) || String(a.name).localeCompare(b.name))
              .map((p) => el('button', { type: 'button', class: 'alert-row', onclick: () => addLine({ desc: p.name + (p.unit ? ` (per ${p.unit})` : ''), qty: 1, price: Number(p.price) || 0, cost: Number(p.cost) || 0 }) },
                el('b', {}, p.name), el('span', { class: 'muted small' }, `${docs.usd(Number(p.price) || 0)}${p.unit ? ' per ' + p.unit : ''} · cost ${docs.usd(Number(p.cost) || 0)}${p.category ? ' · ' + p.category : ''}`))));
            search.addEventListener('input', draw); draw();
            pick('📗 Add from your price book', [search, list]);
          } }, '📗 Price book'),
          el('button', { type: 'button', class: 'ghost small', onclick: () => {
            const ts = recs('est_template').sort((a, b) => ((a.trade === j.trade) ? 0 : 1) - ((b.trade === j.trade) ? 0 : 1) || String(a.name).localeCompare(b.name));
            pick('📋 Start from a template', ts.map((tp) => el('button', { type: 'button', class: 'alert-row', onclick: () => {
              if (items.some((i) => i.desc || Number(i.price)) && !confirm('Replace the lines on this estimate with the template?')) return;
              items.splice(0, items.length, ...(tp.items || []).map((i) => ({ desc: i.desc, qty: Number(i.qty) || 1, price: Number(i.price) || 0, cost: Number(i.cost) || 0 })));
              if (tp.scope) notesInput.value = `Scope of work:\n${tp.scope}\n\n${notesInput.value}`;
              renderItems(); renderTotals(); toolBox.replaceChildren();
            } }, el('b', {}, `${tp.tier ? ({ good: '🥉 Good', better: '🥈 Better', best: '🥇 Best' }[tp.tier] || tp.tier) + ' · ' : ''}${tp.name}`),
              el('span', { class: 'muted small' }, `${tradeOf(tp.trade).label} · ${(tp.items || []).length} lines · ${docs.usd((tp.items || []).reduce((t, i) => t + (Number(i.qty) || 0) * (Number(i.price) || 0), 0))}`))));
          } }, '📋 Template'),
          el('button', { type: 'button', class: 'ghost small', onclick: () => {
            const lines = items.filter((i) => i.desc).map((i) => `• ${String(i.desc).split('\n')[0]}${Number(i.qty) > 1 ? ` (${i.qty})` : ''}`);
            const scope = [`${t.label} at ${addrOf(j)}.`, j.description ? `Customer request: ${String(j.description).split('\n\n')[0].slice(0, 300)}` : '', 'Work included:', ...lines,
              'Includes labor, materials listed above, site protection and daily cleanup, and haul-away of debris.', 'Not included: anything not listed above. Hidden damage found during the work is quoted as a change order before we do it.'].filter(Boolean).join('\n');
            notesInput.value = `Scope of work:\n${scope}\n\n${notesInput.value.replace(/^Scope of work:[\s\S]*?\n\n/, '')}`;
            notesInput.scrollIntoView({ block: 'center' });
          } }, '✍️ Write scope of work')),
        el('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;align-items:center' }, el('span', { class: 'small' }, 'Markup'), markupIn, el('span', { class: 'small' }, '%'),
          el('button', { type: 'button', class: 'ghost small', onclick: () => { const m = Number(markupIn.value) || 0; items.forEach((i) => { if (Number(i.cost) > 0) i.price = Math.round(Number(i.cost) * (1 + m / 100) * 100) / 100; }); renderItems(); renderTotals(); } }, 'Price lines from my cost')),
        toolBox);
    })() : null;

    const ctx = () => ({ job: j, customer: j.buyer, company: settings });
    const first = (j.buyer.name || '').split(' ')[0] || 'there';
    const shareMsg = j.hasAccount
      ? `Hi ${first}, your ${isInv ? 'invoice' : 'estimate'} ${doc.number} from ${settings.name || 'Top Hat Contracting'} is ready. View it here: ${siteUrl()}#/jobs`
      : `Hi ${first}, here is your ${isInv ? 'invoice' : 'estimate'} ${doc.number} from ${settings.name || 'Top Hat Contracting'}: ${docs.usd(docs.totals(doc).total)}.${isInv ? '' : ' Reply YES to approve.'} The PDF is attached.`;

    async function save() {
      const saved = await api.docs.save(jobId, current());
      if (showCost) {
        const costs = items.map((i) => (i.cost === '' || i.cost == null ? null : Number(i.cost)));
        const old = recs('est_cost').find((r) => r.docId === saved.id);
        if (costs.some((c) => c != null) || old) await api.records.save('est_cost', { ...(old || {}), docId: saved.id, costs }, jobId);
      }
      return saved;
    }
    const busy = async (btn, fn) => { btn.disabled = true; try { await fn(); } catch (err) { fail(err); } finally { btn.disabled = false; } };

    const actions = el('div', { class: 'stack' });
    if (canEdit) actions.append(el('button', { type: 'button', onclick: (e) => busy(e.currentTarget, async () => { const sv = await save(); await reopen(sv.id); }) }, isNew ? 'Save draft' : 'Save changes'));
    if (isNew || doc.status === 'draft') {
      actions.append(el('button', { type: 'button', class: 'gold', onclick: (e) => busy(e.currentTarget, async () => {
        const sv = await save();
        await api.docs.send(jobId, sv.id);
        await reopen(sv.id);
      }) }, `Send to customer`));
    }
    actions.append(el('button', { type: 'button', class: 'ghost', onclick: () => docs.view(current(), ctx()) }, '👁 Preview / Print PDF'));
    if (!isNew && doc.status !== 'draft') {
      actions.append(el('div', { class: 'share-box' },
        el('span', { class: 'small' }, j.hasAccount ? 'The customer sees this in their My jobs. Let them know:'
          : `${first} doesn’t use the app. Tap “Preview / Print PDF” → Save PDF, then attach it to a text or email:`),
        el('div', { class: 'row' },
          j.buyer.phone ? el('a', { class: 'btn ghost small', style: 'flex:1', href: smsHref(j.buyer.phone, shareMsg) }, '💬 Text') : null,
          j.buyer.email ? el('a', { class: 'btn ghost small', style: 'flex:1', href: `mailto:${j.buyer.email}?subject=${encodeURIComponent(`${isInv ? 'Invoice' : 'Estimate'} ${doc.number} from ${settings.name || 'Top Hat Contracting'}`)}&body=${encodeURIComponent(shareMsg)}` }, '✉️ Email') : null)));
    }
    if (!isInv && doc.status === 'sent') {
      const signArea = el('div', { class: 'stack' });
      const signBtn = el('button', { type: 'button', class: 'gold', onclick: () => {
        signArea.replaceChildren(docs.signaturePad({ total: docs.totals(doc).total, name: j.buyer.name || '', submitLabel: `Approve for ${first === 'there' ? 'the customer' : first}`,
          onCancel: () => signArea.replaceChildren(signBtn),
          onSign: async (sig) => { await api.docs.setStatus(jobId, doc.id, 'approved', sig); await reopen(doc.id); } }));
        signArea.scrollIntoView({ block: 'start', behavior: 'smooth' });
      } }, `✍️ Customer signs here (in person)`);
      signArea.append(signBtn);
      actions.append(signArea);
      actions.append(el('div', { class: 'row' },
        el('button', { type: 'button', class: 'ghost', style: 'flex:1', onclick: (e) => busy(e.currentTarget, async () => { if (!confirm('Mark approved without a signature? Use this if the customer said yes by phone.')) return; await api.docs.setStatus(jobId, doc.id, 'approved'); await reopen(doc.id); }) }, '✓ Approved by phone'),
        el('button', { type: 'button', class: 'ghost', style: 'flex:1', onclick: (e) => busy(e.currentTarget, async () => { if (!confirm('Mark this estimate declined?')) return; await api.docs.setStatus(jobId, doc.id, 'declined'); await reopen(doc.id); }) }, 'Mark declined')));
    }
    // Not signed yet (an invoice that's out, or an estimate approved by phone): the customer signs on your phone.
    const unsigned = !doc.signature && (isInv ? !['draft', 'void'].includes(doc.status) && !(doc.reports || []).some((r) => r.signature && r.status !== 'not_received') : doc.status === 'approved');
    if (unsigned) {
      const area = el('div', { class: 'stack' });
      const btn = el('button', { type: 'button', class: 'ghost', onclick: () => {
        area.replaceChildren(docs.signaturePad({ name: j.buyer.name || '', title: isInv ? 'Customer signs the invoice' : 'Customer signs the estimate', submitLabel: `Sign for ${first === 'there' ? 'the customer' : first}`,
          agree: isInv ? `By signing, the customer confirms invoice ${doc.number}.` : `By signing, the customer approves estimate ${doc.number} and its payment schedule.`,
          onCancel: () => area.replaceChildren(btn),
          onSign: async (sig) => { await api.docs.sign(doc.id, sig, jobId); await reopen(doc.id); } }));
        area.scrollIntoView({ block: 'start', behavior: 'smooth' });
      } }, `✍️ Customer signs here (in person)`);
      area.append(btn);
      actions.append(el('p', { class: 'muted small' }, `Not signed yet. ${j.hasAccount ? first + ' can sign it in the app, or' : 'They can'} sign on your phone:`), area);
    }
    if (!isInv && doc.status === 'approved') {
      actions.append(el('button', { type: 'button', class: 'gold', onclick: () => openDoc(jobId, null, 'invoice', doc) }, '🧾 Create invoice from this estimate'));
    }
    if (doc.status === 'draft') {
      actions.append(el('button', { type: 'button', class: 'link', style: 'color:var(--bad)', onclick: (e) => busy(e.currentTarget, async () => { if (!confirm(`Delete draft ${doc.number}?`)) return; await api.docs.remove(jobId, doc.id); await load(); openLead(jobId); }) }, 'Delete draft'));
    }

    // Payments (invoices that have been sent)
    let paymentsCard = null;
    if (isStaff && isInv && !isNew && !['draft', 'void'].includes(doc.status)) {
      const tt = docs.totals(doc);
      const amount = el('input', { type: 'number', inputmode: 'decimal', min: '0.01', step: '0.01', value: tt.balance > 0 ? tt.balance : '', 'aria-label': 'Amount received' });
      const method = el('select', { 'aria-label': 'Payment method' }, ...docs.METHODS.map((m) => el('option', {}, m)));
      const date = el('input', { type: 'date', value: docs.todayKey(), 'aria-label': 'Date received' });
      const note = el('input', { type: 'text', placeholder: 'Note, e.g. check #1042 (optional)' });
      paymentsCard = el('section', { class: 'card stack' },
        el('div', { class: 'row' }, el('h3', {}, 'Payments'), el('span', { class: 'spacer' }), el('span', { class: `pill ${docs.pillClass(doc)}` }, docs.label(doc))),
        ...(doc.reports || []).filter((r) => r.status === 'pending').map((r) => el('div', { class: 'callout report' },
          el('div', {}, el('b', {}, `💵 ${r.by} paid ${docs.usd(r.amount)} by ${r.method}`), el('span', { class: 'muted small' }, ` · ${ago(r.at)}`)),
          r.note ? el('div', { class: 'small' }, `“${r.note}”`) : null,
          r.signature?.image ? el('div', { class: 'small' }, el('img', { class: 'doc-sig', src: r.signature.image, alt: '' }), `✍️ Signed “${r.signature.name}”`) : null,
          el('div', { class: 'row' },
            el('button', { type: 'button', class: 'gold small', style: 'flex:1', onclick: (e) => busy(e.currentTarget, async () => { await api.docs.resolveReport(jobId, doc.id, r.id, true); await reopen(doc.id); }) }, '✓ Got it: record payment'),
            el('button', { type: 'button', class: 'ghost small', style: 'flex:1', onclick: (e) => busy(e.currentTarget, async () => { if (!confirm('Mark as not received yet?')) return; await api.docs.resolveReport(jobId, doc.id, r.id, false); await reopen(doc.id); }) }, 'Not received')))),
        doc.payments.length ? el('ul', { class: 'log' }, ...doc.payments.map((p) => el('li', {},
          el('span', {}, docs.fmtDate(p.date)),
          el('span', { style: 'flex:1' }, `${docs.usd(p.amount)} · ${p.method}${p.note ? ' · ' + p.note : ''}`),
          el('button', { type: 'button', class: 'icon', 'aria-label': 'Remove payment', onclick: (e) => busy(e.currentTarget, async () => { if (!confirm('Remove this payment?')) return; await api.docs.removePayment(jobId, doc.id, p.id); await reopen(doc.id); }) }, '✕')))) : el('p', { class: 'muted small' }, 'No payments recorded yet.'),
        tt.balance > 0 ? el('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); busy(e.submitter || e.target.querySelector('button'), async () => {
          await api.docs.addPayment(jobId, doc.id, { amount: amount.value, method: method.value, date: date.value, note: note.value });
          await reopen(doc.id);
        }); } },
          el('b', { class: 'small' }, 'Record a payment'),
          el('div', { class: 'two' }, el('label', { class: 'field' }, 'Amount ($)', amount), el('label', { class: 'field' }, 'Method', method)),
          el('label', { class: 'field' }, 'Date received', date),
          note,
          el('button', { type: 'submit' }, 'Record payment')) : el('div', { class: 'callout' }, '✓ Paid in full'),
        doc.status !== 'void' ? el('button', { type: 'button', class: 'link', style: 'color:var(--bad)', onclick: (e) => busy(e.currentTarget, async () => { if (!confirm(`Void ${doc.number}? The customer will see it as void.`)) return; await api.docs.setStatus(jobId, doc.id, 'void'); await reopen(doc.id); }) }, 'Void invoice') : null,
      );
    }

    const editor = el('section', { class: 'card stack' },
      el('div', { class: 'row' }, el('h3', {}, isInv ? 'Invoice' : doc.changeOrder ? 'Change order' : 'Estimate'), el('span', { class: 'spacer' }), isNew ? null : el('span', { class: `pill ${docs.pillClass(doc)}` }, docs.label(doc))),
      canEdit ? null : el('p', { class: 'muted small' }, doc.status === 'approved' ? `Approved${doc.respondedBy ? ' by ' + doc.respondedBy : ''}${doc.respondedAt ? ' on ' + docs.fmtDate(doc.respondedAt) : ''}. Locked so it matches what the customer agreed to.` : 'Locked. Payments have been recorded or it’s closed.'),
      el('p', { class: 'muted small' }, `For ${j.buyer.name} · ${jobNo(j)} · ${j.address}`),
      estTools,
      itemsWrap,
      el('div', { class: 'two' }, el('label', { class: 'field' }, 'Tax rate (%)', taxInput), isInv ? el('label', { class: 'field' }, 'Due date', dueInput) : el('span')),
      totalsBox,
      showCost ? marginBox : null,
      el('label', { class: 'field' }, isInv ? 'Notes on the invoice' : 'Scope & terms on the estimate', notesInput),
      isInv ? el('label', { class: 'field' }, 'Card payment link', el('span', { class: 'hint' }, 'Optional. Paste a Square or Stripe payment link to show a “Pay by card” button.'), linkInput) : null,
    );

    const panel = el('div', { class: 'panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': `${isInv ? 'Invoice' : 'Estimate'} for ${jobNo(j)}` },
      el('div', { class: 'panel-head' },
        el('button', { class: 'ghost small', onclick: () => openLead(jobId) }, `← ${jobNo(j)}`),
        el('b', { style: 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, doc.number)),
      el('div', { class: 'panel-body' }, errorBox, editor, paymentsCard, el('section', { class: 'card stack' }, actions)),
    );
    releaseUrls();
    drawerRoot.replaceChildren(el('div', { class: 'drawer', onclick: (e) => { if (e.target === e.currentTarget) closeDrawer(); } }, panel));
    document.body.style.overflow = 'hidden';
  }

  /* ---------- business settings ---------- */
  function businessView() {
    const saved = el('span', { class: 'saved-note', hidden: true }, 'Saved ✓');
    const errorBox = el('div', { class: 'error', hidden: true, role: 'alert' });
    const f = (name, label, attrs = {}, hint) => el('label', { class: 'field' }, label, hint ? el('span', { class: 'hint' }, hint) : null,
      attrs.rows ? el('textarea', { name, rows: attrs.rows, value: settings[name] ?? '' }) : el('input', { name, value: settings[name] ?? '', ...attrs }));
    const plan = scheduleEditor(docs.scheduleOf(settings), docs.WHEN, 'payment');
    const crewPlan = scheduleEditor(docs.crewScheduleOf(settings), docs.CREW_WHEN, 'crew payment');
    const form = el('form', { class: 'card stack', onsubmit: async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const patch = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));
      for (const [ed, what] of [[plan, 'payment schedule'], [crewPlan, 'crew pay schedule']]) {
        if (ed.list.some((x) => !String(x.label).trim())) { errorBox.textContent = `Give each step in the ${what} a name.`; errorBox.hidden = false; return; }
        if (ed.sum() !== 100) { errorBox.textContent = `The ${what} has to add up to 100%.`; errorBox.hidden = false; ed.wrap.scrollIntoView({ block: 'center' }); return; }
      }
      errorBox.hidden = true;
      patch.paymentSchedule = plan.value();
      patch.crewPaySchedule = crewPlan.value();
      if (patch.cardPayLink && !/^https:\/\//i.test(patch.cardPayLink)) { errorBox.textContent = 'The card payment link must start with https://'; errorBox.hidden = false; return; }
      patch.taxRate = Number(patch.taxRate) || 0;
      patch.goalMonthly = Math.max(0, Number(patch.goalMonthly) || 0) || 300000;
      patch.dueDays = Math.max(0, Math.round(Number(patch.dueDays) || 0));
      patch.showCrewPay = fd.get('showCrewPay') === 'on';
      try { settings = await api.settings.save(patch); saved.hidden = false; setTimeout(() => { saved.hidden = true; }, 1600); }
      catch (err) { errorBox.textContent = err.message; errorBox.hidden = false; }
    } },
      el('div', { class: 'row' }, el('h2', {}, 'Business details'), el('span', { class: 'spacer' }), saved),
      el('p', { class: 'muted small' }, 'Shown at the top of every estimate and invoice.'),
      errorBox,
      f('name', 'Company name'),
      el('div', { class: 'two' }, f('phone', 'Phone', { type: 'tel' }), f('email', 'Email', { type: 'email' })),
      f('address', 'Address', { rows: 2 }),
      f('license', 'License # (optional)'),
      el('h3', {}, '🎯 Company goal'),
      el('label', { class: 'field' }, 'Sales goal per month ($)', el('span', { class: 'hint' }, 'Shown on Today with this month, this quarter (×3) and this year (×12).'),
        el('input', { name: 'goalMonthly', type: 'number', min: '0', inputmode: 'numeric', placeholder: '300000', value: monthlyGoal() })),
      el('h3', { style: 'margin-top:8px' }, 'Defaults'),
      el('div', { class: 'two' }, f('taxRate', 'Tax rate (%)', { type: 'number', inputmode: 'decimal', min: '0', step: '0.01' }), f('dueDays', 'Invoices due in (days)', { type: 'number', inputmode: 'numeric', min: '0', step: '1' })),
      el('label', { class: 'row', style: 'font-weight:600;align-items:flex-start' },
        el('input', { type: 'checkbox', name: 'showCrewPay', checked: settings.showCrewPay !== false, style: 'width:22px;height:22px;flex-shrink:0;min-height:0' }),
        el('span', {}, 'Show crew their pay', el('span', { class: 'hint', style: 'display:block;font-weight:400' }, 'Crew see the “crew pay” you set on each of their jobs. They never see the customer price.'))),
      el('h3', { style: 'margin-top:8px' }, 'Payment schedule'),
      el('p', { class: 'muted small' }, 'How the job total is split into payments. Each estimate shows it, and each job gets an invoice for every payment as it comes due: the first when the job is sold, then as work moves along.'),
      plan.wrap, plan.total,
      el('h3', { style: 'margin-top:8px' }, 'Crew pay schedule'),
      el('p', { class: 'muted small' }, 'How a contractor’s pay on a job is split. They bill Top Hat from the job as they reach each step; you approve and pay each bill.'),
      crewPlan.wrap, crewPlan.total,
      f('cardPayLink', 'Card payment link (optional)', { type: 'url', inputmode: 'url', placeholder: 'https://… your Square, Stripe or PayPal payment link' }, 'Shows a “Pay by card” button on every invoice. Make the link in your Square, Stripe or PayPal account. You can still paste a different link on one invoice.'),
      f('estimatePaymentInstructions', 'Payment terms & how to pay: on estimates', { rows: 5 }, 'Printed on every estimate. Keep it to your payment schedule and Zelle. No bank numbers here.'),
      f('paymentInstructions', 'Payment terms & how to pay: on invoices', { rows: 8 }, 'Printed on every invoice. Your payment schedule, Zelle, and ACH details (routing and account number).'),
      f('estimateTerms', 'Terms on estimates', { rows: 2 }),
      f('invoiceTerms', 'Notes on invoices', { rows: 2 }),
      f('reviewLink', 'Review link (optional)', { type: 'url', inputmode: 'url', placeholder: 'https://g.page/r/… your Google review link' }, 'After a customer rates a finished job in the app, they get a button to post it here. It’s also in the review text you send them.'),
      el('button', { type: 'submit' }, 'Save'),
    );
    // AI design studio switch. Preview: the key lives in this browser only. Live: it's a server secret.
    const ai = TH.ai.config();
    const aiKey = el('input', { type: 'password', autocomplete: 'off', placeholder: 'Paste your Google AI Studio API key', value: ai.key || '' });
    const aiModel = el('input', { value: ai.model || TH.ai.DEFAULT_IMAGE_MODEL, autocomplete: 'off', spellcheck: 'false' });
    const aiSaved = el('span', { class: 'saved-note', hidden: true }, 'Saved ✓');
    const aiCard = el('section', { class: 'card stack' },
      el('div', { class: 'row' }, el('h2', {}, '🎨 AI design studio'), el('span', { class: 'spacer' }), aiSaved),
      el('p', { class: 'muted small' }, 'Customers (and your reps at the visit) upload a photo and describe the remodel. Google’s Gemini image AI draws it, and they keep changing it until it’s right. Each picture costs a few cents on your Google account.'),
      api.mode === 'preview'
        ? el('div', { class: 'stack' },
          el('p', { class: 'small' }, 'To try it in preview: get a key at ', el('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener' }, 'aistudio.google.com/apikey'), ' and paste it here. In preview it’s saved in this browser only. When the app goes live, the key is kept on the server instead, never in the app.'),
          el('label', { class: 'field' }, 'API key', aiKey),
          el('label', { class: 'field' }, 'Image model', el('span', { class: 'hint' }, 'Google renames these now and then. Leave as is unless a newer image model is out.'), aiModel),
          el('button', { type: 'button', onclick: () => { TH.ai.set({ key: aiKey.value, model: aiModel.value }); aiSaved.hidden = false; setTimeout(() => { aiSaved.hidden = true; }, 1600); } }, 'Save'))
        : el('p', { class: 'small' }, 'Live: the API key is set on the server (Supabase → Edge Functions → Secrets → GEMINI_API_KEY). Customers never see it.'),
    );
    const records = el('section', { class: 'card stack' },
      el('h2', {}, '📒 Records for your books'),
      el('p', { class: 'muted small' }, 'Spreadsheets that open in Excel, Numbers or Google Sheets. Handy for your accountant and taxes.'),
      el('button', { type: 'button', class: 'ghost block', onclick: () => downloadJobs(jobs, 'top-hat-all-jobs') }, `⬇ Every job (${jobs.length})`),
      el('button', { type: 'button', class: 'ghost block', onclick: () => TH.download(`top-hat-payments-received-${docs.todayKey()}.csv`, TH.csv([
        ['Date', 'Invoice', 'Job #', 'Customer', 'Amount', 'Method', 'Note'],
        ...jobs.flatMap((j) => liveInvoices(j).flatMap((d) => (d.payments || []).map((p) => [p.date, d.number, jobNo(j), j.buyer.name, p.amount, p.method, p.note || ''])))
          .sort((a, b) => String(a[0]).localeCompare(String(b[0])))])) }, '⬇ Payments received'),
      el('button', { type: 'button', class: 'ghost block', onclick: () => TH.download(`top-hat-crew-payouts-${docs.todayKey()}.csv`, TH.csv([
        ['Paid on', 'Contractor', 'Job #', 'Customer', 'Address', 'Amount', 'Method'],
        ...jobs.filter((j) => j.crewPaid).map((j) => [j.crewPaid.date, crewName(j) || '', jobNo(j), j.buyer.name, j.address, j.crewPay ?? '', j.crewPaid.method])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0])))])) }, '⬇ Crew payouts'),
      el('button', { type: 'button', class: 'ghost block', onclick: customersList }, '📁 Customer folders'),
    );
    // Money owed by age (office checklist 5.2): how late each unpaid invoice is.
    const agingCard = (() => {
      const today = docs.todayKey();
      const rows = jobs.flatMap((j) => liveInvoices(j).filter((d) => docs.owed(d) > 0).map((d) => {
        const late = d.dueDate ? Math.floor((Date.parse(today) - Date.parse(d.dueDate)) / 864e5) : 0;
        return { j, d, owed: docs.owed(d), late }; }));
      const B = [['Not due yet', (x) => x.late <= 0], ['1–30 days late', (x) => x.late >= 1 && x.late <= 30], ['31–60 days late', (x) => x.late >= 31 && x.late <= 60],
        ['61–90 days late', (x) => x.late >= 61 && x.late <= 90], ['Over 90 days late', (x) => x.late > 90]];
      return el('section', { class: 'card stack' },
        el('h3', {}, '⏳ Money owed by age'),
        rows.length ? el('div', { class: 'aging' }, ...B.map(([label, test]) => { const list = rows.filter(test); const sum = list.reduce((t, x) => t + x.owed, 0);
          return el('details', { class: 'aging-row' + (label.includes('late') && sum ? ' late' : '') },
            el('summary', {}, el('span', {}, label), el('span', { class: 'spacer' }), el('b', {}, money(sum)), el('span', { class: 'muted small' }, ` · ${list.length}`)),
            ...list.sort((a, b) => b.late - a.late).map((x) => el('button', { type: 'button', class: 'alert-row', onclick: () => openLead(x.j.id, 'money') },
              el('b', {}, `${x.j.buyer.name} · ${x.d.number}`), el('span', { class: 'muted small' }, `${money(x.owed)} owed${x.d.dueDate ? ' · due ' + docs.fmtDate(x.d.dueDate) : ''}`)))); }))
          : el('p', { class: 'muted small' }, 'Nobody owes you anything right now.'));
    })();
    // Back up everything (office checklist 13.2): one file with every job, customer, invoice, contractor and setting.
    const backupCard = el('section', { class: 'card stack' },
      el('h3', {}, '💾 Back up everything'),
      el('p', { class: 'muted small', style: 'margin:0' }, 'Downloads one file with all your jobs, customers, estimates, invoices, payments, contractors, sales team and settings (photos and documents stay in the app). Keep a copy somewhere safe.'),
      el('button', { type: 'button', class: 'ghost block', onclick: async () => {
        const data = { exportedAt: new Date().toISOString(), settings, jobs, contractors: crew, salesTeam: team };
        TH.download(`top-hat-backup-${docs.todayKey()}.json`, JSON.stringify(data, (k, v) => (k === 'url' ? undefined : v), 2), 'application/json');
      } }, '⬇ Download backup'));
    // Ready-made texts and emails (CRM checklist 2.7 · office checklist 2.6). Used in every job's Messages box.
    let tpl = templatesOf().map((x) => ({ ...x }));
    const tplSaved = el('span', { class: 'saved-note', hidden: true }, 'Saved ✓');
    const tplList = el('div', { class: 'stack' });
    const drawTpl = () => tplList.replaceChildren(...tpl.map((x, i) => el('div', { class: 'tpl-row stack' },
      el('div', { class: 'row', style: 'gap:6px' },
        el('input', { value: x.name, 'aria-label': 'Template name', maxlength: '40', style: 'flex:1', oninput: (e) => { x.name = e.target.value; } }),
        el('select', { 'aria-label': 'Text or email', onchange: (e) => { x.channel = e.target.value; } }, el('option', { value: 'text', selected: x.channel !== 'email' }, '💬 Text'), el('option', { value: 'email', selected: x.channel === 'email' }, '✉️ Email')),
        el('button', { type: 'button', class: 'link small', style: 'color:var(--bad)', 'aria-label': 'Remove template', onclick: () => { tpl.splice(i, 1); drawTpl(); } }, '✕')),
      el('textarea', { rows: 3, 'aria-label': 'Template text', maxlength: '1500', value: x.body, oninput: (e) => { x.body = e.target.value; } }))));
    drawTpl();
    const tplCard = el('section', { class: 'card stack' },
      el('div', { class: 'row' }, el('h3', { style: 'flex:1' }, '💬 Message templates'), tplSaved),
      el('p', { class: 'muted small', style: 'margin:0' }, 'Ready-made texts and emails for pricing, timelines, your service area and follow-ups. They show as buttons in each job’s Messages box. {first} = customer’s first name, {company}, {phone}, {job} = job number, {trade} = type of work.'),
      tplList,
      el('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
        el('button', { type: 'button', class: 'ghost', onclick: () => { tpl.push({ id: 't-' + Date.now().toString(36), name: 'New template', channel: 'text', body: 'Hi {first}, ' }); drawTpl(); } }, '+ Add a template'),
        el('button', { type: 'button', onclick: async () => {
          const clean = tpl.filter((x) => String(x.name).trim() && String(x.body).trim()).map((x) => ({ id: x.id, name: String(x.name).trim().slice(0, 40), channel: x.channel === 'email' ? 'email' : 'text', body: String(x.body).trim().slice(0, 1500) }));
          settings = await api.settings.save({ templates: clean }); tpl = clean.map((x) => ({ ...x })); drawTpl(); tplSaved.hidden = false; setTimeout(() => { tplSaved.hidden = true; }, 1600);
        } }, 'Save templates'),
        el('button', { type: 'button', class: 'link small', onclick: () => { tpl = TH.DEFAULT_TEMPLATES.map((x) => ({ ...x })); drawTpl(); } }, 'Start over with the suggested ones')));
    return [form, tplCard, agingCard, records, backupCard];
  }

  // Editable list of steps: name, percent, and when it's due. Used for customer payments and crew pay.
  function scheduleEditor(initial, whens, noun) {
    const list = initial.map((x) => ({ ...x }));
    const wrap = el('div', { class: 'stack', style: 'gap:8px' });
    const total = el('p', { class: 'small sched-total', style: 'font-weight:700' });
    const sum = () => list.reduce((t, x) => t + (Number(x.pct) || 0), 0);
    const drawTotal = () => { const t = sum(); total.textContent = t === 100 ? 'Adds up to 100% ✓' : `Adds up to ${t}%. It needs to be 100%.`; total.style.color = t === 100 ? 'var(--good)' : 'var(--bad)'; };
    const draw = () => {
      wrap.replaceChildren(...list.map((x, i) => el('div', { class: 'sched-edit' },
        el('span', { class: 'n' }, String(i + 1)),
        el('input', { class: 'name', value: x.label, maxlength: '60', 'aria-label': `${noun} ${i + 1} name`, oninput: (e) => { x.label = e.target.value; } }),
        el('label', { class: 'pct' }, el('input', { type: 'number', inputmode: 'decimal', min: '0', max: '100', step: '1', value: x.pct, 'aria-label': `${noun} ${i + 1} percent`, oninput: (e) => { x.pct = Number(e.target.value) || 0; drawTotal(); } }), '%'),
        el('select', { class: 'when', 'aria-label': `${noun} ${i + 1} is due`, onchange: (e) => { x.when = e.target.value; } }, ...whens.map((w) => el('option', { value: w.id, selected: w.id === x.when }, w.short))),
        list.length > 1 ? el('button', { type: 'button', class: 'icon x', 'aria-label': `Remove ${noun} ${i + 1}`, onclick: () => { list.splice(i, 1); draw(); } }, '✕') : el('span', { class: 'x' })),
      ), el('button', { type: 'button', class: 'ghost small', onclick: () => { list.push({ label: noun === 'payment' ? 'Payment' : 'Step', pct: 0, when: 'mid' }); draw(); } }, `+ Add a ${noun}`));
      drawTotal();
    };
    draw();
    return { list, wrap, total, sum, value: () => list.map((x) => ({ label: String(x.label).trim(), pct: Number(x.pct) || 0, when: x.when })) };
  }

  /* ---------- sales team (owner/office) ---------- */
  function salesStats(id) {
    const mine = jobs.filter((j) => j.salesId === id);
    const ests = mine.flatMap((j) => (j.docs || []).filter((d) => d.type === 'estimate' && d.status !== 'draft'));
    const approved = ests.filter((d) => d.status === 'approved').length;
    return {
      clients: mine.length,
      open: mine.filter((j) => ['new', 'qualifying'].includes(j.status)).length,
      sent: ests.length, approved, sold: soldTotal(mine),
      close: ests.length ? Math.round((approved / ests.length) * 100) : null,
    };
  }
  function salesTeamView() {
    const unassigned = jobs.filter((j) => !j.salesId && ['new', 'qualifying'].includes(j.status)).length;
    const list = el('div', { class: 'stack' },
      team.length ? null : el('div', { class: 'card muted' }, 'No salespeople yet. Add one, then send them an invite to log in.'),
      ...team.slice().sort((a, b) => (b.active !== false) - (a.active !== false) || a.name.localeCompare(b.name)).map((x) => {
        const st = salesStats(x.id);
        return el('button', { type: 'button', class: 'sales-card' + (x.active === false ? ' inactive' : ''), onclick: () => salesDetail(x.id) },
          el('div', { class: 'row' }, el('span', { class: 'avatar' }, initials(x.name)),
            el('div', { style: 'flex:1;min-width:0;text-align:left' }, el('b', {}, x.name),
              el('p', { class: 'muted small' }, x.login === 'active' ? '🔑 Has login' : x.login === 'invited' ? '✉️ Invite sent' : 'No login yet')),
            el('span', { class: 'chev' }, '›')),
          el('div', { class: 'sales-stats' },
            ...[[st.clients, 'Clients'], [st.open, 'Open'], [st.sent, 'Estimates'], [money(st.sold), 'Sold'], [st.close == null ? '—' : st.close + '%', 'Close rate']]
              .map(([v, k]) => el('span', {}, el('b', {}, String(v)), el('span', {}, k)))));
      }));
    return [el('div', { class: 'row' }, el('h2', { style: 'flex:1' }, 'Sales team'), el('button', { class: 'gold small', onclick: () => salesForm() }, '+ Add')),
      unassigned ? el('div', { class: 'callout stage' }, `${unassigned} open lead${unassigned === 1 ? '' : 's'} with no salesperson. Open a job to assign one.`) : null,
      list,
      el('p', { class: 'muted small' }, 'Salespeople log in on the same login page. They see only their own clients, never crew pay or your profit.')];
  }

  async function salesDetail(id) {
    const x = team.find((y) => y.id === id);
    if (!x) return;
    const { events } = await api.team.activity(id);
    const st = salesStats(id);
    const mine = jobs.filter((j) => j.salesId === id);
    const calls = events.filter((e) => e.text.startsWith('📞 Call')).length;
    const panel = el('div', { class: 'panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': x.name },
      el('div', { class: 'panel-head' }, el('button', { class: 'ghost small', onclick: closeDrawer }, '← Back'), el('b', { style: 'flex:1' }, `💼 ${x.name}`),
        el('button', { class: 'ghost small', onclick: () => salesForm(x) }, 'Edit')),
      el('div', { class: 'panel-body' },
        el('div', { class: 'kpis three' },
          ...[[st.clients, 'Clients'], [calls, 'Calls logged'], [st.sent, 'Estimates sent'], [money(st.sold), 'Sold'], [st.close == null ? '—' : st.close + '%', 'Close rate'], [st.open, 'Open leads']]
            .map(([v, k]) => el('div', { class: 'kpi' }, el('b', {}, String(v)), el('span', {}, k)))),
        el('section', { class: 'card stack' },
          el('h3', {}, 'Everything they’re doing'),
          events.length ? el('ul', { class: 'log feed' }, ...events.map((e) => el('li', {},
            el('span', {}, `${new Date(e.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`),
            el('button', { type: 'button', class: 'link small feed-item', onclick: () => openLead(e.jobId, 'overview') }, el('b', {}, `TH-${e.number} · ${e.customer}`), el('span', {}, e.text)))))
            : el('p', { class: 'muted small' }, 'Nothing yet. Their calls, new clients, estimates and updates will show here.')),
        el('button', { type: 'button', class: 'ghost block', onclick: () => downloadJobs(mine, `${x.name}-clients`, { pay: false }) }, `⬇ Spreadsheet of ${x.name.split(' ')[0]}’s clients`),
        folderSection('Active clients', mine.filter((j) => !['completed', 'lost'].includes(j.status)), 'Nothing active.'),
        folderSection('Done', mine.filter((j) => j.status === 'completed'), 'No finished jobs yet.'),
        folderSection('Closed', mine.filter((j) => j.status === 'lost'), 'None.'),
      ));
    releaseUrls();
    drawerRoot.replaceChildren(el('div', { class: 'drawer', onclick: (e) => { if (e.target === e.currentTarget) closeDrawer(); } }, panel));
    document.body.style.overflow = 'hidden';
  }

  function salesForm(x) {
    const editing = !!x;
    x = x || { name: '', phone: '', active: true };
    const errorBox = el('div', { class: 'error', hidden: true, role: 'alert' });
    const back = () => (editing ? salesDetail(x.id) : closeDrawer());
    let loginCard = null;
    if (editing) {
      const st = x.login || 'none';
      const first = x.name.split(' ')[0];
      const inviteBox = el('div', { class: 'stack' });
      const showInvite = (code) => {
        const link = new URL(`sales.html?invite=${code}`, location.href).href;
        const msg = `Hi ${first}, here's your Top Hat sales login invite. Tap to set your password: ${link}`;
        inviteBox.replaceChildren(el('div', { class: 'share-box' },
          el('span', { class: 'small' }, `Invite link. It works once, only for ${first}:`),
          el('div', { class: 'row' }, ...[x.phone ? el('a', { class: 'btn gold small', style: 'flex:1', href: smsHref(x.phone, msg) }, '💬 Text invite') : null,
            el('button', { type: 'button', class: 'ghost small', style: 'flex:1', onclick: async (e) => {
              try { await navigator.clipboard.writeText(link); e.currentTarget.textContent = 'Copied ✓'; } catch { prompt('Copy this invite link:', link); }
            } }, 'Copy link')].filter(Boolean))));
      };
      if (st === 'invited' && x.inviteCode) showInvite(x.inviteCode);
      const refresh = async () => { await load(); salesForm(team.find((y) => y.id === x.id)); };
      loginCard = el('section', { class: 'card stack' },
        el('div', { class: 'row' }, el('h3', {}, '🔑 Sales login'), el('span', { class: 'spacer' }),
          el('span', { class: 'pill ' + (st === 'active' ? 's-completed' : st === 'invited' ? 's-qualifying' : '') }, st === 'active' ? 'Active' : st === 'invited' ? 'Invite sent' : 'No login')),
        el('p', { class: 'muted small' }, st === 'active' ? `${first} logs in with ${x.loginEmail}.` : `Invite ${first} to set up a login. They’ll see only their own clients.`),
        inviteBox,
        st !== 'active' ? el('button', { type: 'button', class: st === 'invited' ? 'ghost' : 'gold', onclick: async (e) => {
          e.currentTarget.disabled = true;
          try { await api.team.invite(x.id); await refresh(); } catch (err) { errorBox.textContent = err.message; errorBox.hidden = false; }
        } }, st === 'invited' ? 'Make a new invite link (old one stops working)' : 'Create invite link') : null,
        st !== 'none' ? el('button', { type: 'button', class: 'link', style: 'color:var(--bad)', onclick: async () => {
          if (!confirm(st === 'active' ? `Turn off ${first}'s login?` : 'Cancel this invite?')) return;
          await api.team.revokeLogin(x.id); await refresh();
        } }, st === 'active' ? 'Turn off login' : 'Cancel invite') : null);
    }
    const form = el('form', { class: 'panel-body', onsubmit: async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      try {
        await api.team.save({ ...(editing ? { id: x.id } : {}), name: f.get('name'), phone: f.get('phone'), active: f.get('active') === 'on' });
        await load(); editing ? salesDetail(x.id) : closeDrawer();
      } catch (err) { errorBox.textContent = err.message; errorBox.hidden = false; }
    } },
      errorBox,
      el('label', { class: 'field' }, 'Name', el('input', { name: 'name', value: x.name, required: true, autocomplete: 'off' })),
      el('label', { class: 'field' }, 'Phone', el('input', { name: 'phone', type: 'tel', value: x.phone, autocomplete: 'off' })),
      el('label', { class: 'row', style: 'font-weight:600' }, el('input', { type: 'checkbox', name: 'active', checked: x.active !== false, style: 'width:22px;height:22px;min-height:0' }), 'Active'),
      el('button', { type: 'submit' }, editing ? 'Save' : 'Add salesperson'),
      loginCard,
      editing ? el('button', { type: 'button', class: 'link', style: 'color:var(--bad)', onclick: async () => {
        if (!confirm(`Remove ${x.name}? Their clients stay, with no salesperson.`)) return;
        await api.team.remove(x.id); await load(); closeDrawer();
      } }, 'Remove salesperson') : null);
    drawerRoot.replaceChildren(el('div', { class: 'drawer', onclick: (e) => { if (e.target === e.currentTarget) closeDrawer(); } },
      el('div', { class: 'panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': editing ? 'Edit salesperson' : 'Add salesperson' },
        el('div', { class: 'panel-head' }, el('button', { class: 'ghost small', onclick: back }, '← Back'), el('b', {}, editing ? 'Edit salesperson' : 'Add salesperson')),
        form)));
    document.body.style.overflow = 'hidden';
  }

  /* ---------- crew ---------- */
  let crewGroupBy = 'skill'; let skillFilter = '';
  const skillOf = (id) => TH.SKILLS.find((x) => x.id === id) || tradeOf(id);
  // "Does it all", "Concrete only", or the list of what they do.
  const skillLine = (c) => (c.trades || []).includes('allround') ? '🧰 Does it all'
    : (c.trades || []).length === 1 ? `${skillOf(c.trades[0]).icon} ${skillOf(c.trades[0]).label} only`
      : (c.trades || []).map((id) => skillOf(id).label).join(', ') || 'No skills set';
  function crewView() {
    const activeJobs = (cid) => jobs.filter((j) => j.contractorId === cid && OPEN.includes(j.status)).length;
    const groups = statesIn(crew, (c) => c.state);
    const sf = groups.length > 1 ? usableState(groups) : '';
    const inSt = (c) => !sf || (sf === 'none' ? !c.state : c.state === sf);
    const crewStSel = groups.length > 1 ? el('select', { 'aria-label': 'State', onchange: (e) => { stateFilter = e.target.value; render(); } },
      el('option', { value: '' }, `🗺 All states (${crew.length})`),
      ...groups.map(([c, n]) => el('option', { value: c || 'none', selected: sf === (c || 'none') }, `${c ? TH.stateName(c) : 'No state set'} (${n})`))) : null;
    const pool = crew.filter(inSt);
    const skillCount = (id) => pool.filter((c) => (c.trades || []).includes(id)).length;
    const skillSel = el('select', { 'aria-label': 'Skill', onchange: (e) => { skillFilter = e.target.value; render(); } },
      el('option', { value: '' }, '🧰 All skills'),
      ...TH.SKILLS.filter((x) => skillCount(x.id)).map((x) => el('option', { value: x.id, selected: skillFilter === x.id }, `${x.icon} ${x.label} (${skillCount(x.id)})`)));
    // Proof of insurance the contractor uploaded (they can't bill without it).
    const insuranceLine = (c) => {
      if (!('insurance' in c)) return null; // salespeople don't see it
      const ins = c.insurance; const today = docs.todayKey();
      if (!ins) return el('p', { class: 'small bad-text' }, '🛡 No proof of insurance yet');
      const out = ins.expires && ins.expires < today;
      const soon = !out && ins.expires && ins.expires <= new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
      return el('p', { class: 'small' + (out ? ' bad-text' : '') }, `🛡 Insurance ${out ? 'ran out' : 'on file, runs out'} ${docs.fmtDate(ins.expires)}${soon ? ' (soon)' : ''} · `,
        ins.url ? el('a', { href: ins.url, target: '_blank', rel: 'noopener' }, 'View') : el('span', { class: 'muted' }, ins.name));
    };
    // What the contractor keeps up to date in their login: W-9, license, availability, and the office's ratings.
    const paperLine = (c) => {
      if (!('insurance' in c)) return null;
      const pf = c.profile || {}; const today = docs.todayKey(); const rt = crewRating(c.id);
      const upcoming = (pf.blocked || []).filter((d) => d >= today).slice(0, 3);
      return el('div', { class: 'small stack', style: 'gap:2px' },
        el('span', { class: c.w9 ? '' : 'bad-text' }, c.w9 ? '📄 W-9 on file · ' : '📄 No W-9 yet', c.w9 && c.w9.url ? el('a', { href: c.w9.url, target: '_blank', rel: 'noopener' }, 'View') : null),
        pf.license_number ? el('span', { class: pf.license_expires && pf.license_expires < today ? 'bad-text' : '' }, `🪪 License ${pf.license_number}${pf.license_state ? ' (' + pf.license_state + ')' : ''}${pf.license_expires ? `, ${pf.license_expires < today ? 'ran out' : 'runs out'} ${docs.fmtDate(pf.license_expires)}` : ''}`) : null,
        pf.business ? el('span', {}, `🏢 ${pf.business}${pf.email ? ' · ' + pf.email : ''}`) : null,
        (pf.days_off || []).length || upcoming.length ? el('span', {}, `📅 ${(pf.days_off || []).length ? 'Off ' + pf.days_off.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ') : ''}${upcoming.length ? `${(pf.days_off || []).length ? ' · ' : ''}booked ${upcoming.map((d) => docs.fmtDate(d)).join(', ')}` : ''}`) : null,
        pf.service_area ? el('span', {}, `📍 ${pf.service_area}`) : null,
        rt ? el('span', {}, `⭐ ${rt.avg.toFixed(1)} from ${rt.n} job${rt.n === 1 ? '' : 's'}`) : null);
    };
    const crewItem = (c) =>
        el('div', { class: 'crew-item' + (c.active ? '' : ' inactive') },
          el('span', { class: 'avatar' }, initials(c.name)),
          el('div', { class: 'body' },
            el('b', {}, c.name), c.active ? null : el('span', { class: 'muted small' }, ' (inactive)'),
            el('p', { class: 'skill-line' + ((c.trades || []).includes('allround') ? ' all' : '') }, skillLine(c)),
            el('p', { class: 'small' }, c.state ? `${c.state} · ` : '', c.phone ? el('a', { href: telHref(c.phone) }, c.phone) : null, ` · ${activeJobs(c.id)} open job${activeJobs(c.id) === 1 ? '' : 's'}`,
              c.login === 'active' ? el('span', { class: 'pill s-completed', style: 'margin-left:6px' }, '🔑 Login') : c.login === 'invited' ? el('span', { class: 'pill s-qualifying', style: 'margin-left:6px' }, 'Invited') : null),
            insuranceLine(c), paperLine(c)),
          el('button', { class: 'ghost small', onclick: () => crewForm(c) }, 'Edit'));
    const sortC = (l) => l.slice().sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name));
    const section = (title, list, sub) => list.length ? el('section', { class: 'stack', style: 'gap:6px' },
      el('div', { class: 'month-head' }, el('b', {}, title), el('span', {}, sub || `${list.length} contractor${list.length === 1 ? '' : 's'}`)),
      el('div', { class: 'card crew' }, ...sortC(list).map(crewItem))) : null;
    let sections;
    if (crewGroupBy === 'state') {
      sections = groups.filter(([st]) => !sf || (sf === 'none' ? !st : st === sf)).map(([st]) => section(st ? `🗺 ${TH.stateName(st)}` : 'No state set', pool.filter((c) => (c.state || '') === st && (!skillFilter || c.trades.includes(skillFilter)))));
    } else {
      // Do-it-all contractors first, then the specialists for each trade (someone who does two trades shows under both).
      const shown = TH.SKILLS.filter((x) => !skillFilter || x.id === skillFilter);
      sections = shown.map((x) => section(`${x.icon} ${x.id === 'allround' ? 'Does it all (general contractors)' : x.label}`,
        pool.filter((c) => (c.trades || []).includes(x.id) && (x.id === 'allround' || !(c.trades || []).includes('allround')))));
      const none = pool.filter((c) => !(c.trades || []).length);
      if (!skillFilter && none.length) sections.push(section('No skills set yet', none));
    }
    const toggle = el('div', { class: 'seg3 group-by', role: 'radiogroup', 'aria-label': 'Group contractors by' },
      ...[['skill', '🧰 By skill'], ['state', '🗺 By state']].map(([id, label]) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(crewGroupBy === id), onclick: () => { crewGroupBy = id; render(); } }, label)));
    const list = crew.length ? el('div', { class: 'stack' }, ...sections.filter(Boolean).length ? sections.filter(Boolean) : [el('div', { class: 'card muted' }, 'No contractors match.')])
      : el('div', { class: 'card crew' }, el('p', { class: 'muted' }, 'No contractors added yet.'));
    return [el('div', { class: 'row' }, el('h2', {}, 'Your contractors'), el('span', { class: 'spacer' }), el('button', { class: 'gold small', onclick: () => crewForm() }, '+ Add')),
      toggle, el('div', { class: 'two filters' }, skillSel, crewStSel), list,
      el('p', { class: 'muted small' }, 'Contractors sign in at ', el('a', { href: 'crew.html', target: '_blank' }, new URL('crew.html', location.href).href), '. Open one to invite them.')];
  }

  function crewForm(c) {
    const editing = !!c;
    let photoCard = null;
    c = c || { name: '', phone: '', trades: [], active: true, state: '' };
    const errorBox = el('div', { class: 'error', hidden: true, role: 'alert' });
    const close = closeDrawer;

    // Crew login: invite → they set a password → they see only their own jobs.
    let loginCard = null;
    if (editing) {
      const st = c.login || 'none';
      const first = c.name.split(' ')[0];
      const inviteBox = el('div', { class: 'stack' });
      const showInvite = (code) => {
        const link = new URL(`crew.html?invite=${code}`, location.href).href;
        const msg = `Hi ${first}, here's your Top Hat crew login invite. Tap to set your password and see your jobs: ${link}`;
        inviteBox.replaceChildren(el('div', { class: 'share-box' },
          el('span', { class: 'small' }, 'Invite link. It works once, only for ' + first + ':'),
          el('div', { class: 'row' },
            ...[c.phone ? el('a', { class: 'btn gold small', style: 'flex:1', href: smsHref(c.phone, msg) }, '💬 Text invite') : null,
              el('button', { type: 'button', class: 'ghost small', style: 'flex:1', onclick: async (e) => {
                try { await navigator.clipboard.writeText(link); e.currentTarget.textContent = 'Copied ✓'; } catch { prompt('Copy this invite link:', link); }
              } }, 'Copy link')].filter(Boolean))));
      };
      if (st === 'invited' && c.inviteCode) showInvite(c.inviteCode);
      const refresh = async () => { await load(); crewForm(crew.find((x) => x.id === c.id)); };
      // Their photo: customers see it next to "Project manager" (they can add it themselves in My info too).
      const ph = (c.profile && c.profile.photo) || '';
      const phInput = el('input', { type: 'file', accept: 'image/*', 'aria-label': `Photo of ${c.name}`, onchange: async (e) => {
        const f = e.target.files[0]; if (!f) return;
        try { await api.contractors.setPhoto(c.id, await TH.shrinkImage(f, 320, 0.8)); await refresh(); } catch (err) { errorBox.textContent = err.message; errorBox.hidden = false; }
      } });
      photoCard = el('section', { class: 'card stack', style: 'margin-top:6px' },
        el('h3', {}, '📸 Photo'),
        el('div', { class: 'row', style: 'gap:14px;align-items:center' },
          ph ? el('img', { class: 'pm-photo big', src: ph, alt: c.name }) : el('span', { class: 'pm-photo big initials' }, initials(c.name)),
          el('div', { class: 'stack', style: 'gap:6px;flex:1' },
            el('p', { class: 'muted small', style: 'margin:0' }, `Customers see this next to “Project manager” when ${first} is on their job.`),
            el('label', { class: 'btn ghost small', style: 'align-self:flex-start' }, ph ? 'Change photo' : 'Add a photo', phInput),
            ph ? el('button', { type: 'button', class: 'link small', style: 'align-self:flex-start;color:var(--bad)', onclick: async () => { await api.contractors.setPhoto(c.id, ''); await refresh(); } }, 'Remove photo') : null)));
      loginCard = el('section', { class: 'card stack', style: 'margin-top:6px' },
        el('div', { class: 'row' }, el('h3', {}, '🔑 Crew login'), el('span', { class: 'spacer' }),
          el('span', { class: 'pill ' + (st === 'active' ? 's-completed' : st === 'invited' ? 's-qualifying' : '') }, st === 'active' ? 'Active' : st === 'invited' ? 'Invite sent' : 'No login')),
        el('p', { class: 'muted small' }, st === 'active'
          ? `${first} signs in on the crew page with ${c.loginEmail}. They see only their own jobs${settings.showCrewPay !== false ? ' and their pay' : ''}, never customer prices.`
          : `Invite ${first} to set up a login. They’ll see all their jobs in one place, send photos, and mark jobs started or finished. They never see customer prices.`),
        inviteBox,
        st !== 'active' ? el('button', { type: 'button', class: st === 'invited' ? 'ghost' : 'gold', onclick: async (e) => {
          e.currentTarget.disabled = true;
          try { await api.contractors.invite(c.id); await refresh(); }
          catch (err) { errorBox.textContent = err.message; errorBox.hidden = false; e.currentTarget.disabled = false; }
        } }, st === 'invited' ? 'Make a new invite link (old one stops working)' : 'Create invite link') : null,
        st !== 'none' ? el('button', { type: 'button', class: 'link', style: 'color:var(--bad)', onclick: async () => {
          if (!confirm(st === 'active' ? `Turn off ${first}'s crew login? They won't be able to sign in until you invite them again.` : 'Cancel this invite?')) return;
          await api.contractors.revokeLogin(c.id); await refresh();
        } }, st === 'active' ? 'Turn off login' : 'Cancel invite') : null,
      );
    }

    // Job history: every job this contractor finished, by month, with crew pay (for paying them).
    let historyCard = null;
    if (editing) {
      const doneAt = (j) => j.finishedAt || (j.scheduledFor ? Date.parse(j.scheduledFor) : j.created);
      const done = jobs.filter((j) => j.contractorId === c.id && j.status === 'completed').sort((a, b) => doneAt(b) - doneAt(a));
      const upcoming = jobs.filter((j) => j.contractorId === c.id && ['scheduled', 'in_progress'].includes(j.status));
      const groups = [];
      done.forEach((j) => { const x = new Date(doneAt(j)); const k = `${x.getFullYear()}-${x.getMonth()}`; let g = groups.find((y) => y.k === k); if (!g) { g = { k, d: x, jobs: [] }; groups.push(g); } g.jobs.push(j); });
      const payOf = (list) => list.reduce((t, j) => t + (Number(j.crewPay) || 0), 0);
      historyCard = el('section', { class: 'card stack' },
        el('h3', {}, '🧾 Job history'),
        el('div', { class: 'kpis three' },
          el('div', { class: 'kpi' }, el('b', {}, String(done.length)), el('span', {}, 'Completed')),
          el('div', { class: 'kpi' }, el('b', {}, String(upcoming.length)), el('span', {}, 'Upcoming')),
          el('div', { class: 'kpi' }, el('b', {}, money(payOf(done))), el('span', {}, 'Total crew pay')),
          el('div', { class: 'kpi' }, el('b', {}, money(done.reduce((t, j) => t + crewPaidOn(j), 0))), el('span', {}, 'Paid out')),
          el('div', { class: 'kpi' }, el('b', {}, money(done.reduce((t, j) => t + Math.max(0, crewOwedTotal(j) - crewPaidOn(j)), 0))), el('span', {}, 'Still to pay'))),
        done.length ? el('button', { type: 'button', class: 'ghost block', onclick: () => downloadJobs(done, `${c.name}-jobs`) }, `⬇ Spreadsheet of ${c.name.split(' ')[0]}’s jobs`) : el('p', { class: 'muted small' }, 'No completed jobs yet.'),
        ...groups.map((g) => el('div', { class: 'stack', style: 'gap:6px' },
          el('div', { class: 'month-head' }, el('b', {}, g.d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })),
            el('span', {}, `${g.jobs.length} job${g.jobs.length === 1 ? '' : 's'} · ${money(payOf(g.jobs))}`)),
          ...g.jobs.map((j) => el('button', { type: 'button', class: 'doc-row', onclick: () => openLead(j.id, 'overview') },
            el('span', { class: 'ic' }, tradeOf(j.trade).icon),
            el('span', { class: 'body' }, el('b', {}, `${jobNo(j)} · ${j.buyer.name}`),
              el('span', { class: 'muted small' }, `${new Date(doneAt(j)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${j.address}`)),
            el('span', { class: 'pill' + (j.crewPay == null ? ' s-new' : j.crewPaid ? ' s-completed' : '') }, j.crewPay == null ? 'No pay set' : `${money(j.crewPay)}${j.crewPaid ? ' ✓ paid' : ''}`))))));
    }

    const form = el('form', { class: 'panel-body', onsubmit: async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      try {
        await api.contractors.save({ ...(editing ? { id: c.id } : {}), name: f.get('name').trim(), phone: f.get('phone').trim(), state: f.get('state') || '', trades: f.getAll('trades'), active: f.get('active') === 'on' });
        await load(); close();
      } catch (err) { errorBox.textContent = err.message; errorBox.hidden = false; }
    } },
      errorBox,
      el('label', { class: 'field' }, 'Name', el('input', { name: 'name', value: c.name, required: true, autocomplete: 'off' })),
      el('label', { class: 'field' }, 'Phone', el('input', { name: 'phone', type: 'tel', value: c.phone, autocomplete: 'off' })),
      el('label', { class: 'field' }, 'State they work in', el('select', { name: 'state' }, ...stateOptions(c.state || ''))),
      el('div', { class: 'field' }, el('b', { style: 'font-size:.92rem' }, 'Skills'), el('span', { class: 'hint' }, 'Pick “Does it all” for general contractors, or just what they specialize in (e.g. only Concrete).'),
        el('div', { class: 'choices', style: 'margin-top:6px' }, ...TH.SKILLS.map((t) =>
          el('label', { class: 'choice' }, el('input', { type: 'checkbox', name: 'trades', value: t.id, checked: c.trades.includes(t.id) }), el('span', {}, `${t.icon} ${t.label}`))))),
      el('label', { class: 'row', style: 'font-weight:600' }, el('input', { type: 'checkbox', name: 'active', checked: c.active, style: 'width:22px;height:22px' }), 'Active (can be assigned jobs)'),
      el('button', { type: 'submit' }, editing ? 'Save' : 'Add to crew'),
      photoCard, loginCard,
      historyCard,
      editing ? el('button', { type: 'button', class: 'link', style: 'color:var(--bad)', onclick: async () => {
        if (!confirm(`Remove ${c.name} from your crew? Their jobs will become unassigned.`)) return;
        await api.contractors.remove(c.id); await load(); close();
      } }, 'Remove from crew') : null,
    );
    drawerRoot.replaceChildren(el('div', { class: 'drawer', onclick: (e) => { if (e.target === e.currentTarget) close(); } },
      el('div', { class: 'panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': editing ? 'Edit crew member' : 'Add crew member' },
        el('div', { class: 'panel-head' }, el('button', { class: 'ghost small', onclick: close }, '← Back'), el('b', {}, editing ? 'Edit crew member' : 'Add crew member')),
        form)));
    document.body.style.overflow = 'hidden';
  }

  boot();
})();
