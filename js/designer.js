// The Designer tab: describe APIs endpoint by endpoint and export them as OpenAPI 3.
// Runs entirely in the browser; designs are kept in localStorage.

import { $, $$, h, toast, downloadFile, pickFile, copyText, highlightJson } from './dom.js';
import { load, save, uid } from './storage.js';
import {
  METHODS, PARAM_TYPES, PARAM_LOCATIONS, newApi, newEndpoint, newResponse, pathParamNames,
  toOpenApi, toJson, toYaml, parseSpecText, fromOpenApi, validateApi, toTesterRequest,
} from './openapi.js';

let apis = load('apis', null) ?? [sampleApi()];
let currentApiId = load('designer.api', null);
let currentEndpointId = load('designer.endpoint', null);
let previewFormat = load('designer.format', 'yaml');
let onTryIt = () => {};

function sampleApi() {
  const api = newApi('Users API (example)');
  api.description = 'An example to show how the designer works. Edit it or delete it.';
  api.servers = ['https://api.example.com/v1'];

  const list = newEndpoint('GET', '/users');
  list.summary = 'List users';
  list.tags = ['users'];
  list.parameters = [{ name: 'page', in: 'query', type: 'integer', required: false, description: 'Page number, starting at 1' }];
  list.responses[0].example = JSON.stringify([{ id: 1, name: 'Ada Lovelace', email: 'ada@example.com' }], null, 2);

  const get = newEndpoint('GET', '/users/{id}');
  get.summary = 'Get one user';
  get.tags = ['users'];
  get.parameters = [{ name: 'id', in: 'path', type: 'integer', required: true, description: 'User ID' }];
  get.responses = [
    { ...newResponse('200'), example: JSON.stringify({ id: 1, name: 'Ada Lovelace', email: 'ada@example.com' }, null, 2) },
    { ...newResponse('404'), example: JSON.stringify({ error: 'User not found' }, null, 2) },
  ];

  const create = newEndpoint('POST', '/users');
  create.summary = 'Create a user';
  create.tags = ['users'];
  create.requestBody = { enabled: true, contentType: 'application/json', example: JSON.stringify({ name: 'Ada Lovelace', email: 'ada@example.com' }, null, 2) };
  create.responses = [
    { ...newResponse('201'), example: JSON.stringify({ id: 2, name: 'Ada Lovelace', email: 'ada@example.com' }, null, 2) },
    { ...newResponse('400'), example: JSON.stringify({ error: 'email is required' }, null, 2) },
  ];

  api.endpoints = [list, get, create];
  return api;
}

const currentApi = () => apis.find((a) => a.id === currentApiId);
const currentEndpoint = () => currentApi()?.endpoints.find((e) => e.id === currentEndpointId);

/** Saves, then refreshes everything outside the endpoint editor (so typing keeps focus). */
function commit() {
  save('apis', apis);
  save('designer.api', currentApiId);
  save('designer.endpoint', currentEndpointId);
  renderApiSelect();
  renderEndpointList();
  renderPreview();
}

function selectApi(id) {
  currentApiId = id;
  currentEndpointId = currentApi()?.endpoints[0]?.id ?? null;
  renderAll();
  commit();
}

function selectEndpoint(id) {
  currentEndpointId = id;
  renderEditor();
  commit();
}

function renderAll() {
  renderApiInfo();
  renderEditor();
}

// ---------------------------------------------------------------- sidebar

function renderApiSelect() {
  const select = $('#api-select');
  select.replaceChildren(...apis.map((a) => h('option', { value: a.id, text: a.title || 'Untitled API', selected: a.id === currentApiId })));
}

function renderApiInfo() {
  const api = currentApi();
  const box = $('#api-info');
  if (!api) return box.replaceChildren();

  const field = (label, el) => h('label', {}, label, el);
  box.replaceChildren(
    field('Title', h('input', { type: 'text', value: api.title, oninput: (e) => { api.title = e.target.value; commit(); } })),
    field('Version', h('input', { type: 'text', value: api.version, oninput: (e) => { api.version = e.target.value; commit(); } })),
    field('Description', h('textarea', { rows: 2, value: api.description, oninput: (e) => { api.description = e.target.value; commit(); } })),
    field('Server URLs (one per line)', h('textarea', {
      rows: 2, class: 'code', value: api.servers.join('\n'), placeholder: 'https://api.example.com/v1', spellcheck: false,
      oninput: (e) => { api.servers = e.target.value.split('\n'); commit(); },
    })),
  );
}

function renderEndpointList() {
  const api = currentApi();
  const list = $('#endpoint-list');
  if (!api) return list.replaceChildren();
  const withProblems = new Set(validateApi(api).map((p) => p.endpointId));

  list.replaceChildren(
    ...(api.endpoints.length ? api.endpoints.map((ep) => h('li', {
      class: ep.id === currentEndpointId ? 'active' : '',
      onclick: () => selectEndpoint(ep.id),
      title: ep.summary || ep.path,
    },
    h('span', { class: `method ${ep.method}`, text: ep.method }),
    h('span', { class: 'label', text: ep.path || '/' }),
    withProblems.has(ep.id) ? h('span', { class: 'sub', title: 'Has problems, see the list above the preview', text: '⚠' }) : null,
    )) : [h('li', { class: 'empty', text: 'No endpoints yet. Use + Add.' })]),
  );
}

// ---------------------------------------------------------------- endpoint editor

function section(title, actions, ...content) {
  return h('div', { class: 'editor-section' }, h('h3', {}, title, h('span', { class: 'spacer' }), ...actions), ...content);
}

function renderEditor() {
  const editor = $('#endpoint-editor');
  const api = currentApi();
  const ep = currentEndpoint();
  if (!api || !ep) {
    editor.replaceChildren(h('div', { class: 'empty-state' },
      h('p', { text: api ? 'Select an endpoint on the left, or add one.' : 'Create or import an API to start.' })));
    return;
  }

  const set = (fn) => (e) => { fn(e.target); commit(); };

  const basics = section('Endpoint', [
    h('button', { class: 'btn small primary', text: 'Try it', title: 'Open this endpoint in the Tester', onclick: () => onTryIt(toTesterRequest(api, ep), `${ep.method} ${ep.path}`) }),
    h('button', { class: 'btn small', text: 'Duplicate', onclick: duplicateEndpoint }),
    h('button', { class: 'btn small danger', text: 'Delete', onclick: deleteEndpoint }),
  ],
  h('div', { class: 'form-row' },
    h('label', {}, 'Method', h('select', {
      class: 'method-select',
      onchange: set((t) => { ep.method = t.value; }),
    }, ...METHODS.map((m) => h('option', { value: m, text: m, selected: m === ep.method })))),
    h('label', { class: 'grow' }, 'Path', h('input', {
      type: 'text', class: 'url-input', value: ep.path, placeholder: '/users/{id}', spellcheck: false,
      oninput: set((t) => { ep.path = t.value; }),
    })),
  ),
  h('div', { class: 'form-row' },
    h('label', { class: 'grow' }, 'Summary', h('input', { type: 'text', value: ep.summary, placeholder: 'Get one user', oninput: set((t) => { ep.summary = t.value; }) })),
    h('label', {}, 'Tags (comma-separated)', h('input', { type: 'text', value: ep.tags.join(', '), oninput: set((t) => { ep.tags = t.value.split(',').map((s) => s.trim()); }) })),
  ),
  h('label', {}, 'Description', h('textarea', { rows: 2, value: ep.description, oninput: set((t) => { ep.description = t.value; }) })),
  );

  editor.replaceChildren(basics, renderParameters(ep), renderRequestBody(ep), renderResponses(ep));
}

function renderParameters(ep) {
  const rows = ep.parameters.map((p, i) => h('tr', {},
    h('td', {}, h('input', { type: 'text', class: 'mono', value: p.name, placeholder: 'name', oninput: (e) => { p.name = e.target.value; commit(); } })),
    h('td', {}, h('select', {
      onchange: (e) => { p.in = e.target.value; if (p.in === 'path') p.required = true; renderEditor(); commit(); },
    }, ...PARAM_LOCATIONS.map((l) => h('option', { value: l, text: l, selected: l === p.in })))),
    h('td', {}, h('select', { onchange: (e) => { p.type = e.target.value; commit(); } },
      ...PARAM_TYPES.map((t) => h('option', { value: t, text: t, selected: t === p.type })))),
    h('td', {}, h('label', { class: 'check small' }, h('input', {
      type: 'checkbox', checked: p.in === 'path' || p.required, disabled: p.in === 'path',
      onchange: (e) => { p.required = e.target.checked; commit(); },
    }), 'required')),
    h('td', {}, h('input', { type: 'text', value: p.description, placeholder: 'description', oninput: (e) => { p.description = e.target.value; commit(); } })),
    h('td', { class: 'act' }, h('button', { class: 'btn icon', text: '×', title: 'Remove', onclick: () => { ep.parameters.splice(i, 1); renderEditor(); commit(); } })),
  ));

  const undeclared = pathParamNames(ep.path).filter((n) => !ep.parameters.some((p) => p.in === 'path' && p.name === n));

  return section('Parameters', [
    h('button', {
      class: 'btn small', text: '+ Add parameter',
      onclick: () => { ep.parameters.push({ name: '', in: 'query', type: 'string', required: false, description: '' }); renderEditor(); commit(); },
    }),
  ],
  rows.length ? h('table', { class: 'kv-table' }, h('tbody', {}, ...rows)) : h('p', { class: 'hint', text: 'No parameters.' }),
  undeclared.length ? h('p', { class: 'hint' },
    `Path placeholder${undeclared.length > 1 ? 's' : ''} ${undeclared.map((n) => `{${n}}`).join(', ')} will be exported as required strings. `,
    h('button', {
      class: 'btn small', text: 'Declare them',
      onclick: () => {
        undeclared.forEach((name) => ep.parameters.push({ name, in: 'path', type: 'string', required: true, description: '' }));
        renderEditor();
        commit();
      },
    })) : null,
  );
}

function exampleEditor(target, label) {
  const status = h('span', { class: 'hint' });
  const check = () => {
    status.className = 'hint';
    status.textContent = '';
    if (!/json/i.test(target.contentType) || !target.example.trim()) return;
    try { JSON.parse(target.example); status.textContent = 'Valid JSON'; status.classList.add('ok'); } catch (e) { status.textContent = e.message; status.classList.add('error'); }
  };
  const textarea = h('textarea', {
    class: 'code', rows: 6, value: target.example, spellcheck: false, placeholder: '{ "id": 1 }',
    oninput: (e) => { target.example = e.target.value; check(); commit(); },
  });
  check();
  return h('div', {},
    h('div', { class: 'form-row' },
      h('label', {}, 'Content type', h('input', {
        type: 'text', value: target.contentType, spellcheck: false,
        oninput: (e) => { target.contentType = e.target.value; check(); commit(); },
      })),
      h('button', {
        class: 'btn small', text: 'Format JSON',
        onclick: () => {
          try {
            target.example = JSON.stringify(JSON.parse(target.example), null, 2);
            textarea.value = target.example;
            check();
            commit();
          } catch (e) { toast(`Cannot format: ${e.message}`, 'error'); }
        },
      }),
      status,
    ),
    h('label', {}, label, textarea),
  );
}

function renderRequestBody(ep) {
  const rb = ep.requestBody;
  return section('Request body', [
    h('label', { class: 'check small' }, h('input', {
      type: 'checkbox', checked: rb.enabled,
      onchange: (e) => { rb.enabled = e.target.checked; renderEditor(); commit(); },
    }), 'has a body'),
  ],
  rb.enabled
    ? exampleEditor(rb, 'Example (the schema is inferred from it)')
    : h('p', { class: 'hint', text: 'This endpoint takes no request body.' }),
  );
}

function renderResponses(ep) {
  const cards = ep.responses.map((r, i) => h('div', { class: 'response-card' },
    h('div', { class: 'form-row' },
      h('label', {}, 'Status', h('input', { type: 'text', class: 'mono', value: r.status, size: 7, oninput: (e) => { r.status = e.target.value.trim(); commit(); } })),
      h('label', { class: 'grow' }, 'Description', h('input', { type: 'text', value: r.description, oninput: (e) => { r.description = e.target.value; commit(); } })),
      h('button', { class: 'btn icon', text: '×', title: 'Remove response', onclick: () => { ep.responses.splice(i, 1); renderEditor(); commit(); } }),
    ),
    exampleEditor(r, 'Example body (optional)'),
  ));

  return section('Responses', [
    h('button', {
      class: 'btn small', text: '+ Add response',
      onclick: () => {
        const used = new Set(ep.responses.map((r) => r.status));
        const status = ['200', '201', '204', '400', '401', '403', '404', '409', '422', '500'].find((s) => !used.has(s)) || 'default';
        ep.responses.push(newResponse(status));
        renderEditor();
        commit();
      },
    }),
  ],
  cards.length ? cards : h('p', { class: 'hint', text: 'No responses. A plain "200 OK" will be exported.' }),
  );
}

// ---------------------------------------------------------------- actions

function addEndpoint() {
  const api = currentApi();
  if (!api) return;
  const ep = newEndpoint('GET', '/');
  api.endpoints.push(ep);
  selectEndpoint(ep.id);
  $('#endpoint-editor .url-input')?.focus();
}

function duplicateEndpoint() {
  const api = currentApi();
  const ep = currentEndpoint();
  if (!api || !ep) return;
  const copy = { ...JSON.parse(JSON.stringify(ep)), id: uid() };
  copy.path = ep.path + (ep.path.endsWith('/') ? 'copy' : '/copy');
  api.endpoints.splice(api.endpoints.indexOf(ep) + 1, 0, copy);
  selectEndpoint(copy.id);
}

function deleteEndpoint() {
  const api = currentApi();
  const ep = currentEndpoint();
  if (!api || !ep || !confirm(`Delete ${ep.method} ${ep.path}?`)) return;
  const i = api.endpoints.indexOf(ep);
  api.endpoints.splice(i, 1);
  selectEndpoint(api.endpoints[Math.min(i, api.endpoints.length - 1)]?.id ?? null);
}

function createApi() {
  const title = prompt('Name of the new API:', 'My API');
  if (title === null) return;
  const api = newApi(title.trim() || 'My API');
  apis.push(api);
  selectApi(api.id);
}

function deleteApi() {
  const api = currentApi();
  if (!api || !confirm(`Delete the API “${api.title}” and all its endpoints? Download it first if you want a copy.`)) return;
  apis = apis.filter((a) => a.id !== api.id);
  if (!apis.length) apis.push(newApi('My API'));
  selectApi(apis[0].id);
}

async function importApi() {
  const file = await pickFile('.json,.yaml,.yml,application/json');
  if (!file) return;
  try {
    const { api, warnings } = fromOpenApi(parseSpecText(file.text));
    apis.push(api);
    selectApi(api.id);
    toast(`Imported “${api.title}” with ${api.endpoints.length} endpoint${api.endpoints.length === 1 ? '' : 's'}`);
    if (warnings.length) alert(`Imported with some notes:\n\n• ${warnings.join('\n• ')}`);
  } catch (e) {
    toast(`Import failed: ${e.message}`, 'error');
  }
}

// ---------------------------------------------------------------- preview / export

function specText(format) {
  const doc = toOpenApi(currentApi());
  return format === 'json' ? toJson(doc) : toYaml(doc);
}

function renderPreview() {
  $$('#preview-format .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.format === previewFormat));
  const api = currentApi();
  const pre = $('#spec-preview');
  if (!api) {
    pre.textContent = '';
    $('#problems').replaceChildren();
    return;
  }
  $('#problems').replaceChildren(...validateApi(api).map((p) => h('li', {
    text: p.message,
    style: p.endpointId ? 'cursor:pointer' : '',
    onclick: p.endpointId ? () => selectEndpoint(p.endpointId) : null,
  })));
  try {
    const text = specText(previewFormat);
    if (previewFormat === 'json') pre.innerHTML = highlightJson(text);
    else pre.textContent = text;
  } catch (e) {
    pre.textContent = `Could not build the spec: ${e.message}`;
  }
}

function slug(text) {
  return (text || 'api').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'api';
}

// ---------------------------------------------------------------- wiring

export function initDesigner({ tryIt }) {
  onTryIt = tryIt;
  if (!Array.isArray(apis) || !apis.length) apis = [sampleApi()];
  if (!currentApi()) currentApiId = apis[0].id;
  if (!currentEndpoint()) currentEndpointId = currentApi().endpoints[0]?.id ?? null;

  renderAll();
  commit();

  $('#api-select').addEventListener('change', (e) => selectApi(e.target.value));
  $('#btn-new-api').addEventListener('click', createApi);
  $('#btn-import-api').addEventListener('click', importApi);
  $('#btn-delete-api').addEventListener('click', deleteApi);
  $('#btn-add-endpoint').addEventListener('click', addEndpoint);

  $('#preview-format').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    previewFormat = btn.dataset.format;
    save('designer.format', previewFormat);
    renderPreview();
  });
  $('#btn-copy-spec').addEventListener('click', () => currentApi() && copyText(specText(previewFormat)));
  $('#btn-download-spec').addEventListener('click', () => {
    const api = currentApi();
    if (!api) return;
    const ext = previewFormat === 'json' ? 'json' : 'yaml';
    downloadFile(`${slug(api.title)}-openapi.${ext}`, specText(previewFormat), ext === 'json' ? 'application/json' : 'application/yaml');
  });
}
