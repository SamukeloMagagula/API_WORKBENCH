<?php
declare(strict_types=1);

// Sign-in, account creation and sign-out. Plain form posts from login.php and the
// app's "Sign out" button; every outcome is a redirect, errors travel as a one-shot
// flash message in the session.

require __DIR__ . '/settings.php';
require __DIR__ . '/src/ProxyException.php';
require __DIR__ . '/src/Session.php';
require __DIR__ . '/src/Auth.php';

apiwb_session_start();

function config_failure(string $message): void
{
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: text/plain; charset=utf-8');
    }
    exit($message);
}

/** Store a one-shot error and go back to the sign-in page. */
function bounce(string $error, string $mode = 'login'): void
{
    $_SESSION['flash_error'] = $error;
    header('Location: login.php' . ($mode === 'register' ? '?mode=register' : ''));
    exit;
}

/** Mark the session as signed in and go to the app. */
function start_session_for(int $userId, string $username): void
{
    // A fresh id at sign-in, so a session id planted before sign-in is worthless after it.
    session_regenerate_id(true);
    $_SESSION['user_id'] = $userId;
    $_SESSION['username'] = $username;
    header('Location: index.html');
    exit;
}

/** The caller's address, for rate limiting. Not trusted for anything else. */
function client_ip(): string
{
    return substr((string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown'), 0, 45);
}

/**
 * Failed sign-ins for this username and this address inside the window.
 *
 * Counting both matters: per-username alone lets one attacker spray many accounts
 * from one machine, and per-address alone lets a distributed attempt through.
 */
function recent_failures(PDO $db, string $username, string $ip): int
{
    $stmt = $db->prepare(
        'SELECT COUNT(*) FROM login_attempts
         WHERE attempted_at > (NOW() - INTERVAL ? SECOND) AND (username = ? OR ip = ?)'
    );
    $stmt->execute([LOGIN_WINDOW_SECONDS, $username, $ip]);
    return (int) $stmt->fetchColumn();
}

if (AUTH_MODE === 'none') {
    header('Location: index.html');
    exit;
}
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Location: login.php');
    exit;
}

$action = (string) ($_POST['action'] ?? '');

// Sign-in, registration and sign-out are all state-changing form posts, so all three
// carry the session token. Without it, another site could sign a visitor out, or into
// an account the attacker controls.
if (!csrf_valid(csrf_from_request())) {
    bounce('Your session expired. Please try again.', $action === 'register' ? 'register' : 'login');
}

try {
    $db = apiwb_db(CONFIG_PATH);
} catch (Throwable $e) {
    config_failure($e->getMessage());
}

if ($action === 'logout') {
    if (!empty($_SESSION['username'])) {
        apiwb_log($db, (string) $_SESSION['username'], 'logout');
    }
    $_SESSION = [];
    session_destroy();
    header('Location: login.php');
    exit;
}

if ($action === 'register') {
    $username = strtolower(trim((string) ($_POST['username'] ?? '')));
    $password = (string) ($_POST['password'] ?? '');
    $confirm = (string) ($_POST['confirm'] ?? '');

    // When a registration key is configured, reaching this form is no longer enough
    // to get an account. Compared in constant time like any other secret.
    if (REGISTRATION_KEY !== '') {
        $supplied = (string) ($_POST['registration_key'] ?? '');
        if ($supplied === '' || !hash_equals(REGISTRATION_KEY, $supplied)) {
            bounce('That registration key is not correct.', 'register');
        }
    }
    if (!username_ok($username)) {
        bounce(EMAIL_DOMAIN !== '' ? 'Register with an email address ending in ' . EMAIL_DOMAIN . '.' : 'Register with a valid email address.', 'register');
    }
    if ($problem = password_problem($password, $confirm)) bounce($problem, 'register');

    // The first account on a fresh install becomes an admin, so there is always one.
    $isFirst = (int) $db->query('SELECT COUNT(*) FROM users')->fetchColumn() === 0;
    try {
        $db->prepare('INSERT INTO users (username, password, is_admin) VALUES (?, ?, ?)')
            ->execute([$username, password_hash($password, PASSWORD_DEFAULT), $isFirst ? 1 : 0]);
    } catch (PDOException $e) {
        if ($e->getCode() === '23000') bounce('An account with that email already exists. Sign in instead.', 'register');
        throw $e;
    }
    $userId = (int) $db->lastInsertId();
    apiwb_log($db, $username, 'register', $isFirst ? 'first account: made admin' : '');
    start_session_for($userId, $username);
}

if ($action === 'login') {
    $username = strtolower(trim((string) ($_POST['username'] ?? '')));
    $password = (string) ($_POST['password'] ?? '');
    $ip = client_ip();

    // Old rows serve no purpose; clear them here rather than needing a cron.
    $db->prepare('DELETE FROM login_attempts WHERE attempted_at < (NOW() - INTERVAL ? SECOND)')
        ->execute([LOGIN_WINDOW_SECONDS * 4]);

    if (recent_failures($db, $username, $ip) >= LOGIN_MAX_ATTEMPTS) {
        // The same wording whether or not the account exists, so the lockout cannot
        // be used to find out which usernames are real.
        apiwb_log($db, $username, 'login.blocked', $ip);
        bounce('Too many failed sign-in attempts. Wait a few minutes and try again.');
    }

    $query = $db->prepare('SELECT id, password, disabled FROM users WHERE username = ?');
    $query->execute([$username]);
    $user = $query->fetch(PDO::FETCH_ASSOC);

    if (!$user || !password_verify($password, $user['password'])) {
        $db->prepare('INSERT INTO login_attempts (username, ip) VALUES (?, ?)')->execute([$username, $ip]);
        apiwb_log($db, $username, 'login.failed', $ip);
        bounce('Invalid email or password.');
    }

    // Said only after the right password, so it reveals nothing to someone guessing.
    if ((int) $user['disabled'] === 1) {
        apiwb_log($db, $username, 'login.disabled', $ip);
        bounce('This account has been disabled. Ask an administrator.');
    }

    // A clean sign-in clears the account's failures, so one fumbled password does not
    // count against the next person on a shared address.
    $db->prepare('DELETE FROM login_attempts WHERE username = ?')->execute([$username]);
    apiwb_log($db, $username, 'login');
    start_session_for((int) $user['id'], $username);
}

bounce('Unknown action.');
