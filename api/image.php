<?php
// Liefert eine einzelne Bilddatei aus dem items-Ordner aus.
// ?name=apple.png
require __DIR__ . '/_lib.php';
$config = load_config();

$base = rtrim($config['vorp_inventory_path'], '/\\');
$candidates = ['/html/img/items', '/html/img', '/ui/img', '/html/images', '/nui/img'];
$imgDir = null;
foreach ($candidates as $c) { if (is_dir($base.$c)) { $imgDir = $base.$c; break; } }

$name = $_GET['name'] ?? '';
// Path-Traversal hart blocken
$name = basename($name);
if ($name === '' || !$imgDir) { http_response_code(404); exit; }

$file = $imgDir.'/'.$name;
if (!is_file($file)) { http_response_code(404); exit; }

$ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
$mime = ['png'=>'image/png','jpg'=>'image/jpeg','jpeg'=>'image/jpeg','webp'=>'image/webp'][$ext] ?? 'application/octet-stream';
header('Content-Type: '.$mime);
header('Cache-Control: max-age=3600');
readfile($file);
