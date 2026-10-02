<?php
declare(strict_types=1);

/** Sends a ProxyRequest with cURL and returns the response as plain data for JSON. */
final class Forwarder
{
    public function __construct(private array $config)
    {
    }

    public function send(ProxyRequest $request, string $pinnedIp): array
    {
        $maxBytes = $this->config['max_response_bytes'];
        $body = '';
        $truncated = false;
        $headers = [];
        $statusText = '';

        $ch = curl_init();
        $headerLines = array_map(fn ($h) => $h['name'] . ': ' . $h['value'], $request->headers);
        $headerLines[] = 'Expect:'; // stop cURL sending "Expect: 100-continue" for large bodies

        $resolveIp = str_contains($pinnedIp, ':') ? "[$pinnedIp]" : $pinnedIp;

        curl_setopt_array($ch, [
            CURLOPT_URL => $request->url,
            CURLOPT_CUSTOMREQUEST => $request->method,
            CURLOPT_NOBODY => $request->method === 'HEAD',
            CURLOPT_HTTPHEADER => $headerLines,
            CURLOPT_RESOLVE => ["{$request->host}:{$request->port}:$resolveIp"],
            CURLOPT_FOLLOWLOCATION => false, // redirects are shown, not followed: each hop would need re-checking
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_CONNECTTIMEOUT => min(10, $this->config['timeout_seconds']),
            CURLOPT_TIMEOUT => $this->config['timeout_seconds'],
            CURLOPT_SSL_VERIFYPEER => (bool) $this->config['verify_tls'],
            CURLOPT_SSL_VERIFYHOST => $this->config['verify_tls'] ? 2 : 0,
            CURLOPT_ENCODING => '', // accept and transparently decode gzip/deflate/br
            CURLOPT_HEADERFUNCTION => function ($ch, string $line) use (&$headers, &$statusText): int {
                $trimmed = rtrim($line, "\r\n");
                if (preg_match('#^HTTP/\S+\s+\d{3}\s*(.*)$#', $trimmed, $m)) {
                    // A new status line (e.g. after "100 Continue") starts a fresh header set.
                    $headers = [];
                    $statusText = $m[1];
                } elseif (str_contains($trimmed, ':')) {
                    [$name, $value] = explode(':', $trimmed, 2);
                    $headers[] = [trim($name), trim($value)];
                }
                return strlen($line);
            },
            CURLOPT_WRITEFUNCTION => function ($ch, string $chunk) use (&$body, &$truncated, $maxBytes): int {
                $room = $maxBytes - strlen($body);
                if (strlen($chunk) > $room) {
                    $body .= substr($chunk, 0, max(0, $room));
                    $truncated = true;
                    return 0; // abort the transfer; we have all we will show
                }
                $body .= $chunk;
                return strlen($chunk);
            },
        ]);

        if ($request->body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $request->body);
        }

        curl_exec($ch);
        $errno = curl_errno($ch);
        $error = curl_error($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $timeMs = (int) round(curl_getinfo($ch, CURLINFO_TOTAL_TIME) * 1000);
        curl_close($ch);

        if ($errno !== 0 && !($truncated && $errno === CURLE_WRITE_ERROR)) {
            throw self::mapError($errno, $error);
        }

        $isText = $body === '' || preg_match('//u', $body) === 1;

        return [
            'status' => $status,
            'statusText' => $statusText,
            'headers' => $headers,
            'body' => $isText ? $body : base64_encode($body),
            'bodyEncoding' => $isText ? 'text' : 'base64',
            'sizeBytes' => strlen($body),
            'truncated' => $truncated,
            'timeMs' => $timeMs,
        ];
    }

    private static function mapError(int $errno, string $error): ProxyException
    {
        return match ($errno) {
            CURLE_OPERATION_TIMEDOUT => new ProxyException('TIMEOUT', 'The request timed out.', 504),
            CURLE_COULDNT_RESOLVE_HOST => new ProxyException('CONNECTION_FAILED', 'Could not resolve host.', 502),
            CURLE_COULDNT_CONNECT => new ProxyException('CONNECTION_FAILED', "Could not connect: $error", 502),
            // 35 SSL connect error, 51 peer certificate, 58 client cert, 60 CA cert / peer verification
            35, 51, 58, 60 => new ProxyException('TLS_ERROR', "TLS/SSL error: $error", 502),
            default => new ProxyException('UPSTREAM_ERROR', "Request failed: $error", 502),
        };
    }
}
