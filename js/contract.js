// The link between the Tester and the Designer: which designed endpoint a request is,
// and whether a request body or a response matches what the design says. Pure functions.
//
// Schemas come from the design's examples (openapi.js inferSchema), so a check reads as
// "differs from the example in the design": types, fields the design does not have, and
// fields the design has that are missing.

import { inferSchema } from './openapi.js';

// ---------------------------------------------------------------- matching

/** The path part of a URL, without scheme, host, query or fragment. A leading {{var}} is dropped. */
export function urlPath(url) {
  let path = String(url ?? '').trim();
  path = path.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, ''); // scheme://host[:port]
  path = path.replace(/^\{\{[^}]*\}\}/, ''); // {{baseUrl}} not filled in
  path = path.split(/[?#]/)[0];
  return path.startsWith('/') ? path : `/${path}`;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A regex for a path template; {param} matches one segment. Anchored at the end only. */
function templateRegex(template) {
  const body = template.replace(/^\/+|\/+$/g, '').split('/')
    .map((seg) => seg.split(/(\{[^}]+\})/).map((part) => (/^\{[^}]+\}$/.test(part) ? '[^/]+' : escapeRe(part))).join(''))
    .join('/');
  return new RegExp(`(^|/)${body}/?$`);
}

/** Literal characters in a template: a more specific template wins over a vaguer one. */
const specificity = (template) => template.replace(/\{[^}]+\}/g, '').length;

/** The base paths an API's server URLs add in front of every endpoint (e.g. "/v1"). */
function serverBasePaths(api) {
  return (api.servers || []).map((s) => urlPath(s).replace(/\/+$/, '')).filter(Boolean);
}

/**
 * The designed endpoint a request belongs to.
 *
 * An explicit link (set by the Designer's "Try it") wins while the endpoint still exists
 * and the request still fits it (same method, path still matches); edit the request into
 * something else and matching takes over. Otherwise
 * the method must match and the URL path must end with the endpoint's path template; a
 * path that is exactly a server base path + the template ranks highest, then the most
 * specific template.
 *
 * @returns {{ api: object, endpoint: object, how: 'linked'|'matched' } | null}
 */
export function findEndpoint(apis, { method, url, design }) {
  const path = urlPath(url);
  if (design) {
    const api = apis.find((a) => a.id === design.apiId);
    const endpoint = api?.endpoints.find((e) => e.id === design.endpointId);
    if (endpoint && endpoint.method === method && endpoint.path && templateRegex(endpoint.path).test(path)) {
      return { api, endpoint, how: 'linked' };
    }
  }
  if (path === '/' && !String(url ?? '').trim()) return null;

  let best = null;
  for (const api of apis) {
    const bases = serverBasePaths(api);
    for (const endpoint of api.endpoints) {
      if (endpoint.method !== method || !endpoint.path) continue;
      if (!templateRegex(endpoint.path).test(path)) continue;
      const exact = [ '', ...bases ].some((base) => new RegExp(`^${escapeRe(base)}${templateRegex(endpoint.path).source.replace(/^\(\^\|\/\)/, '/')}`).test(path));
      const score = (exact ? 10000 : 0) + specificity(endpoint.path);
      if (!best || score > best.score) best = { api, endpoint, how: 'matched', score };
    }
  }
  if (!best) return null;
  const { score, ...match } = best;
  return match;
}

// ---------------------------------------------------------------- schemas from the design

const isJsonType = (contentType) => /json/i.test(contentType || '');

function schemaFromExample(example, contentType) {
  if (!isJsonType(contentType) || !(example ?? '').trim()) return null;
  try {
    return inferSchema(JSON.parse(example));
  } catch {
    return null; // the Designer already reports an example that is not valid JSON
  }
}

/** The schema the design implies for this endpoint's request body, or null. */
export function requestSchema(endpoint) {
  const body = endpoint.requestBody;
  return body?.enabled ? schemaFromExample(body.example, body.contentType) : null;
}

/**
 * The designed response for a status: exact ("200"), then a range ("2XX"), then "default".
 * @returns {{ response: object|null, schema: object|null, documented: string[] }}
 */
export function responseFor(endpoint, status) {
  const code = String(status);
  const responses = endpoint.responses || [];
  const response = responses.find((r) => String(r.status) === code)
    || responses.find((r) => String(r.status).toUpperCase() === `${code[0]}XX`)
    || responses.find((r) => String(r.status) === 'default')
    || null;
  return {
    response,
    schema: response ? schemaFromExample(response.example, response.contentType) : null,
    documented: responses.map((r) => String(r.status)),
  };
}

// ---------------------------------------------------------------- checking a value

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);

function typeMatches(type, value) {
  switch (type) {
    case 'integer': return Number.isInteger(value);
    case 'number': return typeof value === 'number';
    case 'string': return typeof value === 'string';
    case 'boolean': return typeof value === 'boolean';
    case 'array': return Array.isArray(value);
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
    default: return true;
  }
}

const join = (path, key) => (typeof key === 'number' ? `${path}[${key}]` : path ? `${path}.${key}` : key);
export const describePath = (path) => path || '(whole body)';

/**
 * Compares a value with a schema inferred from an example.
 * @returns {{ path: string, kind: 'type'|'extra'|'missing', message: string, severity: 'error'|'warning' }[]}
 */
export function compare(value, schema, path = '', out = [], limit = 50) {
  if (!schema || out.length >= limit) return out;
  // An example of null says nothing about the type; anything goes there.
  if (schema.nullable && !schema.type) return out;
  if (value === null && schema.nullable) return out;
  if (schema.type && !typeMatches(schema.type, value)) {
    out.push({ path, kind: 'type', severity: 'error', message: `${describePath(path)}: expected ${schema.type}, got ${typeOf(value)}` });
    return out;
  }
  if (schema.type === 'object' && schema.properties) {
    for (const [key, sub] of Object.entries(schema.properties)) {
      if (!(key in value)) out.push({ path: join(path, key), parent: path, kind: 'missing', severity: 'warning', message: `${join(path, key)}: in the design, missing here` });
      else compare(value[key], sub, join(path, key), out, limit);
    }
    for (const key of Object.keys(value)) {
      if (!(key in schema.properties)) out.push({ path: join(path, key), kind: 'extra', severity: 'warning', message: `${join(path, key)}: not in the design` });
    }
  } else if (schema.type === 'array' && schema.items && Object.keys(schema.items).length) {
    value.slice(0, 20).forEach((item, i) => compare(item, schema.items, join(path, i), out, limit));
  }
  return out.slice(0, limit);
}

// ---------------------------------------------------------------- where things are in the text

/**
 * Parses valid JSON, recording where each value (and each property name) sits in the text,
 * so a difference can be underlined in the editor.
 * @returns {Map<string, { start: number, end: number, keyStart?: number, keyEnd?: number }>}
 */
export function locate(text) {
  const map = new Map();
  let i = 0;
  const ws = () => { while (i < text.length && /\s/.test(text[i])) i++; };
  const string = () => {
    let out = '';
    i++; // opening quote
    while (i < text.length && text[i] !== '"') {
      if (text[i] === '\\') { out += text[i] + text[i + 1]; i += 2; } else out += text[i++];
    }
    i++; // closing quote
    return JSON.parse(`"${out}"`);
  };
  const value = (path) => {
    ws();
    const start = i;
    const c = text[i];
    if (c === '{') {
      i++;
      ws();
      if (text[i] === '}') i++;
      else {
        for (;;) {
          ws();
          const keyStart = i;
          const key = string();
          const keyEnd = i;
          ws();
          i++; // :
          const p = join(path, key);
          value(p);
          Object.assign(map.get(p), { keyStart, keyEnd });
          ws();
          if (text[i] === ',') { i++; continue; }
          i++; // }
          break;
        }
      }
    } else if (c === '[') {
      i++;
      ws();
      if (text[i] === ']') i++;
      else {
        for (let n = 0; ; n++) {
          value(join(path, n));
          ws();
          if (text[i] === ',') { i++; continue; }
          i++; // ]
          break;
        }
      }
    } else if (c === '"') {
      string();
    } else {
      const m = /^(-?\d+(\.\d+)?([eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i));
      i += m ? m[0].length : 1;
    }
    map.set(path, { start, end: i });
  };
  value('');
  return map;
}

/** Text ranges for differences: the property name for extra fields, the parent for missing ones, else the value. */
export function rangesFor(issues, positions) {
  return issues.map((issue) => {
    const at = issue.kind === 'missing' ? positions.get(issue.parent ?? '') : positions.get(issue.path);
    if (!at) return null;
    if (issue.kind === 'missing') return { ...issue, start: at.start, end: at.start + 1 }; // the opening {
    if (issue.kind === 'extra' && at.keyStart != null) return { ...issue, start: at.keyStart, end: at.keyEnd };
    return { ...issue, start: at.start, end: at.end };
  }).filter(Boolean);
}
