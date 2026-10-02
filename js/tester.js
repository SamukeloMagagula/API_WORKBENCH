// The Tester tab: build a request, send it through proxy.php, show the response.
// Saved requests, history and the current draft are kept in localStorage.

import { $, $$, h, toast, downloadFile, pickFile, copyText, wireSubtabs, showPane, highlightJson, formatBytes } from './dom.js';
import { load, save, uid } from './storage.js';
import { renderKvTable } from './kvtable.js';

const HISTORY_LIMIT = 50;
const EXPORT_FORMAT = 'api-workbench-requests';

let req = blankRequest();
let params = [];
let currentSavedId = null;
let currentName = 'Untitled request';
let saved = load('saved', []);
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
  draftTimer = setTimeout(() => save('draft', { req, currentSavedId, currentName }), 250);
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

function buildUrl(url, rows) {
  const { base, hash } = splitUrl(url);
  const query = rows
    .filter((r) => r.name)
    .map((r) => encodeURIComponent(r.name) + (r.value !== '' ? '=' + encodeURIComponent(r.value) : ''))
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
  try {
    JSON.parse(req.body.text);
    el.textContent = 'Valid JSON';
    el.classList.add('ok');
  } catch (e) {
    el.textContent = e.message;
    el.classList.add('error');
  }
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
}

/** Replaces the editor contents with a request (from saved, history or the designer's "Try it"). */
export function loadRequest(request, { savedId = null, name = 'Untitled request' } = {}) {
  req = normalize(clone(request));
  currentSavedId = savedId;
  currentName = name;
  renderRequest();
  renderSide();
  persistDraft();
}

// ---------------------------------------------------------------- sidebar: saved + history

function renderSide() {
  $('#saved-actions').classList.toggle('hidden', sideTab !== 'saved');
  $('#history-actions').classList.toggle('hidden', sideTab !== 'history');
  $$('#side-tabs .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.side === sideTab));

  const list = $('#side-list');
  if (sideTab === 'saved') {
    list.replaceChildren(
      ...(saved.length ? saved.map((item) => h('li', {
        class: item.id === currentSavedId ? 'active' : '',
        title: item.request.url,
        onclick: () => loadRequest(item.request, { savedId: item.id, name: item.name }),
      },
      h('span', { class: `method ${item.request.method}`, text: item.request.method }),
      h('span', { class: 'label', text: item.name }),
      h('button', {
        class: 'btn icon remove', title: 'Delete', text: '×',
        onclick: (e) => { e.stopPropagation(); deleteSaved(item.id); },
      }),
      )) : [h('li', { class: 'empty', text: 'No saved requests yet. Use Save to keep one here.' })]),
    );
  } else {
    list.replaceChildren(
      ...(history.length ? history.map((item) => h('li', {
        title: item.request.url,
        onclick: () => loadRequest(item.request),
      },
      h('span', { class: `method ${item.request.method}`, text: item.request.method }),
      h('span', { class: 'label' },
        item.request.url.replace(/^https?:\/\//, ''),
        h('div', { class: 'sub', text: `${item.status} · ${timeAgo(item.at)}` })),
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

function saveCurrent() {
  if (currentSavedId) {
    const item = saved.find((x) => x.id === currentSavedId);
    if (item) {
      item.request = clone(req);
      item.name = currentName;
      save('saved', saved);
      renderSide();
      toast(`Saved “${item.name}”`);
      return;
    }
  }
  const suggested = currentName !== 'Untitled request' ? currentName : suggestName();
  const name = prompt('Name this request:', suggested);
  if (name === null) return;
  const item = { id: uid(), name: name.trim() || suggested, request: clone(req) };
  saved.unshift(item);
  save('saved', saved);
  currentSavedId = item.id;
  currentName = item.name;
  $('#request-name').textContent = currentName;
  sideTab = 'saved';
  renderSide();
  persistDraft();
  toast(`Saved “${item.name}”`);
}

function suggestName() {
  const { base } = splitUrl(req.url);
  const path = base.replace(/^[a-z]+:\/\/[^/]+/i, '') || '/';
  return `${req.method} ${path}`;
}

function renameCurrent() {
  const name = prompt('Rename request:', currentName);
  if (name === null || !name.trim()) return;
  currentName = name.trim();
  $('#request-name').textContent = currentName;
  const item = saved.find((x) => x.id === currentSavedId);
  if (item) {
    item.name = currentName;
    save('saved', saved);
    renderSide();
  }
  persistDraft();
}

function deleteSaved(id) {
  const item = saved.find((x) => x.id === id);
  if (!item || !confirm(`Delete “${item.name}”?`)) return;
  saved = saved.filter((x) => x.id !== id);
  save('saved', saved);
  if (currentSavedId === id) currentSavedId = null;
  renderSide();
}

function exportSaved() {
  if (!saved.length) return toast('Nothing to export yet.', 'error');
  const payload = { format: EXPORT_FORMAT, version: 1, exportedAt: new Date().toISOString(), items: saved };
  downloadFile('api-workbench-requests.json', JSON.stringify(payload, null, 2));
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
    saved = [...imported, ...saved];
    save('saved', saved);
    sideTab = 'saved';
    renderSide();
    toast(`Imported ${imported.length} request${imported.length === 1 ? '' : 's'}`);
  } catch (e) {
    toast(`Import failed: ${e.message}`, 'error');
  }
}

// ---------------------------------------------------------------- sending

function buildOutgoing() {
  let url = req.url.trim();
  if (url && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = 'http://' + url;

  const headers = req.headers
    .filter((x) => x.enabled !== false && x.name.trim())
    .map((x) => ({ name: x.name.trim(), value: x.value }));
  const has = (name) => headers.some((x) => x.name.toLowerCase() === name);

  if (!has('authorization')) {
    if (req.auth.type === 'bearer' && req.auth.token) {
      headers.push({ name: 'Authorization', value: `Bearer ${req.auth.token}` });
    } else if (req.auth.type === 'basic' && (req.auth.username || req.auth.password)) {
      const bytes = new TextEncoder().encode(`${req.auth.username}:${req.auth.password}`);
      headers.push({ name: 'Authorization', value: `Basic ${btoa(String.fromCharCode(...bytes))}` });
    }
  }

  let body = null;
  const contentTypes = { json: 'application/json', text: 'text/plain', form: 'application/x-www-form-urlencoded' };
  if (req.body.type === 'json' || req.body.type === 'text') {
    body = req.body.text;
  } else if (req.body.type === 'form') {
    const form = new URLSearchParams();
    req.body.form.filter((x) => x.enabled !== false && x.name).forEach((x) => form.append(x.name, x.value));
    body = form.toString();
  }
  if (body !== null && contentTypes[req.body.type] && !has('content-type')) {
    headers.push({ name: 'Content-Type', value: contentTypes[req.body.type] });
  }

  return { method: req.method, url, headers, body };
}

async function send() {
  if (inFlight) {
    inFlight.abort();
    return;
  }
  const outgoing = buildOutgoing();
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
      headers: { 'Content-Type': 'application/json' },
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

function addHistory(url, status) {
  history.unshift({ id: uid(), at: Date.now(), status, request: { ...clone(req), url } });
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
    meta.replaceChildren(
      h('span', { class: 'status err', text: data.error?.code || 'ERROR' }),
      h('span', { text: data.error?.message || 'Unknown error' }),
    );
    tabs.classList.add('hidden');
    $('#res-body').textContent = '';
    $('#res-headers').replaceChildren();
    showPane('res', 'body');
    return;
  }

  meta.replaceChildren(
    h('span', { class: `status s${String(data.status)[0]}`, text: `${data.status} ${data.statusText || ''}`.trim() }),
    h('span', { class: 'muted', text: `${data.timeMs} ms` }),
    h('span', { class: 'muted', text: formatBytes(data.sizeBytes) }),
    data.truncated ? h('span', { class: 'hint error', text: 'Response was cut off at the server size limit.' }) : null,
  );
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

// ---------------------------------------------------------------- wiring

export function initTester() {
  const draft = load('draft', null);
  if (draft?.req) {
    req = normalize(draft.req);
    currentSavedId = saved.some((x) => x.id === draft.currentSavedId) ? draft.currentSavedId : null;
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
    persistDraft();
  });
  $('#btn-save').addEventListener('click', saveCurrent);
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

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !$('#view-tester').classList.contains('hidden')) {
      e.preventDefault();
      send();
    }
  });
}
