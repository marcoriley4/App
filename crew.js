'use strict';
/* Crew upload page: opened from the link in the job text. No login; shows no prices. */
(function () {
  const { api, TRADES, PHOTO_STAGES, el, fmtWhen, find } = TH;
  const view = document.getElementById('view');
  const token = new URLSearchParams(location.search).get('t') || '';
  let stage = 'before';
  let urls = [];

  if (api.mode === 'preview') document.getElementById('previewBanner').hidden = false;

  async function render(message) {
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
    const t = find(TRADES, job.trade) || TRADES.at(-1);
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
      if (done) render(`✓ ${done} ${done === 1 ? 'file' : 'files'} sent to the Top Hat office.`);
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
          el('dt', {}, 'Address'), el('dd', {}, el('a', { href: 'https://maps.google.com/?q=' + encodeURIComponent(`${job.address} ${job.zip}`), target: '_blank', rel: 'noopener' }, `${job.address} ${job.zip}`)),
          job.scheduledFor ? el('dt', {}, 'When') : null, job.scheduledFor ? el('dd', {}, fmtWhen(job.scheduledFor)) : null,
          el('dt', {}, 'Customer'), el('dd', {}, job.customerName, job.customerPhone ? ' · ' : '', job.customerPhone ? el('a', { href: 'tel:' + job.customerPhone.replace(/[^\d+]/g, '') }, job.customerPhone) : ''),
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

  render();
})();
