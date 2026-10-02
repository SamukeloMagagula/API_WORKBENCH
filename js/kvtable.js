// An editable name/value table that always ends with a blank row. Typing into the
// blank row turns it into a real one, so users never need an "add row" button.
// The rows array ({name, value, enabled}) is edited in place; onChange fires after each edit.

import { h } from './dom.js';

export function renderKvTable(container, rows, { onChange, withEnabled = true, namePlaceholder = 'Name', valuePlaceholder = 'Value' } = {}) {
  const tbody = h('tbody');
  container.replaceChildren(h('table', { class: 'kv-table' }, tbody));

  const addRowElement = (row) => {
    const isBlank = row === null;
    const tr = h('tr');
    let current = row;

    const ensureRow = () => {
      if (current) return current;
      current = { name: '', value: '', enabled: true };
      rows.push(current);
      enabled.disabled = false;
      enabled.checked = true;
      remove.classList.remove('hidden');
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
