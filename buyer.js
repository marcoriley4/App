'use strict';
/* Buyer side: post a job → create an account → track it. */
(function () {
  const { api, TRADES, TIMEFRAMES, BUDGETS, STATUSES, FILE_KINDS, el, ago, fmtWhen, find, shrinkImage } = TH;
  const view = document.getElementById('view');
  const DRAFT_KEY = 'tophat.draft.v1';
  const MAX_PHOTOS = 5;

  document.getElementById('year').textContent = new Date().getFullYear();
  if (api.mode === 'preview') document.getElementById('previewBanner').hidden = false;

  /* ---------- draft (survives a refresh while filling the form) ---------- */
  const emptyDraft = () => ({ step: 1, trade: '', description: '', address: '', zip: '', timeframe: '', budget: '', photos: [] });
  let draft = emptyDraft();
  try { draft = { ...draft, ...JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}') }; } catch (e) { /* ignore */ }
  function saveDraft() { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (e) { /* photos may not fit; fine */ } }
  function clearDraft() { draft = emptyDraft(); try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ } }

  /* ---------- routing ---------- */
  const routes = { '': home, request, done, jobs: myJobs, login };
  async function route() {
    const name = location.hash.replace(/^#\/?/, '').split('?')[0];
    const fn = routes[name] || home;
    await renderNav();
    view.replaceChildren();
    await fn();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  const go = (path) => { if (location.hash === '#/' + path) route(); else location.hash = '#/' + path; };

  async function renderNav() {
    const me = await api.auth.me();
    const nav = document.getElementById('nav');
    if (me && me.role === 'staff') {
      nav.replaceChildren(el('a', { class: 'btn ghost small', href: 'admin.html' }, 'Staff area'));
    } else if (me && me.role === 'crew') {
      nav.replaceChildren(el('a', { class: 'btn ghost small', href: 'crew.html' }, 'My crew jobs'));
    } else if (me) {
      nav.replaceChildren(
        el('a', { class: 'btn ghost small', href: '#/jobs' }, 'My jobs'),
        el('button', { class: 'link small', onclick: async () => { await api.auth.signOut(); go(''); } }, 'Log out'),
      );
    } else {
      nav.replaceChildren(el('a', { class: 'btn ghost small', href: '#/login' }, 'Log in'));
    }
  }

  /* ---------- home ---------- */
  async function home() {
    view.append(el('div', { class: 'stack' },
      el('section', { class: 'hero' },
        el('h1', {}, 'Get your project done right.'),
        el('p', {}, "Tell us what you need. Top Hat Contracting reviews every request, schedules the work, and sends a trusted crew to your door."),
      ),
      el('a', { class: 'btn gold block', href: '#/request', onclick: () => { if (draft.step > 3) clearDraft(); } }, 'Request a job →'),
      el('div', { class: 'trust' },
        el('div', {}, el('strong', {}, '🆓'), 'Free to request'),
        el('div', {}, el('strong', {}, '📞'), 'We call you to confirm'),
        el('div', {}, el('strong', {}, '🧰'), 'Crews we know and trust'),
      ),
      el('div', { class: 'card stack' },
        el('h3', {}, 'How it works'),
        ...[
          ['1', 'Tell us about the job', 'What needs doing, where, and when. Add photos if you have them.'],
          ['2', 'We review it and call you', 'Our team checks the details and answers your questions.'],
          ['3', 'We schedule the work', 'You get a date and the name of the crew lead coming out.'],
        ].map(([n, t, d]) => el('div', { class: 'row', style: 'align-items:flex-start' },
          el('span', { class: 'avatar', style: 'background:var(--gold);color:#1b1404' }, n),
          el('div', {}, el('b', {}, t), el('p', { class: 'muted small' }, d)))),
      ),
    ));
  }

  /* ---------- request a job (3 steps + account) ---------- */
  async function request() {
    const me = await api.auth.me();
    if (me && me.role === 'staff') { view.append(el('div', { class: 'card', style: 'margin-top:24px' }, 'You are logged in as staff. ', el('a', { href: 'admin.html' }, 'Go to the staff area'), '.')); return; }
    if (draft.step < 1 || draft.step > 3 || !find(TRADES, draft.trade)) draft.step = 1;
    const totalSteps = me ? 2 : 3;
    const step = Math.min(draft.step, me ? 2 : 3);
    const errorBox = el('div', { class: 'error', hidden: true, role: 'alert' });
    const showError = (msg) => { errorBox.textContent = msg; errorBox.hidden = false; errorBox.scrollIntoView({ block: 'center', behavior: 'smooth' }); };

    const header = el('div', { class: 'stack', style: 'margin-top:20px' },
      el('div', { class: 'steps' }, ...Array.from({ length: totalSteps }, (_, i) => el('span', { class: i < step ? 'on' : '' }))),
      el('p', { class: 'muted small' }, `Step ${step} of ${totalSteps}`),
    );
    view.append(header);

    if (step === 1) {
      const form = el('form', { class: 'stack', onsubmit: (e) => {
        e.preventDefault();
        const t = new FormData(form).get('trade');
        if (!t) return showError('Pick the type of work so we know who to send.');
        draft.trade = t; draft.step = 2; saveDraft(); route();
      } },
        el('h1', {}, 'What do you need done?'),
        errorBox,
        el('div', { class: 'tiles', role: 'radiogroup', 'aria-label': 'Type of work' }, ...TRADES.map((t) =>
          el('label', { class: 'tile' },
            el('input', { type: 'radio', name: 'trade', value: t.id, checked: draft.trade === t.id, onchange: () => { draft.trade = t.id; saveDraft(); } }),
            el('span', { class: 'ic' }, t.icon), t.label))),
        el('button', { class: 'gold block', type: 'submit' }, 'Next'),
      );
      view.append(form);
      return;
    }

    if (step === 2) {
      const trade = find(TRADES, draft.trade);
      const photosWrap = el('div', { class: 'photos' });
      const renderPhotos = () => {
        photosWrap.replaceChildren(...[
          ...draft.photos.map((src, i) => el('div', { class: 'photo' },
            el('img', { src, alt: `Photo ${i + 1}` }),
            el('button', { type: 'button', 'aria-label': `Remove photo ${i + 1}`, onclick: () => { draft.photos.splice(i, 1); saveDraft(); renderPhotos(); } }, '✕'))),
          draft.photos.length < MAX_PHOTOS ? el('label', { class: 'add-photo' },
            el('span', {}, el('b', {}, '+'), 'Add photo'),
            el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: async (e) => {
              const files = [...e.target.files].slice(0, MAX_PHOTOS - draft.photos.length);
              for (const f of files) { try { draft.photos.push(await shrinkImage(f)); } catch (err) { showError(err.message); } }
              saveDraft(); renderPhotos();
            } })) : null,
        ].filter(Boolean));
      };
      renderPhotos();

      // Keep what's typed so Back / change / refresh never loses it.
      const capture = () => {
        const f = new FormData(form);
        Object.assign(draft, {
          description: f.get('description').trim(), address: f.get('address').trim(), zip: f.get('zip').trim(),
          timeframe: f.get('timeframe') || '', budget: f.get('budget') || '',
        });
        saveDraft();
      };
      const back = () => { capture(); draft.step = 1; saveDraft(); route(); };
      const form = el('form', { class: 'stack', novalidate: true, oninput: () => capture(), onsubmit: async (e) => {
        e.preventDefault();
        capture();
        if (draft.description.length < 10) return showError('Please describe the job in a sentence or two.');
        if (!draft.address) return showError('Please enter the address where the work is.');
        if (!/^\d{5}$/.test(draft.zip)) return showError('Please enter a 5-digit ZIP code.');
        if (!draft.timeframe) return showError('When do you need it done?');
        if (me) return submitJob(showError);
        draft.step = 3; saveDraft(); route();
      } },
        el('div', { class: 'row' }, el('h1', {}, 'Tell us about the job'), el('span', { class: 'spacer' })),
        el('div', { class: 'summary' }, trade.icon + ' ', el('b', {}, trade.label), ' · ',
          el('button', { type: 'button', class: 'link', onclick: back }, 'change')),
        errorBox,
        el('label', { class: 'field' }, 'What needs to be done?',
          el('textarea', { name: 'description', placeholder: 'e.g. Water leaking under the kitchen sink. It started last week and the cabinet floor is getting soft.', value: draft.description })),
        el('label', { class: 'field' }, 'Address of the job',
          el('input', { name: 'address', placeholder: 'Street address, city', autocomplete: 'street-address', value: draft.address })),
        el('label', { class: 'field' }, 'ZIP code',
          el('input', { name: 'zip', inputmode: 'numeric', maxlength: '5', autocomplete: 'postal-code', placeholder: '12345', value: draft.zip, style: 'max-width:160px' })),
        el('div', { class: 'field' }, el('b', { class: 'small', style: 'font-size:.92rem' }, 'When do you need it done?'),
          el('div', { class: 'choices', style: 'margin-top:6px' }, ...TIMEFRAMES.map((t) =>
            el('label', { class: 'choice' }, el('input', { type: 'radio', name: 'timeframe', value: t.id, checked: draft.timeframe === t.id }), el('span', {}, t.label))))),
        el('div', { class: 'field' }, el('b', { style: 'font-size:.92rem' }, 'Rough budget ', el('span', { class: 'muted small', style: 'font-weight:400' }, '(optional)')),
          el('div', { class: 'choices', style: 'margin-top:6px' }, ...BUDGETS.map((b) =>
            el('label', { class: 'choice' }, el('input', { type: 'radio', name: 'budget', value: b.id, checked: draft.budget === b.id }), el('span', {}, b.label))))),
        el('div', { class: 'field' }, el('b', { style: 'font-size:.92rem' }, 'Photos ', el('span', { class: 'muted small', style: 'font-weight:400' }, `(optional, up to ${MAX_PHOTOS})`)),
          el('p', { class: 'muted small' }, 'Photos help us quote faster.'), photosWrap),
        el('div', { class: 'row' },
          el('button', { type: 'button', class: 'ghost', onclick: back }, 'Back'),
          el('button', { class: 'gold', type: 'submit', style: 'flex:1' }, me ? 'Send request' : 'Next')),
      );
      view.append(form);
      return;
    }

    // Step 3: create an account to send the request.
    const form = el('form', { class: 'stack', novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        await api.auth.signUp({ name: f.get('name'), phone: f.get('phone'), email: f.get('email'), password: f.get('password') });
        await submitJob(showError);
      } catch (err) { showError(err.message); }
      finally { btn.disabled = false; }
    } },
      el('h1', {}, 'Last step: your contact info'),
      el('p', { class: 'muted' }, "Create a free account so we can reach you about this job, and so you can check its progress anytime."),
      errorBox,
      el('label', { class: 'field' }, 'Full name', el('input', { name: 'name', autocomplete: 'name', required: true })),
      el('label', { class: 'field' }, 'Mobile phone', el('span', { class: 'hint' }, "We'll call or text you to confirm the details."),
        el('input', { name: 'phone', type: 'tel', autocomplete: 'tel', inputmode: 'tel', placeholder: '(555) 123-4567', required: true })),
      el('label', { class: 'field' }, 'Email', el('input', { name: 'email', type: 'email', autocomplete: 'email', inputmode: 'email', required: true })),
      el('label', { class: 'field' }, 'Create a password', el('span', { class: 'hint' }, 'At least 8 characters.'),
        el('input', { name: 'password', type: 'password', autocomplete: 'new-password', minlength: '8', required: true })),
      el('div', { class: 'row' },
        el('button', { type: 'button', class: 'ghost', onclick: () => { draft.step = 2; saveDraft(); route(); } }, 'Back'),
        el('button', { class: 'gold', type: 'submit', style: 'flex:1' }, 'Create account & send request')),
      el('p', { class: 'muted small', style: 'text-align:center' }, 'Already have an account? ', el('a', { href: '#/login?next=request' }, 'Log in'), ' and your request will be waiting.'),
    );
    view.append(form);
  }

  async function submitJob(showError) {
    try {
      await api.jobs.create(draft);
      clearDraft();
      go('done');
    } catch (err) { showError(err.message); }
  }

  /* ---------- confirmation ---------- */
  async function done() {
    const me = await api.auth.me();
    view.append(el('div', { class: 'card stack', style: 'margin-top:28px;text-align:center' },
      el('div', { class: 'done-mark' }, '✓'),
      el('h1', {}, 'Request received!'),
      el('p', { class: 'muted' }, `Thanks${me ? ', ' + me.name.split(' ')[0] : ''}. The Top Hat team will review your job and reach out ${me?.phone ? 'at ' + me.phone : 'soon'} to confirm the details.`),
      el('a', { class: 'btn block', href: '#/jobs' }, 'See my jobs'),
      el('a', { class: 'btn ghost block', href: '#/request' }, 'Request another job'),
    ));
  }

  /* ---------- my jobs ---------- */
  const TRACK = ['new', 'qualifying', 'scheduled', 'completed'];
  const TRACK_LABELS = ['Received', 'Reviewing', 'Scheduled', 'Done'];
  async function myJobs() {
    const me = await api.auth.me();
    if (!me) return go('login?next=jobs');
    const jobs = await api.jobs.mine();
    const docs = Object.fromEntries(await Promise.all(jobs.map(async (j) => [j.id, j.sharedFiles ? await api.files.forCustomer(j.id) : []])));
    const [paper, company] = await Promise.all([api.docs.mine(), api.settings.get()]);
    const D = TH.docs;
    const openPaper = (j, dc) => {
      const acts = [];
      if (dc.type === 'estimate' && dc.status === 'sent') {
        acts.push((close) => el('button', { class: 'gold block', onclick: async (e) => {
          if (!confirm(`Approve estimate ${dc.number} for ${D.usd(D.totals(dc).total)}?`)) return;
          e.currentTarget.disabled = true;
          try { await api.docs.respond(dc.id, true); close(); route(); } catch (err) { alert(err.message); e.currentTarget.disabled = false; }
        } }, `✓ Approve estimate (${D.usd(D.totals(dc).total)})`));
        acts.push((close) => el('button', { class: 'ghost block', onclick: async (e) => {
          if (!confirm('Decline this estimate? You can still call us with questions.')) return;
          e.currentTarget.disabled = true;
          try { await api.docs.respond(dc.id, false); close(); route(); } catch (err) { alert(err.message); e.currentTarget.disabled = false; }
        } }, 'Decline'));
      }
      if (dc.type === 'invoice' && D.owed(dc) > 0 && dc.payLink) {
        acts.push(el('a', { class: 'btn gold block', href: dc.payLink, target: '_blank', rel: 'noopener' }, `💳 Pay ${D.usd(D.owed(dc))} by card`));
      }
      D.view(dc, { job: j, customer: me, company }, acts);
    };
    view.append(el('div', { class: 'stack', style: 'margin-top:24px' },
      el('div', { class: 'row' }, el('h1', {}, 'My jobs'), el('span', { class: 'spacer' }), el('a', { class: 'btn gold small', href: '#/request' }, '+ New request')),
      jobs.length ? null : el('div', { class: 'card muted' }, "You haven't requested any jobs yet."),
      ...jobs.map((j) => {
        const trade = find(TRADES, j.trade) || TRADES.at(-1);
        const st = find(STATUSES, j.status);
        const reached = j.status === 'in_progress' ? 2 : TRACK.indexOf(j.status);
        return el('article', { class: 'card job-card' },
          el('div', { class: 'head' },
            el('span', { style: 'font-size:1.6rem' }, trade.icon),
            el('div', { class: 't' }, el('h3', {}, trade.label), el('p', { class: 'muted small' }, `Job TH-${j.number} · ${j.address} · requested ${ago(j.created)}`)),
            el('span', { class: `pill s-${j.status}` }, st.buyer)),
          el('p', { class: 'small' }, j.description),
          j.status === 'lost' ? el('p', { class: 'muted small' }, 'This request was closed. Questions? Just request a new job and mention it.')
            : el('div', { class: 'track', 'aria-label': `Progress: ${st.buyer}` }, ...TRACK_LABELS.map((l, i) => el('div', { class: i <= reached ? 'on' : '' }, l))),
          j.scheduledFor && ['scheduled', 'in_progress'].includes(j.status)
            ? el('div', { class: 'callout' }, '📅 ', el('b', {}, fmtWhen(j.scheduledFor)), j.contractorName ? ` · ${j.contractorName} from Top Hat is coming out.` : '')
            : null,
          (paper[j.id] || []).length ? el('div', { class: 'stack', style: 'gap:6px' }, el('b', { class: 'small' }, 'Estimates & invoices'),
            el('div', { class: 'doc-list' }, ...paper[j.id].map((dc) => el('button', { type: 'button', class: 'doc-row', onclick: () => openPaper(j, dc) },
              el('span', { class: 'ic' }, dc.type === 'invoice' ? '🧾' : '📝'),
              el('span', { class: 'body' }, el('b', {}, `${dc.type === 'invoice' ? 'Invoice' : 'Estimate'} ${dc.number}`),
                el('span', { class: 'muted small' }, dc.type === 'invoice' && D.owed(dc) > 0 ? `${D.usd(D.owed(dc))} due${dc.dueDate ? ' by ' + D.fmtDate(dc.dueDate) : ''}` : D.usd(D.totals(dc).total))),
              el('span', { class: `pill ${D.pillClass(dc)}` }, dc.type === 'estimate' && dc.status === 'sent' ? 'Needs your OK' : D.label(dc)))))) : null,
          docs[j.id].length ? el('div', { class: 'stack', style: 'gap:6px' }, el('b', { class: 'small' }, 'Documents from Top Hat'),
            el('ul', { class: 'docs' }, ...docs[j.id].map((f) => el('li', {},
              el('a', { href: f.url, target: '_blank', rel: 'noopener' }, (find(FILE_KINDS, f.kind) || FILE_KINDS.at(-1)).icon + ' ', f.name,
                el('span', {}, (find(FILE_KINDS, f.kind) || FILE_KINDS.at(-1)).label)))))) : null,
        );
      }),
    ));
  }

  /* ---------- log in ---------- */
  async function login() {
    const next = new URLSearchParams(location.hash.split('?')[1] || '').get('next') || 'jobs';
    const errorBox = el('div', { class: 'error', hidden: true, role: 'alert' });
    const form = el('form', { class: 'card stack login-box', onsubmit: async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      try {
        const u = await api.auth.signIn(f.get('email'), f.get('password'));
        if (u.role === 'staff') { location.href = 'admin.html'; return; }
        if (u.role === 'crew') { location.href = 'crew.html'; return; }
        if (next === 'request') { draft.step = 2; saveDraft(); }
        go(next);
      } catch (err) { errorBox.textContent = err.message; errorBox.hidden = false; }
    } },
      el('h1', {}, 'Log in'),
      errorBox,
      el('label', { class: 'field' }, 'Email', el('input', { name: 'email', type: 'email', autocomplete: 'email', required: true })),
      el('label', { class: 'field' }, 'Password', el('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true })),
      el('button', { class: 'gold block', type: 'submit' }, 'Log in'),
      el('p', { class: 'muted small', style: 'text-align:center' }, 'New here? ', el('a', { href: '#/request' }, 'Request a job'), ' and create your account at the end.'),
    );
    view.append(form);
  }

  route();
})();
