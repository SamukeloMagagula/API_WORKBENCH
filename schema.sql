-- API Workbench's own database. Needed unless APIWB_AUTH=none.
-- Builds everything from scratch and is safe to run more than once:
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

-- Collections of saved requests, and environments of variables.
CREATE TABLE IF NOT EXISTS items (
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
