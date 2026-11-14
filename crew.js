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

  async function renderPortal(message) {
    const { me, jobs, error } = await loadCrew();
    if (!me) return renderLogin(error);
    const tk = todayKey();
    const notDone = jobs.filter((j) => j.status !== 'completed')
      .sort((a, b) => String(a.scheduledFor || '9999').localeCompare(String(b.scheduledFor || '9999')));
    const today = notDone.filter((j) => j.status === 'in_progress' || (j.scheduledFor || '').slice(0, 10) === tk || (j.scheduledFor && j.scheduledFor.slice(0, 10) < tk));
    const upcoming = notDone.filter((j) => !today.includes(j));
    const finished = jobs.filter((j) => j.status === 'completed').sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0)).slice(0, 20);
    const pay = (list) => list.reduce((t, j) => t + (Number(j.crewPay) || 0), 0);
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
      return el('a', { class: 'crew-job', href: `#/job/${j.id}` },
        el('span', { class: 'when' }, d ? el('b', {}, d.toLocaleDateString(undefined, { weekday: 'short' })) : el('b', {}, '—'),
          d ? el('span', {}, d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })) : null,
          d ? el('span', { class: 'muted' }, timeOf(j.scheduledFor)) : null),
        el('span', { class: 'body' },
          el('b', {}, `${t.icon} ${t.label} · TH-${j.number}`),
          el('span', { class: 'muted small' }, `${j.address}${j.zip ? ' ' + j.zip : ''}`),
          el('span', { class: 'flag ' + chip[1] }, chip[0])),
        el('span', { class: 'chev', 'aria-hidden': 'true' }, '›'));
    };
    const section = (title, list, empty) => [el('h2', { style: 'margin-top:6px' }, title),
      list.length ? el('div', { class: 'crew-jobs' }, ...list.map(card)) : el('div', { class: 'card muted' }, empty)];

    view.replaceChildren(el('div', { class: 'stack', style: 'margin:20px 0' },
      el('div', {}, el('h1', {}, `Hi ${me.name.split(' ')[0]}`), el('p', { class: 'muted' }, 'Your Top Hat jobs')),
      showPay ? el('div', { class: 'kpis', style: 'grid-template-columns:1fr 1fr' },
        el('div', { class: 'kpi' }, el('b', {}, usd(pay(notDone))), el('span', {}, `Upcoming pay · ${notDone.length} job${notDone.length === 1 ? '' : 's'}`)),
        el('div', { class: 'kpi' }, el('b', {}, usd(pay(finished))), el('span', {}, 'Finished jobs'))) : null,
      message ? el('div', { class: 'callout' }, message) : null,
      toConfirm ? el('div', { class: 'callout stage' }, `👋 ${toConfirm} new job${toConfirm === 1 ? '' : 's'} to confirm. Tap to open.`) : null,
      ...section('Today', today, 'Nothing scheduled for today.'),
      ...section('Upcoming', upcoming, 'No upcoming jobs. The office will text you when you’re assigned one.'),
      ...(finished.length ? section('Finished', finished, '') : []),
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
    const afterCount = uploads.filter((f) => f.stage === 'after').length;

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
        second: ['↩ Not on my way', () => go({ stage: null }, `↩ ${n}: back to scheduled.`)] };
    } else if (j.status === 'scheduled') {
      step = { icon: '🚚', title: 'Head out when it’s time', why: j.scheduledFor ? `Scheduled ${fmtWhen(j.scheduledFor)}` : '',
        btn: ['🚚 On my way', (e) => go({ stage: 'on_the_way' }, 'on_the_way', e.currentTarget)],
        second: ['▶ I’m already here: start work', () => go({ status: 'in_progress' }, `▶ ${n} started.`)] };
    } else if (j.status === 'in_progress' && st) {
      step = { icon: st.icon, title: st.label, why: 'Add a note so the office knows what’s needed.', btn: ['▶ Back to work', (e) => go({ stage: null }, `▶ ${n}: back to work.`, e.currentTarget)],
        second: ['✓ Finish job', () => finish()] };
    } else if (j.status === 'in_progress') {
      step = { icon: '🔨', title: 'Working on it', why: j.startedAt ? `Started ${timeOf(new Date(j.startedAt).toISOString())} · ${dur(j.startedAt, Date.now())} so far` : '',
        btn: ['✓ Finish job', () => finish()] };
    } else {
      step = { icon: '🎉', title: 'Job done. Thanks!', why: [j.crewPay != null ? `Your pay: ${usd(j.crewPay)}` : null, j.startedAt && j.finishedAt ? `Time on job: ${dur(j.startedAt, j.finishedAt)}` : null].filter(Boolean).join(' · '),
        btn: null, second: ['↩ Not finished yet', () => { if (confirm(`Move ${n} back to Working?`)) go({ status: 'in_progress' }, `↩ ${n}: back to working.`); }] };
    }
    function finish() {
      if (!afterCount && !confirm('You haven’t added any After photos yet.\n\nTap OK to finish anyway, or Cancel to add photos first.')) {
        photoStage = 'after'; renderPhotoStage(); photosCard.scrollIntoView({ block: 'start', behavior: 'smooth' }); return;
      }
      go({ status: 'completed' }, `✓ ${n} finished. Thanks!`);
    }
    const onWayMsg = message === 'on_the_way';
    const nextCard = el('section', { class: 'card next-step' },
      el('span', { class: 'eyebrow' }, 'Next step'),
      el('div', { class: 'row', style: 'align-items:flex-start' }, el('span', { class: 'next-ic' }, step.icon),
        el('div', { style: 'flex:1;min-width:0' }, el('h3', {}, step.title), step.why ? el('p', { class: 'muted small' }, step.why) : null)),
      step.btn ? el('button', { class: (step.ghost ? 'ghost' : 'gold') + ' block big', onclick: step.btn[1] }, step.btn[0]) : null,
      step.second ? el('button', { class: 'link', onclick: step.second[1] }, step.second[0]) : null,
      declineBox);

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

    // Photos (Before / During / After), right here
    let photoStage = j.status === 'completed' ? 'after' : j.status === 'in_progress' ? 'during' : 'before';
    const stageSeg = el('div', { class: 'seg3', role: 'radiogroup', 'aria-label': 'Photo stage' });
    function renderPhotoStage() {
      stageSeg.replaceChildren(...PHOTO_STAGES.map((s) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(photoStage === s.id), onclick: () => { photoStage = s.id; renderPhotoStage(); } }, s.label)));
    }
    renderPhotoStage();
    const photoStatus = el('p', { class: 'muted small', role: 'status', 'aria-live': 'polite' });
    const photoNote = el('input', { type: 'text', placeholder: 'Optional caption, e.g. “Rot behind the sink”', autocomplete: 'off' });
    const picker = el('input', { type: 'file', accept: 'image/*,application/pdf', multiple: true, hidden: true, onchange: async (e) => {
      const files = [...e.target.files];
      if (!files.length || !j.crewToken) return;
      let done = 0;
      for (const f of files) {
        photoStatus.textContent = `Uploading ${done + 1} of ${files.length}…`;
        try { await api.crew.upload(j.crewToken, f, { stage: photoStage, note: photoNote.value }); done++; }
        catch (err) { fail(err); break; }
      }
      if (done) renderJob(j.id, `📷 ${done} ${done === 1 ? 'photo' : 'photos'} sent to the office.`);
    } });
    const byStage = PHOTO_STAGES.map((s) => [s, uploads.filter((f) => f.stage === s.id)]).filter(([, l]) => l.length);
    const photosCard = el('section', { class: 'card stack' },
      el('div', { class: 'row' }, el('h3', { style: 'flex:1' }, '📷 Job photos'), uploads.length ? el('span', { class: 'pill' }, String(uploads.length)) : null),
      stageSeg, photoNote,
      el('label', { class: 'btn gold block big' }, '📷 Take or add photos', picker),
      photoStatus,
      ...byStage.map(([s, list]) => el('div', { class: 'stack', style: 'gap:6px' }, el('b', { class: 'small' }, `${s.label} (${list.length})`),
        el('div', { class: 'photo-row', style: 'flex-wrap:wrap' }, ...list.map((f) => /^image\//.test(f.mime) && f.url
          ? el('img', { src: f.url, alt: f.note || f.name, title: f.note || f.name, style: 'width:84px;height:84px' })
          : el('span', { class: 'pill' }, '📎 ' + f.name))))),
    );

    // Notes with one-tap starters
    const notesCard = notesSection(notes, async (txt) => { await api.crewPortal.addNote(j.id, txt); renderJob(j.id, '✓ Note sent to the office.'); });
    const ta = notesCard.querySelector('textarea');
    notesCard.insertBefore(el('div', { class: 'stage-chips' },
      ...['Need more materials: ', 'Customer not home.', 'Found extra work: ', 'Running late. ETA '].map((txt) =>
        el('button', { type: 'button', class: 'chip', onclick: () => { ta.value = txt; ta.focus(); ta.setSelectionRange(txt.length, txt.length); } }, txt.replace(/[:.]?\s*(ETA\s*)?$/, '')))), ta);

    view.replaceChildren(el('div', { class: 'stack', style: 'margin:14px 0 20px' },
      el('div', { class: 'row' }, el('a', { class: 'btn ghost small', href: '#/' }, '← My jobs'), el('span', { class: 'spacer' }), el('span', { class: `pill s-${j.status}` }, find(STATUSES, j.status).label)),
      el('div', {}, el('h1', { style: 'font-size:1.45rem' }, `${t.icon} ${t.label}`), el('p', { class: 'muted' }, `${n} · ${j.customerName}`)),
      message && !onWayMsg ? el('div', { class: 'callout' }, message) : null,
      errorBox, nextCard, onWayMsg ? textsBox : null, quick, progress, details, photosCard, notesCard,
    ));
    window.scrollTo(0, 0);
  }

  async function route() {
    await renderNav();
    if (token) return renderUpload();
    if (invite) return renderInvite();
    const m = location.hash.match(/^#\/job\/(.+)$/);
    return m ? renderJob(decodeURIComponent(m[1])) : renderPortal();
  }
  window.addEventListener('hashchange', () => { if (!token && !invite) route(); });
  route();
})();
