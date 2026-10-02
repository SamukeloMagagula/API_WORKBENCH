<?php
declare(strict_types=1);

/**
 * Who is using the app, borrowed from devhub.
 *
 * With auth = 'devhub' the app reads devhub's PHP session: same server, same session
 * store, same cookie, so anyone signed in to devhub is signed in here too, and the
 * CSRF token devhub keeps in that session protects this app's writes as well. There
 * is no second user list and no second sign-in page.
 *
 * With auth = 'none' every method is a no-op and the app behaves as before.
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
        return $this->config['auth'] === 'devhub';
    }

    /**
     * Opens devhub's session, notes who is signed in, then releases it.
     *
     * The session file is locked while open. A proxied call can run for
     * timeout_seconds, and holding the lock that long would stall every other
     * request this browser makes, to devhub or here, until it finished.
     */
    public function start(bool $mintCsrf = false): void
    {
        if (!$this->enabled() || $this->started) return;
        $this->started = true;

        // Same parameters as devhub's auth.php, so both apps read and write one cookie.
        session_set_cookie_params(['httponly' => true, 'samesite' => 'Lax']);
        session_start();
        if ($mintCsrf && empty($_SESSION['csrf_token'])) {
            $_SESSION['csrf_token'] = bin2hex(random_bytes(32)); // same key devhub's csrf.php uses
        }
        $this->csrf = (string) ($_SESSION['csrf_token'] ?? '');
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

    /** The signed-in user; refuses the request otherwise. With auth off, an anonymous user. */
    public function requireUser(): array
    {
        if (!$this->enabled()) return ['id' => 0, 'username' => ''];
        $user = $this->user();
        if ($user === null) {
            throw new ProxyException('NOT_SIGNED_IN', 'Sign in to devhub first, then reload this page.', 401);
        }
        return $user;
    }

    public function csrfToken(): string
    {
        $this->start();
        return $this->csrf;
    }

    /** State-changing requests must echo the session's token in X-CSRF-Token, as in devhub. */
    public function requireCsrf(): void
    {
        if (!$this->enabled()) return;
        $this->start();
        $candidate = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
        if ($this->csrf === '' || !is_string($candidate) || !hash_equals($this->csrf, $candidate)) {
            throw new ProxyException('CSRF', 'Your session token is missing or out of date. Reload the page and try again.', 403);
        }
    }

    /** devhub's database, through the connect() its config file defines. */
    public function db(): PDO
    {
        if ($this->db !== null) return $this->db;

        $path = (string) $this->config['devhub_config'];
        // Checked explicitly so a misplaced config reports itself instead of dying as a
        // bare "failed to open stream" fatal.
        if (!is_readable($path)) {
            throw new ProxyException('CONFIG_ERROR', "Cannot read the database config at $path"
                . ' — check it exists and is readable by the web server user, or point APIWB_CONFIG at it.', 500);
        }
        require_once $path;
        if (!function_exists('connect')) {
            throw new ProxyException('CONFIG_ERROR', "$path was loaded but does not define connect(): PDO.", 500);
        }
        $this->db = connect();
        return $this->db;
    }

    public function isAdmin(int $userId): bool
    {
        if (!$this->enabled() || $userId <= 0) return false;
        $stmt = $this->db()->prepare('SELECT is_admin FROM users WHERE id = ?');
        $stmt->execute([$userId]);
        return (bool) $stmt->fetchColumn();
    }

    /**
     * Writes to devhub's activity log, so the admin Logs page shows API Workbench use.
     *
     * A logging failure is reported to the PHP error log rather than failing the
     * request: the user's call has already happened by the time it is logged.
     */
    public function log(string $action, string $detail): void
    {
        if (!$this->enabled() || $this->user === null) return;
        try {
            $this->db()->prepare('INSERT INTO activity_log (username, action, detail) VALUES (?, ?, ?)')
                ->execute([$this->user['username'], $action, mb_substr_safe($detail, 1000)]);
        } catch (Throwable $e) {
            error_log('API Workbench: could not write activity_log: ' . $e->getMessage());
        }
    }
}

/** Truncates without splitting a UTF-8 character, with or without mbstring. */
function mb_substr_safe(string $text, int $max): string
{
    if (strlen($text) <= $max) return $text;
    return function_exists('mb_strcut') ? mb_strcut($text, 0, $max, 'UTF-8') : substr($text, 0, $max);
}
