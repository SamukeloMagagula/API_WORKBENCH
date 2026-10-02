<?php
declare(strict_types=1);

/**
 * Who is using the app, for the JSON endpoints (proxy.php, api.php).
 *
 * With auth = 'login' people sign in through login.php / auth.php, which put the
 * user in the app's own session (src/Session.php). This reads that session, guards
 * state-changing calls with its CSRF token, and writes the activity log.
 *
 * With auth = 'none' every method is a no-op: nobody signs in and nothing is stored.
 */
final class Auth
{
    private ?PDO $db = null;
    private ?array $user = null;
    private string $csrf = '';
    private bool $started = false;

    public function __construct(private array $config)
    {
    }

    public function enabled(): bool
    {
        return $this->config['auth'] === 'login';
    }

    /**
     * Opens the session, notes who is signed in, then releases it.
     *
     * The session file is locked while open. A proxied call can run for
     * timeout_seconds, and holding the lock that long would stall every other
     * request this browser makes to the app until it finished.
     */
    public function start(bool $mintCsrf = false): void
    {
        if (!$this->enabled() || $this->started) return;
        $this->started = true;

        apiwb_session_start();
        $this->csrf = $mintCsrf ? csrf_token() : (string) ($_SESSION['csrf_token'] ?? '');
        $id = (int) ($_SESSION['user_id'] ?? 0);
        $this->user = $id > 0 ? ['id' => $id, 'username' => (string) ($_SESSION['username'] ?? '')] : null;
        session_write_close();
    }

    /** The signed-in user, or null. Always null when auth is off. */
    public function user(): ?array
    {
        $this->start();
        return $this->user;
    }

    /**
     * The signed-in user; refuses the request otherwise. With auth off, an anonymous user.
     *
     * Checked against the database every time, so disabling or deleting an account takes
     * effect on that person's very next request, not when their session happens to end.
     */
    public function requireUser(): array
    {
        if (!$this->enabled()) return ['id' => 0, 'username' => ''];
        $user = $this->user();
        if ($user === null) {
            throw new ProxyException('NOT_SIGNED_IN', 'Your session has ended. Sign in again.', 401);
        }
        $account = $this->account($user['id']);
        if ($account === null) {
            throw new ProxyException('NOT_SIGNED_IN', 'This account no longer exists.', 401);
        }
        if ($account['disabled']) {
            throw new ProxyException('ACCOUNT_DISABLED', 'This account has been disabled. Ask an administrator.', 403);
        }
        return $user;
    }

    /** The signed-in user, who must be an admin. */
    public function requireAdmin(): array
    {
        $user = $this->requireUser();
        if (!$this->isAdmin($user['id'])) {
            throw new ProxyException('FORBIDDEN', 'Only an administrator can do this.', 403);
        }
        return $user;
    }

    /** @return array{username: string, isAdmin: bool, disabled: bool}|null */
    public function account(int $userId): ?array
    {
        static $cache = [];
        if (!array_key_exists($userId, $cache)) {
            $stmt = $this->db()->prepare('SELECT username, is_admin, disabled FROM users WHERE id = ?');
            $stmt->execute([$userId]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            $cache[$userId] = $row ? [
                'username' => (string) $row['username'],
                'isAdmin' => (bool) $row['is_admin'] || ($this->config['owner'] !== '' && $row['username'] === $this->config['owner']),
                'disabled' => (bool) $row['disabled'],
            ] : null;
        }
        return $cache[$userId];
    }

    /** Signs the session out, leaving a message for the sign-in page to show. */
    public function endSession(string $message): void
    {
        apiwb_session_start(); // reopened: start() released it
        unset($_SESSION['user_id'], $_SESSION['username']);
        $_SESSION['flash_error'] = $message;
        session_write_close();
        $this->user = null;
    }

    public function csrfToken(): string
    {
        $this->start();
        return $this->csrf;
    }

    /** State-changing requests must echo the session's token in X-CSRF-Token. */
    public function requireCsrf(): void
    {
        if (!$this->enabled()) return;
        $this->start();
        $candidate = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
        if ($this->csrf === '' || !is_string($candidate) || !hash_equals($this->csrf, $candidate)) {
            throw new ProxyException('CSRF', 'Your session token is missing or out of date. Reload the page and try again.', 403);
        }
    }

    /** The app's database, through the connect() that CONFIG_PATH defines. */
    public function db(): PDO
    {
        if ($this->db === null) $this->db = apiwb_db($this->config['config_path']);
        return $this->db;
    }

    /** An admin is flagged in users.is_admin, or is the configured owner. */
    public function isAdmin(int $userId): bool
    {
        if (!$this->enabled() || $userId <= 0) return false;
        $account = $this->account($userId);
        return $account !== null && $account['isAdmin'] && !$account['disabled'];
    }

    /**
     * Writes to the activity log.
     *
     * A logging failure is reported to the PHP error log rather than failing the
     * request: the user's call has already happened by the time it is logged.
     */
    public function log(string $action, string $detail): void
    {
        if (!$this->enabled() || $this->user === null) return;
        try {
            apiwb_log($this->db(), $this->user['username'], $action, $detail);
        } catch (Throwable $e) {
            error_log('API Workbench: could not write activity_log: ' . $e->getMessage());
        }
    }
}

/**
 * Connects through the config file's connect(), checking it explicitly so a misplaced
 * config reports itself instead of dying as a bare "failed to open stream" fatal.
 */
function apiwb_db(string $path): PDO
{
    if (!is_readable($path)) {
        throw new ProxyException('CONFIG_ERROR', "Cannot read the database config at $path"
            . ' — check it exists and is readable by the web server user (see config.example.php).', 500);
    }
    require_once $path;
    if (!function_exists('connect')) {
        throw new ProxyException('CONFIG_ERROR', "$path was loaded but does not define connect(): PDO. See config.example.php.", 500);
    }
    return connect();
}

function apiwb_log(PDO $db, string $username, string $action, string $detail = ''): void
{
    $db->prepare('INSERT INTO activity_log (username, action, detail) VALUES (?, ?, ?)')
        ->execute([$username, $action, $detail === '' ? null : mb_substr_safe($detail, 1000)]);
}

/** Truncates without splitting a UTF-8 character, with or without mbstring. */
function mb_substr_safe(string $text, int $max): string
{
    if (strlen($text) <= $max) return $text;
    return function_exists('mb_strcut') ? mb_strcut($text, 0, $max, 'UTF-8') : substr($text, 0, $max);
}
