// Who is signed in, and calls to api.php.
//
// With auth = 'none' on the server, nobody signs in and everything stays in the browser;
// with auth = 'login', this holds the user and the CSRF token every write must carry.

export const session = {
  auth: 'none',
  signedIn: false,
  username: null,
  isAdmin: false,
  csrfToken: '',
  loginUrl: '',
  storageOk: false,
  storageError: null,
};

export async function loadSession() {
  try {
    const res = await fetch('api.php?action=me', { headers: { Accept: 'application/json' } });
    const data = await res.json();
    if (!data.ok) return;
    Object.assign(session, {
      auth: data.auth,
      signedIn: !!data.signedIn,
      username: data.username,
      isAdmin: !!data.isAdmin,
      csrfToken: data.csrfToken || '',
      loginUrl: data.loginUrl || '',
      storageOk: !!data.storage?.ok,
      storageError: data.storage?.error || null,
    });
  } catch {
    // api.php unreachable: carry on as a browser-only install
  }
}

/** True when collections and environments can be saved on the server. */
export const serverStorage = () => session.auth === 'login' && session.signedIn && session.storageOk;

/** Headers every state-changing call to this app's PHP must carry. */
export const csrfHeaders = () => (session.csrfToken ? { 'X-CSRF-Token': session.csrfToken } : {});

/** Calls api.php. Pass a body to POST it; throws an Error with .code on failure. */
export async function api(action, body) {
  const options = body === undefined
    ? { headers: { Accept: 'application/json' } }
    : { method: 'POST', headers: { 'Content-Type': 'application/json', ...csrfHeaders() }, body: JSON.stringify(body) };
  const res = await fetch(`api.php?action=${encodeURIComponent(action)}`, options);
  let data;
  try {
    data = await res.json();
  } catch {
    throw Object.assign(new Error(`api.php answered HTTP ${res.status} without JSON. Check the web server error log.`), { code: 'NETWORK_ERROR' });
  }
  if (!data.ok) throw Object.assign(new Error(data.error?.message || 'Request failed'), { code: data.error?.code });
  return data;
}
