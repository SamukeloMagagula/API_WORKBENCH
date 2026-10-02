# API Workbench

An internal web UI for developers to **test APIs** (send GET, POST, PUT, PATCH, DELETE, HEAD and OPTIONS
requests and inspect the responses) and **design APIs** (describe endpoints and export an OpenAPI 3 spec).

- **Environments and `{{variables}}`**: put `{{baseUrl}}` or `{{token}}` in a request, then switch between
  dev, UAT and prod from the picker at the top right.
- **curl in, code out**: paste a curl command to build a request; copy any request as curl, PowerShell or
  Python.
- **Shared collections** (optional): with devhub sign-in turned on, collections and environments can be
  saved on the server, privately or shared with everyone.
- **Access control and audit** (optional): only people signed in to devhub can use the proxy, and every
  call is written to devhub's activity log.
- The same folder runs **locally** on a developer's machine or **hosted** on a shared internal server.
- Plain PHP + plain JavaScript. No build step, no Composer, no npm.

## Requirements

- PHP **8.0+** with the **curl** extension enabled.
- For devhub sign-in and shared collections: `pdo_mysql`, and devhub installed on the same server.
- A modern browser (Chrome, Edge, Firefox, Safari).

On Rocky/RHEL with Apache: `sudo dnf install httpd php php-common php-mysqlnd` (curl ships in
`php-common`), then `sudo systemctl restart httpd` (and `php-fpm` if PHP runs through it).

On Windows: `winget install PHP.PHP.8.3`, then in `php.ini` make sure `extension=curl` is not commented out
(run `php --ini` to find the file; copy `php.ini-development` to `php.ini` if there is none).

## Configuration

Configuration works the same way as devhub, in two places:

| File | Holds | Where it lives |
|---|---|---|
| `settings.php` | every setting, as constants with `APIWB_*` environment overrides | in the app, deployed with it. **Defaults are the production layout**, so a server needs no environment at all |
| `config.php` | database credentials: `DB_*` constants and `connect(): PDO` | **outside the web root**, at `/var/www/html/private/config.php`. It is the same file devhub uses, because the tables live in devhub's database. `config.example.php` shows its shape |

Nothing secret is in the repository, and nothing secret is inside the served folder.

| Variable | Default | What it is |
|---|---|---|
| `APIWB_CONFIG` | `/var/www/html/private/config.php` | the file defining `connect(): PDO` (devhub's) |
| `APIWB_MODE` | `hosted` | `hosted` blocks loopback, private (10.x, 172.16–31.x, 192.168.x), link-local (incl. cloud metadata 169.254.169.254) and other reserved addresses unless allow-listed. `local` may call anything, including localhost |
| `APIWB_AUTH` | `devhub` | `devhub`: devhub sign-in, database storage, audit log. `none`: anyone, browser-only storage, no database |
| `APIWB_DEVHUB_URL` | `/devhub/` | where the "Sign in via devhub" link points |
| `APIWB_ALLOWED_HOSTS` | *(none)* | comma-separated hosts allowed even if they resolve to private addresses: `api.corp.local,*.dev.corp.local` |
| `APIWB_RESTRICT_HOSTS` | *(off)* | `1`: *only* the allowed hosts can be called |
| `APIWB_BLOCKED_HOSTS` | *(none)* | comma-separated hosts never called, in any mode |
| `APIWB_TIMEOUT` | `30` | per-request timeout, seconds |
| `APIWB_MAX_REQUEST_MB` | `10` | largest request the proxy accepts |
| `APIWB_MAX_RESPONSE_MB` | `5` | responses are cut off (and flagged) beyond this |
| `APIWB_MAX_ITEM_MB` | `2` | largest single collection or environment saved to the database |
| `APIWB_VERIFY_TLS` | *(on)* | `0` only for internal APIs with self-signed certificates |

On Apache, set overrides with `SetEnv` (needs `mod_env`, on by default), then `systemctl restart httpd`:

```apache
<Directory "/var/www/html/API_WORKBENCH">
    SetEnv APIWB_ALLOWED_HOSTS "api.corp.local,*.dev.corp.local"
</Directory>
```

Apache's `SetEnv` values are not visible to a shell, so `check.php` reports the settings *its own* run
sees. Export the same variables before running it if you want them checked too.

## Run locally

No database and no sign-in: everything is saved in the browser, and localhost can be called.

```sh
APIWB_MODE=local APIWB_AUTH=none php -S localhost:8080
```

On Windows PowerShell:

```powershell
$env:APIWB_MODE = 'local'; $env:APIWB_AUTH = 'none'; php -S localhost:8080
```

Open http://localhost:8080 and send a request from the Tester.
Opening `index.html` directly from disk will not work for the Tester; it must be served by PHP.

## Host on a shared server

1. Copy the folder into the web root, next to devhub, for example `/var/www/html/API_WORKBENCH/`.
2. Make sure devhub's `/var/www/html/private/config.php` exists. API Workbench reads the same file.
3. Create the table (next section) and set `APIWB_ALLOWED_HOSTS` for the internal APIs people need.
4. Make sure `src/`, `bootstrap.php`, `settings.php`, `check.php`, `config*.php` and `*.sql` are not served:
   - **Apache:** the included `.htaccess` files handle this (`AllowOverride All` must be on).
   - **Nginx:**
     ```nginx
     location ~ ^/(src/|(config(\.example)?|check|bootstrap|settings)\.php$|.*\.sql$|\.) { deny all; }
     ```
   - **IIS:** add Request Filtering rules denying the same paths.
5. Serve it over HTTPS if possible. Bearer tokens and passwords typed into the Tester pass through this server.

## Sign-in, shared collections and audit (devhub)

API Workbench has no user list of its own. It reads **devhub's PHP session**: both apps run on the same
server, so they share the session store and cookie, and anyone signed in to devhub is signed in here.
devhub's CSRF token (kept in that session) protects this app's writes too. The database is reached the
same way devhub reaches it: `require CONFIG_PATH`, then `connect()`.

1. **Create the table**, in devhub's database. It is additive and safe to re-run. Take a dump first.
   ```sh
   mariadb devhub < schema.sql
   ```
2. **Check it:** `sudo -u apache php check.php` confirms `pdo_mysql`, the config file, the connection,
   and the `users`, `activity_log` and `apiwb_items` tables.

This is the default (`APIWB_AUTH=devhub`), so there is nothing to switch on. Once running:

| | |
|---|---|
| **Proxy** | refuses anyone not signed in to devhub; every call needs the session's CSRF token |
| **Audit** | every call is written to devhub's `activity_log` as `apiwb.request`, e.g. `GET https://api.corp/users -> 200`. The query string is left out because it often carries keys. Saves and deletes are logged as `apiwb.collection.save`, `apiwb.environment.delete` and so on. They appear on devhub's admin **Logs** page |
| **Collections and environments** | can be saved on the server, either **private** (only you) or **shared** (everyone signed in) |

Who can do what with server items:

| | Private | Shared |
|---|---|---|
| See and use | owner | everyone signed in |
| Edit contents | owner | everyone signed in |
| Rename, share or unshare, delete | owner | owner or a devhub admin |

Two people editing the same shared item cannot silently overwrite each other. Every save carries the
version it was loaded at. A save made after someone else's is refused, with a message naming who saved
and a prompt to reload.

**Shared environments are readable by everyone signed in, tokens included.** Keep personal tokens in a
private environment, or in one stored in your browser.

## Environments and variables

Write `{{name}}` anywhere in the URL, query params, headers, Auth fields or body. Pick an environment from
the **Environment** picker above the URL bar, and the values are filled in when the request is sent.

- **Manage** creates and edits environments. Each is stored in this browser, or on the server (private or
  shared) when devhub sign-in is on.
- Under the URL bar, a preview line shows what the URL resolves to, or which variables have no value.
- A request with an unfilled variable is not sent. The error names the variable.
- Saved requests and history keep the `{{variables}}`, so the same request works against every environment.

## curl in, code out

- **Import curl**, or paste a curl command straight into the URL box. It understands browser
  "Copy as cURL" output (bash and Windows cmd), `-X -H -d --data-raw --data-urlencode --json -u -G -I -A
  -b -e`, and line continuations. Anything it cannot carry over (file uploads, `-F` forms, client
  certificates) is reported rather than silently dropped. A `Bearer` header moves into the Auth tab.
- **Code** shows the current request as **curl**, **PowerShell** (`Invoke-RestMethod`, works on Windows
  PowerShell 5.1) or **Python** (`requests`), with environment values filled in.

## How it works

```
Browser (index.html + js/)                       PHP
  Tester ── POST proxy.php {method,url,...} ──▶  proxy.php  sign-in + CSRF (APIWB_AUTH=devhub)
                                                   ProxyRequest  validate input
                                                   HostPolicy    check host against config, resolve DNS once
                                                   Forwarder     send with cURL pinned to that IP
                                                   activity_log  who sent what (APIWB_AUTH=devhub)
         ◀── {status, headers, body, timeMs} ──
  Saved / environments ── api.php ─────────────▶  api.php    Auth (devhub session) + ItemStore (apiwb_items)
  Designer ── runs entirely in the browser (js/openapi.js converts to/from OpenAPI 3)
```

- The browser cannot call most APIs directly because of CORS. That's why requests go through `proxy.php`.
- Redirects are **shown, not followed**, so every hop gets checked by the host policy. Copy the `Location`
  header into the URL bar to follow one.
- Both endpoints only accept JSON POSTs from their own page (Origin check). If you put them behind a reverse
  proxy that rewrites `Host`, make sure the original `Host` header is passed through.
- The devhub session is opened only long enough to read who is signed in, then released. A slow proxied
  call therefore never holds up devhub in another tab.

## Troubleshooting

**Start with the health check.** It reports the PHP version, curl, the config, whether every PHP file
parses on this PHP, and (unless `APIWB_AUTH=none`) the database connection and tables. Run it as the user the
web server runs as:

```sh
sudo -u apache php check.php     # Linux server
php check.php                    # local
```

`check.php` only runs from the command line. Over HTTP it answers 404, and `.htaccess` denies it.

**What the error in the Tester means:**

| Shown | Meaning | Look at |
|---|---|---|
| `SERVER_ERROR` / `Fatal: ...` | PHP reached the endpoint and crashed. The message names the file and line | `php check.php` |
| `CONFIG_ERROR` | PHP too old, curl missing, a setting invalid, or the database config unreadable | `php check.php` |
| `NOT_SIGNED_IN` | you are not signed in to devhub | sign in to devhub, then reload |
| `CSRF` | the page's session token is stale (signed out and in again elsewhere) | reload the page |
| `CONFLICT` | someone saved the same shared collection or environment after you loaded it | reload, then redo your change |
| `MISSING_VARIABLES` | a `{{variable}}` has no value in the chosen environment | the Environment picker, or **Manage** |
| `URL_NOT_ALLOWED` | hosted mode refused the host | `APIWB_ALLOWED_HOSTS` |
| `CONNECTION_FAILED` / `TIMEOUT` / `TLS_ERROR` | the proxy ran, the target API did not answer | the target, from the server: `curl -v <url>` |
| `NETWORK_ERROR` ... *without JSON* | the request never reached the PHP code. The web server refused it, or PHP is not wired up | the web server error log (`/var/log/httpd/error_log`, or the `php -S` terminal) |

`proxy.php` and `api.php` answer in JSON even when they crash, so a response *without* JSON almost always
comes from Apache, not the app. Common causes:

- PHP is not handling `.php` files for this directory.
- `AllowOverride` forbids a directive in `.htaccess`. The whole folder then answers 500, so check whether
  `index.html` loads at all.
- The page was opened from disk (`file://`) instead of through the web server.

**Signed in to devhub, but this app says you are not.** The two apps must share a host name: a session
cookie set for `devhub.corp` is not sent to `tools.corp`. They must also share PHP's session store (the
same `session.save_path`, true for two folders under one Apache).

## Project layout

```
index.html            page shell
css/app.css           styles
js/app.js             entry point: sign-in state, tab switching
js/tester.js          Tester tab
js/collections.js     saved-request collections (browser + server)
js/environments.js    environments, the picker, the editor
js/variables.js       {{variable}} substitution
js/curl.js            curl command -> request
js/codegen.js         request -> curl / PowerShell / Python
js/session.js         sign-in state and api.php calls
js/designer.js        Designer tab
js/openapi.js         designer model <-> OpenAPI 3, validation, "Try it"
js/kvtable.js         editable name/value table
js/dom.js, storage.js helpers (DOM, modal, toast, localStorage)
vendor/js-yaml.min.js YAML support (MIT)
proxy.php             sends requests
api.php               sign-in state, shared collections and environments
bootstrap.php         shared start of both endpoints: JSON error nets, PHP version check (not served)
check.php             command-line health check (not served)
schema.sql            the apiwb_items table, for devhub's database (not served)
src/                  server classes (not web-accessible)
settings.php          every setting, with APIWB_* environment overrides (not served)
config.example.php    shape of the database config.php, which lives outside the web root
```

## Limits of this version

- No multipart file uploads, cookie jar, or WebSockets.
- Signing in happens on devhub's page. There is no sign-in form here.
- Only one browser-only collection ("This browser"). Create more as server collections.
- The Designer still saves to the browser only, not to the server.
- The Designer describes bodies by example (the schema is inferred). Importing an OpenAPI file keeps paths,
  operations, parameters and examples. Shared `components` are inlined, and security schemes are not imported.
