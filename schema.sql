-- API Workbench tables, created inside devhub's database (they reference devhub's users).
-- Needed unless APIWB_AUTH=none. Safe to run more than once.
--
--   mariadb devhub < schema.sql
--
-- Take a dump first regardless. DDL is not transactional in MariaDB.

CREATE TABLE IF NOT EXISTS apiwb_items (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    kind       ENUM('collection','environment') NOT NULL,
    name       VARCHAR(150) NOT NULL,
    owner_id   INT NOT NULL,
    -- 0: only the owner sees it. 1: everyone signed in sees and edits it.
    shared     TINYINT(1) NOT NULL DEFAULT 0,
    -- The collection's requests or the environment's variables, as JSON.
    content    LONGTEXT NOT NULL,
    -- Bumped on every save. A save naming an older version is refused, so two
    -- people editing the same shared item cannot silently overwrite each other.
    version    INT NOT NULL DEFAULT 1,
    updated_by INT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id)   REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX (kind, shared),
    INDEX (kind, owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
