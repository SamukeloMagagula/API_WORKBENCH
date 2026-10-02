<?php
declare(strict_types=1);

/**
 * Decides whether a host may be called, and returns the IP address the request
 * must be pinned to (so DNS cannot change between this check and the request).
 */
final class HostPolicy
{
    public function __construct(private readonly array $config)
    {
    }

    /** @return string the resolved IP address to connect to */
    public function resolveAllowed(string $host): string
    {
        $host = strtolower(rtrim($host, '.'));

        if (self::matchesAny($host, $this->config['blocked_hosts'])) {
            throw new ProxyException('URL_NOT_ALLOWED', "Calls to $host are blocked by this server's configuration.", 403);
        }

        $allowlisted = self::matchesAny($host, $this->config['allowed_hosts']);
        if ($this->config['restrict_to_allowed_hosts'] && !$allowlisted) {
            throw new ProxyException('URL_NOT_ALLOWED', "$host is not in this server's list of allowed hosts.", 403);
        }

        $ips = self::resolve($host);
        if ($ips === []) {
            throw new ProxyException('CONNECTION_FAILED', "Could not resolve host $host.", 502);
        }

        if ($this->config['mode'] === 'hosted' && !$allowlisted) {
            foreach ($ips as $ip) {
                if (!self::isPublic($ip)) {
                    throw new ProxyException(
                        'URL_NOT_ALLOWED',
                        "$host resolves to a private or reserved address ($ip). Ask the administrator to add it to allowed_hosts.",
                        403,
                    );
                }
            }
        }

        return $ips[0];
    }

    /** @param list<string> $patterns exact hosts or "*.suffix" wildcards */
    public static function matchesAny(string $host, array $patterns): bool
    {
        foreach ($patterns as $pattern) {
            $pattern = strtolower(trim((string) $pattern));
            if ($pattern === '') {
                continue;
            }
            if (str_starts_with($pattern, '*.')) {
                $suffix = substr($pattern, 1); // ".example.com"
                if (str_ends_with($host, $suffix) || $host === substr($suffix, 1)) {
                    return true;
                }
            } elseif ($host === $pattern) {
                return true;
            }
        }
        return false;
    }

    /** @return list<string> */
    private static function resolve(string $host): array
    {
        if (filter_var($host, FILTER_VALIDATE_IP)) {
            return [$host];
        }
        $ips = @gethostbynamel($host) ?: [];
        $records = @dns_get_record($host, DNS_AAAA) ?: [];
        foreach ($records as $record) {
            if (isset($record['ipv6'])) {
                $ips[] = $record['ipv6'];
            }
        }
        return array_values(array_unique($ips));
    }

    public static function isPublic(string $ip): bool
    {
        // IPv4-mapped IPv6 (::ffff:127.0.0.1) must be judged as the IPv4 address it wraps.
        if (preg_match('/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i', $ip, $m)) {
            $ip = $m[1];
        }

        if (defined('FILTER_FLAG_GLOBAL_RANGE')) { // PHP 8.2+
            return filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_GLOBAL_RANGE) !== false;
        }

        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) {
            return false;
        }
        // Carrier-grade NAT (100.64.0.0/10) is not covered by the flags above.
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
            $long = ip2long($ip);
            if (($long & 0xFFC00000) === (ip2long('100.64.0.0') & 0xFFC00000)) {
                return false;
            }
        }
        return true;
    }
}
