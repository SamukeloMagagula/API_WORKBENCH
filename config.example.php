<?php
declare(strict_types=1);

// Template only. Copy it to config.php in this folder (/var/www/html/API_WORKBENCH/config.php
// on the server) and fill in the real details. config.php is gitignored and .htaccess denies
// it to browsers. The tables live in devhub's database, so these match devhub's config.
const DB_HOST = 'localhost';
const DB_USER = 'samukelo.magagula';
const DB_PASS = '';
const DB_NAME = 'devhub';

function connect(): PDO
{
    $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4';
    return new PDO($dsn, DB_USER, DB_PASS, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
}
