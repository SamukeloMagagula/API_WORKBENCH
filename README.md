# API Workbench

An internal web UI for developers to **test APIs** (send GET, POST, PUT, PATCH, DELETE, HEAD and OPTIONS
requests and inspect the responses) and **design APIs** (describe endpoints and export an OpenAPI 3 spec).

- No logins and no database. Saved requests, history and API designs live in each user's browser
  (localStorage). Use the Export/Import and Download buttons to share them as files.
- The same folder runs **locally** on a developer's machine or **hosted** on a shared internal server.
- Plain PHP + plain JavaScript. No build step, no Composer, no npm.

## Requirements

- PHP **8.0+** with the **curl** extension enabled.
- A modern browser (Chrome, Edge, Firefox, Safari).

On Rocky/RHEL with Apache: `sudo dnf install httpd php php-common` (curl ships in `php-common`), then
`sudo systemctl restart httpd` (and `php-fpm` if PHP runs through it).

On Windows: `winget install PHP.PHP.8.3`, then in `php.ini` make sure `extension=curl` is not commented out
(run `php --ini` to find the file; copy `php.ini-development` to `php.ini` if there is none).

## Run locally

```sh
php -S localhost:8080
```

Open http://localhost:8080 and send a request from the Tester.
Opening `index.html` directly from disk will not work for the Tester; it must be served by PHP.

## Host on a shared server

1. Copy the folder to a PHP-enabled web root (Apache, Nginx + PHP-FPM, or IIS).
2. `cp config.example.php config.php` and set `'mode' => 'hosted'`.
3. List the internal hosts people need to reach in `allowed_hosts` (see below).
4. Make sure `src/` and `config*.php` are not served:
   - **Apache:** the included `.htaccess` files handle this (`AllowOverride All` must be on).
   - **Nginx:**
     ```nginx
     location ~ ^/(src/|config(\.example)?\.php$|\.) { deny all; }
     ```
   - **IIS:** add a Request Filtering rule denying the `src` segment and the two config files.
5. Serve it over HTTPS if possible. Bearer tokens and passwords typed into the Tester pass through this server.

## Configuration (`config.php`)

| Key | Default | Meaning |
|---|---|---|
| `mode` | `local` | `local` may call anything, including localhost. `hosted` blocks loopback, private (10.x, 172.16–31.x, 192.168.x), link-local (incl. cloud metadata 169.254.169.254) and other reserved addresses. |
| `allowed_hosts` | `[]` | Hosts allowed even if they resolve to private addresses. Exact (`api.dev.corp`) or wildcard (`*.dev.corp`). |
| `restrict_to_allowed_hosts` | `false` | If `true`, *only* `allowed_hosts` can be called. |
| `blocked_hosts` | `[]` | Never called, in any mode. |
| `timeout_seconds` | `30` | Per-request timeout. |
| `max_request_bytes` | 10 MB | Largest request the proxy accepts. |
| `max_response_bytes` | 5 MB | Responses are cut off (and flagged) beyond this. |
| `verify_tls` | `true` | Set `false` only for internal APIs with self-signed certificates. |

`config.php` is gitignored. When it is missing, `config.example.php` is used.

## How it works

```
Browser (index.html + js/)                       PHP (proxy.php + src/)
  Tester ── POST proxy.php {method,url,...} ──▶  ProxyRequest  validate input
                                                 HostPolicy    check host against config, resolve DNS once
                                                 Forwarder     send with cURL pinned to that IP
         ◀── {status, headers, body, timeMs} ──
  Designer ── runs entirely in the browser (js/openapi.js converts to/from OpenAPI 3)
```

- The browser cannot call most APIs directly because of CORS. That's why requests go through `proxy.php`.
- Redirects are **shown, not followed**, so every hop gets checked by the host policy. Copy the `Location`
  header into the URL bar to follow one.
- The proxy only accepts JSON POSTs from its own page (Origin check). If you put it behind a reverse proxy
  that rewrites `Host`, make sure the original `Host` header is passed through.
- Nothing is logged except unexpected server errors (to the PHP error log, without request contents).

## Troubleshooting

**Start with the health check.** It reports the PHP version, curl, the config, and whether every PHP
file parses on this PHP. Run it as the user the web server runs as:

```sh
sudo -u apache php check.php     # Linux server
php check.php                    # local
```

`check.php` only runs from the command line. Over HTTP it answers 404, and `.htaccess` denies it.

**What the error in the Tester means:**

| Shown | Meaning | Look at |
|---|---|---|
| `SERVER_ERROR` / `Fatal: ...` | PHP reached `proxy.php` and crashed. The message names the file and line | `php check.php` |
| `CONFIG_ERROR` | PHP too old, curl missing, or `config.php` invalid | `php check.php` |
| `URL_NOT_ALLOWED` | hosted mode refused the host | `allowed_hosts` in `config.php` |
| `CONNECTION_FAILED` / `TIMEOUT` / `TLS_ERROR` | the proxy ran, the target API did not answer | the target, from the server: `curl -v <url>` |
| `NETWORK_ERROR` ... *without JSON* | the request never reached the proxy code. The web server refused it, or PHP is not wired up | the web server error log (`/var/log/httpd/error_log`, or the `php -S` terminal) |

`proxy.php` answers in JSON even when it crashes, so a response *without* JSON almost always comes from
Apache, not the app. Common causes:

- PHP is not handling `.php` files for this directory.
- `AllowOverride` forbids a directive in `.htaccess`. The whole folder then answers 500, so check whether
  `index.html` loads at all.
- The page was opened from disk (`file://`) instead of through the web server.

## Project layout

```
index.html            page shell
css/app.css           styles (light and dark)
js/app.js             entry point, tab switching
js/tester.js          Tester tab
js/designer.js        Designer tab
js/openapi.js         designer model <-> OpenAPI 3, validation, "Try it"
js/kvtable.js         editable name/value table
js/dom.js, storage.js helpers
vendor/js-yaml.min.js YAML support (MIT)
proxy.php             the only server endpoint
check.php             command-line health check (not served)
src/                  proxy classes (not web-accessible)
config.example.php    configuration template
```

## Limits of this version

- No logins, no shared server-side storage, and no team collections.
- No environment variables (`{{baseUrl}}`), multipart file uploads, cookies jar, or WebSockets.
- The Designer describes bodies by example (the schema is inferred). Importing an OpenAPI file keeps paths,
  operations, parameters and examples. Shared `components` are inlined, and security schemes are not imported.
