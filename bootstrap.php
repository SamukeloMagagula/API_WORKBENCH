<?php
declare(strict_types=1);

// Shared start of every JSON endpoint (proxy.php, api.php).
//
// Kept to syntax old PHP can still parse, and run before anything else is required:
// an unsupported PHP version or a broken include then reports itself as JSON in the
// UI, instead of a bare HTML 500 nobody can read.

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

function respond(int $status, array $payload): void
{
    if (!headers_sent()) http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function fail(string $code, string $message, int $status, array $extra = []): void
{
    respond($status, ['ok' => false, 'error' => ['code' => $code, 'message' => $message] + $extra]);
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
require __DIR__ . '/src/Auth.php';

/** Reads the JSON body of a POST, capped at $maxBytes. */
function read_json_body(int $maxBytes): array
{
    $contentType = strtolower($_SERVER['CONTENT_TYPE'] ?? '');
    if (!str_starts_with($contentType, 'application/json')) {
        throw new ProxyException('INVALID_REQUEST', 'Content-Type must be application/json.', 415);
    }
    $raw = file_get_contents('php://input', false, null, 0, $maxBytes + 1);
    if ($raw === false || strlen($raw) > $maxBytes) {
        throw new ProxyException('REQUEST_TOO_LARGE', 'The request is larger than this server allows.', 413);
    }
    try {
        $data = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
    } catch (JsonException $e) {
        throw new ProxyException('INVALID_REQUEST', 'Request payload is not valid JSON.');
    }
    if (!is_array($data)) {
        throw new ProxyException('INVALID_REQUEST', 'Request payload must be a JSON object.');
    }
    return $data;
}

/**
 * Refuses requests whose Origin is another site. Browsers send Origin on every
 * cross-site POST, so this stops other pages driving the endpoint with a user's cookie.
 */
function require_same_origin(): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin === '') return;
    $port = parse_url($origin, PHP_URL_PORT);
    $originHost = parse_url($origin, PHP_URL_HOST) . ($port ? ":$port" : '');
    if ($originHost !== ($_SERVER['HTTP_HOST'] ?? '')) {
        throw new ProxyException('FORBIDDEN', 'Cross-origin requests are not allowed.', 403);
    }
}
