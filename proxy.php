<?php
declare(strict_types=1);

// The endpoint that sends requests. The browser POSTs {method, url, headers, body} as
// JSON; the request is checked against config, sent with cURL, and the response
// returned as JSON. GET returns the public parts of the config.
//
// With auth = 'devhub', only people signed in to devhub may use it, every call must
// carry the session's CSRF token, and every call is written to devhub's activity log
// (method and URL without the query string, which often carries keys).

require __DIR__ . '/bootstrap.php';
require __DIR__ . '/src/ProxyRequest.php';
require __DIR__ . '/src/HostPolicy.php';
require __DIR__ . '/src/Forwarder.php';

try {
    $config = Config::load(__DIR__);
    $auth = new Auth($config);

    if (!extension_loaded('curl')) {
        throw new ProxyException('CONFIG_ERROR', 'The PHP curl extension is not enabled on this server.', 500);
    }

    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'GET') {
        respond(200, [
            'ok' => true,
            'mode' => $config['mode'],
            'auth' => $config['auth'],
            'timeoutSeconds' => $config['timeout_seconds'],
            'maxResponseBytes' => $config['max_response_bytes'],
            'restrictToAllowedHosts' => (bool) $config['restrict_to_allowed_hosts'],
        ]);
    }

    if ($method !== 'POST') {
        throw new ProxyException('METHOD_NOT_ALLOWED', 'Use POST.', 405);
    }

    // Only this app's own page may use the proxy. Requiring a JSON content type (in
    // read_json_body) also forces browsers to send a CORS preflight for cross-site
    // calls, which this endpoint never approves.
    require_same_origin();
    $auth->requireUser();
    $auth->requireCsrf();
    $data = read_json_body($config['max_request_bytes']);

    $request = ProxyRequest::fromArray($data);
    $logged = $request->method . ' ' . strtok($request->url, '?#');
    try {
        $pinnedIp = (new HostPolicy($config))->resolveAllowed($request->host);
        $result = (new Forwarder($config))->send($request, $pinnedIp);
    } catch (ProxyException $e) {
        $auth->log('apiwb.request', "$logged -> {$e->errorCode}");
        throw $e;
    }
    $auth->log('apiwb.request', "$logged -> {$result['status']}");

    respond(200, ['ok' => true] + $result);
} catch (ProxyException $e) {
    fail($e->errorCode, $e->getMessage(), $e->httpStatus);
} catch (Throwable $e) {
    // An internal tool: the real message is worth more to whoever is debugging than hiding it.
    error_log('API Workbench proxy: ' . $e->getMessage());
    fail('SERVER_ERROR', sprintf('Server error: %s (%s line %d)', $e->getMessage(), basename($e->getFile()), $e->getLine()), 500);
}
