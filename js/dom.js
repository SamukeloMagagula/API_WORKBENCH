// Small DOM helpers shared by the tester and the designer.

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/**
 * Creates an element. attrs: class, text, on<Event> handlers, dataset (object),
 * and anything else is set as a property (value, checked, type, placeholder…).
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else el[key] = value;
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

let toastTimer;
export function toast(message, kind = 'info') {
  const el = $('#toast');
  el.textContent = message;
  el.className = 'toast' + (kind === 'error' ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), kind === 'error' ? 5000 : 2500);
}

export function downloadFile(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Opens the shared hidden file input and resolves with the chosen file's text (or null). */
export function pickFile(accept) {
  const input = $('#file-input');
  input.accept = accept;
  input.value = '';
  return new Promise((resolve) => {
    input.onchange = async () => {
      const file = input.files[0];
      resolve(file ? { name: file.name, text: await file.text() } : null);
    };
    input.click();
  });
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API needs a secure context; plain-http hosted installs fall back to execCommand.
    const ta = h('textarea', { value: text });
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('Copied to clipboard');
}

/** Wires a row of .subtab buttons to the .pane elements with the same data-group. */
export function wireSubtabs(container, group, onChange) {
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.subtab');
    if (!btn) return;
    showPane(group, btn.dataset.pane);
    onChange?.(btn.dataset.pane);
  });
}

export function showPane(group, pane) {
  $$(`.subtabs[data-group="${group}"] .subtab`).forEach((b) => b.classList.toggle('active', b.dataset.pane === pane));
  $$(`.pane[data-group="${group}"]`).forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== pane));
}

/** Escapes text and wraps JSON tokens in spans for colouring. Input must already be pretty-printed JSON. */
export function highlightJson(json) {
  const escaped = json.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  return escaped.replace(
    /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (match, _str, colon) => {
      let cls = 'j-num';
      if (match.startsWith('"')) cls = colon ? 'j-key' : 'j-str';
      else if (match === 'true' || match === 'false') cls = 'j-bool';
      else if (match === 'null') cls = 'j-null';
      return `<span class="${cls}">${match}</span>`;
    },
  );
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
