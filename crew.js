'use strict';
/*
 * Crew pages:
 *   crew.html?t=CODE       → one job's photo upload (from the job text; no login)
 *   crew.html?invite=CODE  → set up a crew login (one-time invite from the office)
 *   crew.html              → crew sign-in, then "My jobs" (only jobs assigned to them)
 * Never shows customer prices, profit, estimates, invoices or office notes.
 */
(function () {
  const { api, TRADES, STATUSES, el, fmtWhen, find } = TH;
  const view = document.getElementById('view');
  const nav = document.getElementById('nav');
  const params = new URLSearchParams(location.search);
  const token = params.get('t') || '';
  const invite = params.get('invite') || '';
  let urls = [];

  if (api.mode === 'preview') document.getElementById('previewBanner').hidden = false;
  const usd = (n) => '$' + Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
  // Money on a job: the crew pay plus approved extras; paid = bills paid so far (or the whole job if the office marked it paid).
  const extrasOf = (j, sts) => (j.crewBills || []).filter((b) => b.step == null && sts.includes(b.status)).reduce((t, b) => t + Number(b.amount), 0);
  const earnedOf = (j) => (Number(j.crewPay) || 0) + extrasOf(j, ['approved', 'paid']);
  const paidOf = (j) => {
    const billsPaid = (j.crewBills || []).filter((b) => b.status === 'paid').reduce((t, b) => t + Number(b.amount), 0);
    return j.crewPaid ? Math.max(billsPaid, (Number(j.crewPay) || 0) + extrasOf(j, ['paid'])) : billsPaid;
  };
  // Steps on the crew pay schedule they've reached but not billed yet.
  // A step can be billed once it's reached and the step before it has been approved or paid.
  const prevHandled = (j, i) => i === 0 || (j.crewBills || []).some((b) => b.step === i - 1 && ['approved', 'paid'].includes(b.status));
  const readyToBill = (j, company) => j.crewPay == null ? [] : TH.docs.crewSchedule(company, j.crewPay, j.status, !!j.halfwayAt)
    .filter((p) => p.reached && prevHandled(j, p.index) && !(j.crewBills || []).some((b) => b.step === p.index && b.status !== 'declined'));
  const sessionStorageGet = (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } };
  const sessionStorageSet = (k, v) => { try { sessionStorage.setItem(k, String(v)); } catch (e) { /* fine */ } };
  const tradeOf = (id) => find(TRADES, id) || TRADES.at(-1);
  const tel = (p) => 'tel:' + String(p).replace(/[^\d+]/g, '');
  const maps = (a) => 'https://maps.google.com/?q=' + encodeURIComponent(a);

  const fmtAt = (ms) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  // Notes the contractor writes for the office. Only the office sees them.
  function notesSection(notes, send, { compact = false } = {}) {
    const ta = el('textarea', { rows: 3, maxlength: '2000', placeholder: 'Note for the office, e.g. “Need 2 more bundles of shingles” or “Customer not home, rescheduling”', 'aria-label': 'Note for the office' });
    const err = el('div', { class: 'error', hidden: true, role: 'alert' });
    const btn = el('button', { type: 'button', class: 'block', onclick: async () => {
      btn.disabled = true; err.hidden = true;
      try { await send(ta.value); } catch (x) { err.textContent = x.message; err.hidden = false; btn.disabled = false; }
    } }, 'Send note to office');
    return el('section', { class: compact ? 'stack' : 'card stack' },
      el(compact ? 'h3' : 'h2', {}, 'Notes for the office'),
      el('p', { class: 'muted small' }, 'Only the Top Hat office sees these. Customers never do.'),
      notes.length ? el('ul', { class: 'crew-notes' }, ...notes.slice().reverse().map((n) => el('li', {},
        el('span', { class: 'muted small' }, fmtAt(n.at)), el('p', {}, n.text)))) : null,
      err, ta, btn);
  }

  async function crewMe() {
    const me = await api.auth.me();
    return me && me.role === 'crew' ? me : null;
  }
  async function renderNav() {
    const me = await crewMe();
    nav.replaceChildren(...[
      me && token ? el('a', { class: 'btn ghost small', href: 'crew.html' }, 'My jobs') : null,
      me ? el('button', { class: 'link small', onclick: async () => { await api.auth.signOut(); location.href = 'crew.html'; } }, 'Log out') : null,
    ].filter(Boolean));
  }

  /* ---------- one job: photo upload ---------- */
  async function renderUpload(message) {
    urls.forEach((u) => URL.revokeObjectURL(u));
    const job = await api.crew.job(token);
    if (!job) {
      view.replaceChildren(el('div', { class: 'card stack', style: 'margin-top:28px;text-align:center' },
        el('div', { style: 'font-size:2.2rem' }, '🔒'),
        el('h1', {}, 'Link not active'),
        el('p', { class: 'muted' }, 'This upload link has expired or the job was reassigned. Ask the Top Hat office to text you a new one.')));
      return;
    }
    urls = job.uploads.map((f) => f.url).filter(Boolean);
    const t = tradeOf(job.trade);
    const status = el('p', { class: 'muted small', role: 'status', 'aria-live': 'polite' });
    const errorBox = el('div', { class: 'error', hidden: true, role: 'alert' });
    const note = el('input', { type: 'text', placeholder: 'Optional note, e.g. “Water damage behind cabinet”', autocomplete: 'off' });

    const picker = el('input', { type: 'file', accept: 'image/*,application/pdf', multiple: true, hidden: true, onchange: async (e) => {
      const files = [...e.target.files];
      if (!files.length) return;
      errorBox.hidden = true;
      let done = 0;
      for (const f of files) {
        status.textContent = `Uploading ${done + 1} of ${files.length}…`;
        try { await api.crew.upload(token, f, { note: note.value }); done++; }
        catch (err) { errorBox.textContent = err.message; errorBox.hidden = false; break; }
      }
      if (done) renderUpload(`✓ ${done} ${done === 1 ? 'file' : 'files'} sent to the Top Hat office.`);
      else status.textContent = '';
    } });


    view.replaceChildren(el('div', { class: 'stack', style: 'margin:20px 0' },
      el('section', { class: 'card stack' },
        el('div', { class: 'row' }, el('span', { style: 'font-size:1.6rem' }, t.icon),
          el('div', { style: 'flex:1;min-width:0' }, el('h2', {}, `Job TH-${job.number} · ${t.label}`),
            job.crewName ? el('p', { class: 'muted small' }, `Assigned to ${job.crewName}`) : null)),
        el('dl', { class: 'dl' },
          el('dt', {}, 'Address'), el('dd', {}, el('a', { href: maps(`${job.address} ${job.zip}`), target: '_blank', rel: 'noopener' }, `${job.address} ${job.zip}`)),
          job.scheduledFor ? el('dt', {}, 'When') : null, job.scheduledFor ? el('dd', {}, fmtWhen(job.scheduledFor)) : null,
          el('dt', {}, 'Customer'), el('dd', {}, job.customerName, job.customerPhone ? ' · ' : '', job.customerPhone ? el('a', { href: tel(job.customerPhone) }, job.customerPhone) : ''),
          el('dt', {}, 'Job'), el('dd', { style: 'white-space:pre-wrap' }, job.description)),
      ),
      el('section', { class: 'card stack' },
        el('h2', {}, 'Send job photos'),
        note,
        errorBox,
        el('label', { class: 'btn gold block big' }, '📷 Add photos', picker),
        message ? el('div', { class: 'callout' }, message) : null,
        status,
        el('p', { class: 'muted small' }, 'Take new photos or pick from your library. They go straight into this job’s file at the Top Hat office.'),
      ),
      notesSection(job.notes || [], async (t) => { await api.crew.addNote(token, t); renderUpload('✓ Note sent to the office.'); }),
      job.uploads.length ? el('section', { class: 'card stack' },
        el('h3', {}, `You’ve sent ${job.uploads.length} ${job.uploads.length === 1 ? 'file' : 'files'}`),
        el('div', { class: 'photo-row', style: 'flex-wrap:wrap' }, ...job.uploads.map((f) => /^image\//.test(f.mime) && f.url
          ? el('img', { src: f.url, alt: f.note || f.name, title: f.note || f.name, style: 'width:96px;height:96px' })
          : el('span', { class: 'pill' }, '📎 ' + f.name))),
      ) : null,
    ));
  }

  /* ---------- set up a crew login from an invite ---------- */
  async function renderInvite() {
    const info = await api.crewPortal.inviteInfo(invite);
    if (!info) {
      view.replaceChildren(el('div', { class: 'card stack login-box', style: 'text-align:center' },
        el('div', { style: 'font-size:2.2rem' }, '🔒'),
        el('h1', {}, 'Invite not active'),
        el('p', { class: 'muted' }, 'This invite was already used or cancelled. If you already set up your login, sign in below. Otherwise ask the Top Hat office for a new invite.'),
        el('a', { class: 'btn block', href: 'crew.html' }, 'Crew sign in')));
      return;
    }
    const errorBox = el('div', { class: 'error', hidden: true, role: 'alert' });
    const form = el('form', { class: 'card stack login-box', onsubmit: async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        await api.crewPortal.acceptInvite(invite, { email: f.get('email'), password: f.get('password') });
        location.replace('crew.html');
      } catch (err) { errorBox.textContent = err.message; errorBox.hidden = false; btn.disabled = false; }
    } },
      el('h1', {}, `Hi ${info.name.split(' ')[0]}!`),
      el('p', { class: 'muted' }, 'Set up your Top Hat crew login to see all your jobs in one place and send job photos.'),
      errorBox,
      el('label', { class: 'field' }, 'Your email', el('input', { name: 'email', type: 'email', autocomplete: 'username', inputmode: 'email', required: true })),
      el('label', { class: 'field' }, 'Create a password', el('span', { class: 'hint' }, 'At least 8 characters.'),
        el('input', { name: 'password', type: 'password', autocomplete: 'new-password', minlength: '8', required: true })),
      el('button', { class: 'gold block', type: 'submit' }, 'Create my crew login'),
    );
    view.replaceChildren(form);
  }

  /* ---------- crew sign in ---------- */
  function renderLogin(note) {
    view.replaceChildren(TH.loginForm({ note }));
  }

  /* ---------- my jobs (crew login) ---------- */
  const todayKey = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 10); };
  const timeOf = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const dur = (a, b) => { const m = Math.max(0, Math.round((b - a) / 60000)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`; };
  const stageOf = (id) => (TH.STAGES || []).find((x) => x.id === id);

  async function loadCrew() {
    const me = await crewMe();
    if (!me) return { me: null };
    try {
      const [jobs, company] = await Promise.all([api.crewPortal.jobs(), api.settings.get().catch(() => ({}))]);
      return { me, jobs, company };
    } catch (err) {
      await api.auth.signOut(); await renderNav();
      return { me: null, error: err.message };
    }
  }

  async function renderPortal(message, which = 'active') {
    const { me, jobs, company = {}, error } = await loadCrew();
    if (!me) return renderLogin(error);
    const tk = todayKey();
    const notDone = jobs.filter((j) => j.status !== 'completed')
      .sort((a, b) => String(a.scheduledFor || '9999').localeCompare(String(b.scheduledFor || '9999')));
    const today = notDone.filter((j) => j.status === 'in_progress' || (j.scheduledFor || '').slice(0, 10) === tk || (j.scheduledFor && j.scheduledFor.slice(0, 10) < tk));
    const upcoming = notDone.filter((j) => !today.includes(j));
    // Every finished job is kept here, newest first.
    const doneAt = (j) => j.finishedAt || (j.scheduledFor ? Date.parse(j.scheduledFor) : 0);
    const finished = jobs.filter((j) => j.status === 'completed').sort((a, b) => doneAt(b) - doneAt(a));
    const pay = (list) => list.reduce((t, j) => t + earnedOf(j), 0);
    const paidSum = (list) => list.reduce((t, j) => t + paidOf(j), 0);
    const showPay = jobs.some((j) => j.crewPay != null);
    const toConfirm = notDone.filter((j) => j.status === 'scheduled' && !j.crewResponse).length;

    const card = (j) => {
      const t = tradeOf(j.trade);
      const d = j.scheduledFor ? new Date(j.scheduledFor) : null;
      const st = stageOf(j.stage);
      const chip = j.status === 'scheduled' && !j.crewResponse ? ['Confirm this job', 'hot']
        : j.crewResponse === 'declined' && j.status === 'scheduled' ? ['You can’t make it', '']
        : st ? [`${st.icon} ${st.label}`, 'hot']
        : j.status === 'in_progress' ? ['🔨 Working', 'hot']
        : j.status === 'completed' ? ['✓ Done', ''] : ['✓ Confirmed', ''];
      const fin = j.status === 'completed' && doneAt(j) ? new Date(doneAt(j)) : null;
      return el('a', { class: 'crew-job', href: `#/job/${j.id}` },
        fin ? el('span', { class: 'when done' }, el('b', {}, fin.toLocaleDateString(undefined, { month: 'short' })), el('span', { class: 'big' }, String(fin.getDate())), el('span', { class: 'muted' }, String(fin.getFullYear())))
          : el('span', { class: 'when' }, d ? el('b', {}, d.toLocaleDateString(undefined, { weekday: 'short' })) : el('b', {}, '—'),
            d ? el('span', {}, d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })) : null,
            d ? el('span', { class: 'muted' }, timeOf(j.scheduledFor)) : null),
        el('span', { class: 'body' },
          el('b', {}, `${t.icon} ${t.label} · TH-${j.number}`),
          el('span', { class: 'muted small' }, `${j.customerName ? j.customerName + ' · ' : ''}${j.address}${j.zip ? ' ' + j.zip : ''}`),
          el('span', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, el('span', { class: 'flag ' + chip[1] }, chip[0]),
            fin && j.crewPay != null ? el('span', { class: 'flag' + (paidOf(j) >= earnedOf(j) ? ' paid' : '') }, `${usd(earnedOf(j))}${paidOf(j) >= earnedOf(j) ? ' · paid ✓' : paidOf(j) ? ` · ${usd(paidOf(j))} paid` : ' · not paid yet'}`) : null,
            readyToBill(j, company).length ? el('span', { class: 'flag hot' }, '🧾 Ready to bill') : null)),
        el('span', { class: 'chev', 'aria-hidden': 'true' }, '›'));
    };
    const section = (title, list, empty) => [el('h2', { style: 'margin-top:6px' }, title),
      list.length ? el('div', { class: 'crew-jobs' }, ...list.map(card)) : el('div', { class: 'card muted' }, empty)];

    const tabs = el('div', { class: 'tabs-bar main-tabs', role: 'tablist' },
      el('button', { role: 'tab', 'aria-current': String(which === 'active'), onclick: () => { location.hash = '#/'; } }, 'My jobs',
        notDone.length ? el('span', { class: 'count' }, String(notDone.length)) : null),
      el('button', { role: 'tab', 'aria-current': String(which === 'done'), onclick: () => { location.hash = '#/done'; } }, 'Completed',
        finished.length ? el('span', { class: 'count' }, String(finished.length)) : null),
      el('button', { role: 'tab', 'aria-current': String(which === 'records'), onclick: () => { location.hash = '#/records'; } }, '📒 Records'));
    const head = el('div', {}, el('h1', {}, `Hi ${me.name.split(' ')[0]}`), el('p', { class: 'muted' }, 'Your Top Hat jobs'));

    if (which === 'records') {
      // Records for taxes and books: pick a year, see the totals, take it all with you.
      const yearOf = (j) => new Date(doneAt(j) || Date.now()).getFullYear();
      const years = [...new Set(finished.map(yearOf))].sort((a, b) => b - a);
      const thisYear = new Date().getFullYear();
      if (!years.includes(thisYear)) years.unshift(thisYear);
      let year = Number(sessionStorageGet('crew.year')) || years[0];
      if (!years.includes(year)) year = years[0];
      const body = el('div', { class: 'stack' });
      const note = el('div', { class: 'callout', hidden: true });
      const say = (t) => { note.textContent = t; note.hidden = !t; };
      const fileSafe = (s) => String(s || '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-');
      const dateStr = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '');
      const lastPaid = (j) => { const b = (j.crewBills || []).filter((x) => x.status === 'paid').sort((a, c) => String(a.paidDate).localeCompare(String(c.paidDate))).at(-1);
        return b ? { date: b.paidDate, method: b.paidMethod } : j.crewPaid || null; };
      const rowsFor = (list) => [
        ['Job #', 'Finished', 'Customer', 'Address', 'ZIP', 'Type of work', ...(showPay ? ['Pay', 'Paid to you', 'Last paid on', 'Paid by'] : []), 'Photos'],
        ...list.map((j) => [`TH-${j.number}`, dateStr(doneAt(j)), j.customerName, j.address, j.zip, tradeOf(j.trade).label,
          ...(showPay ? [earnedOf(j) || '', paidOf(j) || '', lastPaid(j)?.date || '', lastPaid(j)?.method || ''] : []), (j.uploads || []).length]),
      ];
      const draw = () => {
        const list = finished.filter((j) => yearOf(j) === year);
        const owedNow = (l) => l.reduce((t, j) => t + Math.max(0, earnedOf(j) - paidOf(j)), 0);
        const photos = list.reduce((t, j) => t + (j.uploads || []).filter((f) => f.url).length, 0);
        const statement = () => {
          const sheet = el('article', { class: 'doc-sheet permit-sheet' },
            el('header', { class: 'doc-head' },
              el('div', { class: 'doc-co' }, el('img', { class: 'doc-logo-img', src: 'img/logo.jpg', alt: '' }), el('div', { class: 'doc-logo' }, el('b', {}, 'Top Hat Contracting'))),
              el('div', { class: 'doc-title' }, el('h1', {}, `${year} statement`), el('dl', {}, el('dt', {}, 'Contractor'), el('dd', {}, me.name), el('dt', {}, 'Printed'), el('dd', {}, new Date().toLocaleDateString())))),
            el('table', { class: 'doc-items' },
              el('thead', {}, el('tr', {}, ...['Job', 'Finished', 'Customer & address', ...(showPay ? ['Pay', 'Paid'] : [])].map((h, i) => el('th', { class: i > 2 ? 'num' : '' }, h)))),
              el('tbody', {}, ...list.map((j) => el('tr', {}, el('td', {}, `TH-${j.number}`), el('td', {}, new Date(doneAt(j)).toLocaleDateString()),
                el('td', {}, `${j.customerName}, ${j.address}`), ...(showPay ? [el('td', { class: 'num' }, earnedOf(j) ? usd(earnedOf(j)) : '—'),
                  el('td', { class: 'num' }, paidOf(j) ? `${usd(paidOf(j))}${lastPaid(j) ? ` · ${lastPaid(j).date}` : ''}` : 'Not yet')] : []))))),
            showPay ? el('div', { class: 'doc-totals' }, el('dl', {},
              el('dt', {}, 'Earned'), el('dd', {}, usd(pay(list))),
              el('dt', { class: 'big' }, 'Paid to you'), el('dd', { class: 'big' }, usd(paidSum(list))),
              el('dt', {}, 'Not paid yet'), el('dd', {}, usd(owedNow(list))))) : null,
            el('footer', { class: 'doc-foot' }, `Jobs ${me.name} completed for Top Hat Contracting in ${year}`));
          TH.docs.viewSheet(sheet, `${year} statement`);
        };
        const zipAll = async (btn) => {
          btn.disabled = true; say('Getting your files ready…');
          try {
            const JSZip = await TH.loadZip();
            const zip = new JSZip();
            zip.file(`${year}-jobs.csv`, TH.csv(rowsFor(list)));
            let n = 0;
            for (const j of list) {
              const folder = zip.folder(fileSafe(`TH-${j.number} ${j.customerName} ${j.address}`));
              for (const [i, f] of (j.uploads || []).entries()) {
                if (!f.url) continue;
                try { const blob = await (await fetch(f.url)).blob(); folder.file(`${f.stage ? f.stage + '-' : ''}${i + 1}-${fileSafe(f.name.replace(/\.[^.]+$/, ''))}${(f.name.match(/\.[^.]+$/) || ['.jpg'])[0]}`, blob); n++; }
                catch (e) { /* skip a file that won't load */ }
              }
              say(`Getting your files ready… ${n} photo${n === 1 ? '' : 's'}`);
            }
            TH.download(`top-hat-${fileSafe(me.name)}-${year}.zip`, await zip.generateAsync({ type: 'blob' }));
            say(`✓ Downloaded ${list.length} job${list.length === 1 ? '' : 's'} and ${n} photo${n === 1 ? '' : 's'}.`);
          } catch (e) { say(e.message); }
          btn.disabled = false;
        };
        body.replaceChildren(...[
          el('div', { class: 'row', style: 'flex-wrap:wrap' }, el('b', {}, 'Year'),
            ...years.map((y) => el('button', { type: 'button', class: 'chip', 'aria-pressed': String(y === year), onclick: () => { year = y; sessionStorageSet('crew.year', y); draw(); } }, String(y)))),
          el('div', { class: 'kpis three' },
            el('div', { class: 'kpi' }, el('b', {}, String(list.length)), el('span', {}, 'Jobs done')),
            showPay ? el('div', { class: 'kpi' }, el('b', {}, usd(pay(list))), el('span', {}, 'Earned')) : el('div', { class: 'kpi' }, el('b', {}, String(photos)), el('span', {}, 'Photos')),
            showPay ? el('div', { class: 'kpi' }, el('b', {}, usd(paidSum(list))), el('span', {}, 'Paid to you')) : null),
          showPay && owedNow(list) > 0 ? el('p', { class: 'muted small' }, `${usd(owedNow(list))} not paid yet. Bill Top Hat from each job as you finish each part.`) : null,
          el('section', { class: 'card stack' },
            el('h3', {}, '📒 Take your records with you'),
            el('p', { class: 'muted small' }, 'For your taxes or your books. Works with Excel, Numbers, Google Sheets, or just hand it to your accountant.'),
            el('button', { type: 'button', class: 'gold block', disabled: !list.length, onclick: () => TH.download(`top-hat-${fileSafe(me.name)}-${year}.csv`, TH.csv(rowsFor(list))) }, `⬇ Spreadsheet of ${year} jobs${showPay ? ' & pay' : ''}`),
            el('button', { type: 'button', class: 'ghost block', disabled: !list.length, onclick: statement }, `🖨 ${year} statement (print or PDF)`),
            el('button', { type: 'button', class: 'ghost block', disabled: !list.length, onclick: (e) => zipAll(e.currentTarget) }, `📦 Download everything (${photos} photo${photos === 1 ? '' : 's'} + spreadsheet)`),
            note),
          el('h2', {}, `${year} jobs`),
          list.length ? el('div', { class: 'crew-jobs' }, ...list.map(card)) : el('div', { class: 'card muted' }, `No finished jobs in ${year} yet.`)].filter(Boolean));
      };
      draw();
      view.replaceChildren(el('div', { class: 'stack', style: 'margin:20px 0' }, head, tabs, message ? el('div', { class: 'callout' }, message) : null, body));
      return;
    }

    if (which === 'done') {
      // Completed jobs: everything they've finished, grouped by month, with pay.
      const monthKey = (j) => { const x = new Date(doneAt(j) || Date.now()); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`; };
      const now = new Date();
      const thisMonth = finished.filter((j) => monthKey(j) === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
      const search = el('input', { type: 'search', placeholder: 'Search customer, address, job #…', 'aria-label': 'Search completed jobs' });
      const listWrap = el('div', { class: 'stack' });
      const draw = () => {
        const q = search.value.trim().toLowerCase();
        const list = finished.filter((j) => !q || [`TH-${j.number}`, j.customerName, j.address, j.zip, j.description, tradeOf(j.trade).label].join(' ').toLowerCase().includes(q));
        const groups = [];
        list.forEach((j) => { const k = monthKey(j); let g = groups.find((x) => x.k === k); if (!g) { g = { k, jobs: [] }; groups.push(g); } g.jobs.push(j); });
        listWrap.replaceChildren(...(groups.length ? groups.map((g) => {
          const [y, mo] = g.k.split('-').map(Number);
          return el('section', { class: 'stack', style: 'gap:8px' },
            el('div', { class: 'month-head' }, el('b', {}, new Date(y, mo - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })),
              el('span', {}, `${g.jobs.length} job${g.jobs.length === 1 ? '' : 's'}${showPay ? ' · ' + usd(pay(g.jobs)) : ''}`)),
            el('div', { class: 'crew-jobs' }, ...g.jobs.map(card)));
        }) : [el('div', { class: 'card muted' }, q ? 'No completed jobs match your search.' : 'No completed jobs yet. When you finish a job it’s saved here.')]));
      };
      search.addEventListener('input', draw);
      draw();
      view.replaceChildren(el('div', { class: 'stack', style: 'margin:20px 0' }, head, tabs,
        el('div', { class: 'kpis three' },
          el('div', { class: 'kpi' }, el('b', {}, String(finished.length)), el('span', {}, 'Jobs completed')),
          showPay ? el('div', { class: 'kpi' }, el('b', {}, usd(pay(thisMonth))), el('span', {}, 'Pay this month')) : el('div', { class: 'kpi' }, el('b', {}, String(thisMonth.length)), el('span', {}, 'This month')),
          showPay ? el('div', { class: 'kpi' }, el('b', {}, usd(pay(finished))), el('span', {}, 'Total pay')) : null),
        message ? el('div', { class: 'callout' }, message) : null,
        search, listWrap));
      return;
    }

    view.replaceChildren(el('div', { class: 'stack', style: 'margin:20px 0' },
      head, tabs,
      showPay ? el('div', { class: 'kpis', style: 'grid-template-columns:1fr 1fr' },
        el('div', { class: 'kpi' }, el('b', {}, usd(pay(notDone))), el('span', {}, `Upcoming pay · ${notDone.length} job${notDone.length === 1 ? '' : 's'}`)),
        el('div', { class: 'kpi' }, el('b', {}, usd(pay(finished))), el('span', {}, `Earned · ${finished.length} completed`))) : null,
      message ? el('div', { class: 'callout' }, message) : null,
      toConfirm ? el('div', { class: 'callout stage' }, `👋 ${toConfirm} new job${toConfirm === 1 ? '' : 's'} to confirm. Tap to open.`) : null,
      ...section('Today', today, 'Nothing scheduled for today.'),
      ...section('Upcoming', upcoming, 'No upcoming jobs. The office will text you when you’re assigned one.'),
      finished.length ? el('a', { class: 'btn ghost block', href: '#/done' }, `✓ See all ${finished.length} completed job${finished.length === 1 ? '' : 's'} →`) : null,
    ));
  }

  // Build an .ics file so the job lands in the phone's calendar.
  function calendarHref(j, company) {
    const pad = (n) => String(n).padStart(2, '0');
    const local = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
    const esc = (x) => String(x || '').replace(/\\/g, '\\\\').replace(/[,;]/g, (m) => '\\' + m).replace(/\n/g, '\\n');
    const start = new Date(j.scheduledFor);
    const end = new Date(start.getTime() + 2 * 3600e3);
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Top Hat Contracting//Crew//EN', 'BEGIN:VEVENT',
      `UID:th-${j.number}-${j.id}@tophat`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
      `DTSTART:${local(start)}`, `DTEND:${local(end)}`,
      `SUMMARY:${esc(`TH-${j.number} ${tradeOf(j.trade).label} · ${j.customerName}`)}`,
      `LOCATION:${esc(`${j.address} ${j.zip || ''}`)}`,
      `DESCRIPTION:${esc(`${j.description}\nCustomer: ${j.customerName} ${j.customerPhone}${company.phone ? `\nOffice: ${company.phone}` : ''}`)}`,
      'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
  }

  // One job, everything the contractor needs from start to finish.
  async function renderJob(id, message) {
    const { me, jobs, company = {}, error } = await loadCrew();
    if (!me) return renderLogin(error);
    const j = jobs.find((x) => x.id === id);
    if (!j) { location.hash = ''; return renderPortal('That job is no longer assigned to you.'); }
    urls.forEach((u) => URL.revokeObjectURL(u));
    const extra = j.crewToken ? await api.crew.job(j.crewToken) : null; // photos you've sent + your notes
    const uploads = extra ? extra.uploads : [];
    const notes = extra ? extra.notes || [] : j.notes || [];
    urls = uploads.map((f) => f.url).filter(Boolean);
    const t = tradeOf(j.trade);
    const n = `TH-${j.number}`;
    const custFirst = (j.customerName || '').split(' ')[0] || 'there';
    const myFirst = me.name.split(' ')[0];
    const co = company.name || 'Top Hat Contracting';
    const errorBox = el('div', { class: 'error', hidden: true, role: 'alert' });
    const fail = (err) => { errorBox.textContent = err.message; errorBox.hidden = false; errorBox.scrollIntoView({ block: 'center' }); };

    const go = async (change, msg, btn) => {
      if (btn) btn.disabled = true;
      try { await api.crewPortal.setProgress(j.id, change); renderJob(j.id, msg); }
      catch (err) { fail(err); if (btn) btn.disabled = false; }
    };
    const respond = async (response, note, btn) => {
      if (btn) btn.disabled = true;
      try { await api.crewPortal.respond(j.id, response, note); renderJob(j.id, response === 'confirmed' ? '✓ Confirmed. The office can see it.' : 'Sent. The office will reassign or reschedule.'); }
      catch (err) { fail(err); if (btn) btn.disabled = false; }
    };
    const sms = (body) => (j.customerPhone ? 'sms:' + j.customerPhone.replace(/[^\d+]/g, '') + '?&body=' + encodeURIComponent(body) : null);
    const TEXTS = [
      ['🚚 On my way', `Hi ${custFirst}, this is ${myFirst} with ${co}. I’m on my way now and should be there soon.`],
      ['⏰ Running late', `Hi ${custFirst}, this is ${myFirst} with ${co}. I’m running about 15 minutes late, sorry about that. See you soon.`],
      ['📍 I’m here', `Hi ${custFirst}, this is ${myFirst} with ${co}. I’ve arrived.`],
      ['✅ All done', `Hi ${custFirst}, this is ${myFirst} with ${co}. All finished up. Thanks for having us!`],
    ];

    // Next step: the one big button.
    const declineBox = el('div', { class: 'stack', hidden: true },
      el('textarea', { rows: 2, maxlength: '500', placeholder: 'Why? e.g. “Sick today” or “Can do Thursday instead”', 'aria-label': 'Reason' }),
      el('button', { class: 'block', onclick: (e) => respond('declined', declineBox.querySelector('textarea').value, e.currentTarget) }, 'Tell the office'));
    let step;
    const st = stageOf(j.stage);
    if (j.status === 'scheduled' && !j.crewResponse) {
      step = { icon: '👋', title: 'New job: can you do it?', why: j.scheduledFor ? `${fmtWhen(j.scheduledFor)} at ${j.address}` : 'The office will set the time.',
        btn: ['✓ I’ll be there', (e) => respond('confirmed', '', e.currentTarget)], second: ['Can’t make it', () => { declineBox.hidden = false; declineBox.querySelector('textarea').focus(); }] };
    } else if (j.status === 'scheduled' && j.crewResponse === 'declined') {
      step = { icon: '🙅', title: 'You told the office you can’t make it', why: j.crewResponseNote ? `“${j.crewResponseNote}”` : '', btn: ['Actually, I can make it', (e) => respond('confirmed', '', e.currentTarget)], ghost: true };
    } else if (j.status === 'scheduled' && j.stage === 'on_the_way') {
      step = { icon: '📍', title: 'When you get there', why: 'Tap Start work when you arrive.', btn: ['▶ Start work', (e) => go({ status: 'in_progress' }, `▶ ${n} started.`, e.currentTarget)],
        back: ['Not on my way yet', () => go({ stage: null }, `↩ ${n}: back to scheduled.`)] };
    } else if (j.status === 'scheduled') {
      step = { icon: '🚚', title: 'Head out when it’s time', why: j.scheduledFor ? `Scheduled ${fmtWhen(j.scheduledFor)}` : '',
        btn: ['🚚 On my way', (e) => go({ stage: 'on_the_way' }, 'on_the_way', e.currentTarget)],
        second: ['▶ I’m already here: start work', () => go({ status: 'in_progress' }, `▶ ${n} started.`)],
        back: ['Can’t make it after all', () => { declineBox.hidden = false; declineBox.querySelector('textarea').focus(); }] };
    } else if (j.status === 'in_progress' && st) {
      step = { icon: st.icon, title: st.label, why: 'Add a note so the office knows what’s needed.', btn: ['▶ Back to work', (e) => go({ stage: null }, `▶ ${n}: back to work.`, e.currentTarget)],
        second: ['✓ Finish job', () => finish()] };
    } else if (j.status === 'in_progress') {
      const hasMid = j.crewPay != null && company.showCrewPay !== false && TH.docs.crewScheduleOf(company).some((s) => s.when === 'mid');
      step = { icon: '🔨', title: j.halfwayAt ? 'Halfway there' : 'Working on it', why: j.startedAt ? `Started ${timeOf(new Date(j.startedAt).toISOString())} · ${dur(j.startedAt, Date.now())} so far` : '',
        btn: ['✓ Finish job', () => finish()],
        second: hasMid && !j.halfwayAt ? ['½ I’m halfway done', async () => {
          try { await api.crewPortal.halfway(j.id); renderJob(j.id, `½ ${n}: halfway done. You can bill the halfway payment once the first one is approved.`); }
          catch (err) { errorBox.textContent = err.message; errorBox.hidden = false; } }] : null,
        back: ['Undo start', () => { if (confirm('Undo start? The job goes back to Scheduled.')) go({ status: 'scheduled' }, `↩ ${n}: back to scheduled.`); }] };
    } else {
      step = { icon: '🎉', title: 'Job done. Thanks!', why: [j.crewPay != null ? `Your pay: ${usd(j.crewPay)}` : null, j.startedAt && j.finishedAt ? `Time on job: ${dur(j.startedAt, j.finishedAt)}` : null].filter(Boolean).join(' · '),
        btn: null, back: ['Not finished yet', () => { if (confirm(`Move ${n} back to Working?`)) go({ status: 'in_progress' }, `↩ ${n}: back to working.`); }] };
    }
    function finish() {
      go({ status: 'completed' }, `✓ ${n} finished. Thanks!`);
    }
    const onWayMsg = message === 'on_the_way';
    const nextCard = el('section', { class: 'card next-step' },
      el('span', { class: 'eyebrow' }, 'Next step'),
      el('div', { class: 'row', style: 'align-items:flex-start' }, el('span', { class: 'next-ic' }, step.icon),
        el('div', { style: 'flex:1;min-width:0' }, el('h3', {}, step.title), step.why ? el('p', { class: 'muted small' }, step.why) : null)),
      step.btn ? el('button', { class: (step.ghost ? 'ghost' : 'gold') + ' block big', onclick: step.btn[1] }, step.btn[0]) : null,
      step.second ? el('button', { class: 'link', onclick: step.second[1] }, step.second[0]) : null,
      declineBox,
      step.back ? el('button', { class: 'back-step', onclick: step.back[1] }, `← ${step.back[0]}`) : null);

    // One-tap buttons
    const textsBox = el('div', { class: 'texts', hidden: !onWayMsg },
      el('p', { class: 'muted small' }, onWayMsg ? `🚚 Marked on the way. Let ${custFirst} know:` : `Text ${custFirst}:`),
      ...TEXTS.map(([label, body]) => (sms(body) ? el('a', { class: 'btn ghost small', href: sms(body) }, label) : null)).filter(Boolean),
      sms('') ? el('a', { class: 'btn ghost small', href: sms('') }, '✏️ Write my own') : el('p', { class: 'muted small' }, 'No phone number on file.'));
    const quick = el('section', { class: 'card stack' },
      el('div', { class: 'quick' },
        el('a', { class: 'qbtn', href: maps(`${j.address} ${j.zip || ''}`), target: '_blank', rel: 'noopener' }, el('span', {}, '🧭'), 'Directions'),
        j.customerPhone ? el('a', { class: 'qbtn', href: tel(j.customerPhone) }, el('span', {}, '📞'), 'Call customer') : null,
        j.customerPhone ? el('button', { class: 'qbtn', onclick: () => { textsBox.hidden = !textsBox.hidden; } }, el('span', {}, '💬'), 'Text customer') : null,
        company.phone ? el('a', { class: 'qbtn', href: tel(company.phone) }, el('span', {}, '☎️'), 'Call office') : null,
        j.scheduledFor && j.status !== 'completed' ? el('a', { class: 'qbtn', href: calendarHref(j, company), download: `TH-${j.number}.ics` }, el('span', {}, '📅'), 'Add to calendar') : null),
      onWayMsg ? null : textsBox);

    // Progress
    const STEPS = [['Scheduled'], ['On the way'], ['Working'], ['Done']];
    const pos = j.status === 'completed' ? 3 : j.status === 'in_progress' ? 2 : j.stage === 'on_the_way' ? 1 : 0;
    const progress = el('section', { class: 'card stack' },
      el('h3', {}, 'Progress'),
      el('div', { class: 'crew-progress' },
        el('div', { class: 'stepper four', 'aria-label': 'Job progress' }, ...STEPS.map(([label], i) =>
          el('span', { class: 'stepbit ' + (i < pos ? 'done' : i === pos ? 'on' : '') }, el('span', { class: 'dot' }, i < pos ? '✓' : String(i + 1)), el('span', { class: 'lbl' }, label)))),
        st && j.stage !== 'on_the_way' ? el('div', { class: 'hold' }, `${st.icon} ${st.label}`) : null),
      j.status === 'in_progress' ? el('div', { class: 'stage-chips' },
        ...(TH.STAGES || []).filter((x) => x.status === 'in_progress').map((x) => el('button', { class: 'chip', 'aria-pressed': String(j.stage === x.id),
          onclick: () => go({ stage: j.stage === x.id ? null : x.id }, j.stage === x.id ? `▶ ${n}: back to work.` : `${x.icon} ${n}: ${x.label.toLowerCase()}. Add a note for the office.`) }, `${x.icon} ${x.label}`)),
        el('button', { class: 'chip', onclick: () => { if (confirm('Undo start? The job goes back to Scheduled.')) go({ status: 'scheduled' }, `↩ ${n}: back to scheduled.`); } }, '↩ Undo start')) : null,
      el('p', { class: 'muted small' }, [
        j.crewResponse === 'confirmed' ? '✓ You confirmed this job' : null,
        j.startedAt ? `Started ${new Date(j.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : null,
        j.finishedAt ? `Finished ${timeOf(new Date(j.finishedAt).toISOString())}` : null,
        j.progressAt ? `Last update: ${j.progressBy === me.name ? 'you' : j.progressBy || 'the office'}` : null,
      ].filter(Boolean).join(' · ')),
    );

    // The job itself
    const details = el('section', { class: 'card stack' },
      el('h3', {}, 'The job'),
      el('dl', { class: 'dl' },
        el('dt', {}, 'When'), el('dd', { style: 'font-weight:600' }, j.scheduledFor ? fmtWhen(j.scheduledFor) : 'To be set'),
        el('dt', {}, 'Address'), el('dd', {}, el('a', { href: maps(`${j.address} ${j.zip || ''}`), target: '_blank', rel: 'noopener' }, `${j.address} ${j.zip || ''}`)),
        el('dt', {}, 'Customer'), el('dd', {}, j.customerName, j.customerPhone ? ' · ' : '', j.customerPhone ? el('a', { href: tel(j.customerPhone) }, j.customerPhone) : ''),
        el('dt', {}, 'What to do'), el('dd', { style: 'white-space:pre-wrap' }, j.description),
        j.crewPay != null ? el('dt', {}, 'Your pay') : null, j.crewPay != null ? el('dd', { style: 'font-weight:700' }, usd(j.crewPay)) : null),
      (j.customerPhotos || []).length ? el('div', { class: 'stack', style: 'gap:6px' }, el('b', { class: 'small' }, 'Photos from the customer'),
        el('div', { class: 'photo-row' }, ...j.customerPhotos.map((src, i) => el('a', { href: src, target: '_blank' }, el('img', { src, alt: `Customer photo ${i + 1}` }))))) : null,
    );


    // Notes with one-tap starters
    const notesCard = notesSection(notes, async (txt) => { await api.crewPortal.addNote(j.id, txt); renderJob(j.id, '✓ Note sent to the office.'); });
    const ta = notesCard.querySelector('textarea');
    notesCard.insertBefore(el('div', { class: 'stage-chips' },
      ...['Need more materials: ', 'Customer not home.', 'Found extra work: ', 'Running late. ETA '].map((txt) =>
        el('button', { type: 'button', class: 'chip', onclick: () => { ta.value = txt; ta.focus(); ta.setSelectionRange(txt.length, txt.length); } }, txt.replace(/[:.]?\s*(ETA\s*)?$/, '')))), ta);

    // Bill Top Hat: each step of the crew pay schedule, plus extra work or materials.
    const billCard = (() => {
      if (company.showCrewPay === false) return null;
      const bills = j.crewBills || [];
      if (j.crewPay == null && !bills.length) return el('section', { class: 'card stack' }, el('h3', {}, '💵 Bill Top Hat'), el('p', { class: 'muted small' }, 'The office hasn’t set your pay for this job yet. Once they do, you can bill for each part as you finish it.'));
      const steps = j.crewPay != null ? TH.docs.crewSchedule(company, j.crewPay, j.status, !!j.halfwayAt) : [];
      const PILL = { submitted: ['Sent · waiting', ''], approved: ['Approved', 's-scheduled'], paid: ['Paid ✓', 's-completed'], declined: ['Declined', 's-lost'] };
      const billOf = (i) => bills.filter((b) => b.step === i).at(-1);
      const formWrap = el('div');
      const openForm = (step, label, amount) => {
        const note = el('textarea', { rows: 2, maxlength: '500', placeholder: step == null ? 'What was it? e.g. 2 extra bundles of shingles, replaced rotted fascia board' : 'What did you finish? (optional)', 'aria-label': 'What you finished' });
        const amt = step == null ? el('input', { type: 'number', inputmode: 'decimal', min: '1', step: '0.01', placeholder: 'Amount ($)', 'aria-label': 'Amount' }) : null;
        const err = el('div', { class: 'error', hidden: true, role: 'alert' });
        // Photos of the work are required, so the office can see what was done.
        let photos = [];
        const thumbs = el('div', { class: 'photo-row bill-photos', style: 'flex-wrap:wrap' });
        const drawThumbs = () => {
          thumbs.querySelectorAll('img').forEach((im) => URL.revokeObjectURL(im.src));
          thumbs.replaceChildren(...photos.map((f, i) => el('span', { class: 'bill-thumb' },
            el('img', { src: URL.createObjectURL(f), alt: `Photo ${i + 1}` }),
            el('button', { type: 'button', class: 'icon x', 'aria-label': `Remove photo ${i + 1}`, onclick: () => { photos.splice(i, 1); drawThumbs(); } }, '✕'))));
          addLbl.firstChild.textContent = photos.length ? '📷 Add more photos' : '📷 Take or add photos of the work';
        };
        const pick = el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, 'aria-label': 'Photos of the work', onchange: (e) => {
          photos = [...photos, ...[...e.target.files].filter((f) => /^image\//.test(f.type))].slice(0, 12); e.target.value = ''; err.hidden = true; drawThumbs(); } });
        const addLbl = el('label', { class: 'btn ghost block' }, el('span', {}, '📷 Take or add photos of the work'), pick);
        formWrap.replaceChildren(el('div', { class: 'bill-form stack' },
          el('b', {}, step == null ? 'Bill for extra work or materials' : `Bill for “${label}”: ${usd(amount)}`),
          amt, note,
          el('div', { class: 'stack', style: 'gap:6px' }, el('span', { class: 'small', style: 'font-weight:700' }, 'Photos of what you did (required)'), thumbs, addLbl),
          err,
          el('button', { type: 'button', class: 'gold block', onclick: async (e) => {
            const btn = e.currentTarget;
            if (!photos.length) { err.textContent = 'Add at least one photo of the work so the office can see what you did.'; err.hidden = false; return; }
            btn.disabled = true; btn.textContent = `Sending ${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}…`;
            try { const b = await api.crewPortal.bill(j.id, { step, amount: amt ? amt.value : null, note: note.value, photos, token: j.crewToken }); renderJob(j.id, `🧾 Bill sent: ${usd(b.amount)} for “${b.label}” with ${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}. The office will approve it and pay you.`); }
            catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; btn.textContent = '🧾 Send bill to Top Hat'; }
          } }, '🧾 Send bill to Top Hat'),
          el('button', { type: 'button', class: 'link', onclick: () => formWrap.replaceChildren() }, 'Cancel')));
        (amt || note).focus();
      };
      const row = (num, label, sub, amount, b, action) => el('li', { class: b?.status === 'paid' ? 'paid' : action?.tagName === 'BUTTON' ? 'due' : action ? 'locked' : '' },
        el('span', { class: 'n' }, b?.status === 'paid' ? '✓' : num),
        el('span', { class: 'body' }, el('b', {}, label), el('span', { class: 'amt' }, usd(amount)), el('span', { class: 'muted small' }, sub),
          b?.photos ? el('span', { class: 'muted small' }, `📷 ${b.photos} ${b.photos === 1 ? 'photo' : 'photos'} sent`) : null,
          b?.status === 'declined' && b.reason ? el('span', { class: 'small bad-text' }, `Declined: ${b.reason}`) : null),
        b && (b.status !== 'declined' || !action) ? el('span', { class: `pill ${PILL[b.status][1]}` }, b.status === 'paid' && b.paidDate ? `Paid ${b.paidDate.slice(5).replace('-', '/')}` : PILL[b.status][0]) : action || el('span', { class: 'muted small' }, 'Not yet'));
      const paidSoFar = paidOf(j);
      return el('section', { class: 'card stack' },
        el('div', { class: 'row' }, el('h3', {}, '💵 Bill Top Hat'), el('span', { class: 'spacer' }), el('span', { class: 'muted small' }, `${usd(paidSoFar)} of ${usd(earnedOf(j))} paid`)),
        el('p', { class: 'muted small' }, 'Bill for each part as you finish it, with photos of the work. The office approves it and pays you.'),
        el('ol', { class: 'sched-list' },
          ...steps.map((p) => { const b = billOf(p.index); const open = !b || b.status === 'declined';
            const can = open && p.reached && prevHandled(j, p.index);
            // Why it isn't open yet, in plain words.
            const wait = !open ? null : !prevHandled(j, p.index) ? `After “${steps[p.index - 1].label}” is approved`
              : !p.reached ? (p.when === 'mid' ? 'Tap “I’m halfway done” first' : p.when === 'done' ? 'When you finish the job' : 'When you start work') : null;
            return row(String(p.index + 1), p.label, `${Number(p.pct)}% · ${p.whenLabel}`, p.amount, b,
              can ? el('button', { type: 'button', class: 'gold small', onclick: () => openForm(p.index, p.label, p.amount) }, 'Bill now') : wait ? el('span', { class: 'muted small wait' }, wait) : null); }),
          ...bills.filter((b) => b.step == null).map((b) => row('+', 'Extra work / materials', b.note || '', b.amount, b, null))),
        formWrap,
        el('button', { type: 'button', class: 'ghost small', onclick: () => openForm(null, '', 0) }, '+ Bill for extra work or materials'));
    })();
    view.replaceChildren(el('div', { class: 'stack', style: 'margin:14px 0 20px' },
      el('div', { class: 'row' }, el('a', { class: 'btn ghost small', href: j.status === 'completed' ? '#/done' : '#/' }, j.status === 'completed' ? '← Completed' : '← My jobs'), el('span', { class: 'spacer' }), el('span', { class: `pill s-${j.status}` }, find(STATUSES, j.status).label)),
      el('div', {}, el('h1', { style: 'font-size:1.45rem' }, `${t.icon} ${t.label}`), el('p', { class: 'muted' }, `${n} · ${j.customerName}`)),
      message && !onWayMsg ? el('div', { class: 'callout' }, message) : null,
      errorBox, nextCard, onWayMsg ? textsBox : null, quick, billCard, progress, details, notesCard,
    ));
    window.scrollTo(0, 0);
  }

  async function route() {
    await renderNav();
    if (token) return renderUpload();
    if (invite) return renderInvite();
    const m = location.hash.match(/^#\/job\/(.+)$/);
    if (m) return renderJob(decodeURIComponent(m[1]));
    return renderPortal(null, location.hash === '#/done' ? 'done' : location.hash === '#/records' ? 'records' : 'active');
  }
  window.addEventListener('hashchange', () => { if (!token && !invite) route(); });
  route();
})();
