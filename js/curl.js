// Turns a pasted curl command into a Tester request. Pure functions.
//
// Understands what browsers' "Copy as cURL" and API docs produce: bash quoting
// ('...', "...", $'...'), Windows cmd quoting (^"...^"), line continuations
// (\ in bash, ^ in cmd, ` in PowerShell), and the common flags. Anything it cannot
// carry over (file uploads, client certificates...) is reported, not silently dropped.

const VALUE_FLAGS = new Set([
  '-X', '--request', '-H', '--header', '-d', '--data', '--data-raw', '--data-binary', '--data-ascii',
  '--data-urlencode', '--json', '-u', '--user', '--url', '-A', '--user-agent', '-b', '--cookie', '-e', '--referer',
  '-F', '--form', '--form-string', '-o', '--output', '-m', '--max-time', '--connect-timeout', '-x', '--proxy',
  '--cacert', '--cert', '-E', '--key', '-w', '--write-out', '-T', '--upload-file', '--retry', '-r', '--range',
  '--resolve', '--interface', '-c', '--cookie-jar',
]);

const IGNORED = new Set([
  '-L', '--location', '-k', '--insecure', '-s', '--silent', '-S', '--show-error', '-v', '--verbose', '-i', '--include',
  '--compressed', '-f', '--fail', '-#', '--progress-bar', '-N', '--no-buffer', '-g', '--globoff', '--http1.1', '--http2',
  '-o', '--output', '-m', '--max-time', '--connect-timeout', '-w', '--write-out', '--retry', '-c', '--cookie-jar',
]);

export const looksLikeCurl = (text) => /^\s*curl(\.exe)?\s/i.test(text);

function tokenize(input) {
  let text = input.trim();
  // cmd.exe quoting: ^" is a literal quote and ^ escapes the next character.
  if (/\^"/.test(text)) text = text.replace(/\^\r?\n/g, ' ').replace(/\^(.)/g, '$1');
  text = text.replace(/\\\r?\n/g, ' ').replace(/`\r?\n/g, ' ');

  const tokens = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (i >= text.length) break;
    let token = '';
    while (i < text.length && !/\s/.test(text[i])) {
      const c = text[i];
      if (c === "'") {
        const end = text.indexOf("'", i + 1);
        token += text.slice(i + 1, end < 0 ? text.length : end);
        i = end < 0 ? text.length : end + 1;
      } else if (c === '$' && text[i + 1] === "'") {
        i += 2;
        while (i < text.length && text[i] !== "'") {
          if (text[i] === '\\' && i + 1 < text.length) {
            const n = text[i + 1];
            token += { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', 0: '\0' }[n] ?? n;
            i += 2;
          } else token += text[i++];
        }
        i++;
      } else if (c === '"') {
        i++;
        while (i < text.length && text[i] !== '"') {
          if (text[i] === '\\' && '"\\$`'.includes(text[i + 1])) { token += text[i + 1]; i += 2; } else token += text[i++];
        }
        i++;
      } else if (c === '\\' && i + 1 < text.length) {
        token += text[i + 1];
        i += 2;
      } else {
        token += c;
        i++;
      }
    }
    tokens.push(token);
  }
  return tokens;
}

/** @returns {{ request: object, warnings: string[] }} */
export function parseCurl(input) {
  const tokens = tokenize(input);
  if (!tokens.length || !/^curl(\.exe)?$/i.test(tokens[0])) throw new Error('This does not start with curl.');

  const warnings = new Set();
  let method = null;
  let url = '';
  let head = false;
  let get = false;
  const headers = [];
  const data = [];
  let user = null;

  for (let i = 1; i < tokens.length; i++) {
    let flag = tokens[i];
    let value;
    if (flag.startsWith('--') && flag.includes('=')) {
      [flag, value] = [flag.slice(0, flag.indexOf('=')), flag.slice(flag.indexOf('=') + 1)];
    } else if (/^-[A-Za-z]./.test(flag) && VALUE_FLAGS.has(flag.slice(0, 2))) {
      [flag, value] = [flag.slice(0, 2), flag.slice(2)];
    }
    if (!flag.startsWith('-')) {
      if (!url) url = flag;
      continue;
    }
    // Combined short switches such as -sSL or -kI
    if (value === undefined && /^-[A-Za-z]{2,}$/.test(flag)) {
      for (const c of flag.slice(1)) {
        if (c === 'I') head = true;
        else if (c === 'G') get = true;
        else if (!IGNORED.has(`-${c}`)) warnings.add(`Unrecognised option -${c} was ignored.`);
      }
      continue;
    }
    if (VALUE_FLAGS.has(flag) && value === undefined) value = tokens[++i] ?? '';

    switch (flag) {
      case '-X': case '--request': method = value.toUpperCase(); break;
      case '-H': case '--header': {
        const colon = value.indexOf(':');
        if (colon > 0) headers.push({ name: value.slice(0, colon).trim(), value: value.slice(colon + 1).trim(), enabled: true });
        break;
      }
      case '-d': case '--data': case '--data-raw': case '--data-binary': case '--data-ascii':
        if (value.startsWith('@') && flag !== '--data-raw') warnings.add(`The body is read from a file (${value}); paste its contents into the Body tab.`);
        else data.push(value);
        break;
      case '--json':
        data.push(value);
        headers.push({ name: 'Content-Type', value: 'application/json', enabled: true }, { name: 'Accept', value: 'application/json', enabled: true });
        break;
      case '--data-urlencode': {
        const eq = value.indexOf('=');
        data.push(eq > 0 ? `${value.slice(0, eq)}=${encodeURIComponent(value.slice(eq + 1))}` : encodeURIComponent(value.replace(/^=/, '')));
        break;
      }
      case '-u': case '--user': user = value; break;
      case '--url': url = value; break;
      case '-A': case '--user-agent': headers.push({ name: 'User-Agent', value, enabled: true }); break;
      case '-b': case '--cookie':
        if (value.includes('=')) headers.push({ name: 'Cookie', value, enabled: true });
        else warnings.add(`Cookies are read from a file (${value}); add a Cookie header instead.`);
        break;
      case '-e': case '--referer': headers.push({ name: 'Referer', value, enabled: true }); break;
      case '-G': case '--get': get = true; break;
      case '-I': case '--head': head = true; break;
      case '-F': case '--form': case '--form-string': warnings.add('Multipart form fields (-F) are not supported and were left out.'); break;
      case '-T': case '--upload-file': warnings.add('File uploads (-T) are not supported and were left out.'); break;
      case '-x': case '--proxy': warnings.add('The curl proxy setting (-x) does not apply here and was ignored.'); break;
      case '--cert': case '-E': case '--key': case '--cacert': warnings.add('Client certificates are not supported and were ignored.'); break;
      default:
        if (!IGNORED.has(flag)) warnings.add(`Unrecognised option ${flag} was ignored.`);
    }
  }
  if (!url) throw new Error('No URL found in the curl command.');

  let body = data.join('&');
  if (get && body) {
    url += (url.includes('?') ? '&' : '?') + body;
    body = '';
  }
  method ??= head ? 'HEAD' : body ? 'POST' : 'GET';

  const contentType = headers.find((x) => x.name.toLowerCase() === 'content-type')?.value.toLowerCase() || '';
  const request = {
    method,
    url,
    headers,
    auth: { type: 'none', token: '', username: '', password: '' },
    body: { type: 'none', text: '', form: [] },
  };

  if (body) {
    const parsesAsJson = (() => { try { JSON.parse(body); return /^\s*[[{]/.test(body); } catch { return false; } })();
    if (contentType.includes('json') || (!contentType && parsesAsJson)) {
      request.body = { type: 'json', text: parsesAsJson ? JSON.stringify(JSON.parse(body), null, 2) : body, form: [] };
    } else if (contentType.includes('x-www-form-urlencoded') || (!contentType && /^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(body))) {
      const form = body.split('&').map((pair) => {
        const eq = pair.indexOf('=');
        const dec = (s) => { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; } };
        return { name: dec(eq >= 0 ? pair.slice(0, eq) : pair), value: dec(eq >= 0 ? pair.slice(eq + 1) : ''), enabled: true };
      });
      request.body = { type: 'form', text: '', form };
    } else {
      request.body = { type: 'text', text: body, form: [] };
    }
  }

  if (user !== null) {
    const colon = user.indexOf(':');
    request.auth = { type: 'basic', token: '', username: colon >= 0 ? user.slice(0, colon) : user, password: colon >= 0 ? user.slice(colon + 1) : '' };
  } else {
    // A bearer token is easier to edit in the Auth tab than buried in the headers.
    const auth = headers.find((x) => x.name.toLowerCase() === 'authorization' && /^bearer\s+/i.test(x.value));
    if (auth) {
      request.auth = { type: 'bearer', token: auth.value.replace(/^bearer\s+/i, ''), username: '', password: '' };
      headers.splice(headers.indexOf(auth), 1);
    }
  }

  return { request, warnings: [...warnings] };
}
