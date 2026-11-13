'use strict';
/* Top Hat staff area: qualify leads, schedule jobs, assign crews. */
(function () {
  const { api, TRADES, TIMEFRAMES, BUDGETS, STATUSES, FILE_KINDS, PHOTO_STAGES, el, ago, fmtWhen, find } = TH;
  const view = document.getElementById('view');
  const drawerRoot = document.getElementById('drawerRoot');
  const OPEN = ['new', 'qualifying', 'scheduled', 'in_progress'];

  let tab = 'leads';
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
    const errorBox = el('div', { class: 'error', hidden: true, role: 'alert' });
    const form = el('form', { class: 'card stack login-box', onsubmit: async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      try {
        const u = await api.auth.signIn(f.get('email'), f.get('password'));
        if (u.role !== 'staff') { await api.auth.signOut(); throw new Error('That account is a customer account, not Top Hat staff.'); }
        location.reload();
      } catch (err) { errorBox.textContent = err.message; errorBox.hidden = false; }
    } },
      el('h1', {}, 'Staff log in'),
      me ? el('p', { class: 'muted small' }, `You're logged in as a customer (${me.email}). Log in with a staff account to continue.`) : null,
      errorBox,
      el('label', { class: 'field' }, 'Email', el('input', { name: 'email', type: 'email', autocomplete: 'username', required: true })),
      el('label', { class: 'field' }, 'Password', el('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true })),
      el('button', { class: 'block', type: 'submit' }, 'Log in'),
      api.mode === 'preview' ? el('p', { class: 'summary small' }, 'Preview login: ', el('b', {}, 'office@tophat.demo'), ' / ', el('b', {}, 'tophat')) : null,
    );
    view.replaceChildren(form);
  }

  /* ---------- main ---------- */
  function render() {
    const tabs = el('div', { class: 'tabs-bar', role: 'tablist', style: 'margin-top:8px' },
      ...[['leads', 'Leads', jobs.filter((j) => j.status === 'new').length], ['crew', 'Crew', crew.filter((c) => c.active).length], ['business', 'Business', 0]].map(([id, label, n]) =>
        el('button', { role: 'tab', 'aria-current': String(tab === id), onclick: () => { tab = id; render(); } }, label, n ? el('span', { class: 'count' }, String(n)) : null)));
    view.replaceChildren(tabs, el('div', { class: 'stack', style: 'margin:16px 0' }, tab === 'leads' ? leadsView() : tab === 'crew' ? crewView() : businessView()));
  }

  /* ---------- leads ---------- */
  function leadsView() {
    const count = (s) => jobs.filter((j) => j.status === s).length;
    const pipeline = jobs.filter((j) => OPEN.includes(j.status) && j.price).reduce((s, j) => s + Number(j.price), 0);
    const kpis = el('div', { class: 'kpis' },
      ...[[count('new'), 'New leads'], [count('scheduled') + count('in_progress'), 'Scheduled / active'], [money(pipeline), 'Open job value'], [docs.usd(jobs.reduce((t, j) => t + owedOn(j), 0)), 'Unpaid invoices']]
        .map(([v, k]) => el('div', { class: 'kpi' }, el('b', {}, String(v)), el('span', {}, k))));

    const filters = [['open', 'Open', jobs.filter((j) => OPEN.includes(j.status)).length], ...STATUSES.map((s) => [s.id, s.label, count(s.id)]), ['all', 'All', jobs.length]];
    const filterBar = el('div', { class: 'tabs-bar' }, ...filters.map(([id, label, n]) =>
      el('button', { 'aria-current': String(filter === id), onclick: () => { filter = id; render(); } }, label, el('span', { class: 'count' }, String(n)))));

    const matches = (j, q) => !q || [jobNo(j), String(j.number), j.buyer.name, j.buyer.phone, j.buyer.email, j.address, j.zip, j.description, tradeOf(j.trade).label].join(' ').toLowerCase().includes(q);
    const inFilter = (j) => filter === 'all' || (filter === 'open' ? OPEN.includes(j.status) : j.status === filter);
    const renderList = () => {
      const q = search.trim().toLowerCase();
      const list = jobs.filter((j) => inFilter(j) && matches(j, q));
      return el('div', { class: 'leads' },
        list.length ? list.map(leadCard) : [el('div', { class: 'card muted' }, q ? 'No leads match your search.' : 'No leads here right now.')]);
    };
    let listWrap = renderList();
    const searchBox = el('input', { type: 'search', placeholder: 'Search job #, name, phone, address…', value: search, 'aria-label': 'Search leads',
      oninput: (e) => { search = e.target.value; const list = renderList(); listWrap.replaceWith(list); listWrap = list; } });
    return [kpis, filterBar, searchBox, listWrap];
  }

  function leadCard(j) {
    const t = tradeOf(j.trade);
    const c = find(crew, j.contractorId);
    return el('button', { class: 'lead' + (j.status === 'new' ? ' new-dot' : ''), onclick: () => openLead(j.id) },
      el('span', { class: 'ic' }, t.icon),
      el('span', { class: 'body' },
        el('span', { class: 'line1' }, el('b', {}, j.buyer.name), el('span', { class: 'muted small' }, '· ' + t.label), el('span', { class: 'spacer' }),
          el('span', { class: `pill s-${j.status}` }, statusOf(j.status).label)),
        el('span', { class: 'desc' }, j.description),
        el('span', { class: 'meta' },
          el('span', { style: 'font-weight:600' }, jobNo(j)),
          el('span', {}, '📍 ' + (j.zip || j.address)),
          el('span', {}, '⏱ ' + (find(TIMEFRAMES, j.timeframe)?.label || '—')),
          j.scheduledFor ? el('span', {}, '📅 ' + fmtWhen(j.scheduledFor)) : null,
          c ? el('span', {}, '👷 ' + c.name) : null,
          j.files.length ? el('span', {}, `📁 ${j.files.length}`) : null,
          owedOn(j) > 0 ? el('span', { style: 'color:var(--warn);font-weight:600' }, `🧾 ${docs.usd(owedOn(j))} due`)
            : (j.docs || []).some((d) => d.type === 'estimate' && d.status === 'sent') ? el('span', {}, '📝 Estimate sent') : null,
          el('span', {}, ago(j.created)))),
    );
  }

  /* ---------- lead detail ---------- */
  async function openLead(id) {
    const j = jobs.find((x) => x.id === id);
    if (!j) return;
    releaseUrls();
    const [files, history, jobDocs] = await Promise.all([api.files.list(j.id), api.jobs.log(j.id), api.docs.list(j.id)]);
    fileUrls = files.map((f) => f.url).filter(Boolean);
    const t = tradeOf(j.trade);
    const close = closeDrawer;

    const savedNote = el('span', { class: 'saved-note', hidden: true }, 'Saved ✓');
    const flashSaved = () => { savedNote.hidden = false; setTimeout(() => { savedNote.hidden = true; }, 1600); };
    const errorBox = el('div', { class: 'error', hidden: true, role: 'alert' });

    async function update(patch) {
      try {
        await api.jobs.update(j.id, patch);
        await load();
        flashSaved();
        openLead(j.id); // re-render with fresh data
      } catch (err) { errorBox.textContent = err.message; errorBox.hidden = false; }
    }

    // Contact
    const b = j.buyer;
    const contact = el('section', { class: 'card stack' },
      el('div', { class: 'row' }, el('span', { class: 'avatar' }, initials(b.name)),
        el('div', {}, el('h3', {}, b.name), el('p', { class: 'muted small' }, [b.phone, b.email].filter(Boolean).join(' · ')))),
      el('div', { class: 'contact' },
        b.phone ? el('a', { class: 'btn gold', href: telHref(b.phone) }, '📞 Call') : null,
        b.phone ? el('a', { class: 'btn ghost', href: smsHref(b.phone) }, '💬 Text') : null,
        b.email ? el('a', { class: 'btn ghost', href: `mailto:${b.email}?subject=${encodeURIComponent('Your ' + t.label.toLowerCase() + ' request with Top Hat Contracting')}` }, '✉️ Email') : null),
    );

    // Details
    const details = el('section', { class: 'card stack' },
      el('h3', {}, 'Job details'),
      el('dl', { class: 'dl' },
        el('dt', {}, 'Work'), el('dd', {}, `${t.icon} ${t.label}`),
        el('dt', {}, 'Description'), el('dd', { style: 'white-space:pre-wrap' }, j.description),
        el('dt', {}, 'Address'), el('dd', {}, el('a', { href: 'https://maps.google.com/?q=' + encodeURIComponent(`${j.address} ${j.zip}`), target: '_blank', rel: 'noopener' }, `${j.address} ${j.zip}`)),
        el('dt', {}, 'When'), el('dd', {}, find(TIMEFRAMES, j.timeframe)?.label || '—'),
        el('dt', {}, 'Budget'), el('dd', {}, find(BUDGETS, j.budget)?.label || 'Not sure yet'),
        el('dt', {}, 'Requested'), el('dd', {}, `${new Date(j.created).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} (${ago(j.created)})`)),
    );

    // Status
    const status = el('section', { class: 'card stack' },
      el('div', { class: 'row' }, el('h3', {}, 'Status'), el('span', { class: 'spacer' }), savedNote),
      el('div', { class: 'status-pick' }, ...STATUSES.map((s) =>
        el('button', { type: 'button', 'aria-pressed': String(j.status === s.id), onclick: () => j.status !== s.id && update({ status: s.id }) }, s.label))),
      el('p', { class: 'muted small' }, `The customer sees: “${statusOf(j.status).buyer}”`),
    );

    // Set up the job
    const sortedCrew = crew.filter((c) => c.active || c.id === j.contractorId)
      .sort((a, c) => (c.trades.includes(j.trade) - a.trades.includes(j.trade)) || a.name.localeCompare(c.name));
    const crewSel = el('select', { name: 'contractorId' },
      el('option', { value: '' }, '— Not assigned —'),
      ...sortedCrew.map((c) => el('option', { value: c.id, selected: c.id === j.contractorId }, `${c.trades.includes(j.trade) ? '★ ' : ''}${c.name}`)));
    const whenInput = el('input', { type: 'datetime-local', name: 'scheduledFor', value: j.scheduledFor || '' });
    const assigned = find(crew, j.contractorId);
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
      el('h3', {}, 'Set up the job'),
      el('label', { class: 'field' }, 'Crew', el('span', { class: 'hint' }, '★ = does this kind of work'), crewSel),
      el('label', { class: 'field' }, 'Date & time', whenInput),
      el('p', { class: 'muted small' }, 'Picking a crew and a date moves a new lead to “Scheduled”.'),
      el('button', { type: 'submit' }, 'Save'),
      assigned?.phone ? el('a', { class: 'btn ghost', href: smsHref(assigned.phone, dispatchText) }, `💬 Text job details to ${assigned.name.split(' ')[0]}`) : null,
      assigned?.phone ? el('p', { class: 'muted small' }, 'The text includes the date, address, customer contact, job description and the photo upload link. Never prices.') : null,
      crewLink ? el('div', { class: 'crew-link' },
        el('span', { class: 'small' }, `📷 ${assigned ? assigned.name.split(' ')[0] + '’s' : 'Crew'} photo upload link`),
        el('button', { type: 'button', class: 'ghost small', onclick: async (e) => {
          try { await navigator.clipboard.writeText(crewLink); e.target.textContent = 'Copied ✓'; }
          catch { prompt('Copy this link:', crewLink); }
        } }, 'Copy link')) : null,
    );

    // Money (staff only)
    const priceInput = el('input', { type: 'number', name: 'price', inputmode: 'decimal', min: '0', step: '1', placeholder: 'e.g. 2500', value: j.price ?? '' });
    const payInput = el('input', { type: 'number', name: 'crewPay', inputmode: 'decimal', min: '0', step: '1', placeholder: 'e.g. 1600', value: j.crewPay ?? '' });
    const profitOut = el('div', { class: 'profit' });
    const showProfit = () => {
      const pr = num(priceInput.value), pay = num(payInput.value);
      if (pr == null || pay == null) { profitOut.replaceChildren(el('span', { class: 'muted small' }, 'Enter both prices to see your profit.')); return; }
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
      el('div', { class: 'row' }, el('h3', {}, 'Money'), el('span', { class: 'spacer' }), el('span', { class: 'pill lock' }, '🔒 Staff only')),
      el('div', { class: 'two' },
        el('label', { class: 'field' }, 'Customer price', el('span', { class: 'hint' }, 'What the customer pays'), priceInput),
        el('label', { class: 'field' }, 'Crew pay', el('span', { class: 'hint' }, 'What you pay the crew'), payInput)),
      profitOut,
      el('p', { class: 'muted small' }, 'The crew never sees the customer price or your profit. The customer never sees crew pay.'),
      el('button', { type: 'submit' }, 'Save prices'),
    );

    // Estimates & invoices
    const approvedEst = jobDocs.find((x) => x.type === 'estimate' && x.status === 'approved');
    const docsCard = el('section', { class: 'card stack' },
      el('div', { class: 'row' }, el('h3', {}, 'Estimates & invoices')),
      jobDocs.length ? el('div', { class: 'doc-list' }, ...jobDocs.map((dc) => {
        const tt = docs.totals(dc);
        return el('button', { type: 'button', class: 'doc-row', onclick: () => openDoc(j.id, dc.id) },
          el('span', { class: 'ic' }, dc.type === 'invoice' ? '🧾' : '📝'),
          el('span', { class: 'body' }, el('b', {}, dc.number),
            el('span', { class: 'muted small' }, dc.type === 'invoice' && !['draft', 'void'].includes(dc.status) ? `${docs.usd(tt.total)} · ${docs.usd(Math.max(0, tt.balance))} due` : docs.usd(tt.total))),
          el('span', { class: `pill ${docs.pillClass(dc)}` }, docs.label(dc)));
      })) : el('p', { class: 'muted small' }, 'No estimates or invoices yet. They’re filled in with this job’s details. Crew pay never appears on them.'),
      el('div', { class: 'row' },
        el('button', { type: 'button', class: 'ghost', style: 'flex:1', onclick: () => openDoc(j.id, null, 'estimate') }, '+ Estimate'),
        el('button', { type: 'button', class: 'ghost', style: 'flex:1', onclick: () => openDoc(j.id, null, 'invoice', approvedEst && !jobDocs.some((x) => x.type === 'invoice' && x.fromEstimateId === approvedEst.id) ? approvedEst : null) }, '+ Invoice')),
    );

    // Files: this job's folder
    const uploadNote = el('span', { class: 'muted small', hidden: true }, 'Uploading…');
    const has = (k) => files.some((f) => f.kind === k);
    const filesCard = el('section', { class: 'card stack' },
      el('div', { class: 'row' }, el('h3', {}, `Files · ${jobNo(j)}`), el('span', { class: 'spacer' }), uploadNote),
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
      el('label', { class: 'btn ghost' }, '+ Add files',
        el('input', { type: 'file', multiple: true, hidden: true, onchange: async (e) => {
          const picked = [...e.target.files];
          if (!picked.length) return;
          uploadNote.hidden = false;
          try { for (const f of picked) await api.files.upload(j.id, f); }
          catch (err) { errorBox.textContent = err.message; errorBox.hidden = false; }
          await load(); openLead(j.id);
        } })),
      el('p', { class: 'muted small' }, '🔒 Files are staff-only unless you tick “Customer can see”. Crew never see files.'),
      j.photos?.length ? el('div', { class: 'stack', style: 'gap:6px' }, el('b', { class: 'small' }, 'Photos from the customer’s request'),
        el('div', { class: 'photo-row' }, ...j.photos.map((src, i) => el('a', { href: src, target: '_blank' }, el('img', { src, alt: `Customer photo ${i + 1}` }))))) : null,
    );
    async function fileUpdate(fileId, patch) {
      try { await api.files.update(j.id, fileId, patch); await load(); flashSaved(); openLead(j.id); }
      catch (err) { errorBox.textContent = err.message; errorBox.hidden = false; }
    }

    // Notes
    const notes = el('textarea', { placeholder: 'Internal notes. The customer never sees these.', value: j.notes || '', rows: 4 });
    const notesCard = el('section', { class: 'card stack' },
      el('h3', {}, 'Notes'),
      notes,
      el('button', { type: 'button', class: 'ghost', onclick: () => update({ notes: notes.value }) }, 'Save notes'),
    );

    // Activity
    const log = el('section', { class: 'card stack' },
      el('h3', {}, 'Activity'),
      el('ul', { class: 'log' }, ...history.slice().reverse().map((l) => el('li', {},
        el('span', {}, new Date(l.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })), el('span', {}, l.text)))),
    );

    const panel = el('div', { class: 'panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Job ${jobNo(j)}: ${b.name}` },
      el('div', { class: 'panel-head' },
        el('button', { class: 'ghost small', onclick: close, 'aria-label': 'Close' }, '← Back'),
        el('b', { style: 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, `${jobNo(j)} · ${t.icon} ${t.label}`),
        el('span', { class: `pill s-${j.status}` }, statusOf(j.status).label)),
      el('div', { class: 'panel-body' }, errorBox, contact, status, setup, moneyCard, docsCard, filesCard, details, notesCard, log),
    );
    const scroll = drawerRoot.querySelector('.panel')?.scrollTop || 0;
    drawerRoot.replaceChildren(el('div', { class: 'drawer', onclick: (e) => { if (e.target === e.currentTarget) close(); } }, panel));
    panel.scrollTop = scroll;
    document.body.style.overflow = 'hidden';
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
    const shareMsg = `Hi ${first}, your ${isInv ? 'invoice' : 'estimate'} ${doc.number} from ${settings.name || 'Top Hat Contracting'} is ready. View it here: ${siteUrl()}#/jobs`;

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
        el('span', { class: 'small' }, 'The customer sees this in their My jobs. Let them know:'),
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
            el('p', { class: 'small' }, c.phone ? el('a', { href: telHref(c.phone) }, c.phone) : null, ` · ${activeJobs(c.id)} open job${activeJobs(c.id) === 1 ? '' : 's'}`)),
          el('button', { class: 'ghost small', onclick: () => crewForm(c) }, 'Edit'))),
    );
    return [el('div', { class: 'row' }, el('h2', {}, 'Your crew'), el('span', { class: 'spacer' }), el('button', { class: 'gold small', onclick: () => crewForm() }, '+ Add')), list];
  }

  function crewForm(c) {
    const editing = !!c;
    c = c || { name: '', phone: '', trades: [], active: true };
    const errorBox = el('div', { class: 'error', hidden: true, role: 'alert' });
    const close = closeDrawer;
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
