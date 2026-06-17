<?php
// Images-Verwaltung wie oxedit:
//  GET                      -> Liste aller Bilder (Name, Größe, Maße, Hash), Gesamtgröße,
//                              fehlende Items, Duplikate (per Content-Hash), Oversized-Flag
//  POST  action=optimize    -> { names:[...], maxSize?:int, quality?:int } resize/re-encode PNG (GD)
//  POST  action=delete      -> { names:[...] } Bilder löschen
//  POST  action=analyze     -> nur Analyse (dup/oversized) ohne Änderung
require __DIR__ . '/_lib.php';
cors();
$config = load_config();

$base = rtrim($config['vorp_inventory_path'], '/\\');
$candidates = ['/html/img/items', '/html/img', '/ui/img', '/html/images', '/nui/img'];
$imgDir = null;
foreach ($candidates as $c) { if (is_dir($base.$c)) { $imgDir = $base.$c; break; } }

const OVERSIZE_PX   = 128;     // VORP Item-Icons brauchen selten mehr
const OVERSIZE_KB   = 20;      // größer = Optimierungs-Kandidat
const EXTS = ['png','jpg','jpeg','webp'];

function safe_name(string $n): string { return basename($n); }

function scan_images(string $dir): array {
    $out = [];
    foreach (scandir($dir) as $f) {
        if ($f === '.' || $f === '..') continue;
        $ext = strtolower(pathinfo($f, PATHINFO_EXTENSION));
        if (!in_array($ext, EXTS, true)) continue;
        $full = $dir.'/'.$f;
        $size = filesize($full);
        $w = $h = null;
        $info = @getimagesize($full);
        if ($info) { $w = $info[0]; $h = $info[1]; }
        $out[] = [
            'name' => $f,
            'item' => pathinfo($f, PATHINFO_FILENAME),
            'ext'  => $ext,
            'size' => $size,
            'w' => $w, 'h' => $h,
            'oversized' => ($size > OVERSIZE_KB*1024) || ($w && $w > OVERSIZE_PX) || ($h && $h > OVERSIZE_PX),
            'hash' => md5_file($full),
        ];
    }
    return $out;
}

function find_dupes(array $files): array {
    $byHash = [];
    foreach ($files as $f) { $byHash[$f['hash']][] = $f['name']; }
    $dupes = [];
    foreach ($byHash as $hash => $names) if (count($names) > 1) $dupes[] = ['hash'=>$hash, 'names'=>$names];
    return $dupes;
}

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    if (!$imgDir) send(['error'=>'Kein img-Ordner gefunden','checked'=>$candidates,'base'=>$base], 404);
    $files = scan_images($imgDir);
    $total = array_sum(array_column($files, 'size'));
    $dupes = find_dupes($files);

    // fehlende Items (DB-Items ohne Bild)
    $missing = [];
    try {
        $pdo = db($config);
        $items = $pdo->query('SELECT `item` FROM `items`')->fetchAll(PDO::FETCH_COLUMN);
        $have = array_map(fn($f)=>$f['item'], $files);
        $haveSet = array_flip($have);
        foreach ($items as $it) if (!isset($haveSet[$it])) $missing[] = $it;
    } catch (Throwable $e) {}

    send([
        'dir'       => $imgDir,
        'writable'  => is_writable($imgDir),
        'dirOwner'  => (function_exists('posix_getpwuid')) ? (@posix_getpwuid(fileowner($imgDir))['name'] ?? fileowner($imgDir)) : null,
        'webUser'   => (function_exists('posix_geteuid') && function_exists('posix_getpwuid')) ? (@posix_getpwuid(posix_geteuid())['name'] ?? null) : null,
        'count'     => count($files),
        'totalSize' => $total,
        'gdAvailable' => function_exists('imagecreatefrompng'),
        'oversizedCount' => count(array_filter($files, fn($f)=>$f['oversized'])),
        'dupes'     => $dupes,
        'missing'   => $missing,
        'images'    => $files,
    ]);
}

if ($method === 'POST') {
    guard($config);
    if (!$imgDir) send(['error'=>'Kein img-Ordner'], 404);
    $in = body();
    $action = $in['action'] ?? '';

    if ($action === 'analyze') {
        $files = scan_images($imgDir);
        send(['dupes'=>find_dupes($files), 'oversized'=>array_values(array_filter($files, fn($f)=>$f['oversized']))]);
    }

    // Vorschau: rechnet die optimierte Variante, SCHREIBT NICHT. Gibt base64 + Größen zurück.
    if ($action === 'preview') {
        if (!function_exists('imagecreatefrompng')) send(['error'=>'GD-Extension nicht installiert'], 500);
        $name = safe_name($in['name'] ?? '');
        $maxSize = (int)($in['maxSize'] ?? OVERSIZE_PX);
        $file = $imgDir.'/'.$name;
        if (!is_file($file)) send(['error'=>'nicht gefunden'], 404);
        $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));

        $src = null;
        if ($ext === 'png') $src = @imagecreatefrompng($file);
        elseif ($ext === 'jpg' || $ext === 'jpeg') $src = @imagecreatefromjpeg($file);
        elseif ($ext === 'webp' && function_exists('imagecreatefromwebp')) $src = @imagecreatefromwebp($file);
        if (!$src) send(['error'=>'konnte nicht laden'], 500);

        $w = imagesx($src); $h = imagesy($src);
        $before = filesize($file);
        $scale = min(1, $maxSize / max($w, $h));
        $nw = max(1, (int)round($w*$scale));
        $nh = max(1, (int)round($h*$scale));

        $dst = imagecreatetruecolor($nw, $nh);
        imagealphablending($dst, false);
        imagesavealpha($dst, true);
        imagefill($dst, 0, 0, imagecolorallocatealpha($dst, 0,0,0,127));
        imagecopyresampled($dst, $src, 0,0,0,0, $nw,$nh, $w,$h);

        ob_start();
        if ($ext === 'png') imagepng($dst, null, 9);
        elseif ($ext === 'jpg' || $ext === 'jpeg') imagejpeg($dst, null, 82);
        elseif ($ext === 'webp') imagewebp($dst, null, 82);
        $bin = ob_get_clean();
        imagedestroy($src); imagedestroy($dst);

        $after = strlen($bin);
        $mime = ['png'=>'image/png','jpg'=>'image/jpeg','jpeg'=>'image/jpeg','webp'=>'image/webp'][$ext] ?? 'image/png';
        send([
            'name'=>$name,
            'srcW'=>$w, 'srcH'=>$h,
            'newW'=>$nw, 'newH'=>$nh,
            'before'=>$before, 'after'=>$after,
            'savedBytes'=>max(0, $before-$after),
            'percent'=> $before>0 ? round((1-$after/$before)*100) : 0,
            'dataUrl'=>"data:$mime;base64,".base64_encode($bin),
        ]);
    }

    if ($action === 'delete') {
        $names = $in['names'] ?? [];
        if (!is_array($names) || !$names) send(['error'=>'keine names'], 400);
        $deleted = 0;
        foreach ($names as $n) {
            $f = $imgDir.'/'.safe_name($n);
            if (is_file($f) && @unlink($f)) $deleted++;
        }
        send(['deleted'=>$deleted]);
    }

    if ($action === 'optimize') {
        if (!function_exists('imagecreatefrompng')) send(['error'=>'GD-Extension nicht installiert. Server-seitiges Optimieren nicht möglich.'], 500);
        $names = $in['names'] ?? [];
        $maxSize = (int)($in['maxSize'] ?? OVERSIZE_PX);   // Zielkante in px
        if ($maxSize < 16) $maxSize = 128;
        if (!is_array($names) || !$names) send(['error'=>'keine names'], 400);

        // Schreibrechte vorab prüfen – häufigste Ursache für "0 KB gespart"
        if (!is_writable($imgDir)) {
            $owner = function_exists('posix_getpwuid') ? @posix_getpwuid(fileowner($imgDir)) : null;
            send([
                'error' => "Ordner nicht beschreibbar für den Webserver-User: $imgDir",
                'hint'  => "Der PHP-Prozess (oft 'www-data') darf nicht in den Ordner schreiben. Fix: chown/chmod, z.B.  sudo chmod -R 775 \"$imgDir\"  und den Webserver-User in die Gruppe des Ordner-Owners aufnehmen.",
                'dirOwner' => $owner['name'] ?? fileowner($imgDir),
                'webserverUser' => function_exists('posix_getpwuid') ? (@posix_getpwuid(posix_geteuid())['name'] ?? '?') : get_current_user(),
            ], 403);
        }

        $results = [];
        foreach ($names as $n) {
            $name = safe_name($n);
            $file = $imgDir.'/'.$name;
            if (!is_file($file)) { $results[] = ['name'=>$name,'ok'=>false,'msg'=>'nicht gefunden']; continue; }
            if (!is_writable($file)) { $results[] = ['name'=>$name,'ok'=>false,'msg'=>'Datei nicht beschreibbar (Rechte)']; continue; }
            $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));

            $before = filesize($file);
            $src = null;
            if ($ext === 'png') $src = @imagecreatefrompng($file);
            elseif ($ext === 'jpg' || $ext === 'jpeg') $src = @imagecreatefromjpeg($file);
            elseif ($ext === 'webp' && function_exists('imagecreatefromwebp')) $src = @imagecreatefromwebp($file);
            if (!$src) { $results[] = ['name'=>$name,'ok'=>false,'msg'=>'konnte nicht laden']; continue; }

            $w = imagesx($src); $h = imagesy($src);
            $scale = min(1, $maxSize / max($w, $h));
            $nw = max(1, (int)round($w*$scale));
            $nh = max(1, (int)round($h*$scale));

            $dst = imagecreatetruecolor($nw, $nh);
            // Transparenz erhalten
            imagealphablending($dst, false);
            imagesavealpha($dst, true);
            imagefill($dst, 0, 0, imagecolorallocatealpha($dst, 0,0,0,127));
            imagecopyresampled($dst, $src, 0,0,0,0, $nw,$nh, $w,$h);

            // PNG neu schreiben (komprimiert)
            $tmp = $file.'.tmp';
            $ok = false;
            if ($ext === 'png') $ok = @imagepng($dst, $tmp, 9);
            elseif ($ext === 'jpg' || $ext === 'jpeg') $ok = @imagejpeg($dst, $tmp, 82);
            elseif ($ext === 'webp') $ok = @imagewebp($dst, $tmp, 82);
            imagedestroy($src); imagedestroy($dst);

            if ($ok && is_file($tmp)) {
                $after = filesize($tmp);
                // nur ersetzen wenn kleiner geworden
                if ($after < $before) {
                    if (@rename($tmp, $file)) { $results[] = ['name'=>$name,'ok'=>true,'before'=>$before,'after'=>$after,'w'=>$nw,'h'=>$nh]; }
                    else { @unlink($tmp); $results[] = ['name'=>$name,'ok'=>false,'msg'=>'rename fehlgeschlagen (Rechte)']; }
                }
                else { @unlink($tmp); $results[] = ['name'=>$name,'ok'=>true,'skipped'=>true,'before'=>$before,'after'=>$before]; }
            } else { @unlink($tmp); $results[] = ['name'=>$name,'ok'=>false,'msg'=>'encode/schreiben fehlgeschlagen (Rechte?)']; }
        }
        $savedBytes = array_sum(array_map(fn($r)=>($r['ok'] && !empty($r['before'])) ? ($r['before']-$r['after']) : 0, $results));
        send(['results'=>$results, 'savedBytes'=>$savedBytes]);
    }

    send(['error'=>'unbekannte action'], 400);
}

send(['error'=>'Methode nicht erlaubt'], 405);
