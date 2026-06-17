<?php
// Bulk-Edit: setzt ein Feld auf mehreren Items gleichzeitig.
// POST  { "items": ["a","b"], "field": "weight", "value": 5 }
require __DIR__ . '/_lib.php';
cors();
$config = load_config();
guard($config);

const ALLOWED = ['label','limit','can_remove','type','usable','groupId','rarityId',
                 'weight','degradation','useExpired','durability','desc'];
const INT_F = ['limit','can_remove','usable','groupId','rarityId','degradation','useExpired','durability'];

$in = body();
$items = $in['items'] ?? [];
$field = $in['field'] ?? '';
$value = $in['value'] ?? null;

if (!is_array($items) || !count($items)) send(['error'=>'keine items'],400);
if (!in_array($field, ALLOWED, true)) send(['error'=>'Feld nicht erlaubt: '.$field],400);

if (in_array($field, INT_F, true)) {
    if ($value === '' || $value === null) { if($field==='can_remove') $value=1; else $value=null; }
    elseif (!is_numeric($value)) send(['error'=>'Wert muss Zahl sein'],400);
    else $value = ($field==='can_remove'||$field==='usable') ? ((int)$value?1:0) : (int)$value;
}
if ($field === 'weight') { if(!is_numeric($value)) send(['error'=>'weight muss Zahl sein'],400); $value=(float)$value; }

try {
    $pdo = db($config);
    $ph = str_repeat('?,', count($items)-1).'?';
    $sql = "UPDATE `items` SET `$field`=? WHERE `item` IN ($ph)";
    $st = $pdo->prepare($sql);
    $st->execute(array_merge([$value], $items));
    send(['updated'=>$st->rowCount()]);
} catch (Throwable $e) { send(['error'=>$e->getMessage()],500); }
