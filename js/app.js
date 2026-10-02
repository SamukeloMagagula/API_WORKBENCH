// Entry point: loads who is signed in and their server-side data, then starts the
// Tester and Designer and switches between them.

import { $, $$, h } from './dom.js';
import { load, save } from './storage.js';
import { session, loadSession } from './session.js';
import { refreshServerCollections } from './collections.js';
import { initEnvironments, refreshServerEnvironments } from './environments.js';
import { initTester, loadRequest } from './tester.js';
import { initDesigner } from './designer.js';

function showView(view) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  $$('.view').forEach((v) => v.classList.toggle('hidden', v.id !== `view-${view}`));
  save('view', view);
}

/** Top right: who is signed in, or a way to sign in. Empty when the install has no sign-in. */
function renderHeaderUser() {
  const box = $('#header-user');
  if (session.auth !== 'devhub') return box.replaceChildren();
  box.replaceChildren(session.signedIn
    ? h('span', { class: 'welcome' }, 'Signed in as ', h('strong', { text: session.username }))
    : h('a', { class: 'btn small btn-ghost-light', href: session.loginUrl, target: '_blank', rel: 'noopener', text: 'Sign in via devhub' }));
}

async function start() {
  await loadSession();
  renderHeaderUser();
  await Promise.all([refreshServerCollections(), refreshServerEnvironments()]);

  initEnvironments();
  initTester();
  initDesigner({
    tryIt: (request, name) => {
      loadRequest(request, { name });
      showView('tester');
      $('#req-url').focus();
    },
  });

  $('.tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab) showView(tab.dataset.view);
  });
  showView(load('view', 'tester') === 'designer' ? 'designer' : 'tester');
}

start();
