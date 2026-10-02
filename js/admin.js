// The Admin tab: users (roles, disabling, reset links) and the activity log.
// Shown only to admins; api.php enforces it either way.

import { $, $$, h, toast, openModal, copyText } from './dom.js';
import { api } from './session.js';

let users = [];
let you = 0;
let started = false;
let logRows = [];
let logMore = false;

// ---------------------------------------------------------------- users

async function loadUsers() {
  try {
    const data = await api('users');
    users = data.users;
    you = data.you;
    renderUsers();
  } catch (e) {
    toast(e.message, 'error');
  }
}

const shortDate = (s) => (s ? s.slice(0, 16).replace('T', ' ') : '');

function renderUsers() {
  const filter = $('#user-filter').value.trim().toLowerCase();
  const shown = users.filter((u) => !filter || u.username.includes(filter));
  $('#user-count').textContent = `${shown.length} of ${users.length} account${users.length === 1 ? '' : 's'}`;

  const head = h('thead', {}, h('tr', {}, ...['Email', 'Role', 'Status', 'Created', 'Last sign-in', ''].map((t) => h('th', { text: t }))));
  const rows = shown.map((u) => {
    const self = u.id === you;
    const actions = [];
    if (!u.isOwner) {
      actions.push(u.isAdmin
        ? h('button', {
          class: 'btn small', text: 'Remove admin', disabled: self, title: self ? 'Ask another admin to do this' : '',
          onclick: () => update(u, { isAdmin: false }, `Remove admin rights from ${u.username}?`),
        })
        : h('button', { class: 'btn small', text: 'Make admin', onclick: () => update(u, { isAdmin: true }, `Make ${u.username} an admin? They will be able to manage every account.`) }));
      if (!self) {
        actions.push(u.disabled
          ? h('button', { class: 'btn small', text: 'Enable', onclick: () => update(u, { disabled: false }) })
          : h('button', { class: 'btn small danger', text: 'Disable', onclick: () => update(u, { disabled: true }, `Disable ${u.username}? They are signed out on their next request and cannot sign in again until enabled.`) }));
      }
    }
    actions.push(h('button', { class: 'btn small', text: 'Reset password', onclick: () => issueReset(u) }));

    return h('tr', { class: u.disabled ? 'muted-row' : '' },
      h('td', {}, h('span', { class: 'mono-cell', text: u.username }), self ? h('span', { class: 'pill', text: 'you' }) : null),
      h('td', {}, h('span', { class: `pill ${u.isOwner ? 'pill-red' : u.isAdmin ? 'pill-dark' : ''}`, text: u.isOwner ? 'Owner' : u.isAdmin ? 'Admin' : 'User' })),
      h('td', {}, h('span', { class: `pill ${u.disabled ? 'pill-red' : 'pill-green'}`, text: u.disabled ? 'Disabled' : 'Active' })),
      h('td', { class: 'nowrap', text: shortDate(u.createdAt) }),
      h('td', { class: 'nowrap', text: u.lastLogin ? shortDate(u.lastLogin) : 'never' }),
      h('td', { class: 'row-actions' }, ...actions),
    );
  });

  $('#users-table').replaceChildren(head, h('tbody', {}, ...(rows.length ? rows : [h('tr', {}, h('td', { colSpan: 6, class: 'muted', text: 'No accounts match.' }))])));
}

async function update(user, changes, question) {
  if (question && !confirm(question)) return;
  try {
    const data = await api('user_update', { id: user.id, ...changes });
    users = data.users;
    renderUsers();
    toast(`Updated ${user.username}`);
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function issueReset(user) {
  if (!confirm(`Issue a password reset link for ${user.username}? Any earlier link for them stops working.`)) return;
  try {
    const data = await api('user_reset', { id: user.id });
    // Built from the address this admin is using, not a Host header the server was sent.
    const link = new URL(`reset.php?token=${data.token}`, window.location.href).href;
    const minutes = Math.round(data.expiresInSeconds / 60);
    const field = h('input', { type: 'text', class: 'reset-link', value: link, readOnly: true, onfocus: (e) => e.target.select() });
    const modal = openModal({
      title: 'Password reset link',
      body: h('div', {},
        h('p', {}, 'Give this link to ', h('strong', { text: data.username }), ' directly, the way you would hand over a temporary password.'),
        field,
        h('ul', { class: 'reset-notes' },
          h('li', { text: `Works once, for the next ${minutes} minute${minutes === 1 ? '' : 's'}.` }),
          h('li', { text: 'It is shown only now. Issue a new one if it is lost.' }),
          h('li', { text: 'Using it also clears any sign-in lockout on the account.' }))),
      actions: [
        h('button', { class: 'btn', text: 'Close', onclick: () => modal.close() }),
        h('button', { class: 'btn primary', text: 'Copy link', onclick: () => copyText(link) }),
      ],
    });
    field.select();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ---------------------------------------------------------------- activity log

function logFilters() {
  return Object.fromEntries(new FormData($('#log-filters')).entries());
}

async function loadLog({ append = false } = {}) {
  const query = logFilters();
  if (append && logRows.length) query.before = logRows[logRows.length - 1].id;
  try {
    const data = await api('activity', undefined, query);
    logRows = append ? [...logRows, ...data.rows] : data.rows;
    logMore = data.more;
    fillActions(data.actions);
    renderLog();
  } catch (e) {
    toast(e.message, 'error');
  }
}

function fillActions(actions) {
  const select = $('#log-filters select[name="action"]');
  const current = select.value;
  select.replaceChildren(h('option', { value: '', text: 'All actions' }), ...actions.map((a) => h('option', { value: a, text: a, selected: a === current })));
}

/** Colour by what kind of event it is: failures red, admin changes dark, the rest plain. */
function actionClass(action) {
  if (/^login\.(failed|blocked|disabled)$/.test(action)) return 'pill-red';
  if (action.startsWith('admin.') || action === 'user.password_reset') return 'pill-dark';
  if (action === 'login' || action === 'register') return 'pill-green';
  return '';
}

function renderLog() {
  const head = h('thead', {}, h('tr', {}, ...['Time', 'User', 'Action', 'Detail'].map((t) => h('th', { text: t }))));
  const rows = logRows.map((r) => h('tr', {},
    h('td', { class: 'nowrap', text: r.at }),
    h('td', {}, h('button', {
      class: 'link-btn mono-cell', text: r.username, title: 'Show only this user',
      onclick: () => { $('#log-filters input[name="user"]').value = r.username; loadLog(); },
    })),
    h('td', {}, h('span', { class: `pill ${actionClass(r.action)}`, text: r.action })),
    h('td', { class: 'detail-cell', text: r.detail }),
  ));
  $('#log-table').replaceChildren(head, h('tbody', {}, ...(rows.length ? rows : [h('tr', {}, h('td', { colSpan: 4, class: 'muted', text: 'Nothing matches these filters.' }))])));
  $('#btn-log-more').classList.toggle('hidden', !logMore);
}

// ---------------------------------------------------------------- wiring

function showSection(name) {
  $$('#admin-tabs .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.admin === name));
  $('#admin-users').classList.toggle('hidden', name !== 'users');
  $('#admin-activity').classList.toggle('hidden', name !== 'activity');
  if (name === 'activity' && !logRows.length) loadLog();
}

/** Called each time the Admin tab is shown; data loads the first time. */
export function showAdmin() {
  if (started) return;
  started = true;
  loadUsers();
}

export function initAdmin() {
  $('#admin-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (btn) showSection(btn.dataset.admin);
  });
  $('#user-filter').addEventListener('input', renderUsers);
  $('#btn-reload-users').addEventListener('click', loadUsers);
  $('#log-filters').addEventListener('submit', (e) => { e.preventDefault(); loadLog(); });
  $('#btn-clear-log-filters').addEventListener('click', () => { $('#log-filters').reset(); loadLog(); });
  $('#btn-log-more').addEventListener('click', () => loadLog({ append: true }));
}
