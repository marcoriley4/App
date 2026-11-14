'use strict';
/* Salesperson invite: set up a sales login from a one-time link, then go to the office area (own clients only). */
(function () {
  const { api, el } = TH;
  const view = document.getElementById('view');
  const code = new URLSearchParams(location.search).get('invite') || '';
  if (api.mode === 'preview') document.getElementById('previewBanner').hidden = false;

  async function render() {
    const info = await api.team.inviteInfo(code);
    if (!info) {
      view.replaceChildren(el('div', { class: 'card stack login-box', style: 'text-align:center' },
        el('div', { style: 'font-size:2.2rem' }, '🔒'),
        el('h1', {}, 'Invite not active'),
        el('p', { class: 'muted' }, 'This invite was already used or cancelled. If you already set up your login, log in below. Otherwise ask the Top Hat office for a new invite.'),
        el('a', { class: 'btn block', href: 'admin.html' }, 'Log in')));
      return;
    }
    const errorBox = el('div', { class: 'error', hidden: true, role: 'alert' });
    const form = el('form', { class: 'card stack login-box', onsubmit: async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        await api.team.acceptInvite(code, { email: f.get('email'), password: f.get('password') });
        location.replace('admin.html');
      } catch (err) { errorBox.textContent = err.message; errorBox.hidden = false; btn.disabled = false; }
    } },
      el('h1', {}, `Hi ${info.name.split(' ')[0]}!`),
      el('p', { class: 'muted' }, 'Set up your Top Hat sales login. You’ll add clients, log calls and send estimates, all in one place.'),
      errorBox,
      el('label', { class: 'field' }, 'Your email', el('input', { name: 'email', type: 'email', autocomplete: 'username', inputmode: 'email', required: true })),
      el('label', { class: 'field' }, 'Create a password', el('span', { class: 'hint' }, 'At least 8 characters.'),
        el('input', { name: 'password', type: 'password', autocomplete: 'new-password', minlength: '8', required: true })),
      el('button', { class: 'gold block', type: 'submit' }, 'Create my sales login'));
    view.replaceChildren(form);
  }
  render();
})();
