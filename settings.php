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
 * Database credentials are not here. They live in CONFIG_PATH, outside the served
 * tree, in the same shape as devhub's config.php: DB_* constants and connect(): PDO.
 */

/** Comma-separated environment variable as a list; empty entries dropped. */
function apiwb_list_setting(string $name): array
{
    $raw = getenv($name);
    return $raw === false ? [] : array_values(array_filter(array_map('trim', explode(',', $raw)), 'strlen'));
}

/** Absolute path to the config.php defining connect(): PDO. The same file devhub uses. */
define('CONFIG_PATH', getenv('APIWB_CONFIG') ?: '/var/www/html/private/config.php');

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
 *   devhub  only people signed in to devhub on this server. Saves collections and
 *           environments to the database and logs every proxied call to activity_log
 *   none    anyone who can open the page; everything stays in the browser, no database
 */
define('AUTH_MODE', getenv('APIWB_AUTH') === 'none' ? 'none' : 'devhub');

/** Where the "Sign in via devhub" link points. */
define('DEVHUB_URL', getenv('APIWB_DEVHUB_URL') ?: '/devhub/');

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
