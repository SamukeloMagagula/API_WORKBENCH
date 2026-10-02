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

/** Top right: who is signed in, and a way out. Empty when the install has no sign-in. */
function renderHeaderUser() {
  const box = $('#header-user');
  if (session.auth !== 'login' || !session.signedIn) return box.replaceChildren();
  // Signing out is a state change, so it is a POST carrying the CSRF token, like sign-in.
  box.replaceChildren(
    h('span', { class: 'welcome' }, 'Signed in as ', h('strong', { text: session.username })),
    h('form', { method: 'post', action: 'auth.php' },
      h('input', { type: 'hidden', name: 'action', value: 'logout' }),
      h('input', { type: 'hidden', name: 'csrf_token', value: session.csrfToken }),
      h('button', { type: 'submit', class: 'btn small btn-ghost-light', text: 'Sign out' })),
  );
}

async function start() {
  await loadSession();
  // The page itself holds nothing private, but there is nothing to do here signed out:
  // the proxy and storage both refuse. Go to the sign-in page instead.
  if (session.auth === 'login' && !session.signedIn) {
    window.location.replace(session.loginUrl || 'login.php');
    return;
  }
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
