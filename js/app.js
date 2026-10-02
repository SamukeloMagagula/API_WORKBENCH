// Entry point: loads who is signed in and their server-side data, then starts the
// Tester, Designer and (for admins) Admin views and switches between them.

import { $, $$, h } from './dom.js';
import { load, save } from './storage.js';
import { session, loadSession } from './session.js';
import { refreshServerCollections } from './collections.js';
import { initEnvironments, refreshServerEnvironments } from './environments.js';
import { initTester, loadRequest } from './tester.js';
import { initDesigner, refreshServerDesigns, openEndpoint } from './designer.js';
import { initAdmin, showAdmin } from './admin.js';

const views = () => ['tester', 'designer', ...(session.isAdmin ? ['admin'] : [])];

function showView(view) {
  if (!views().includes(view)) view = 'tester';
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  $$('.view').forEach((v) => v.classList.toggle('hidden', v.id !== `view-${view}`));
  if (view === 'admin') showAdmin();
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
  await Promise.all([refreshServerCollections(), refreshServerEnvironments(), refreshServerDesigns()]);

  initEnvironments();
  initTester({
    // The chip naming a request's designed endpoint opens it in the Designer.
    openDesign: (apiId, endpointId) => {
      if (openEndpoint(apiId, endpointId)) showView('designer');
    },
  });
  initDesigner({
    tryIt: (request, name) => {
      loadRequest(request, { name });
      showView('tester');
      $('#req-url').focus();
    },
  });
  // Hiding the tab is for tidiness; api.php refuses non-admins whatever the page shows.
  if (session.isAdmin) {
    $('#tab-admin').classList.remove('hidden');
    initAdmin();
  }

  $('.tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab) showView(tab.dataset.view);
  });
  showView(load('view', 'tester'));
}

start();
