// Environments: named sets of {{variables}} (dev, UAT, prod...) and which one is active.
//
// An environment lives either in this browser, or on the server (with auth = 'devhub'),
// where it is private to its owner or shared with everyone signed in.

import { $, h, toast, openModal } from './dom.js';
import { load, save, uid } from './storage.js';
import { session, serverStorage, api } from './session.js';
import { renderKvTable } from './kvtable.js';
import { variableMap } from './variables.js';

let localEnvs = load('environments', []); // [{ id, name, variables: [{name, value, enabled}] }]
let serverEnvs = []; // items from api.php
let activeKey = load('activeEnvironment', '');
const listeners = new Set();

const SCOPE_LABEL = { local: 'this browser', private: 'server, only me', shared: 'server, shared' };

export const onEnvironmentChange = (fn) => listeners.add(fn);
const notify = () => listeners.forEach((fn) => fn());

function all() {
  return [
    ...localEnvs.map((e) => ({ key: `local:${e.id}`, name: e.name, scope: 'local', variables: e.variables, deletable: true, item: e })),
    ...serverEnvs.map((e) => ({
      key: `server:${e.id}`, name: e.name, scope: e.shared ? 'shared' : 'private',
      variables: e.content.variables || [], deletable: e.mine || session.isAdmin, canShare: e.mine || session.isAdmin, item: e,
    })),
  ];
}

export function activeEnvironment() {
  return all().find((e) => e.key === activeKey) || null;
}

/** The active environment's variables as a name -> value map. */
export function activeVariables() {
  return variableMap(activeEnvironment()?.variables);
}

function setActive(key) {
  activeKey = key;
  save('activeEnvironment', key);
  renderSelect();
  notify();
}

function renderSelect() {
  const envs = all();
  if (activeKey && !envs.some((e) => e.key === activeKey)) activeKey = '';
  $('#env-select').replaceChildren(
    h('option', { value: '', text: 'No environment' }),
    ...envs.map((e) => h('option', { value: e.key, text: `${e.name} (${SCOPE_LABEL[e.scope]})`, selected: e.key === activeKey })),
  );
}

export async function refreshServerEnvironments() {
  serverEnvs = [];
  if (serverStorage()) {
    try {
      serverEnvs = (await api('environments')).items;
    } catch (e) {
      toast(`Could not load environments from the server: ${e.message}`, 'error');
    }
  }
  renderSelect();
  notify();
}

// ---------------------------------------------------------------- editor

function openEditor(key) {
  const existing = all().find((e) => e.key === key) || null;
  const draft = {
    name: existing?.name ?? '',
    variables: JSON.parse(JSON.stringify(existing?.variables ?? [])),
    target: existing ? existing.scope : 'local',
  };

  const nameInput = h('input', { type: 'text', value: draft.name, placeholder: 'e.g. UAT' });
  const table = h('div');
  renderKvTable(table, draft.variables, { namePlaceholder: 'Variable', valuePlaceholder: 'Value' });

  // Where it is stored: chosen once for a new environment; for a server one, only sharing can change.
  let storage;
  if (!existing) {
    const options = [h('option', { value: 'local', text: 'This browser only' })];
    if (serverStorage()) {
      options.push(h('option', { value: 'private', text: 'Server, only me' }), h('option', { value: 'shared', text: 'Server, shared with everyone signed in' }));
    }
    storage = h('label', {}, 'Stored in', h('select', { onchange: (e) => { draft.target = e.target.value; } }, ...options));
  } else if (existing.scope === 'local') {
    storage = h('p', { class: 'hint', text: 'Stored in this browser only.' });
  } else {
    storage = h('label', { class: 'check' }, h('input', {
      type: 'checkbox', checked: existing.scope === 'shared', disabled: !existing.canShare,
      onchange: (e) => { draft.target = e.target.checked ? 'shared' : 'private'; },
    }), `Shared with everyone signed in${existing.canShare ? '' : ` (only ${existing.item.owner} or an admin can change this)`}`);
  }

  const switcher = h('div', { class: 'form-row' },
    h('select', { class: 'grow', onchange: (e) => { modal.close(); openEditor(e.target.value); } },
      h('option', { value: '', text: '+ New environment', selected: !existing }),
      ...all().map((e) => h('option', { value: e.key, text: `${e.name} (${SCOPE_LABEL[e.scope]})`, selected: e.key === key }))));

  const body = h('div', {},
    switcher,
    h('div', { class: 'form-group' }, h('label', {}, 'Name', nameInput)),
    h('div', { class: 'form-group' }, storage),
    h('div', { class: 'form-group' },
      h('label', { text: 'Variables' }),
      table,
      h('p', { class: 'hint' }, 'Use them as ', h('code', { text: '{{name}}' }), ' in the URL, headers, auth or body.'),
      h('p', { class: 'hint' }, 'Everyone who can see a shared environment can read its values, tokens included. Keep personal tokens in a private one.')),
  );

  const actions = [];
  if (existing?.deletable) {
    actions.push(h('button', { class: 'btn danger', type: 'button', text: 'Delete', onclick: () => remove(existing, modal) }));
    actions.push(h('span', { class: 'spacer' }));
  }
  actions.push(
    h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => modal.close() }),
    h('button', { class: 'btn primary', type: 'button', text: 'Save', onclick: () => { draft.name = nameInput.value.trim(); persist(existing, draft, modal); } }),
  );

  const modal = openModal({ title: existing ? 'Edit environment' : 'New environment', body, actions, size: 'modal-lg' });
}

async function persist(existing, draft, modal) {
  if (!draft.name) return toast('Give the environment a name.', 'error');
  const variables = draft.variables.filter((v) => v.name.trim() || v.value);

  if (draft.target === 'local') {
    let env = existing?.item;
    if (env) Object.assign(env, { name: draft.name, variables });
    else localEnvs.push(env = { id: uid(), name: draft.name, variables });
    save('environments', localEnvs);
    modal.close();
    setActive(`local:${env.id}`);
    toast(`Saved “${draft.name}”`);
    return;
  }

  try {
    const { item } = await api('environment_save', {
      id: existing?.item.id ?? 0,
      name: draft.name,
      shared: draft.target === 'shared',
      version: existing?.item.version ?? 0,
      content: { variables },
    });
    serverEnvs = [...serverEnvs.filter((e) => e.id !== item.id), item];
    modal.close();
    setActive(`server:${item.id}`);
    toast(`Saved “${item.name}”`);
  } catch (e) {
    toast(e.message, 'error');
    if (e.code === 'CONFLICT' || e.code === 'NOT_FOUND') {
      modal.close();
      refreshServerEnvironments();
    }
  }
}

async function remove(env, modal) {
  if (!confirm(`Delete the environment “${env.name}”?${env.scope === 'shared' ? ' It is shared, so it disappears for everyone.' : ''}`)) return;
  try {
    if (env.scope === 'local') {
      localEnvs = localEnvs.filter((e) => e !== env.item);
      save('environments', localEnvs);
    } else {
      await api('environment_delete', { id: env.item.id });
      serverEnvs = serverEnvs.filter((e) => e.id !== env.item.id);
    }
    modal.close();
    if (activeKey === env.key) setActive('');
    else { renderSelect(); notify(); }
    toast(`Deleted “${env.name}”`);
  } catch (e) {
    toast(e.message, 'error');
  }
}

export function initEnvironments() {
  renderSelect();
  $('#env-select').addEventListener('change', (e) => setActive(e.target.value));
  $('#btn-manage-envs').addEventListener('click', () => openEditor(activeKey));
}
