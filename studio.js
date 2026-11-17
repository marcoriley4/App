/* Design studio: the customer (or a rep at the visit) uploads a photo of the space, says what they want,
   and gets an AI picture of the remodel. They keep changing it until it's right, then pick the one. */
(function () {
  const { api, el, ago } = TH;

  const IDEAS = {
    remodel: ['Remove the center island', 'L-shaped layout', 'White shaker cabinets', 'Quartz countertops', 'Subway tile backsplash', 'Wood-look floors', 'Brighter lighting'],
    flooring: ['Light oak hardwood', 'Gray luxury vinyl plank', 'Large white tile', 'Dark walnut floors'],
    painting: ['Warm white walls', 'Navy accent wall', 'Sage green', 'Black window trim'],
    roofing: ['Charcoal architectural shingles', 'Black metal roof', 'New white gutters'],
    landscaping: ['Paver patio', 'Fire pit', 'Fresh mulch beds', 'Low-maintenance plants'],
    plumbing: ['Farmhouse sink', 'Matte black faucet', 'Walk-in shower', 'Freestanding tub'],
    electrical: ['Recessed lights', 'Pendant lights', 'Under-cabinet lighting', 'Ceiling fan'],
    hvac: ['Hide the ductwork', 'Sleek wall vents', 'New thermostat'],
    drywall: ['Smooth ceiling', 'Take out this wall', 'Add an archway', 'Built-in shelves'],
    other: ['Modern look', 'Farmhouse style', 'Brighter and more open', 'Natural wood accents'],
  };

  // Mount the studio for one job. opts: { jobId, trade, photos: [dataUrl], title }
  function studio(opts) {
    const root = el('div', { class: 'studio stack' });
    let versions = [];
    let currentId = null;
    let busy = false;
    const errorBox = el('div', { class: 'error', hidden: true, role: 'alert' });
    const fail = (err) => { errorBox.textContent = err.message || String(err); errorBox.hidden = false; errorBox.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
    const byId = (id) => versions.find((v) => v.id === id);
    const nameOf = (v) => (v.source === 'photo' ? 'Your photo' : `Design ${versions.filter((x) => x.source === 'ai').indexOf(v) + 1}`);
    // The changes that led to a picture, oldest first.
    const lineage = (v) => { const out = []; for (let x = v; x && x.source === 'ai'; x = byId(x.parentId)) out.unshift(x); return out; };

    async function load(selectId) {
      try { versions = await api.designs.list(opts.jobId); } catch (err) { fail(err); versions = []; }
      currentId = selectId || versions.find((v) => v.chosen)?.id || versions.at(-1)?.id || null;
      draw();
    }

    async function addPhoto(photo) {
      errorBox.hidden = true;
      try { const v = await api.designs.addPhoto(opts.jobId, photo); await load(v.id); } catch (err) { fail(err); }
    }

    const uploadBtn = (label, cls) => el('label', { class: 'btn ' + cls }, label,
      el('input', { type: 'file', accept: 'image/*', hidden: true, onchange: (e) => { const f = e.target.files[0]; if (f) addPhoto(f); } }));

    // Owner/office only (preview): connect Gemini so the studio can make pictures.
    function connectBox() {
      if (!opts.canConnect || api.mode !== 'preview') return null;
      const cfg = TH.ai.config();
      if (cfg.key) return el('p', { class: 'small ai-on' }, `✓ AI pictures connected (Gemini · ${cfg.model}) `,
        el('button', { type: 'button', class: 'link small', onclick: () => { if (confirm('Disconnect Gemini from this browser?')) { TH.ai.disconnect(); draw(); } } }, 'Disconnect'));
      const key = el('input', { type: 'password', placeholder: 'Paste your Gemini API key (AIza…)', autocomplete: 'off', 'aria-label': 'Gemini API key' });
      const err = el('div', { class: 'error', hidden: true, role: 'alert' });
      const btn = el('button', { type: 'button', class: 'gold block', onclick: async () => {
        btn.disabled = true; btn.textContent = 'Checking with Google…'; err.hidden = true;
        try { await TH.ai.connect(key.value); draw(); }
        catch (e) { err.textContent = e.message; err.hidden = false; btn.disabled = false; btn.textContent = '🔌 Connect'; }
      } }, '🔌 Connect');
      return el('section', { class: 'ai-connect stack' },
        el('h3', {}, '🔌 Connect Gemini to make pictures'),
        el('ol', { class: 'small' },
          el('li', {}, 'Open ', el('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener' }, 'aistudio.google.com/apikey'), ' and sign in with your Google account.'),
          el('li', {}, 'Tap ', el('b', {}, 'Create API key'), ' and copy it.'),
          el('li', {}, 'Paste it here and tap Connect.')),
        key, err, btn,
        el('p', { class: 'muted small' }, 'Saved only in this browser on this device, never in the app’s code. Pictures cost a few cents each on your Google account.'));
    }

    function draw() { drawBody(); const cb = connectBox(); if (cb) root.prepend(cb); }
    function drawBody() {
      const cur = byId(currentId);
      if (!cur) {
        root.replaceChildren(...[
          el('p', { class: 'muted' }, 'Start with a photo of the space you want to change. Stand back so the whole area is in the picture.'),
          errorBox,
          (opts.photos || []).length ? el('div', { class: 'stack', style: 'gap:6px' }, el('b', { class: 'small' }, 'Use a photo you already sent us'),
            el('div', { class: 'studio-pick' }, ...opts.photos.map((src, i) => el('button', { type: 'button', 'aria-label': `Use photo ${i + 1}`, onclick: () => addPhoto(src) }, el('img', { src, alt: '' }))))) : null,
          uploadBtn('📷 Take or upload a photo', 'gold block'),
        ].filter(Boolean));
        return;
      }
      const prompt = el('textarea', { rows: 3, maxlength: '1500', placeholder: 'e.g. Take out the center island and make it an L-shaped kitchen along the left and back walls, with white shaker cabinets and quartz counters.', 'aria-label': 'What do you want to change?' });
      const ideas = (IDEAS[opts.trade] || IDEAS.other);
      const go = el('button', { type: 'button', class: 'gold block', onclick: async () => {
        if (busy) return;
        const text = prompt.value.trim();
        if (text.length < 3) { prompt.focus(); return fail(new Error('Tell us what you want changed.')); }
        busy = true; errorBox.hidden = true; go.disabled = true;
        go.replaceChildren(el('span', { class: 'spinner', 'aria-hidden': 'true' }), ' Making your picture… (about 10–30 seconds)');
        try { const v = await api.designs.generate(opts.jobId, cur.id, text); await load(v.id); }
        catch (err) { busy = false; go.disabled = false; go.textContent = '✨ Show me'; fail(err); }
        busy = false;
      } }, '✨ Show me');
      const steps = lineage(cur);
      root.replaceChildren(...[
        errorBox,
        el('figure', { class: 'studio-main' },
          cur.url ? el('img', { src: cur.url, alt: cur.prompt ? `Design: ${cur.prompt}` : 'Photo of the space' }) : el('div', { class: 'muted' }, 'Picture missing'),
          el('figcaption', {},
            el('b', {}, nameOf(cur)), cur.chosen ? el('span', { class: 'pill s-completed' }, '⭐ The one') : null,
            el('span', { class: 'muted small' }, ` · ${cur.by || ''} · ${ago(cur.at)}`))),
        steps.length ? el('ol', { class: 'studio-steps' }, ...steps.map((v) => el('li', {}, v.prompt))) : null,
        el('div', { class: 'row', style: 'flex-wrap:wrap' },
          cur.source === 'ai' && !cur.chosen ? el('button', { type: 'button', class: 'ghost', style: 'flex:1', onclick: async () => {
            try { await api.designs.choose(opts.jobId, cur.id); await load(cur.id); opts.onChoose && opts.onChoose(); } catch (err) { fail(err); }
          } }, '⭐ This is the one') : null,
          cur.url ? el('a', { class: 'btn ghost', style: 'flex:1', href: cur.url, download: `${nameOf(cur).replace(/\s+/g, '-')}.png` }, '⬇ Save picture') : null),
        el('section', { class: 'card stack studio-ask' },
          el('b', {}, cur.source === 'photo' ? 'What do you want done to this space?' : 'Want to change anything?'),
          el('p', { class: 'muted small' }, cur.source === 'photo' ? 'Describe it like you’d tell a contractor: what to remove, the layout, materials and colors.' : 'Each change starts from the picture above. Tap another picture below to change that one instead.'),
          el('div', { class: 'stage-chips' }, ...ideas.map((t) => el('button', { type: 'button', class: 'chip', onclick: () => { prompt.value = prompt.value.trim() ? `${prompt.value.trim()}. ${t}` : t; prompt.focus(); } }, t))),
          prompt, go),
        versions.length > 1 ? el('div', { class: 'stack', style: 'gap:6px' }, el('b', { class: 'small' }, `All pictures (${versions.length})`),
          el('div', { class: 'studio-strip' }, ...versions.slice().reverse().map((v) => el('button', { type: 'button', class: v.id === cur.id ? 'on' : '', 'aria-label': nameOf(v), onclick: () => { currentId = v.id; draw(); } },
            v.url ? el('img', { src: v.url, alt: '' }) : null, el('span', {}, (v.chosen ? '⭐ ' : '') + nameOf(v)))))) : null,
        uploadBtn('📷 Start from a different photo', 'ghost small'),
        el('p', { class: 'muted small' }, 'Pictures are made by AI to help you picture the idea. Final materials, sizes and layout are confirmed with your Top Hat project manager.'),
      ].filter(Boolean));
    }

    load();
    return root;
  }

  TH.studio = studio;
})();
