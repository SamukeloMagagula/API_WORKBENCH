// Collections of saved requests.
//
// "This browser" is always there and lives in localStorage (it holds what the Saved
// list held before collections existed). With sign-in on there are also server
// collections, private to their owner or shared with everyone signed in.
//
// A collection here: { key, name, scope: 'local'|'private'|'shared', requests: [{id, name, request}],
//                      deletable, canShare, item (the server row, for its id and version) }

import { toast } from './dom.js';
import { load, save } from './storage.js';
import { session, serverStorage, api } from './session.js';

const LOCAL_KEY = 'local';
let localRequests = load('saved', []);
let serverCollections = [];
let currentKey = load('currentCollection', LOCAL_KEY);

function fromServer(item) {
  return {
    key: `server:${item.id}`,
    name: item.name,
    scope: item.shared ? 'shared' : 'private',
    requests: Array.isArray(item.content.requests) ? item.content.requests : [],
    deletable: item.mine || session.isAdmin,
    canShare: item.mine || session.isAdmin,
    owner: item.owner,
    updatedBy: item.updatedBy,
    item,
  };
}

export function listCollections() {
  return [
    { key: LOCAL_KEY, name: 'This browser', scope: 'local', requests: localRequests, deletable: false, canShare: false },
    ...serverCollections.map(fromServer),
  ];
}

export function currentCollection() {
  return listCollections().find((c) => c.key === currentKey) || listCollections()[0];
}

export function setCurrentCollection(key) {
  currentKey = key;
  save('currentCollection', key);
}

export async function refreshServerCollections() {
  serverCollections = [];
  if (!serverStorage()) return;
  try {
    serverCollections = (await api('collections')).items;
  } catch (e) {
    toast(`Could not load collections from the server: ${e.message}`, 'error');
  }
}

/**
 * Saves a collection's requests after `change` edits them.
 *
 * For a server collection the edit is applied to the copy last loaded and sent with
 * its version; if someone else saved in between, the server refuses, the list is
 * reloaded, and false is returned so the caller can tell the user to redo it.
 */
export async function updateRequests(collection, change, { name, shared } = {}) {
  if (collection.scope === 'local') {
    change(localRequests);
    save('saved', localRequests);
    return true;
  }
  const requests = JSON.parse(JSON.stringify(collection.requests));
  change(requests);
  try {
    const { item } = await api('collection_save', {
      id: collection.item.id,
      name: name ?? collection.name,
      shared: shared ?? collection.scope === 'shared',
      version: collection.item.version,
      content: { requests },
    });
    serverCollections = serverCollections.map((c) => (c.id === item.id ? item : c));
    return true;
  } catch (e) {
    toast(e.message, 'error');
    if (e.code === 'CONFLICT' || e.code === 'NOT_FOUND') await refreshServerCollections();
    return false;
  }
}

export async function createCollection(name, shared) {
  try {
    const { item } = await api('collection_save', { id: 0, name, shared, version: 0, content: { requests: [] } });
    serverCollections.push(item);
    setCurrentCollection(`server:${item.id}`);
    return true;
  } catch (e) {
    toast(e.message, 'error');
    return false;
  }
}

export async function deleteCollection(collection) {
  try {
    await api('collection_delete', { id: collection.item.id });
    serverCollections = serverCollections.filter((c) => c.id !== collection.item.id);
    setCurrentCollection(LOCAL_KEY);
    return true;
  } catch (e) {
    toast(e.message, 'error');
    return false;
  }
}
