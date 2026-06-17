<?php
// Fügt Waffen-Komponenten als Items in die `items`-Tabelle ein.
// COMPONENT_ Einträge müssen als Items existieren, damit man sie im Inventar
// haben und auf die Waffe legen kann.
//
// POST  preview  { components:[...] }          -> SQL-Vorschau (schreibt nicht)
// POST  insert   { components:[...] }           -> fügt fehlende als Items ein
//
// Erwartet die COMPONENT-Namen als Array (vom Frontend aus dem nested-Lua extrahiert).

require __DIR__ . '/_lib.php';
cors();
$config = load_config();
guard($config);

$in = body();
$action = $in['action'] ?? 'preview';
$components = $in['components'] ?? [];
if (!is_array($components)) send(['error'=>'components Array fehlt'], 400);

// säubern: nur gültige COMPONENT_ Namen, dedupe
$clean = [];
foreach ($components as $c) {
    $c = trim((string)$c);
    if ($c !== '' && preg_match('/^COMPONENT_[A-Z0-9_]+$/i', $c)) $clean[$c] = true;
}
$names = array_keys($clean);
if (!$names) send(['error'=>'keine gültigen COMPONENT-Namen'], 400);

// Default-Werte für ein Component-Item
function comp_label(string $name): string {
    // COMPONENT_REVOLVER_CATTLEMAN_BARREL_LONG -> "Barrel Long" o.ä. (lesbar machen)
    $s = preg_replace('/^COMPONENT_/', '', $name);
    $s = str_replace('_', ' ', strtolower($s));
    return ucwords($s);
}

try {
    $pdo = db($config);

    // echte Breite der item-Spalte ermitteln
    $colLen = 50;
    try {
        $col = $pdo->query("SHOW COLUMNS FROM `items` LIKE 'item'")->fetch();
        if ($col && preg_match('/varchar\((\d+)\)/i', $col['Type'], $cm)) $colLen = (int)$cm[1];
    } catch (Throwable $e) {}

    // zu lange Namen rausfiltern (würden sonst truncaten)
    $tooLong = array_values(array_filter($names, fn($n)=>strlen($n) > $colLen));
    $fit = array_values(array_filter($names, fn($n)=>strlen($n) <= $colLen));

    // welche existieren schon? (nur die, die reinpassen)
    $existing = [];
    if ($fit) {
        $ph = str_repeat('?,', count($fit)-1).'?';
        $stmt = $pdo->prepare("SELECT `item` FROM `items` WHERE `item` IN ($ph)");
        $stmt->execute($fit);
        $existing = array_flip($stmt->fetchAll(PDO::FETCH_COLUMN));
    }
    $missing = array_values(array_filter($fit, fn($n)=>!isset($existing[$n])));

    if ($action === 'preview') {
        $sql = "-- " . count($names) . " Components · " . count($existing) . " vorhanden · " . count($missing) . " fehlen\n";
        if ($tooLong) {
            $sql .= "-- ⚠ " . count($tooLong) . " Namen sind länger als die item-Spalte (varchar($colLen)) und werden ÜBERSPRUNGEN:\n";
            foreach ($tooLong as $t) $sql .= "--   $t (" . strlen($t) . " Zeichen)\n";
            $sql .= "-- Fix: ALTER TABLE `items` MODIFY `item` VARCHAR(64) NOT NULL;\n";
        }
        if (!$missing) { $sql .= "-- Alle passenden Components sind bereits als Items vorhanden.\n"; }
        else {
            $nextId = (int)$pdo->query('SELECT COALESCE(MAX(`id`),0)+1 n FROM `items`')->fetch()['n'];
            foreach ($missing as $i => $name) {
                $label = comp_label($name);
                $id = $nextId + $i;
                $sql .= sprintf(
                    "INSERT INTO `items` (`item`,`label`,`limit`,`can_remove`,`type`,`usable`,`groupId`,`rarityId`,`metadata`,`desc`,`weight`,`id`)\n  VALUES ('%s','%s',1,1,'item_standard',0,1,1,'{}','Weapon component',0.10,%d);\n",
                    $name, str_replace("'", "''", $label), $id
                );
            }
        }
        send(['total'=>count($names), 'existing'=>count($existing), 'missing'=>count($missing), 'missingNames'=>$missing, 'tooLong'=>$tooLong, 'colLen'=>$colLen, 'sql'=>$sql]);
    }

    if ($action === 'insert') {
        if (!$missing) send(['inserted'=>0, 'tooLong'=>$tooLong, 'colLen'=>$colLen, 'msg'=>'Alle passenden Components bereits vorhanden']);
        $nextId = (int)$pdo->query('SELECT COALESCE(MAX(`id`),0)+1 n FROM `items`')->fetch()['n'];
        $ins = $pdo->prepare("INSERT INTO `items`
            (`item`,`label`,`limit`,`can_remove`,`type`,`usable`,`groupId`,`rarityId`,`metadata`,`desc`,`weight`,`id`)
            VALUES (?,?,1,1,'item_standard',0,1,1,'{}','Weapon component',0.10,?)");
        $pdo->beginTransaction();
        $count = 0;
        foreach ($missing as $i => $name) {
            $ins->execute([$name, comp_label($name), $nextId + $i]);
            $count++;
        }
        $pdo->commit();
        send(['inserted'=>$count, 'skipped'=>count($existing), 'tooLong'=>$tooLong, 'colLen'=>$colLen]);
    }

    send(['error'=>'unbekannte action'], 400);
} catch (Throwable $e) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    send(['error'=>$e->getMessage()], 500);
}
