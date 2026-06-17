# VORP Edit

*Sprache: [English](README.md) · [Deutsch](README.de.md)*

Ein kostenloser, browserbasierter Editor für **VORP** (RedM) Inventar-Daten — inspiriert von [oxEdit](https://github.com/Arius-Scripts/oxedit), aber für VORP statt ox_inventory gebaut.

Er verbindet sich direkt mit deiner VORP MySQL/MariaDB-Datenbank und mit deinen `vorp_inventory` Resource-Dateien. So verwaltest du Items, Waffen und Item-Icons über eine Web-Oberfläche, statt SQL und Lua von Hand zu bearbeiten.

---

## Funktionen

**Items** (aus der `items` Datenbank-Tabelle)
- Volle Bearbeitungsmaske: label, weight, type, limit, group/rarity, degradation, durability, description, metadata und mehr
- Item-Icons werden direkt angezeigt
- Mehrfachauswahl + Bulk-Edit: ein Feld bei vielen Items auf einmal setzen
- Duplikat-Erkennung (Items mit gleichem label bekommen ein `dup`-Badge)
- Live-Vorschau des aktuellen Items als **Lua / SQL / JSON**, mit Kopieren-Button
- Items anlegen, bearbeiten und löschen

**Weapons** (aus `vorp_inventory/config/weapons.lua`)
- Liest und schreibt das VORP `SHARED_DATA.WEAPONS` Format
- Bearbeitet die einfachen Felder (Name, Desc, Weight, HashName, Flags, usw.)
- Verschachtelte `Components`-Tabellen werden read-only angezeigt und beim Speichern unverändert erhalten (nichts geht kaputt)
- Vor jedem Speichern wird automatisch ein Backup (`weapons.lua.bak`) angelegt
- Live-**Lua**-Vorschau der aktuellen Waffe
- **Components → SQL** Tab: erzeugt `INSERT`-Statements, damit jede Waffen-Komponente als Item in der Datenbank existiert, und fügt fehlende mit einem Klick ein (nötig, wenn man Komponenten aus dem Inventar auf die Waffe legen können soll)

**Images** (aus `vorp_inventory/html/img/items`)
- Galerie aller Item-Icons mit Gesamtgröße und Live-Suche
- **Analysieren**: findet doppelte Bilder (per Content-Hash) und zu große
- **Optimieren**: PNGs verkleinern + neu encodieren, mit Vorher/Nachher-Vorschau-Dialog (Transparenz bleibt, ersetzt nur wenn kleiner)
- Mehrfach optimieren / löschen
- Zeigt, welche Datenbank-Items kein Icon haben

---

## Voraussetzungen

- Ein Webserver mit **PHP 7.4+** (8.x empfohlen) und der **`pdo_mysql`** Extension
- Die **GD** Extension (`php-gd`) — nur für den Bild-Optimierer nötig; alles andere geht auch ohne
- Deine VORP-Datenbank (MySQL/MariaDB)
- Der Webserver muss deinen `vorp_inventory` Ordner **lesen** können (und **schreiben**, wenn du Waffen speichern oder Bilder optimieren willst)

Am einfachsten ist ein Webserver auf **derselben Maschine** wie dein RedM-Server, damit er sowohl die Datenbank als auch die Resource-Dateien erreicht.

---

## Installation

### 1. Dateien ins Web-Verzeichnis kopieren

Alles in einen Ordner legen, den dein Webserver ausliefert (z.B. `htdocs/vorpedit/`, `/var/www/html/vorpedit/`). Genau diese Struktur einhalten:

```
vorpedit/
├── index.html
├── app.js
├── config.php          <- hier alle Einstellungen
└── api/
    ├── _lib.php
    ├── health.php
    ├── items.php
    ├── bulk.php
    ├── weapons.php
    ├── components.php
    ├── images.php
    └── image.php
```

> **Wichtig:** Die acht PHP-Dateien müssen im `api/` Unterordner bleiben und ihre `.php` Endung behalten. (Manche Download-Tools schneiden Endungen ab — bei 404-Fehlern ist das meist die Ursache.)

### 2. `config.php` ausfüllen

```php
<?php
return [
    'db_host' => '127.0.0.1',
    'db_port' => 3306,
    'db_name' => 'vorp',          // Name deiner VORP-Datenbank
    'db_user' => 'root',
    'db_pass' => 'dein_passwort',

    // Optionaler Schreibschutz (siehe Sicherheit unten). Leer = aus.
    'edit_token' => '',

    // Pfad zu deinem vorp_inventory Resource-Ordner.
    // Für die Tabs Weapons und Images nötig.
    // Beispiel Linux: '/home/server/resources/[vorp]/vorp_inventory'
    // Beispiel Windows: 'C:/server/resources/vorp_inventory'
    'vorp_inventory_path' => '/pfad/zu/vorp_inventory',
];
```

Tipp: kopiere `config.example.php` zu `config.php` und bearbeite die — `config.php` ist git-ignoriert, dein Passwort bleibt also aus der Versionsverwaltung raus.

### 3. Im Browser öffnen

Gehe auf `http://dein-server/vorpedit/`.

Oben rechts sollte grün **● DB verbunden · N Items** stehen. Falls nicht, ruf `http://dein-server/vorpedit/api/health.php` direkt auf — das liefert eine JSON-Diagnose, die genau zeigt, was nicht stimmt (DB-Verbindung, Pfade, Schreibrechte, GD-Verfügbarkeit).

---

## Berechtigungen (Linux)

Die Tabs Images und Weapons müssen Dateien **schreiben**. Der Webserver-User (oft `www-data`) muss in die betreffenden Ordner/Dateien schreiben dürfen. Wenn dein RedM-Server sie als anderer User angelegt hat (z.B. `root`), schlägt das Speichern mit einem Rechte-Fehler fehl.

Prüfe `api/health.php` — wenn dort `"img_dir_writable": false` oder `"weapons_writable": false` steht, behebe es. Ersetze die Pfade durch die, die health.php anzeigt (Anführungszeichen behalten — die `[ ]` in VORP-Pfaden müssen in der Shell gequotet sein):

```bash
# Webserver-User die Ziele zum Schreiben übereignen:
sudo chown -R www-data:www-data "/pfad/zu/vorp_inventory/html/img/items"
sudo chown www-data:www-data "/pfad/zu/vorp_inventory/config/weapons.lua"

# Webserver neu starten:
sudo systemctl restart apache2     # oder nginx / php-fpm
```

---

## Datenbank-Hinweise

- Der Editor arbeitet mit dem Standard-VORP **V2 `items` Schema** (Spalten: `item`, `label`, `limit`, `can_remove`, `type`, `usable`, `id`, `groupId`, `rarityId`, `metadata`, `desc`, `weight`, `degradation`, `useExpired`, `durability`, `instructions`).
- `item` ist der **Primary Key**. Im Editor nach dem Anlegen gesperrt — ihn umzubenennen würde die Verknüpfung zu allen Items kaputtmachen, die Spieler bereits im Inventar/Loadout haben.
- `id` wird beim Einfügen automatisch als `MAX(id)+1` vergeben.
- oxEdit-Felder, die VORP nicht als Spalte hat (close, stack, consume, allowArmed, image, usetime, usw.), werden in die `metadata` JSON-Spalte gemerged, damit nichts in eine nicht existierende Spalte geschrieben wird.
- **Waffen-Komponenten:** Manche Component-Namen sind länger als 50 Zeichen. Wenn du Komponenten als Items einfügen willst, vergrößere die Spalte einmalig:
  ```sql
  ALTER TABLE `items` MODIFY `item` VARCHAR(64) NOT NULL;
  ```
  Ohne das werden Namen über 50 Zeichen übersprungen (der Editor sagt dir, welche).

### Hinweis zum Caching

`vorp_inventory` cached die Item-Definitionen beim Start der Resource. Änderungen hier greifen im Spiel erst nach `ensure vorp_inventory` (oder Server-Neustart), nicht sofort.

---

## Sicherheit

Dieses Tool kann deine Live-Datenbank und Server-Dateien lesen und verändern — **stelle es daher nicht ungeschützt öffentlich bereit.**

- Setze `edit_token` in `config.php` auf einen geheimen Wert und trage denselben Wert in `app.js` ein (die `EDIT_TOKEN` Konstante oben). Lesezugriff bleibt offen; Anlegen/Ändern/Löschen/Optimieren brauchen den Token.
- Noch besser: hinter HTTP-Basic-Auth (`.htaccess`) oder einen Reverse-Proxy / Tunnel mit Zugriffskontrolle hängen, idealerweise nur aus dem eigenen Netz oder VPN erreichbar.
- Teste immer erst gegen eine Entwicklungs-Datenbank — das Tool schreibt in die echten Tabellen.

---

## Fehlerbehebung

| Symptom | Wahrscheinliche Ursache |
|---|---|
| `404` auf `api/*.php` | PHP-Dateien nicht im `api/` Ordner, oder `.php` Endung verloren |
| PHP-Quellcode wird als Text angezeigt | PHP für den Ordner nicht aktiviert/installiert |
| „DB-Verbindung fehlgeschlagen" | Falsche Zugangsdaten in `config.php`, oder DB vom Webserver nicht erreichbar |
| Weapons-Tab zeigt `0/0` | Falscher `vorp_inventory_path`, oder `config/weapons.lua` nicht gefunden |
| „0 KB gespart" / Optimieren tut nichts | Bilder-Ordner für den Webserver-User nicht beschreibbar (siehe Berechtigungen) |
| Optimieren-Button deaktiviert | GD-Extension fehlt — `php-gd` installieren |
| `Data too long for column 'item'` | Component-Name über 50 Zeichen — Spalte vergrößern (siehe Datenbank-Hinweise) |
| 404s für Bilder wie `Some Name.png` | Das sind Datenbank-Items ohne passende Icon-Datei — harmloses Konsolen-Rauschen |

Ruf jederzeit `api/health.php` für eine vollständige Diagnose auf.

---

## Wie es funktioniert (kurz)

Ein Browser kann nicht direkt mit MySQL reden, daher sind die PHP-Dateien in `api/` der Mittelsmann:

```
Browser (index.html + app.js)  --HTTP/JSON-->  PHP (api/)  -->  MySQL  +  vorp_inventory Dateien
```

Alles läuft auf deinem eigenen Server. Es werden keine Daten irgendwohin gesendet.

---

## Credits

Inspiriert von [oxEdit](https://github.com/Arius-Scripts/oxedit) von Arius-Scripts (für ox_inventory). Dies ist eine eigenständige Neuimplementierung für das VORP-Framework mit direkter Datenbank-Anbindung.
