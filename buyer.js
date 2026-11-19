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

  const emptyDraft = () => ({ step: 1, trade: '', description: '', measurements: '', address: '', zip: '', state: '', room: '', style: '', timeframe: '', budget: '', photos: [] });
  let draft = emptyDraft();
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
      ['🎨', 'Design it & agree on a price', 'Share photos or describe it. Pick the design, colors and details.',
        'Upload pictures of your space or describe the project you’d like done. Finalize the design, colors and details, then agree on an estimated price.'],
      ['📐', 'Meet your project manager', 'We measure, finalize the estimate and put you on the calendar.',
        'Your Top Hat project manager comes out to field-verify measurements, go over the details, finalize the estimate and collect your deposit. Your project goes on the Top Hat calendar and is assigned to a contractor.'],
      ['🏗️', 'Permits, materials & we begin', 'Permits pulled, materials delivered, work starts.',
        'Your contractor applies for the local building permits if required and visits the site. Materials are ordered and delivered, and your project begins.'],
      ['🥤', 'Relax & watch the magic happen', 'Sit back while Top Hat handles the rest.',
        'Grab a cold beverage and sit back while Top Hat handles all the things most people don’t want to do.'],
    ];
    view.append(el('div', { class: 'stack' },
      el('section', { class: 'hero' },
        el('span', { class: 'hero-tag' }, 'Premier residential contracting'),
        el('img', { class: 'hero-logo', src: 'img/logo.jpg', alt: 'Top Hat Contracting Services' }),
        el('a', { class: 'btn gold block hero-cta', href: '#/request', onclick: () => { if (draft.step > 4) clearDraft(); } },
          el('h1', {}, 'Start your project the right way, right now.')),
        el('p', { class: 'cta-note' }, 'Tap to start'),
      ),
      el('section', { class: 'four-steps' },
        el('h2', {}, 'It’s simple: ', el('span', { class: 'hl' }, '4 steps'), ' and you’re on your way'),
        el('ol', {}, ...STEPS.map(([ic, title, short, long], i) => el('li', {},
          el('details', {},
            el('summary', {},
              el('span', { class: 'n' }, String(i + 1)),
              el('span', { class: 'ic', 'aria-hidden': 'true' }, ic),
              el('span', { class: 'txt' }, el('b', {}, title), el('span', {}, short)),
              el('span', { class: 'more', 'aria-hidden': 'true' })),
            el('p', {}, long))))),
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
    const roomTrade = TH.STYLE_TRADES.includes(draft.trade);
    const SCREENS = ['trade', roomTrade ? 'design' : 'photos', 'describe', 'where', 'when', 'budget', ...(me ? [] : ['contact'])];
    const total = SCREENS.length;
    const at = (name) => SCREENS.indexOf(name) + 1;
    // Never skip ahead past something we still need.
    const missing = () => {
      if (!find(TRADES, draft.trade)) return 1;
      if ((draft.description || '').trim().length < 10) return at('describe');
      if (!(draft.address || '').trim() || !/^\d{5}$/.test(draft.zip || '') || !draft.state) return at('where');
      if (!draft.timeframe) return at('when');
      return total;
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
      step > 1 && trade ? el('p', { class: 'wiz-what' }, `${trade.icon} ${trade.label}`) : null,
      el('h1', { class: 'wiz-q' }, title),
      sub ? el('p', { class: 'wiz-sub' }, sub) : null,
      errorBox,
      ...body,
      onNext ? el('div', { class: 'wiz-next' }, el('button', { type: 'button', class: 'gold block big', onclick: onNext }, nextLabel || 'Next')) : null,
      extra || null,
    );

    if (screen === 'trade') {
      view.append(shell('What do you want done?', 'Tap one.', [
        el('div', { class: 'tiles big-tiles' }, ...TRADES.map((t) => el('button', { type: 'button', class: 'tile' + (draft.trade === t.id ? ' on' : ''),
          onclick: () => { draft.trade = t.id; next(); } },
          el('span', { class: 'ic' }, t.icon), t.label))),
      ]));
      return;
    }

    if (screen === 'photos') {
      const grid = el('div', { class: 'photos' });
      const btnWrap = el('div', { class: 'wiz-next' });
      const draw = () => {
        grid.replaceChildren(...draft.photos.map((src, i) => el('div', { class: 'photo' },
          el('img', { src, alt: `Photo ${i + 1}` }),
          el('button', { type: 'button', 'aria-label': `Remove photo ${i + 1}`, onclick: () => { draft.photos.splice(i, 1); saveDraft(); draw(); } }, '✕'))));
        btnWrap.replaceChildren(draft.photos.length
          ? el('button', { type: 'button', class: 'gold block big', onclick: next }, `Next (${draft.photos.length} photo${draft.photos.length === 1 ? '' : 's'})`)
          : el('button', { type: 'button', class: 'ghost block', onclick: next }, 'Skip for now'));
        addBtn.hidden = draft.photos.length >= MAX_PHOTOS;
      };
      const addBtn = el('label', { class: 'btn gold block big photo-btn' }, '📷 Take or add photos',
        el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: async (e) => {
          const files = [...e.target.files].slice(0, MAX_PHOTOS - draft.photos.length);
          for (const f of files) { try { draft.photos.push(await shrinkImage(f)); } catch (err) { showError(err.message); } }
          saveDraft(); draw();
        } }));
      view.append(shell('Show us the space', 'A few phone pictures help us price it right. Up to 5.', [addBtn, grid,
        ]));
      view.querySelector('.wiz').append(btnWrap);
      draw();
      return;
    }

    // Design: 1) add a photo of their space, 2) pick the room, 3) pick one of the three looks, then see their dream room.
    if (screen === 'design') {
      let room = TH.STYLE_ROOMS.find((r) => r.id === draft.room) || null;
      const grid = el('div', { class: 'photos' });
      const btnWrap = el('div', { class: 'wiz-next' });
      const rooms = el('div', { class: 'stage-chips room-chips', role: 'radiogroup', 'aria-label': 'Which room' });
      const looks = el('div', { class: 'look-list', role: 'radiogroup', 'aria-label': 'Pick a look' });
      const lookHead = el('h2', { class: 'wiz-part' }, el('span', { class: 'n' }, '3'), 'Pick the look you want');
      const drawRooms = () => rooms.replaceChildren(...TH.STYLE_ROOMS.map((r) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(draft.room === r.id), class: 'chip' + (draft.room === r.id ? ' on' : ''),
        onclick: () => pickRoom(r) }, `${r.icon} ${r.label}`)),
        el('button', { type: 'button', role: 'radio', 'aria-checked': String(draft.room === 'none'), class: 'chip' + (draft.room === 'none' ? ' on' : ''),
          onclick: () => pickRoom(null) }, '📋 Something else'));
      const pickRoom = (r) => {
        draft.room = r ? r.id : 'none'; room = r;
        if (!r || !(draft.style || '').startsWith(r.id + '/')) draft.style = '';
        saveDraft(); drawRooms(); drawLooks(); drawDream(); drawBtn();
        if (r) setTimeout(() => lookHead.scrollIntoView({ block: 'start', behavior: 'smooth' }), 30);
      };
      const drawLooks = () => {
        lookHead.hidden = !room;
        looks.replaceChildren(...(room ? room.styles.map((st, i) => { const key = `${room.id}/${st.id}`; const on = draft.style === key;
          return el('button', { type: 'button', role: 'radio', 'aria-checked': String(on), class: 'look' + (on ? ' on' : ''), onclick: () => { draft.style = on ? '' : key; saveDraft(); drawLooks(); drawBtn(); drawDream(); } },
            el('img', { src: `img/styles/${room.id}-${st.id}.svg`, alt: '' }),
            el('span', { class: 'look-txt' }, el('b', {}, `${i + 1}. ${st.name}`), el('span', {}, st.desc)),
            el('span', { class: 'look-check', 'aria-hidden': 'true' }, on ? '✓' : '')); }) : []));
      };
      // ✨ Their dream room: their own photo in the look they picked, right here before they send anything.
      const dreamBox = el('div', { class: 'dream-box' });
      const drawDream = () => {
        const look = room && TH.styleOf(draft.style);
        const d = draft.dream && draft.dream.style === draft.style ? draft.dream : null;
        if (!look) { dreamBox.replaceChildren(); return; }
        if (!draft.photos.length) { dreamBox.replaceChildren(el('p', { class: 'muted small' }, `Add a photo above and we’ll show you your ${room.label.toLowerCase()} in the ${look.style.name} look.`)); return; }
        const err = el('div', { class: 'error', hidden: true, role: 'alert' });
        const make = async (btn, extra = '') => {
          btn.disabled = true; err.hidden = true;
          dreamBox.classList.add('making');
          const label = btn.textContent; btn.textContent = `Making your ${room.label.toLowerCase()}… (10 to 30 seconds)`;
          try {
            const image = await api.designs.dream(draft.photos[0], draft.style, extra);
            draft.dream = { style: draft.style, image, prompt: TH.dreamRequest(look, extra) }; saveDraft(); drawDream(); drawBtn();
            dreamBox.scrollIntoView({ block: 'start', behavior: 'smooth' });
          } catch (e) { err.textContent = e.message; err.hidden = false; btn.disabled = false; btn.textContent = label; }
          finally { dreamBox.classList.remove('making'); }
        };
        if (!d) {
          const btn = el('button', { type: 'button', class: 'dream-btn block big', onclick: () => make(btn) }, `✨ Show me my dream ${room.label.toLowerCase()}`);
          dreamBox.replaceChildren(el('div', { class: 'dream-wait' }, el('img', { src: draft.photos[0], alt: 'Your photo' }), el('span', { class: 'spinner', 'aria-hidden': 'true' })), btn, err);
          return;
        }
        const extra = el('input', { placeholder: 'Change something? e.g. darker floors, no island', 'aria-label': 'Change something', maxlength: '200' });
        const again = el('button', { type: 'button', class: 'ghost block', onclick: () => make(again, extra.value) }, '🔁 Make it again');
        dreamBox.replaceChildren(
          el('h3', {}, `✨ Your dream ${room.label.toLowerCase()} · ${look.style.name}`),
          el('img', { class: 'dream-img', src: d.image, alt: `Your ${room.label.toLowerCase()} in the ${look.style.name} look` }),
          el('p', { class: 'muted small' }, 'We’ll see this same picture when we call you, so we’re talking about the same thing.'),
          el('div', { class: 'dream-again' }, extra, again), err);
      };
      const drawBtn = () => {
        const loved = draft.dream && draft.dream.style === draft.style;
        btnWrap.replaceChildren(draft.photos.length || draft.style
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
      const addBtn = el('label', { class: 'btn gold block big photo-btn' }, draft.photos.length ? '📷 Add more photos' : '📷 Take or add a photo',
        el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: async (e) => {
          const files = [...e.target.files].slice(0, MAX_PHOTOS - draft.photos.length);
          for (const f of files) { try { draft.photos.push(await shrinkImage(f)); } catch (err) { showError(err.message); } }
          saveDraft(); draw();
        } }));
      view.append(shell('Show us your space and pick a style', 'See your dream room before we even talk.', [
        el('h2', { class: 'wiz-part' }, el('span', { class: 'n' }, '1'), 'Add a photo of your space'),
        el('p', { class: 'wiz-sub' }, 'Stand back so the whole room is in the picture. Up to 5.'),
        addBtn, grid,
        el('h2', { class: 'wiz-part' }, el('span', { class: 'n' }, '2'), 'Which room is it?'),
        rooms,
        lookHead, looks,
        dreamBox,
      ]));
      view.querySelector('.wiz').append(btnWrap);
      drawRooms(); drawLooks(); draw();
      return;
    }

    if (screen === 'describe') {
      const text = el('textarea', { rows: 4, value: draft.description || '', placeholder: 'e.g. Take out the island and make the kitchen L-shaped. White cabinets, quartz counters.', 'aria-label': 'What would you like done?',
        oninput: () => { draft.description = text.value; saveDraft(); } });
      const measure = el('input', { value: draft.measurements || '', placeholder: 'e.g. Kitchen is about 12 x 14 ft', 'aria-label': 'Measurements',
        oninput: () => { draft.measurements = measure.value; saveDraft(); } });
      const measureWrap = el('div', { hidden: !draft.measurements }, measure);
      view.append(shell('What would you like done?', 'Just a sentence or two. Tap to add:', [
        el('div', { class: 'stage-chips' }, ...(IDEA_CHIPS[draft.trade] || IDEA_CHIPS.other).map((c) => el('button', { type: 'button', class: 'chip',
          onclick: () => { text.value = text.value.trim() ? `${text.value.trim()}. ${c}` : c; draft.description = text.value; saveDraft(); text.focus(); } }, `+ ${c}`))),
        text,
        draft.measurements ? null : el('button', { type: 'button', class: 'link', onclick: (e) => { measureWrap.hidden = false; e.currentTarget.remove(); measure.focus(); } }, '+ Add measurements (optional)'),
        measureWrap,
      ], { onNext: () => {
        draft.description = text.value.trim(); draft.measurements = measure.value.trim(); saveDraft();
        if (draft.description.length < 10) return showError('Tell us a little more: just a sentence is fine.');
        next();
      } }));
      return;
    }

    if (screen === 'where') {
      const addr = el('input', { value: draft.address || '', placeholder: 'Street address, city', autocomplete: 'street-address', 'aria-label': 'Street address and city' });
      // State: picked for them from the ZIP code (they can change it).
      const stateSel = el('select', { 'aria-label': 'State', autocomplete: 'address-level1', onchange: () => { stateSel.dataset.picked = '1'; } },
        el('option', { value: '' }, 'State'), ...TH.US_STATES.map(([c, n]) => el('option', { value: c, selected: c === draft.state }, n)));
      const zip = el('input', { value: draft.zip || '', placeholder: 'ZIP', inputmode: 'numeric', maxlength: '5', autocomplete: 'postal-code', 'aria-label': 'ZIP code',
        oninput: () => { const g = TH.stateFromZip(zip.value); if (g && !stateSel.dataset.picked) stateSel.value = g; } });
      view.append(shell('Where is the project?', null, [addr, el('div', { class: 'two zip-state' }, zip, stateSel)], { onNext: () => {
        draft.address = addr.value.trim(); draft.zip = zip.value.trim(); draft.state = stateSel.value; saveDraft();
        if (!draft.address) return showError('Enter the street address and city.');
        if (!/^\d{5}$/.test(draft.zip)) return showError('Enter the 5-digit ZIP code.');
        if (!draft.state) return showError('Pick the state the project is in.');
        next();
      } }));
      return;
    }

    if (screen === 'when') {
      // Tap a day (or "I'm flexible") and you're on to the next question.
      const cal = calendarPicker(draft.timeframe, (v) => { draft.timeframe = v; saveDraft(); if (v) setTimeout(next, 250); });
      view.append(shell('When do you need it done?', 'Tap a day, or “I’m flexible”.', [cal]));
      return;
    }

    if (screen === 'budget') {
      const last = step === total;
      view.append(shell('Have you thought about a budget?', 'It’s OK if you’re not sure.', [
        el('div', { class: 'big-options' }, ...BUDGETS.map((bg) => el('button', { type: 'button', class: 'big-option' + (draft.budget === bg.id && draft.budgetSet ? ' on' : ''),
          onclick: async (e) => {
            draft.budget = bg.id; draft.budgetSet = true; saveDraft();
            if (!last) return next();
            e.currentTarget.disabled = true; await submitJob(showError); e.currentTarget.disabled = false;
          } }, BUDGET_TEXT[bg.id] || bg.label))),
        last ? el('p', { class: 'wiz-sub' }, 'Tap one to send your request.') : null,
      ]));
      return;
    }

    // contact: the only typing-heavy screen, kept to four boxes and one button.
    const f = {
      name: el('input', { autocomplete: 'name', placeholder: 'Full name', 'aria-label': 'Full name' }),
      phone: el('input', { type: 'tel', autocomplete: 'tel', inputmode: 'tel', placeholder: 'Mobile phone', 'aria-label': 'Mobile phone' }),
      email: el('input', { type: 'email', autocomplete: 'email', inputmode: 'email', placeholder: 'Email', 'aria-label': 'Email' }),
      password: el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Create a password (8+ characters)', 'aria-label': 'Create a password' }),
    };
    const send = async (e) => {
      const btn = e.currentTarget; btn.disabled = true;
      try {
        await api.auth.signUp({ name: f.name.value, phone: f.phone.value, email: f.email.value, password: f.password.value });
        await submitJob(showError);
      } catch (err) { showError(err.message); }
      finally { btn.disabled = false; }
    };
    view.append(shell('Last step: how do we reach you?', 'We’ll call you with your estimate.', [f.name, f.phone, f.email, f.password],
      { nextLabel: 'Send my request', onNext: send,
        extra: el('p', { class: 'muted small', style: 'text-align:center;margin-top:12px' }, 'Already have an account? ', el('a', { href: '#/login?next=request' }, 'Log in'), ' and your request will be waiting.') }));
  }

  async function submitJob(showError) {
    try {
      const m = (draft.measurements || '').trim();
      const job = await api.jobs.create({ ...draft, description: m ? `${draft.description}\n\nMeasurements: ${m}` : draft.description });
      // Their room in the look they picked: made on the next screen.
      try { sessionStorage.removeItem('tophat.makeDesign'); sessionStorage.removeItem('tophat.dreamSaved'); } catch (e) {}
      if (job && job.id && draft.dream && draft.dream.style === draft.style && draft.photos.length) {
        // Their dream picture goes on the job, so the office sees the same picture when they call.
        try { await api.designs.adopt(job.id, draft.photos[0], draft.dream.image, draft.dream.prompt); sessionStorage.setItem('tophat.dreamSaved', JSON.stringify({ jobId: job.id, style: draft.style, image: draft.dream.image })); } catch (e) { console.warn('Saving the dream picture failed:', e); }
      } else {
        try { if (job && job.id && TH.styleOf(draft.style) && draft.photos.length) sessionStorage.setItem('tophat.makeDesign', JSON.stringify({ jobId: job.id, style: draft.style, photo: draft.photos[0] })); } catch (e) {}
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
  function makeDesignCard() {
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem('tophat.dreamSaved') || 'null'); sessionStorage.removeItem('tophat.dreamSaved'); } catch (e) {}
    const sl = saved && TH.styleOf(saved.style);
    if (sl) return el('section', { class: 'make-design stack' },
      el('h2', {}, `🌟 Your dream ${sl.room.label.toLowerCase()} is saved`), el('img', { class: 'made', src: saved.image, alt: '' }),
      el('p', { class: 'muted small' }, 'When we call, we’ll be looking at this same picture.'),
      el('a', { class: 'btn ghost block', href: `#/design?job=${saved.jobId}` }, '🎨 Change it in the Design studio'));
    let job = null;
    try { job = JSON.parse(sessionStorage.getItem('tophat.makeDesign') || 'null'); sessionStorage.removeItem('tophat.makeDesign'); } catch (e) {}
    const look = job && TH.styleOf(job.style);
    if (!look) return null;
    const card = el('section', { class: 'make-design stack' });
    const studio = el('a', { class: 'btn ghost block', href: `#/design?job=${job.jobId}` }, '🎨 Change it in the Design studio');
    card.replaceChildren(el('h2', {}, `🎨 Making your ${look.room.label.toLowerCase()} in the ${look.style.name} look…`),
      el('div', { class: 'make-wait' }, el('img', { src: job.photo, alt: 'Your photo' }), el('span', { class: 'spinner', 'aria-hidden': 'true' })),
      el('p', { class: 'muted small' }, 'This takes about 10 to 30 seconds.'));
    (async () => {
      try {
        const photo = await api.designs.addPhoto(job.jobId, job.photo);
        const v = await api.designs.generate(job.jobId, photo.id,
          `Redesign this ${look.room.label.toLowerCase()} in the ${look.style.name} style: ${look.style.desc}. Keep the same room, walls, windows and camera angle.`);
        await api.designs.choose(job.jobId, v.id).catch(() => {});
        const url = (await api.designs.list(job.jobId)).find((x) => x.id === v.id)?.url;
        card.replaceChildren(el('h2', {}, `🎨 Your ${look.room.label.toLowerCase()}, ${look.style.name} look`),
          url ? el('img', { class: 'made', src: url, alt: `Your ${look.room.label.toLowerCase()} in the ${look.style.name} look` }) : null,
          el('p', { class: 'muted small' }, 'Saved to your job. Your project manager will see it too.'), studio);
      } catch (e) {
        // AI not turned on (or busy): show the look they picked; the office and their rep see it on the job.
        card.replaceChildren(el('h2', {}, `🎨 You picked: ${look.label}`), el('img', { class: 'made', src: look.img, alt: '' }),
          el('p', { class: 'muted small' }, 'Your design picture will show up in the Design studio on your job once it’s ready. Your project manager already sees the look you picked.'), studio);
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
