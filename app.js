(() => {
  'use strict';

  const TRADES = [
    'General contracting', 'Plumbing', 'Electrical', 'Roofing',
    'Carpentry', 'Painting', 'HVAC', 'Landscaping', 'Flooring',
  ];

  const CONTRACTORS = [
    { id: 1, name: 'Maria Rodriguez', company: 'Rodriguez Builders', trade: 'General contracting', city: 'Oakland, CA', rating: 4.9, reviews: 212, rate: 95, years: 14, licensed: true, tags: ['Kitchens', 'Additions', 'Permits'], bio: 'Full-service remodels from design to final inspection. Known for clear schedules and clean job sites.' },
    { id: 2, name: 'Andre Lewis', company: 'Lewis Roofing Co.', trade: 'Roofing', city: 'San Jose, CA', rating: 4.7, reviews: 158, rate: 85, years: 11, licensed: true, tags: ['Shingle', 'Tile', 'Inspections'], bio: 'Roof repairs, replacements, and free inspections. Every job comes with a 10-year workmanship warranty.' },
    { id: 3, name: 'Jin Park', company: 'Park Woodworks', trade: 'Carpentry', city: 'Berkeley, CA', rating: 4.8, reviews: 96, rate: 75, years: 9, licensed: true, tags: ['Decks', 'Built-ins', 'Trim'], bio: 'Custom decks, cabinetry, and finish carpentry built to last, in hardwood or composite.' },
    { id: 4, name: 'Sasha Novak', company: 'Bright Line Electric', trade: 'Electrical', city: 'San Francisco, CA', rating: 4.9, reviews: 184, rate: 110, years: 16, licensed: true, tags: ['Panel upgrades', 'EV chargers', 'Lighting'], bio: 'Master electrician handling panel upgrades, EV charger installs, and whole-home rewiring.' },
    { id: 5, name: 'Tom Okafor', company: 'Okafor Plumbing', trade: 'Plumbing', city: 'Fremont, CA', rating: 4.6, reviews: 241, rate: 90, years: 20, licensed: true, tags: ['Water heaters', 'Repiping', 'Emergency'], bio: '24/7 emergency service plus planned work like repiping and tankless water heater installs.' },
    { id: 6, name: 'Lena Fischer', company: 'Fresh Coat Painting', trade: 'Painting', city: 'Oakland, CA', rating: 4.5, reviews: 77, rate: 55, years: 6, licensed: true, tags: ['Interior', 'Exterior', 'Cabinets'], bio: 'Interior and exterior painting with low-VOC paints. Furniture is covered and moved for you.' },
    { id: 7, name: 'Diego Santos', company: 'Comfort Air HVAC', trade: 'HVAC', city: 'Hayward, CA', rating: 4.4, reviews: 63, rate: 100, years: 8, licensed: true, tags: ['Heat pumps', 'Ductwork', 'Maintenance'], bio: 'Heat pump installs and rebate paperwork, plus seasonal maintenance plans.' },
    { id: 8, name: 'Priya Shah', company: 'Greenleaf Landscapes', trade: 'Landscaping', city: 'Palo Alto, CA', rating: 4.8, reviews: 129, rate: 65, years: 10, licensed: false, tags: ['Drought-tolerant', 'Irrigation', 'Hardscape'], bio: 'Water-wise garden design, drip irrigation, and patios that hold up through the seasons.' },
    { id: 9, name: 'Owen Brooks', company: 'Brooks Floor Studio', trade: 'Flooring', city: 'San Mateo, CA', rating: 4.3, reviews: 48, rate: 60, years: 5, licensed: true, tags: ['Hardwood', 'LVP', 'Refinishing'], bio: 'Hardwood install and refinishing, luxury vinyl plank, and tile, with dust-controlled sanding.' },
    { id: 10, name: 'Grace Kim', company: 'Kim & Co. Construction', trade: 'General contracting', city: 'San Francisco, CA', rating: 4.6, reviews: 88, rate: 105, years: 12, licensed: true, tags: ['ADUs', 'Seismic retrofit', 'Bathrooms'], bio: 'ADU construction and seismic retrofits, with permitting handled end to end.' },
  ];

  const SEED_JOBS = [
    { id: 's1', title: 'Replace water heater', trade: 'Plumbing', budget: 1800, zip: '94110', description: '40-gallon gas unit in garage, about 12 years old. Open to switching to tankless.', posted: Date.now() - 2 * 3600e3 },
    { id: 's2', title: 'Build backyard deck', trade: 'Carpentry', budget: 12000, zip: '94705', description: 'Roughly 300 sq ft composite deck with stairs and railing. Ground is level.', posted: Date.now() - 26 * 3600e3 },
    { id: 's3', title: 'Install EV charger', trade: 'Electrical', budget: 1500, zip: '94061', description: 'Level 2 charger in detached garage, about 40 ft from the main panel.', posted: Date.now() - 3 * 86400e3 },
  ];

  const JOBS_KEY = 'groundwork.jobs';
  const $ = (sel, root = document) => root.querySelector(sel);

  // ---------- storage (best-effort; the page works without it) ----------
  function loadJobs() {
    try {
      const saved = JSON.parse(localStorage.getItem(JOBS_KEY) || '[]');
      return Array.isArray(saved) ? saved : [];
    } catch { return []; }
  }
  function saveJobs(jobs) {
    try { localStorage.setItem(JOBS_KEY, JSON.stringify(jobs)); } catch { /* ignore */ }
  }
  let userJobs = loadJobs();

  // ---------- helpers ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initials = (name) => name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const hue = (id) => (Number(String(id).replace(/\D/g, '') || 1) * 47) % 360;
  const stars = (r) => '★'.repeat(Math.round(r)) + '☆'.repeat(5 - Math.round(r));
  const money = (n) => '$' + Number(n).toLocaleString('en-US');

  function timeAgo(ts) {
    const mins = Math.round((Date.now() - ts) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  }

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
  }

  function fillTradeSelect(select, firstLabel) {
    select.innerHTML = (firstLabel != null ? `<option value="">${esc(firstLabel)}</option>` : '') +
      TRADES.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  }

  // ---------- contractors ----------
  const filters = { trade: $('#filter-trade'), rating: $('#filter-rating'), sort: $('#filter-sort'), text: $('#filter-text') };

  function renderContractors() {
    const trade = filters.trade.value;
    const minRating = Number(filters.rating.value);
    const q = filters.text.value.trim().toLowerCase();

    let list = CONTRACTORS.filter((c) =>
      (!trade || c.trade === trade) &&
      c.rating >= minRating &&
      (!q || [c.name, c.company, c.city, c.trade, ...c.tags].join(' ').toLowerCase().includes(q))
    );

    const sorters = {
      rating: (a, b) => b.rating - a.rating || b.reviews - a.reviews,
      reviews: (a, b) => b.reviews - a.reviews,
      'rate-asc': (a, b) => a.rate - b.rate,
    };
    list.sort(sorters[filters.sort.value]);

    $('#result-count').textContent = `${list.length} contractor${list.length === 1 ? '' : 's'}`;
    $('#contractor-list').innerHTML = list.length ? list.map((c) => `
      <article class="card">
        <div class="card-top">
          <div class="avatar" style="--hue:${hue(c.id)}">${esc(initials(c.name))}</div>
          <div>
            <h3>${esc(c.company)}</h3>
            <p>${esc(c.name)} · ${esc(c.trade)}</p>
          </div>
        </div>
        <div class="card-meta">
          <span><span class="stars" aria-hidden="true">${stars(c.rating)}</span> <strong>${c.rating.toFixed(1)}</strong> (${c.reviews})</span>
          <span>${esc(c.city)}</span>
          <span><strong>${money(c.rate)}</strong>/hr</span>
        </div>
        <div class="tags">${c.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
        <button class="btn btn-ghost" data-pro="${c.id}">View profile &amp; request quote</button>
      </article>`).join('')
      : '<p class="empty">No contractors match those filters. Try widening your search.</p>';
  }

  Object.values(filters).forEach((el) => el.addEventListener('input', renderContractors));

  // ---------- contractor dialog ----------
  const dialog = $('#pro-dialog');
  let activePro = null;

  $('#contractor-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pro]');
    if (!btn) return;
    activePro = CONTRACTORS.find((c) => c.id === Number(btn.dataset.pro));
    if (!activePro) return;
    const c = activePro;
    $('#pro-detail').innerHTML = `
      <div class="pro-head">
        <div class="avatar avatar-lg" style="--hue:${hue(c.id)}">${esc(initials(c.name))}</div>
        <div>
          <h2 id="pro-name">${esc(c.company)}</h2>
          <p>${esc(c.name)} · ${esc(c.city)}</p>
        </div>
      </div>
      <p>${esc(c.bio)}</p>
      <div class="card-meta">
        <span><span class="stars" aria-hidden="true">${stars(c.rating)}</span> <strong>${c.rating.toFixed(1)}</strong> from ${c.reviews} reviews</span>
        <span><strong>${c.years}</strong> years in business</span>
        <span><strong>${money(c.rate)}</strong>/hr</span>
        <span class="pill ${c.licensed ? 'pill-ok' : ''}">${c.licensed ? 'Licensed & insured' : 'Insured'}</span>
      </div>
      <div class="tags" style="margin:12px 0 16px">${c.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>`;
    $('#quote-form').reset();
    dialog.showModal();
  });

  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

  $('#quote-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    if (!form.reportValidity()) return;
    dialog.close();
    toast(`Quote request sent to ${activePro.company}. Expect a reply within 24 hours.`);
  });

  // ---------- jobs ----------
  function renderJobs() {
    const jobs = [...userJobs, ...SEED_JOBS].sort((a, b) => b.posted - a.posted);
    $('#stat-jobs').textContent = jobs.length;
    $('#job-list').innerHTML = jobs.map((j) => `
      <article class="job">
        <div>
          <h3>${esc(j.title)}</h3>
          <p>${esc(j.description)}</p>
          <div class="job-meta">
            <span class="pill">${esc(j.trade)}</span>
            <span>ZIP ${esc(j.zip)}</span>
            <span>Posted ${timeAgo(j.posted)}</span>
          </div>
        </div>
        <div class="job-side">
          <span class="job-budget">${money(j.budget)}</span>
          <button class="btn btn-small" data-quote-job="${esc(j.id)}">Send quote</button>
        </div>
      </article>`).join('');
  }

  $('#job-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-quote-job]');
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = 'Quote sent';
    toast('Your quote was sent to the buyer.');
  });

  $('#job-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const err = $('#job-error');
    const data = Object.fromEntries(new FormData(form));
    const problems = [];
    if (!data.title.trim()) problems.push('a title');
    if (!data.trade) problems.push('a trade');
    if (!(Number(data.budget) >= 50)) problems.push('a budget of at least $50');
    if (!/^\d{5}$/.test(data.zip)) problems.push('a 5-digit ZIP code');
    if (!data.description.trim()) problems.push('a description');
    if (problems.length) {
      err.textContent = `Please add ${problems.join(', ')}.`;
      return;
    }
    err.textContent = '';
    userJobs.unshift({
      id: 'u' + Date.now(),
      title: data.title.trim(),
      trade: data.trade,
      budget: Number(data.budget),
      zip: data.zip,
      description: data.description.trim(),
      posted: Date.now(),
    });
    saveJobs(userJobs);
    form.reset();
    renderJobs();
    toast('Your job is live on the board.');
    $('#jobs').scrollIntoView();
  });

  // ---------- hero search ----------
  $('#hero-search').addEventListener('submit', (e) => {
    e.preventDefault();
    filters.trade.value = $('#hero-trade').value;
    filters.text.value = '';
    renderContractors();
    $('#contractors').scrollIntoView();
  });

  // ---------- nav ----------
  const toggle = $('.nav-toggle');
  const links = $('#nav-links');
  toggle.addEventListener('click', () => {
    const open = links.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  links.addEventListener('click', (e) => {
    if (e.target.closest('a')) { links.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); }
  });

  // ---------- init ----------
  fillTradeSelect($('#hero-trade'), 'All trades');
  fillTradeSelect(filters.trade, 'All trades');
  fillTradeSelect($('#job-trade'), 'Choose a trade');
  $('#stat-pros').textContent = CONTRACTORS.length;
  $('#year').textContent = new Date().getFullYear();
  renderContractors();
  renderJobs();
})();
