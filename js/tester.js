// The Tester tab: build requests in tabs, send them through proxy.php, show responses.
// Open tabs and history are kept in localStorage; saved requests live in collections
// (collections.js); {{variables}} come from the active environment.

import { $, $$, h, toast, downloadFile, pickFile, copyText, wireSubtabs, showPane, highlightJson, formatBytes, openModal } from './dom.js';
import { load, save, uid } from './storage.js';
import { renderKvTable } from './kvtable.js';
import { session, serverStorage, csrfHeaders } from './session.js';
import { activeEnvironment, activeVariables, onEnvironmentChange } from './environments.js';
import { resolveRequest, hasVariables } from './variables.js';
import { listCollections, currentCollection, setCurrentCollection, updateRequests, createCollection, deleteCollection } from './collections.js';
import { looksLikeCurl, parseCurl } from './curl.js';
import { GENERATORS } from './codegen.js';
import { loadMonaco, monacoWanted, setVariableSource, checkJson, withStandIns, createBodyEditor, createResponseViewer } from './editor.js';
import { findEndpoint, requestSchema, responseFor, compare, locate, rangesFor } from './contract.js';
import { listDesigns, onDesignsChange } from './designer.js';

const HISTORY_LIMIT = 50;
const EXPORT_FORMAT = 'api-workbench-requests';
const SCOPE_LABEL = { local: '', private: ' (only me)', shared: ' (shared)' };
const UNTITLED = 'Untitled request';

// Open request tabs. The active tab's fields are mirrored in the variables below, which
// the rest of this file works on; stashActive() writes them back into the tab.
let tabs = []; // [{ id, req, saved, name, response }]
let activeId = null;
let req = blankRequest();
let currentSaved = null; // { collectionKey, id } of the saved request this tab edits, if any
let currentName = UNTITLED;
let lastResponse = null;

let params = [];
let history = load('history', []);
let sideTab = 'saved';
const inFlight = new Map(); // tab id -> AbortController

// Monaco editors, once loaded (editor.js). Until then, and if it never loads, the plain
// textarea and <pre> do the job.
let bodyEditor = null;
let resViewer = null;

// The designed endpoint the active tab's request matches, if any (contract.js).
let contract = null;
let reportOpen = false;
let openDesign = () => {};

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
    // Set by the Designer's "Try it": which designed endpoint this request is for.
    design: r.design?.apiId && r.design?.endpointId ? { apiId: r.design.apiId, endpointId: r.design.endpointId } : null,
  };
}

const clone = (value) => JSON.parse(JSON.stringify(value));

// ---------------------------------------------------------------- tabs

function makeTab(request = blankRequest(), { saved = null, name = UNTITLED } = {}) {
  return { id: uid(), req: normalize(clone(request)), saved, name, response: null };
}

const activeTab = () => tabs.find((t) => t.id === activeId);

function stashActive() {
  const tab = activeTab();
  if (tab) Object.assign(tab, { req, saved: currentSaved, name: currentName, response: lastResponse });
}

function tabTitle(tab) {
  if (tab.name !== UNTITLED) return tab.name;
  return tab.req.url.replace(/^https?:\/\//, '') || UNTITLED;
}

/** A tab nobody has typed into yet: opening something reuses it rather than adding a tab. */
function isPristine(tab) {
  const r = tab.req;
  return !tab.saved && tab.name === UNTITLED && !r.url && !r.headers.length && r.body.type === 'none' && r.auth.type === 'none';
}

function activate(id) {
  stashActive();
  const tab = tabs.find((t) => t.id === id) || tabs[0];
  activeId = tab.id;
  ({ req, saved: currentSaved, name: currentName, response: lastResponse } = tab);
  renderRequest();
  if (lastResponse) showResponse(lastResponse); else clearResponse();
  updateSendButton();
  renderTabs();
  renderSide();
  persistTabs();
}

function newTab(request, options) {
  stashActive();
  const tab = makeTab(request, options);
  tabs.push(tab);
  activate(tab.id);
}

function closeTab(id) {
  inFlight.get(id)?.abort();
  stashActive();
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  tabs.splice(i, 1);
  if (!tabs.length) tabs.push(makeTab());
  if (id === activeId) {
    activeId = null; // nothing to stash: that tab is gone
    activate(tabs[Math.min(i, tabs.length - 1)].id);
  } else {
    renderTabs();
    persistTabs();
  }
}

function renderTabs() {
  stashActive();
  $('#req-tabs').replaceChildren(
    ...tabs.map((tab) => h('div', {
      class: `req-tab${tab.id === activeId ? ' active' : ''}`, role: 'tab', title: tabTitle(tab),
      onclick: () => { if (tab.id !== activeId) activate(tab.id); },
      onauxclick: (e) => { if (e.button === 1) closeTab(tab.id); }, // middle click closes, as in browsers
    },
    h('span', { class: `method ${tab.req.method}`, text: tab.req.method }),
    h('span', { class: 'req-tab-label', text: tabTitle(tab) }),
    inFlight.has(tab.id) ? h('span', { class: 'req-tab-busy', title: 'Sending…' }) : null,
    h('button', { type: 'button', class: 'req-tab-close', title: 'Close tab', text: '×', onclick: (e) => { e.stopPropagation(); closeTab(tab.id); } }))),
    h('button', { type: 'button', class: 'req-tab-new', title: 'New tab', text: '+', onclick: () => newTab() }),
  );
  $('#req-tabs .req-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

let persistTimer;
/** Saves the open tabs (requests only: responses can be large and are not worth keeping). */
function persistTabs() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    stashActive();
    save('tabs', { activeId, tabs: tabs.map(({ response, ...tab }) => tab) });
  }, 250);
}

/** Opens a request: in the tab already holding that saved request, in an empty tab, or in a new one. */
export function loadRequest(request, { saved = null, name = UNTITLED } = {}) {
  stashActive();
  if (saved) {
    const open = tabs.find((t) => t.saved?.collectionKey === saved.collectionKey && t.saved.id === saved.id);
    if (open) return activate(open.id);
  }
  const tab = activeTab();
  if (tab && isPristine(tab)) {
    Object.assign(tab, { req: normalize(clone(request)), saved, name, response: null });
    activeId = null; // force a full reload of the reused tab
    return activate(tab.id);
  }
  newTab(request, { saved, name });
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
    onChange: () => {
      req.url = buildUrl(req.url, params);
      $('#req-url').value = req.url;
      updateUrlPreview();
      renderTabs();
      persistTabs();
    },
  });
}

function renderHeaders() {
  renderKvTable($('#headers-table'), req.headers, {
    onChange: () => { updateHeaderCount(); persistTabs(); },
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
  const textual = type === 'json' || type === 'text';
  const useEditor = !!bodyEditor && textual;
  $('#body-text').classList.toggle('hidden', !textual || useEditor);
  $('#body-text').value = req.body.text;
  $('#body-editor').classList.toggle('hidden', !useEditor);
  if (useEditor) {
    bodyEditor.setLanguage(type === 'json' ? 'json' : 'plaintext');
    bodyEditor.setValue(req.body.text);
  }
  $('#btn-format-body').classList.toggle('hidden', type !== 'json');
  $('#body-form-table').classList.toggle('hidden', type !== 'form');
  $('#body-none-hint').classList.toggle('hidden', type !== 'none');
  if (type === 'form') {
    renderKvTable($('#body-form-table'), req.body.form, { onChange: persistTabs });
  }
  updateBodyStatus();
}

/**
 * The line under the body, and underlines in the editor: first is it JSON at all, then,
 * when the request matches a designed endpoint, how it differs from the design's example.
 * {{variables}} are allowed throughout.
 */
function updateBodyStatus() {
  const el = $('#body-status');
  el.className = 'hint';
  el.textContent = '';
  bodyEditor?.setProblems([]);
  if (req.body.type !== 'json' || !req.body.text.trim()) return;

  const error = checkJson(req.body.text);
  if (error) {
    el.textContent = `Line ${error.line}, column ${error.column}: ${error.message}`;
    el.classList.add('error');
    bodyEditor?.setProblems([{ ...error, severity: 'error' }]);
    return;
  }

  const schema = contract ? requestSchema(contract.endpoint) : null;
  if (!schema) {
    el.textContent = hasVariables(req.body.text) ? 'Valid JSON ({{variables}} are filled in when sent)' : 'Valid JSON';
    el.classList.add('ok');
    return;
  }
  const text = withStandIns(req.body.text);
  const issues = compare(JSON.parse(text), schema);
  bodyEditor?.setProblems(rangesFor(issues, locate(text)));
  if (!issues.length) {
    el.textContent = 'Valid JSON, matches the design';
    el.classList.add('ok');
  } else {
    const errors = issues.filter((i) => i.severity === 'error').length;
    el.textContent = `Valid JSON, ${issues.length} difference${issues.length === 1 ? '' : 's'} from the design`
      + (bodyEditor ? ' (underlined)' : `: ${issues.slice(0, 3).map((i) => i.message).join('; ')}`);
    el.classList.add(errors ? 'error' : 'warn');
  }
}

/**
 * Works out which designed endpoint the request is, and refreshes everything that
 * depends on it: the chip by the title, the body's suggestions and check, the response check.
 */
function updateContract() {
  const { request } = resolveRequest(req, activeVariables());
  contract = findEndpoint(listDesigns(), { method: req.method, url: request.url, design: req.design });

  const chip = $('#design-chip');
  chip.classList.toggle('hidden', !contract);
  if (contract) {
    const { api, endpoint, how } = contract;
    chip.replaceChildren(
      h('span', { class: 'design-chip-api', text: api.title || 'Untitled API' }),
      ' › ',
      h('span', { class: `method ${endpoint.method}`, text: endpoint.method }),
      h('span', { class: 'design-chip-path', text: endpoint.path }));
    chip.title = `${how === 'linked' ? 'Opened from' : 'Matches'} this endpoint in the Designer: the body and the response are checked against it. Click to open it.`;
  }

  bodyEditor?.setSchema(contract ? requestSchema(contract.endpoint) : null);
  updateBodyStatus();
  if (lastResponse?.ok) renderContractCheck(lastResponse);
}

/** How a response compares with the design. Null when the request matches no design. */
function checkResponse(data) {
  if (!contract) return null;
  const { response, schema, documented } = responseFor(contract.endpoint, data.status);
  if (!response) {
    return { state: 'diff', summary: `Status ${data.status} is not in the design`, items: [documented.length ? `The design lists: ${documented.join(', ')}` : 'The design lists no responses.'] };
  }
  if (!schema) return { state: 'info', summary: `Status ${response.status} is in the design (no JSON example to check the body against)`, items: [] };
  if (data.bodyEncoding !== 'text') return { state: 'info', summary: 'Binary body: not checked against the design', items: [] };
  let value;
  try {
    value = JSON.parse(data.body);
  } catch {
    return { state: 'diff', summary: 'The design expects JSON; this body is not JSON', items: [] };
  }
  const issues = compare(value, schema);
  if (!issues.length) return { state: 'ok', summary: 'Matches the design', items: [] };
  const count = issues.length >= 50 ? '50+' : issues.length;
  return { state: 'diff', summary: `${count} difference${issues.length === 1 ? '' : 's'} from the design`, items: issues.map((i) => i.message) };
}

/** The pill in the response line, and the list of differences under it. */
function renderContractCheck(data) {
  $('#response-meta .contract-pill')?.remove();
  const report = $('#contract-report');
  const result = data?.ok ? checkResponse(data) : null;
  if (!result) {
    report.classList.add('hidden');
    return;
  }
  const icon = { ok: '✓', diff: '⚠', info: 'ℹ' }[result.state];
  const pill = h('button', {
    type: 'button', class: `contract-pill contract-${result.state}`, text: `${icon} ${result.summary}`,
    title: result.items.length ? 'Show or hide the differences' : `Checked against ${contract.api.title} › ${contract.endpoint.method} ${contract.endpoint.path}`,
    onclick: () => {
      if (!result.items.length) return;
      reportOpen = !reportOpen;
      report.classList.toggle('hidden', !reportOpen);
    },
  });
  $('#response-meta').append(pill);
  report.replaceChildren(
    h('div', { class: 'contract-report-head', text: `Compared with ${contract.api.title} › ${contract.endpoint.method} ${contract.endpoint.path}` }),
    h('ul', {}, ...result.items.map((item) => h('li', { text: item }))));
  report.classList.toggle('hidden', !result.items.length || !reportOpen);
}

/** Under the URL bar: what {{variables}} in the URL turn into with the active environment. */
function updateUrlPreview() {
  const el = $('#url-preview');
  if (!hasVariables(req.url)) {
    el.classList.add('hidden');
    return;
  }
  const { request, missing } = resolveRequest(req, activeVariables());
  el.className = `url-preview${missing.length ? ' error' : ''}`;
  el.textContent = missing.length
    ? `No value for ${missing.map((n) => `{{${n}}}`).join(', ')}${activeEnvironment() ? ` in “${activeEnvironment().name}”` : ': choose an environment'}`
    : `→ ${request.url}`;
}

function renderRequestName() {
  const el = $('#request-name');
  el.textContent = currentName !== UNTITLED ? currentName : (req.url || UNTITLED);
  el.classList.toggle('untitled', currentName === UNTITLED);
}

function renderRequest() {
  $('#req-method').value = req.method;
  $('#req-method').className = `method-select m-${req.method}`;
  $('#req-url').value = req.url;
  renderRequestName();
  params = parseParams(req.url);
  renderParams();
  renderHeaders();
  renderAuth();
  renderBody();
  updateUrlPreview();
  updateContract();
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

  const row = [select];
  if (serverStorage()) {
    row.push(h('button', { class: 'btn small icon-only', title: 'New collection', text: '+', onclick: newCollectionDialog }));
    if (current.scope !== 'local') row.push(h('button', { class: 'btn small', text: 'Settings', onclick: () => collectionDialog(current) }));
  }
  const children = [h('div', { class: 'side-actions' }, ...row)];
  if (current.scope === 'shared') {
    children.push(h('p', { class: 'hint', text: `Shared by ${current.owner}${current.updatedBy ? ` · last saved by ${current.updatedBy}` : ''}` }));
  }
  if (session.auth === 'login' && session.signedIn && session.storageError) {
    children.push(h('p', { class: 'hint error', text: `Saving to the server is unavailable: ${session.storageError}` }));
  }
  bar.replaceChildren(...children);
}

/** "Today", "Yesterday", or the date. */
function dayLabel(ts) {
  const day = new Date(ts);
  const today = new Date();
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startOf(today) - startOf(day)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

function timeOf(ts) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

const matches = (filter, ...fields) => !filter || fields.some((f) => String(f ?? '').toLowerCase().includes(filter));

function renderSide() {
  const filter = $('#side-filter').value.trim().toLowerCase();
  $('#side-title').textContent = sideTab === 'saved' ? 'Saved' : 'History';
  $('#collection-bar').classList.toggle('hidden', sideTab !== 'saved');
  $('#saved-actions').classList.toggle('hidden', sideTab !== 'saved');
  $('#history-actions').classList.toggle('hidden', sideTab !== 'history');
  $$('#side-tabs .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.side === sideTab));

  const list = $('#side-list');
  if (sideTab === 'saved') {
    renderCollectionBar();
    const collection = currentCollection();
    const requests = collection.requests.filter((item) => matches(filter, item.name, item.request.url, item.request.method));
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
      )) : [h('li', { class: 'empty', text: filter ? 'Nothing matches the filter.' : 'No saved requests in this collection yet. Use Save to add one.' })]),
    );
  } else {
    const items = history.filter((item) => matches(filter, item.displayUrl, item.request.url, item.request.method, item.status));
    const rows = [];
    let group = null;
    for (const item of items) {
      const label = dayLabel(item.at);
      if (label !== group) {
        group = label;
        rows.push(h('li', { class: 'group-label', text: label }));
      }
      rows.push(h('li', {
        title: `${item.displayUrl || item.request.url}\n${item.status} · ${timeOf(item.at)}`,
        onclick: () => loadRequest(item.request),
      },
      h('span', { class: `method ${item.request.method}`, text: item.request.method }),
      h('span', { class: 'label', text: (item.displayUrl || item.request.url).replace(/^https?:\/\//, '') }),
      h('button', {
        class: 'btn icon remove', title: 'Remove from history', text: '×',
        onclick: (e) => { e.stopPropagation(); deleteHistory(item.id); },
      })));
    }
    list.replaceChildren(...(rows.length ? rows : [h('li', { class: 'empty', text: filter ? 'Nothing matches the filter.' : 'Requests you send appear here.' })]));
  }
  renderSideFoot();
}

/** The footer card inviting people to share, shown while they only use the browser collection. */
function renderSideFoot() {
  const foot = $('#side-foot');
  const show = sideTab === 'saved' && serverStorage() && currentCollection().scope === 'local';
  foot.classList.toggle('hidden', !show);
  if (!show) return;
  foot.replaceChildren(
    h('strong', { text: 'Create collections' }),
    h('p', { text: 'Collections are saved on the server, so they follow you to any machine and can be shared with your team.' }),
    h('button', { class: 'btn small', text: 'Create a Collection', onclick: newCollectionDialog }),
  );
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
  const suggested = currentName !== UNTITLED ? currentName : suggestName();
  const name = prompt(`Save to “${collection.name}” as:`, suggested);
  if (name === null) return;
  const item = { id: uid(), name: name.trim() || suggested, request: clone(req) };
  const ok = await updateRequests(collection, (list) => list.unshift(item));
  if (ok) {
    currentSaved = { collectionKey: collection.key, id: item.id };
    currentName = item.name;
    renderRequestName();
    renderTabs();
    persistTabs();
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
  const name = prompt('Rename request:', currentName !== UNTITLED ? currentName : suggestName());
  if (name === null || !name.trim()) return;
  currentName = name.trim();
  renderRequestName();
  renderTabs();
  const collection = editingInCurrent();
  if (collection) {
    await updateRequests(collection, (list) => {
      const item = list.find((x) => x.id === currentSaved.id);
      if (item) item.name = currentName;
    });
    renderSide();
  }
  persistTabs();
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

async function importFile() {
  const file = await pickFile('.json,application/json');
  if (!file) return false;
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
    return true;
  } catch (e) {
    toast(`Import failed: ${e.message}`, 'error');
    return false;
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

// ---------------------------------------------------------------- import, code out

function importCurl(text) {
  try {
    const { request, warnings } = parseCurl(text);
    loadRequest(request, { name: UNTITLED });
    toast(warnings.length ? `Imported, with notes: ${warnings.join(' ')}` : 'Imported from curl', warnings.length ? 'error' : 'info');
    return true;
  } catch (e) {
    toast(`Could not read that curl command: ${e.message}`, 'error');
    return false;
  }
}

/** One Import for everything: a pasted curl command, or a collection file. */
function importDialog() {
  const input = h('textarea', { class: 'code', rows: 9, spellcheck: false, placeholder: "curl -X POST 'https://api.example.com/users' \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"name\":\"Ada\"}'" });
  const modal = openModal({
    title: 'Import',
    size: 'modal-lg',
    body: h('div', {},
      h('div', { class: 'form-group' },
        h('label', { text: 'Paste a curl command' }),
        input,
        h('p', { class: 'hint', text: 'From your browser\'s DevTools (Network → right-click → Copy as cURL) or from API docs. It opens in a new tab. Pasting one into the URL box works too.' })),
      h('div', { class: 'import-or' }, h('span', { text: 'or' })),
      h('div', { class: 'form-group' },
        h('label', { text: `Import a collection file into “${currentCollection().name}”` }),
        h('div', {}, h('button', {
          class: 'btn', type: 'button', text: 'Choose file…',
          onclick: async () => { if (await importFile()) modal.close(); },
        })),
        h('p', { class: 'hint', text: 'A .json file made with Export.' }))),
    actions: [
      h('button', { class: 'btn', text: 'Cancel', onclick: () => modal.close() }),
      h('button', { class: 'btn primary', text: 'Import curl', onclick: () => { if (importCurl(input.value)) modal.close(); } }),
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
  const tabsEl = h('div', { class: 'seg' });
  const render = () => {
    pre.textContent = GENERATORS.find((g) => g.id === current).fn(outgoing);
    tabsEl.replaceChildren(...GENERATORS.map((g) => h('button', {
      class: `seg-btn${g.id === current ? ' active' : ''}`, type: 'button', text: g.label,
      onclick: () => { current = g.id; save('codeLanguage', current); render(); },
    })));
  };
  render();

  const notes = [];
  if (missing.length) notes.push(h('p', { class: 'hint error', text: `No value for ${missing.map((n) => `{{${n}}}`).join(', ')}: left as written.` }));
  if (activeEnvironment() && !missing.length) notes.push(h('p', { class: 'hint', text: `Variables filled in from “${activeEnvironment().name}”. The code contains their values, tokens included.` }));

  const modal = openModal({
    title: 'Code snippet',
    size: 'modal-lg',
    body: h('div', {}, h('div', { class: 'form-row' }, tabsEl), ...notes, pre),
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

function updateSendButton() {
  $('#btn-send').textContent = inFlight.has(activeId) ? 'Cancel' : 'Send';
}

/** Puts a response on its tab, and on screen if that tab is still the one showing. */
function deliver(tabId, data) {
  const tab = tabs.find((t) => t.id === tabId);
  if (!tab) return;
  if (tabId === activeId) showResponse(data);
  else tab.response = data;
}

async function send() {
  const tabId = activeId;
  if (inFlight.has(tabId)) {
    inFlight.get(tabId).abort();
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

  const sent = clone(req); // history records what was sent, even if the tab is edited meanwhile
  const controller = new AbortController();
  inFlight.set(tabId, controller);
  updateSendButton();
  renderTabs();
  $('#response-empty').classList.add('hidden');
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
    deliver(tabId, data);
    addHistory(sent, outgoing.url, data.ok ? String(data.status) : data.error?.code || 'ERROR');
  } catch (e) {
    deliver(tabId, e.name === 'AbortError'
      ? { ok: false, error: { code: 'CANCELLED', message: 'Request cancelled.' } }
      : { ok: false, error: { code: 'NETWORK_ERROR', message: e.message } });
  } finally {
    inFlight.delete(tabId);
    updateSendButton();
    renderTabs();
  }
}

/** History keeps the request as written ({{variables}} intact) and the URL it resolved to. */
function addHistory(request, displayUrl, status) {
  history.unshift({ id: uid(), at: Date.now(), status, displayUrl, request: clone(request) });
  history = history.slice(0, HISTORY_LIMIT);
  save('history', history);
  if (sideTab === 'history') renderSide();
}

// ---------------------------------------------------------------- response

function hideResponsePanes() {
  $$('.pane[data-group="res"]').forEach((p) => p.classList.add('hidden'));
}

/** The "Click Send to get a response" state. */
function clearResponse() {
  lastResponse = null;
  $('#response-meta').replaceChildren();
  $('#contract-report').classList.add('hidden');
  $('#response-tabs').classList.add('hidden');
  hideResponsePanes();
  $('#response-empty').classList.remove('hidden');
  setExpanded(false);
}

function showResponse(data) {
  lastResponse = data;
  const meta = $('#response-meta');
  const tabsEl = $('#response-tabs');
  $('#response-empty').classList.add('hidden');

  if (!data.ok) {
    meta.replaceChildren(...[
      h('span', { class: 'status err', text: data.error?.code || 'ERROR' }),
      h('span', { class: 'response-error', text: data.error?.message || 'Unknown error' }),
      data.error?.code === 'NOT_SIGNED_IN' && session.loginUrl
        ? h('a', { class: 'btn small primary', href: session.loginUrl, text: 'Sign in' })
        : null,
    ].filter(Boolean));
    tabsEl.classList.add('hidden');
    $('#contract-report').classList.add('hidden');
    setExpanded(false); // the toolbar holding the collapse button is hidden for errors
    hideResponsePanes();
    $('#res-body').textContent = '';
    $('#res-headers').replaceChildren();
    return;
  }

  // replaceChildren() prints null as the text "null", so optional items are filtered out.
  meta.replaceChildren(...[
    h('span', { class: `status s${String(data.status)[0]}`, text: `${data.status} ${data.statusText || ''}`.trim() }),
    h('span', { class: 'muted', text: `${data.timeMs} ms` }),
    h('span', { class: 'muted', text: formatBytes(data.sizeBytes) }),
    data.truncated ? h('span', { class: 'hint error', text: 'Response was cut off at the server size limit.' }) : null,
  ].filter(Boolean));
  renderContractCheck(data);
  tabsEl.classList.remove('hidden');
  const pane = $('#response-tabs .subtab.active')?.dataset.pane || 'body';
  showPane('res', pane);
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
  // Binary and empty bodies are a sentence, not code: those always use the <pre>.
  const showPre = () => { pre.classList.remove('hidden'); $('#res-editor').classList.add('hidden'); };

  if (data.bodyEncoding === 'base64') {
    showPre();
    pre.replaceChildren(
      `Binary response (${formatBytes(data.sizeBytes)}, ${responseHeader('content-type') || 'unknown type'}). `,
      h('button', { class: 'btn small', text: 'Download', onclick: downloadBinary }),
    );
    return;
  }
  if (data.body === '') {
    showPre();
    pre.replaceChildren(h('span', { class: 'muted', text: '(empty body)' }));
    return;
  }

  const raw = $('#res-raw').checked;
  const contentType = responseHeader('content-type');
  const looksJson = contentType.includes('json') || /^\s*[[{]/.test(data.body);

  if (resViewer) {
    let text = data.body;
    let language = 'plaintext';
    if (looksJson) {
      language = 'json';
      if (!raw) {
        try { text = JSON.stringify(JSON.parse(data.body), null, 2); } catch { language = 'plaintext'; }
      }
    } else if (/xml|html/.test(contentType) || /^\s*</.test(data.body)) {
      language = 'xml';
    }
    pre.classList.add('hidden');
    $('#res-editor').classList.remove('hidden');
    resViewer.show(text, language);
    return;
  }

  showPre();
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

let currentZoom = 1;
function applyZoom(zoom) {
  currentZoom = zoom;
  $('#response-panel').style.setProperty('--res-font', `${BASE_FONT_PX * zoom}px`);
  resViewer?.setFontSize(BASE_FONT_PX * zoom);
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

function restoreTabs() {
  const stored = load('tabs', null);
  if (Array.isArray(stored?.tabs) && stored.tabs.length) {
    tabs = stored.tabs.map((t) => ({ id: t.id || uid(), req: normalize(t.req), saved: t.saved ?? null, name: t.name || UNTITLED, response: null }));
    activeId = tabs.some((t) => t.id === stored.activeId) ? stored.activeId : tabs[0].id;
    return;
  }
  // Before tabs existed, the one open request was kept as a draft.
  const draft = load('draft', null);
  tabs = [draft?.req
    ? makeTab(draft.req, { saved: draft.currentSaved ?? null, name: draft.currentName || UNTITLED })
    : makeTab()];
  activeId = tabs[0].id;
}

/** Swaps in the Monaco editors once they load. The page is usable before, and without, them. */
function startEditors() {
  setVariableSource(activeVariables);
  if (!monacoWanted()) return;
  loadMonaco().then((monaco) => {
    bodyEditor = createBodyEditor(monaco, $('#body-editor'), {
      onChange: (text) => {
        req.body.text = text;
        $('#body-text').value = text;
        updateBodyStatus();
        persistTabs();
      },
    });
    resViewer = createResponseViewer(monaco, $('#res-editor'));
    resViewer.setFontSize(BASE_FONT_PX * currentZoom);
    renderBody();
    renderResponseBody();
  }).catch((e) => {
    console.warn('Monaco did not load; using the plain editors.', e);
  });
}

const testerVisible = () => !$('#view-tester').classList.contains('hidden');

/** @param {{ openDesign?: (apiId: string, endpointId: string) => void }} options */
export function initTester({ openDesign: open } = {}) {
  if (open) openDesign = open;
  restoreTabs();
  const first = activeId;
  activeId = null; // nothing to stash yet
  activate(first);

  $('#request-form').addEventListener('submit', (e) => { e.preventDefault(); send(); });
  $('#req-method').addEventListener('change', (e) => {
    req.method = e.target.value;
    e.target.className = `method-select m-${req.method}`;
    updateContract();
    renderTabs();
    persistTabs();
  });
  $('#req-url').addEventListener('input', (e) => {
    req.url = e.target.value;
    params = parseParams(req.url);
    renderParams();
    updateUrlPreview();
    updateContract();
    renderRequestName();
    renderTabs();
    persistTabs();
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
  $('#btn-import').addEventListener('click', importDialog);
  $('#btn-code').addEventListener('click', codeDialog);
  $('#request-name').addEventListener('click', renameCurrent);
  $('#request-name').title = 'Click to rename';

  wireSubtabs($('.subtabs[data-group="req"]'), 'req');
  wireSubtabs($('#response-tabs'), 'res');

  $('#auth-type').addEventListener('change', (e) => { req.auth.type = e.target.value; renderAuth(); persistTabs(); });
  for (const field of ['token', 'username', 'password']) {
    $(`#auth-${field}`).addEventListener('input', (e) => { req.auth[field] = e.target.value; persistTabs(); });
  }

  $('#body-type').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    req.body.type = btn.dataset.body;
    renderBody();
    persistTabs();
  });
  $('#body-text').addEventListener('input', (e) => { req.body.text = e.target.value; updateBodyStatus(); persistTabs(); });
  $('#btn-format-body').addEventListener('click', () => {
    try {
      req.body.text = JSON.stringify(JSON.parse(req.body.text), null, 2);
      $('#body-text').value = req.body.text;
      bodyEditor?.setValue(req.body.text);
      updateBodyStatus();
      persistTabs();
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
  $('#side-filter').addEventListener('input', renderSide);
  $('#btn-new-request').addEventListener('click', () => newTab());
  $('#btn-export-saved').addEventListener('click', exportSaved);
  $('#btn-clear-history').addEventListener('click', () => {
    if (!history.length || !confirm('Clear all request history?')) return;
    history = [];
    save('history', history);
    renderSide();
  });

  onEnvironmentChange(() => {
    updateUrlPreview();
    updateContract();
    bodyEditor?.refreshVariables();
  });
  onDesignsChange(updateContract);
  $('#design-chip').addEventListener('click', () => {
    if (contract) openDesign(contract.api.id, contract.endpoint.id);
  });
  startEditors();

  document.addEventListener('keydown', (e) => {
    if (!testerVisible() || !(e.ctrlKey || e.metaKey) || document.querySelector('.modal')) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      send();
    } else if (e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveCurrent();
    }
  });
}
