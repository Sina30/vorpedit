<?php
// Liest & schreibt vorp_inventory/config/weapons.lua  (VORP / SHARED_DATA.WEAPONS Format)
//
// Ansatz: Brace-Matching statt platter Regex.
// - Findet den SHARED_DATA.WEAPONS = { ... } Block
// - Splittet ihn in WEAPON_xxx = { ... } Einträge (per Klammer-Zählung)
// - Liest pro Waffe nur die EINFACHEN Top-Level-Felder (Name, Desc, Weight, HashName,
//   AttachPoint, DefaultClipSize, AnimReloadRate, ShortWeapon, LongWeapon, IsThrowable,
//   NoAmmo, NoSerialNumber, NoDegradation ...) als editierbar aus.
// - Verschachtelte Felder (Components = {...}) werden als ROH-Lua erhalten und beim
//   Speichern unverändert zurückgeschrieben -> nichts geht kaputt.

require __DIR__ . '/_lib.php';
cors();
$config = load_config();

$path = rtrim($config['vorp_inventory_path'], '/\\') . '/config/weapons.lua';

// ---------------------------------------------------------------------------
// Hilfsfunktionen Brace-Matching
// ---------------------------------------------------------------------------

// Findet die Position des passenden schließenden } ab Position $open (zeigt auf '{').
// Beachtet Strings und Lua-Kommentare grob.
function match_brace(string $s, int $open): int {
    $depth = 0; $n = strlen($s); $inStr = false; $q = '';
    for ($i = $open; $i < $n; $i++) {
        $c = $s[$i];
        if ($inStr) {
            if ($c === '\\') { $i++; continue; }
            if ($c === $q) $inStr = false;
            continue;
        }
        if ($c === '"' || $c === "'") { $inStr = true; $q = $c; continue; }
        // Block-Kommentar --[[ ... ]]  (kann { } enthalten!)
        if ($c === '-' && substr($s, $i, 4) === '--[[') {
            $end = strpos($s, ']]', $i + 4);
            $i = ($end === false) ? $n - 1 : $end + 1;
            continue;
        }
        // Zeilenkommentar  --
        if ($c === '-' && $i+1 < $n && $s[$i+1] === '-') {
            $nl = strpos($s, "\n", $i);
            $i = ($nl === false) ? $n : $nl;
            continue;
        }
        if ($c === '{') $depth++;
        elseif ($c === '}') { $depth--; if ($depth === 0) return $i; }
    }
    return -1;
}

// Entfernt Lua-Zeilenkommentare aus einem kurzen Schnipsel (für Wert-Parsing).
function strip_comment(string $line): string {
    $inStr = false; $q = ''; $n = strlen($line);
    for ($i = 0; $i < $n; $i++) {
        $c = $line[$i];
        if ($inStr) { if ($c === '\\'){$i++;continue;} if ($c === $q) $inStr=false; continue; }
        if ($c === '"' || $c === "'") { $inStr = true; $q = $c; continue; }
        if ($c === '-' && $i+1 < $n && $line[$i+1] === '-') return substr($line, 0, $i);
    }
    return $line;
}

function lua_scalar($raw) {
    $raw = trim($raw);
    if ($raw === 'true') return true;
    if ($raw === 'false') return false;
    if (is_numeric($raw)) return $raw + 0;
    if (strlen($raw) >= 2 && ($raw[0] === '"' || $raw[0] === "'")) {
        return substr($raw, 1, -1);
    }
    return $raw;
}

// Parst die simplen Top-Level scalar-Felder eines Waffen-Body (ohne nested tables).
// Gibt [scalars(assoc), rawNested(string mit den nested-Feldern als Lua)] zurück.
function parse_weapon_body(string $body): array {
    $scalars = [];
    $nestedRaw = '';     // roher Lua-Text der verschachtelten Felder (z.B. Components = {...})
    $n = strlen($body); $i = 0;
    while ($i < $n) {
        // key suchen:  KEY =
        if (!preg_match('/\G\s*([A-Za-z_]\w*)\s*=\s*/', $body, $m, 0, $i)) {
            // nichts mehr -> raus
            break;
        }
        $key = $m[1];
        $i += strlen($m[0]);
        if ($i >= $n) break;
        if ($body[$i] === '{') {
            // nested table -> roh erhalten
            $close = match_brace($body, $i);
            if ($close === -1) break;
            $raw = substr($body, $i, $close - $i + 1);
            $nestedRaw .= "        $key = $raw,\n";
            $i = $close + 1;
            // trailing Komma/whitespace überspringen
            while ($i < $n && (ctype_space($body[$i]) || $body[$i] === ',')) $i++;
        } else {
            // scalar bis Zeilenende oder Komma
            $nl = strpos($body, "\n", $i);
            $seg = substr($body, $i, ($nl === false ? $n : $nl) - $i);
            $seg = strip_comment($seg);
            $seg = rtrim($seg);
            $seg = rtrim($seg, ',');
            $scalars[$key] = lua_scalar($seg);
            $i = ($nl === false) ? $n : $nl + 1;
        }
    }
    return [$scalars, $nestedRaw];
}

function parse_weapons(string $lua): array {
    // Block SHARED_DATA.WEAPONS = { ... } finden
    if (!preg_match('/SHARED_DATA\.WEAPONS\s*=\s*\{/', $lua, $m, PREG_OFFSET_CAPTURE)) return [];
    $open = strpos($lua, '{', $m[0][1]);
    $close = match_brace($lua, $open);
    if ($close === -1) return [];
    $inner = substr($lua, $open + 1, $close - $open - 1);

    $weapons = [];
    $n = strlen($inner); $i = 0;
    while ($i < $n) {
        // WEAPON_xxx = {
        if (!preg_match('/\G\s*([A-Za-z_]\w*)\s*=\s*\{/', $inner, $mm, 0, $i)) {
            // weiter zum nächsten möglichen key
            $next = preg_match('/[A-Za-z_]\w*\s*=\s*\{/', $inner, $mt, PREG_OFFSET_CAPTURE, $i);
            if (!$next) break;
            $i = $mt[0][1];
            continue;
        }
        $wkey = $mm[1];
        $bodyOpen = $i + strlen($mm[0]) - 1; // zeigt auf '{'
        $bodyClose = match_brace($inner, $bodyOpen);
        if ($bodyClose === -1) break;
        $body = substr($inner, $bodyOpen + 1, $bodyClose - $bodyOpen - 1);
        [$scalars, $nestedRaw] = parse_weapon_body($body);
        $weapons[] = [
            'key'     => $wkey,
            'scalars' => $scalars,
            'nested'  => $nestedRaw,         // roh, read-only
            'hasNested' => $nestedRaw !== '',
        ];
        $i = $bodyClose + 1;
        while ($i < $n && (ctype_space($inner[$i]) || $inner[$i] === ',')) $i++;
    }
    return $weapons;
}

// ---------------------------------------------------------------------------
// Schreiben
// ---------------------------------------------------------------------------
function lua_val($v): string {
    if (is_bool($v)) return $v ? 'true' : 'false';
    if (is_int($v) || is_float($v)) return (string)$v;
    if (is_numeric($v)) return (string)$v;
    return '"' . str_replace('"', '\\"', (string)$v) . '"';
}

function build_weapons(array $weapons): string {
    $s = "SHARED_DATA = SHARED_DATA or {}\n\nSHARED_DATA.WEAPONS = {\n";
    foreach ($weapons as $w) {
        $key = $w['key'];
        $s .= "    $key = {\n";
        foreach (($w['scalars'] ?? []) as $k => $v) {
            $s .= "        $k = " . lua_val($v) . ",\n";
        }
        if (!empty($w['nested'])) {
            $s .= $w['nested'];   // roh erhalten (endet bereits mit ,\n pro Block)
        }
        $s .= "    },\n";
    }
    $s .= "}\n";
    return $s;
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------
$m = $_SERVER['REQUEST_METHOD'];

if ($m === 'GET') {
    if (!is_file($path)) send(['error' => "weapons.lua nicht gefunden: $path", 'path' => $path], 404);
    $lua = file_get_contents($path);
    $weapons = parse_weapons($lua);
    send(['path' => $path, 'count' => count($weapons), 'weapons' => $weapons]);
}

if ($m === 'PUT') {
    guard($config);
    $in = body();
    $weapons = $in['weapons'] ?? null;
    if (!is_array($weapons)) send(['error' => 'weapons Array fehlt'], 400);
    if (!is_writable(dirname($path)) && !is_writable($path)) send(['error' => "Nicht beschreibbar: $path"], 500);
    if (is_file($path)) @copy($path, $path . '.bak');
    $ok = file_put_contents($path, build_weapons($weapons));
    if ($ok === false) send(['error' => 'Schreiben fehlgeschlagen'], 500);
    send(['saved' => true, 'count' => count($weapons), 'backup' => basename($path) . '.bak']);
}

send(['error' => 'Methode nicht erlaubt'], 405);
