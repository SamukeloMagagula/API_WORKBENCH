<?php
declare(strict_types=1);

// The only server endpoint. The browser POSTs {method, url, headers, body} as JSON;
// the request is checked against config, sent with cURL, and the response returned as JSON.
// GET returns the public parts of the config so the UI can show which mode it runs in.
//
// This file deliberately sticks to syntax old PHP can still parse, and installs its
// error nets before requiring anything: an unsupported PHP version or a broken
// include then reports itself as JSON in the UI, instead of a bare HTML 500.

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

function respond(int $status, array $payload): void
{
    if (!headers_sent()) http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function fail(string $code, string $message, int $status): void
{
    respond($status, ['ok' => false, 'error' => ['code' => $code, 'message' => $message]]);
}

set_exception_handler(function (Throwable $e): void {
    fail('SERVER_ERROR', 'Server error: ' . $e->getMessage(), 500);
});
register_shutdown_function(function (): void {
    $error = error_get_last();
    if ($error && ($error['type'] & (E_ERROR | E_PARSE | E_CORE_ERROR | E_COMPILE_ERROR))) {
        if (!headers_sent()) http_response_code(500);
        echo json_encode(['ok' => false, 'error' => ['code' => 'SERVER_ERROR', 'message' => sprintf(
            'Fatal: %s (%s line %d)', $error['message'], basename($error['file']), $error['line']
        )]]);
    }
});

if (PHP_VERSION_ID < 80000) {
    fail('CONFIG_ERROR', 'API Workbench needs PHP 8.0 or newer; this server runs PHP ' . PHP_VERSION . '.', 500);
}

require __DIR__ . '/src/ProxyException.php';
require __DIR__ . '/src/Config.php';
require __DIR__ . '/src/ProxyRequest.php';
require __DIR__ . '/src/HostPolicy.php';
require __DIR__ . '/src/Forwarder.php';

try {
    $config = Config::load(__DIR__);

    if (!extension_loaded('curl')) {
        throw new ProxyException('CONFIG_ERROR', 'The PHP curl extension is not enabled on this server.', 500);
    }

    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'GET') {
        respond(200, [
            'ok' => true,
            'mode' => $config['mode'],
            'timeoutSeconds' => $config['timeout_seconds'],
            'maxResponseBytes' => $config['max_response_bytes'],
            'restrictToAllowedHosts' => (bool) $config['restrict_to_allowed_hosts'],
        ]);
    }

    if ($method !== 'POST') {
        throw new ProxyException('METHOD_NOT_ALLOWED', 'Use POST.', 405);
    }

    // Only this app's own page may use the proxy. Requiring a JSON content type also forces
    // browsers to send a CORS preflight for cross-site calls, which this endpoint never approves.
    $contentType = strtolower($_SERVER['CONTENT_TYPE'] ?? '');
    if (!str_starts_with($contentType, 'application/json')) {
        throw new ProxyException('INVALID_REQUEST', 'Content-Type must be application/json.', 415);
    }
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '' && parse_url($origin, PHP_URL_HOST) . (($p = parse_url($origin, PHP_URL_PORT)) ? ":$p" : '')
        !== ($_SERVER['HTTP_HOST'] ?? '')) {
        throw new ProxyException('FORBIDDEN', 'Cross-origin requests are not allowed.', 403);
    }

    $raw = file_get_contents('php://input', false, null, 0, $config['max_request_bytes'] + 1);
    if ($raw === false || strlen($raw) > $config['max_request_bytes']) {
        throw new ProxyException('REQUEST_TOO_LARGE', 'The request is larger than this server allows.', 413);
    }

    try {
        $data = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
    } catch (JsonException $e) {
        throw new ProxyException('INVALID_REQUEST', 'Request payload is not valid JSON.');
    }

    $request = ProxyRequest::fromArray($data);
    $pinnedIp = (new HostPolicy($config))->resolveAllowed($request->host);
    $result = (new Forwarder($config))->send($request, $pinnedIp);

    respond(200, ['ok' => true] + $result);
} catch (ProxyException $e) {
    fail($e->errorCode, $e->getMessage(), $e->httpStatus);
} catch (Throwable $e) {
    // An internal tool: the real message is worth more to whoever is debugging than hiding it.
    error_log('API Workbench proxy: ' . $e->getMessage());
    fail('SERVER_ERROR', sprintf('Server error: %s (%s line %d)', $e->getMessage(), basename($e->getFile()), $e->getLine()), 500);
}
