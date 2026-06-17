<?php
require __DIR__ . '/_lib.php';
cors();
$config = load_config();

try { $pdo = db($config); }
catch (Throwable $e) { send(['error' => 'DB: ' . $e->getMessage()], 500); }

// Echte DB-Spalten (aus deinem Dump). Nur diese werden geschrieben.
const COLS = ['label','limit','can_remove','type','usable','groupId','rarityId',
              'metadata','desc','weight','degradation','useExpired','durability','instructions'];
const INT_FIELDS = ['limit','can_remove','usable','groupId','rarityId','degradation','useExpired','durability'];

// oxedit-Felder die es in VORP nicht als Spalte gibt -> wandern in metadata.
const META_FIELDS = ['stack','close','consume','allowArmed','image','usetime','export',
                     'event','notification','cancel','anim_dict','anim_clip','prop','status','decay'];

function clean(array $in, bool $isInsert): array {
    $f = []; $errors = [];
    foreach (COLS as $k) {
        if (!array_key_exists($k, $in)) continue;
        $v = $in[$k];
        if ($v === '') $v = null;
        if (in_array($k, INT_FIELDS, true)) {
            if ($v === null) { if ($k === 'can_remove') $v = 1; }
            elseif (!is_numeric($v)) { $errors[] = "$k muss Zahl sein"; continue; }
            else { $v = ($k==='can_remove'||$k==='usable') ? ((int)$v?1:0) : (int)$v; }
        }
        if ($k === 'weight') { if (!is_numeric($v)) {$errors[]='weight muss Zahl sein';continue;} $v=(float)$v; }
        if ($k === 'metadata') {
            if ($v === null || $v === '') $v = '{}';
            json_decode($v); if (json_last_error()!==JSON_ERROR_NONE){$errors[]='metadata kein JSON';continue;}
        }
        $f[$k] = $v;
    }

    // oxedit-only Felder in metadata mergen
    $meta = [];
    if (isset($f['metadata'])) { $tmp = json_decode($f['metadata'], true); if (is_array($tmp)) $meta = $tmp; }
    $touched = false;
    foreach (META_FIELDS as $mk) {
        if (array_key_exists($mk, $in)) {
            $mv = $in[$mk];
            if ($mv === '' || $mv === null) { unset($meta[$mk]); }
            else $meta[$mk] = $mv;
            $touched = true;
        }
    }
    if ($touched) $f['metadata'] = json_encode($meta, JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);

    if ($isInsert) {
        if (empty($in['item']) || trim((string)$in['item'])==='') $errors[]='item fehlt';
        $f['label']      ??= $in['item'] ?? '';
        $f['metadata']   ??= '{}';
        $f['can_remove'] ??= 1;
        $f['weight']     ??= 0.25;
        $f['desc']       ??= 'nice item';
        $f['limit']      ??= 1;
        $f['type']       ??= 'item_standard';
    }
    return [$f, $errors];
}

$m = $_SERVER['REQUEST_METHOD'];
$item = isset($_GET['item']) ? (string)$_GET['item'] : null;

try {
    if ($m === 'GET') {
        if ($item !== null) {
            $s = $pdo->prepare('SELECT * FROM `items` WHERE `item`=?'); $s->execute([$item]);
            $r = $s->fetch(); if(!$r) send(['error'=>'nicht gefunden'],404); send($r);
        }
        send($pdo->query('SELECT * FROM `items` ORDER BY `item` ASC')->fetchAll());
    }

    if ($m === 'POST') {
        guard($config); $in = body(); [$f,$e] = clean($in,true);
        if ($e) send(['error'=>implode(', ',$e)],400);
        $name = trim((string)$in['item']);
        $c=$pdo->prepare('SELECT `item` FROM `items` WHERE `item`=?'); $c->execute([$name]);
        if ($c->fetch()) send(['error'=>'Item existiert bereits'],409);
        $nextId=(int)$pdo->query('SELECT COALESCE(MAX(`id`),0)+1 n FROM `items`')->fetch()['n'];
        $cols=array_merge(['item','id'],array_keys($f));
        $vals=array_merge([$name,$nextId],array_values($f));
        $cs=implode(',',array_map(fn($c)=>"`$c`",$cols));
        $ph=implode(',',array_fill(0,count($cols),'?'));
        $pdo->prepare("INSERT INTO `items` ($cs) VALUES ($ph)")->execute($vals);
        $s=$pdo->prepare('SELECT * FROM `items` WHERE `item`=?'); $s->execute([$name]); send($s->fetch(),201);
    }

    if ($m === 'PUT') {
        guard($config); if($item===null) send(['error'=>'item fehlt'],400);
        $in=body(); [$f,$e]=clean($in,false);
        if ($e) send(['error'=>implode(', ',$e)],400);
        if (!$f) send(['error'=>'nichts zu ändern'],400);
        $set=implode(',',array_map(fn($c)=>"`$c`=?",array_keys($f)));
        $vals=array_merge(array_values($f),[$item]);
        $st=$pdo->prepare("UPDATE `items` SET $set WHERE `item`=?"); $st->execute($vals);
        $s=$pdo->prepare('SELECT * FROM `items` WHERE `item`=?'); $s->execute([$item]);
        $r=$s->fetch(); if(!$r) send(['error'=>'nicht gefunden'],404); send($r);
    }

    if ($m === 'DELETE') {
        guard($config); if($item===null) send(['error'=>'item fehlt'],400);
        // Bulk: ?item=a,b,c
        $names = explode(',', $item);
        $in=str_repeat('?,',count($names)-1).'?';
        $st=$pdo->prepare("DELETE FROM `items` WHERE `item` IN ($in)"); $st->execute($names);
        send(['deleted'=>$st->rowCount()]);
    }

    send(['error'=>'Methode nicht erlaubt'],405);
} catch (Throwable $e) { send(['error'=>$e->getMessage()],500); }
