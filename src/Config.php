<?php
declare(strict_types=1);

final class Config
{
    private const DEFAULTS = [
        'mode' => 'local',
        'allowed_hosts' => [],
        'restrict_to_allowed_hosts' => false,
        'blocked_hosts' => [],
        'timeout_seconds' => 30,
        'max_request_bytes' => 10 * 1024 * 1024,
        'max_response_bytes' => 5 * 1024 * 1024,
        'verify_tls' => true,
        'auth' => 'none',
        'devhub_config' => '/var/www/html/private/config.php',
        'devhub_url' => '/devhub/',
        'max_item_bytes' => 2 * 1024 * 1024,
    ];

    /** Loads config.php from $dir, falling back to config.example.php, then to defaults. */
    public static function load(string $dir): array
    {
        $file = is_file($dir . '/config.php') ? $dir . '/config.php' : $dir . '/config.example.php';
        $loaded = is_file($file) ? require $file : [];
        $config = array_merge(self::DEFAULTS, is_array($loaded) ? $loaded : []);

        if (!in_array($config['mode'], ['local', 'hosted'], true)) {
            throw new ProxyException('CONFIG_ERROR', "Config 'mode' must be 'local' or 'hosted'.", 500);
        }
        if (!in_array($config['auth'], ['none', 'devhub'], true)) {
            throw new ProxyException('CONFIG_ERROR', "Config 'auth' must be 'none' or 'devhub'.", 500);
        }
        $config['max_item_bytes'] = max(1024, (int) $config['max_item_bytes']);
        $config['timeout_seconds'] = max(1, (int) $config['timeout_seconds']);
        $config['max_request_bytes'] = max(1024, (int) $config['max_request_bytes']);
        $config['max_response_bytes'] = max(1024, (int) $config['max_response_bytes']);

        return $config;
    }
}
