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
  const MEASURE_HINTS = {
    roofing: 'e.g. Ranch house, about 1,800 sq ft. One story, roof is fairly flat.',
    flooring: 'e.g. Living room 14 x 18 ft, hallway 4 x 20 ft.',
    drywall: 'e.g. Hole about 2 x 3 ft in the bedroom wall. Ceilings are 8 ft.',
    painting: 'e.g. 3 bedrooms, each about 12 x 12 ft, 8 ft ceilings.',
    remodel: 'e.g. Bathroom is 5 x 8 ft. Kitchen is about 12 x 14 ft.',
    landscaping: 'e.g. Back yard about 40 x 60 ft.',
    other: 'e.g. Room is about 12 x 14 ft, ceilings 8 ft.',
  };

  // Month calendar for "When do you need it done?" Saves YYYY-MM-DD (or 'flexible').
  function calendarPicker(value, onChange) {
    const pad = (n) => String(n).padStart(2, '0');
    const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let selected = /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : '';
    let flexible = value === 'flexible';
    const start = selected ? new Date(selected + 'T12:00:00') : today;
    let shown = new Date(start.getFullYear(), start.getMonth(), 1);
    const minMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const wrap = el('div', { class: 'cal-wrap' });
    const render = () => {
      const y = shown.getFullYear(), m = shown.getMonth();
      const first = new Date(y, m, 1).getDay();
      const days = new Date(y, m + 1, 0).getDate();
      const cells = [];
      for (let i = 0; i < first; i++) cells.push(el('span', {}));
      for (let d = 1; d <= days; d++) {
        const date = new Date(y, m, d); const id = iso(date);
        cells.push(el('button', { type: 'button', class: 'cal-day' + (id === selected ? ' on' : '') + (date.getTime() === today.getTime() ? ' today' : ''),
          disabled: date < today, 'aria-label': date.toDateString(), 'aria-pressed': String(id === selected),
          onclick: () => { selected = id; flexible = false; onChange(id); render(); } }, String(d)));
      }
      wrap.replaceChildren(
        el('div', { class: 'cal' + (flexible ? ' dim' : '') },
          el('div', { class: 'cal-head' },
            el('button', { type: 'button', class: 'cal-nav', 'aria-label': 'Previous month', disabled: shown <= minMonth, onclick: () => { shown = new Date(y, m - 1, 1); render(); } }, '‹'),
            el('b', {}, shown.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })),
            el('button', { type: 'button', class: 'cal-nav', 'aria-label': 'Next month', onclick: () => { shown = new Date(y, m + 1, 1); render(); } }, '›')),
          el('div', { class: 'cal-grid cal-dow' }, ...['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((x) => el('span', {}, x))),
          el('div', { class: 'cal-grid' }, ...cells)),
        el('div', { class: 'cal-foot' },
          el('span', { class: 'cal-picked' }, flexible ? "You're flexible on the date" : selected ? 'Picked: ' + find(TIMEFRAMES, selected).label.replace(/^By /, '') : 'No date picked yet'),
          el('button', { type: 'button', class: 'chip' + (flexible ? ' on' : ''), 'aria-pressed': String(flexible),
            onclick: () => { flexible = !flexible; if (flexible) selected = ''; onChange(flexible ? 'flexible' : ''); render(); } }, "I'm flexible")));
    };
    render();
    return wrap;
  }

  const emptyDraft = () => ({ step: 1, trade: '', description: '', measurements: '', address: '', zip: '', state: '', room: '', style: '', dreamText: '', timeframe: '', budget: '', photos: [] });
  let draft = emptyDraft();
  let pendingPassword = ''; // new customer's password: kept in memory only, never saved
  try { draft = { ...draft, ...JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}') }; } catch (e) { /* ignore */ }
  function saveDraft() { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (e) { /* photos may not fit; fine */ } }
  function clearDraft() { draft = emptyDraft(); try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ } }

  /* ---------- routing ---------- */
  const routes = { '': home, request, done, jobs: myJobs, login, design, styles: styleGuide };
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
    // The 4 steps: a short line each, tap one for the full story.
    const STEPS = [
      ['📷', 'Upload your photo', 'Upload current pictures of the space or structure for your project.', ''],
      ['✨', 'Build my dream', 'Describe your dream. Pick the design, colors, and details.', ''],
      ['📅', 'Schedule', 'Schedule your project manager to come out.', ''],
      ['👤', 'Create account', 'Create an account that connects you to every aspect of your project.', ''],
    ];
    // Pick your project: a picture button for each kind of job. Each one starts the request already set to that job.
    // (Only jobs with a real photo from tophatcontracting.com, in img/site. Owner: no buttons without a real picture.)
    const PROJECTS = [
      ['Kitchens', 'img/site/kitchen.jpg', 'trade=remodel&room=kitchen'],
      ['Bathrooms', 'img/site/bathroom.jpg', 'trade=remodel&room=bathroom'],
      ['Interior remodeling', 'img/site/basement.jpg', 'trade=remodel&room=none&what=interior'],
      ['Garages', 'img/site/garage.jpg', 'trade=remodel&room=garage'],
      ['Decks', 'img/site/deck.jpg', 'trade=decks'],
      ['Patios', 'img/site/patio.jpg', 'trade=concrete&what=patio'],
      ['Concrete', 'img/site/concrete.jpg', 'trade=concrete'],
      ['Masonry', 'img/site/masonry.jpg', 'trade=masonry'],
    ];
    view.append(el('div', { class: 'stack' },
      el('section', { class: 'hero' },
        el('span', { class: 'hero-tag' }, 'Premier residential contracting'),
        el('img', { class: 'hero-logo', src: 'img/logo.jpg', alt: 'Top Hat Contracting Services' }),
        el('p', { class: 'slogan' }, 'You need it done… We make it happen.'),
        el('a', { class: 'btn gold block hero-cta', href: '#/request', onclick: () => { if (draft.step > 1 && (draft.photos.length || draft.dream)) { draft.step = 1; saveDraft(); } } }, // never wipe their photo or dream: pick up at the design studio
          el('h1', {}, 'Start your project the right way, right now.')),
      ),
      el('section', { class: 'project-picks' },
        el('h2', {}, 'What are we building together?'),
        el('div', { class: 'project-grid' }, ...PROJECTS.map(([label, img, q]) => el('a', { class: 'project-tile', href: '#/request?' + q, onclick: () => { draft.step = 1; saveDraft(); } },
          el('img', { src: img, alt: '', loading: 'lazy' }), el('span', {}, label))),
          el('a', { class: 'project-tile other', href: '#/request?trade=remodel&room=none', onclick: () => { draft.step = 1; saveDraft(); } }, el('span', { class: 'ic', 'aria-hidden': 'true' }, '📋'), el('span', {}, 'Something else'))),
      ),
      el('section', { class: 'four-steps' },
        el('h2', {}, 'It’s simple: ', el('span', { class: 'hl' }, '4 steps'), ' and you’re done'),
        el('ol', {}, ...STEPS.map(([ic, title, short, long], i) => { const head = (tag) => el(tag, { class: tag === 'div' ? 'step-row' : '' },
            el('span', { class: 'n' }, String(i + 1)),
            el('span', { class: 'ic', 'aria-hidden': 'true' }, ic),
            el('span', { class: 'txt' }, el('b', {}, title), el('span', {}, short)),
            long ? el('span', { class: 'more', 'aria-hidden': 'true' }) : null);
          // A step with more to say opens on tap; a step with just one line is shown as is.
          return el('li', {}, long ? el('details', {}, head('summary'), el('p', {}, long)) : head('div')); })),
      ),
    ));
  }

  /* ---------- request a job: one simple question per screen ---------- */
  const IDEA_CHIPS = {
    remodel: ['Kitchen remodel', 'Bathroom remodel', 'New cabinets', 'New countertops', 'Open up a wall'],
    plumbing: ['Leak', 'Clogged drain', 'New water heater', 'New faucet or sink', 'New toilet'],
    electrical: ['New lights', 'Outlets not working', 'Panel upgrade', 'Ceiling fan'],
    roofing: ['Roof leak', 'Missing shingles', 'New roof', 'Gutters'],
    hvac: ['AC not cooling', 'No heat', 'New furnace', 'New AC'],
    painting: ['Inside rooms', 'Outside of the house', 'Cabinets', 'Trim and doors'],
    drywall: ['Hole in the wall', 'Water damage', 'Ceiling repair', 'New walls'],
    flooring: ['Hardwood', 'Vinyl plank', 'Tile', 'Carpet out, new floor in'],
    landscaping: ['Patio', 'Yard cleanup', 'New plants', 'Fence'],
    other: ['Repair', 'Something new', 'Not sure yet'],
  };
  const BUDGET_TEXT = { '': 'Not sure yet' };

  async function request() {
    const me = await api.auth.me();
    if (me && me.role === 'staff') { view.append(el('div', { class: 'card', style: 'margin-top:24px' }, 'You are logged in as staff. ', el('a', { href: 'admin.html' }, 'Go to the staff area'), '.')); return; }
    // Room projects (kitchens, baths…) get a "pick a style" screen after they describe it.
    // Room projects (remodel, painting, flooring…) get the design screen: pick one of the 3 looks, add photos, and we design their room in it.
    // No "what type of work" page any more: the photo page is first. A link can still say ?trade=roofing; otherwise it's a remodel
    // (room bubbles + "Something else"), and the office can change the type on the job.
    const askTrade = new URLSearchParams(location.hash.split('?')[1] || '').get('trade');
    if (askTrade && find(TRADES, askTrade) && askTrade !== draft.trade) { draft.trade = askTrade; draft.tradeFromLink = true; draft.room = ''; draft.style = ''; saveDraft(); }
    if (!find(TRADES, draft.trade) || (!draft.tradeFromLink && draft.trade !== 'remodel')) { draft.trade = 'remodel'; saveDraft(); } // e.g. an old saved request
    const askQ = new URLSearchParams(location.hash.split('?')[1] || '');
    const askRoom = askQ.get('room');
    if (askRoom && (askRoom === 'none' || TH.STYLE_ROOMS.some((x) => x.id === askRoom)) && askRoom !== draft.room) { draft.room = askRoom; if (!(draft.style || '').startsWith(askRoom + '/')) draft.style = ''; saveDraft(); }
    if (askQ.has('trade')) { const w = askQ.get('what') || ''; if (w !== (draft.what || '')) { draft.what = w; saveDraft(); } }
    const roomTrade = TH.STYLE_TRADES.includes(draft.trade);
    // Owner: 3 steps for everyone (Design · Details · Date). Contact info, budget and the new account are on Details;
    // picking the date is the last thing, then "Send my request".
    // Owner's 3 steps: 1 Photos (+ describe it), 2 Design (studio + budget), 3 Schedule (meet your project manager, address, account).
    const SCREENS = ['photos', 'design', 'schedule'];
    const total = SCREENS.length;
    const at = (name) => SCREENS.indexOf(name) + 1;
    // A rough clock so they know how long is left: about how many seconds each step takes.
    const STEP_NAMES = { photos: 'Photos', design: 'Design', schedule: me ? 'Schedule' : 'Create account' };
    const STEP_SECS = { trade: 10, design: 75, where: 25, when: 10, budget: 10, contact: 45 };
    const timeLeft = () => { const secs = SCREENS.slice(step - 1).reduce((t, sc) => t + (STEP_SECS[sc] || 20), 0);
      return secs < 50 ? '⏱ Less than a minute left' : `⏱ About ${Math.round(secs / 60) || 1} minute${Math.round(secs / 60) > 1 ? 's' : ''} left`; };
    // Never skip ahead past something we still need.
    const missing = () => {
      if (!find(TRADES, draft.trade)) return 1;
      return total; // the last step (Schedule) checks the address, the day and their contact info
    };
    let step = Math.max(1, Math.min(Number(draft.step) || 1, total, missing()));
    const screen = SCREENS[step - 1];
    const goTo = (n) => { draft.step = n; saveDraft(); route(); };
    const next = () => goTo(step + 1);
    const errorBox = el('div', { class: 'error', hidden: true, role: 'alert' });
    const showError = (msg) => { errorBox.textContent = msg; errorBox.hidden = false; errorBox.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
    const trade = find(TRADES, draft.trade);

    // The same frame on every screen: back, progress, one big question, one big button.
    const shell = (title, sub, body, { nextLabel, onNext, extra } = {}) => el('div', { class: 'wiz' },
      el('div', { class: 'wiz-top' },
        step > 1 ? el('button', { type: 'button', class: 'wiz-back', onclick: () => goTo(step - 1) }, '← Back') : el('a', { class: 'wiz-back', href: '#/' }, '← Home'),
        el('span', { class: 'wiz-count' }, `${step} of ${total}`)),
      el('div', { class: 'steps' }, ...SCREENS.map((_, i) => el('span', { class: i < step ? 'on' : '' }))),
      el('div', { class: 'step-names', 'aria-hidden': 'true' }, ...SCREENS.map((sc, i) => el('span', { class: i + 1 === step ? 'now' : i + 1 < step ? 'done' : '' }, (STEP_NAMES[sc] || sc)))),
      title ? el('h1', { class: 'wiz-q' }, title) : null,
      sub ? el('p', { class: 'wiz-sub' }, sub) : null,
      errorBox,
      ...body,
      onNext ? el('div', { class: 'wiz-next' }, el('button', { type: 'button', class: 'gold block big', onclick: onNext }, nextLabel || 'Next')) : null,
      extra || null,
    );

    // Design (every request): 1) the BEFORE photo, 2) the dream (room projects pick one of the three looks; everything else describes it),
    // then ✨ the AFTER picture: their own photo, finished. Both are saved to the job when they send the request.
    if (screen === 'photos' || screen === 'design') {
      let autoBuild = false; // set when they add the photo from the ✨ Build box: build the dream as soon as it's in
      const isRoom = roomTrade;
      // No "Which room is it?" (owner): the room comes from the home-page button they tapped, or from what they wrote in step 1.
      // If we still don't know, every room's looks are shown and the look they pick sets the room.
      if (isRoom && (!draft.room || draft.room === 'none')) { const g = TH.roomFromText(draft.description); if (g) { draft.room = g; saveDraft(); } }
      let room = isRoom ? TH.STYLE_ROOMS.find((r) => r.id === draft.room) || null : null;
      let allLooks = !room;
      const thing = () => (room ? room.label.toLowerCase() : draft.what ? draft.what : isRoom && draft.room === 'none' ? 'project' : TH.dreamNoun(draft.trade));
      const grid = el('div', { class: 'photos' });
      const btnWrap = el('div', { class: 'wiz-next stay' }); // stays at the end of the page, doesn't float
      const rooms = el('div', { class: 'stage-chips room-chips', role: 'radiogroup', 'aria-label': 'Which room' });
      const looks = el('div', { class: 'look-list', role: 'radiogroup', 'aria-label': 'Pick a look' });
      const lookHead = el('h2', { class: 'wiz-part' }, el('span', { class: 'n' }, '1'), 'Pick the look you want');
      // What their dream is right now: a look (rooms) or their own words (everything else). The AFTER picture matches one of these.
      // Never empty: with nothing picked the studio still makes a finished, updated version of their photo.
      const words = () => (draft.dreamText || '').trim();
      const dreamKey = () => [room && draft.style ? draft.style : '', words().length >= 3 ? 'text:' + words() : ''].filter(Boolean).join('|') || 'auto';
      const drawRooms = () => rooms.replaceChildren(...TH.STYLE_ROOMS.map((r) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(draft.room === r.id), class: 'chip' + (draft.room === r.id ? ' on' : ''),
        onclick: () => pickRoom(r) }, `${r.icon} ${r.label}`)),
        el('button', { type: 'button', role: 'radio', 'aria-checked': String(draft.room === 'none'), class: 'chip' + (draft.room === 'none' ? ' on' : ''),
          onclick: () => pickRoom(null) }, '📋 Something else'));
      const pickRoom = (r) => {
        draft.room = r ? r.id : 'none'; room = r;
        if (!r || !(draft.style || '').startsWith(r.id + '/')) draft.style = '';
        saveDraft(); drawRooms(); drawLooks(); drawDream(); drawBtn();
        if (r) setTimeout(() => lookHead.scrollIntoView({ block: 'start', behavior: 'smooth' }), 30);
        else setTimeout(() => dreamText.focus(), 30);
      };
      const drawLooks = () => {
        const lookBtn = (rm, st, label) => { const key = `${rm.id}/${st.id}`; const on = draft.style === key;
          return el('button', { type: 'button', role: 'radio', 'aria-checked': String(on), class: 'look' + (on ? ' on' : ''), onclick: () => {
            draft.style = on ? '' : key; if (!on) { draft.room = rm.id; room = rm; } saveDraft(); drawLooks(); drawBtn(); drawDream(); } },
            el('img', { src: `img/styles/${rm.id}-${st.id}.svg`, alt: '' }),
            el('span', { class: 'look-txt' }, el('b', {}, label), el('span', {}, st.desc)),
            el('span', { class: 'look-check', 'aria-hidden': 'true' }, on ? '✓' : '')); };
        const list = allLooks || !room
          ? TH.STYLE_ROOMS.flatMap((rm) => rm.styles.map((st) => lookBtn(rm, st, `${rm.label}: ${st.name}`)))
          : room.styles.map((st, i) => lookBtn(room, st, `${i + 1}. ${st.name}`));
        looks.replaceChildren(...list,
          room && !allLooks ? el('button', { type: 'button', class: 'link', onclick: () => { allLooks = true; drawLooks(); } }, 'Show looks for other rooms') : null);
      };
      // Step 2: "Describe your project" is for the Top Hat team only (job description). It does NOT go to the design studio.
      const projectText = el('textarea', { rows: 3, maxlength: '1000', value: draft.description || '', 'aria-label': 'Describe your project',
        placeholder: 'e.g. What needs fixing, and what you want done',
        oninput: () => { draft.description = projectText.value; saveDraft(); } });
      // Step 3: its own box, linked to the design studio: what the AI after picture should look like.
      const dreamText = el('textarea', { rows: 2, maxlength: '200', value: draft.dreamText || '', 'aria-label': 'Describe your design',
        placeholder: draft.trade === 'roofing' ? 'e.g. New roof, charcoal architectural shingles, white gutters' : draft.trade === 'decks' ? 'e.g. Gray composite deck with black railings' : 'e.g. Screened-in porch, white cabinets, darker floors',
        oninput: () => { draft.dreamText = dreamText.value; saveDraft(); drawDream(); drawBtn(); } });
      const ideaList = [...(isRoom ? [] : IDEA_CHIPS[draft.trade] || []), ...((TH.DESIGN_IDEAS || {})[draft.trade] || (TH.DESIGN_IDEAS || {}).other || [])].filter((x, i, a) => a.indexOf(x) === i);
      const dreamIdeas = el('div', { class: 'stage-chips' }, ...ideaList.map((t) => el('button', { type: 'button', class: 'chip',
        onclick: () => { dreamText.value = dreamText.value.trim() ? `${dreamText.value.trim()}, ${t.toLowerCase()}` : t; draft.dreamText = dreamText.value; saveDraft(); drawDream(); drawBtn(); } }, `+ ${t}`)));
      const describeWrap = el('div', { class: 'stack', style: 'gap:8px' },
        el('label', { class: 'box-label' }, 'Describe your project (optional)', projectText));
      const designWrap = el('label', { class: 'box-label' }, 'Describe your design (optional)', dreamText);
      // Measurements (optional). The "Anything else" notes box was removed at the owner's request.
      const measure = el('input', { value: draft.measurements || '', placeholder: 'e.g. Kitchen is about 12 x 14 ft', 'aria-label': 'Measurements', oninput: () => { draft.measurements = measure.value; saveDraft(); } });
      const measureWrap = el('div', { hidden: !draft.measurements }, measure);
      const extrasWrap = el('div', { class: 'stack', style: 'gap:8px' },
        draft.measurements ? null : el('button', { type: 'button', class: 'link', onclick: (e) => { measureWrap.hidden = false; e.currentTarget.remove(); measure.focus(); } }, '+ Add measurements (optional)'),
        measureWrap);
      // ✨ The AFTER: their own photo, finished, right here before they send anything.
      const dreamBox = el('div', { class: 'dream-box' });
      const studioHead = el('h2', { class: 'wiz-part' }, el('span', { class: 'n' }, isRoom ? '2' : '1'), '✨ Build my dream');
      // Budget: on the Design step, under the studio.
      const budgetChips = el('div', { class: 'stage-chips budget-chips', role: 'radiogroup', 'aria-label': 'Budget' });
      const drawBudget = () => budgetChips.replaceChildren(...BUDGETS.filter((bg) => !bg.old).map((bg) => { const on = draft.budgetSet && draft.budget === bg.id;
        return el('button', { type: 'button', role: 'radio', 'aria-checked': String(on), class: 'chip' + (on ? ' on' : ''),
          onclick: () => { draft.budget = bg.id; draft.budgetSet = true; saveDraft(); drawBudget(); } }, BUDGET_TEXT[bg.id] || bg.label); }));
      drawBudget();
      // Owner's rule: up to 3 pictures during sign-up. More can be made in the app's Design studio after they sign up.
      // Only for new customers signing up: logged-in customers have no limit here.
      const MAX_SIGNUP_DREAMS = me ? Infinity : 3;
      const made = () => Number(draft.dreamCount) || 0;
      const limitNote = () => el('p', { class: 'dream-limit' }, `You’ve made ${MAX_SIGNUP_DREAMS} designs, the most for sign-up. This one is saved with your request, and you can make more in the Design studio once you’re signed up.`);
      const drawDream = () => {
        const key = dreamKey();
        const look = room && TH.styleOf(draft.style);
        const d = draft.dream && draft.dream.image ? draft.dream : null; // the last picture stays until they make a new one
        if (!draft.photos.length) {
          dreamBox.replaceChildren(el('label', { class: 'btn dream-btn block big dream-pick' }, `✨ Build my dream ${thing()}`,
            el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: (e) => { autoBuild = true; addPhotos(e); } })),
            el('p', { class: 'muted small' }, 'Tap to add your before photo. We’ll build your dream from it right away.'));
          return;
        }
        const err = el('div', { class: 'error', hidden: true, role: 'alert' });
        const what = () => (look ? `the ${look.style.name} look` : words().length >= 3 ? 'your words' : '');
        const make = async (btn, extra = '') => {
          if (made() >= MAX_SIGNUP_DREAMS) { drawDream(); return; }
          btn.disabled = true; err.hidden = true;
          dreamBox.classList.add('making');
          const label = btn.textContent; btn.textContent = `Making your dream ${thing()}… (10 to 30 seconds)`;
          try {
            const text = [words(), extra].filter((x) => x && x.trim()).join('. ');
            const asked = look ? text : (text.length >= 3 ? text : 'finished, updated and looking its best, done right by a pro');
            const image = await api.designs.dream(draft.photos.slice(0, MAX_PHOTOS), look ? draft.style : '', asked, { trade: draft.trade }); // all their photos: the whole room
            draft.dreamCount = made() + 1;
            draft.dream = { key, style: look ? draft.style : '', image, photo: draft.photos[0], prompt: look ? TH.dreamRequest(look, text) : TH.dreamRequestText(trade ? trade.label : '', asked) };
            saveDraft(); drawDream(); drawBtn();
            dreamBox.scrollIntoView({ block: 'start', behavior: 'smooth' });
          } catch (e) { err.textContent = e.message; err.hidden = false; btn.disabled = false; btn.textContent = label; }
          finally { dreamBox.classList.remove('making'); }
        };
        if (!d && made() >= MAX_SIGNUP_DREAMS) { dreamBox.replaceChildren(limitNote()); return; }
        if (!d) {
          const btn = el('button', { type: 'button', class: 'dream-btn block big', onclick: () => make(btn) }, `✨ Build my dream ${thing()}`);
          if (autoBuild) { autoBuild = false; setTimeout(() => make(btn), 0); }
          dreamBox.replaceChildren(el('div', { class: 'dream-wait' }, el('img', { src: draft.photos[0], alt: 'Your photo' }), el('span', { class: 'spinner', 'aria-hidden': 'true' })), btn,
            el('p', { class: 'muted small' }, what() ? `We’ll use ${what()}.` : (isRoom ? 'Pick a look above, or describe your design, to make it yours. Or just tap.' : 'Describe your design above to make it yours, or just tap.')), err);
          return;
        }
        const extra = el('input', { placeholder: 'Change something? e.g. darker colors', 'aria-label': 'Change something', maxlength: '200' });
        const changed = d.key !== key;
        const again = el('button', { type: 'button', class: changed ? 'dream-btn block' : 'ghost block', onclick: () => make(again, extra.value) },
          changed && what() ? `✨ Make a new one: ${what().replace(/^the /, '')}` : '🔁 Make it again');
        // Owner's order: links, tip, note and "Make it again" ABOVE the dream picture.
        dreamBox.replaceChildren(
          el('h3', {}, `✨ Your dream ${thing()}${TH.styleOf(d.style) ? ' · ' + TH.styleOf(d.style).style.name : ''}`),
          TH.beforeAfter([{ url: d.photo || draft.photos[0], name: 'Your photo', stage: 'before', group: 'g' }, { url: d.image, name: 'Your dream', stage: 'after', group: 'g' }], { title: 'Before & after: slide to compare', infoFirst: true,
            above: made() >= MAX_SIGNUP_DREAMS ? [limitNote()]
              : [el('div', { class: 'dream-again' }, extra, again), el('p', { class: 'muted small' }, (me ? `Design ${made()}` : `Design ${made()} of ${MAX_SIGNUP_DREAMS}`)), err] }));
      };
      const drawBtn = () => {
        const loved = !!(draft.dream && draft.dream.image) && screen === 'design';
        btnWrap.replaceChildren(draft.photos.length || loved || (screen === 'design')
          ? el('button', { type: 'button', class: 'gold block big', onclick: next }, loved ? '❤️ Love it: next' : 'Next')
          : el('button', { type: 'button', class: 'ghost block', onclick: next }, 'Skip for now'));
      };
      const draw = () => {
        grid.replaceChildren(...draft.photos.map((src, i) => el('div', { class: 'photo' },
          el('img', { src, alt: `Photo ${i + 1}` }),
          el('button', { type: 'button', 'aria-label': `Remove photo ${i + 1}`, onclick: () => { draft.photos.splice(i, 1); saveDraft(); draw(); } }, '✕'))));
        addBtn.hidden = draft.photos.length >= MAX_PHOTOS;
        drawBtn(); drawDream();
      };
      const addPhotos = async (e) => {
        const files = [...e.target.files].slice(0, MAX_PHOTOS - draft.photos.length);
        for (const f of files) { try { draft.photos.push(await shrinkImage(f)); } catch (err) { autoBuild = false; showError(err.message); } }
        if (!draft.photos.length) autoBuild = false;
        e.target.value = ''; saveDraft(); draw();
      };
      const addBtn = el('label', { class: 'btn gold block big photo-btn' }, '📷 Add photos',
        el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: addPhotos }));
      view.append(shell('', '', screen === 'photos' ? [
        // Step 1, Photos: their before photos and a written description of the project.
        el('h2', { class: 'wiz-part' }, el('span', { class: 'n' }, '1'), 'Add your photos'),
        el('p', { class: 'wiz-sub' }, 'Up to 5 photos. Stand back as far as you can and take a picture of the whole project.'),
        addBtn, grid,
        el('h2', { class: 'wiz-part' }, el('span', { class: 'n' }, '2'), 'Tell us about it'),
        describeWrap,
        extrasWrap,
      ] : [
        // Step 2, Design: which room and look, then the design studio builds the dream (AFTER) from their photos, then the budget.
        // The design studio here is a core screen: never remove it (see CLAUDE.md).
        ...(isRoom ? [lookHead, looks] : []),
        studioHead, designWrap, dreamBox,
        el('h2', { class: 'wiz-part' }, el('span', { class: 'n' }, isRoom ? '3' : '2'), 'Which level of finish closely meets your expectations?'),
        budgetChips,
      ]));
      view.querySelector('.wiz').append(btnWrap);
      if (isRoom) drawLooks();
      draw();
      return;
    }

    // Step 3, Schedule: the day to meet their project manager, the project address, and their account (or contact info).
    if (screen === 'schedule') {
      const cal = calendarPicker(draft.timeframe, (v) => { draft.timeframe = v; saveDraft(); });
      const addr = el('input', { value: draft.address || '', placeholder: 'Street address, city', autocomplete: 'street-address', 'aria-label': 'Street address and city' });
      // State: picked for them from the ZIP code (they can change it).
      const stateSel = el('select', { 'aria-label': 'State', autocomplete: 'address-level1', onchange: () => { stateSel.dataset.picked = '1'; } },
        el('option', { value: '' }, 'State'), ...TH.US_STATES.map(([c, n]) => el('option', { value: c, selected: c === draft.state }, n)));
      const zip = el('input', { value: draft.zip || '', placeholder: 'ZIP', inputmode: 'numeric', maxlength: '5', autocomplete: 'postal-code', 'aria-label': 'ZIP code',
        oninput: () => { const g = TH.stateFromZip(zip.value); if (g && !stateSel.dataset.picked) stateSel.value = g; } });
      // Their account: name, number, email (filled in from their account when they're logged in).
      const f = {
        name: me ? null : el('input', { value: draft.name || '', autocomplete: 'name', placeholder: 'Full name', 'aria-label': 'Full name' }),
        phone: el('input', { type: 'tel', value: draft.phone || (me && me.phone) || '', autocomplete: 'tel', inputmode: 'tel', placeholder: 'Mobile phone', 'aria-label': 'Mobile phone' }),
        email: el('input', { type: 'email', value: draft.email || (me && me.email) || '', autocomplete: 'email', inputmode: 'email', placeholder: 'Email', 'aria-label': 'Email' }),
        // The password is never saved in the draft; it stays in memory until they send the request.
        password: me ? null : el('input', { type: 'password', value: pendingPassword, autocomplete: 'new-password', placeholder: 'Create a password (8+ characters)', 'aria-label': 'Create a password' }),
      };
      const keep = () => {
        draft.address = addr.value.trim(); draft.zip = zip.value.trim(); draft.state = stateSel.value;
        draft.phone = f.phone.value.trim(); draft.email = f.email.value.trim(); if (f.name) draft.name = f.name.value.trim();
        if (f.password) pendingPassword = f.password.value;
        saveDraft();
      };
      for (const x of [addr, zip, f.name, f.phone, f.email, f.password]) if (x) x.addEventListener('input', keep);
      stateSel.addEventListener('change', keep);
      const send = async (e) => {
        keep();
        if (!draft.timeframe) return showError('Pick a day to meet your project manager, or “I’m flexible”.');
        if (!draft.address) return showError('Enter the street address and city.');
        if (!/^\d{5}$/.test(draft.zip)) return showError('Enter the 5-digit ZIP code.');
        if (!draft.state) return showError('Pick the state the project is in.');
        if (f.name && !draft.name) return showError('Enter your full name.');
        if (draft.phone.replace(/\D/g, '').length < 10) return showError('Enter your mobile phone number.');
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(draft.email)) return showError('Enter your email address.');
        if (f.password && pendingPassword.length < 8) return showError('Create a password with at least 8 characters.');
        const btn = e.currentTarget; btn.disabled = true;
        try {
          if (!me) {
            await api.auth.signUp({ name: draft.name, phone: draft.phone, email: draft.email, password: pendingPassword });
            pendingPassword = '';
          }
          await submitJob(showError);
        } catch (err) { showError(err.message); }
        finally { btn.disabled = false; }
      };
      view.append(shell(me ? 'Schedule' : 'Create account', null, [
        el('h2', { class: 'wiz-part' }, el('span', { class: 'n' }, '1'), 'Meet your project manager'),
        el('p', { class: 'wiz-sub' }, 'Pick a day for your project manager to come out. After the visit, we schedule your contractor.'),
        cal,
        el('h2', { class: 'wiz-part' }, el('span', { class: 'n' }, '2'), 'Where is the project?'), addr, el('div', { class: 'two zip-state' }, zip, stateSel),
        el('h2', { class: 'wiz-part' }, el('span', { class: 'n' }, '3'), me ? 'How do we reach you?' : 'Create your account'), f.name, f.phone, f.email, f.password,
      ], { nextLabel: 'Send my request', onNext: send,
        extra: me ? null : el('p', { class: 'muted small', style: 'text-align:center;margin-top:12px' }, 'Already have an account? ', el('a', { href: '#/login?next=request' }, 'Log in'), ' and your request will be waiting.') }));
      return;
    }
  }

  async function submitJob(showError) {
    try {
      const m = (draft.measurements || '').trim();
      // The job description, from the design step: the look they picked or what they want done, their notes, and measurements.
      const look = TH.styleOf(draft.style); const tr = find(TRADES, draft.trade);
      const what = [look ? `${look.room.label} remodel, ${look.style.name} look (${look.style.desc.toLowerCase()})` : '', (draft.dreamText || '').trim(), (draft.description || '').trim()].filter(Boolean).join('. ');
      // Logged-in customers can give a different phone or email on Details: the office sees it on the job.
      const acct = await api.auth.me().catch(() => null);
      const reach = acct && ((draft.phone && draft.phone !== acct.phone) || (draft.email && draft.email !== acct.email)) ? `Reach me at: ${[draft.phone, draft.email].filter(Boolean).join(' · ')}` : '';
      const description = [what.length >= 10 ? what : `${tr ? tr.label : 'Home'} project${what ? ': ' + what : ''}`, m ? `Measurements: ${m}` : '', reach].filter(Boolean).join('\n\n');
      const job = await api.jobs.create({ ...draft, description });
      // Their room in the look they picked: made on the next screen.
      try { sessionStorage.removeItem('tophat.makeDesign'); sessionStorage.removeItem('tophat.dreamSaved'); } catch (e) {}
      if (job && job.id && draft.dream && draft.dream.image && (draft.dream.photo || draft.photos[0])) {
        // Their before and after go on the job (and into Photos & papers), so everyone sees the same thing when we call.
        try {
          const v = await api.designs.adopt(job.id, draft.dream.photo || draft.photos[0], draft.dream.image, draft.dream.prompt);
          if (v && v.id) await api.designs.save(job.id, v.id, TH.styleOf(draft.dream.style)?.label || 'Dream design').catch(() => {});
          sessionStorage.setItem('tophat.dreamSaved', JSON.stringify({ jobId: job.id, style: draft.dream.style, image: draft.dream.image, photo: draft.dream.photo || draft.photos[0], what: TH.styleOf(draft.dream.style)?.room.label.toLowerCase() || TH.dreamNoun(draft.trade) }));
        } catch (e) { console.warn('Saving the dream picture failed:', e); }
      } else {
        try { if (job && job.id && draft.photos.length && (TH.styleOf(draft.style) || (draft.dreamText || '').trim().length >= 3)) sessionStorage.setItem('tophat.makeDesign', JSON.stringify({ jobId: job.id, style: draft.style, text: (draft.dreamText || '').trim(), trade: draft.trade, photo: draft.photos[0] })); } catch (e) {}
      }
      clearDraft();
      go('done');
    } catch (err) { showError(err.message); }
  }

  /* ---------- confirmation ---------- */
  async function done() {
    const me = await api.auth.me();
    view.append(el('div', { class: 'card stack', style: 'margin-top:28px;text-align:center' },
      el('div', { class: 'done-mark' }, '✓'),
      el('h1', {}, "You're all set!"),
      el('p', { class: 'muted' }, `Thanks${me ? ', ' + me.name.split(' ')[0] : ''}. The Top Hat team will look over your measurements and photos and call you ${me?.phone ? 'at ' + me.phone : 'soon'} with an estimate over the phone. If the price works for you, we'll book a time for your Top Hat project manager to come out. You'll see every step under My jobs.`),
      makeDesignCard(),
      el('a', { class: 'btn block', href: '#/jobs' }, 'See my jobs'),
      el('a', { class: 'btn ghost block', href: '#/request' }, 'Start another project'),
    ));
  }

  // Right after they send it: their photo, redesigned in the look they picked.
  // The done screen can be drawn more than once; keep the same card so the picture is made (and shown) once.
  let designCardCache = null;
  function makeDesignCard() {
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem('tophat.dreamSaved') || 'null'); sessionStorage.removeItem('tophat.dreamSaved'); } catch (e) {}
    if (!saved && designCardCache && Date.now() - designCardCache.at < 600000) return designCardCache.card;
    const keep = (card) => { if (card) designCardCache = { card, at: Date.now() }; return card; };
    return keep(buildDesignCard(saved));
  }
  function buildDesignCard(saved) {
    if (saved && saved.image) return el('section', { class: 'make-design stack' },
      el('h2', {}, `🌟 Your dream ${saved.what || 'project'} is saved`),
      saved.photo ? TH.beforeAfter([{ url: saved.photo, name: 'Before', stage: 'before', group: 'g' }, { url: saved.image, name: 'After', stage: 'after', group: 'g' }], { title: 'Before & after' }) : el('img', { class: 'made', src: saved.image, alt: '' }),
      el('p', { class: 'muted small' }, 'When we call, we’ll be looking at this same picture.'),
      el('a', { class: 'btn ghost block', href: `#/design?job=${saved.jobId}` }, '🎨 Change it in the Design studio'));
    let job = null;
    try { job = JSON.parse(sessionStorage.getItem('tophat.makeDesign') || 'null'); sessionStorage.removeItem('tophat.makeDesign'); } catch (e) {}
    if (!job) return null;
    const look = TH.styleOf(job.style);
    const tradeLabel = (find(TRADES, job.trade) || {}).label || 'project';
    if (!look && !job.text) return null;
    const what = look ? look.room.label.toLowerCase() : TH.dreamNoun(job.trade);
    const card = el('section', { class: 'make-design stack' });
    const studio = el('a', { class: 'btn ghost block', href: `#/design?job=${job.jobId}` }, '🎨 Change it in the Design studio');
    card.replaceChildren(el('h2', {}, `🎨 Making your dream ${what}${look ? ' in the ' + look.style.name + ' look' : ''}…`),
      el('div', { class: 'make-wait' }, el('img', { src: job.photo, alt: 'Your photo' }), el('span', { class: 'spinner', 'aria-hidden': 'true' })),
      el('p', { class: 'muted small' }, 'This takes about 10 to 30 seconds.'));
    (async () => {
      try {
        const photo = await api.designs.addPhoto(job.jobId, job.photo);
        const v = await api.designs.generate(job.jobId, photo.id, look
          ? `Redesign this ${look.room.label.toLowerCase()} in the ${look.style.name} style: ${look.style.desc}. Keep the same room, walls, windows and camera angle.`
          : TH.dreamRequestText(tradeLabel, job.text));
        await api.designs.choose(job.jobId, v.id).catch(() => {});
        await api.designs.save(job.jobId, v.id, look ? look.label : 'Dream design').catch(() => {});
        const url = (await api.designs.list(job.jobId)).find((x) => x.id === v.id)?.url;
        card.replaceChildren(el('h2', {}, `🌟 Your dream ${what}`),
          url ? TH.beforeAfter([{ url: job.photo, name: 'Before', stage: 'before', group: 'g' }, { url, name: 'After', stage: 'after', group: 'g' }], { title: 'Before & after' }) : null,
          el('p', { class: 'muted small' }, 'Saved to your job. Your project manager will see it too.'), studio);
      } catch (e) {
        // AI not turned on (or busy): show what they picked; the office still sees it on the job.
        card.replaceChildren(el('h2', {}, look ? `🎨 You picked: ${look.label}` : '🎨 Your dream is saved'), look ? el('img', { class: 'made', src: look.img, alt: '' }) : el('p', {}, `“${job.text}”`),
          el('p', { class: 'muted small' }, 'Your design picture will show up in the Design studio on your job once it’s ready. Your project manager already sees what you asked for.'), studio);
      }
    })();
    return card;
  }

  /* ---------- my jobs ---------- */
  const TRACK = ['new', 'qualifying', 'hot', 'scheduled', 'completed'];
  const TRACK_LABELS = ['Received', 'Estimate call', 'Site visit', 'Scheduled', 'Done'];
  async function myJobs() {
    const me = await api.auth.me();
    if (!me) return go('login?next=jobs');
    const jobs = await api.jobs.mine();
    const docs = Object.fromEntries(await Promise.all(jobs.map(async (j) => [j.id, j.sharedFiles ? await api.files.forCustomer(j.id) : []])));
    const [paper, company] = await Promise.all([api.docs.mine(), api.settings.get()]);
    const D = TH.docs;
    // Pay an invoice: how to pay, then "Pay now": amount, how, and the customer signs to authorize it.
    const pendingSum = (dc) => (dc.reports || []).filter((r) => r.status === 'pending').reduce((t, r) => t + Number(r.amount || 0), 0);
    const payArea = (j, dc, open) => {
      const owed = D.owed(dc);
      const area = el('div', { class: 'pay-area stack' });
      const cardLink = dc.payLink || company.cardPayLink;
      const pending = (dc.reports || []).filter((r) => r.status === 'pending');
      const showOptions = () => {
        const amount = el('input', { type: 'number', inputmode: 'decimal', min: '0.01', step: '0.01', value: owed, 'aria-label': 'Amount you paid' });
        const method = el('select', { 'aria-label': 'How you paid' }, ...(TH.PAY_METHODS || ['Zelle', 'Check', 'Cash', 'Card', 'Other']).map((m) => el('option', {}, m)));
        const note = el('input', { placeholder: 'Note (optional), e.g. Zelle confirmation #', 'aria-label': 'Note' });
        const err = el('div', { class: 'error', hidden: true, role: 'alert' });
        const pad = D.signaturePad({ name: me?.name || '', title: 'Sign to pay',
          agree: `By signing, you authorize this payment for invoice ${dc.number} and agree to its payment terms.`,
          submitLabel: 'Pay now',
          onSign: async (sig) => {
            await api.docs.reportPayment(dc.id, { amount: amount.value, method: method.value, note: note.value, signature: sig });
            area.replaceChildren(el('div', { class: 'callout good' }, el('b', {}, '✓ Thank you! '), `Your ${D.usd(Number(amount.value))} payment by ${method.value} is signed and on its way to Top Hat. We’ll confirm it as soon as it arrives.`));
            route(); // the job card behind the invoice drops its Pay now button right away
          } });
        const sent = el('div', { class: 'stack', hidden: true },
          el('div', { class: 'two' }, el('label', { class: 'field' }, 'Amount ($)', amount), el('label', { class: 'field' }, 'How you’re paying', method)), note, err, pad);
        area.replaceChildren(...[
          el('h3', {}, `Pay ${D.usd(owed)}`),
          cardLink ? el('a', { class: 'btn gold block big', href: cardLink, target: '_blank', rel: 'noopener' }, '💳 Pay by card') : null,
          company.paymentInstructions ? el('div', { class: 'pay-how' }, el('b', {}, cardLink ? 'Or pay by Zelle or bank transfer' : 'How to pay'),
            ...String(company.paymentInstructions).split('\n').filter((x) => x.trim()).map((x) => el('div', {}, x))) : null,
          el('button', { type: 'button', class: 'gold block big', onclick: (e) => { sent.hidden = false; e.currentTarget.remove(); setTimeout(() => sent.scrollIntoView({ block: 'start' }), 30); } }, `Pay now · ${D.usd(owed)}`),
          sent,
        ].filter(Boolean));
      };
      area.replaceChildren(...[
        pending.length ? el('div', { class: 'callout' }, `⏳ You paid ${pending.map((r) => `${D.usd(r.amount)} by ${r.method}`).join(', ')}. We’ll confirm it when it arrives.`) : null,
        pendingSum(dc) >= owed ? null : el('button', { type: 'button', class: 'gold block big', onclick: showOptions }, `💳 Pay now · ${D.usd(owed - pendingSum(dc))}`),
      ].filter(Boolean));
      if (open && pendingSum(dc) < owed) showOptions();
      return area;
    };
    const openPaper = (j, dc, opts = {}) => {
      const acts = [];
      if (dc.type === 'estimate' && dc.status === 'sent') {
        acts.push((close) => {
          const area = el('div', { class: 'stack' });
          const pad = () => area.replaceChildren(D.signaturePad({ total: D.totals(dc).total, name: me?.name || '', onCancel: () => area.replaceChildren(btn),
            onSign: async (sig) => { await api.docs.respond(dc.id, true, sig); close(); route(); } })) || setTimeout(() => area.scrollIntoView({ block: 'center' }), 30);
          const btn = el('button', { class: 'gold block big', onclick: pad }, `✍️ Sign & approve (${D.usd(D.totals(dc).total)})`);
          area.append(btn);
          if (opts.sign) setTimeout(pad, 0);
          return area;
        });
        acts.push((close) => el('button', { class: 'ghost block', onclick: async (e) => {
          if (!confirm('Decline this estimate? You can still call us with questions.')) return;
          e.currentTarget.disabled = true;
          try { await api.docs.respond(dc.id, false); close(); route(); } catch (err) { alert(err.message); e.currentTarget.disabled = false; }
        } }, 'Decline'));
      }
      if (dc.type === 'invoice' && D.owed(dc) > 0) acts.push(payArea(j, dc, opts.pay));
      // Not signed yet (an invoice, or an estimate approved by phone): sign it right here.
      if (needsSig(dc)) acts.push((close) => {
        const area = el('div', { class: 'stack' });
        const pad = () => { area.replaceChildren(D.signaturePad({ name: me?.name || '', title: dc.type === 'invoice' ? 'Sign this invoice' : 'Sign your estimate',
          agree: dc.type === 'invoice' ? `By signing, you confirm invoice ${dc.number}${D.owed(dc) > 0 ? ' and agree to its payment terms' : ' and the payments on it'}.` : `By signing, you approve estimate ${dc.number} and its payment schedule.`,
          submitLabel: 'Sign', onCancel: () => area.replaceChildren(btn),
          onSign: async (sig) => { await api.docs.sign(dc.id, sig); close(); route(); } })); setTimeout(() => area.scrollIntoView({ block: 'center' }), 30); };
        const btn = el('button', { class: (D.owed(dc) > 0 ? 'ghost' : 'gold') + ' block', onclick: pad }, D.owed(dc) > 0 ? '✍️ Paying another way? Just sign it' : `✍️ Sign ${dc.number}`);
        area.append(btn);
        if (opts.sign) setTimeout(pad, 0);
        return area;
      });
      D.view(dc, { job: j, customer: me, company }, acts);
      if (opts.pay || opts.sign) setTimeout(() => document.querySelector('.doc-actions')?.scrollIntoView({ block: 'start' }), 60);
    };
    view.append(el('div', { class: 'stack', style: 'margin-top:24px' },
      el('div', { class: 'row' }, el('h1', {}, 'My jobs'), el('span', { class: 'spacer' }), el('a', { class: 'btn gold small', href: '#/request' }, '+ New request')),
      contactCard(jobs, company),
      jobs.length ? null : el('div', { class: 'card muted' }, "You haven't requested any jobs yet."),
      ...jobs.map((j) => {
        const trade = find(TRADES, j.trade) || TRADES.at(-1);
        const st = find(STATUSES, j.status);
        const reached = j.status === 'in_progress' ? 3 : TRACK.indexOf(j.status);
        return el('article', { class: 'card job-card' },
          el('div', { class: 'head' },
            el('span', { style: 'font-size:1.6rem' }, trade.icon),
            el('div', { class: 't' }, el('h3', {}, trade.label), el('p', { class: 'muted small' }, `Job TH-${j.number} · ${j.address}${j.state ? ", " + j.state : ""} · requested ${ago(j.created)}`)),
            el('span', { class: `pill s-${j.status}` }, st.buyer)),
          el('p', { class: 'small' }, j.description),
          TH.styleOf(j.style) ? el('div', { class: 'style-chosen' }, el('img', { src: TH.styleOf(j.style).img, alt: '' }),
            el('span', {}, el('span', { class: 'muted small' }, 'The look you picked'), el('b', {}, TH.styleOf(j.style).label))) : null,
          j.status === 'lost' ? el('p', { class: 'muted small' }, 'This request was closed. Questions? Just request a new job and mention it.')
            : el('div', { class: 'track', 'aria-label': `Progress: ${st.buyer}` }, ...TRACK_LABELS.map((l, i) => el('div', { class: i <= reached ? 'on' : '' }, l))),
          j.status === 'hot' ? el('div', { class: 'callout' }, '🤝 ', j.visitAt
            ? [el('b', {}, fmtWhen(j.visitAt)), ` · ${j.repName || 'Your Top Hat project manager'} is coming out to measure and go over the details with you.`]
            : 'Thanks for agreeing to the estimate! We’ll call you to set up a time for your project manager to come out.') : null,
          j.scheduledFor && ['scheduled', 'in_progress'].includes(j.status)
            ? el('div', { class: 'callout' }, '📅 ', el('b', {}, fmtWhen(j.scheduledFor)), j.contractorName ? ` · ${j.contractorName} from Top Hat is coming out.` : '')
            : null,
          j.stage && (TH.STAGES || []).find((x) => x.id === j.stage)
            ? el('div', { class: 'callout stage' }, `${TH.STAGES.find((x) => x.id === j.stage).icon} ${TH.STAGES.find((x) => x.id === j.stage).buyer}`)
            : null,
          ...(paper[j.id] || []).filter((dc) => dc.type === 'estimate' && dc.status === 'sent').map((dc) =>
            el('button', { type: 'button', class: 'gold block', onclick: () => openPaper(j, dc, { sign: true }) }, `✍️ Review & sign estimate · ${D.usd(D.totals(dc).total)}`)),
          ...(paper[j.id] || []).filter((dc) => needsSig(dc) && D.owed(dc) <= 0).map((dc) =>
            el('button', { type: 'button', class: 'gold block', onclick: () => openPaper(j, dc, { sign: true }) }, `✍️ Sign ${dc.type === 'invoice' ? 'invoice' : 'estimate'} ${dc.number}`)),
          ...(paper[j.id] || []).filter((dc) => D.owed(dc) > 0).map((dc) =>
            pendingSum(dc) >= D.owed(dc)
              ? el('div', { class: 'callout paid-sent' }, `⏳ ${D.usd(pendingSum(dc))} payment sent for ${dc.number} · waiting for Top Hat to confirm`)
              : el('button', { type: 'button', class: 'gold block', onclick: () => openPaper(j, dc, { pay: true }) }, `💳 Pay now · ${D.usd(D.owed(dc) - pendingSum(dc))}`,
              el('span', { class: 'btn-sub' }, `${dc.number}${dc.dueDate ? ' · due ' + D.fmtDate(dc.dueDate) : ''}${(dc.reports || []).some((r) => r.status === 'pending') ? ' · payment reported' : ''}`))),
          j.status !== 'lost' ? el('a', { class: 'btn studio-btn', href: `#/design?job=${j.id}` },
            el('span', {}, '🎨 Design studio'),
            el('span', { class: 'small' }, j.designCount ? `${j.designCount} picture${j.designCount === 1 ? '' : 's'} · keep changing it` : 'See your remodel before we build it')) : null,
          j.status !== 'lost' ? permitBox(j, me) : null,
          (j.materials || []).length && j.status !== 'lost' ? TH.materialsCard(j, { mode: 'customer' }) : null,
          j.status === 'completed' && (j.review?.rating || paidUp(paper[j.id] || [])) ? reviewBox(j, company) : null,
          (paper[j.id] || []).length ? el('div', { class: 'stack', style: 'gap:6px' }, el('b', { class: 'small' }, 'Estimates & invoices'),
            el('div', { class: 'doc-list' }, ...paper[j.id].map((dc) => el('button', { type: 'button', class: 'doc-row', onclick: () => openPaper(j, dc) },
              el('span', { class: 'ic' }, dc.type === 'invoice' ? '🧾' : '📝'),
              el('span', { class: 'body' }, el('b', {}, `${dc.type === 'invoice' ? 'Invoice' : 'Estimate'} ${dc.number}`),
                el('span', { class: 'muted small' }, dc.type === 'invoice' && D.owed(dc) > 0 ? `${D.usd(D.owed(dc))} due${dc.dueDate ? ' by ' + D.fmtDate(dc.dueDate) : ''}` : D.usd(D.totals(dc).total))),
              el('span', { class: `pill ${D.pillClass(dc)}` }, dc.type === 'estimate' && dc.status === 'sent' ? 'Needs your OK' : D.label(dc)))))) : null,
          TH.beforeAfter(docs[j.id].filter((f) => f.source === 'design'), { title: '🎨 Your design: before & after' }),
          docs[j.id].some((f) => f.source !== 'design') ? el('div', { class: 'stack', style: 'gap:6px' }, el('b', { class: 'small' }, 'Documents from Top Hat'),
            el('ul', { class: 'docs' }, ...docs[j.id].filter((f) => f.source !== 'design').map((f) => el('li', {},
              el('a', { href: f.url, target: '_blank', rel: 'noopener' }, (find(FILE_KINDS, f.kind) || FILE_KINDS.at(-1)).icon + ' ', f.name,
                el('span', {}, (find(FILE_KINDS, f.kind) || FILE_KINDS.at(-1)).label)))))) : null,
        );
      }),
    ));
  }

  /* ---------- design studio: photos + "here's what I want" → AI pictures ---------- */
  async function design() {
    const me = await api.auth.me();
    const jobId = new URLSearchParams(location.hash.split('?')[1] || '').get('job');
    if (!me) return go('login?next=jobs');
    const j = (await api.jobs.mine()).find((x) => x.id === jobId);
    if (!j) { view.append(el('div', { class: 'card', style: 'margin-top:24px' }, 'Job not found. ', el('a', { href: '#/jobs' }, 'Back to My jobs'))); return; }
    const trade = find(TRADES, j.trade) || TRADES.at(-1);
    view.append(el('div', { class: 'stack', style: 'margin-top:16px' },
      el('a', { href: '#/jobs', class: 'small' }, '← My jobs'),
      el('h1', {}, '🎨 Design studio'),
      el('p', { class: 'muted' }, `${trade.icon} ${trade.label} · TH-${j.number} · ${j.address}`),
      TH.studio({ jobId: j.id, trade: j.trade, photos: j.photos || [], styleLabel: TH.styleOf(j.style)?.label || '' })));
  }

  // "Questions? Reach us": their project manager (if one's assigned) and the office, one tap each.
  const tel = (p) => 'tel:' + String(p).replace(/[^\d+]/g, '');
  const sms = (p) => 'sms:' + String(p).replace(/[^\d+]/g, '');
  function contactCard(jobs, company) {
    const pm = jobs.map((j) => j.pm).find((x) => x && x.phone);
    const rows = [];
    if (pm) rows.push(el('div', { class: 'contact-row' },
      el('span', { class: 'who' }, el('b', {}, pm.name.split(' ')[0]), el('span', {}, 'Your project manager')),
      el('a', { class: 'btn gold small', href: tel(pm.phone) }, '📞 Call'),
      el('a', { class: 'btn ghost small', href: sms(pm.phone) }, '💬 Text')));
    if (company.phone || company.email) rows.push(el('div', { class: 'contact-row' },
      el('span', { class: 'who' }, el('b', {}, company.name || 'Top Hat Contracting'), el('span', {}, 'The office')),
      company.phone ? el('a', { class: 'btn ' + (pm ? 'ghost' : 'gold') + ' small', href: tel(company.phone) }, '📞 Call') : null,
      company.phone ? el('a', { class: 'btn ghost small', href: sms(company.phone) }, '💬 Text') : null,
      !company.phone && company.email ? el('a', { class: 'btn gold small', href: `mailto:${company.email}` }, '✉️ Email') : null));
    if (!rows.length) return null;
    return el('section', { class: 'contact-card' }, el('span', { class: 'contact-title' }, 'Questions? We’re one tap away'), ...rows);
  }

  // An invoice (once it's out) or an estimate approved by phone that has no customer signature yet.
  const needsSig = (dc) => !dc.signature && (dc.type === 'invoice'
    ? !['draft', 'void'].includes(dc.status) && !(dc.reports || []).some((r) => r.signature && r.status !== 'not_received')
    : dc.status === 'approved');
  // Finished and the last invoice paid: time to ask how we did.
  const paidUp = (list) => { const inv = list.filter((dc) => dc.type === 'invoice' && !['draft', 'void'].includes(dc.status)); return inv.length > 0 && inv.every((dc) => TH.docs.owed(dc) <= 0.005); };
  // After the job: how did we do? 1-5 stars and a comment, then (if set up) a link to post it on Google.
  function reviewBox(j, company) {
    const r = j.review || {};
    const link = company.reviewLink;
    if (r.rating) return el('div', { class: 'callout good review-done' }, el('b', {}, '⭐'.repeat(r.rating) + ' Thanks for your review!'),
      r.comment ? el('div', { class: 'small' }, `“${r.comment}”`) : null,
      link ? el('a', { class: 'btn gold block', href: link, target: '_blank', rel: 'noopener' }, '⭐ Share it on Google too') : null);
    let stars = 0;
    const err = el('div', { class: 'error', hidden: true, role: 'alert' });
    const starRow = el('div', { class: 'stars', role: 'radiogroup', 'aria-label': 'Your rating' });
    const drawStars = () => starRow.replaceChildren(...[1, 2, 3, 4, 5].map((n) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(n === stars), 'aria-label': `${n} star${n === 1 ? '' : 's'}`,
      class: n <= stars ? 'on' : '', onclick: () => { stars = n; err.hidden = true; drawStars(); } }, '★')));
    drawStars();
    const comment = el('textarea', { rows: 3, maxlength: '1000', placeholder: 'Tell us how it went (optional)', 'aria-label': 'Your review' });
    return el('section', { class: 'review-box stack' },
      el('h3', {}, '⭐ How did we do?'), el('p', { class: 'muted small' }, 'Your job is finished. A quick rating helps us and helps your neighbors find good contractors.'),
      starRow, comment, err,
      el('button', { type: 'button', class: 'gold block', onclick: async (e) => {
        e.currentTarget.disabled = true;
        try { await api.reviews.leave(j.id, stars, comment.value); route(); }
        catch (ex) { err.textContent = ex.message; err.hidden = false; e.currentTarget.disabled = false; }
      } }, 'Send my review'));
  }

  // Style ideas: three looks for each room. Anyone can browse; "Start a project in this style" begins a request with it picked.
  async function styleGuide() {
    const q = new URLSearchParams(location.hash.split('?')[1] || '');
    let room = TH.STYLE_ROOMS.find((r) => r.id === q.get('room')) || TH.STYLE_ROOMS[0];
    const body = el('div', { class: 'stack' });
    const draw = () => body.replaceChildren(
      el('div', { class: 'stage-chips room-chips' }, ...TH.STYLE_ROOMS.map((r) => el('button', { type: 'button', class: 'chip' + (r.id === room.id ? ' on' : ''), 'aria-pressed': String(r.id === room.id),
        onclick: () => { room = r; draw(); } }, `${r.icon} ${r.label}`))),
      el('div', { class: 'style-pick' }, ...room.styles.map((st) => el('article', { class: 'style-card static' },
        el('img', { src: `img/styles/${room.id}-${st.id}.svg`, alt: `${st.name} ${room.label.toLowerCase()}` }),
        el('span', { class: 'style-txt' }, el('b', {}, st.name), el('span', {}, st.desc)),
        el('button', { type: 'button', class: 'gold block', onclick: () => {
          Object.assign(draft, emptyDraft(), { trade: 'remodel', room: room.id, style: `${room.id}/${st.id}`, description: `${room.label} remodel, ${st.name.toLowerCase()} style.`, step: 2 });
          saveDraft(); go('request');
        } }, 'Start a project in this style')))));
    draw();
    view.append(el('div', { class: 'stack', style: 'margin-top:24px' },
      el('a', { class: 'link', href: '#/' }, '← Home'),
      el('h1', {}, '🖼️ Style ideas'), el('p', { class: 'muted' }, 'Three looks for each room. Pick the one closest to what you want, and your project manager will help you fine-tune it.'),
      body));
  }

  // Building permit: the customer tells Top Hat to apply, and signs with their name.
  function permitBox(j, me) {
    const p = j.permit || { status: 'none' };
    const st = (TH.PERMIT_STATUSES || []).find((x) => x.id === p.status);
    if (p.status !== 'none') {
      return el('div', { class: 'callout permit' }, '📋 ', el('b', {}, 'Building permit: '), st ? st.buyer : p.status,
        p.number ? el('span', {}, ` · Permit # ${p.number}`) : null,
        p.authorizedAt ? el('span', { class: 'muted small', style: 'display:block' }, `You approved applying on ${new Date(p.authorizedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} (signed “${p.authorizedBy}”).`) : null);
    }
    const err = el('div', { class: 'error', hidden: true, role: 'alert' });
    const nameIn = el('input', { autocomplete: 'name', placeholder: 'Your full name', value: '', 'aria-label': 'Type your full name to sign' });
    const ok = el('input', { type: 'checkbox' });
    const form = el('div', { class: 'stack', hidden: true },
      el('label', { class: 'match-box' }, ok, el('span', { class: 'small' },
        'I ask Top Hat Contracting to apply for the building permit for this job on my behalf, and to share my name, address and the project details with the local building department.')),
      el('label', { class: 'field' }, 'Sign by typing your full name', nameIn),
      err,
      el('button', { type: 'button', class: 'gold', onclick: async (e) => {
        if (!ok.checked) { err.textContent = 'Tick the box to say you approve.'; err.hidden = false; return; }
        e.currentTarget.disabled = true;
        try { await api.jobs.authorizePermit(j.id, nameIn.value); route(); }
        catch (ex) { err.textContent = ex.message; err.hidden = false; e.currentTarget.disabled = false; }
      } }, 'Yes, apply for my permit'));
    return el('div', { class: 'permit-ask stack' },
      el('div', { class: 'row' }, el('span', {}, '📋'), el('span', { class: 'small', style: 'flex:1' }, 'Need a building permit? We can apply for you.'),
        el('button', { type: 'button', class: 'ghost small', onclick: (e) => { form.hidden = false; e.currentTarget.hidden = true; if (!nameIn.value) nameIn.value = me?.name || ''; } }, 'Apply for me')),
      form);
  }

  /* ---------- log in ---------- */
  async function login() {
    const next = new URLSearchParams(location.hash.split('?')[1] || '').get('next') || 'jobs';
    view.append(TH.loginForm({ onCustomer: () => {
      if (next === 'request') { draft.step = 6; saveDraft(); }
      go(next);
    } }));
  }

  route();
})();
