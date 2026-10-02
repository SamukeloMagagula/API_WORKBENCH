<?php
declare(strict_types=1);

// The sign-in and create-account page. Posts to auth.php.

require __DIR__ . '/settings.php';
require __DIR__ . '/src/Session.php';

if (AUTH_MODE === 'none') {
    header('Location: index.html');
    exit;
}

apiwb_session_start();
if (!empty($_SESSION['user_id'])) {
    header('Location: index.html');
    exit;
}

header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

$error = (string) ($_SESSION['flash_error'] ?? '');
unset($_SESSION['flash_error']);
$mode = ($_GET['mode'] ?? '') === 'register' ? 'register' : 'login';
$token = csrf_token();
$emailHint = EMAIL_DOMAIN !== '' ? 'you' . EMAIL_DOMAIN : 'you@company.com';
$e = fn (string $s): string => htmlspecialchars($s, ENT_QUOTES);
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>API Workbench: Sign in</title>
  <style>
    :root {
      --black: #111111; --white: #ffffff; --red: #d6001c; --red-dark: #a80016; --ink: #18181b;
      --grey-100: #f4f4f5; --grey-200: #e4e4e7; --grey-300: #d4d4d8; --grey-500: #71717a;
      --radius-sm: 6px; --radius-lg: 12px;
      --sans: system-ui, -apple-system, "Segoe UI Variable Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: var(--sans); background: #f6f6f7; color: var(--ink); -webkit-font-smoothing: antialiased;
      display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; font-size: 14px;
    }
    .auth-card { width: 100%; max-width: 400px; border: 1px solid var(--grey-200); border-radius: var(--radius-lg); background: var(--white); box-shadow: 0 6px 20px rgba(0,0,0,.10); overflow: hidden; }
    .auth-brand { padding: 22px 28px; background: #111214; color: var(--white); border-bottom: 2px solid var(--red); }
    .wordmark { display: flex; align-items: center; gap: 10px; line-height: 1; font-size: 17px; font-weight: 600; letter-spacing: .02em; }
    .wordmark::before { content: ""; width: 3px; height: 21px; border-radius: 2px; background: var(--red); }
    .auth-body { padding: 28px 28px 34px; }
    .auth-tabs { display: flex; margin-bottom: 22px; border: 1px solid var(--grey-200); border-radius: var(--radius-sm); overflow: hidden; }
    .auth-tab { flex: 1; border: none; background: var(--white); color: var(--ink); padding: 10px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
    .auth-tab + .auth-tab { border-left: 1px solid var(--grey-200); }
    .auth-tab.active { background: var(--red); color: var(--white); }
    .auth-form { display: flex; flex-direction: column; gap: 18px; }
    .auth-form[hidden] { display: none; }
    .auth-form label { display: flex; flex-direction: column; gap: 7px; font-weight: 600; font-size: 13px; }
    .auth-form input { width: 100%; padding: 11px 14px; border: 1px solid var(--grey-200); border-radius: var(--radius-sm); font: inherit; font-size: 15px; outline: none; }
    .auth-form input:focus { border-color: var(--black); box-shadow: 0 0 0 3px rgba(214,0,28,.15); }
    .auth-form button { padding: 12px; border: none; border-radius: var(--radius-sm); background: var(--red); color: var(--white); font: inherit; font-size: 15px; font-weight: 600; cursor: pointer; }
    .auth-form button:hover { background: var(--red-dark); }
    .auth-error { color: var(--red-dark); border: 1px solid var(--red); border-left-width: 4px; background: #fdecee; padding: 11px 13px; margin-bottom: 20px; font-weight: 600; border-radius: var(--radius-sm); }
    .pw-reqs { list-style: none; margin-top: -10px; display: grid; gap: 4px; }
    .pw-reqs li { position: relative; padding-left: 20px; font-size: 12px; color: var(--grey-500); }
    .pw-reqs li::before { content: "\2717"; position: absolute; left: 0; font-weight: bold; }
    .pw-reqs li.ok { color: var(--ink); }
    .pw-reqs li.ok::before { content: "\2713"; color: #15803d; }
    .pw-match { margin-top: -10px; font-size: 12px; font-weight: 600; }
    .pw-match.ok { color: #15803d; }
    .pw-match.bad { color: var(--red-dark); }
  </style>
</head>
<body>
  <div class="auth-card">
    <div class="auth-brand"><h1 class="wordmark">API WORKBENCH</h1></div>
    <div class="auth-body">
      <div class="auth-tabs">
        <button type="button" class="auth-tab<?= $mode === 'login' ? ' active' : '' ?>" data-mode="login">Sign in</button>
        <button type="button" class="auth-tab<?= $mode === 'register' ? ' active' : '' ?>" data-mode="register">Create account</button>
      </div>

      <?php if ($error !== ''): ?>
        <div class="auth-error"><?= $e($error) ?></div>
      <?php endif; ?>

      <form class="auth-form" id="form-login" method="post" action="auth.php"<?= $mode === 'register' ? ' hidden' : '' ?>>
        <input type="hidden" name="action" value="login">
        <input type="hidden" name="csrf_token" value="<?= $e($token) ?>">
        <label>Email<input type="email" name="username" placeholder="<?= $e($emailHint) ?>" autocomplete="username" required></label>
        <label>Password<input type="password" name="password" autocomplete="current-password" required></label>
        <button type="submit">Sign in</button>
      </form>

      <form class="auth-form" id="form-register" method="post" action="auth.php"<?= $mode === 'login' ? ' hidden' : '' ?>>
        <input type="hidden" name="action" value="register">
        <input type="hidden" name="csrf_token" value="<?= $e($token) ?>">
        <label>Email<input type="email" name="username" placeholder="<?= $e($emailHint) ?>" autocomplete="username" required></label>
<?php if (REGISTRATION_KEY !== ''): ?>
        <label>Registration key<input type="password" name="registration_key" autocomplete="off" required></label>
<?php endif; ?>
        <label>Password<input type="password" name="password" id="reg-password" autocomplete="new-password" minlength="10" required></label>
        <ul class="pw-reqs" id="pw-reqs" aria-live="polite">
          <li data-req="len">At least 10 characters</li>
          <li data-req="upper">An uppercase letter</li>
          <li data-req="lower">A lowercase letter</li>
          <li data-req="number">A number</li>
          <li data-req="special">A special character</li>
        </ul>
        <label>Confirm password<input type="password" name="confirm" id="reg-confirm" autocomplete="new-password" minlength="10" required></label>
        <p class="pw-match" id="pw-match" hidden></p>
        <button type="submit">Create account</button>
      </form>
    </div>
  </div>

  <script>
    const tabs = document.querySelectorAll('.auth-tab');
    const forms = { login: document.getElementById('form-login'), register: document.getElementById('form-register') };
    tabs.forEach((tab) => tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.toggle('active', t === tab));
      forms.login.hidden = tab.dataset.mode !== 'login';
      forms.register.hidden = tab.dataset.mode !== 'register';
    }));

    const pw = document.getElementById('reg-password');
    const confirmPw = document.getElementById('reg-confirm');
    const match = document.getElementById('pw-match');
    const rules = {
      len: (v) => v.length >= 10,
      upper: (v) => /[A-Z]/.test(v),
      lower: (v) => /[a-z]/.test(v),
      number: (v) => /[0-9]/.test(v),
      special: (v) => /[^A-Za-z0-9]/.test(v),
    };
    function refreshMatch() {
      if (!confirmPw.value) { match.hidden = true; return; }
      const same = pw.value === confirmPw.value;
      match.hidden = false;
      match.textContent = same ? 'Passwords match' : 'Passwords do not match';
      match.className = `pw-match ${same ? 'ok' : 'bad'}`;
    }
    pw.addEventListener('input', () => {
      document.querySelectorAll('#pw-reqs li').forEach((li) => li.classList.toggle('ok', rules[li.dataset.req](pw.value)));
      refreshMatch();
    });
    confirmPw.addEventListener('input', refreshMatch);
  </script>
</body>
</html>
