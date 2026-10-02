<?php
declare(strict_types=1);

// Template only. The file actually loaded by api.php/proxy.php lives at
// /var/www/html/private/config.php on the server, outside the API_WORKBENCH folder.
// It is the same file devhub uses: API Workbench keeps its tables in devhub's database.
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
