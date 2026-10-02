<?php
declare(strict_types=1);

/**
 * Collections and environments saved on the server, in the items table.
 *
 * Who can do what:
 *   private item  - its owner only
 *   shared item   - everyone signed in can see and edit it; only the owner or an
 *                   admin can delete it or change whether it is shared
 *
 * Every save carries the version it was loaded at. If someone else saved in between,
 * the save is refused rather than silently overwriting their change.
 */
final class ItemStore
{
    public const KINDS = ['collection', 'environment'];

    public function __construct(private PDO $db, private int $maxBytes)
    {
    }

    public function listFor(string $kind, int $userId): array
    {
        $stmt = $this->db->prepare(
            'SELECT i.id, i.name, i.shared, i.version, i.content, i.updated_at, i.owner_id,
                    o.username AS owner, u.username AS updated_by
               FROM items i
               JOIN users o ON o.id = i.owner_id
               LEFT JOIN users u ON u.id = i.updated_by
              WHERE i.kind = ? AND (i.owner_id = ? OR i.shared = 1)
              ORDER BY i.shared, i.name'
        );
        $stmt->execute([$kind, $userId]);
        return array_map(fn ($row) => $this->present($row, $userId), $stmt->fetchAll(PDO::FETCH_ASSOC));
    }

    public function save(string $kind, int $userId, bool $isAdmin, array $data): array
    {
        $name = trim((string) ($data['name'] ?? ''));
        if ($name === '' || mb_strlen_safe($name) > 150) {
            throw new ProxyException('INVALID_REQUEST', 'Give it a name of up to 150 characters.');
        }
        $shared = !empty($data['shared']);
        $content = $data['content'] ?? null;
        if (!is_array($content)) {
            throw new ProxyException('INVALID_REQUEST', 'Missing content.');
        }
        $json = json_encode($content, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($json === false || strlen($json) > $this->maxBytes) {
            throw new ProxyException('REQUEST_TOO_LARGE', 'This is larger than the server allows (max_item_bytes).', 413);
        }

        $id = (int) ($data['id'] ?? 0);
        if ($id === 0) {
            $this->db->prepare(
                'INSERT INTO items (kind, name, owner_id, shared, content, version, updated_by)
                 VALUES (?, ?, ?, ?, ?, 1, ?)'
            )->execute([$kind, $name, $userId, $shared ? 1 : 0, $json, $userId]);
            return $this->find((int) $this->db->lastInsertId(), $userId);
        }

        $this->db->beginTransaction();
        try {
            $row = $this->lockVisible($kind, $id, $userId);
            $isOwner = (int) $row['owner_id'] === $userId;
            if ($shared !== (bool) $row['shared'] && !$isOwner && !$isAdmin) {
                throw new ProxyException('FORBIDDEN', 'Only the owner or an admin can change whether this is shared.', 403);
            }
            if ((int) ($data['version'] ?? 0) !== (int) $row['version']) {
                $by = $row['updated_by_name'] ?: 'someone else';
                throw new ProxyException('CONFLICT', "$by saved “{$row['name']}” after you loaded it. "
                    . 'Reload to get their version, then make your change again.', 409);
            }
            $this->db->prepare(
                'UPDATE items SET name = ?, shared = ?, content = ?, version = version + 1, updated_by = ?
                  WHERE id = ?'
            )->execute([$name, $shared ? 1 : 0, $json, $userId, $id]);
            $this->db->commit();
        } catch (Throwable $e) {
            if ($this->db->inTransaction()) $this->db->rollBack();
            throw $e;
        }
        return $this->find($id, $userId);
    }

    /** @return string the deleted item's name, for the activity log */
    public function delete(string $kind, int $userId, bool $isAdmin, int $id): string
    {
        $this->db->beginTransaction();
        try {
            $row = $this->lockVisible($kind, $id, $userId);
            if ((int) $row['owner_id'] !== $userId && !$isAdmin) {
                throw new ProxyException('FORBIDDEN', 'Only the owner or an admin can delete this.', 403);
            }
            $this->db->prepare('DELETE FROM items WHERE id = ?')->execute([$id]);
            $this->db->commit();
        } catch (Throwable $e) {
            if ($this->db->inTransaction()) $this->db->rollBack();
            throw $e;
        }
        return (string) $row['name'];
    }

    /** Locks a row the user may see; anything else is "not found", so ids cannot be probed. */
    private function lockVisible(string $kind, int $id, int $userId): array
    {
        $stmt = $this->db->prepare(
            'SELECT i.*, u.username AS updated_by_name
               FROM items i LEFT JOIN users u ON u.id = i.updated_by
              WHERE i.id = ? AND i.kind = ? AND (i.owner_id = ? OR i.shared = 1)
              FOR UPDATE'
        );
        $stmt->execute([$id, $kind, $userId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            throw new ProxyException('NOT_FOUND', 'Not found. It may have been deleted or made private.', 404);
        }
        return $row;
    }

    private function find(int $id, int $userId): array
    {
        $stmt = $this->db->prepare(
            'SELECT i.id, i.name, i.shared, i.version, i.content, i.updated_at, i.owner_id,
                    o.username AS owner, u.username AS updated_by
               FROM items i
               JOIN users o ON o.id = i.owner_id
               LEFT JOIN users u ON u.id = i.updated_by
              WHERE i.id = ?'
        );
        $stmt->execute([$id]);
        return $this->present($stmt->fetch(PDO::FETCH_ASSOC), $userId);
    }

    private function present(array $row, int $userId): array
    {
        $content = json_decode((string) $row['content'], true);
        return [
            'id' => (int) $row['id'],
            'name' => (string) $row['name'],
            'shared' => (bool) $row['shared'],
            'version' => (int) $row['version'],
            'owner' => (string) $row['owner'],
            'mine' => (int) $row['owner_id'] === $userId,
            'updatedBy' => $row['updated_by'] !== null ? (string) $row['updated_by'] : null,
            'updatedAt' => (string) $row['updated_at'],
            'content' => is_array($content) ? $content : [],
        ];
    }
}

function mb_strlen_safe(string $text): int
{
    return function_exists('mb_strlen') ? mb_strlen($text, 'UTF-8') : strlen($text);
}
