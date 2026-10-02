<?php
declare(strict_types=1);

// Who is signed in, and the shared collections and environments.
//
//   GET  api.php?action=me                   sign-in state, CSRF token, what is enabled
//   GET  api.php?action=collections          collections this user can see
//   POST api.php?action=collection_save      {id?, name, shared, version?, content}
//   POST api.php?action=collection_delete    {id}
//   ...and the same three for environment(s).
//
// Admins only:
//   GET  api.php?action=users                every account
//   POST api.php?action=user_update          {id, isAdmin?, disabled?}
//   POST api.php?action=user_reset           {id}  -> a one-time reset link secret
//   GET  api.php?action=activity             the log; filters user, action, from, to, q, before
//
// Everything except "me" needs a signed-in user (the default; APIWB_AUTH=none turns it off).

require __DIR__ . '/bootstrap.php';
require __DIR__ . '/src/ItemStore.php';
require __DIR__ . '/src/Admin.php';

try {
    $config = Config::load(__DIR__);
    $auth = new Auth($config);
    $action = (string) ($_GET['action'] ?? '');
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($action === 'me') {
        $auth->start(true);
        $user = $auth->user();
        $storage = ['ok' => false, 'error' => null];
        $isAdmin = false;
        if ($auth->enabled() && $user !== null) {
            // Checked here so a broken database setup shows up as a message on the
            // page, not as a sign-in that silently cannot save anything.
            try {
                $account = $auth->account($user['id']);
                if ($account === null || $account['disabled']) {
                    // Signed in to an account that is gone or disabled: end that session here,
                    // or login.php (which skips signed-in visitors) and the app would bounce
                    // between each other forever.
                    $auth->endSession($account === null ? 'This account no longer exists.' : 'This account has been disabled. Ask an administrator.');
                    $user = null;
                } else {
                    $isAdmin = $auth->isAdmin($user['id']);
                    $auth->db()->query('SELECT 1 FROM items LIMIT 1');
                    $storage['ok'] = true;
                }
            } catch (Throwable $e) {
                $storage['error'] = $e->getMessage();
            }
        }
        respond(200, [
            'ok' => true,
            'auth' => $config['auth'],
            'signedIn' => $user !== null,
            'username' => $user['username'] ?? null,
            'isAdmin' => $isAdmin,
            'csrfToken' => $auth->csrfToken(),
            'loginUrl' => 'login.php',
            'storage' => $storage,
        ]);
    }

    if (!$auth->enabled()) {
        throw new ProxyException('NOT_AVAILABLE', 'Shared collections are off on this install (APIWB_AUTH=none).', 404);
    }
    $user = $auth->requireUser();

    $adminRoutes = ['users' => 'GET', 'user_update' => 'POST', 'user_reset' => 'POST', 'activity' => 'GET'];
    if (isset($adminRoutes[$action])) {
        if ($method !== $adminRoutes[$action]) {
            throw new ProxyException('METHOD_NOT_ALLOWED', "Use {$adminRoutes[$action]} for $action.", 405);
        }
        $actor = $auth->requireAdmin();
        $admin = new Admin($auth->db(), $config['owner'], $config['reset_ttl']);

        if ($action === 'users') {
            respond(200, ['ok' => true, 'users' => $admin->listUsers(), 'you' => $actor['id']]);
        }
        if ($action === 'activity') {
            respond(200, ['ok' => true, 'actions' => $admin->actions()] + $admin->activity($_GET));
        }

        require_same_origin();
        $auth->requireCsrf();
        $data = read_json_body(65536);
        $targetId = (int) ($data['id'] ?? 0);

        if ($action === 'user_update') {
            $changes = array_intersect_key($data, ['isAdmin' => true, 'disabled' => true]);
            $auth->log('admin.user.update', $admin->updateUser($actor, $targetId, $changes));
            respond(200, ['ok' => true, 'users' => $admin->listUsers()]);
        }

        $reset = $admin->issueReset($actor, $targetId);
        $auth->log('admin.user.reset_link', "reset link issued for {$reset['username']}");
        respond(200, ['ok' => true] + $reset);
    }

    $routes = [
        'collections' => ['GET', 'collection', 'list'],
        'collection_save' => ['POST', 'collection', 'save'],
        'collection_delete' => ['POST', 'collection', 'delete'],
        'environments' => ['GET', 'environment', 'list'],
        'environment_save' => ['POST', 'environment', 'save'],
        'environment_delete' => ['POST', 'environment', 'delete'],
    ];
    if (!isset($routes[$action])) {
        throw new ProxyException('NOT_FOUND', "Unknown action: $action", 404);
    }
    [$expectedMethod, $kind, $verb] = $routes[$action];
    if ($method !== $expectedMethod) {
        throw new ProxyException('METHOD_NOT_ALLOWED', "Use $expectedMethod for $action.", 405);
    }

    $store = new ItemStore($auth->db(), $config['max_item_bytes']);

    if ($verb === 'list') {
        respond(200, ['ok' => true, 'items' => $store->listFor($kind, $user['id'])]);
    }

    require_same_origin();
    $auth->requireCsrf();
    $data = read_json_body($config['max_item_bytes'] + 65536);
    $isAdmin = $auth->isAdmin($user['id']);

    if ($verb === 'save') {
        $item = $store->save($kind, $user['id'], $isAdmin, $data);
        $auth->log("apiwb.$kind.save", ($item['shared'] ? 'shared ' : 'private ') . "$kind “{$item['name']}” (#{$item['id']})");
        respond(200, ['ok' => true, 'item' => $item]);
    }

    $id = (int) ($data['id'] ?? 0);
    $name = $store->delete($kind, $user['id'], $isAdmin, $id);
    $auth->log("apiwb.$kind.delete", "$kind “{$name}” (#$id)");
    respond(200, ['ok' => true]);
} catch (ProxyException $e) {
    fail($e->errorCode, $e->getMessage(), $e->httpStatus);
} catch (Throwable $e) {
    error_log('API Workbench api: ' . $e->getMessage());
    fail('SERVER_ERROR', sprintf('Server error: %s (%s line %d)', $e->getMessage(), basename($e->getFile()), $e->getLine()), 500);
}
