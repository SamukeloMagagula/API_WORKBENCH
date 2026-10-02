// Everything the app remembers lives in this browser's localStorage, under the "apiwb." prefix.

const PREFIX = 'apiwb.';

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false; // storage full or blocked; the app keeps working in memory
  }
}

export function uid() {
  // crypto.randomUUID only exists in secure contexts; hosted installs may be plain http.
  if (window.crypto?.randomUUID && window.isSecureContext) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
