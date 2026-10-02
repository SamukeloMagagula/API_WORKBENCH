<?php
declare(strict_types=1);

// Set a new password from a one-time reset link: reset.php?token=...
//
// An admin issues the link from the Admin tab and hands it over directly, the way they
// would a temporary password. There is no email. It works once, within APIWB_RESET_TTL.

require __DIR__ . '/settings.php';
require __DIR__ . '/src/ProxyException.php';
require __DIR__ . '/src/Session.php';
require __DIR__ . '/src/Auth.php';
require __DIR__ . '/src/Admin.php';

header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');
// The token is in this page's URL: never send it on to another site in a Referer header.
header('Referrer-Policy: no-referrer');

apiwb_session_start();

try {
    $db = apiwb_db(CONFIG_PATH);
} catch (Throwable $e) {
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    exit($e->getMessage());
}

$token = (string) ($_GET['token'] ?? $_POST['token'] ?? '');
$reset = $token !== '' ? password_reset_for($db, $token) : null;
$error = '';
$done = false;

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    if (!csrf_valid(csrf_from_request())) {
        $error = 'Your session expired. Open the link again and retry.';
    } elseif ($reset === null) {
        $error = 'This link is no longer valid.';
    } elseif ($problem = password_problem((string) ($_POST['password'] ?? ''), (string) ($_POST['confirm'] ?? ''))) {
        $error = $problem;
    } else {
        consume_password_reset($db, $reset, (string) $_POST['password']);
        // Whoever was signed in on this browser is not necessarily the person resetting.
        unset($_SESSION['user_id'], $_SESSION['username']);
        $done = true;
        $reset = null;
    }
}

$csrf = csrf_token();
$e = fn (string $s): string => htmlspecialchars($s, ENT_QUOTES);
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>API Workbench: Set a new password</title>
  <style>
    :root {
      --black: #111111; --white: #ffffff; --red: #d6001c; --red-dark: #a80016; --ink: #18181b;
      --grey-200: #e4e4e7; --grey-500: #71717a; --radius-sm: 6px; --radius-lg: 12px;
      --sans: system-ui, -apple-system, "Segoe UI Variable Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: var(--sans); background: #f6f6f7; color: var(--ink); display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; font-size: 14px; }
    .card { width: 100%; max-width: 400px; border: 1px solid var(--grey-200); border-radius: var(--radius-lg); background: var(--white); box-shadow: 0 6px 20px rgba(0,0,0,.10); overflow: hidden; }
    .brand { padding: 22px 28px; background: #111214; color: var(--white); border-bottom: 2px solid var(--red); }
    .wordmark { display: flex; align-items: center; gap: 10px; line-height: 1; font-size: 17px; font-weight: 600; letter-spacing: .02em; }
    .wordmark::before { content: ""; width: 3px; height: 21px; border-radius: 2px; background: var(--red); }
    .sub { margin: 8px 0 0 13px; font-size: 12px; letter-spacing: .1em; text-transform: uppercase; color: #a1a1aa; }
    .body { padding: 26px 28px 32px; }
    form { display: flex; flex-direction: column; gap: 18px; }
    label { display: flex; flex-direction: column; gap: 7px; font-weight: 600; font-size: 13px; }
    input { width: 100%; padding: 11px 14px; border: 1px solid var(--grey-200); border-radius: var(--radius-sm); font: inherit; font-size: 15px; outline: none; }
    input:focus { border-color: var(--black); box-shadow: 0 0 0 3px rgba(214,0,28,.15); }
    button { padding: 12px; border: none; border-radius: var(--radius-sm); background: var(--red); color: var(--white); font: inherit; font-size: 15px; font-weight: 600; cursor: pointer; }
    button:hover { background: var(--red-dark); }
    .error { color: var(--red-dark); border: 1px solid var(--red); border-left-width: 4px; background: #fdecee; padding: 11px 13px; margin-bottom: 18px; font-weight: 600; border-radius: var(--radius-sm); }
    .done { color: #15803d; border: 1px solid #15803d; border-left-width: 4px; background: #f0fdf4; padding: 11px 13px; margin-bottom: 14px; font-weight: 600; border-radius: var(--radius-sm); }
    .note { color: var(--grey-500); line-height: 1.5; margin-bottom: 18px; }
    .link { display: inline-block; color: var(--red); font-weight: 600; text-decoration: none; }
    .link:hover { text-decoration: underline; }
    .reqs { list-style: none; margin-top: -10px; display: grid; gap: 4px; }
    .reqs li { position: relative; padding-left: 20px; font-size: 12px; color: var(--grey-500); }
    .reqs li::before { content: "\2717"; position: absolute; left: 0; font-weight: bold; }
    .reqs li.ok { color: var(--ink); }
    .reqs li.ok::before { content: "\2713"; color: #15803d; }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">
      <h1 class="wordmark">API WORKBENCH</h1>
      <p class="sub">Set a new password</p>
    </div>
    <div class="body">
      <?php if ($error !== ''): ?>
        <div class="error"><?= $e($error) ?></div>
      <?php endif; ?>

      <?php if ($done): ?>
        <div class="done">Your password has been changed.</div>
        <p class="note">Sign in with it now. This link will not work again.</p>
        <a class="link" href="login.php">Go to sign in &rarr;</a>

      <?php elseif ($reset === null): ?>
        <p class="note">This reset link is invalid, has already been used, or has expired. Ask an administrator for a new one.</p>
        <a class="link" href="login.php">Go to sign in &rarr;</a>

      <?php else: ?>
        <p class="note">Setting a new password for <strong><?= $e((string) $reset['username']) ?></strong>.</p>
        <form method="post" action="reset.php">
          <input type="hidden" name="token" value="<?= $e($token) ?>">
          <input type="hidden" name="csrf_token" value="<?= $e($csrf) ?>">
          <label>New password<input type="password" name="password" id="pw" autocomplete="new-password" minlength="10" required></label>
          <ul class="reqs" id="reqs">
            <li data-req="len">At least 10 characters</li>
            <li data-req="upper">An uppercase letter</li>
            <li data-req="lower">A lowercase letter</li>
            <li data-req="number">A number</li>
            <li data-req="special">A special character</li>
          </ul>
          <label>Confirm password<input type="password" name="confirm" autocomplete="new-password" minlength="10" required></label>
          <button type="submit">Set password</button>
        </form>
      <?php endif; ?>
    </div>
  </div>
  <script>
    const pw = document.getElementById('pw');
    if (pw) {
      const rules = {
        len: (v) => v.length >= 10,
        upper: (v) => /[A-Z]/.test(v),
        lower: (v) => /[a-z]/.test(v),
        number: (v) => /[0-9]/.test(v),
        special: (v) => /[^A-Za-z0-9]/.test(v),
      };
      pw.addEventListener('input', () => {
        document.querySelectorAll('#reqs li').forEach((li) => li.classList.toggle('ok', rules[li.dataset.req](pw.value)));
      });
    }
  </script>
</body>
</html>
