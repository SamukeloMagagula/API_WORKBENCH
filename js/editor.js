// Monaco, the editor from VS Code, for the request body and the response viewer.
//
// Loaded on demand from vendor/monaco (no CDN: the server may have no internet). If it
// cannot load, or on touch devices where it works poorly, callers keep their plain
// <textarea> / <pre>. Everything here is optional polish over a working baseline.
//
// Monaco's AMD loader defines a global require/define. js-yaml is loaded before it (a
// plain <script> in index.html), so it has already registered itself as window.jsyaml.

const VARIABLE = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;
const MONO = 'ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, monospace';

let loading = null;
let getVariables = () => ({});

/** Where {{variables}} get their values (the active environment). */
export function setVariableSource(fn) {
  getVariables = fn;
}

/** True where Monaco is worth loading. Touch devices keep the plain controls. */
export const monacoWanted = () => !window.matchMedia('(pointer: coarse)').matches;

/** Loads Monaco once; resolves to the monaco namespace, or rejects if it cannot load. */
export function loadMonaco() {
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const base = new URL('vendor/monaco/', document.baseURI).href;
    // Workers load through a small same-origin shim, the documented way for the AMD build.
    window.MonacoEnvironment = {
      getWorkerUrl: () => `data:text/javascript;charset=utf-8,${encodeURIComponent(
        `self.MonacoEnvironment = { baseUrl: '${base}' }; importScripts('${base}vs/base/worker/workerMain.js');`,
      )}`,
    };
    const script = document.createElement('script');
    script.src = `${base}vs/loader.js`;
    script.onerror = () => reject(new Error('vendor/monaco/vs/loader.js did not load'));
    script.onload = () => {
      window.require.config({ paths: { vs: `${base}vs` } });
      window.require(['vs/editor/editor.main'], () => {
        setUp(window.monaco);
        resolve(window.monaco);
      }, reject);
    };
    document.head.append(script);
  });
  return loading;
}

function setUp(monaco) {
  // The app's palette: light, red accents, the JSON colours the response view already used.
  monaco.editor.defineTheme('apiwb', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'string.key.json', foreground: '18181b', fontStyle: 'bold' },
      { token: 'string.value.json', foreground: '032f62' },
      { token: 'number', foreground: 'b31d28' },
      { token: 'number.json', foreground: 'b31d28' },
      { token: 'keyword.json', foreground: 'd73a49', fontStyle: 'bold' },
      { token: 'tag', foreground: 'a80016' },
      { token: 'attribute.name', foreground: '7c3aed' },
      { token: 'attribute.value', foreground: '032f62' },
    ],
    colors: {
      'editor.background': '#fbfbfc',
      'editorLineNumber.foreground': '#a1a1aa',
      'editorLineNumber.activeForeground': '#18181b',
      'editorCursor.foreground': '#d6001c',
      'editor.selectionBackground': '#fbd3d8',
      'editor.inactiveSelectionBackground': '#f4e1e3',
      'editor.lineHighlightBackground': '#f4f4f5',
      'editorBracketMatch.border': '#d6001c',
      'editorIndentGuide.background1': '#e4e4e7',
      'focusBorder': '#d6001c',
    },
  });
  // Our own JSON check handles {{variables}}; Monaco's would flag every one of them.
  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({ validate: false });

  for (const language of ['json', 'plaintext']) {
    // Typing {{ offers the active environment's variables.
    monaco.languages.registerCompletionItemProvider(language, {
      triggerCharacters: ['{'],
      provideCompletionItems(model, position) {
        const before = model.getValueInRange({ startLineNumber: position.lineNumber, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column });
        const open = before.match(/\{\{\s*([A-Za-z0-9_.-]*)$/);
        if (!open) return { suggestions: [] };
        const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: position.column - open[1].length, endColumn: position.column };
        const after = model.getValueInRange({ startLineNumber: position.lineNumber, startColumn: position.column, endLineNumber: position.lineNumber, endColumn: position.column + 2 });
        const close = after === '}}' ? '' : '}}';
        return {
          suggestions: Object.entries(getVariables()).map(([name, value]) => ({
            label: name,
            kind: monaco.languages.CompletionItemKind.Variable,
            detail: value === '' ? '(empty)' : String(value).slice(0, 60),
            insertText: name + close,
            range,
          })),
        };
      },
    });
    // Hovering a {{variable}} shows its current value, or that it has none.
    monaco.languages.registerHoverProvider(language, {
      provideHover(model, position) {
        for (const m of model.getLineContent(position.lineNumber).matchAll(VARIABLE)) {
          const start = m.index + 1;
          const end = start + m[0].length;
          if (position.column < start || position.column > end) continue;
          const vars = getVariables();
          const known = Object.prototype.hasOwnProperty.call(vars, m[1]);
          return {
            range: new monaco.Range(position.lineNumber, start, position.lineNumber, end),
            contents: [{ value: known ? `**{{${m[1]}}}** = \`${String(vars[m[1]]).slice(0, 200) || '(empty)'}\`` : `**{{${m[1]}}}** has no value in the active environment` }],
          };
        }
        return null;
      },
    });
  }
}

const baseOptions = (fontSize) => ({
  theme: 'apiwb',
  fontFamily: MONO,
  fontSize,
  automaticLayout: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  tabSize: 2,
  wordWrap: 'on',
  renderLineHighlight: 'line',
  fixedOverflowWidgets: true,
});

/**
 * The text with each {{variable}} replaced by a number of the same length, so it parses
 * as JSON and every position in it still lines up with the original.
 */
export const withStandIns = (text) => text.replace(/\{\{[^{}]*\}\}/g, (m) => '1' + '0'.repeat(m.length - 1));

/**
 * Checks JSON that may contain {{variables}}. Each variable is swapped for a number of
 * the same length before parsing, so positions in error messages still line up.
 * @returns {null | { message: string, line: number, column: number }} null when valid
 */
export function checkJson(text) {
  const stand = withStandIns(text);
  try {
    JSON.parse(stand);
    return null;
  } catch (e) {
    let line = 1;
    let column = 1;
    const lc = e.message.match(/line (\d+) column (\d+)/);
    const pos = e.message.match(/position (\d+)/);
    if (lc) {
      line = Number(lc[1]);
      column = Number(lc[2]);
    } else if (pos) {
      const before = stand.slice(0, Number(pos[1]));
      line = before.split('\n').length;
      column = before.length - before.lastIndexOf('\n');
    } else {
      line = stand.split('\n').length; // "Unexpected end of JSON input"
      column = stand.length - stand.lastIndexOf('\n');
    }
    const message = e.message.replace(/^JSON\.parse: /, '').replace(/ in JSON at position \d+.*$/, '');
    return { message, line, column };
  }
}

/**
 * The request body editor.
 * @returns {{ setValue(text), setLanguage(lang), setProblems(list), setSchema(schema|null), focus() }}
 */
export function createBodyEditor(monaco, container, { onChange }) {
  const model = monaco.editor.createModel('', 'json', monaco.Uri.parse('inmemory://apiwb/request-body.json'));
  const editor = monaco.editor.create(container, { ...baseOptions(13), model, lineNumbers: 'on', glyphMargin: false, folding: true });
  let silent = false;
  let decorations = editor.createDecorationsCollection();

  // {{variables}} stand out: green when the environment has them, red when it does not.
  const decorate = () => {
    const vars = getVariables();
    const found = [];
    for (const m of model.findMatches('\\{\\{\\s*([A-Za-z0-9_.-]+)\\s*\\}\\}', false, true, false, null, true)) {
      const name = m.matches[1];
      found.push({ range: m.range, options: { inlineClassName: Object.prototype.hasOwnProperty.call(vars, name) ? 'mono-var' : 'mono-var-missing' } });
    }
    decorations.set(found);
  };

  model.onDidChangeContent(() => {
    decorate();
    if (!silent) onChange(model.getValue());
  });

  return {
    setValue(text) {
      if (model.getValue() === text) return; // keeps the cursor where it is
      silent = true;
      model.setValue(text);
      silent = false;
    },
    setLanguage(language) {
      if (model.getLanguageId() !== language) monaco.editor.setModelLanguage(model, language);
    },
    /**
     * Underlines problems: a syntax error ({line, column}) or differences from the design
     * ({start, end} offsets). severity 'error' is red, 'warning' yellow.
     */
    setProblems(problems) {
      monaco.editor.setModelMarkers(model, 'apiwb', problems.map((p) => {
        const severity = p.severity === 'warning' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Error;
        if (p.start != null) {
          const from = model.getPositionAt(p.start);
          const to = model.getPositionAt(Math.max(p.end, p.start + 1));
          return { severity, message: p.message, startLineNumber: from.lineNumber, startColumn: from.column, endLineNumber: to.lineNumber, endColumn: to.column };
        }
        return { severity, message: p.message, startLineNumber: p.line, startColumn: p.column, endLineNumber: p.line, endColumn: p.column + 1 };
      }));
    },
    /**
     * The JSON Schema the design implies, for property-name suggestions (Ctrl+Space).
     * Monaco's own validation stays off: our check understands {{variables}}, its does not.
     */
    setSchema(schema) {
      monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
        validate: false,
        schemas: schema ? [{ uri: 'inmemory://apiwb/design-request-schema.json', fileMatch: [model.uri.toString()], schema }] : [],
      });
    },
    refreshVariables: decorate,
    focus: () => editor.focus(),
  };
}

/**
 * The read-only response viewer: folding, Ctrl+F, copy of any selection, fast on big bodies.
 * @returns {{ show(text, language), setFontSize(px) }}
 */
export function createResponseViewer(monaco, container) {
  const model = monaco.editor.createModel('', 'plaintext');
  const editor = monaco.editor.create(container, {
    ...baseOptions(13), model, readOnly: true, domReadOnly: true, lineNumbers: 'on', folding: true,
    renderValidationDecorations: 'off',
  });
  return {
    show(text, language) {
      if (model.getLanguageId() !== language) monaco.editor.setModelLanguage(model, language);
      model.setValue(text);
      editor.setScrollTop(0);
    },
    setFontSize: (px) => editor.updateOptions({ fontSize: px }),
  };
}
