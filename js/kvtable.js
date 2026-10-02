// An editable Key/Value table that always ends with a blank row. Typing into the
// blank row turns it into a real one, so users never need an "add row" button.
// The rows array ({name, value, enabled}) is edited in place; onChange fires after each edit.
//
// "Bulk Edit" swaps the table for a textarea of `key: value` lines (a leading // marks
// a row as switched off), and back.

import { h } from './dom.js';

/** Rows -> `key: value` lines. */
function toBulk(rows) {
  return rows
    .filter((r) => r.name || r.value)
    .map((r) => `${r.enabled === false ? '//' : ''}${r.name}: ${r.value}`)
    .join('\n');
}

/** `key: value` lines -> rows. A line without a colon is a key with an empty value. */
function fromBulk(text) {
  return text.split(/\r?\n/).filter((line) => line.trim()).map((line) => {
    let enabled = true;
    let rest = line.trim();
    if (rest.startsWith('//')) {
      enabled = false;
      rest = rest.slice(2).trim();
    }
    const colon = rest.indexOf(':');
    return colon >= 0
      ? { name: rest.slice(0, colon).trim(), value: rest.slice(colon + 1).trim(), enabled }
      : { name: rest, value: '', enabled };
  });
}

export function renderKvTable(container, rows, options = {}) {
  const { onChange, withEnabled = true, namePlaceholder = 'Key', valuePlaceholder = 'Value', bulk = true } = options;

  if (container.dataset.bulk === 'on') {
    const textarea = h('textarea', {
      class: 'code bulk-edit', rows: Math.max(6, rows.length + 2), spellcheck: false, value: toBulk(rows),
      placeholder: withEnabled ? 'key: value\n//switched-off: value' : 'key: value',
      oninput: () => {
        rows.splice(0, rows.length, ...fromBulk(textarea.value).map((r) => (withEnabled ? r : { ...r, enabled: true })));
        onChange?.();
      },
    });
    container.replaceChildren(
      h('div', { class: 'kv-toolbar' },
        h('span', { class: 'hint', text: withEnabled ? 'One per line: key: value. Start a line with // to switch it off.' : 'One per line: key: value' }),
        h('button', { type: 'button', class: 'link-btn', text: 'Key-Value Edit', onclick: () => { container.dataset.bulk = 'off'; renderKvTable(container, rows, options); } })),
      textarea,
    );
    return;
  }

  const tbody = h('tbody');
  const head = h('thead', {}, h('tr', {},
    ...[
      withEnabled ? h('th', { class: 'cb' }) : null,
      h('th', { text: 'Key' }),
      h('th', { text: 'Value' }),
      h('th', { class: 'act' }, bulk ? h('button', {
        type: 'button', class: 'link-btn', text: 'Bulk Edit',
        onclick: () => {
          container.dataset.bulk = 'on';
          renderKvTable(container, rows, options);
          container.querySelector('textarea')?.focus(); // only on a click: re-renders must not steal focus
        },
      }) : null),
    ].filter(Boolean)));
  container.replaceChildren(h('table', { class: 'kv-table' }, head, tbody));

  const addRowElement = (row) => {
    const isBlank = row === null;
    const tr = h('tr', { class: isBlank ? 'blank' : '' });
    let current = row;

    const ensureRow = () => {
      if (current) return current;
      current = { name: '', value: '', enabled: true };
      rows.push(current);
      enabled.disabled = false;
      enabled.checked = true;
      remove.classList.remove('hidden');
      tr.classList.remove('blank');
      addRowElement(null); // new blank row underneath
      return current;
    };

    const enabled = h('input', {
      type: 'checkbox',
      checked: isBlank ? false : row.enabled !== false,
      disabled: isBlank,
      title: 'Include',
      onchange: () => { ensureRow().enabled = enabled.checked; onChange?.(); },
    });
    const name = h('input', {
      type: 'text', class: 'mono', placeholder: namePlaceholder, value: row?.name ?? '', spellcheck: false,
      oninput: () => { ensureRow().name = name.value; onChange?.(); },
    });
    const value = h('input', {
      type: 'text', class: 'mono', placeholder: valuePlaceholder, value: row?.value ?? '', spellcheck: false,
      oninput: () => { ensureRow().value = value.value; onChange?.(); },
    });
    const remove = h('button', {
      type: 'button', class: 'btn icon' + (isBlank ? ' hidden' : ''), title: 'Remove', text: '×',
      onclick: () => {
        const i = rows.indexOf(current);
        if (i >= 0) rows.splice(i, 1);
        tr.remove();
        onChange?.();
      },
    });

    tr.append(...[
      withEnabled ? h('td', { class: 'cb' }, enabled) : null,
      h('td', {}, name),
      h('td', {}, value),
      h('td', { class: 'act' }, remove),
    ].filter(Boolean));
    tbody.append(tr);
  };

  rows.forEach(addRowElement);
  addRowElement(null);
}
