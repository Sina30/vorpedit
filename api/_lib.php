<?php
// Gemeinsame Helfer für alle API-Endpoints.

function load_config(): array {
    return require __DIR__ . '/../config.php';
}

function db(array $config): PDO {
    $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
        $config['db_host'], $config['db_port'], $config['db_name']);
    return new PDO($dsn, $config['db_user'], $config['db_pass'], [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
}

function cors(): void {
    header('Content-Type: application/json; charset=utf-8');
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, x-edit-token');
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
}

function body(): array {
    $raw = file_get_contents('php://input');
    if ($raw === '' || $raw === false) return [];
    $d = json_decode($raw, true);
    return is_array($d) ? $d : [];
}

function send($data, int $code = 200): void {
    http_response_code($code);
    echo json_encode($data);
    exit;
}

function guard(array $config): void {
    $token = $config['edit_token'] ?? '';
    if ($token === '') return;
    $sent = $_SERVER['HTTP_X_EDIT_TOKEN'] ?? '';
    if (!hash_equals($token, $sent)) send(['error' => 'Ungültiger oder fehlender x-edit-token'], 401);
}
