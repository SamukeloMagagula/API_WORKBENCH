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
        $file = is_file(__DIR__ . '/config.php') ? 'config.php' : 'config.example.php (no config.php yet)';
        $report(true, 'config valid', "$file, mode={$config['mode']}, timeout={$config['timeout_seconds']}s");
        if ($config['mode'] === 'hosted' && !$config['allowed_hosts']) {
            echo "  \033[33mwarn\033[0m  hosted mode with no allowed_hosts: internal (private-address) APIs will be refused\n";
        }
        if ($config['mode'] === 'hosted' && $config['auth'] === 'none') {
            echo "  \033[33mwarn\033[0m  hosted mode with auth = 'none': anyone who can open the page can use the proxy, and nothing is logged\n";
        }
    } catch (Throwable $e) {
        $report(false, 'config valid', $e->getMessage());
        $config = null;
    }

    // Sign-in and shared storage go through devhub: its config, its database, its tables.
    if ($config !== null && $config['auth'] === 'devhub') {
        echo "\nauth = devhub\n";
        $report(extension_loaded('pdo_mysql'), 'pdo_mysql extension loaded',
            extension_loaded('pdo_mysql') ? '' : 'Rocky/RHEL: dnf install php-mysqlnd, then restart httpd/php-fpm');
        $path = (string) $config['devhub_config'];
        $report(is_readable($path), 'devhub config readable', $path);
        if (is_readable($path) && extension_loaded('pdo_mysql')) {
            try {
                require_once $path;
                $db = connect();
                $report(true, 'devhub database connects', (string) $db->query('SELECT DATABASE()')->fetchColumn());
                foreach (['users', 'activity_log', 'apiwb_items'] as $table) {
                    $found = $db->query("SHOW TABLES LIKE '$table'")->fetchColumn() !== false;
                    $report($found, "table $table present", $found ? '' : ($table === 'apiwb_items'
                        ? 'run: mariadb <devhub database> < schema.sql' : 'is devhub_config pointing at the devhub database?'));
                }
            } catch (Throwable $e) {
                $report(false, 'devhub database connects', $e->getMessage());
            }
        }
        echo "  \033[2minfo\033[0m  sign-in is read from devhub's PHP session: both apps must be served from the same host\n";
    }
}

echo $ok ? "\nAll checks passed.\n" : "\nSome checks failed - fix them, then reload the page.\n";
exit($ok ? 0 : 1);
