<?php
// Health check for the server side. Run it as the web server user, from the app folder:
//
//   sudo -u apache php check.php      (Linux)
//   php check.php                     (local)
//
// It answers the questions behind "the Tester says the proxy failed": which PHP
// this is, whether curl is loaded, whether the config is valid, and whether every
// PHP file parses on this PHP. Exits non-zero on any failure.
//
// Kept to syntax old PHP can parse, so it can report an old PHP instead of dying on it.

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$ok = true;
$report = function ($pass, $label, $detail = '') use (&$ok) {
    printf("  %s  %s%s\n", $pass ? "\033[32mok\033[0m  " : "\033[31mFAIL\033[0m", $label, $detail !== '' ? " - $detail" : '');
    if (!$pass) $ok = false;
};

echo "PHP " . PHP_VERSION . " (" . PHP_SAPI . ", " . PHP_BINARY . ")\n";
echo "php.ini: " . (php_ini_loaded_file() ?: '(none loaded)') . "\n\n";

$report(PHP_VERSION_ID >= 80000, 'PHP 8.0 or newer', PHP_VERSION_ID >= 80000 ? '' : 'upgrade PHP (Rocky/RHEL: dnf module enable php:8.0 or newer)');
$report(extension_loaded('curl'), 'curl extension loaded',
    extension_loaded('curl') ? curl_version()['version'] : 'Rocky/RHEL: dnf install php-curl (usually in php-common); Windows: enable extension=curl in php.ini');
$report(extension_loaded('json'), 'json extension loaded');

// Every PHP file must parse on *this* PHP. A parse error in an include is the
// classic cause of a proxy 500, and nothing in the app can report it itself.
foreach (array_merge(glob(__DIR__ . '/*.php'), glob(__DIR__ . '/src/*.php')) as $file) {
    $output = [];
    exec(escapeshellarg(PHP_BINARY) . ' -l ' . escapeshellarg($file) . ' 2>&1', $output, $code);
    $name = substr($file, strlen(__DIR__) + 1);
    $report($code === 0, "parses: $name", $code === 0 ? '' : trim(implode(' ', $output)));
}

if (PHP_VERSION_ID >= 80000) {
    require __DIR__ . '/src/ProxyException.php';
    require __DIR__ . '/src/Config.php';
    try {
        $config = Config::load(__DIR__);
        $report(true, 'settings.php valid', "mode={$config['mode']}, auth={$config['auth']}, timeout={$config['timeout_seconds']}s");
        // Apache's SetEnv values are not visible to this shell, so say which ones this run used.
        echo "  \033[2minfo\033[0m  settings come from this shell's APIWB_* environment; Apache's SetEnv values are not visible here\n";
        if ($config['mode'] === 'hosted' && !$config['allowed_hosts']) {
            echo "  \033[33mwarn\033[0m  hosted mode with no APIWB_ALLOWED_HOSTS: internal (private-address) APIs will be refused\n";
        }
        if ($config['mode'] === 'hosted' && $config['auth'] === 'none') {
            echo "  \033[33mwarn\033[0m  hosted mode with APIWB_AUTH=none: anyone who can open the page can use the proxy, and nothing is logged\n";
        }
    } catch (Throwable $e) {
        $report(false, 'settings.php valid', $e->getMessage());
        $config = null;
    }

    // Accounts and storage: the app's own database, reached through config.php.
    if ($config !== null && $config['auth'] === 'login') {
        echo "\nDatabase\n";
        $report(extension_loaded('pdo_mysql'), 'pdo_mysql extension loaded',
            extension_loaded('pdo_mysql') ? '' : 'Rocky/RHEL: dnf install php-mysqlnd, then restart httpd/php-fpm');
        $path = (string) $config['config_path'];
        $report(is_readable($path), 'config readable', is_readable($path) ? $path
            : "$path - copy config.example.php to it and fill in the database details");
        if (is_readable($path) && extension_loaded('pdo_mysql')) {
            try {
                $returned = require_once $path;
                // Earlier versions kept settings in a config.php that returned an array.
                $report(function_exists('connect'), 'config defines connect(): PDO', function_exists('connect') ? ''
                    : (is_array($returned) ? 'this is the old settings-array config.php: replace it with config.example.php'
                        . ' filled in, and move settings to APIWB_* (see README)' : 'see config.example.php for the shape'));
                if (!function_exists('connect')) throw new RuntimeException('no connect() to call');
                $db = connect();
                $report(true, 'database connects', (string) $db->query('SELECT DATABASE()')->fetchColumn());
                foreach (['users', 'login_attempts', 'activity_log', 'items', 'password_resets'] as $table) {
                    $found = $db->query("SHOW TABLES LIKE '$table'")->fetchColumn() !== false;
                    $report($found, "table $table present", $found ? '' : 'run: sudo mariadb < schema.sql');
                }
                // Added after the first release; every request reads it, so its absence breaks everything.
                $hasDisabled = $db->query("SHOW COLUMNS FROM users LIKE 'disabled'")->fetchColumn() !== false;
                $report($hasDisabled, 'column users.disabled present', $hasDisabled ? '' : 'run: sudo mariadb < schema.sql (safe to re-run)');
                $admins = (int) $db->query('SELECT COUNT(*) FROM users WHERE is_admin = 1' . ($hasDisabled ? ' AND disabled = 0' : ''))->fetchColumn();
                echo "  \033[2minfo\033[0m  $admins active admin(s)" . (OWNER_USER !== '' ? ', plus owner ' . OWNER_USER : '') . "\n";
                $users = (int) $db->query('SELECT COUNT(*) FROM users')->fetchColumn();
                echo "  \033[2minfo\033[0m  $users account(s)" . ($users === 0 ? ': the first one created becomes an admin' : '') . "\n";
            } catch (Throwable $e) {
                $report(false, 'database connects', $e->getMessage());
            }
        }
    }
}

echo $ok ? "\nAll checks passed.\n" : "\nSome checks failed - fix them, then reload the page.\n";
exit($ok ? 0 : 1);
