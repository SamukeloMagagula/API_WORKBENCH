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
// Everything except "me" needs auth = 'devhub' in config.php and a devhub sign-in.

require __DIR__ . '/bootstrap.php';
require __DIR__ . '/src/ItemStore.php';

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
                $isAdmin = $auth->isAdmin($user['id']);
                $auth->db()->query('SELECT 1 FROM apiwb_items LIMIT 1');
                $storage['ok'] = true;
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
            'loginUrl' => $config['devhub_url'],
            'storage' => $storage,
        ]);
    }

    if (!$auth->enabled()) {
        throw new ProxyException('NOT_AVAILABLE', "Shared collections need auth = 'devhub' in config.php.", 404);
    }
    $user = $auth->requireUser();

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
