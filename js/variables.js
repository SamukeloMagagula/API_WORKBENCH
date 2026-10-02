// {{variable}} substitution. Pure functions.

const VARIABLE = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

/** Replaces {{name}} with vars[name]; unknown names are left as written and added to `missing`. */
export function substitute(text, vars, missing) {
  return String(text ?? '').replace(VARIABLE, (match, name) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name];
    missing.add(name);
    return match;
  });
}

export const hasVariables = (text) => /\{\{\s*[A-Za-z0-9_.-]+\s*\}\}/.test(String(text ?? ''));

/** Turns an environment's variable rows into a name -> value map (enabled, named rows only). */
export function variableMap(rows = []) {
  const map = {};
  for (const row of rows) {
    if (row.enabled !== false && row.name?.trim()) map[row.name.trim()] = row.value ?? '';
  }
  return map;
}

/**
 * Resolves every field of a Tester request that can hold variables.
 * @returns {{ request: object, missing: string[] }}
 */
export function resolveRequest(req, vars) {
  const missing = new Set();
  const sub = (text) => substitute(text, vars, missing);
  const rows = (list) => list.map((r) => ({ ...r, name: sub(r.name), value: sub(r.value) }));
  const request = {
    ...req,
    url: sub(req.url),
    headers: rows(req.headers),
    auth: { ...req.auth, token: sub(req.auth.token), username: sub(req.auth.username), password: sub(req.auth.password) },
    body: { ...req.body, text: sub(req.body.text), form: rows(req.body.form) },
  };
  return { request, missing: [...missing] };
}
