'use strict';
/*
 * Crew pages:
 *   crew.html?t=CODE       → one job's photo upload (from the job text; no login)
 *   crew.html?invite=CODE  → set up a crew login (one-time invite from the office)
 *   crew.html              → crew sign-in, then "My jobs" (only jobs assigned to them)
 * Never shows customer prices, profit, estimates, invoices or office notes.
 */
(function () {
  const { api, TRADES, PHOTO_STAGES, STATUSES, el, fmtWhen, find } = TH;
  const view = document.getElementById('view');
  const nav = document.getElementById('nav');
  const params = new URLSearchParams(location.search);
  const token = params.get('t') || '';
  const invite = params.get('invite') || '';
  let stage = 'before';
  let urls = [];

  if (api.mode === 'preview') document.getElementById('previewBanner').hidden = false;
  const usd = (n) => '$' + Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
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
        try { await api.crew.upload(token, f, { stage, note: note.value }); done++; }
        catch (err) { errorBox.textContent = err.message; errorBox.hidden = false; break; }
      }
      if (done) renderUpload(`✓ ${done} ${done === 1 ? 'file' : 'files'} sent to the Top Hat office.`);
      else status.textContent = '';
    } });

    const byStage = PHOTO_STAGES.map((s) => [s, job.uploads.filter((f) => f.stage === s.id)]).filter(([, l]) => l.length);
    const other = job.uploads.filter((f) => !find(PHOTO_STAGES, f.stage));

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
        el('div', { class: 'field' }, el('b', { style: 'font-size:.92rem' }, 'These photos are…'),
          el('div', { class: 'seg3', role: 'radiogroup', 'aria-label': 'Photo stage' }, ...PHOTO_STAGES.map((s) =>
            el('button', { type: 'button', role: 'radio', 'aria-checked': String(stage === s.id), onclick: (e) => {
              stage = s.id;
              e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b === e.currentTarget)));
            } }, s.label)))),
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
        ...[...byStage, ...(other.length ? [[{ label: 'Other' }, other]] : [])].map(([s, list]) => el('div', { class: 'stack', style: 'gap:6px' },
          el('b', { class: 'small' }, s.label),
          el('div', { class: 'photo-row', style: 'flex-wrap:wrap' }, ...list.map((f) => /^image\//.test(f.mime) && f.url
            ? el('img', { src: f.url, alt: f.note || f.name, title: f.note || f.name, style: 'width:96px;height:96px' })
            : el('span', { class: 'pill' }, '📎 ' + f.name))))),
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

  /* ---------- my jobs ---------- */
  async function renderPortal(message) {
    const me = await crewMe();
    if (!me) return renderLogin();
    let jobs;
    try { jobs = await api.crewPortal.jobs(); }
    catch (err) { await api.auth.signOut(); await renderNav(); return renderLogin(err.message); }
    const upcoming = jobs.filter((j) => j.status !== 'completed')
      .sort((a, b) => String(a.scheduledFor || '9999').localeCompare(String(b.scheduledFor || '9999')));
    const finished = jobs.filter((j) => j.status === 'completed').sort((a, b) => String(b.scheduledFor || '').localeCompare(String(a.scheduledFor || ''))).slice(0, 30);
    const pay = (list) => list.reduce((t, j) => t + (Number(j.crewPay) || 0), 0);
    const showPay = jobs.some((j) => j.crewPay != null);
    const errorBox = el('div', { class: 'error', hidden: true, role: 'alert' });

    const card = (j) => {
      const t = tradeOf(j.trade);
      const st = find(STATUSES, j.status);
      const act = async (status, btn) => {
        if (status === 'completed' && !confirm(`Mark TH-${j.number} as finished?`)) return;
        btn.disabled = true;
        try { await api.crewPortal.setStatus(j.id, status); renderPortal(status === 'completed' ? `✓ TH-${j.number} marked finished. Thanks!` : `▶ TH-${j.number} marked started.`); }
        catch (err) { errorBox.textContent = err.message; errorBox.hidden = false; btn.disabled = false; }
      };
      const notesHolder = el('div');
      const toggleNotes = () => {
        if (notesHolder.firstChild) { notesHolder.replaceChildren(); return; }
        notesHolder.replaceChildren(notesSection(j.notes || [], async (t) => {
          await api.crewPortal.addNote(j.id, t);
          renderPortal(`✓ Note sent to the office about TH-${j.number}.`);
        }, { compact: true }));
        notesHolder.querySelector('textarea').focus();
      };
      return el('article', { class: 'card job-card' },
        el('div', { class: 'head' },
          el('span', { style: 'font-size:1.6rem' }, t.icon),
          el('div', { class: 't' }, el('h3', {}, `TH-${j.number} · ${t.label}`),
            el('p', { class: 'small', style: 'font-weight:600' }, j.scheduledFor ? '📅 ' + fmtWhen(j.scheduledFor) : 'Date to be set')),
          el('span', { class: `pill s-${j.status}` }, st.label)),
        el('dl', { class: 'dl' },
          el('dt', {}, 'Address'), el('dd', {}, el('a', { href: maps(`${j.address} ${j.zip}`), target: '_blank', rel: 'noopener' }, `${j.address} ${j.zip}`)),
          el('dt', {}, 'Customer'), el('dd', {}, j.customerName, j.customerPhone ? ' · ' : '', j.customerPhone ? el('a', { href: tel(j.customerPhone) }, j.customerPhone) : ''),
          el('dt', {}, 'Job'), el('dd', { style: 'white-space:pre-wrap' }, j.description),
          j.crewPay != null ? el('dt', {}, 'Your pay') : null, j.crewPay != null ? el('dd', { style: 'font-weight:700' }, usd(j.crewPay)) : null),
        el('div', { class: 'row wrap-row' },
          j.crewToken ? el('a', { class: 'btn ghost', style: 'flex:1', href: `crew.html?t=${j.crewToken}` }, `📷 Photos${j.photos ? ` (${j.photos})` : ''}`) : null,
          el('button', { class: 'ghost', style: 'flex:1', onclick: toggleNotes }, `📝 Notes${(j.notes || []).length ? ` (${j.notes.length})` : ''}`),
          j.status === 'scheduled' ? el('button', { class: 'ghost', style: 'flex:1', onclick: (e) => act('in_progress', e.currentTarget) }, '▶ Started') : null,
          j.status !== 'completed' ? el('button', { class: 'gold', style: 'flex:1', onclick: (e) => act('completed', e.currentTarget) }, '✓ Finished') : null),
        notesHolder,
      );
    };

    view.replaceChildren(el('div', { class: 'stack', style: 'margin:20px 0' },
      el('div', {}, el('h1', {}, `Hi ${me.name.split(' ')[0]}`), el('p', { class: 'muted' }, 'Your Top Hat jobs')),
      showPay ? el('div', { class: 'kpis', style: 'grid-template-columns:1fr 1fr' },
        el('div', { class: 'kpi' }, el('b', {}, usd(pay(upcoming))), el('span', {}, `Upcoming pay · ${upcoming.length} job${upcoming.length === 1 ? '' : 's'}`)),
        el('div', { class: 'kpi' }, el('b', {}, usd(pay(finished))), el('span', {}, 'Finished jobs'))) : null,
      message ? el('div', { class: 'callout' }, message) : null,
      errorBox,
      el('h2', {}, 'Upcoming'),
      upcoming.length ? upcoming.map(card) : el('div', { class: 'card muted' }, 'No upcoming jobs right now. The office will text you when you’re assigned one.'),
      finished.length ? el('h2', { style: 'margin-top:8px' }, 'Finished') : null,
      ...finished.map(card),
    ));
  }

  async function route() {
    await renderNav();
    if (token) return renderUpload();
    if (invite) return renderInvite();
    return renderPortal();
  }
  route();
})();
