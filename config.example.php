<?php
// Copy this file to config.php and adjust it. config.php is gitignored;
// when it is missing, these defaults are used.

return [
    // 'local'  - runs on a developer's machine; may call localhost and private networks.
    // 'hosted' - shared internal server; loopback, private, link-local and reserved
    //            addresses are blocked unless the host is listed in allowed_hosts.
    'mode' => 'local',

    // Hosts that may be called even when they resolve to private addresses (hosted mode).
    // Exact names ("api.dev.internal") or wildcard suffixes ("*.dev.internal").
    'allowed_hosts' => [],

    // When true, ONLY hosts in allowed_hosts may be called, in any mode.
    'restrict_to_allowed_hosts' => false,

    // Hosts that are never called, in any mode. Same syntax as allowed_hosts.
    'blocked_hosts' => [],

    'timeout_seconds' => 30,
    'max_request_bytes' => 10 * 1024 * 1024,
    'max_response_bytes' => 5 * 1024 * 1024,

    // Set to false only if your internal APIs use self-signed certificates.
    'verify_tls' => true,

    // Who may use this install.
    //   'none'   - anyone who can open the page; everything is saved in the browser only.
    //   'devhub' - only people signed in to devhub on this same server. Enables shared
    //              collections and environments (stored in devhub's database) and writes
    //              every proxied request to devhub's activity log. Run schema.sql first.
    'auth' => 'none',

    // devhub's database config (the file defining connect(): PDO). Used when auth = 'devhub'.
    'devhub_config' => '/var/www/html/private/config.php',

    // Where people are sent to sign in, as a URL or path on this server.
    'devhub_url' => '/devhub/',

    // Largest single collection or environment that can be saved.
    'max_item_bytes' => 2 * 1024 * 1024,
];
