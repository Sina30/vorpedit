<?php
require __DIR__ . '/_lib.php';
cors();
$config = load_config();

$out = ['ok' => false];

// DB-Check
try {
    $pdo = db($config);
    $pdo->query('SELECT 1');
    $out['ok'] = true;
    $out['items'] = (int)$pdo->query('SELECT COUNT(*) c FROM `items`')->fetch()['c'];
} catch (Throwable $e) {
    $out['ok'] = false;
    $out['error'] = $e->getMessage();
}

// Diagnose: vorp_inventory Pfad + Bilder-Ordner + Schreibrechte
$base = rtrim($config['vorp_inventory_path'] ?? '', '/\\');
$out['vorp_path'] = $base;
$out['vorp_path_exists'] = is_dir($base);

$candidates = ['/html/img/items', '/html/img', '/ui/img', '/html/images', '/nui/img'];
$imgDir = null;
foreach ($candidates as $c) { if (is_dir($base.$c)) { $imgDir = $base.$c; break; } }
$out['img_dir'] = $imgDir;
$out['img_dir_writable'] = $imgDir ? is_writable($imgDir) : false;

// weapons.lua
$wpath = $base . '/config/weapons.lua';
$out['weapons_exists'] = is_file($wpath);
$out['weapons_writable'] = is_file($wpath) ? is_writable($wpath) : (is_dir(dirname($wpath)) ? is_writable(dirname($wpath)) : false);

// GD
$out['gd'] = function_exists('imagecreatefrompng');

// Wer ist der Webserver-User, wem gehört der Ordner?
if (function_exists('posix_geteuid') && function_exists('posix_getpwuid')) {
    $out['webserver_user'] = @posix_getpwuid(posix_geteuid())['name'] ?? '?';
    if ($imgDir) $out['img_dir_owner'] = @posix_getpwuid(fileowner($imgDir))['name'] ?? fileowner($imgDir);
}

send($out, $out['ok'] ? 200 : 500);
