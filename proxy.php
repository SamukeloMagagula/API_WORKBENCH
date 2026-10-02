<?php
declare(strict_types=1);

// The only server endpoint. The browser POSTs {method, url, headers, body} as JSON;
// the request is checked against config, sent with cURL, and the response returned as JSON.
// GET returns the public parts of the config so the UI can show which mode it runs in.

require __DIR__ . '/src/ProxyException.php';
require __DIR__ . '/src/Config.php';
require __DIR__ . '/src/ProxyRequest.php';
require __DIR__ . '/src/HostPolicy.php';
require __DIR__ . '/src/Forwarder.php';

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

function respond(int $status, array $payload): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function fail(ProxyException $e): never
{
    respond($e->httpStatus, ['ok' => false, 'error' => ['code' => $e->errorCode, 'message' => $e->getMessage()]]);
}

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
    } catch (JsonException) {
        throw new ProxyException('INVALID_REQUEST', 'Request payload is not valid JSON.');
    }

    $request = ProxyRequest::fromArray($data);
    $pinnedIp = (new HostPolicy($config))->resolveAllowed($request->host);
    $result = (new Forwarder($config))->send($request, $pinnedIp);

    respond(200, ['ok' => true] + $result);
} catch (ProxyException $e) {
    fail($e);
} catch (Throwable $e) {
    error_log('API Workbench proxy: ' . $e->getMessage());
    fail(new ProxyException('SERVER_ERROR', 'Unexpected server error.', 500));
}
