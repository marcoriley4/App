'use strict';
/*
 * Estimates & invoices: totals, statuses, and the printable document.
 * Shared by the staff area and the customer site. Crew pay never appears here.
 */
(function () {
  const { el } = TH;

  const METHODS = ['Cash', 'Check', 'Zelle', 'Card', 'Venmo', 'Cash App', 'Other'];
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
          el('div', { class: 'doc-logo' }, el('span', {}, '🎩'), el('b', {}, company.name || 'Top Hat Contracting')),
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
        el('div', {}, el('h4', {}, 'Job site'), ...lines(`${job.address || ''}${job.zip ? ' ' + job.zip : ''}`))),
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
      isInv && st !== 'void' && st !== 'paid' && company.paymentInstructions
        ? el('section', { class: 'doc-notes' }, el('h4', {}, 'How to pay'), ...lines(company.paymentInstructions), doc.payLink ? el('div', {}, 'Pay by card: ', el('a', { href: doc.payLink, target: '_blank', rel: 'noopener' }, 'secure payment link')) : null)
        : null,
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

  TH.docs = { METHODS, LABELS, totals, state, label, pillClass, editable, owed, usd, fmtDate, todayKey, render, view, round2 };
})();
