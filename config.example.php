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
];
