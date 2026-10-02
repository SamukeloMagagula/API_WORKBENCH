<?php
declare(strict_types=1);

/**
 * The settings from settings.php, as the array the rest of the server code reads.
 *
 * settings.php is the single source of truth (constants with environment overrides);
 * this only gathers them and checks they make sense.
 */
final class Config
{
    public static function load(string $dir): array
    {
        require_once $dir . '/settings.php';

        $config = [
            'mode' => APP_MODE,
            'auth' => AUTH_MODE,
            'config_path' => CONFIG_PATH,
            'owner' => OWNER_USER,
            'allowed_hosts' => ALLOWED_HOSTS,
            'restrict_to_allowed_hosts' => RESTRICT_TO_ALLOWED_HOSTS,
            'blocked_hosts' => BLOCKED_HOSTS,
            'timeout_seconds' => TIMEOUT_SECONDS,
            'max_request_bytes' => MAX_REQUEST_BYTES,
            'max_response_bytes' => MAX_RESPONSE_BYTES,
            'max_item_bytes' => MAX_ITEM_BYTES,
            'verify_tls' => VERIFY_TLS,
        ];

        if ($config['timeout_seconds'] < 1 || $config['max_request_bytes'] < 1 || $config['max_response_bytes'] < 1 || $config['max_item_bytes'] < 1) {
            throw new ProxyException('CONFIG_ERROR', 'APIWB_TIMEOUT and the APIWB_MAX_*_MB settings must be positive numbers.', 500);
        }
        return $config;
    }
}
