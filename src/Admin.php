<?php
declare(strict_types=1);

/**
 * User administration, the activity log, and password reset links.
 *
 * The rules that stop an admin locking everyone out live here, not in the UI:
 *   - nobody can disable themselves or remove their own admin rights
 *   - the owner (APIWB_OWNER) cannot be demoted, disabled or reset by anyone else
 *   - the last active admin cannot be demoted or disabled
 */
final class Admin
{
    private const LOG_PAGE = 100;

    public function __construct(private PDO $db, private string $owner, private int $resetTtl)
    {
    }

    public function listUsers(): array
    {
        $rows = $this->db->query(
            "SELECT u.id, u.username, u.is_admin, u.disabled, u.created_at,
                    (SELECT MAX(a.created_at) FROM activity_log a WHERE a.username = u.username AND a.action = 'login') AS last_login
               FROM users u
              ORDER BY u.username"
        )->fetchAll(PDO::FETCH_ASSOC);
        return array_map(fn ($u) => [
            'id' => (int) $u['id'],
            'username' => (string) $u['username'],
            'isOwner' => $this->owner !== '' && $u['username'] === $this->owner,
            'isAdmin' => (bool) $u['is_admin'] || ($this->owner !== '' && $u['username'] === $this->owner),
            'disabled' => (bool) $u['disabled'],
            'createdAt' => (string) $u['created_at'],
            'lastLogin' => $u['last_login'] !== null ? (string) $u['last_login'] : null,
        ], $rows);
    }

    /** @return string a description for the activity log */
    public function updateUser(array $actor, int $targetId, array $changes): string
    {
        $target = $this->user($targetId);
        $this->guardTarget($actor, $target);
        $done = [];

        if (array_key_exists('isAdmin', $changes)) {
            $makeAdmin = (bool) $changes['isAdmin'];
            if (!$makeAdmin) {
                if ($target['id'] === $actor['id']) {
                    throw new ProxyException('FORBIDDEN', 'You cannot remove your own admin rights. Ask another admin.', 403);
                }
                $this->guardLastAdmin($target);
            }
            $this->db->prepare('UPDATE users SET is_admin = ? WHERE id = ?')->execute([$makeAdmin ? 1 : 0, $target['id']]);
            $done[] = $makeAdmin ? 'made admin' : 'admin rights removed';
        }

        if (array_key_exists('disabled', $changes)) {
            $disable = (bool) $changes['disabled'];
            if ($disable) {
                if ($target['id'] === $actor['id']) {
                    throw new ProxyException('FORBIDDEN', 'You cannot disable your own account.', 403);
                }
                $this->guardLastAdmin($target);
            }
            $this->db->prepare('UPDATE users SET disabled = ? WHERE id = ?')->execute([$disable ? 1 : 0, $target['id']]);
            $done[] = $disable ? 'disabled' : 'enabled';
        }

        if (!$done) throw new ProxyException('INVALID_REQUEST', 'Nothing to change.');
        return $target['username'] . ': ' . implode(', ', $done);
    }

    /**
     * Issues a reset link secret for a user, spending any outstanding one.
     * @return array{token: string, username: string, expiresInSeconds: int}
     */
    public function issueReset(array $actor, int $targetId): array
    {
        $target = $this->user($targetId);
        $this->guardTarget($actor, $target);

        $this->db->prepare('UPDATE password_resets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL')
            ->execute([$target['id']]);
        $token = bin2hex(random_bytes(32));
        $this->db->prepare(
            'INSERT INTO password_resets (user_id, token_hash, issued_by, expires_at)
             VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))'
        )->execute([$target['id'], hash('sha256', $token), $actor['username'], $this->resetTtl]);

        return ['token' => $token, 'username' => $target['username'], 'expiresInSeconds' => $this->resetTtl];
    }

    /**
     * One page of the activity log, newest first.
     * Filters: user (exact), action (exact), from / to (YYYY-MM-DD, inclusive), q (in user, action
     * or detail), before (an id, for the next page).
     */
    public function activity(array $filters): array
    {
        $where = [];
        $args = [];
        if (($filters['user'] ?? '') !== '') { $where[] = 'username = ?'; $args[] = strtolower(trim((string) $filters['user'])); }
        if (($filters['action'] ?? '') !== '') { $where[] = 'action = ?'; $args[] = (string) $filters['action']; }
        if (self::isDate($filters['from'] ?? '')) { $where[] = 'created_at >= ?'; $args[] = $filters['from'] . ' 00:00:00'; }
        if (self::isDate($filters['to'] ?? '')) { $where[] = 'created_at < DATE_ADD(?, INTERVAL 1 DAY)'; $args[] = $filters['to']; }
        if (($filters['q'] ?? '') !== '') {
            $like = '%' . addcslashes((string) $filters['q'], '%_\\') . '%';
            $where[] = '(username LIKE ? OR action LIKE ? OR detail LIKE ?)';
            array_push($args, $like, $like, $like);
        }
        if ((int) ($filters['before'] ?? 0) > 0) { $where[] = 'id < ?'; $args[] = (int) $filters['before']; }

        $sql = 'SELECT id, username, action, detail, created_at FROM activity_log'
            . ($where ? ' WHERE ' . implode(' AND ', $where) : '')
            . ' ORDER BY id DESC LIMIT ' . (self::LOG_PAGE + 1);
        $stmt = $this->db->prepare($sql);
        $stmt->execute($args);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $more = count($rows) > self::LOG_PAGE;
        $rows = array_slice($rows, 0, self::LOG_PAGE);
        return [
            'rows' => array_map(fn ($r) => [
                'id' => (int) $r['id'],
                'username' => (string) $r['username'],
                'action' => (string) $r['action'],
                'detail' => $r['detail'] !== null ? (string) $r['detail'] : '',
                'at' => (string) $r['created_at'],
            ], $rows),
            'more' => $more,
        ];
    }

    /** The distinct actions in the log, for the filter dropdown. */
    public function actions(): array
    {
        return $this->db->query('SELECT DISTINCT action FROM activity_log ORDER BY action')->fetchAll(PDO::FETCH_COLUMN);
    }

    private function user(int $id): array
    {
        $stmt = $this->db->prepare('SELECT id, username, is_admin, disabled FROM users WHERE id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) throw new ProxyException('NOT_FOUND', 'No such user.', 404);
        return ['id' => (int) $row['id'], 'username' => (string) $row['username'], 'isAdmin' => (bool) $row['is_admin'], 'disabled' => (bool) $row['disabled']];
    }

    /** The owner can only be managed by the owner. */
    private function guardTarget(array $actor, array $target): void
    {
        if ($this->owner !== '' && $target['username'] === $this->owner && $actor['username'] !== $this->owner) {
            throw new ProxyException('FORBIDDEN', 'Only the owner can change the owner account.', 403);
        }
    }

    /** Refuses to leave the install without an active admin. */
    private function guardLastAdmin(array $target): void
    {
        if (!$target['isAdmin'] || $target['disabled']) return;
        // Other active admins: flagged ones, plus the owner when that account exists and is enabled.
        $stmt = $this->db->prepare('SELECT COUNT(*) FROM users WHERE disabled = 0 AND id <> ? AND (is_admin = 1 OR username = ?)');
        $stmt->execute([$target['id'], $this->owner]);
        if ((int) $stmt->fetchColumn() === 0) {
            throw new ProxyException('FORBIDDEN', "{$target['username']} is the only active admin. Make someone else an admin first.", 403);
        }
    }

    private static function isDate(mixed $value): bool
    {
        return is_string($value) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) === 1;
    }
}

/** The pending reset a secret refers to, or null if it is unknown, spent or expired. */
function password_reset_for(PDO $db, string $secret): ?array
{
    if (!preg_match('/^[0-9a-f]{64}$/', $secret)) return null;
    $stmt = $db->prepare(
        'SELECT r.id, r.user_id, u.username
           FROM password_resets r JOIN users u ON u.id = r.user_id
          WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > NOW()'
    );
    $stmt->execute([hash('sha256', $secret)]);
    return $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
}

/**
 * Sets the new password and spends the link, both or neither: a password changed without
 * the link being marked used would leave a live link behind.
 */
function consume_password_reset(PDO $db, array $reset, string $newPassword): void
{
    $db->beginTransaction();
    try {
        $db->prepare('UPDATE users SET password = ? WHERE id = ?')
            ->execute([password_hash($newPassword, PASSWORD_DEFAULT), (int) $reset['user_id']]);
        $db->prepare('UPDATE password_resets SET used_at = NOW() WHERE id = ?')->execute([(int) $reset['id']]);
        // A reset is the way back from a lockout, so clear the failures that caused it.
        $db->prepare('DELETE FROM login_attempts WHERE username = ?')->execute([$reset['username']]);
        apiwb_log($db, (string) $reset['username'], 'user.password_reset', 'completed via reset link');
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        throw $e;
    }
}
