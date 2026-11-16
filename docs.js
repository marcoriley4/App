'use strict';
/*
 * Estimates & invoices: totals, statuses, and the printable document.
 * Shared by the staff area and the customer site. Crew pay never appears here.
 */
(function () {
  const { el } = TH;

  const METHODS = ['Cash', 'Check', 'Zelle', 'Bank transfer (ACH)', 'Card', 'Venmo', 'Cash App', 'Other'];
  const LABELS = {
    draft: 'Draft', sent: 'Sent', approved: 'Approved', declined: 'Declined',
    paid: 'Paid', partial: 'Partly paid', overdue: 'Overdue', void: 'Void',
  };

  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const usd = (n) => (n < 0 ? '−$' : '$') + Math.abs(round2(n)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const todayKey = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 10); };
  const fmtDate = (v) => (v ? new Date(typeof v === 'string' && v.length === 10 ? v + 'T12:00' : v).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');

  function totals(doc) {
    const subtotal = round2((doc.items || []).reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.price) || 0), 0));
    const tax = round2(subtotal * (Number(doc.taxRate) || 0) / 100);
    const total = round2(subtotal + tax);
    const paid = round2((doc.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0));
    return { subtotal, tax, total, paid, balance: round2(total - paid) };
  }

  // What to show: invoices work out paid / partly paid / overdue from their payments.
  function state(doc) {
    if (doc.type === 'estimate' || doc.status === 'void' || doc.status === 'draft') return doc.status;
    const t = totals(doc);
    if (t.total > 0 && t.balance <= 0) return 'paid';
    if (doc.dueDate && doc.dueDate < todayKey()) return 'overdue';
    if (t.paid > 0) return 'partial';
    return 'sent';
  }
  const label = (doc) => LABELS[state(doc)] || doc.status;
  const pillClass = (doc) => ({
    draft: 's-lost', sent: 's-qualifying', approved: 's-completed', declined: 's-lost',
    paid: 's-completed', partial: 's-scheduled', overdue: 's-new', void: 's-lost',
  })[state(doc)] || '';
  // Payment schedule: when each payment is due during the job. Set in Business; amounts come from the job total.
  const WHEN = [
    { id: 'sold', label: 'When the job is sold', short: 'Job sold' },
    { id: 'start', label: 'When work starts', short: 'Work starts' },
    { id: 'mid', label: 'Halfway through the job', short: 'Halfway' },
    { id: 'done', label: 'When the job is finished', short: 'Job finished' },
  ];
  const DEFAULT_SCHEDULE = [
    { label: 'Deposit', pct: 50, when: 'sold' },
    { label: 'Progress payment', pct: 25, when: 'start' },
    { label: 'Final payment', pct: 25, when: 'done' },
  ];
  // Crew pay schedule: how a contractor's pay on a job is split; they bill Top Hat as they reach each step.
  const CREW_WHEN = [
    { id: 'start', label: 'When work starts', short: 'Work starts' },
    { id: 'mid', label: 'Halfway through the job', short: 'Halfway' },
    { id: 'done', label: 'When the job is finished', short: 'Job finished' },
  ];
  const DEFAULT_CREW_SCHEDULE = [
    { label: 'Work started', pct: 30, when: 'start' },
    { label: 'Halfway done', pct: 30, when: 'mid' },
    { label: 'Job finished', pct: 40, when: 'done' },
  ];
  const crewScheduleOf = (company) => (Array.isArray(company?.crewPaySchedule) && company.crewPaySchedule.length ? company.crewPaySchedule : DEFAULT_CREW_SCHEDULE);
  // Each crew payment: amount from the crew pay, and whether the job has reached it.
  // Halfway counts once the contractor taps "I'm halfway done" (or the job is finished).
  function crewSchedule(company, crewPay, status, halfway) {
    const steps = crewScheduleOf(company);
    const reached = { start: ['in_progress', 'completed'], mid: halfway ? ['in_progress', 'completed'] : ['completed'], done: ['completed'] };
    let left = round2(crewPay);
    return steps.map((s, i) => {
      const amount = i === steps.length - 1 ? left : round2(crewPay * (Number(s.pct) || 0) / 100);
      left = round2(left - amount);
      return { ...s, index: i, amount, whenLabel: (CREW_WHEN.find((w) => w.id === s.when) || CREW_WHEN[2]).label, reached: (reached[s.when] || reached.done).includes(status) };
    });
  }
  const scheduleOf = (company) => (Array.isArray(company?.paymentSchedule) && company.paymentSchedule.length ? company.paymentSchedule : DEFAULT_SCHEDULE);
  // Each payment's dollar amount. The last one takes whatever is left, so it always adds up to the total.
  function schedule(company, total) {
    const steps = scheduleOf(company);
    let left = round2(total);
    return steps.map((s, i) => {
      const amount = i === steps.length - 1 ? left : round2(total * (Number(s.pct) || 0) / 100);
      left = round2(left - amount);
      return { ...s, index: i, amount, whenLabel: (WHEN.find((w) => w.id === s.when) || WHEN[3]).label };
    });
  }
  const editable = (doc) => doc.status === 'draft' || (doc.status === 'sent' && totals(doc).paid === 0);
  // Unpaid balance on an invoice the customer has been sent.
  const owed = (doc) => (doc.type === 'invoice' && !['draft', 'void'].includes(doc.status) ? Math.max(0, totals(doc).balance) : 0);

  /* ---------- the document ---------- */
  function render(doc, { job, customer = {}, company = {} }) {
    const t = totals(doc);
    const isInv = doc.type === 'invoice';
    const st = state(doc);
    const stamp = { approved: 'APPROVED', paid: 'PAID', void: 'VOID', declined: 'DECLINED' }[st];
    const lines = (s) => String(s || '').split('\n').filter((x) => x.trim()).map((x) => el('div', {}, x));

    return el('article', { class: 'doc-sheet' },
      stamp ? el('div', { class: `doc-stamp st-${st}` }, stamp) : null,
      el('header', { class: 'doc-head' },
        el('div', { class: 'doc-co' },
          el('img', { class: 'doc-logo-img', src: 'img/logo.jpg', alt: company.name || 'Top Hat Contracting' }),
          el('div', { class: 'doc-logo' }, el('b', {}, company.name || 'Top Hat Contracting')),
          ...lines([company.address, company.phone, company.email, company.license ? `License #${company.license}` : ''].filter(Boolean).join('\n'))),
        el('div', { class: 'doc-title' },
          el('h1', {}, isInv ? 'Invoice' : 'Estimate'),
          el('dl', {},
            el('dt', {}, isInv ? 'Invoice #' : 'Estimate #'), el('dd', {}, doc.number),
            el('dt', {}, 'Date'), el('dd', {}, fmtDate(doc.sentAt || doc.created)),
            isInv && doc.dueDate ? el('dt', {}, 'Due') : null, isInv && doc.dueDate ? el('dd', {}, fmtDate(doc.dueDate)) : null,
            el('dt', {}, 'Job'), el('dd', {}, `TH-${job.number}`)))),
      el('section', { class: 'doc-parties' },
        el('div', {}, el('h4', {}, isInv ? 'Bill to' : 'Prepared for'),
          el('div', {}, customer.name || ''), ...lines([customer.phone, customer.email].filter(Boolean).join('\n'))),
        el('div', {}, el('h4', {}, 'Job site'), ...lines(TH.addrLine ? TH.addrLine(job) : `${job.address || ''} ${job.zip || ''}`))),
      el('table', { class: 'doc-items' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Description'), el('th', { class: 'num' }, 'Qty'), el('th', { class: 'num' }, 'Price'), el('th', { class: 'num' }, 'Amount'))),
        el('tbody', {}, ...(doc.items || []).filter((i) => i.desc || Number(i.price)).map((i) => el('tr', {},
          el('td', { style: 'white-space:pre-wrap' }, i.desc), el('td', { class: 'num' }, String(Number(i.qty) || 0)),
          el('td', { class: 'num' }, usd(i.price)), el('td', { class: 'num' }, usd((Number(i.qty) || 0) * (Number(i.price) || 0))))))),
      el('div', { class: 'doc-totals' },
        el('dl', {},
          el('dt', {}, 'Subtotal'), el('dd', {}, usd(t.subtotal)),
          Number(doc.taxRate) ? el('dt', {}, `Tax (${Number(doc.taxRate)}%)`) : null, Number(doc.taxRate) ? el('dd', {}, usd(t.tax)) : null,
          el('dt', { class: 'big' }, 'Total'), el('dd', { class: 'big' }, usd(t.total)),
          isInv && t.paid ? el('dt', {}, 'Paid') : null, isInv && t.paid ? el('dd', {}, '−' + usd(t.paid)) : null,
          isInv ? el('dt', { class: 'big' }, 'Balance due') : null, isInv ? el('dd', { class: 'big' }, usd(Math.max(0, t.balance))) : null)),
      doc.notes ? el('section', { class: 'doc-notes' }, el('h4', {}, isInv ? 'Notes' : 'Terms'), ...lines(doc.notes)) : null,
      // The payment schedule: on estimates, and on each invoice that is one of its payments.
      (() => {
        const base = isInv ? Number(doc.scheduleBase) || 0 : t.total;
        if (!base || st === 'declined' || st === 'void' || (isInv && doc.scheduleStep == null)) return null;
        const plan = schedule(company, base);
        return el('section', { class: 'doc-notes doc-schedule' },
          el('h4', {}, isInv ? `Payment ${doc.scheduleStep + 1} of ${plan.length}` : 'Payment schedule'),
          el('table', {}, el('tbody', {}, ...plan.map((p) => el('tr', { class: isInv && p.index === doc.scheduleStep ? 'this' : '' },
            el('td', {}, `${p.index + 1}. ${p.label} (${Number(p.pct)}%)`), el('td', {}, p.whenLabel), el('td', { class: 'num' }, usd(p.amount)),
            isInv ? el('td', { class: 'num' }, p.index === doc.scheduleStep ? '← this invoice' : '') : null)))),
          isInv ? el('div', { class: 'muted' }, `Job total ${usd(base)}`) : null);
      })(),
      // Payment terms & how to pay: on every estimate and invoice (not once an invoice is paid or void).
      // Estimates print only the estimate text (e.g. Zelle); bank/ACH details stay on invoices.
      st !== 'void' && st !== 'paid' && (isInv ? company.paymentInstructions : company.estimatePaymentInstructions)
        ? el('section', { class: 'doc-notes' }, el('h4', {}, 'Payment terms & how to pay'), ...lines(isInv ? company.paymentInstructions : company.estimatePaymentInstructions),
          isInv && doc.payLink ? el('div', {}, 'Pay by card: ', el('a', { href: doc.payLink, target: '_blank', rel: 'noopener' }, 'secure payment link')) : null)
        : null,
      // Invoices: the customer's signature when they paid (newest), or lines to sign on paper.
      isInv && st !== 'void' ? (() => {
        const signed = (doc.reports || []).filter((r) => r.signature?.image && r.status !== 'not_received').at(-1);
        return signed ? el('section', { class: 'doc-notes doc-signed' }, el('h4', {}, 'Customer signature'),
          el('img', { class: 'doc-sig', src: signed.signature.image, alt: `Signature of ${signed.signature.name}` }),
          el('div', {}, el('b', {}, signed.signature.name), ` · ${new Date(signed.signature.at || signed.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`),
          el('div', { class: 'muted' }, `Authorized a payment of ${usd(signed.amount)} by ${signed.method} in the Top Hat app`))
          : el('section', { class: 'doc-notes' }, el('h4', {}, 'Customer signature'),
            el('div', {}, `I authorize payment of this invoice (${usd(Math.max(0, t.balance))} due) and agree to the payment terms above.`),
            el('div', { class: 'sign-lines' }, el('div', {}, 'Signature'), el('div', {}, 'Printed name'), el('div', {}, 'Date')));
      })() : null,
      !isInv && doc.signature?.image ? el('section', { class: 'doc-notes doc-signed' }, el('h4', {}, 'Approved and signed'),
        el('img', { class: 'doc-sig', src: doc.signature.image, alt: `Signature of ${doc.signature.name}` }),
        el('div', {}, el('b', {}, doc.signature.name), ` · ${new Date(doc.signature.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`),
        el('div', { class: 'muted' }, doc.signature.inPerson ? `Signed in person with ${doc.signature.witness || 'Top Hat'}` : 'Signed in the Top Hat app'))
        : !isInv && st === 'sent' ? el('section', { class: 'doc-notes' }, el('h4', {}, 'Approval'),
          el('div', {}, `I approve this estimate (${usd(t.total)}) and the payment schedule above.`),
          el('div', { class: 'sign-lines' }, el('div', {}, 'Signature'), el('div', {}, 'Printed name'), el('div', {}, 'Date'))) : null,
      isInv && (doc.payments || []).length ? el('section', { class: 'doc-notes' }, el('h4', {}, 'Payments received'),
        ...doc.payments.map((p) => el('div', {}, `${fmtDate(p.date)} · ${p.method} · ${usd(p.amount)}`))) : null,
      el('footer', { class: 'doc-foot' }, `${company.name || 'Top Hat Contracting'} · Thank you for your business`),
    );
  }

  /* ---------- full-screen viewer with Print / Save as PDF ---------- */
  function view(doc, ctx, actions = []) {
    const close = () => { overlay.remove(); document.body.classList.remove('doc-open'); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const overlay = el('div', { class: 'doc-viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': `${doc.type === 'invoice' ? 'Invoice' : 'Estimate'} ${doc.number}` },
      el('div', { class: 'doc-toolbar' },
        el('button', { class: 'ghost small', onclick: close }, '← Close'),
        el('span', { class: 'spacer' }),
        el('button', { class: 'ghost small', onclick: () => window.print() }, '🖨 Print / Save PDF')),
      el('div', { class: 'doc-scroll' }, render(doc, ctx),
        actions.length ? el('div', { class: 'doc-actions' }, ...actions.map((a) => (typeof a === 'function' ? a(close) : a))) : null),
    );
    document.body.append(overlay);
    document.body.classList.add('doc-open');
    document.addEventListener('keydown', onKey);
    return close;
  }

  // Sign with a finger (or mouse). onSign gets { name, image } where image is a PNG data URL.
  function signaturePad({ total, name = '', submitLabel = 'Sign & approve', agree, title = 'Sign to approve', onSign, onCancel }) {
    const canvas = el('canvas', { class: 'sig-canvas', 'aria-label': 'Sign here with your finger' });
    const nameIn = el('input', { value: name, autocomplete: 'name', placeholder: 'Type your full name', 'aria-label': 'Your full name' });
    const err = el('div', { class: 'error', hidden: true, role: 'alert' });
    let drawn = false, drawing = false, last = null, ctx = null;
    const setup = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(r.width * dpr)); canvas.height = Math.max(1, Math.round(r.height * dpr));
      ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, r.width, r.height);
    };
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    canvas.addEventListener('pointerdown', (e) => { err.hidden = true; if (!ctx || canvas.width !== Math.round(canvas.getBoundingClientRect().width * (window.devicePixelRatio || 1))) setup(); drawing = true; last = pos(e); canvas.setPointerCapture(e.pointerId); e.preventDefault(); });
    canvas.addEventListener('pointermove', (e) => {
      if (!drawing) return; const p = pos(e);
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; drawn = true; e.preventDefault();
    });
    const stop = () => { drawing = false; };
    canvas.addEventListener('pointerup', stop); canvas.addEventListener('pointercancel', stop);
    const box = el('div', { class: 'sig-box stack' },
      el('b', {}, title),
      agree ? el('p', { class: 'small' }, agree) : total != null ? el('p', { class: 'small' }, `By signing, you approve this estimate for ${usd(total)} and its payment schedule.`) : null,
      el('div', { class: 'sig-wrap' }, canvas, el('span', { class: 'sig-x', 'aria-hidden': 'true' }, '✕'), el('span', { class: 'sig-hint', 'aria-hidden': 'true' }, 'Sign here')),
      el('button', { type: 'button', class: 'link small', onclick: () => { if (ctx) setup(); drawn = false; } }, 'Clear signature'),
      nameIn, err,
      el('button', { type: 'button', class: 'gold block big', onclick: async (e) => {
        if (!drawn) { err.textContent = 'Sign in the box with your finger.'; err.hidden = false; return; }
        if (nameIn.value.trim().length < 3) { err.textContent = 'Type your full name.'; err.hidden = false; return; }
        // Keep it small: a 600px-wide PNG is plenty for a signature.
        const out = document.createElement('canvas'); const w = 600; out.width = w; out.height = Math.round(w * canvas.height / canvas.width);
        const oc = out.getContext('2d'); oc.fillStyle = '#fff'; oc.fillRect(0, 0, out.width, out.height); oc.drawImage(canvas, 0, 0, out.width, out.height);
        e.currentTarget.disabled = true;
        try { await onSign({ name: nameIn.value.trim(), image: out.toDataURL('image/png') }); }
        catch (ex) { err.textContent = ex.message; err.hidden = false; e.currentTarget.disabled = false; }
      } }, `✍️ ${submitLabel}`),
      onCancel ? el('button', { type: 'button', class: 'ghost block', onclick: onCancel }, 'Cancel') : null);
    return box;
  }

  // Any printable sheet (e.g. the permit packet) in the same viewer.
  function viewSheet(sheet, label) {
    const close = () => { overlay.remove(); document.body.classList.remove('doc-open'); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const overlay = el('div', { class: 'doc-viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': label },
      el('div', { class: 'doc-toolbar' }, el('button', { class: 'ghost small', onclick: close }, '← Close'), el('span', { class: 'spacer' }),
        el('button', { class: 'ghost small', onclick: () => window.print() }, '🖨 Print / Save PDF')),
      el('div', { class: 'doc-scroll' }, sheet));
    document.body.append(overlay); document.body.classList.add('doc-open'); document.addEventListener('keydown', onKey);
    return close;
  }

  TH.docs = { CREW_WHEN, DEFAULT_CREW_SCHEDULE, crewScheduleOf, crewSchedule, signaturePad, viewSheet, METHODS, LABELS, WHEN, DEFAULT_SCHEDULE, scheduleOf, schedule, totals, state, label, pillClass, editable, owed, usd, fmtDate, todayKey, render, view, round2 };
})();
