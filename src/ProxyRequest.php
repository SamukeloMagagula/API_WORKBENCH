<?php
declare(strict_types=1);

/** A validated outbound request built from the browser's JSON payload. */
final class ProxyRequest
{
    public const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

    // Headers cURL manages itself, or that only make sense hop-by-hop.
    private const DROPPED_HEADERS = [
        'host', 'content-length', 'connection', 'keep-alive', 'transfer-encoding',
        'te', 'trailer', 'upgrade', 'proxy-authorization', 'proxy-connection', 'expect',
    ];

    /**
     * @param list<array{name:string,value:string}> $headers
     */
    private function __construct(
        public string $method,
        public string $url,
        public string $scheme,
        public string $host,
        public int $port,
        public array $headers,
        public ?string $body,
    ) {
    }

    public static function fromArray(mixed $data): self
    {
        if (!is_array($data)) {
            throw new ProxyException('INVALID_REQUEST', 'Request payload must be a JSON object.');
        }

        $method = strtoupper(trim((string) ($data['method'] ?? '')));
        if (!in_array($method, self::METHODS, true)) {
            throw new ProxyException('INVALID_REQUEST', 'Unsupported method: ' . ($method === '' ? '(empty)' : $method));
        }

        $url = trim((string) ($data['url'] ?? ''));
        if ($url === '') {
            throw new ProxyException('INVALID_REQUEST', 'Enter a URL.');
        }
        if (preg_match('/[\x00-\x20\x7f]/', $url)) {
            throw new ProxyException('INVALID_REQUEST', 'The URL contains spaces or control characters. Encode them first.');
        }
        $parts = parse_url($url);
        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        if ($parts === false || !in_array($scheme, ['http', 'https'], true) || empty($parts['host'])) {
            throw new ProxyException('INVALID_REQUEST', 'The URL must start with http:// or https:// and include a host.');
        }
        if (isset($parts['user']) || isset($parts['pass'])) {
            throw new ProxyException('INVALID_REQUEST', 'Credentials in the URL are not supported. Use the Auth tab instead.');
        }
        $host = strtolower(trim($parts['host'], '[]'));
        $port = (int) ($parts['port'] ?? ($scheme === 'https' ? 443 : 80));

        $headers = [];
        foreach ((array) ($data['headers'] ?? []) as $header) {
            $name = trim((string) ($header['name'] ?? ''));
            $value = (string) ($header['value'] ?? '');
            if ($name === '') {
                continue;
            }
            if (!preg_match('/^[!#$%&\'*+.^_`|~0-9A-Za-z-]+$/', $name)) {
                throw new ProxyException('INVALID_REQUEST', "Invalid header name: $name");
            }
            if (preg_match('/[\r\n\x00]/', $value)) {
                throw new ProxyException('INVALID_REQUEST', "Header '$name' contains a line break.");
            }
            if (in_array(strtolower($name), self::DROPPED_HEADERS, true)) {
                continue;
            }
            $headers[] = ['name' => $name, 'value' => $value];
        }

        $body = $data['body'] ?? null;
        if ($body !== null && !is_string($body)) {
            throw new ProxyException('INVALID_REQUEST', 'Body must be a string.');
        }

        return new self($method, $url, $scheme, $host, $port, $headers, $body === '' ? null : $body);
    }
}
