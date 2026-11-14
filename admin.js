'use strict';
/* Top Hat staff area: qualify leads, schedule jobs, assign crews. */
(function () {
  const { api, TRADES, TIMEFRAMES, BUDGETS, STATUSES, FILE_KINDS, PHOTO_STAGES, el, ago, fmtWhen, find } = TH;
  const view = document.getElementById('view');
  const drawerRoot = document.getElementById('drawerRoot');
  const OPEN = ['new', 'qualifying', 'scheduled', 'in_progress'];

  let tab = 'today';
  let filter = 'open';
  let search = '';
  let jobs = [];
  let crew = [];
  let settings = {};
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
    if (!me || me.role !== 'staff') {
      nav.replaceChildren(el('a', { class: 'btn ghost small', href: 'index.html' }, 'Customer site'));
      return loginView(me);
    }
    nav.replaceChildren(
      el('a', { class: 'btn ghost small', href: 'index.html', target: '_blank' }, 'Customer site'),
      el('button', { class: 'link small', onclick: async () => { await api.auth.signOut(); location.reload(); } }, 'Log out'),
    );
    await load();
    render();
  }
  async function load() { [jobs, crew, settings] = await Promise.all([api.jobs.all(), api.contractors.list(), api.settings.get()]); }

  function loginView(me) {
    view.replaceChildren(TH.loginForm({ note: me ? `You're signed in as ${me.email}, which isn't a staff account. Log in with a staff account, or open your own area.` : '' }));
  }

  /* ---------- main ---------- */
  const MAIN_TABS = [['today', 'Today'], ['jobs', 'Jobs'], ['crew', 'Crew'], ['business', 'Business']];
  if (MAIN_TABS.some(([id]) => id === location.hash.slice(1))) tab = location.hash.slice(1);

  // What needs attention, grouped in plain language. Shared by Today and the job cards.
  const hasNewNote = (j) => (j.crewNotes || []).some((n) => n.at > (j.crewNotesSeenAt || 0));
  // Anything new from the crew: a note, or a progress update they made.
  const crewUpdatedAt = (j) => (j.progressByCrew && j.progressAt > (j.crewNotesSeenAt || 0) ? j.progressAt : 0);
  const hasCrewNews = (j) => hasNewNote(j) || !!crewUpdatedAt(j);
  const stageOf = (id) => (TH.STAGES || []).find((x) => x.id === id);
  const progressText = (j) => (j.stage ? `${stageOf(j.stage).icon} ${stageOf(j.stage).label}` : ({ scheduled: 'Scheduled', in_progress: 'Working', completed: 'Done' })[j.status] || statusOf(j.status).label);
  const estWith = (j, st) => (j.docs || []).find((d) => d.type === 'estimate' && d.status === st);
  const liveInvoices = (j) => (j.docs || []).filter((d) => d.type === 'invoice' && d.status !== 'void');
  const needsInvoice = (j) => j.status === 'completed' && !liveInvoices(j).some((d) => d.status !== 'draft');
  const needsScheduling = (j) => ['new', 'qualifying'].includes(j.status) && !!estWith(j, 'approved');
  const dayKey = (ms) => { const x = new Date(ms); return new Date(x - x.getTimezoneOffset() * 60e3).toISOString().slice(0, 10); };
  const timeOf = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const crewName = (j) => find(crew, j.contractorId)?.name;

  function buckets() {
    const open = jobs.filter((j) => j.status !== 'lost');
    const today = dayKey(Date.now()), tomorrow = dayKey(Date.now() + 86400e3);
    return [
      { id: 'new', icon: '🔔', title: 'New leads to call', why: 'Call them to talk through the job.', call: true,
        list: open.filter((j) => j.status === 'new').sort((a, b) => a.created - b.created),
        line: (j) => `${tradeOf(j.trade).label} · came in ${ago(j.created)}` },
      { id: 'declined', icon: '🙅', title: 'Crew can’t make it', why: 'Pick another crew or a new date.',
        list: open.filter((j) => j.status === 'scheduled' && j.crewResponse === 'declined'),
        line: (j) => `${crewName(j) || 'Crew'}: “${j.crewResponseNote || 'no reason given'}”` },
      { id: 'notes', icon: '👷', title: 'New updates from your crew', why: 'Progress updates and notes from the job.',
        list: jobs.filter(hasCrewNews).sort((a, b) => Math.max(crewUpdatedAt(b), 0) - Math.max(crewUpdatedAt(a), 0)),
        line: (j) => [crewUpdatedAt(j) ? `${j.progressBy}: ${progressText(j)}` : null, hasNewNote(j) ? 'new note' : null].filter(Boolean).join(' · ') },
      { id: 'schedule', icon: '✅', title: 'Approved: needs a crew & date', why: 'The customer said yes. Pick who’s doing it and when.',
        list: open.filter(needsScheduling), line: (j) => `${tradeOf(j.trade).label}${j.price != null ? ' · ' + money(j.price) : ''}` },
      { id: 'invoice', icon: '🏁', title: 'Finished: send the invoice', why: 'The work is done but no invoice has gone out.',
        list: jobs.filter(needsInvoice), line: (j) => `${tradeOf(j.trade).label}${j.price != null ? ' · ' + money(j.price) : ''}` },
      { id: 'unpaid', icon: '💵', title: 'Waiting for payment', why: 'Invoices with money still owed.',
        list: jobs.filter((j) => owedOn(j) > 0).sort((a, b) => owedOn(b) - owedOn(a)),
        line: (j) => `${docs.usd(owedOn(j))} due${liveInvoices(j).some((d) => docs.state(d) === 'overdue') ? ' · OVERDUE' : ''}` },
      { id: 'waiting', icon: '⏳', title: 'Waiting on the customer', why: 'Estimates sent, not approved yet.', info: true,
        list: open.filter((j) => estWith(j, 'sent')), line: (j) => `${estWith(j, 'sent').number} · ${docs.usd(docs.totals(estWith(j, 'sent')).total)}` },
      { id: 'soon', icon: '📅', title: 'On the schedule today & tomorrow', why: 'Make sure the crew is set.', info: true,
        list: open.filter((j) => ['scheduled', 'in_progress'].includes(j.status) && j.scheduledFor && [today, tomorrow].includes(j.scheduledFor.slice(0, 10)))
          .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor)),
        line: (j) => `${j.scheduledFor.slice(0, 10) === today ? 'Today' : 'Tomorrow'} ${timeOf(j.scheduledFor)} · ${crewName(j) || 'No crew yet'}` },
    ];
  }
  const attentionCount = () => buckets().filter((b) => !b.info).reduce((t, b) => t + b.list.length, 0);

  function render() {
    const todo = attentionCount();
    const newCount = jobs.filter((j) => j.status === 'new').length;
    const tabs = el('div', { class: 'tabs-bar main-tabs', role: 'tablist', style: 'margin-top:8px' },
      ...MAIN_TABS.map(([id, label]) => el('button', { role: 'tab', 'aria-current': String(tab === id), onclick: () => { tab = id; history.replaceState(null, '', '#' + id); render(); } },
        label,
        id === 'today' && todo ? el('span', { class: 'count hot' }, String(todo)) : null,
        id === 'jobs' && newCount ? el('span', { class: 'count' }, String(newCount)) : null)));
    const body = tab === 'today' ? todayView() : tab === 'jobs' ? leadsView() : tab === 'crew' ? crewView() : businessView();
    view.replaceChildren(tabs, el('div', { class: 'stack', style: 'margin:16px 0' }, body));
  }

  /* ---------- today ---------- */
  function todayView() {
    const bs = buckets();
    const today = dayKey(Date.now()), weekEnd = dayKey(Date.now() + 7 * 86400e3);
    const thisWeek = jobs.filter((j) => ['scheduled', 'in_progress'].includes(j.status) && j.scheduledFor && j.scheduledFor.slice(0, 10) >= today && j.scheduledFor.slice(0, 10) <= weekEnd).length;
    const kpi = (v, k) => el('div', { class: 'kpi' }, el('b', {}, String(v)), el('span', {}, k));
    const h = new Date().getHours();
    const sections = bs.filter((b) => b.list.length).map((b) => el('section', { class: 'card todo' + (b.info ? ' info' : '') },
      el('div', { class: 'todo-head' },
        el('span', { class: 'todo-ic' }, b.icon),
        el('div', { style: 'flex:1;min-width:0' }, el('h3', {}, b.title), el('p', { class: 'muted small' }, b.why)),
        el('span', { class: 'todo-count' }, String(b.list.length))),
      el('div', { class: 'todo-list' }, ...b.list.slice(0, 8).map((j) => el('div', { class: 'todo-row' },
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
      el('div', { class: 'kpis three' }, kpi(bs[0].list.length, 'New leads'), kpi(thisWeek, 'Jobs this week'), kpi(docs.usd(jobs.reduce((t, j) => t + owedOn(j), 0)), 'Owed to you')),
      ...(sections.length ? sections : [el('div', { class: 'card caught-up' },
        el('div', { style: 'font-size:2.4rem' }, '🎉'), el('h2', {}, 'All caught up'), el('p', { class: 'muted' }, 'Nothing needs your attention right now.'))]),
      el('button', { class: 'ghost block', onclick: () => { tab = 'jobs'; history.replaceState(null, '', '#jobs'); render(); } }, 'See all jobs →'),
    ];
  }

  /* ---------- jobs list ---------- */
  const FILTERS = [
    ['open', 'Open', (j) => OPEN.includes(j.status) || needsInvoice(j) || owedOn(j) > 0], // not finished until invoiced and paid
    ['new', 'New', (j) => j.status === 'new'],
    ['active', 'Scheduled', (j) => ['scheduled', 'in_progress'].includes(j.status)],
    ['completed', 'Done', (j) => j.status === 'completed'],
    ['lost', 'Closed', (j) => j.status === 'lost'],
    ['all', 'All', () => true],
  ];
  function leadsView() {
    if (!FILTERS.some(([id]) => id === filter)) filter = 'open';
    const filterBar = el('div', { class: 'tabs-bar' }, ...FILTERS.map(([id, label, fn]) =>
      el('button', { 'aria-current': String(filter === id), onclick: () => { filter = id; render(); } }, label, el('span', { class: 'count' }, String(jobs.filter(fn).length)))));
    const matches = (j, q) => !q || [jobNo(j), String(j.number), j.buyer.name, j.buyer.phone, j.buyer.email, j.address, j.zip, j.description, tradeOf(j.trade).label].join(' ').toLowerCase().includes(q);
    const inFilter = FILTERS.find(([id]) => id === filter)[2];
    const renderList = () => {
      const q = search.trim().toLowerCase();
      const list = jobs.filter((j) => inFilter(j) && matches(j, q));
      return el('div', { class: 'leads' },
        list.length ? list.map(leadCard) : [el('div', { class: 'card muted' }, q ? 'No jobs match your search.' : 'No jobs here right now.')]);
    };
    let listWrap = renderList();
    const searchBox = el('input', { type: 'search', placeholder: 'Search name, phone, address, job #…', value: search, 'aria-label': 'Search jobs',
      oninput: (e) => { search = e.target.value; const list = renderList(); listWrap.replaceWith(list); listWrap = list; } });
    return [el('div', { class: 'row' }, el('h2', { style: 'flex:1' }, 'Jobs'), el('button', { class: 'gold', onclick: () => newJobForm() }, '+ New job')), filterBar, searchBox, listWrap];
  }

  function leadCard(j) {
    const t = tradeOf(j.trade);
    const c = find(crew, j.contractorId);
    const flags = [
      j.status === 'scheduled' && j.crewResponse === 'declined' ? ['🙅 Crew can’t make it', 'hot'] : null,
      j.status === 'scheduled' && j.contractorId && !j.crewResponse ? ['⏳ Crew hasn’t confirmed', ''] : null,
      hasCrewNews(j) ? ['👷 New crew update', 'hot'] : null,
      j.stage ? [`${stageOf(j.stage).icon} ${stageOf(j.stage).label}`, ''] : null,
      needsScheduling(j) ? ['✅ Approved, needs scheduling', 'hot'] : null,
      needsInvoice(j) ? ['🏁 Needs invoice', 'hot'] : null,
      owedOn(j) > 0 ? [`💵 ${docs.usd(owedOn(j))} due`, 'hot'] : null,
      estWith(j, 'sent') ? ['⏳ Estimate sent', ''] : null,
    ].filter(Boolean);
    return el('button', { class: 'lead' + (j.status === 'new' ? ' new-dot' : ''), onclick: () => openLead(j.id) },
      el('span', { class: 'ic' }, t.icon),
      el('span', { class: 'body' },
        el('span', { class: 'line1' }, el('b', {}, j.buyer.name), el('span', { class: 'spacer' }), el('span', { class: `pill s-${j.status}` }, statusOf(j.status).label)),
        el('span', { class: 'muted small' }, `${t.label} · ${jobNo(j)} · ${j.zip || j.address}${j.status === 'new' ? ' · ' + ago(j.created) : ''}`),
        j.scheduledFor || c ? el('span', { class: 'small' }, [j.scheduledFor ? '📅 ' + fmtWhen(j.scheduledFor) : null, c ? '👷 ' + c.name : null].filter(Boolean).join('   ')) : null,
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
    const [files, history, jobDocs, crewNotes] = await Promise.all([api.files.list(j.id), api.jobs.log(j.id), api.docs.list(j.id), api.jobs.crewNotes(j.id)]);
    j.crewNotesSeenAt = Date.now(); // opened → no longer "new"
    fileUrls = files.map((f) => f.url).filter(Boolean);
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
    const summary = el('section', { class: 'card stack summary' },
      el('div', { class: 'row' }, el('span', { class: 'avatar' }, initials(b.name)),
        el('div', { style: 'flex:1;min-width:0' }, el('h2', {}, b.name), el('p', { class: 'muted small' }, `${t.icon} ${t.label} · ${jobNo(j)}`))),
      el('div', { class: 'contact' },
        b.phone ? el('a', { class: 'btn ghost small', href: telHref(b.phone) }, '📞 Call') : null,
        b.phone ? el('a', { class: 'btn ghost small', href: smsHref(b.phone) }, '💬 Text') : null,
        b.email ? el('a', { class: 'btn ghost small', href: `mailto:${b.email}?subject=${encodeURIComponent('Your ' + t.label.toLowerCase() + ' request with Top Hat Contracting')}` }, '✉️ Email') : null),
      el('ul', { class: 'facts' },
        el('li', {}, el('span', { class: 'fi' }, '📍'), el('a', { href: 'https://maps.google.com/?q=' + encodeURIComponent(`${j.address} ${j.zip}`), target: '_blank', rel: 'noopener' }, `${j.address} ${j.zip}`)),
        el('li', {}, el('span', { class: 'fi' }, '📅'), j.scheduledFor ? el('span', {}, fmtWhen(j.scheduledFor)) : el('span', { class: 'muted' }, 'Not scheduled yet')),
        el('li', {}, el('span', { class: 'fi' }, '👷'), assigned ? el('span', {}, assigned.name,
          j.status === 'scheduled' ? el('span', { class: j.crewResponse === 'declined' ? 'bad-text' : 'muted' },
            j.crewResponse === 'confirmed' ? ' · ✓ confirmed' : j.crewResponse === 'declined' ? ` · can’t make it: “${j.crewResponseNote}”` : ' · not confirmed yet') : null)
          : el('span', { class: 'muted' }, 'No crew yet')),
        j.startedAt ? el('li', {}, el('span', { class: 'fi' }, '⏱'), el('span', {},
          `Started ${new Date(j.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`,
          j.finishedAt ? ` · finished after ${(() => { const m = Math.round((j.finishedAt - j.startedAt) / 60000); return m < 60 ? m + ' min' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm'; })()}` : '')) : null,
        el('li', {}, el('span', { class: 'fi' }, '💲'), j.price != null
          ? el('span', {}, `${money(j.price)} customer price`, j.crewPay != null ? el('span', { class: 'muted' }, ` · ${money(j.price - j.crewPay)} profit`) : null)
          : el('span', { class: 'muted' }, 'No price yet'))),
    );

    // What the customer asked for
    const details = el('section', { class: 'card stack' },
      el('h3', {}, 'What the customer asked for'),
      el('p', { style: 'white-space:pre-wrap' }, j.description),
      el('dl', { class: 'dl' },
        el('dt', {}, 'Needed'), el('dd', {}, find(TIMEFRAMES, j.timeframe)?.label || '—'),
        el('dt', {}, 'Budget'), el('dd', {}, find(BUDGETS, j.budget)?.label || 'Not sure yet'),
        el('dt', {}, 'Requested'), el('dd', {}, `${new Date(j.created).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} (${ago(j.created)})`)),
    );

    // Progress: tap a step to change it.
    const FLOW = [['new', 'New'], ['qualifying', 'Qualifying'], ['scheduled', 'Scheduled'], ['in_progress', 'Working'], ['completed', 'Done']];
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
        el('p', { class: 'muted small', style: 'flex:1' }, j.status === 'lost' ? 'Closed as “Not a fit”. Tap a step to reopen.' : `The customer sees: “${j.stage ? stageOf(j.stage).buyer : statusOf(j.status).buyer}”`),
        j.status !== 'lost' ? el('button', { type: 'button', class: 'link small', style: 'color:var(--bad)', onclick: () => { if (confirm('Close this job as “Not a fit”?')) update({ status: 'lost' }); } }, 'Not a fit') : null),
    );

    // Crew & schedule
    const sortedCrew = crew.filter((c) => c.active || c.id === j.contractorId)
      .sort((a, c) => (c.trades.includes(j.trade) - a.trades.includes(j.trade)) || a.name.localeCompare(c.name));
    const crewSel = el('select', { name: 'contractorId' },
      el('option', { value: '' }, '— Not assigned —'),
      ...sortedCrew.map((c) => el('option', { value: c.id, selected: c.id === j.contractorId }, `${c.trades.includes(j.trade) ? '★ ' : ''}${c.name}`)));
    const whenInput = el('input', { type: 'datetime-local', name: 'scheduledFor', value: j.scheduledFor || '' });
    const crewLink = j.crewToken ? new URL(`crew.html?t=${j.crewToken}`, location.href).href : null;
    // Sent to the crew lead. Never include prices, budget or notes here.
    const dispatchText = assigned && [
      `Top Hat job ${jobNo(j)}: ${t.label}`,
      j.scheduledFor ? `When: ${fmtWhen(j.scheduledFor)}` : null,
      `Customer: ${b.name} ${b.phone}`,
      `Address: ${j.address} ${j.zip}`,
      `Details: ${j.description}`,
      crewLink ? `Upload job photos here: ${crewLink}` : null,
    ].filter(Boolean).join('\n');
    const setup = el('form', { class: 'card stack', onsubmit: (e) => {
      e.preventDefault();
      const patch = { contractorId: crewSel.value || null, scheduledFor: whenInput.value || null };
      if (patch.contractorId && patch.scheduledFor && ['new', 'qualifying'].includes(j.status)) patch.status = 'scheduled';
      update(patch);
    } },
      el('h3', {}, '👷 Crew & schedule'),
      el('label', { class: 'field' }, 'Crew', el('span', { class: 'hint' }, '★ = does this kind of work'), crewSel),
      el('label', { class: 'field' }, 'Date & time', whenInput),
      el('button', { type: 'submit' }, 'Save crew & date'),
      el('p', { class: 'muted small' }, 'Picking a crew and a date moves the job to “Scheduled”.'),
      assigned?.phone ? el('a', { class: 'btn ghost', href: smsHref(assigned.phone, dispatchText) }, `💬 Text job details to ${assigned.name.split(' ')[0]}`) : null,
      crewLink ? el('div', { class: 'crew-link' },
        el('span', { class: 'small' }, `📷 ${assigned ? assigned.name.split(' ')[0] + '’s' : 'Crew'} photo link`),
        el('button', { type: 'button', class: 'ghost small', onclick: async (e) => {
          try { await navigator.clipboard.writeText(crewLink); e.target.textContent = 'Copied ✓'; }
          catch { prompt('Copy this link:', crewLink); }
        } }, 'Copy link')) : null,
    );
    const focusSetup = () => { leadTab = 'overview'; renderTab(); setup.scrollIntoView({ block: 'start', behavior: 'smooth' }); crewSel.focus(); };

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
      update({ price, crewPay });
    } },
      el('div', { class: 'row' }, el('h3', {}, 'Prices'), el('span', { class: 'spacer' }), el('span', { class: 'pill lock' }, '🔒 Staff only')),
      el('div', { class: 'two' },
        el('label', { class: 'field' }, 'Customer price', el('span', { class: 'hint' }, 'What the customer pays'), priceInput),
        el('label', { class: 'field' }, 'Crew pay', el('span', { class: 'hint' }, 'What you pay the crew'), payInput)),
      profitOut,
      el('button', { type: 'submit' }, 'Save prices'),
      el('p', { class: 'muted small' }, 'The crew never sees the customer price or your profit. The customer never sees crew pay.'),
    );

    // Estimates & invoices
    const approvedEst = jobDocs.find((x) => x.type === 'estimate' && x.status === 'approved');
    const invoiceBase = approvedEst && !jobDocs.some((x) => x.type === 'invoice' && x.fromEstimateId === approvedEst.id) ? approvedEst : null;
    const docsCard = el('section', { class: 'card stack' },
      el('h3', {}, 'Estimates & invoices'),
      jobDocs.length ? el('div', { class: 'doc-list' }, ...jobDocs.map((dc) => {
        const tt = docs.totals(dc);
        return el('button', { type: 'button', class: 'doc-row', onclick: () => openDoc(j.id, dc.id) },
          el('span', { class: 'ic' }, dc.type === 'invoice' ? '🧾' : '📝'),
          el('span', { class: 'body' }, el('b', {}, dc.number),
            el('span', { class: 'muted small' }, dc.type === 'invoice' && !['draft', 'void'].includes(dc.status) ? `${docs.usd(tt.total)} · ${docs.usd(Math.max(0, tt.balance))} due` : docs.usd(tt.total))),
          el('span', { class: `pill ${docs.pillClass(dc)}` }, docs.label(dc)));
      })) : el('p', { class: 'muted small' }, 'None yet. They’re filled in with this job’s details. Crew pay never appears on them.'),
      el('div', { class: 'row' },
        el('button', { type: 'button', class: 'ghost', style: 'flex:1', onclick: () => openDoc(j.id, null, 'estimate') }, '+ Estimate'),
        el('button', { type: 'button', class: 'ghost', style: 'flex:1', onclick: () => openDoc(j.id, null, 'invoice', invoiceBase) }, '+ Invoice')),
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
              f.stage ? el('span', { class: 'pill' }, (find(PHOTO_STAGES, f.stage) || {}).label || f.stage) : null,
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
    } else if (j.status === 'new') {
      step = { icon: '📞', title: `Call ${first} about the job`, why: 'Talk through the work and answer questions. Then mark it Qualifying.',
        href: b.phone ? telHref(b.phone) : b.email ? `mailto:${b.email}` : null, label: b.phone ? `📞 Call ${first}` : `✉️ Email ${first}`,
        second: ['Done: mark as Qualifying', () => update({ status: 'qualifying' })] };
    } else if (j.status === 'qualifying' && !approvedEst) {
      if (sentEst) step = { icon: '⏳', title: `Waiting for ${first} to approve ${sentEst.number}`,
        why: j.hasAccount ? 'They can approve it on their My jobs page. Nudge them with a text.' : `${first} doesn’t use the app. When they say yes, open the estimate and tap “Mark approved”.`,
        href: b.phone ? smsHref(b.phone, j.hasAccount
          ? `Hi ${first}, just checking in on estimate ${sentEst.number} from ${settings.name || 'Top Hat Contracting'}. You can view and approve it here: ${siteUrl()}#/jobs`
          : `Hi ${first}, just checking in on estimate ${sentEst.number} from ${settings.name || 'Top Hat Contracting'} (${docs.usd(docs.totals(sentEst).total)}). Reply YES to approve, or call us with any questions.`) : null,
        label: `💬 Remind ${first}`, second: ['Open the estimate', () => openDoc(j.id, sentEst.id)] };
      else if (draftEst) step = { icon: '📝', title: `Finish and send estimate ${draftEst.number}`, why: 'It’s saved as a draft. The customer can’t see it yet.', act: ['Open the estimate', () => openDoc(j.id, draftEst.id)] };
      else step = { icon: '📝', title: 'Send an estimate', why: `Put together the price for ${first}. They can approve it with one tap.`,
        act: ['+ Create estimate', () => openDoc(j.id, null, 'estimate')], second: ['Skip the estimate: schedule now', focusSetup] };
    } else if (['new', 'qualifying'].includes(j.status) && approvedEst) {
      step = { icon: '✅', title: `${first} approved ${approvedEst.number}: schedule a crew`, why: 'Pick who’s doing the work and when.', act: ['Pick crew & date', focusSetup] };
    } else if (j.status === 'scheduled') {
      if (!assigned || !j.scheduledFor) step = { icon: '👷', title: 'Pick a crew and a date', act: ['Pick crew & date', focusSetup] };
      else if (j.crewResponse === 'declined') step = { icon: '🙅', title: `${crewFirst} can’t make it`, why: j.crewResponseNote ? `“${j.crewResponseNote}”` : 'Pick another crew or a new date.', act: ['Pick another crew or date', focusSetup] };
      else if (j.stage === 'on_the_way') step = { icon: '🚚', title: `${crewFirst} is on the way`, why: 'They’ll mark the work started when they get there. You can too.', act: ['▶ Work has started', () => update({ status: 'in_progress' })] };
      else step = { icon: '📲', title: `Send the job to ${crewFirst}`, why: 'Texts them the date, address, customer phone, job details and photo link. Never prices.',
        href: assigned.phone ? smsHref(assigned.phone, dispatchText) : null, label: `💬 Text job to ${crewFirst}`, second: ['Work has started', () => update({ status: 'in_progress' })] };
    } else if (j.status === 'in_progress' && j.stage === 'waiting_parts') {
      step = { icon: '⏸', title: 'Paused: waiting on materials', why: 'Check the crew notes for what’s needed. Resume when the materials are in.', act: ['▶ Work resumed', () => update({ stage: null })] };
    } else if (j.status === 'in_progress' && j.stage === 'return_visit') {
      step = { icon: '🔁', title: 'Needs another visit', why: 'Set the date for the return visit, then let the customer know.', act: ['Pick the return date', focusSetup], second: ['Back to work (no visit needed)', () => update({ stage: null })] };
    } else if (j.status === 'in_progress') {
      step = { icon: '🔨', title: 'Work in progress', why: `${crewFirst || 'The crew'} can update progress from their crew login, or you can here.`, act: ['✓ Mark job finished', () => update({ status: 'completed' })] };
    } else if (j.status === 'completed') {
      if (owedInv) step = { icon: '💵', title: `Collect payment: ${docs.usd(docs.owed(owedInv))} due`, why: `Record it when ${first} pays: cash, check, Zelle, card, Venmo or Cash App.`, act: ['Record a payment', () => openDoc(j.id, owedInv.id)] };
      else if (draftInv) step = { icon: '🧾', title: `Finish and send invoice ${draftInv.number}`, act: ['Open the invoice', () => openDoc(j.id, draftInv.id)] };
      else if (!invs.length) step = { icon: '🧾', title: 'Job finished: send the invoice', why: invoiceBase ? `It starts from approved estimate ${invoiceBase.number}.` : 'Add the work and the total.', act: ['+ Create invoice', () => openDoc(j.id, null, 'invoice', invoiceBase)] };
      else step = { icon: '🎉', title: 'All done: paid in full', why: 'Nice work.' };
    }
    const nextCard = step ? el('section', { class: 'card next-step' },
      el('span', { class: 'eyebrow' }, 'Next step'),
      el('div', { class: 'row', style: 'align-items:flex-start' }, el('span', { class: 'next-ic' }, step.icon),
        el('div', { style: 'flex:1;min-width:0' }, el('h3', {}, step.title), step.why ? el('p', { class: 'muted small' }, step.why) : null)),
      step.href ? el('a', { class: 'btn gold block', href: step.href }, step.label)
        : step.act ? el('button', { type: 'button', class: (step.ghost ? 'ghost' : 'gold') + ' block', onclick: step.act[1] }, step.act[0]) : null,
      step.second ? el('button', { type: 'button', class: 'link', onclick: step.second[1] }, step.second[0]) : null,
    ) : null;

    // Tabs keep the job short and easy to scan.
    const TABS = [['overview', 'Overview'], ['money', 'Money'], ['files', `Files${files.length ? ` (${files.length})` : ''}`], ['history', 'Notes & history']];
    const tabsBar = el('div', { class: 'tabs-bar lead-tabs', role: 'tablist' });
    const tabBody = el('div', { class: 'stack' });
    function renderTab() {
      tabsBar.replaceChildren(...TABS.map(([id, label]) => el('button', { role: 'tab', 'aria-current': String(leadTab === id), onclick: () => { leadTab = id; renderTab(); } }, label)));
      const content = {
        overview: [nextCard, progress, crewNotes.length ? crewNotesCard() : null, setup, details],
        money: [moneyCard, docsCard],
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

  /* ---------- office enters a new job (phone call, walk-in…) ---------- */
  function newJobForm() {
    // Customers who already have an app account (so the job shows on their My jobs page).
    const accounts = [...new Map(jobs.filter((j) => j.hasAccount && j.buyerId).map((j) => [j.buyerId, { id: j.buyerId, ...j.buyer }])).values()];
    const digitsOf = (v) => String(v || '').replace(/\D/g, '');
    const errorBox = el('div', { class: 'error', hidden: true, role: 'alert' });
    const nameIn = el('input', { name: 'name', autocomplete: 'off', required: true });
    const phoneIn = el('input', { name: 'phone', type: 'tel', inputmode: 'tel', autocomplete: 'off', placeholder: '(555) 123-4567' });
    const emailIn = el('input', { name: 'email', type: 'email', inputmode: 'email', autocomplete: 'off', placeholder: 'Optional' });
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
    emailIn.addEventListener('input', findMatch);

    const sortedCrew = crew.filter((c) => c.active).sort((a, b) => a.name.localeCompare(b.name));
    const tradeSel = el('select', { name: 'trade', onchange: () => {
      const tr = tradeSel.value;
      [...crewSel.options].forEach((o) => { const c = crew.find((x) => x.id === o.value); if (c) o.textContent = `${c.trades.includes(tr) ? '★ ' : ''}${c.name}`; });
    } }, ...TRADES.map((t) => el('option', { value: t.id }, `${t.icon} ${t.label}`)));
    const crewSel = el('select', { name: 'contractorId' }, el('option', { value: '' }, '— Decide later —'),
      ...sortedCrew.map((c) => el('option', { value: c.id }, `${c.trades.includes(TRADES[0].id) ? '★ ' : ''}${c.name}`)));

    const form = el('form', { class: 'panel-body', novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        const id = await api.jobs.createForCustomer({
          customerId: match && f.get('useAccount') === 'on' ? match.id : null,
          name: f.get('name'), phone: f.get('phone'), email: f.get('email'),
          trade: f.get('trade'), description: f.get('description'), address: f.get('address'), zip: f.get('zip'),
          timeframe: f.get('timeframe'), contractorId: f.get('contractorId') || null, scheduledFor: f.get('scheduledFor') || null,
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
        matchBox),
      el('section', { class: 'card stack' },
        el('h3', {}, '2. The job'),
        el('label', { class: 'field' }, 'Type of work', tradeSel),
        el('label', { class: 'field' }, 'What needs to be done', el('textarea', { name: 'description', rows: 3, placeholder: 'e.g. Replace water heater in garage. 40 gal gas.' })),
        el('div', { class: 'two' },
          el('label', { class: 'field', style: 'grid-column:1/-1' }, 'Address', el('input', { name: 'address', autocomplete: 'off', placeholder: 'Street, city' })),
          el('label', { class: 'field' }, 'ZIP', el('input', { name: 'zip', inputmode: 'numeric', maxlength: '5', autocomplete: 'off' })),
          el('label', { class: 'field' }, 'Needed', el('select', { name: 'timeframe' }, ...TIMEFRAMES.map((t) => el('option', { value: t.id }, t.label)))))),
      el('section', { class: 'card stack' },
        el('h3', {}, '3. Crew & date ', el('span', { class: 'muted small', style: 'font-weight:400' }, '(optional)')),
        el('p', { class: 'muted small' }, 'Pick both and the job is scheduled right away. It shows up in that contractor’s crew login, and you can text them the details.'),
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
  async function openDoc(jobId, docId, type, fromEstimate) {
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
    }
    type = doc.type;
    const isInv = type === 'invoice';
    const isNew = doc.status === 'new';
    const canEdit = isNew || docs.editable(doc);
    const errorBox = el('div', { class: 'error', hidden: true, role: 'alert' });
    const fail = (err) => { errorBox.textContent = err.message; errorBox.hidden = false; errorBox.scrollIntoView({ block: 'center' }); };
    const reopen = async (id) => { await load(); openDoc(jobId, id); };

    const items = (doc.items || []).map((i) => ({ ...i }));
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
    }
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
            amt,
            canEdit && items.length > 1 ? el('button', { type: 'button', class: 'icon', 'aria-label': `Remove line ${idx + 1}`, onclick: () => { items.splice(idx, 1); renderItems(); renderTotals(); } }, '✕') : null));
      }), canEdit ? el('button', { type: 'button', class: 'ghost small', onclick: () => { items.push({ desc: '', qty: 1, price: '' }); renderItems(); renderTotals(); itemsWrap.querySelector('.item-row:last-of-type textarea').focus(); } }, '+ Add line') : null].filter(Boolean));
    }
    renderItems(); renderTotals();

    const ctx = () => ({ job: j, customer: j.buyer, company: settings });
    const first = (j.buyer.name || '').split(' ')[0] || 'there';
    const shareMsg = j.hasAccount
      ? `Hi ${first}, your ${isInv ? 'invoice' : 'estimate'} ${doc.number} from ${settings.name || 'Top Hat Contracting'} is ready. View it here: ${siteUrl()}#/jobs`
      : `Hi ${first}, here is your ${isInv ? 'invoice' : 'estimate'} ${doc.number} from ${settings.name || 'Top Hat Contracting'}: ${docs.usd(docs.totals(doc).total)}.${isInv ? '' : ' Reply YES to approve.'} The PDF is attached.`;

    async function save() {
      const saved = await api.docs.save(jobId, current());
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
      actions.append(el('div', { class: 'row' },
        el('button', { type: 'button', class: 'ghost', style: 'flex:1', onclick: (e) => busy(e.currentTarget, async () => { if (!confirm('Mark approved? Use this if the customer said yes by phone or in person.')) return; await api.docs.setStatus(jobId, doc.id, 'approved'); await reopen(doc.id); }) }, '✓ Mark approved'),
        el('button', { type: 'button', class: 'ghost', style: 'flex:1', onclick: (e) => busy(e.currentTarget, async () => { if (!confirm('Mark this estimate declined?')) return; await api.docs.setStatus(jobId, doc.id, 'declined'); await reopen(doc.id); }) }, 'Mark declined')));
    }
    if (!isInv && doc.status === 'approved') {
      actions.append(el('button', { type: 'button', class: 'gold', onclick: () => openDoc(jobId, null, 'invoice', doc) }, '🧾 Create invoice from this estimate'));
    }
    if (doc.status === 'draft') {
      actions.append(el('button', { type: 'button', class: 'link', style: 'color:var(--bad)', onclick: (e) => busy(e.currentTarget, async () => { if (!confirm(`Delete draft ${doc.number}?`)) return; await api.docs.remove(jobId, doc.id); await load(); openLead(jobId); }) }, 'Delete draft'));
    }

    // Payments (invoices that have been sent)
    let paymentsCard = null;
    if (isInv && !isNew && !['draft', 'void'].includes(doc.status)) {
      const tt = docs.totals(doc);
      const amount = el('input', { type: 'number', inputmode: 'decimal', min: '0.01', step: '0.01', value: tt.balance > 0 ? tt.balance : '', 'aria-label': 'Amount received' });
      const method = el('select', { 'aria-label': 'Payment method' }, ...docs.METHODS.map((m) => el('option', {}, m)));
      const date = el('input', { type: 'date', value: docs.todayKey(), 'aria-label': 'Date received' });
      const note = el('input', { type: 'text', placeholder: 'Note, e.g. check #1042 (optional)' });
      paymentsCard = el('section', { class: 'card stack' },
        el('div', { class: 'row' }, el('h3', {}, 'Payments'), el('span', { class: 'spacer' }), el('span', { class: `pill ${docs.pillClass(doc)}` }, docs.label(doc))),
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
      el('div', { class: 'row' }, el('h3', {}, isInv ? 'Invoice' : 'Estimate'), el('span', { class: 'spacer' }), isNew ? null : el('span', { class: `pill ${docs.pillClass(doc)}` }, docs.label(doc))),
      canEdit ? null : el('p', { class: 'muted small' }, doc.status === 'approved' ? `Approved${doc.respondedBy ? ' by ' + doc.respondedBy : ''}${doc.respondedAt ? ' on ' + docs.fmtDate(doc.respondedAt) : ''}. Locked so it matches what the customer agreed to.` : 'Locked. Payments have been recorded or it’s closed.'),
      el('p', { class: 'muted small' }, `For ${j.buyer.name} · ${jobNo(j)} · ${j.address}`),
      itemsWrap,
      el('div', { class: 'two' }, el('label', { class: 'field' }, 'Tax rate (%)', taxInput), isInv ? el('label', { class: 'field' }, 'Due date', dueInput) : el('span')),
      totalsBox,
      el('label', { class: 'field' }, isInv ? 'Notes on the invoice' : 'Terms on the estimate', notesInput),
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
    const form = el('form', { class: 'card stack', onsubmit: async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const patch = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));
      patch.taxRate = Number(patch.taxRate) || 0;
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
      el('h3', { style: 'margin-top:8px' }, 'Defaults'),
      el('div', { class: 'two' }, f('taxRate', 'Tax rate (%)', { type: 'number', inputmode: 'decimal', min: '0', step: '0.01' }), f('dueDays', 'Invoices due in (days)', { type: 'number', inputmode: 'numeric', min: '0', step: '1' })),
      el('label', { class: 'row', style: 'font-weight:600;align-items:flex-start' },
        el('input', { type: 'checkbox', name: 'showCrewPay', checked: settings.showCrewPay !== false, style: 'width:22px;height:22px;flex-shrink:0;min-height:0' }),
        el('span', {}, 'Show crew their pay', el('span', { class: 'hint', style: 'display:block;font-weight:400' }, 'Crew see the “crew pay” you set on each of their jobs. They never see the customer price.'))),
      f('paymentInstructions', 'How customers can pay', { rows: 4 }, 'Shown on every invoice. Include your Zelle phone or email, Venmo and Cash App names, and who checks are payable to.'),
      f('estimateTerms', 'Terms on estimates', { rows: 2 }),
      f('invoiceTerms', 'Notes on invoices', { rows: 2 }),
      el('button', { type: 'submit' }, 'Save'),
    );
    return [form];
  }

  /* ---------- crew ---------- */
  function crewView() {
    const activeJobs = (cid) => jobs.filter((j) => j.contractorId === cid && OPEN.includes(j.status)).length;
    const list = el('div', { class: 'card crew' },
      crew.length ? null : el('p', { class: 'muted' }, 'No crew added yet.'),
      ...crew.slice().sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name)).map((c) =>
        el('div', { class: 'crew-item' + (c.active ? '' : ' inactive') },
          el('span', { class: 'avatar' }, initials(c.name)),
          el('div', { class: 'body' },
            el('b', {}, c.name), c.active ? null : el('span', { class: 'muted small' }, ' (inactive)'),
            el('p', { class: 'muted small' }, c.trades.map((id) => tradeOf(id).label).join(', ') || 'No trades set'),
            el('p', { class: 'small' }, c.phone ? el('a', { href: telHref(c.phone) }, c.phone) : null, ` · ${activeJobs(c.id)} open job${activeJobs(c.id) === 1 ? '' : 's'}`,
              c.login === 'active' ? el('span', { class: 'pill s-completed', style: 'margin-left:6px' }, '🔑 Login') : c.login === 'invited' ? el('span', { class: 'pill s-qualifying', style: 'margin-left:6px' }, 'Invited') : null)),
          el('button', { class: 'ghost small', onclick: () => crewForm(c) }, 'Edit'))),
    );
    return [el('div', { class: 'row' }, el('h2', {}, 'Your crew'), el('span', { class: 'spacer' }), el('button', { class: 'gold small', onclick: () => crewForm() }, '+ Add')), list,
      el('p', { class: 'muted small' }, 'Crew sign in at ', el('a', { href: 'crew.html', target: '_blank' }, new URL('crew.html', location.href).href), '. Open a crew member to invite them.')];
  }

  function crewForm(c) {
    const editing = !!c;
    c = c || { name: '', phone: '', trades: [], active: true };
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

    const form = el('form', { class: 'panel-body', onsubmit: async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      try {
        await api.contractors.save({ ...(editing ? { id: c.id } : {}), name: f.get('name').trim(), phone: f.get('phone').trim(), trades: f.getAll('trades'), active: f.get('active') === 'on' });
        await load(); close();
      } catch (err) { errorBox.textContent = err.message; errorBox.hidden = false; }
    } },
      errorBox,
      el('label', { class: 'field' }, 'Name', el('input', { name: 'name', value: c.name, required: true, autocomplete: 'off' })),
      el('label', { class: 'field' }, 'Phone', el('input', { name: 'phone', type: 'tel', value: c.phone, autocomplete: 'off' })),
      el('div', { class: 'field' }, el('b', { style: 'font-size:.92rem' }, 'Trades'),
        el('div', { class: 'choices', style: 'margin-top:6px' }, ...TRADES.filter((t) => t.id !== 'other').map((t) =>
          el('label', { class: 'choice' }, el('input', { type: 'checkbox', name: 'trades', value: t.id, checked: c.trades.includes(t.id) }), el('span', {}, `${t.icon} ${t.label}`))))),
      el('label', { class: 'row', style: 'font-weight:600' }, el('input', { type: 'checkbox', name: 'active', checked: c.active, style: 'width:22px;height:22px' }), 'Active (can be assigned jobs)'),
      el('button', { type: 'submit' }, editing ? 'Save' : 'Add to crew'),
      loginCard,
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
