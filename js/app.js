// Entry point: switches between the Tester and Designer tabs.

import { $, $$ } from './dom.js';
import { load, save } from './storage.js';
import { initTester, loadRequest } from './tester.js';
import { initDesigner } from './designer.js';

function showView(view) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  $$('.view').forEach((v) => v.classList.toggle('hidden', v.id !== `view-${view}`));
  save('view', view);
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
