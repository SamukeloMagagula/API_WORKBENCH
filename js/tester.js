// The Tester tab: build a request, send it through proxy.php, show the response.
// History and the current draft are kept in localStorage; saved requests live in
// collections (collections.js); {{variables}} come from the active environment.

import { $, $$, h, toast, downloadFile, pickFile, copyText, wireSubtabs, showPane, highlightJson, formatBytes, openModal } from './dom.js';
import { load, save, uid } from './storage.js';
import { renderKvTable } from './kvtable.js';
import { session, serverStorage, csrfHeaders } from './session.js';
import { activeEnvironment, activeVariables, onEnvironmentChange } from './environments.js';
import { resolveRequest, hasVariables } from './variables.js';
import { listCollections, currentCollection, setCurrentCollection, updateRequests, createCollection, deleteCollection } from './collections.js';
import { looksLikeCurl, parseCurl } from './curl.js';
import { GENERATORS } from './codegen.js';

const HISTORY_LIMIT = 50;
const EXPORT_FORMAT = 'api-workbench-requests';
const SCOPE_LABEL = { local: '', private: ' (only me)', shared: ' (shared)' };

let req = blankRequest();
let params = [];
let currentSaved = null; // { collectionKey, id } of the saved request being edited, if any
let currentName = 'Untitled request';
let history = load('history', []);
let sideTab = 'saved';
let inFlight = null;
let lastResponse = null;

export function blankRequest() {
  return {
    method: 'GET',
    url: '',
    headers: [],
    auth: { type: 'none', token: '', username: '', password: '' },
    body: { type: 'none', text: '', form: [] },
  };
}

/** Fills in anything missing, so imported or older data always has the full shape. */
function normalize(r = {}) {
  const base = blankRequest();
  return {
    method: (r.method || base.method).toUpperCase(),
    url: r.url || '',
    headers: Array.isArray(r.headers) ? r.headers.map((x) => ({ name: x.name || '', value: x.value || '', enabled: x.enabled !== false })) : [],
    auth: { ...base.auth, ...(r.auth || {}) },
    body: {
      type: r.body?.type || 'none',
      text: r.body?.text || '',
      form: Array.isArray(r.body?.form) ? r.body.form.map((x) => ({ name: x.name || '', value: x.value || '', enabled: x.enabled !== false })) : [],
    },
  };
}

const clone = (value) => JSON.parse(JSON.stringify(value));

let draftTimer;
function persistDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => save('draft', { req, currentSaved, currentName }), 250);
}

// ---------------------------------------------------------------- URL <-> params

function splitUrl(url) {
  const hashAt = url.indexOf('#');
  const hash = hashAt >= 0 ? url.slice(hashAt) : '';
  const rest = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const qAt = rest.indexOf('?');
  return { base: qAt >= 0 ? rest.slice(0, qAt) : rest, query: qAt >= 0 ? rest.slice(qAt + 1) : '', hash };
}

const decode = (s) => {
  try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; }
};

function parseParams(url) {
  const { query } = splitUrl(url);
  if (!query) return [];
  return query.split('&').filter(Boolean).map((pair) => {
    const eq = pair.indexOf('=');
    return eq >= 0
      ? { name: decode(pair.slice(0, eq)), value: decode(pair.slice(eq + 1)), enabled: true }
      : { name: decode(pair), value: '', enabled: true };
  });
}

// {{variables}} are kept readable rather than percent-encoded, so they still resolve.
const encodeKeepingVariables = (s) => s.split(/(\{\{[^{}]*\}\})/).map((part, i) => (i % 2 ? part : encodeURIComponent(part))).join('');

function buildUrl(url, rows) {
  const { base, hash } = splitUrl(url);
  const query = rows
    .filter((r) => r.name)
    .map((r) => encodeKeepingVariables(r.name) + (r.value !== '' ? '=' + encodeKeepingVariables(r.value) : ''))
    .join('&');
  return base + (query ? '?' + query : '') + hash;
}

// ---------------------------------------------------------------- rendering the request

function renderParams() {
  renderKvTable($('#params-table'), params, {
    withEnabled: false,
    namePlaceholder: 'Query parameter',
    onChange: () => {
      req.url = buildUrl(req.url, params);
      $('#req-url').value = req.url;
      updateUrlPreview();
      persistDraft();
    },
  });
}

function renderHeaders() {
  renderKvTable($('#headers-table'), req.headers, {
    namePlaceholder: 'Header',
    onChange: () => { updateHeaderCount(); persistDraft(); },
  });
  updateHeaderCount();
}

function updateHeaderCount() {
  const n = req.headers.filter((x) => x.enabled !== false && x.name.trim()).length;
  $('#headers-count').textContent = n ? `(${n})` : '';
}

function renderAuth() {
  $('#auth-type').value = req.auth.type;
  $('#auth-token').value = req.auth.token;
  $('#auth-username').value = req.auth.username;
  $('#auth-password').value = req.auth.password;
  $('#auth-bearer').classList.toggle('hidden', req.auth.type !== 'bearer');
  $('#auth-basic').classList.toggle('hidden', req.auth.type !== 'basic');
}

function renderBody() {
  const type = req.body.type;
  $$('#body-type .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.body === type));
  $('#body-text').classList.toggle('hidden', type !== 'json' && type !== 'text');
  $('#body-text').value = req.body.text;
  $('#btn-format-body').classList.toggle('hidden', type !== 'json');
  $('#body-form-table').classList.toggle('hidden', type !== 'form');
  if (type === 'form') {
    renderKvTable($('#body-form-table'), req.body.form, { namePlaceholder: 'Field', onChange: persistDraft });
  }
  updateBodyStatus();
}

function updateBodyStatus() {
  const el = $('#body-status');
  el.className = 'hint';
  el.textContent = '';
  if (req.body.type !== 'json' || !req.body.text.trim()) return;
  if (hasVariables(req.body.text)) {
    el.textContent = 'Contains {{variables}}: checked after they are filled in';
    return;
  }
  try {
    JSON.parse(req.body.text);
    el.textContent = 'Valid JSON';
    el.classList.add('ok');
  } catch (e) {
    el.textContent = e.message;
    el.classList.add('error');
  }
}

/** Under the URL bar: what {{variables}} in the URL turn into with the active environment. */
function updateUrlPreview() {
  const el = $('#url-preview');
  if (!hasVariables(req.url)) {
    el.classList.add('hidden');
    return;
  }
  const { request, missing } = resolveRequest(req, activeVariables());
  el.classList.remove('hidden');
  el.className = `url-preview${missing.length ? ' error' : ''}`;
  el.textContent = missing.length
    ? `No value for ${missing.map((n) => `{{${n}}}`).join(', ')}${activeEnvironment() ? ` in “${activeEnvironment().name}”` : ': choose an environment'}`
    : `→ ${request.url}`;
}

function renderRequest() {
  $('#req-method').value = req.method;
  $('#req-url').value = req.url;
  $('#request-name').textContent = currentName;
  params = parseParams(req.url);
  renderParams();
  renderHeaders();
  renderAuth();
  renderBody();
  updateUrlPreview();
}

/** Replaces the editor contents with a request (from saved, history, curl or the designer's "Try it"). */
export function loadRequest(request, { saved = null, name = 'Untitled request' } = {}) {
  req = normalize(clone(request));
  currentSaved = saved;
  currentName = name;
  renderRequest();
  renderSide();
  persistDraft();
}

// ---------------------------------------------------------------- sidebar: collections + history

function renderCollectionBar() {
  const bar = $('#collection-bar');
  const collections = listCollections();
  const current = currentCollection();
  const select = h('select', {
    class: 'grow', title: 'Collection',
    onchange: (e) => { setCurrentCollection(e.target.value); renderSide(); },
  }, ...collections.map((c) => h('option', { value: c.key, text: c.name + SCOPE_LABEL[c.scope], selected: c.key === current.key })));

  const children = [h('div', { class: 'side-actions' }, select)];
  if (serverStorage()) {
    const buttons = [h('button', { class: 'btn small', text: '+ Collection', onclick: newCollectionDialog })];
    if (current.scope !== 'local') buttons.push(h('button', { class: 'btn small', text: 'Settings', onclick: () => collectionDialog(current) }));
    children.push(h('div', { class: 'side-actions' }, ...buttons));
    if (current.scope === 'shared') {
      children.push(h('p', { class: 'hint', text: `Shared by ${current.owner}${current.updatedBy ? ` · last saved by ${current.updatedBy}` : ''}` }));
    }
  } else if (session.auth === 'login' && session.signedIn && session.storageError) {
    children.push(h('p', { class: 'hint error', text: `Server collections unavailable: ${session.storageError}` }));
  }
  bar.replaceChildren(...children);
}

function renderSide() {
  $('#collection-bar').classList.toggle('hidden', sideTab !== 'saved');
  $('#saved-actions').classList.toggle('hidden', sideTab !== 'saved');
  $('#history-actions').classList.toggle('hidden', sideTab !== 'history');
  $$('#side-tabs .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.side === sideTab));

  const list = $('#side-list');
  if (sideTab === 'saved') {
    renderCollectionBar();
    const collection = currentCollection();
    const requests = collection.requests;
    list.replaceChildren(
      ...(requests.length ? requests.map((item) => h('li', {
        class: currentSaved?.collectionKey === collection.key && currentSaved.id === item.id ? 'active' : '',
        title: item.request.url,
        onclick: () => loadRequest(item.request, { saved: { collectionKey: collection.key, id: item.id }, name: item.name }),
      },
      h('span', { class: `method ${item.request.method}`, text: item.request.method }),
      h('span', { class: 'label', text: item.name }),
      h('button', {
        class: 'btn icon remove', title: 'Delete', text: '×',
        onclick: (e) => { e.stopPropagation(); deleteSaved(item.id); },
      }),
      )) : [h('li', { class: 'empty', text: 'No saved requests in this collection yet. Use Save to add one.' })]),
    );
  } else {
    list.replaceChildren(
      ...(history.length ? history.map((item) => h('li', {
        title: item.displayUrl || item.request.url,
        onclick: () => loadRequest(item.request),
      },
      h('span', { class: `method ${item.request.method}`, text: item.request.method }),
      h('span', { class: 'label' },
        (item.displayUrl || item.request.url).replace(/^https?:\/\//, ''),
        h('div', { class: 'sub', text: `${item.status} · ${timeAgo(item.at)}` })),
      h('button', {
        class: 'btn icon remove', title: 'Remove from history', text: '×',
        onclick: (e) => { e.stopPropagation(); deleteHistory(item.id); },
      }),
      )) : [h('li', { class: 'empty', text: 'Requests you send appear here.' })]),
    );
  }
}

function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

/** The saved request being edited, if it belongs to the collection on screen. */
function editingInCurrent() {
  const collection = currentCollection();
  if (currentSaved?.collectionKey !== collection.key) return null;
  return collection.requests.some((x) => x.id === currentSaved.id) ? collection : null;
}

async function saveCurrent() {
  const collection = currentCollection();
  if (editingInCurrent()) {
    const ok = await updateRequests(collection, (list) => {
      const item = list.find((x) => x.id === currentSaved.id);
      if (item) Object.assign(item, { name: currentName, request: clone(req) });
    });
    renderSide();
    if (ok) toast(`Saved “${currentName}” in ${collection.name}`);
    return;
  }
  const suggested = currentName !== 'Untitled request' ? currentName : suggestName();
  const name = prompt(`Save to “${collection.name}” as:`, suggested);
  if (name === null) return;
  const item = { id: uid(), name: name.trim() || suggested, request: clone(req) };
  const ok = await updateRequests(collection, (list) => list.unshift(item));
  if (ok) {
    currentSaved = { collectionKey: collection.key, id: item.id };
    currentName = item.name;
    $('#request-name').textContent = currentName;
    persistDraft();
    toast(`Saved “${item.name}” in ${collection.name}`);
  }
  sideTab = 'saved';
  renderSide();
}

function suggestName() {
  const { base } = splitUrl(req.url);
  const path = base.replace(/^[a-z]+:\/\/[^/]+/i, '').replace(/^\{\{[^}]*\}\}/, '') || '/';
  return `${req.method} ${path}`;
}

async function renameCurrent() {
  const name = prompt('Rename request:', currentName);
  if (name === null || !name.trim()) return;
  currentName = name.trim();
  $('#request-name').textContent = currentName;
  const collection = editingInCurrent();
  if (collection) {
    await updateRequests(collection, (list) => {
      const item = list.find((x) => x.id === currentSaved.id);
      if (item) item.name = currentName;
    });
    renderSide();
  }
  persistDraft();
}

async function deleteSaved(id) {
  const collection = currentCollection();
  const item = collection.requests.find((x) => x.id === id);
  if (!item || !confirm(`Delete “${item.name}” from ${collection.name}?`)) return;
  await updateRequests(collection, (list) => {
    const i = list.findIndex((x) => x.id === id);
    if (i >= 0) list.splice(i, 1);
  });
  if (currentSaved?.id === id) currentSaved = null;
  renderSide();
}

// No confirm: a history entry is a record of something already sent, cheap to lose.
function deleteHistory(id) {
  history = history.filter((x) => x.id !== id);
  save('history', history);
  renderSide();
}

function exportSaved() {
  const collection = currentCollection();
  if (!collection.requests.length) return toast('Nothing to export in this collection.', 'error');
  const payload = { format: EXPORT_FORMAT, version: 1, name: collection.name, exportedAt: new Date().toISOString(), items: collection.requests };
  const slug = collection.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'requests';
  downloadFile(`api-workbench-${slug}.json`, JSON.stringify(payload, null, 2));
}

async function importSaved() {
  const file = await pickFile('.json,application/json');
  if (!file) return;
  try {
    const data = JSON.parse(file.text);
    const items = Array.isArray(data) ? data : data.items;
    if (!Array.isArray(items)) throw new Error('No requests found in this file.');
    const imported = items
      .filter((x) => x && x.request)
      .map((x) => ({ id: uid(), name: String(x.name || 'Imported request'), request: normalize(x.request) }));
    if (!imported.length) throw new Error('No requests found in this file.');
    const collection = currentCollection();
    if (await updateRequests(collection, (list) => list.unshift(...imported))) {
      toast(`Imported ${imported.length} request${imported.length === 1 ? '' : 's'} into ${collection.name}`);
    }
    sideTab = 'saved';
    renderSide();
  } catch (e) {
    toast(`Import failed: ${e.message}`, 'error');
  }
}

function collectionForm({ name = '', shared = false, canShare = true }) {
  const nameInput = h('input', { type: 'text', value: name, placeholder: 'e.g. Billing API' });
  const sharedInput = h('input', { type: 'checkbox', checked: shared, disabled: !canShare });
  const body = h('div', {},
    h('div', { class: 'form-group' }, h('label', {}, 'Name', nameInput)),
    h('label', { class: 'check' }, sharedInput, 'Shared with everyone signed in'),
    h('p', { class: 'hint', text: 'Everyone who can see a shared collection can edit it. Only its owner or an admin can delete it or stop sharing it.' }),
  );
  return { body, read: () => ({ name: nameInput.value.trim(), shared: sharedInput.checked }) };
}

function newCollectionDialog() {
  const form = collectionForm({});
  const modal = openModal({
    title: 'New collection',
    body: form.body,
    actions: [
      h('button', { class: 'btn', text: 'Cancel', onclick: () => modal.close() }),
      h('button', {
        class: 'btn primary', text: 'Create',
        onclick: async () => {
          const { name, shared } = form.read();
          if (!name) return toast('Give the collection a name.', 'error');
          if (await createCollection(name, shared)) {
            modal.close();
            sideTab = 'saved';
            renderSide();
          }
        },
      }),
    ],
  });
}

function collectionDialog(collection) {
  const form = collectionForm({ name: collection.name, shared: collection.scope === 'shared', canShare: collection.canShare });
  const actions = [];
  if (collection.deletable) {
    actions.push(h('button', {
      class: 'btn danger', text: 'Delete collection',
      onclick: async () => {
        const warning = collection.scope === 'shared' ? ' It is shared, so it disappears for everyone.' : '';
        if (!confirm(`Delete “${collection.name}” and its ${collection.requests.length} request(s)?${warning}`)) return;
        if (await deleteCollection(collection)) {
          modal.close();
          renderSide();
        }
      },
    }), h('span', { class: 'spacer' }));
  }
  actions.push(
    h('button', { class: 'btn', text: 'Cancel', onclick: () => modal.close() }),
    h('button', {
      class: 'btn primary', text: 'Save',
      onclick: async () => {
        const { name, shared } = form.read();
        if (!name) return toast('Give the collection a name.', 'error');
        if (await updateRequests(collection, () => {}, { name, shared })) {
          modal.close();
          renderSide();
        }
      },
    }),
  );
  const modal = openModal({ title: 'Collection settings', body: form.body, actions });
}

// ---------------------------------------------------------------- curl in, code out

function importCurl(text) {
  try {
    const { request, warnings } = parseCurl(text);
    loadRequest(request, { name: 'Imported from curl' });
    toast(warnings.length ? `Imported, with notes: ${warnings.join(' ')}` : 'Imported from curl', warnings.length ? 'error' : 'info');
    return true;
  } catch (e) {
    toast(`Could not read that curl command: ${e.message}`, 'error');
    return false;
  }
}

function curlDialog() {
  const input = h('textarea', { class: 'code', rows: 10, spellcheck: false, placeholder: "curl -X POST 'https://api.example.com/users' -H 'Content-Type: application/json' -d '{\"name\":\"Ada\"}'" });
  const modal = openModal({
    title: 'Import from curl',
    size: 'modal-lg',
    body: h('div', {},
      input,
      h('p', { class: 'hint', text: 'Paste a curl command, for example from your browser\'s DevTools (Network → right-click → Copy as cURL) or from API docs. Pasting one straight into the URL box works too.' })),
    actions: [
      h('button', { class: 'btn', text: 'Cancel', onclick: () => modal.close() }),
      h('button', { class: 'btn primary', text: 'Import', onclick: () => { if (importCurl(input.value)) modal.close(); } }),
    ],
  });
}

function codeDialog() {
  const { request, missing } = resolveRequest(req, activeVariables());
  const outgoing = buildOutgoing(request);
  if (!outgoing.url) return toast('Enter a URL first.', 'error');

  let current = load('codeLanguage', 'curl');
  if (!GENERATORS.some((g) => g.id === current)) current = 'curl';
  const pre = h('pre', { class: 'code-view code-export' });
  const tabs = h('div', { class: 'seg' });
  const render = () => {
    pre.textContent = GENERATORS.find((g) => g.id === current).fn(outgoing);
    tabs.replaceChildren(...GENERATORS.map((g) => h('button', {
      class: `seg-btn${g.id === current ? ' active' : ''}`, type: 'button', text: g.label,
      onclick: () => { current = g.id; save('codeLanguage', current); render(); },
    })));
  };
  render();

  const notes = [];
  if (missing.length) notes.push(h('p', { class: 'hint error', text: `No value for ${missing.map((n) => `{{${n}}}`).join(', ')}: left as written.` }));
  if (activeEnvironment() && !missing.length) notes.push(h('p', { class: 'hint', text: `Variables filled in from “${activeEnvironment().name}”. The code contains their values, tokens included.` }));

  const modal = openModal({
    title: 'Code for this request',
    size: 'modal-lg',
    body: h('div', {}, h('div', { class: 'form-row' }, tabs), ...notes, pre),
    actions: [
      h('button', { class: 'btn', text: 'Close', onclick: () => modal.close() }),
      h('button', { class: 'btn primary', text: 'Copy', onclick: () => copyText(pre.textContent) }),
    ],
  });
}

// ---------------------------------------------------------------- sending

function buildOutgoing(r) {
  let url = r.url.trim();
  if (url && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = 'http://' + url;

  const headers = r.headers
    .filter((x) => x.enabled !== false && x.name.trim())
    .map((x) => ({ name: x.name.trim(), value: x.value }));
  const has = (name) => headers.some((x) => x.name.toLowerCase() === name);

  if (!has('authorization')) {
    if (r.auth.type === 'bearer' && r.auth.token) {
      headers.push({ name: 'Authorization', value: `Bearer ${r.auth.token}` });
    } else if (r.auth.type === 'basic' && (r.auth.username || r.auth.password)) {
      const bytes = new TextEncoder().encode(`${r.auth.username}:${r.auth.password}`);
      headers.push({ name: 'Authorization', value: `Basic ${btoa(String.fromCharCode(...bytes))}` });
    }
  }

  let body = null;
  const contentTypes = { json: 'application/json', text: 'text/plain', form: 'application/x-www-form-urlencoded' };
  if (r.body.type === 'json' || r.body.type === 'text') {
    body = r.body.text;
  } else if (r.body.type === 'form') {
    const form = new URLSearchParams();
    r.body.form.filter((x) => x.enabled !== false && x.name).forEach((x) => form.append(x.name, x.value));
    body = form.toString();
  }
  if (body !== null && contentTypes[r.body.type] && !has('content-type')) {
    headers.push({ name: 'Content-Type', value: contentTypes[r.body.type] });
  }

  return { method: r.method, url, headers, body };
}

async function send() {
  if (inFlight) {
    inFlight.abort();
    return;
  }
  const env = activeEnvironment();
  const { request, missing } = resolveRequest(req, activeVariables());
  if (missing.length) {
    showResponse({ ok: false, error: { code: 'MISSING_VARIABLES', message: `No value for ${missing.map((n) => `{{${n}}}`).join(', ')}`
      + (env ? ` in the environment “${env.name}”.` : '. Choose an environment that defines it, top right.') } });
    return;
  }
  const outgoing = buildOutgoing(request);
  if (!outgoing.url) {
    toast('Enter a URL first.', 'error');
    $('#req-url').focus();
    return;
  }

  const controller = new AbortController();
  inFlight = controller;
  const sendBtn = $('#btn-send');
  sendBtn.textContent = 'Cancel';
  $('#response-meta').replaceChildren(h('span', { class: 'muted', text: 'Sending…' }));

  try {
    const res = await fetch('proxy.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
      body: JSON.stringify(outgoing),
      signal: controller.signal,
    });
    // proxy.php answers JSON even on fatals, so anything else never reached it:
    // the web server itself refused (bad .htaccess, PHP not wired up) or PHP is not running.
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      const snippet = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
      throw new Error(`proxy.php answered HTTP ${res.status} without JSON, so the request never reached the proxy code. `
        + (snippet ? `The server said: “${snippet}”. ` : 'The body was empty. ')
        + 'Check the web server error log; see Troubleshooting in the README.');
    }
    showResponse(data);
    addHistory(outgoing.url, data.ok ? String(data.status) : data.error?.code || 'ERROR');
  } catch (e) {
    if (e.name === 'AbortError') {
      showResponse({ ok: false, error: { code: 'CANCELLED', message: 'Request cancelled.' } });
    } else {
      showResponse({ ok: false, error: { code: 'NETWORK_ERROR', message: e.message } });
    }
  } finally {
    inFlight = null;
    sendBtn.textContent = 'Send';
  }
}

/** History keeps the request as written ({{variables}} intact) and the URL it resolved to. */
function addHistory(displayUrl, status) {
  history.unshift({ id: uid(), at: Date.now(), status, displayUrl, request: clone(req) });
  history = history.slice(0, HISTORY_LIMIT);
  save('history', history);
  if (sideTab === 'history') renderSide();
}

// ---------------------------------------------------------------- response

function showResponse(data) {
  lastResponse = data;
  const meta = $('#response-meta');
  const tabs = $('#response-tabs');

  if (!data.ok) {
    meta.replaceChildren(...[
      h('span', { class: 'status err', text: data.error?.code || 'ERROR' }),
      h('span', { text: data.error?.message || 'Unknown error' }),
      data.error?.code === 'NOT_SIGNED_IN' && session.loginUrl
        ? h('a', { class: 'btn small primary', href: session.loginUrl, text: 'Sign in' })
        : null,
    ].filter(Boolean));
    tabs.classList.add('hidden');
    setExpanded(false); // the toolbar holding "Close" is hidden for errors
    $('#res-body').textContent = '';
    $('#res-headers').replaceChildren();
    showPane('res', 'body');
    return;
  }

  // replaceChildren() prints null as the text "null", so optional items are filtered out.
  meta.replaceChildren(...[
    h('span', { class: `status s${String(data.status)[0]}`, text: `${data.status} ${data.statusText || ''}`.trim() }),
    h('span', { class: 'muted', text: `${data.timeMs} ms` }),
    h('span', { class: 'muted', text: formatBytes(data.sizeBytes) }),
    data.truncated ? h('span', { class: 'hint error', text: 'Response was cut off at the server size limit.' }) : null,
  ].filter(Boolean));
  tabs.classList.remove('hidden');
  $('#res-headers-count').textContent = `(${data.headers.length})`;
  $('#res-headers').replaceChildren(
    ...data.headers.map(([name, value]) => h('tr', {}, h('td', { text: name }), h('td', { text: value }))),
  );
  renderResponseBody();
}

function responseHeader(name) {
  return lastResponse?.headers?.find(([n]) => n.toLowerCase() === name)?.[1] || '';
}

function renderResponseBody() {
  const pre = $('#res-body');
  const data = lastResponse;
  if (!data?.ok) return;

  if (data.bodyEncoding === 'base64') {
    pre.replaceChildren(
      `Binary response (${formatBytes(data.sizeBytes)}, ${responseHeader('content-type') || 'unknown type'}). `,
      h('button', { class: 'btn small', text: 'Download', onclick: downloadBinary }),
    );
    return;
  }
  if (data.body === '') {
    pre.replaceChildren(h('span', { class: 'muted', text: '(empty body)' }));
    return;
  }

  const raw = $('#res-raw').checked;
  const looksJson = responseHeader('content-type').includes('json') || /^\s*[[{]/.test(data.body);
  if (!raw && looksJson) {
    try {
      pre.innerHTML = highlightJson(JSON.stringify(JSON.parse(data.body), null, 2));
      return;
    } catch {
      // not actually JSON; show as text
    }
  }
  pre.textContent = data.body;
}

function downloadBinary() {
  const bin = atob(lastResponse.body);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const type = responseHeader('content-type') || 'application/octet-stream';
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = h('a', { href: url, download: 'response' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function copyResponse() {
  if (!lastResponse?.ok) return;
  if (lastResponse.bodyEncoding === 'base64') return toast('Binary responses cannot be copied. Use Download.', 'error');
  let text = lastResponse.body;
  if (!$('#res-raw').checked) {
    try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* copy as-is */ }
  }
  copyText(text);
}

// ---------------------------------------------------------------- response zoom + expand

const ZOOM_STEPS = [0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5];
const BASE_FONT_PX = 13;

function applyZoom(zoom) {
  $('#response-panel').style.setProperty('--res-font', `${BASE_FONT_PX * zoom}px`);
  $('#btn-zoom-reset').textContent = `${Math.round(zoom * 100)}%`;
  $('#btn-zoom-out').disabled = zoom <= ZOOM_STEPS[0];
  $('#btn-zoom-in').disabled = zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1];
  save('responseZoom', zoom);
}

function setExpanded(expanded) {
  $('#response-panel').classList.toggle('expanded', expanded);
  document.body.classList.toggle('res-expanded', expanded);
  const btn = $('#btn-expand-response');
  btn.querySelector('.ico-expand').classList.toggle('hidden', expanded);
  btn.querySelector('.ico-collapse').classList.toggle('hidden', !expanded);
  btn.title = expanded ? 'Exit full screen (Esc)' : 'Expand (Esc closes)';
  btn.setAttribute('aria-label', expanded ? 'Exit full screen' : 'Expand response');
}

function wireResponseZoom() {
  let zoom = load('responseZoom', 1);
  if (!ZOOM_STEPS.includes(zoom)) zoom = 1;
  applyZoom(zoom);

  const step = (direction) => {
    const i = ZOOM_STEPS.indexOf(zoom) + direction;
    if (i < 0 || i >= ZOOM_STEPS.length) return;
    zoom = ZOOM_STEPS[i];
    applyZoom(zoom);
  };
  $('#btn-zoom-in').addEventListener('click', () => step(1));
  $('#btn-zoom-out').addEventListener('click', () => step(-1));
  $('#btn-zoom-reset').addEventListener('click', () => { zoom = 1; applyZoom(zoom); });

  $('#btn-expand-response').addEventListener('click', () => {
    setExpanded(!$('#response-panel').classList.contains('expanded'));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('#response-panel').classList.contains('expanded')) setExpanded(false);
  });
}

// ---------------------------------------------------------------- wiring

export function initTester() {
  const draft = load('draft', null);
  if (draft?.req) {
    req = normalize(draft.req);
    currentSaved = draft.currentSaved ?? null;
    currentName = draft.currentName || 'Untitled request';
  }
  renderRequest();
  renderSide();

  $('#request-form').addEventListener('submit', (e) => { e.preventDefault(); send(); });
  $('#req-method').addEventListener('change', (e) => { req.method = e.target.value; persistDraft(); });
  $('#req-url').addEventListener('input', (e) => {
    req.url = e.target.value;
    params = parseParams(req.url);
    renderParams();
    updateUrlPreview();
    persistDraft();
  });
  // Pasting a whole curl command into the URL box imports it instead.
  $('#req-url').addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text') || '';
    if (looksLikeCurl(text)) {
      e.preventDefault();
      importCurl(text);
    }
  });
  $('#btn-save').addEventListener('click', saveCurrent);
  $('#btn-import-curl').addEventListener('click', curlDialog);
  $('#btn-code').addEventListener('click', codeDialog);
  $('#request-name').addEventListener('click', renameCurrent);
  $('#request-name').title = 'Click to rename';

  wireSubtabs($('.subtabs[data-group="req"]'), 'req');
  wireSubtabs($('#response-tabs'), 'res');

  $('#auth-type').addEventListener('change', (e) => { req.auth.type = e.target.value; renderAuth(); persistDraft(); });
  for (const field of ['token', 'username', 'password']) {
    $(`#auth-${field}`).addEventListener('input', (e) => { req.auth[field] = e.target.value; persistDraft(); });
  }

  $('#body-type').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    req.body.type = btn.dataset.body;
    renderBody();
    persistDraft();
  });
  $('#body-text').addEventListener('input', (e) => { req.body.text = e.target.value; updateBodyStatus(); persistDraft(); });
  $('#btn-format-body').addEventListener('click', () => {
    try {
      req.body.text = JSON.stringify(JSON.parse(req.body.text), null, 2);
      $('#body-text').value = req.body.text;
      updateBodyStatus();
      persistDraft();
    } catch (e) {
      toast(`Cannot format: ${e.message}`, 'error');
    }
  });

  $('#res-raw').addEventListener('change', renderResponseBody);
  $('#btn-copy-response').addEventListener('click', copyResponse);
  wireResponseZoom();

  $('#side-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    sideTab = btn.dataset.side;
    renderSide();
  });
  $('#btn-new-request').addEventListener('click', () => loadRequest(blankRequest()));
  $('#btn-export-saved').addEventListener('click', exportSaved);
  $('#btn-import-saved').addEventListener('click', importSaved);
  $('#btn-clear-history').addEventListener('click', () => {
    if (!history.length || !confirm('Clear all request history?')) return;
    history = [];
    save('history', history);
    renderSide();
  });

  onEnvironmentChange(updateUrlPreview);

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !$('#view-tester').classList.contains('hidden')) {
      e.preventDefault();
      send();
    }
  });
}
