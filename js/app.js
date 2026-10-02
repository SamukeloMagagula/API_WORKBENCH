// Entry point: switches between the Tester and Designer tabs and shows the server mode.

import { $, $$ } from './dom.js';
import { load, save } from './storage.js';
import { initTester, loadRequest } from './tester.js';
import { initDesigner } from './designer.js';

function showView(view) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  $$('.view').forEach((v) => v.classList.toggle('hidden', v.id !== `view-${view}`));
  save('view', view);
}

async function showServerMode() {
  const badge = $('#mode-badge');
  try {
    const res = await fetch('proxy.php', { headers: { Accept: 'application/json' } });
    const info = await res.json();
    if (!info.ok) throw new Error(info.error?.message || 'proxy error');
    badge.textContent = info.mode === 'hosted' ? 'Hosted mode' : 'Local mode';
    badge.classList.add(info.mode);
    badge.title = info.mode === 'hosted'
      ? `Shared server: private and internal addresses need to be allow-listed. Timeout ${info.timeoutSeconds}s.`
      : `Running locally: localhost and private networks can be called. Timeout ${info.timeoutSeconds}s.`;
  } catch {
    badge.textContent = 'Proxy offline';
    badge.classList.add('error');
    badge.title = 'proxy.php did not answer. The Tester needs this page to be served by PHP (see README). The Designer still works.';
  }
}

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
showServerMode();
