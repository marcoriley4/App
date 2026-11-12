'use strict';

/* ---------- Storage ---------- */
const KEY = 'lifedash.v1';
const UI_KEY = 'lifedash.tab';
const DEFAULTS = () => ({
  name: '',
  currency: '$',
  theme: null,
  focus: { date: '', text: '' },
  tasks: [],
  habits: [
    { id: uid(), name: 'Drink water first thing', days: {} },
    { id: uid(), name: 'Move for 20 minutes', days: {} },
    { id: uid(), name: 'Read 10 pages', days: {} },
  ],
  well: {},
  goals: [],
  budget: 2000,
  expenses: [],
  journal: {},
});

function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS(), ...JSON.parse(raw) };
  } catch (e) { /* storage unavailable or corrupt */ }
  return DEFAULTS();
}
let state = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}

/* ---------- Helpers ---------- */
const $ = (s) => document.querySelector(s);
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k in n && typeof v !== 'string') n[k] = v;
    else n.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) n.append(c);
  return n;
}
function dkey(d = new Date()) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function daysAgo(n) { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return d; }
function parseKey(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d, 12); }
function money(n) {
  const v = Math.round(n * 100) / 100;
  return state.currency + v.toLocaleString(undefined, { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
}
function buzz() { try { navigator.vibrate && navigator.vibrate(8); } catch (e) { /* unsupported */ } }
const today = () => dkey();
const monthKey = () => today().slice(0, 7);

/* ---------- Tabs ---------- */
const TITLES = { habits: 'Habits', health: 'Health', money: 'Money', journal: 'Journal' };
let tab = 'today';
try { tab = localStorage.getItem(UI_KEY) || 'today'; } catch (e) { /* ignore */ }
if (!document.querySelector(`[data-view="${tab}"]`)) tab = 'today';
function showTab(t) {
  tab = t;
  try { localStorage.setItem(UI_KEY, t); } catch (e) { /* ignore */ }
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.dataset.view !== t; });
  document.querySelectorAll('.tabs button').forEach((b) => {
    if (b.dataset.tab === t) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  renderHeader();
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

/* ---------- Header ---------- */
function renderHeader() {
  const h = new Date().getHours();
  const part = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  $('#title').textContent = tab === 'today' ? (state.name ? `${part}, ${state.name}` : part) : TITLES[tab];
  $('#today').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const f = $('#focusInput');
  if (document.activeElement !== f) f.value = state.focus.date === today() ? state.focus.text : '';
}
$('#focusInput').addEventListener('input', (e) => {
  state.focus = { date: today(), text: e.target.value };
  save();
});
$('#focusInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });

/* ---------- Stats ---------- */
function streak(habit) {
  let n = 0;
  let i = habit.days[today()] ? 0 : 1; // not done yet today doesn't break the streak
  while (habit.days[dkey(daysAgo(i))]) { n++; i++; }
  return n;
}
function renderStats() {
  const done = state.tasks.filter((t) => t.done).length;
  const habitsToday = state.habits.filter((h) => h.days[today()]).length;
  const best = state.habits.reduce((m, h) => Math.max(m, streak(h)), 0);
  const items = [
    [`${done}/${state.tasks.length}`, 'tasks done', 'today'],
    [`${habitsToday}/${state.habits.length}`, 'habits today', 'habits'],
    [`${best} ${best === 1 ? 'day' : 'days'}`, 'best streak', 'habits'],
    [money(monthSpent()), 'spent this month', 'money'],
  ];
  $('#stats').replaceChildren(...items.map(([v, k, t]) => el('div', {
    class: 'stat', role: t === 'today' ? null : 'button', onclick: t === 'today' ? null : () => showTab(t),
  }, el('div', { class: 'v' }, v), el('div', { class: 'k' }, k))));
}

/* ---------- Tasks ---------- */
function renderTasks() {
  const list = $('#taskList');
  const open = state.tasks.filter((t) => !t.done).length;
  $('#taskCount').textContent = open ? `${open} open` : 'all clear';
  $('#clearDone').hidden = !state.tasks.some((t) => t.done);
  if (!state.tasks.length) { list.replaceChildren(el('li', { class: 'empty' }, 'Nothing yet. Add your first task.')); return; }
  const sorted = [...state.tasks].sort((a, b) => a.done - b.done);
  list.replaceChildren(...sorted.map((t) => el('li', { class: t.done ? 'done' : '' },
    el('input', { type: 'checkbox', checked: t.done, 'aria-label': 'Done', onchange: () => { t.done = !t.done; buzz(); commit(); } }),
    el('span', { class: 'grow', onclick: () => { t.done = !t.done; buzz(); commit(); } }, t.text),
    el('button', { class: 'icon', 'aria-label': 'Delete task', onclick: () => { state.tasks = state.tasks.filter((x) => x !== t); commit(); } }, '✕'),
  )));
}
$('#taskForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('#taskInput').value.trim();
  if (!v) return;
  state.tasks.push({ id: uid(), text: v, done: false, created: Date.now() });
  $('#taskInput').value = '';
  commit();
});
$('#clearDone').addEventListener('click', () => { state.tasks = state.tasks.filter((t) => !t.done); commit(); });

/* ---------- Habits ---------- */
function renderHabits() {
  const grid = $('#habitGrid');
  const days = [6, 5, 4, 3, 2, 1, 0].map(daysAgo);
  const done = state.habits.filter((h) => h.days[today()]).length;
  $('#habitCount').textContent = `${done}/${state.habits.length} today`;
  if (!state.habits.length) { grid.replaceChildren(el('div', { class: 'empty', style: 'grid-column:1/-1' }, 'Add a habit to start tracking.')); return; }
  const head = [...days.map((d, i) => el('span', { class: 'hd' + (i === 6 ? ' today' : '') },
    d.toLocaleDateString(undefined, { weekday: 'narrow' }), el('br'), String(d.getDate()))), el('span', { class: 'hd' }, '🔥')];
  const rows = state.habits.flatMap((h) => [
    el('div', { class: 'name' },
      el('span', {}, h.name),
      el('button', { class: 'icon', 'aria-label': `Remove habit ${h.name}`, onclick: () => {
        if (confirm(`Remove habit "${h.name}"?`)) { state.habits = state.habits.filter((x) => x !== h); commit(); }
      } }, '✕')),
    ...days.map((d) => {
      const k = dkey(d);
      return el('button', { class: 'dot' + (h.days[k] ? ' on' : ''), 'aria-label': `${h.name} on ${k}`, 'aria-pressed': String(!!h.days[k]),
        onclick: () => { if (h.days[k]) delete h.days[k]; else h.days[k] = true; buzz(); commit(); } });
    }),
    el('span', { class: 'streak' }, String(streak(h))),
  ]);
  grid.replaceChildren(...head, ...rows);
}
$('#habitForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('#habitInput').value.trim();
  if (!v) return;
  state.habits.push({ id: uid(), name: v, days: {} });
  $('#habitInput').value = '';
  commit();
});

/* ---------- Health ---------- */
const MOODS = ['😞', '😕', '😐', '🙂', '😄'];
function wellToday() { return (state.well[today()] ||= { mood: 0, water: 0, sleep: 0, exercise: 0 }); }
function renderWell() {
  const w = state.well[today()] || { mood: 0, water: 0, sleep: 0, exercise: 0 };
  $('#moodPick').replaceChildren(...MOODS.map((m, i) => el('button', {
    class: w.mood === i + 1 ? 'sel' : '', 'aria-label': `Mood ${i + 1} of 5`,
    onclick: () => { const t = wellToday(); t.mood = t.mood === i + 1 ? 0 : i + 1; buzz(); commit(); },
  }, el('span', {}, m))));
  $('#waterVal').textContent = w.water;
  $('#sleepVal').textContent = w.sleep;
  $('#exerciseVal').textContent = w.exercise;
  renderMoodChart();
}
document.querySelectorAll('.ctl button[data-k]').forEach((b) => b.addEventListener('click', () => {
  const t = wellToday();
  t[b.dataset.k] = Math.max(0, Math.round((t[b.dataset.k] + Number(b.dataset.d)) * 10) / 10);
  commit();
}));
function renderMoodChart() {
  const W = 320, H = 110, P = 14;
  const pts = [];
  for (let i = 13; i >= 0; i--) {
    const m = state.well[dkey(daysAgo(i))]?.mood || 0;
    pts.push({ x: P + ((13 - i) * (W - 2 * P)) / 13, m, label: daysAgo(i).getDate() });
  }
  const y = (m) => H - 20 - ((m - 1) / 4) * (H - 34);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const add = (tag, attrs, text) => { const n = document.createElementNS(ns, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); if (text != null) n.textContent = text; svg.append(n); return n; };
  add('line', { x1: P, x2: W - P, y1: H - 14, y2: H - 14, class: 'axis' });
  let d = '';
  pts.forEach((p, i) => { if (p.m) d += (i > 0 && pts[i - 1].m ? 'L' : 'M') + p.x.toFixed(1) + ' ' + y(p.m).toFixed(1); });
  if (d) add('path', { d, class: 'line' });
  pts.forEach((p, i) => {
    if (p.m) add('circle', { cx: p.x, cy: y(p.m), r: 3.5, class: 'pt' });
    if (i % 2 === 1) add('text', { x: p.x, y: H - 2, 'text-anchor': 'middle' }, p.label);
  });
  const logged = pts.filter((p) => p.m);
  const wrap = $('#moodChart');
  wrap.replaceChildren(svg);
  if (!logged.length) wrap.append(el('div', { class: 'empty' }, 'Pick a mood each day to see your trend.'));
  else {
    const avg = logged.reduce((s, p) => s + p.m, 0) / logged.length;
    wrap.append(el('div', { class: 'muted small' }, `Average ${avg.toFixed(1)}/5 over ${logged.length} logged ${logged.length === 1 ? 'day' : 'days'}`));
  }
}

/* ---------- Goals ---------- */
function renderGoals() {
  const list = $('#goalList');
  if (!state.goals.length) { list.replaceChildren(el('li', { class: 'empty' }, 'Set a goal with a number you can count toward.')); return; }
  list.replaceChildren(...state.goals.map((g) => {
    const pct = Math.min(100, (g.current / g.target) * 100);
    const step = g.target >= 50 ? Math.max(1, Math.round(g.target / 20)) : 1;
    const bump = (d) => { g.current = Math.max(0, Math.round((g.current + d) * 100) / 100); buzz(); commit(); };
    return el('li', {},
      el('div', { class: 'goal-top' },
        el('span', { class: 'grow' }, g.name),
        el('span', { class: 'nums' }, `${g.current} / ${g.target}${g.unit ? ' ' + g.unit : ''}`)),
      el('div', { class: 'bar' }, el('div', { class: pct >= 100 ? 'good' : '', style: `width:${pct}%` })),
      el('div', { class: 'goal-top' },
        el('div', { class: 'ctl' },
          el('button', { class: 'ghost', 'aria-label': 'Decrease', onclick: () => bump(-step) }, '−'),
          el('button', { class: 'ghost', 'aria-label': 'Increase', onclick: () => bump(step) }, '+')),
        el('span', { class: 'grow' }),
        el('button', { class: 'link', onclick: () => { if (confirm(`Delete goal "${g.name}"?`)) { state.goals = state.goals.filter((x) => x !== g); commit(); } } }, 'Delete')),
    );
  }));
}
$('#goalForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#goalName').value.trim();
  const target = Number($('#goalTarget').value);
  if (!name || !(target > 0)) return;
  state.goals.push({ id: uid(), name, target, current: 0, unit: $('#goalUnit').value.trim() });
  e.target.reset();
  commit();
});

/* ---------- Money ---------- */
function monthExpenses() { return state.expenses.filter((x) => x.date.startsWith(monthKey())); }
function monthSpent() { return monthExpenses().reduce((s, x) => s + x.amount, 0); }
function renderMoney() {
  $('#monthName').textContent = new Date().toLocaleDateString(undefined, { month: 'long' });
  const bi = $('#budgetInput');
  if (document.activeElement !== bi) bi.value = state.budget || '';
  const spent = monthSpent();
  const budget = state.budget || 0;
  $('#spentVal').textContent = money(spent);
  const left = budget - spent;
  $('#budgetLeft').textContent = budget ? (left >= 0 ? `${money(left)} left of ${money(budget)}` : `${money(-left)} over ${money(budget)}`) : 'no budget set';
  const pct = budget ? Math.min(100, (spent / budget) * 100) : 0;
  // amber if spending is running ahead of how far through the month we are
  const now = new Date();
  const monthPct = (now.getDate() / new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()) * 100;
  const bar = $('#budgetBar');
  bar.style.width = pct + '%';
  bar.className = spent > budget ? 'bad' : pct > monthPct + 10 ? 'warn' : 'good';

  const byCat = {};
  monthExpenses().forEach((x) => { byCat[x.cat] = (byCat[x.cat] || 0) + x.amount; });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const max = cats[0]?.[1] || 1;
  $('#catBreakdown').replaceChildren(...(cats.length ? cats.map(([c, v]) => el('div', { class: 'cat' },
    el('span', {}, c), el('div', { class: 'bar' }, el('div', { style: `width:${(v / max) * 100}%` })), el('span', { class: 'amt' }, money(v))))
    : [el('div', { class: 'empty' }, 'Nothing spent yet this month.')]));

  const exps = monthExpenses().sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created);
  $('#expenseList').replaceChildren(...(exps.length ? exps.map((x) => el('li', {},
    el('span', { class: 'muted small' }, parseKey(x.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })),
    el('span', { class: 'grow' }, x.note || x.cat),
    el('span', {}, money(x.amount)),
    el('button', { class: 'icon', 'aria-label': 'Delete expense', onclick: () => { if (confirm(`Delete ${money(x.amount)} ${x.note || x.cat}?`)) { state.expenses = state.expenses.filter((y) => y !== x); commit(); } } }, '✕'),
  )) : [el('li', { class: 'empty' }, 'No expenses logged this month.')]));
}
$('#budgetInput').addEventListener('change', (e) => { state.budget = Math.max(0, Number(e.target.value) || 0); commit(); });
$('#expenseForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const amount = Number($('#expAmount').value);
  if (!(amount > 0)) return;
  state.expenses.push({ id: uid(), amount, note: $('#expNote').value.trim(), cat: $('#expCat').value, date: today(), created: Date.now() });
  $('#expAmount').value = ''; $('#expNote').value = '';
  document.activeElement?.blur();
  buzz();
  commit();
});

/* ---------- Journal ---------- */
let journalTimer;
function renderJournal() {
  const ta = $('#journalInput');
  if (document.activeElement !== ta) ta.value = state.journal[today()] || '';
  const past = Object.entries(state.journal).filter(([k, v]) => k !== today() && v.trim()).sort((a, b) => b[0].localeCompare(a[0]));
  $('#journalList').replaceChildren(...(past.length ? past.slice(0, 60).map(([k, v]) => el('li', {},
    el('span', { class: 'jd' }, parseKey(k).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })),
    el('span', {}, v),
  )) : [el('li', { class: 'empty' }, 'Past days will appear here.')]));
}
$('#journalInput').addEventListener('input', (e) => {
  state.journal[today()] = e.target.value;
  $('#journalSaved').textContent = 'saving…';
  clearTimeout(journalTimer);
  journalTimer = setTimeout(() => { save(); $('#journalSaved').textContent = 'saved'; }, 400);
});

/* ---------- Theme & settings ---------- */
function applyTheme() {
  if (state.theme) document.documentElement.dataset.theme = state.theme;
  else delete document.documentElement.dataset.theme;
  document.querySelectorAll('#themeSeg button').forEach((b) => b.classList.toggle('sel', b.dataset.theme === (state.theme || '')));
}
document.querySelectorAll('#themeSeg button').forEach((b) => b.addEventListener('click', () => {
  state.theme = b.dataset.theme || null;
  applyTheme(); save();
}));
$('#settingsBtn').addEventListener('click', () => {
  $('#nameInput').value = state.name;
  $('#currencyInput').value = state.currency;
  applyTheme();
  $('#settings').showModal();
});
$('#nameInput').addEventListener('input', (e) => { state.name = e.target.value.trim(); commit(); });
$('#currencyInput').addEventListener('input', (e) => { state.currency = e.target.value || '$'; commit(); });
$('#exportBtn').addEventListener('click', async () => {
  const name = `life-dashboard-${today()}.json`;
  const json = JSON.stringify(state, null, 2);
  // On phones, the share sheet lets you save the backup to Files, Drive, email, etc.
  try {
    const file = new File([json], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Life Dashboard backup' }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  const a = el('a', { href: URL.createObjectURL(new Blob([json], { type: 'application/json' })), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('#importFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (typeof data !== 'object' || !data || !Array.isArray(data.tasks)) throw new Error('bad file');
    if (!confirm('Replace your current data with this backup?')) return;
    state = { ...DEFAULTS(), ...data };
    applyTheme(); commit();
    $('#settings').close();
  } catch { alert('That file is not a valid Life Dashboard backup.'); }
  finally { e.target.value = ''; }
});
$('#resetBtn').addEventListener('click', () => {
  if (!confirm('Delete all your dashboard data? Export a backup first if you want to keep it.')) return;
  state = DEFAULTS();
  applyTheme(); commit();
  $('#settings').close();
});

/* ---------- Render loop ---------- */
function render() {
  renderHeader(); renderStats(); renderTasks(); renderHabits();
  renderWell(); renderGoals(); renderMoney(); renderJournal();
}
function commit() { save(); render(); }

applyTheme();
showTab(tab);
render();

// Roll over to a new day when the app is reopened or left open past midnight.
let lastDay = today();
function refreshIfNewDay() {
  if (today() !== lastDay) { lastDay = today(); render(); } else renderHeader();
}
setInterval(refreshIfNewDay, 60 * 1000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearTimeout(journalTimer); save(); return; }
  refreshIfNewDay();
});

/* ---------- Offline + installable ---------- */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
// Ask the browser not to clear this app's data when the phone is low on space.
try { navigator.storage?.persist?.(); } catch (e) { /* unsupported */ }
