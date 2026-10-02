// Turns a request into code: curl, PowerShell or Python. Pure functions.
// Input is the outgoing request the Tester sends: { method, url, headers: [{name, value}], body }.

const shellQuote = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;
const pyQuote = (s) => JSON.stringify(String(s)); // a JSON string literal is a valid Python one

export function toCurl({ method, url, headers, body }) {
  const lines = [method === 'HEAD' ? `curl --head ${shellQuote(url)}` : `curl${method === 'GET' ? '' : ` -X ${method}`} ${shellQuote(url)}`];
  for (const { name, value } of headers) lines.push(`  -H ${shellQuote(`${name}: ${value}`)}`);
  if (body !== null && body !== '') lines.push(`  --data-raw ${shellQuote(body)}`);
  return lines.join(' \\\n');
}

/**
 * Windows PowerShell 5.1 compatible. Content-Type and User-Agent go through their own
 * parameters: 5.1 refuses some of them in -Headers.
 */
export function toPowerShell({ method, url, headers, body }) {
  const pick = (n) => headers.find((x) => x.name.toLowerCase() === n)?.value;
  const contentType = pick('content-type');
  const userAgent = pick('user-agent');
  const rest = headers.filter((x) => !['content-type', 'user-agent'].includes(x.name.toLowerCase()));

  const out = [];
  if (rest.length) {
    out.push('$headers = @{');
    for (const { name, value } of rest) out.push(`    ${psQuote(name)} = ${psQuote(value)}`);
    out.push('}');
  }
  const hasBody = body !== null && body !== '';
  if (hasBody) {
    // A here-string keeps JSON readable; its terminator must not appear at a line start inside it.
    if (/^'@/m.test(body)) out.push(`$body = ${psQuote(body)}`);
    else out.push("$body = @'", body, "'@");
  }
  if (out.length) out.push('');

  const params = [`-Uri ${psQuote(url)}`, `-Method ${method[0]}${method.slice(1).toLowerCase()}`];
  if (rest.length) params.push('-Headers $headers');
  if (contentType) params.push(`-ContentType ${psQuote(contentType)}`);
  if (userAgent) params.push(`-UserAgent ${psQuote(userAgent)}`);
  if (hasBody) params.push('-Body $body');
  out.push(`$response = Invoke-RestMethod ${params.join(' ')}`);
  out.push('$response | ConvertTo-Json -Depth 10');
  return out.join('\n');
}

export function toPython({ method, url, headers, body }) {
  const out = ['import requests', '', `url = ${pyQuote(url)}`];
  if (headers.length) {
    out.push('headers = {');
    for (const { name, value } of headers) out.push(`    ${pyQuote(name)}: ${pyQuote(value)},`);
    out.push('}');
  }
  const hasBody = body !== null && body !== '';
  if (hasBody) out.push(`payload = ${pyQuote(body)}`);
  out.push('');
  const args = [pyQuote(method), 'url'];
  if (headers.length) args.push('headers=headers');
  if (hasBody) args.push('data=payload');
  out.push(`response = requests.request(${args.join(', ')})`);
  out.push('print(response.status_code)', 'print(response.text)');
  return out.join('\n');
}

export const GENERATORS = [
  { id: 'curl', label: 'curl', fn: toCurl },
  { id: 'powershell', label: 'PowerShell', fn: toPowerShell },
  { id: 'python', label: 'Python', fn: toPython },
];
