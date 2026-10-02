// Converts between the designer's data model and OpenAPI 3 documents.
// Pure functions, apart from the global jsyaml loaded from vendor/.
//
// Designer model:
//   Api      { id, title, version, description, servers: [url], endpoints: [Endpoint] }
//   Endpoint { id, method, path, summary, description, tags: [string],
//              parameters: [{ name, in: path|query|header, type, required, description }],
//              requestBody: { enabled, contentType, example },
//              responses: [{ status, description, contentType, example }] }
// Request/response bodies are described by an example; the schema is inferred from it.

import { uid } from './storage.js';

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
export const PARAM_TYPES = ['string', 'integer', 'number', 'boolean'];
export const PARAM_LOCATIONS = ['path', 'query', 'header'];

const STATUS_TEXT = {
  200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content', 301: 'Moved Permanently', 302: 'Found',
  304: 'Not Modified', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
  405: 'Method Not Allowed', 409: 'Conflict', 422: 'Unprocessable Entity', 429: 'Too Many Requests',
  500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable',
};

export function newApi(title = 'New API') {
  return { id: uid(), title, version: '1.0.0', description: '', servers: [], endpoints: [] };
}

export function newEndpoint(method = 'GET', path = '/') {
  return {
    id: uid(), method, path, summary: '', description: '', tags: [], parameters: [],
    requestBody: { enabled: false, contentType: 'application/json', example: '' },
    responses: [newResponse('200')],
  };
}

export function newResponse(status = '200') {
  return { status, description: STATUS_TEXT[status] || '', contentType: 'application/json', example: '' };
}

/** Names inside {braces} in a path template. */
export function pathParamNames(path) {
  return [...String(path).matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]);
}

const isJsonType = (contentType) => /json/i.test(contentType || '');

// ---------------------------------------------------------------- export

export function inferSchema(value) {
  if (value === null) return { nullable: true };
  if (Array.isArray(value)) return { type: 'array', items: value.length ? inferSchema(value[0]) : {} };
  switch (typeof value) {
    case 'boolean': return { type: 'boolean' };
    case 'number': return { type: Number.isInteger(value) ? 'integer' : 'number' };
    case 'string': {
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return { type: 'string', format: 'date-time' };
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { type: 'string', format: 'date' };
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return { type: 'string', format: 'uuid' };
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return { type: 'string', format: 'email' };
      return { type: 'string' };
    }
    case 'object': {
      const properties = {};
      for (const [key, v] of Object.entries(value)) properties[key] = inferSchema(v);
      return { type: 'object', properties };
    }
    default: return {};
  }
}

function mediaObject(exampleText, contentType) {
  const text = exampleText ?? '';
  if (isJsonType(contentType)) {
    try {
      const value = JSON.parse(text);
      return { schema: inferSchema(value), example: value };
    } catch {
      // invalid JSON is reported by validateApi; export it as a string so nothing is lost
    }
  }
  return { schema: { type: 'string' }, example: text };
}

export function toOpenApi(api) {
  const doc = {
    openapi: '3.0.3',
    info: { title: api.title || 'Untitled API', version: api.version || '1.0.0' },
  };
  if (api.description) doc.info.description = api.description;
  const servers = api.servers.map((s) => s.trim()).filter(Boolean);
  if (servers.length) doc.servers = servers.map((url) => ({ url }));
  doc.paths = {};

  for (const ep of api.endpoints) {
    const op = {};
    if (ep.summary) op.summary = ep.summary;
    if (ep.description) op.description = ep.description;
    const tags = ep.tags.map((t) => t.trim()).filter(Boolean);
    if (tags.length) op.tags = tags;

    const parameters = ep.parameters.filter((p) => p.name.trim()).map((p) => {
      const param = { name: p.name.trim(), in: p.in, required: p.in === 'path' ? true : !!p.required };
      if (p.description) param.description = p.description;
      param.schema = { type: p.type || 'string' };
      return param;
    });
    // Path placeholders the user did not declare still have to exist in the spec.
    for (const name of pathParamNames(ep.path)) {
      if (!parameters.some((p) => p.in === 'path' && p.name === name)) {
        parameters.push({ name, in: 'path', required: true, schema: { type: 'string' } });
      }
    }
    if (parameters.length) op.parameters = parameters;

    if (ep.requestBody.enabled) {
      const ct = ep.requestBody.contentType || 'application/json';
      op.requestBody = { required: true, content: { [ct]: mediaObject(ep.requestBody.example, ct) } };
    }

    op.responses = {};
    for (const r of ep.responses) {
      const status = String(r.status || '').trim() || 'default';
      const response = { description: r.description || STATUS_TEXT[status] || 'Response' };
      if ((r.example ?? '').trim()) {
        const ct = r.contentType || 'application/json';
        response.content = { [ct]: mediaObject(r.example, ct) };
      }
      op.responses[status] = response;
    }
    if (!ep.responses.length) op.responses['200'] = { description: 'OK' };

    const path = ep.path || '/';
    doc.paths[path] ??= {};
    doc.paths[path][ep.method.toLowerCase()] = op;
  }
  return doc;
}

export function toJson(doc) {
  return JSON.stringify(doc, null, 2);
}

export function toYaml(doc) {
  if (!window.jsyaml) throw new Error('YAML library failed to load (vendor/js-yaml.min.js).');
  return window.jsyaml.dump(doc, { noRefs: true, lineWidth: 120 });
}

// ---------------------------------------------------------------- import

/** Parses JSON or YAML text into an object. */
export function parseSpecText(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  if (!window.jsyaml) throw new Error('YAML library failed to load (vendor/js-yaml.min.js).');
  return window.jsyaml.load(trimmed);
}

function makeResolver(doc, warnings) {
  const warned = new Set();
  const warnOnce = (msg) => { if (!warned.has(msg)) { warned.add(msg); warnings.push(msg); } };

  return function resolve(node, seen = new Set()) {
    if (!node || typeof node !== 'object' || typeof node.$ref !== 'string') return node;
    const ref = node.$ref;
    if (!ref.startsWith('#/')) {
      warnOnce(`External reference ${ref} could not be followed.`);
      return {};
    }
    if (seen.has(ref)) return {}; // circular reference
    let target = doc;
    for (const part of ref.slice(2).split('/')) {
      target = target?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
    }
    if (target === undefined) {
      warnOnce(`Reference ${ref} points to nothing.`);
      return {};
    }
    return resolve(target, new Set([...seen, ref]));
  };
}

function exampleFromSchema(schema, resolve, depth = 0, refs = new Set()) {
  const ref = schema?.$ref;
  if (ref) {
    if (refs.has(ref)) return null; // a schema that contains itself: stop at the first repeat
    refs = new Set([...refs, ref]);
  }
  schema = resolve(schema);
  if (!schema || typeof schema !== 'object' || depth > 8) return null;
  if ('example' in schema) return schema.example;
  if ('default' in schema) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (Array.isArray(schema.allOf)) {
    return schema.allOf.reduce((acc, part) => {
      const value = exampleFromSchema(part, resolve, depth + 1, refs);
      return value && typeof value === 'object' && !Array.isArray(value) ? { ...acc, ...value } : acc;
    }, {});
  }
  const variant = schema.oneOf?.[0] ?? schema.anyOf?.[0];
  if (variant) return exampleFromSchema(variant, resolve, depth + 1, refs);

  const type = schema.type ?? (schema.properties ? 'object' : schema.items ? 'array' : undefined);
  switch (type) {
    case 'object': {
      const out = {};
      for (const [key, prop] of Object.entries(schema.properties || {})) out[key] = exampleFromSchema(prop, resolve, depth + 1, refs);
      return out;
    }
    case 'array': return schema.items ? [exampleFromSchema(schema.items, resolve, depth + 1, refs)] : [];
    case 'integer':
    case 'number': return 0;
    case 'boolean': return true;
    case 'string':
      return { 'date-time': '2024-01-01T00:00:00Z', date: '2024-01-01', email: 'user@example.com',
        uuid: '00000000-0000-0000-0000-000000000000' }[schema.format] ?? 'string';
    default: return null;
  }
}

function exampleText(media, contentType, resolve) {
  if (!media) return '';
  let value;
  if ('example' in media) value = media.example;
  else if (media.examples && Object.keys(media.examples).length) value = resolve(Object.values(media.examples)[0])?.value;
  else if (media.schema) value = exampleFromSchema(media.schema, resolve);
  if (value === undefined) return '';
  if (typeof value === 'string' && !isJsonType(contentType)) return value;
  return JSON.stringify(value, null, 2);
}

/** @returns {{api: object, warnings: string[]}} */
export function fromOpenApi(doc) {
  if (!doc || typeof doc !== 'object') throw new Error('This file is not an OpenAPI document.');
  if (doc.swagger) throw new Error('Swagger 2.0 files are not supported. Convert the file to OpenAPI 3 first.');
  if (!String(doc.openapi || '').startsWith('3.')) throw new Error('Missing "openapi: 3.x" field. Is this an OpenAPI 3 file?');

  const warnings = [];
  const resolve = makeResolver(doc, warnings);
  const api = newApi(doc.info?.title || 'Imported API');
  api.version = String(doc.info?.version ?? '1.0.0');
  api.description = doc.info?.description || '';
  api.servers = (doc.servers || []).map((s) => s?.url).filter(Boolean);

  for (const [path, rawItem] of Object.entries(doc.paths || {})) {
    const item = resolve(rawItem) || {};
    for (const method of METHODS) {
      const op = resolve(item[method.toLowerCase()]);
      if (!op) continue;

      const ep = newEndpoint(method, path);
      ep.summary = op.summary || '';
      ep.description = op.description || '';
      ep.tags = Array.isArray(op.tags) ? op.tags.map(String) : [];

      const merged = new Map();
      for (const raw of [...(item.parameters || []), ...(op.parameters || [])]) {
        const p = resolve(raw);
        if (!p?.name) continue;
        if (!PARAM_LOCATIONS.includes(p.in)) {
          warnings.push(`${method} ${path}: ${p.in} parameter "${p.name}" is not supported and was dropped.`);
          continue;
        }
        const type = resolve(p.schema)?.type;
        merged.set(`${p.in}:${p.name}`, {
          name: p.name, in: p.in, required: !!p.required, description: p.description || '',
          type: PARAM_TYPES.includes(type) ? type : 'string',
        });
      }
      ep.parameters = [...merged.values()];

      const body = resolve(op.requestBody);
      if (body?.content) {
        const [ct, media] = Object.entries(body.content)[0] || [];
        if (ct) ep.requestBody = { enabled: true, contentType: ct, example: exampleText(resolve(media), ct, resolve) };
      }

      ep.responses = Object.entries(op.responses || {}).map(([status, raw]) => {
        const r = resolve(raw) || {};
        const [ct, media] = Object.entries(r.content || {})[0] || [];
        return {
          status, description: r.description || '', contentType: ct || 'application/json',
          example: ct ? exampleText(resolve(media), ct, resolve) : '',
        };
      });
      api.endpoints.push(ep);
    }
  }

  if (doc.security || doc.components?.securitySchemes) {
    warnings.push('Security schemes are not edited in the designer and were not imported.');
  }
  return { api, warnings };
}

// ---------------------------------------------------------------- validation

/** @returns {{endpointId: string|null, message: string}[]} */
export function validateApi(api) {
  const problems = [];
  const add = (ep, message) => problems.push({ endpointId: ep?.id ?? null, message: ep ? `${ep.method} ${ep.path}: ${message}` : message });

  if (!api.title.trim()) add(null, 'The API needs a title.');
  const seenRoutes = new Map();

  for (const ep of api.endpoints) {
    if (!ep.path.startsWith('/')) add(ep, 'path must start with "/".');
    if (/\s/.test(ep.path)) add(ep, 'path must not contain spaces.');

    const route = `${ep.method} ${ep.path.replace(/\{[^}]*\}/g, '{}')}`;
    if (seenRoutes.has(route)) add(ep, 'another endpoint has the same method and path.');
    seenRoutes.set(route, true);

    const inPath = pathParamNames(ep.path);
    const seenParams = new Set();
    for (const p of ep.parameters) {
      if (!p.name.trim()) { add(ep, 'a parameter has no name.'); continue; }
      const key = `${p.in}:${p.name}`;
      if (seenParams.has(key)) add(ep, `parameter "${p.name}" (${p.in}) is declared twice.`);
      seenParams.add(key);
      if (p.in === 'path' && !inPath.includes(p.name)) add(ep, `path parameter "${p.name}" is not in the path. Add {${p.name}} to it.`);
    }

    if (ep.requestBody.enabled) {
      if (['GET', 'HEAD'].includes(ep.method)) add(ep, `${ep.method} requests usually should not have a body.`);
      if (isJsonType(ep.requestBody.contentType) && ep.requestBody.example.trim()) {
        try { JSON.parse(ep.requestBody.example); } catch (e) { add(ep, `request body example is not valid JSON (${e.message}).`); }
      }
    }

    const seenStatus = new Set();
    for (const r of ep.responses) {
      const status = String(r.status).trim();
      if (!/^([1-5]\d\d|[1-5]XX|default)$/.test(status)) add(ep, `response status "${status}" should be like 200, 4XX or default.`);
      if (seenStatus.has(status)) add(ep, `response ${status} is listed twice.`);
      seenStatus.add(status);
      if (isJsonType(r.contentType) && (r.example ?? '').trim()) {
        try { JSON.parse(r.example); } catch (e) { add(ep, `response ${status} example is not valid JSON (${e.message}).`); }
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------- "Try it"

/** Builds a Tester request from an endpoint, so it can be sent straight away. */
export function toTesterRequest(api, ep) {
  const server = (api.servers.find((s) => s.trim()) || '').trim().replace(/\/+$/, '');
  const query = ep.parameters
    .filter((p) => p.in === 'query' && p.name.trim())
    .map((p) => `${encodeURIComponent(p.name)}=`)
    .join('&');
  const headers = ep.parameters
    .filter((p) => p.in === 'header' && p.name.trim())
    .map((p) => ({ name: p.name, value: '', enabled: true }));

  const body = { type: 'none', text: '', form: [] };
  if (ep.requestBody.enabled) {
    const ct = ep.requestBody.contentType || 'application/json';
    body.type = isJsonType(ct) ? 'json' : 'text';
    body.text = ep.requestBody.example;
    if (!isJsonType(ct)) headers.push({ name: 'Content-Type', value: ct, enabled: true });
  }

  return {
    method: ep.method,
    url: server + ep.path + (query ? `?${query}` : ''),
    headers,
    auth: { type: 'none', token: '', username: '', password: '' },
    body,
  };
}
