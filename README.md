# API Workbench

An internal web UI for developers to **test APIs** (send GET, POST, PUT, PATCH, DELETE, HEAD and OPTIONS
requests and inspect the responses) and **design APIs** (describe endpoints and export an OpenAPI 3 spec).

A standalone application: its own database, its own accounts, no dependency on any other app.

- **Accounts**: sign in or create an account. Passwords follow strict rules, sign-in is rate limited,
  and every form is protected against cross-site forgery.
- **Environments and `{{variables}}`**: put `{{baseUrl}}` or `{{token}}` in a request, then switch between
  dev, UAT and prod from the picker above the URL bar.
- **curl in, code out**: paste a curl command to build a request; copy any request as curl, PowerShell or
  Python.
- **Shared collections**: save collections and environments to the database, privately or shared with
  everyone.
- **Audit**: every sign-in, every proxied call and every save or delete is written to the activity log.
- Plain PHP + plain JavaScript + MariaDB. No build step, no Composer, no npm.

## Requirements

- PHP **8.0+** with the **curl** and **pdo_mysql** extensions.
- MariaDB (or MySQL).
- A modern browser (Chrome, Edge, Firefox, Safari).

On Rocky/RHEL with Apache: `sudo dnf install httpd php php-common php-mysqlnd` (curl ships in
`php-common`), then `sudo systemctl restart httpd` (and `php-fpm` if PHP runs through it).

On Windows: `winget install PHP.PHP.8.3`, then in `php.ini` make sure `extension=curl` and
`extension=pdo_mysql` are not commented out (run `php --ini` to find the file).

## Set up on the server

1. **Put the code in place**, for example `/var/www/html/API_WORKBENCH/` (`git clone` or `git pull`).
2. **Create the database and tables.** `schema.sql` creates the `apiworkbench` database. It is safe to
   re-run.
   ```sh
   sudo mariadb < schema.sql
   ```
3. **Create a database user** that can only reach this database:
   ```sql
   CREATE USER 'apiworkbench'@'localhost' IDENTIFIED BY 'a-long-random-password';
   GRANT SELECT, INSERT, UPDATE, DELETE ON apiworkbench.* TO 'apiworkbench'@'localhost';
   ```
4. **Create `config.php`** in the app folder from the template, and fill in that user's password:
   ```sh
   cd /var/www/html/API_WORKBENCH
   cp config.example.php config.php
   chmod 640 config.php && sudo chown root:apache config.php
   vi config.php
   ```
5. **Check it:** `sudo -u apache php check.php`. Every line should say `ok`.
6. **Open the app** and create the first account. **The first account created becomes an admin.**
7. Set `APIWB_ALLOWED_HOSTS` for the internal APIs people need to reach (see Configuration).

## Configuration

Configuration is split in two:

| File | Holds | Where it lives |
|---|---|---|
| `settings.php` | every setting, as constants with `APIWB_*` environment overrides | in the app, deployed with it. **Defaults are the production setup**, so a server needs no environment at all |
| `config.php` | database credentials: `DB_*` constants and `connect(): PDO` | **in the app folder**, at `/var/www/html/API_WORKBENCH/config.php`. Copy it from `config.example.php`. It is gitignored, so `git pull` never touches it |

Nothing secret is in the repository. The one secret file, `config.php`, sits in the app folder, and two
locks keep it private: `.htaccess` denies it, and PHP would run it rather than show it. Keep
`AllowOverride` on for this folder.

| Variable | Default | What it is |
|---|---|---|
| `APIWB_CONFIG` | `config.php` in the app folder | the file defining `connect(): PDO` |
| `APIWB_MODE` | `hosted` | `hosted` blocks loopback, private (10.x, 172.16–31.x, 192.168.x), link-local (incl. cloud metadata 169.254.169.254) and other reserved addresses unless allow-listed. `local` may call anything, including localhost |
| `APIWB_AUTH` | `login` | `login`: accounts, database storage, audit log. `none`: anyone, browser-only storage, no database |
| `APIWB_OWNER` | *(none)* | a username (email) that is always an admin. Without it, the first account is the admin |
| `APIWB_REGISTRATION_KEY` | *(none)* | when set, creating an account also needs this shared secret |
| `APIWB_EMAIL_DOMAIN` | *(none)* | when set, e.g. `@za.logicalis.com`, accounts must use an email ending in it |
| `APIWB_LOGIN_MAX_ATTEMPTS` | `10` | failed sign-ins allowed per username and per IP in the window |
| `APIWB_LOGIN_WINDOW` | `900` | that window, in seconds |
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
    SetEnv APIWB_EMAIL_DOMAIN "@za.logicalis.com"
</Directory>
```

Apache's `SetEnv` values are not visible to a shell, so `check.php` reports the settings *its own* run
sees. Export the same variables before running it if you want them checked too.

Make sure `src/`, `bootstrap.php`, `settings.php`, `check.php`, `config*.php` and `*.sql` are not served:
- **Apache:** the included `.htaccess` files handle this.
- **Nginx:** `location ~ ^/(src/|(config(\.example)?|check|bootstrap|settings)\.php$|.*\.sql$|\.) { deny all; }`
- **IIS:** add Request Filtering rules denying the same paths.

Serve it over HTTPS if possible. Passwords, and the tokens typed into the Tester, pass through this server.
The session cookie is marked `Secure` automatically on HTTPS.

## Run locally

No database and no accounts: everything is saved in the browser, and localhost can be called.

```sh
APIWB_MODE=local APIWB_AUTH=none php -S localhost:8080
```

On Windows PowerShell:

```powershell
$env:APIWB_MODE = 'local'; $env:APIWB_AUTH = 'none'; php -S localhost:8080
```

Open http://localhost:8080 and send a request from the Tester.
Opening `index.html` directly from disk will not work for the Tester; it must be served by PHP.

## Accounts, shared collections and audit

Opening the app while signed out goes to `login.php`, where people sign in or create an account.

- **Usernames are email addresses.** Set `APIWB_EMAIL_DOMAIN` to accept only your company's.
- **Passwords** need at least 10 characters, with an uppercase letter, a lowercase letter, a number and a
  special character. They are stored with `password_hash()`.
- **Sign-in is rate limited**, per username *and* per IP: per username alone lets one machine spray many
  accounts, per IP alone lets a distributed attempt through. A lockout message is the same whether or
  not the account exists.
- **Every form and every write carries a CSRF token.** Plain forms send it as a field, the app's calls as
  an `X-CSRF-Token` header.
- **The session cookie has its own name** (`apiwb_session`). Other PHP apps on the same host use PHP's
  default, and sharing it would let their sign-in leak into this one.
- **Admins** are the first account created, anyone made admin on the **Admin** tab, and `APIWB_OWNER`.

## Admin tab

Visible to admins only (and enforced by the server, not just hidden).

**Users**: every account with its role, status, creation date and last sign-in.

| Action | What it does |
|---|---|
| Make admin / Remove admin | grants or removes the right to manage accounts and see the log |
| Disable / Enable | a disabled account cannot sign in, and is signed out on its **next request** if it already is |
| Reset password | issues a one-time link to hand over directly (there is no email) |

Guard rails, enforced in `src/Admin.php`:

- Nobody can disable themselves or remove their own admin rights.
- The owner (`APIWB_OWNER`) can only be changed by the owner.
- The last active admin cannot be demoted or disabled.

**Password reset links** work **once**, for `APIWB_RESET_TTL` seconds (an hour). Issuing a new one cancels
any earlier link for that person. Only a SHA-256 of the link is stored, so a leaked database yields no
working links. The link is built from the address the admin is using, not from a `Host` header. Using
it clears any sign-in lockout on the account.

**Activity log**: newest first, 100 at a time, filtered by user, action, date range and text. Click a
username to see only that person. Failures are red, admin changes dark, and sign-ins green.

Every admin change is itself logged (`admin.user.update`, `admin.user.reset_link`).

**Locked out of every admin account?** Set `APIWB_OWNER` to your username in Apache's config and restart
it. The owner is always an admin.

Saved collections and environments:

| | Private | Shared |
|---|---|---|
| See and use | owner | everyone signed in |
| Edit contents | owner | everyone signed in |
| Rename, share or unshare, delete | owner | owner or an admin |

Two people editing the same shared item cannot silently overwrite each other. Every save carries the
version it was loaded at. A save made after someone else's is refused, with a message naming who saved
and a prompt to reload.

**Shared environments are readable by everyone signed in, tokens included.** Keep personal tokens in a
private environment, or in one stored in your browser.

The `activity_log` table records:

| `action` | `detail` |
|---|---|
| `register`, `login`, `logout` | |
| `login.failed`, `login.blocked`, `login.disabled` | the client IP |
| `admin.user.update`, `admin.user.reset_link` | who was changed, and how |
| `user.password_reset` | a reset link was used |
| `apiwb.request` | `GET https://api.corp/users -> 200`. The query string is left out because it often carries keys |
| `apiwb.collection.save` / `.delete`, `apiwb.environment.save` / `.delete`, `apiwb.design.save` / `.delete` | which item |

```sql
SELECT created_at, username, action, detail FROM apiworkbench.activity_log ORDER BY id DESC LIMIT 50;
```

## Environments and variables

Write `{{name}}` anywhere in the URL, query params, headers, Auth fields or body. Pick an environment from
the **Environment** picker above the URL bar, and the values are filled in when the request is sent.

- The **Environments** button on the right-hand rail creates and edits environments. Each is stored in this browser, or in the database (private
  or shared).
- Under the URL bar, a preview line shows what the URL resolves to, or which variables have no value.
- A request with an unfilled variable is not sent. The error names the variable.
- Saved requests and history keep the `{{variables}}`, so the same request works against every environment.

## Designs, and checking requests against them

**Where a design lives.** **New API** asks: this browser, the server for you alone, or the server
shared with everyone signed in. A browser design has **Save to server**. Server designs save themselves
a moment after each edit, and the line under the API's details shows *Saving… / Saved*. Two people
editing one shared design cannot overwrite each other: the later save is refused and the page reloads
the current version. Only the owner or an admin can delete a design or change its sharing.

**Which endpoint a request is.** The Tester matches every request to a designed endpoint. This works
whether it came from **Try it**, a pasted curl command, or was typed by hand.

- The method must be the same, and the URL's path must end with the endpoint's path template:
  `GET {{baseUrl}}/users/7` is `GET /users/{id}`.
- A path that is exactly a server base path plus the template ranks first, then the most specific
  template, so `/users/me` beats `/users/{id}`.
- **Try it** also links the request to its endpoint, until the request is edited into something else.
- The matched endpoint shows as a chip next to the request name. Click it to open the endpoint in the
  Designer.

**Request body.** For a matched endpoint with a JSON example:

- **Ctrl+Space** suggests the design's field names.
- Wrong types are underlined red. Fields the design does not have, and design fields that are missing,
  are underlined yellow.
- The line under the body sums it up. `{{variables}}` are allowed.

**Response.** After Send, a pill in the response line says **✓ Matches the design**,
**⚠ N differences from the design** (click to list them, e.g. `user.id: expected integer, got string`),
**Status 500 is not in the design**, or that there was nothing to check against. The design's response
for a status is the exact code, then a range (`4XX`), then `default`.

What "the design" means here: the **example** bodies written in the Designer. Types and field names
come from those examples. A field can be optional in the real API but present in the example, so a
*missing* field is a warning, not an error.

## Code editor (Monaco)

The request body and the response use **Monaco**, the editor from VS Code:

- **Body:** JSON highlighting, a red squiggle on the exact error as you type (`{{variables}}` are
  allowed), bracket matching, folding, multi-cursor, Ctrl+F / Ctrl+H. Typing `{{` suggests the active
  environment's variables. Each `{{variable}}` shows green when it has a value and red when it does not,
  and hovering shows the value. Drag the bottom edge to resize.
- **Response:** read-only, with folding, Ctrl+F search, copying any selection, and handling of large
  bodies. JSON and XML/HTML are highlighted. A− / A+ resize its text.

It is served from `vendor/monaco/` (no CDN, so it works on a server without internet). It is loaded after
the page draws, so the page is just as fast. On touch devices, or if it fails to load, the plain text box
and response view are used instead. The copy is trimmed to what the app uses (core editor, JSON
language and worker, XML highlighting), about 4.5 MB of the 14 MB package. See
`vendor/monaco/VERSION.txt`.

## curl in, code out

- **Import curl**, or paste a curl command straight into the URL box. It understands browser
  "Copy as cURL" output (bash and Windows cmd), `-X -H -d --data-raw --data-urlencode --json -u -G -I -A
  -b -e`, and line continuations. Anything it cannot carry over (file uploads, `-F` forms, client
  certificates) is reported rather than silently dropped. A `Bearer` header moves into the Auth tab.
- **Code** shows the current request as **curl**, **PowerShell** (`Invoke-RestMethod`, works on Windows
  PowerShell 5.1) or **Python** (`requests`), with environment values filled in.

## How it works

```
Browser                                            PHP
  login.php ── POST auth.php ──────────────────▶  auth.php     sign in / create account / sign out
  index.html + js/
    Tester ── POST proxy.php {method,url,...} ──▶  proxy.php   session + CSRF check
                                                    ProxyRequest  validate input
                                                    HostPolicy    check host against settings, resolve DNS once
                                                    Forwarder     send with cURL pinned to that IP
                                                    activity_log  who sent what
           ◀── {status, headers, body, timeMs} ──
    Saved / environments ── api.php ─────────────▶  api.php     Auth + ItemStore (items table)
    Designer ── runs entirely in the browser (js/openapi.js converts to/from OpenAPI 3)
```

- The browser cannot call most APIs directly because of CORS. That's why requests go through `proxy.php`.
- Redirects are **shown, not followed**, so every hop gets checked by the host policy. Copy the `Location`
  header into the URL bar to follow one.
- Both JSON endpoints only accept JSON POSTs from their own page (Origin check). If you put them behind a
  reverse proxy that rewrites `Host`, make sure the original `Host` header is passed through.
- The session is opened only long enough to read who is signed in, then released, so a slow proxied call
  never blocks the user's other requests.

## Troubleshooting

**Start with the health check.** It reports the PHP version, the extensions, the settings, whether every
PHP file parses on this PHP, and (unless `APIWB_AUTH=none`) `config.php`, the connection, the tables and
how many accounts exist. Run it as the user the web server runs as:

```sh
sudo -u apache php check.php     # Linux server
php check.php                    # local
```

`check.php` only runs from the command line. Over HTTP it answers 404, and `.htaccess` denies it.

**What the error in the Tester means:**

| Shown | Meaning | Look at |
|---|---|---|
| `SERVER_ERROR` / `Fatal: ...` | PHP reached the endpoint and crashed. The message names the file and line | `php check.php` |
| `CONFIG_ERROR` | PHP too old, curl missing, a setting invalid, or `config.php` missing or unreadable | `php check.php` |
| `NOT_SIGNED_IN` | the session ended | sign in again |
| `ACCOUNT_DISABLED` | an admin disabled this account | ask an admin |
| `FORBIDDEN` | not allowed: not an admin, or a guard rail (e.g. demoting the last admin) | the message says which |
| `CSRF` | the page's session token is stale | reload the page |
| `CONFLICT` | someone saved the same shared collection or environment after you loaded it | reload, then redo your change |
| `MISSING_VARIABLES` | a `{{variable}}` has no value in the chosen environment | the Environment picker, or the **Environments** button on the right rail |
| `URL_NOT_ALLOWED` | hosted mode refused the host | `APIWB_ALLOWED_HOSTS` |
| `CONNECTION_FAILED` / `TIMEOUT` / `TLS_ERROR` | the proxy ran, the target API did not answer | the target, from the server: `curl -v <url>` |
| `NETWORK_ERROR` ... *without JSON* | the request never reached the PHP code. The web server refused it, or PHP is not wired up | the web server error log (`/var/log/httpd/error_log`, or the `php -S` terminal) |

`proxy.php` and `api.php` answer in JSON even when they crash, so a response *without* JSON almost always
comes from Apache, not the app. Common causes:

- PHP is not handling `.php` files for this directory.
- `AllowOverride` forbids a directive in `.htaccess`. The whole folder then answers 500, so check whether
  `index.html` loads at all.
- The page was opened from disk (`file://`) instead of through the web server.

**Sign-in page shows "Cannot read the database config".** `config.php` is missing or the web server user
cannot read it. Create it from `config.example.php` (step 4 above).

## Project layout

```
index.html            the app (redirects to login.php when signed out)
login.php             sign-in and create-account page
auth.php              handles sign-in, account creation and sign-out
reset.php             sets a new password from an admin-issued one-time link
proxy.php             sends requests
api.php               who is signed in; saved collections and environments
bootstrap.php         shared start of the JSON endpoints: error nets, PHP version check (not served)
settings.php          every setting, with APIWB_* environment overrides (not served)
config.example.php    template for config.php (database details), which stays in the app folder, gitignored
schema.sql            creates the apiworkbench database and its tables (not served)
check.php             command-line health check (not served)
src/                  server classes: Session, Auth, Admin, ItemStore, proxy classes (not web-accessible)
js/admin.js           Admin tab: users, reset links, activity log
css/app.css           styles
js/app.js             entry point: sign-in state, tab switching
js/tester.js          Tester tab
js/collections.js     saved-request collections (browser + database)
js/environments.js    environments, the picker, the editor
js/variables.js       {{variable}} substitution
js/curl.js            curl command -> request
js/codegen.js         request -> curl / PowerShell / Python
js/session.js         sign-in state and api.php calls
js/designer.js        Designer tab, browser and server designs
js/contract.js        which designed endpoint a request is; comparing bodies with the design
js/openapi.js         designer model <-> OpenAPI 3, validation, "Try it"
js/kvtable.js         editable name/value table
js/dom.js, storage.js helpers (DOM, modal, toast, localStorage)
js/editor.js          Monaco loading, the body editor and the response viewer
vendor/js-yaml.min.js YAML support (MIT)
vendor/monaco/        Monaco editor 0.52.2, trimmed (MIT)
```

## Limits of this version

- No email: password reset links are handed over by an admin. People cannot change their own password
  while signed in.
- No multipart file uploads, cookie jar, or WebSockets.
- Only one browser-only collection ("This browser"). Create more as database collections.
- Design checks compare against example bodies, not hand-written schemas: no `required`, `enum`,
  `format` or `oneOf` rules yet.
- The Designer describes bodies by example (the schema is inferred). Importing an OpenAPI file keeps paths,
  operations, parameters and examples. Shared `components` are inlined, and security schemes are not imported.
