<?php
declare(strict_types=1);

/**
 * The app's PHP session and its CSRF token.
 *
 * The session has its own cookie name. Other PHP apps on the same host use PHP's
 * default PHPSESSID; sharing it would mean their sign-in, if keyed the same way, reads
 * as a sign-in here against a different users table.
 */

const SESSION_NAME = 'apiwb_session';

function apiwb_session_start(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) return;
    session_name(SESSION_NAME);
    session_set_cookie_params([
        'httponly' => true,
        'samesite' => 'Lax',
        'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
    ]);
    session_start();
}

/** The session's token, minted on first use. Survives session_regenerate_id() at sign-in. */
function csrf_token(): string
{
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return (string) $_SESSION['csrf_token'];
}

/** Constant-time comparison against the session's token. False if either is missing. */
function csrf_valid(?string $candidate): bool
{
    $expected = (string) ($_SESSION['csrf_token'] ?? '');
    if ($expected === '' || $candidate === null || $candidate === '') return false;
    return hash_equals($expected, $candidate);
}

/**
 * The token supplied with this request: a header from the app's fetch() calls,
 * a field from the plain sign-in and sign-out forms.
 */
function csrf_from_request(): ?string
{
    $header = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? null;
    if (is_string($header) && $header !== '') return $header;
    $field = $_POST['csrf_token'] ?? null;
    return is_string($field) && $field !== '' ? $field : null;
}

/** True if the username is an email address, inside EMAIL_DOMAIN when one is set. */
function username_ok(string $username): bool
{
    if ($username === '' || strlen($username) > 60 || filter_var($username, FILTER_VALIDATE_EMAIL) === false) return false;
    return EMAIL_DOMAIN === '' || str_ends_with($username, EMAIL_DOMAIN);
}

/** An error message, or null if the password is strong and matches confirm. */
function password_problem(string $password, string $confirm): ?string
{
    $strong = strlen($password) >= 10
        && preg_match('/[A-Z]/', $password)
        && preg_match('/[a-z]/', $password)
        && preg_match('/[0-9]/', $password)
        && preg_match('/[^A-Za-z0-9]/', $password);
    if (!$strong) {
        return 'Password must be at least 10 characters and include an uppercase letter, a lowercase letter, a number, and a special character.';
    }
    if ($password !== $confirm) {
        return 'Passwords do not match.';
    }
    return null;
}
