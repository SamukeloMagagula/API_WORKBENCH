<?php

declare(strict_types=1);

/**
 * Every setting the app depends on, in one place.
 *
 * Each can be overridden by an environment variable, which is what makes a local
 * checkout runnable: set APIWB_MODE=local and APIWB_AUTH=none and the same code works
 * on a laptop with no database. The defaults are the production layout, so a deployed
 * install needs no environment at all. On Apache, set overrides with SetEnv (see README).
 *
 * Database credentials are not here. They live in CONFIG_PATH: DB_* constants and
 * connect(): PDO (see config.example.php). By default that is config.php in this
 * folder, which is gitignored and denied to browsers by .htaccess.
 */

/** Comma-separated environment variable as a list; empty entries dropped. */
function apiwb_list_setting(string $name): array
{
    $raw = getenv($name);
    return $raw === false ? [] : array_values(array_filter(array_map('trim', explode(',', $raw)), 'strlen'));
}

/**
 * Absolute path to the config.php defining connect(): PDO.
 *
 * Next to this file by default (/var/www/html/API_WORKBENCH/config.php on the server).
 * Being inside the served folder is safe only because .htaccess denies it and PHP
 * would execute it rather than show it; keep both true.
 */
define('CONFIG_PATH', getenv('APIWB_CONFIG') ?: __DIR__ . '/config.php');

/**
 * Where the proxy may send requests.
 *
 *   hosted  shared server: loopback, private, link-local and reserved addresses are
 *           refused unless the host is in ALLOWED_HOSTS
 *   local   a developer's own machine: anything goes, localhost included
 */
define('APP_MODE', getenv('APIWB_MODE') === 'local' ? 'local' : 'hosted');

/**
 * Who may use the app.
 *
 *   login  people with an account here. Collections and environments can be saved to
 *          the database, and every proxied call is written to activity_log
 *   none   anyone who can open the page; everything stays in the browser, no database
 */
define('AUTH_MODE', getenv('APIWB_AUTH') === 'none' ? 'none' : 'login');

/**
 * The permanent admin, by username (email). Empty by default: the first account
 * created becomes an admin instead, so a fresh install always has one.
 */
define('OWNER_USER', strtolower(trim((string) getenv('APIWB_OWNER'))));

/**
 * Optional shared secret required to create an account.
 *
 * Empty (the default) lets anyone who can reach the page register, which is only an
 * access control if the server is unreachable from outside. Set it and reaching the
 * form is no longer enough.
 */
define('REGISTRATION_KEY', getenv('APIWB_REGISTRATION_KEY') ?: '');

/** When set, e.g. "@za.logicalis.com", accounts must use an email address ending in it. */
define('EMAIL_DOMAIN', strtolower(trim((string) getenv('APIWB_EMAIL_DOMAIN'))));

/** Failed sign-ins allowed per username and per IP within LOGIN_WINDOW_SECONDS. */
define('LOGIN_MAX_ATTEMPTS', (int) (getenv('APIWB_LOGIN_MAX_ATTEMPTS') ?: 10));
define('LOGIN_WINDOW_SECONDS', (int) (getenv('APIWB_LOGIN_WINDOW') ?: 900));

/**
 * Hosts the proxy may call even when they resolve to private addresses, in hosted mode.
 * Exact names or "*.suffix" wildcards, comma-separated: "api.corp.local,*.dev.corp.local"
 */
define('ALLOWED_HOSTS', apiwb_list_setting('APIWB_ALLOWED_HOSTS'));

/** When "1", ONLY ALLOWED_HOSTS may be called, in any mode. */
define('RESTRICT_TO_ALLOWED_HOSTS', getenv('APIWB_RESTRICT_HOSTS') === '1');

/** Hosts never called, in any mode. Same syntax as ALLOWED_HOSTS. */
define('BLOCKED_HOSTS', apiwb_list_setting('APIWB_BLOCKED_HOSTS'));

/** Per-request timeout, in seconds. */
define('TIMEOUT_SECONDS', (int) (getenv('APIWB_TIMEOUT') ?: 30));

/** Largest request the proxy accepts, largest response it returns (cut off and flagged beyond). */
define('MAX_REQUEST_BYTES', (int) (getenv('APIWB_MAX_REQUEST_MB') ?: 10) * 1048576);
define('MAX_RESPONSE_BYTES', (int) (getenv('APIWB_MAX_RESPONSE_MB') ?: 5) * 1048576);

/** Largest single collection or environment saved to the database. */
define('MAX_ITEM_BYTES', (int) (getenv('APIWB_MAX_ITEM_MB') ?: 2) * 1048576);

/** "0" turns off TLS certificate checks, for internal APIs with self-signed certificates only. */
define('VERIFY_TLS', getenv('APIWB_VERIFY_TLS') !== '0');
