-- API Workbench's own database. Needed unless APIWB_AUTH=none.
-- Builds everything from scratch, and brings an existing database up to date: every
-- statement is additive and safe to run more than once. Take a dump first regardless.
--
--   sudo mariadb < schema.sql
--
-- Then create a database user for the app (see README) and put its details in config.php.

CREATE DATABASE IF NOT EXISTS apiworkbench CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE apiworkbench;

-- Accounts. Usernames are email addresses. The first account created is made an
-- admin, so a fresh install always has one (APIWB_OWNER can also name one).
CREATE TABLE IF NOT EXISTS users (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    username   VARCHAR(60)  NOT NULL UNIQUE,
    password   VARCHAR(255) NOT NULL,
    is_admin   TINYINT(1)   NOT NULL DEFAULT 0,
    -- A disabled account cannot sign in, and is refused on its next request if it already has.
    disabled   TINYINT(1)   NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Added after the first release; a no-op where the column already exists.
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled TINYINT(1) NOT NULL DEFAULT 0 AFTER is_admin;

-- One-time password reset links, issued by an admin and handed over directly (there is
-- no email). Stored as a SHA-256: a leaked table yields no usable links. A plain hash is
-- right rather than password_hash() because the token is 256 random bits, not a guessable
-- secret. Issuing a new link spends any outstanding one for that user.
CREATE TABLE IF NOT EXISTS password_resets (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    user_id    INT NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE,
    issued_by  VARCHAR(60) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    used_at    DATETIME NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX (user_id, used_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Failed sign-ins, for rate limiting. Rows are pruned opportunistically by
-- auth.php, so this needs no scheduled cleanup.
CREATE TABLE IF NOT EXISTS login_attempts (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    username     VARCHAR(60) NOT NULL,
    ip           VARCHAR(45) NOT NULL,
    attempted_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX (attempted_at),
    INDEX (username, attempted_at),
    INDEX (ip, attempted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Who did what: sign-ins, every proxied call (method and URL, no query string),
-- and every save or delete of a collection or environment.
CREATE TABLE IF NOT EXISTS activity_log (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    username   VARCHAR(60) NOT NULL,
    action     VARCHAR(40) NOT NULL,
    detail     TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX (created_at),
    INDEX (username, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- For the admin log's action filter. Separate so existing databases get it too.
CREATE INDEX IF NOT EXISTS activity_action ON activity_log (action, created_at);

-- Collections of saved requests, environments of variables, and API designs.
CREATE TABLE IF NOT EXISTS items (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    kind       ENUM('collection','environment','design') NOT NULL,
    name       VARCHAR(150) NOT NULL,
    owner_id   INT NOT NULL,
    -- 0: only the owner sees it. 1: everyone signed in sees and edits it.
    shared     TINYINT(1) NOT NULL DEFAULT 0,
    -- The collection's requests, the environment's variables, or the API design, as JSON.
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

-- 'design' was added after the first release. Restating the full list is idempotent,
-- and widening an ENUM leaves existing rows as they are.
ALTER TABLE items MODIFY kind ENUM('collection','environment','design') NOT NULL;
