// ===========================================================================
// VORP Edit - app.js
// ===========================================================================
const API = "api";
const EDIT_TOKEN = ""; // falls in config.php gesetzt, hier denselben Wert eintragen

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

let state = {
  tab: "items",
  items: [],
  weapons: [],
  weaponsPath: "",
  images: [],
  missing: [],
  current: null,       // aktuell editiertes Objekt
  isNew: false,
  dirty: false,
  selected: new Set(), // item-namen für multi-select
  pvMode: "lua",
  weaponsDirty: false,
};

// ---- helpers --------------------------------------------------------------
function authHeaders() {
  const h = { "Content-Type": "application/json" };
  if (EDIT_TOKEN) h["x-edit-token"] = EDIT_TOKEN;
  return h;
}
function toast(msg, type) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast show" + (type ? " " + type : "");
  setTimeout(() => (t.className = "toast"), 3000);
}
function esc(s) { return String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
function imgUrl(item) { return `${API}/image.php?name=${encodeURIComponent(item)}.png`; }

// metadata JSON sicher parsen
function parseMeta(raw) {
  try { const o = JSON.parse(raw || "{}"); return (o && typeof o === "object") ? o : {}; }
  catch { return {}; }
}

// ---- health ---------------------------------------------------------------
async function checkHealth() {
  const s = $("#status");
  try {
    const r = await fetch(`${API}/health.php`);
    const d = await r.json();
    if (d.ok) { s.textContent = `${t("db_connected")} · ${d.items} ${t("items_suffix")}`; s.className = "status-dot ok"; }
    else { s.textContent = t("db_error"); s.className = "status-dot err"; toast(d.error, "err"); }
  } catch { s.textContent = t("api_unreachable"); s.className = "status-dot err"; }
}

// ===========================================================================
// TABS
// ===========================================================================
function setTab(tab) {
  state.tab = tab;
  state.current = null; state.isNew = false; state.dirty = false; state.selected.clear();
  $$(".rail-item").forEach(el => el.classList.toggle("active", el.dataset.tab === tab));
  $("#saveWeaponsBtn").style.display = tab === "weapons" ? "flex" : "none";
  $("#preview").style.display = (tab === "items" || tab === "weapons") ? "none" : "none";

  if (tab === "items") {
    $("#listcol").style.display = "flex";
    $$(".pv-head .seg button").forEach(b => { b.style.display = ""; b.textContent = b.dataset.pv === "lua" ? "Lua" : (b.dataset.pv === "sql" ? "SQL" : "JSON"); });
    const ib = $("#compInsertBtn"); if (ib) ib.style.display = "none";
    renderItemsList(); showEmpty();
  }
  else if (tab === "weapons") { $("#listcol").style.display = "flex"; loadWeapons(); }
  else if (tab === "images") { $("#listcol").style.display = "none"; const ib = $("#compInsertBtn"); if (ib) ib.style.display = "none"; loadImages(); }
}

function showEmpty() {
  $("#editmain").innerHTML = `<div class="empty">${t("empty_pick")}<div class="sub">${t("empty_or_new")}</div></div>`;
  $("#preview").style.display = "none";
}

// ===========================================================================
// ITEMS
// ===========================================================================
async function loadItems() {
  const r = await fetch(`${API}/items.php`);
  const d = await r.json();
  if (!Array.isArray(d)) { toast(d.error || "Fehler beim Laden", "err"); return; }
  state.items = d;
  renderItemsList();
}

function findDuplicates() {
  // Duplikate = gleicher label ODER gleiches Bild-Item (case-insensitive label)
  const byLabel = {};
  for (const it of state.items) {
    const key = (it.label || "").trim().toLowerCase();
    if (!key) continue;
    (byLabel[key] = byLabel[key] || []).push(it.item);
  }
  const dupNames = new Set();
  for (const k in byLabel) if (byLabel[k].length > 1) byLabel[k].forEach(n => dupNames.add(n));
  return dupNames;
}

function renderItemsList() {
  const q = $("#search").value.toLowerCase();
  const dups = findDuplicates();
  const filtered = state.items.filter(it =>
    it.item.toLowerCase().includes(q) || (it.label || "").toLowerCase().includes(q));

  $("#count").textContent = `${filtered.length} / ${state.items.length} Items`;
  const dupBadge = $("#dupBadge");
  if (dups.size > 0) { dupBadge.style.display = "flex"; $("#dupCount").textContent = dups.size; }
  else dupBadge.style.display = "none";

  const list = $("#list");
  list.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const it of filtered) {
    const row = document.createElement("div");
    const active = state.current && !state.isNew && state.current.item === it.item;
    row.className = "listitem" + (active ? " active" : "");
    const isDup = dups.has(it.item);
    row.innerHTML = `
      <input type="checkbox" class="cb" ${state.selected.has(it.item) ? "checked" : ""} />
      <img class="ico" src="${imgUrl(it.item)}" onerror="this.classList.add('none');this.removeAttribute('src');this.textContent='?'" />
      <div class="li-text">
        <div class="li-name">${esc(it.item)}</div>
        <div class="li-label">${esc(it.label || "")}</div>
      </div>
      ${isDup ? '<span class="li-dup">dup</span>' : ""}`;
    row.querySelector(".cb").onclick = (e) => { e.stopPropagation(); toggleSelect(it.item); };
    row.onclick = () => selectItem(it.item);
    frag.appendChild(row);
  }
  list.appendChild(frag);
  updateSelBar();
}

function toggleSelect(name) {
  if (state.selected.has(name)) state.selected.delete(name);
  else state.selected.add(name);
  updateSelBar();
}
function updateSelBar() {
  const n = state.selected.size;
  $("#selbar").classList.toggle("show", n > 0);
  $("#selCount").textContent = `${n} ${t("selected")}`;
}

async function selectItem(name) {
  if (state.dirty && !confirm(t("c_discard"))) return;
  const r = await fetch(`${API}/items.php?item=${encodeURIComponent(name)}`);
  if (!r.ok) return toast("Konnte Item nicht laden", "err");
  state.current = await r.json();
  state.isNew = false; state.dirty = false;
  renderItemEditor();
  renderItemsList();
}

function newItem() {
  if (state.dirty && !confirm(t("c_discard"))) return;
  state.current = {
    item: "", label: "", limit: 1, can_remove: 1, type: "item_standard", usable: 0,
    groupId: 1, rarityId: 1, metadata: "{}", desc: "nice item", weight: 0.25,
    degradation: 0, useExpired: 0, durability: null, instructions: "",
  };
  state.isNew = true; state.dirty = true;
  renderItemEditor();
}

// alle Editor-Felder. m: liegt in metadata
const ITEM_FIELDS = [
  { sec: "General", rows: [
    ["label", "label", "text", { req: true }], ["weight", "weight", "number", {}],
    ["type", "type", "text", {}], ["limit", "limit (Stack)", "number", {}],
    ["groupId", "groupId", "number", {}], ["rarityId", "rarityId", "number", {}],
    ["desc", "description", "text", { full: true }],
  ]},
  { sec: "Verhalten", rows: [
    ["usable", "usable", "toggle", {}], ["can_remove", "can_remove", "toggle", {}],
    ["useExpired", "useExpired", "toggle", {}], ["__m_close", "close", "toggle", { m: true }],
    ["__m_stack", "stack", "toggle", { m: true }], ["__m_decay", "decay", "toggle", { m: true }],
    ["__m_allowArmed", "allowArmed", "toggle", { m: true }],
    ["__m_consume", "consume", "number", { m: true }],
    ["degradation", "degradation (Min)", "number", {}],
    ["durability", "durability", "number", { ph: "leer = null" }],
  ]},
  { sec: "Client / Verwendung", rows: [
    ["__m_image", "image", "text", { m: true, ph: "z.B. apple.png" }],
    ["__m_usetime", "usetime", "number", { m: true }],
    ["__m_export", "export", "text", { m: true, ph: "resource.exportName" }],
    ["__m_event", "event", "text", { m: true, ph: "eventName" }],
    ["__m_notification", "notification", "text", { m: true, full: true }],
    ["__m_anim_dict", "anim dict", "text", { m: true }],
    ["__m_anim_clip", "anim clip", "text", { m: true }],
    ["__m_prop", "prop", "text", { m: true, full: true }],
  ]},
  { sec: "Erweitert", rows: [
    ["metadata", "metadata (JSON)", "textarea", { full: true, mono: true }],
    ["instructions", "instructions", "textarea", { full: true }],
  ]},
];

function getVal(c, key, isMeta) {
  if (isMeta) {
    const meta = parseMeta(c.metadata);
    const mk = key.replace("__m_", "");
    return meta[mk];
  }
  return c[key];
}

function renderItemEditor() {
  const c = state.current;
  const main = $("#editmain");
  const hasImg = true;

  let html = `
    <div class="edithead">
      <img class="big-ico" src="${imgUrl(c.item || "__none")}" onerror="this.classList.add('none');this.removeAttribute('src');this.textContent='kein Bild'" />
      <div>
        <div class="h-name">${esc(c.item || "Neues Item")}</div>
        <div class="h-sub">${Object.keys(c).length} ${t("fields")}${state.isNew ? " · neu" : ""}</div>
      </div>
      <div class="spacer"></div>
      ${state.isNew ? "" : '<button class="rm-btn" id="rmBtn">🗑 Löschen</button>'}
    </div>`;

  for (const sec of ITEM_FIELDS) {
    const secLabel = ({"General":t("sec_general"),"Verhalten":t("sec_behavior"),"Client / Verwendung":t("sec_client"),"Erweitert":t("sec_advanced")})[sec.sec] || sec.sec;
    html += `<div class="section"><h3>${secLabel}</h3><div class="grid">`;
    // item-name als erstes Feld in General
    if (sec.sec === "General") {
      html += `
        <div class="fld">
          <label>item (interner Name) ${state.isNew ? "" : '<span class="pk-lock">🔒 PK – nicht änderbar</span>'}</label>
          <input id="f_item" value="${esc(c.item)}" ${state.isNew ? "" : "disabled"} placeholder="z.B. consumable_apple" />
          ${state.isNew ? '<span class="hint">Primary Key. Danach nicht mehr änderbar.</span>' : ""}
        </div>`;
    }
    for (const [key, lbl, type, opt] of sec.rows) {
      const isMeta = !!opt.m;
      let v = getVal(c, key, isMeta);
      const notset = (v === undefined || v === null || v === "");
      const cls = "fld" + (opt.full ? " full" : "");
      if (type === "toggle") {
        const on = v === true || v === 1 || v === "1";
        html += `<div class="${cls}"><div class="switchrow">
          <label>${lbl} ${isMeta && notset ? '<span class="notset">(not set)</span>' : ''}</label>
          <label class="switch"><input type="checkbox" data-key="${key}" data-meta="${isMeta}" ${on ? "checked" : ""}/><span class="sl"></span></label>
        </div></div>`;
      } else if (type === "textarea") {
        html += `<div class="${cls}"><label>${lbl}</label>
          <textarea data-key="${key}" data-meta="${isMeta}" class="${opt.mono ? "mono" : ""}" placeholder="${opt.ph || ""}">${esc(v ?? (key === "metadata" ? "{}" : ""))}</textarea>
          ${key === "metadata" ? '<span class="hint">${t("f_metadata_hint")}</span>' : ""}</div>`;
      } else {
        html += `<div class="${cls}">
          <label>${lbl}${opt.req ? ' <span class="req">*</span>' : ""} ${isMeta && notset ? '<span class="notset">(not set)</span>' : ''}</label>
          <input type="${type}" data-key="${key}" data-meta="${isMeta}" ${type === "number" ? 'step="any"' : ""} value="${notset ? "" : esc(v)}" placeholder="${opt.ph || ""}" />
        </div>`;
      }
    }
    html += `</div></div>`;
  }

  main.innerHTML = html;

  // foot
  const foot = document.createElement("div");
  foot.className = "editfoot";
  foot.innerHTML = `
    <span class="changes ${state.dirty ? "dirty" : ""}" id="changes">${state.dirty ? "● Ungespeicherte Änderungen" : "Keine Änderungen"}</span>
    <div class="spacer"></div>
    <button class="btn primary" id="saveItemBtn">${state.isNew ? t("create") : t("save")}</button>`;
  main.appendChild(foot);

  // listeners
  main.querySelectorAll("[data-key]").forEach(el => {
    const ev = el.type === "checkbox" ? "change" : "input";
    el.addEventListener(ev, () => { collectInto(c); state.dirty = true; $("#changes").className = "changes dirty"; $("#changes").textContent = "● Ungespeicherte Änderungen"; updatePreview(); });
  });
  $("#saveItemBtn").onclick = saveItem;
  if (!state.isNew) $("#rmBtn").onclick = () => delItems([c.item]);

  // preview
  $("#preview").style.display = "flex";
  updatePreview();
}

// liest alle Felder aus dem DOM ins current-objekt
function collectInto(c) {
  const meta = parseMeta(c.metadata);
  $("#editmain").querySelectorAll("[data-key]").forEach(el => {
    const key = el.dataset.key;
    const isMeta = el.dataset.meta === "true";
    let val;
    if (el.type === "checkbox") val = el.checked ? 1 : 0;
    else val = el.value;

    if (isMeta) {
      const mk = key.replace("__m_", "");
      if (el.type === "checkbox") { if (el.checked) meta[mk] = true; else delete meta[mk]; }
      else if (val === "" || val === null) delete meta[mk];
      else meta[mk] = (el.type === "number" && val !== "") ? Number(val) : val;
    } else {
      c[key] = val;
    }
  });
  if (state.isNew) c.item = $("#f_item")?.value.trim() ?? c.item;
  c.metadata = JSON.stringify(meta);
}

async function saveItem() {
  const c = state.current;
  collectInto(c);
  try { JSON.parse(c.metadata || "{}"); } catch { return toast(t("t_meta_invalid"), "err"); }
  if (state.isNew && !c.item) return toast(t("t_item_missing"), "err");

  const payload = { ...c };
  let r;
  if (state.isNew) r = await fetch(`${API}/items.php`, { method: "POST", headers: authHeaders(), body: JSON.stringify(payload) });
  else r = await fetch(`${API}/items.php?item=${encodeURIComponent(c.item)}`, { method: "PUT", headers: authHeaders(), body: JSON.stringify(payload) });

  const d = await r.json();
  if (!r.ok) return toast(d.error || "Fehler beim Speichern", "err");
  toast(state.isNew ? t("t_item_created") : t("t_saved"), "ok");
  await loadItems();
  state.current = d; state.isNew = false; state.dirty = false;
  renderItemEditor();
}

async function delItems(names) {
  if (!confirm(`${names.length === 1 ? names[0] : names.length + " " + t("items_suffix")} - ${t("c_delete_items")}`)) return;
  const r = await fetch(`${API}/items.php?item=${encodeURIComponent(names.join(","))}`, { method: "DELETE", headers: authHeaders() });
  const d = await r.json();
  if (!r.ok) return toast(d.error || "Fehler beim Löschen", "err");
  toast(`${d.deleted} ${t("t_deleted")}`, "ok");
  state.selected.clear();
  state.current = null; state.dirty = false;
  await loadItems();
  showEmpty();
}

// ===========================================================================
// PREVIEW (Lua / SQL / JSON)
// ===========================================================================
function highlight(code, mode) {
  let h = esc(code);
  if (mode === "lua") {
    h = h.replace(/\b(return|true|false|nil)\b/g, '<span class="tok-kw">$1</span>')
         .replace(/(\w+)(\s*=)/g, '<span class="tok-key">$1</span>$2')
         .replace(/(&quot;[^&]*?&quot;)/g, '<span class="tok-str">$1</span>')
         .replace(/\b(\d+\.?\d*)\b/g, '<span class="tok-num">$1</span>');
  } else if (mode === "sql") {
    h = h.replace(/\b(INSERT INTO|VALUES|UPDATE|SET|WHERE|NULL)\b/g, '<span class="tok-kw">$1</span>')
         .replace(/('[^']*?')/g, '<span class="tok-str">$1</span>')
         .replace(/\b(\d+\.?\d*)\b/g, '<span class="tok-num">$1</span>');
  }
  return h;
}

function buildPreview(c, mode) {
  const meta = parseMeta(c.metadata);
  if (mode === "json") return JSON.stringify({ ...c, metadata: meta }, null, 2);

  if (mode === "lua") {
    // oxedit-Style Lua-Repräsentation
    const lines = [`['${c.item}'] = {`];
    const push = (k, v) => {
      if (v === null || v === undefined || v === "") return;
      if (typeof v === "number") lines.push(`    ${k} = ${v},`);
      else if (v === true || v === false) lines.push(`    ${k} = ${v},`);
      else lines.push(`    ${k} = '${String(v).replace(/'/g, "\\'")}',`);
    };
    push("label", c.label);
    push("weight", Number(c.weight));
    push("limit", Number(c.limit));
    push("type", c.type);
    push("can_remove", Number(c.can_remove) ? true : false);
    push("usable", Number(c.usable) ? true : false);
    push("groupId", Number(c.groupId));
    push("rarityId", Number(c.rarityId));
    push("degradation", Number(c.degradation));
    if (c.durability != null && c.durability !== "") push("durability", Number(c.durability));
    push("description", c.desc);
    for (const k in meta) push(k, meta[k]);
    lines.push("},");
    return lines.join("\n");
  }

  // SQL
  const cols = ["item","label","limit","can_remove","type","usable","groupId","rarityId","metadata","desc","weight","degradation","useExpired","durability","instructions"];
  const v = (x) => x === null || x === undefined || x === "" ? "NULL" : (typeof x === "number" ? x : `'${String(x).replace(/'/g, "''")}'`);
  const vals = cols.map(k => k === "item" ? `'${c.item}'` : v(c[k])).join(", ");
  const upd = cols.filter(k => k !== "item").map(k => `\`${k}\` = ${v(c[k])}`).join(",\n  ");
  return `-- UPDATE\nUPDATE \`items\` SET\n  ${upd}\nWHERE \`item\` = '${c.item}';\n\n-- INSERT\nINSERT INTO \`items\`\n  (\`${cols.join("`, `")}\`)\nVALUES\n  (${vals});`;
}

function updatePreview() {
  if (!state.current) return;
  const code = buildPreview(state.current, state.pvMode);
  $("#pvcode").innerHTML = highlight(code, state.pvMode);
}

// ===========================================================================
// WEAPONS  (config/weapons.lua)
// ===========================================================================
async function loadWeapons() {
  $("#count").textContent = "lade…";
  $("#dupBadge").style.display = "none";
  const r = await fetch(`${API}/weapons.php`);
  const d = await r.json();
  if (!r.ok) { toast(d.error || "weapons.lua nicht gefunden", "err"); $("#list").innerHTML = `<div class="empty" style="margin-top:40px;font-size:13px">${esc(d.error || "")}</div>`; $("#count").textContent = "0"; return; }
  state.weapons = d.weapons || [];
  state.weaponsPath = d.path || "";
  state.weaponsDirty = false;
  $("#brandsub").textContent = state.weaponsPath;
  renderWeaponsList();
  showEmpty();
}

// Waffen-Struktur vom Backend: { key, scalars:{Name,Desc,Weight,...}, nested:"<rohes Lua>", hasNested }
// scalars = editierbar, nested = read-only (Components etc., bleibt beim Speichern erhalten)

function wName(w) { return (w.scalars && w.scalars.Name) || w.key || "?"; }

function renderWeaponsList() {
  const q = $("#search").value.toLowerCase();
  const filtered = state.weapons.filter(w =>
    (w.key || "").toLowerCase().includes(q) || wName(w).toLowerCase().includes(q));
  $("#count").textContent = `${filtered.length} / ${state.weapons.length} Weapons`;
  const list = $("#list");
  list.innerHTML = "";
  filtered.forEach((w) => {
    const idx = state.weapons.indexOf(w);
    const row = document.createElement("div");
    const active = state.current && state.current.__widx === idx;
    row.className = "listitem" + (active ? " active" : "");
    row.innerHTML = `
      <div class="ico none">⚔</div>
      <div class="li-text">
        <div class="li-name">${esc(wName(w))}</div>
        <div class="li-label">${esc(w.key)}${w.hasNested ? ' · +Components' : ''}</div>
      </div>`;
    row.onclick = () => selectWeapon(idx);
    list.appendChild(row);
  });
}

function selectWeapon(idx) {
  const src = state.weapons[idx];
  // tiefe Kopie der scalars, nested bleibt referenziert (read-only)
  state.current = { __widx: idx, key: src.key, scalars: { ...src.scalars }, nested: src.nested, hasNested: src.hasNested };
  state.isNew = false; state.dirty = false;
  renderWeaponEditor();
  renderWeaponsList();
}

function addWeapon() {
  const w = { key: "WEAPON_NEW", scalars: { Name: "Neue Waffe", Desc: "", HashName: "WEAPON_NEW", Weight: 1.0 }, nested: "", hasNested: false };
  state.weapons.push(w);
  state.weaponsDirty = true;
  selectWeapon(state.weapons.length - 1);
  renderWeaponsList();
}

// Anzeige-Reihenfolge der bekannten Felder, Rest danach
const W_FIELD_ORDER = ["Name","Desc","HashName","AttachPoint","Weight","DefaultClipSize",
  "AnimReloadRate","ComponentCategoryCount","ShortWeapon","LongWeapon","IsThrowable",
  "NoAmmo","NoSerialNumber","NoDegradation"];

function renderWeaponEditor() {
  const w = state.current;
  const main = $("#editmain");
  const sc = w.scalars;
  const keys = Object.keys(sc);
  keys.sort((a, b) => {
    const ia = W_FIELD_ORDER.indexOf(a), ib = W_FIELD_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  let html = `
    <div class="edithead">
      <div class="big-ico none">⚔</div>
      <div><div class="h-name">${esc(wName(w))}</div><div class="h-sub">${w.key} · ${keys.length} ${t("fields")}${w.hasNested ? " · " + t("w_components_preserved") : ""}</div></div>
      <div class="spacer"></div>
      <button class="rm-btn" id="rmWBtn">${t("w_remove")}</button>
    </div>
    <div class="section"><h3>${t("w_section_key")}</h3><div class="grid">
      <div class="fld"><label>${t("w_key_label")} ${state.isNew ? "" : '<span class="pk-lock">${t("w_key_lock")}</span>'}</label>
        <input id="w_key" value="${esc(w.key)}" ${state.isNew ? "" : "disabled"} /></div>
    </div></div>
    <div class="section"><h3>${t("w_props")}</h3><div class="grid">`;

  for (const k of keys) {
    const v = sc[k];
    if (typeof v === "boolean") {
      html += `<div class="fld"><div class="switchrow">
        <label>${k}</label>
        <label class="switch"><input type="checkbox" data-wkey="${k}" ${v ? "checked" : ""}/><span class="sl"></span></label>
      </div></div>`;
    } else {
      const t = typeof v === "number" ? "number" : "text";
      const readonly = k === "DefaultClipSize"; // laut Datei nicht ändern
      html += `<div class="fld"><label>${k} ${readonly ? '<span class="notset">(fix)</span>' : ''}</label>
        <input type="${t}" data-wkey="${k}" ${t === "number" ? 'step="any"' : ""} value="${esc(v)}" ${readonly ? "disabled" : ""} /></div>`;
    }
  }
  html += `</div>
    <div style="margin-top:16px"><button class="btn" id="addWFieldBtn">${t("w_add_field")}</button></div>
    </div>`;

  // nested (Components) read-only anzeigen
  if (w.hasNested && w.nested) {
    html += `<div class="section"><h3>${t("w_components_ro")}</h3>
      <textarea class="mono" readonly style="min-height:160px;width:100%">${esc(w.nested.trim())}</textarea>
      <span class="hint">${t("w_components_hint")}</span>
    </div>`;
  }

  main.innerHTML = html;

  const foot = document.createElement("div");
  foot.className = "editfoot";
  foot.innerHTML = `<span class="changes ${state.weaponsDirty ? "dirty" : ""}">${state.weaponsDirty ? t("w_dirty") : "Keine Änderungen"}</span>`;
  main.appendChild(foot);

  const markDirty = () => {
    state.weaponsDirty = true;
    foot.querySelector(".changes").className = "changes dirty";
    foot.querySelector(".changes").textContent = t("w_dirty");
    updateWeaponPreview();
  };

  main.querySelectorAll("[data-wkey]").forEach(el => {
    const ev = el.type === "checkbox" ? "change" : "input";
    el.addEventListener(ev, () => {
      const k = el.dataset.wkey;
      let val = el.type === "checkbox" ? el.checked : (el.type === "number" ? Number(el.value) : el.value);
      w.scalars[k] = val;
      state.weapons[w.__widx].scalars[k] = val;
      renderWeaponsList();
      markDirty();
    });
  });
  const keyInp = $("#w_key");
  if (keyInp && state.isNew) keyInp.addEventListener("input", () => {
    w.key = keyInp.value; state.weapons[w.__widx].key = keyInp.value; markDirty();
  });
  $("#addWFieldBtn").onclick = () => {
    const name = prompt("Feldname (z.B. Weight, Desc, ShortWeapon):");
    if (!name) return;
    w.scalars[name] = ""; state.weapons[w.__widx].scalars[name] = "";
    renderWeaponEditor();
  };
  $("#rmWBtn").onclick = () => {
    if (!confirm(`${w.key} - ${t("c_remove_weapon")}`)) return;
    state.weapons.splice(w.__widx, 1);
    state.weaponsDirty = true; state.current = null;
    renderWeaponsList(); showEmpty();
  };

  // Live-Preview rechts: Lua (die Waffe) + SQL (Components als Items)
  $("#preview").style.display = "flex";
  $$(".pv-head .seg button").forEach(b => {
    if (b.dataset.pv === "lua") { b.style.display = ""; b.textContent = "Lua"; }
    else if (b.dataset.pv === "sql") { b.style.display = ""; b.textContent = t("pv_components_sql"); }
    else b.style.display = "none"; // JSON aus
  });
  state.pvMode = "lua";
  $$(".pv-head .seg button").forEach(b => b.classList.toggle("active", b.dataset.pv === "lua"));
  // Insert-Button in der Preview-Kopfzeile (nur sichtbar im SQL-Modus)
  let insBtn = $("#compInsertBtn");
  if (!insBtn) {
    insBtn = document.createElement("button");
    insBtn.id = "compInsertBtn";
    insBtn.className = "copy";
    insBtn.style.marginRight = "6px";
    insBtn.style.display = "none";
    $(".pv-head .spacer").after(insBtn);
    insBtn.onclick = insertComponents;
  }
  insBtn.style.display = "none";
  updateWeaponPreview();
}

// baut die Lua-Repräsentation EINER Waffe (wie sie in die Datei geschrieben wird)
function buildWeaponLua(w) {
  const sc = w.scalars || {};
  const keys = Object.keys(sc);
  keys.sort((a, b) => {
    const ia = W_FIELD_ORDER.indexOf(a), ib = W_FIELD_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  const luaVal = (v) => {
    if (v === true) return "true";
    if (v === false) return "false";
    if (typeof v === "number") return String(v);
    if (v !== "" && !isNaN(Number(v)) && String(v).trim() !== "") return String(v);
    return `"${String(v).replace(/"/g, '\\"')}"`;
  };
  let s = `    ${w.key} = {\n`;
  for (const k of keys) s += `        ${k} = ${luaVal(sc[k])},\n`;
  if (w.nested) s += w.nested;  // Components roh erhalten
  s += `    },`;
  return s;
}

// extrahiert aktive COMPONENT_ Namen aus dem nested-Lua (ignoriert auskommentierte --)
function extractComponents(nested) {
  if (!nested) return [];
  const out = new Set();
  for (let line of nested.split("\n")) {
    // auskommentierte Zeilen überspringen
    const trimmed = line.trim();
    if (trimmed.startsWith("--")) continue;
    // Inline-Kommentar abschneiden
    const noComment = line.split("--")[0];
    const m = noComment.match(/(COMPONENT_[A-Z0-9_]+)\s*=\s*true/i);
    if (m) out.add(m[1]);
  }
  return [...out];
}

function updateWeaponPreview() {
  if (state.tab !== "weapons" || !state.current) return;
  if (state.pvMode === "sql") {
    renderComponentSql();
    return;
  }
  const code = buildWeaponLua(state.current);
  $("#pvcode").innerHTML = highlight(code, "lua");
}

async function renderComponentSql() {
  const comps = extractComponents(state.current.nested);
  if (!comps.length) {
    $("#pvcode").innerHTML = `<span class="ln">${t("comp_no")}</span>`;
    return;
  }
  $("#pvcode").innerHTML = `<span class="ln">-- ${comps.length} ${t("comp_checking")}</span>`;
  const r = await fetch(`${API}/components.php`, { method:"POST", headers:authHeaders(),
    body: JSON.stringify({ action:"preview", components: comps }) });
  const d = await r.json();
  if (!r.ok) { $("#pvcode").innerHTML = highlight(`-- Fehler: ${d.error}`, "sql"); return; }
  // Merke fehlende für den Insert-Button
  state.compMissing = d.missingNames || [];
  $("#pvcode").innerHTML = highlight(d.sql, "sql");
  // Insert-Button im foot aktualisieren
  const btn = $("#compInsertBtn");
  if (btn) {
    btn.style.display = d.missing > 0 ? "" : "none";
    btn.textContent = `⤓ ${d.missing} ${t("comp_insert")}`;
  }
}

async function insertComponents() {
  const comps = extractComponents(state.current.nested);
  if (!comps.length) return toast(t("t_comp_none"), "err");
  if (!confirm(t("c_comp_insert"))) return;
  const r = await fetch(`${API}/components.php`, { method:"POST", headers:authHeaders(),
    body: JSON.stringify({ action:"insert", components: comps }) });
  const d = await r.json();
  if (!r.ok) { alert(d.error || "Fehlgeschlagen"); return toast(d.error || "Fehlgeschlagen", "err"); }
  let msg = `${d.inserted} ${t("t_comp_inserted")} (${d.skipped||0})`;
  if (d.tooLong && d.tooLong.length) {
    msg += ` · ${d.tooLong.length} zu lang übersprungen`;
    alert(`${d.tooLong.length} Component-Namen passen nicht in die item-Spalte (varchar(${d.colLen})) und wurden übersprungen:\n\n${d.tooLong.join("\n")}\n\nWenn du die brauchst, vergrößere die Spalte:\nALTER TABLE \`items\` MODIFY \`item\` VARCHAR(64) NOT NULL;`);
  }
  toast(msg, d.tooLong && d.tooLong.length ? "err" : "ok");
  renderComponentSql();
}

async function saveWeapons() {
  if (!state.weaponsDirty) return toast(t("t_no_changes"), "ok");
  const payload = state.weapons.map(w => ({ key: w.key, scalars: w.scalars, nested: w.nested }));
  const r = await fetch(`${API}/weapons.php`, {
    method: "PUT", headers: authHeaders(), body: JSON.stringify({ weapons: payload }),
  });
  const d = await r.json();
  if (!r.ok) {
    const msg = d.hint ? `${d.error}\n\n${d.hint}` : (d.error || "Speichern fehlgeschlagen");
    alert(msg);
    return toast(d.error || "Speichern fehlgeschlagen", "err");
  }
  toast(`${t("t_weapons_saved")} (${d.count} · ${d.backup})`, "ok");
  state.weaponsDirty = false;
}

// ===========================================================================
// IMAGES
// ===========================================================================
let imgState = { all: [], filtered: [], sel: new Set(), dupes: [], missing: [], totalSize: 0, gd: false, dir: "" };

function fmtSize(b) { return b > 1024*1024 ? (b/1024/1024).toFixed(1)+" MB" : (b/1024).toFixed(1)+" KB"; }

async function loadImages() {
  const main = $("#editmain");
  main.innerHTML = `<div class="empty" style="margin-top:60px">lade Bilder…</div>`;
  const r = await fetch(`${API}/images.php`);
  const d = await r.json();
  if (!r.ok) { main.innerHTML = `<div class="empty" style="margin-top:60px;font-size:13px">${esc(d.error || "Fehler")}</div>`; return; }
  imgState.all = d.images || [];
  imgState.dupes = d.dupes || [];
  imgState.missing = d.missing || [];
  imgState.totalSize = d.totalSize || 0;
  imgState.gd = !!d.gdAvailable;
  imgState.dir = d.dir;
  imgState.writable = d.writable;
  imgState.dirOwner = d.dirOwner;
  imgState.webUser = d.webUser;
  imgState.sel.clear();
  $("#brandsub").textContent = d.dir;
  renderImages();
}

function renderImages(query = "") {
  const main = $("#editmain");
  const q = query.toLowerCase();
  imgState.filtered = imgState.all.filter(im => im.item.toLowerCase().includes(q));
  const dupNames = new Set(imgState.dupes.flatMap(g => g.names));
  const oversized = imgState.all.filter(im => im.oversized).length;

  let html = `
    <div class="img-topbar">
      <div class="img-title">${t("img_title")} <span class="pill">${imgState.all.length}</span>
        <span class="img-sub">${fmtSize(imgState.totalSize)}</span></div>
      <div class="spacer"></div>
      <div class="img-search"><span class="mag">⌕</span><input id="imgSearch" placeholder="${t("search_ph")}" value="${esc(query)}" /></div>
      <button class="btn" id="imgAnalyze">${t("img_analyze")}</button>
      <button class="btn primary" id="imgOptLarge" ${imgState.gd ? "" : "disabled"}>${t("img_opt_large")}${oversized ? ` (${oversized})` : ""}</button>
    </div>
    <div class="img-selbar">
      <label class="img-selall"><input type="checkbox" id="imgSelAll" /> ${t("img_sel_all")}</label>
      <div class="spacer"></div>
      <span class="img-selinfo" id="imgSelInfo"></span>
      <button class="btn" id="imgOptSel" disabled>${t("img_opt_sel")}</button>
      <button class="btn danger" id="imgDelSel" disabled>${t("img_del_sel")}</button>
    </div>`;

  if (!imgState.gd) html += `<div class="img-warn">${t("img_gd_missing")}</div>`;
  if (imgState.gd && imgState.writable === false) html += `<div class="img-warn">⚠ ${t("img_no_write")} Owner: <code>${esc(imgState.dirOwner||"?")}</code>, Webserver: <code>${esc(imgState.webUser||"?")}</code>. Fix: <code>sudo chown -R ${esc(imgState.webUser||"www-data")} "${esc(imgState.dir)}"</code></div>`;
  if (imgState.dupes.length) {
    const tot = imgState.dupes.reduce((a,g)=>a+g.names.length,0);
    html += `<div class="img-warn dup">⚠ ${imgState.dupes.length} ${t("img_dup_groups")} (${tot} ${t("img_dup_files")}) ${t("img_dup_hint")}</div>`;
  }
  if (imgState.missing.length) {
    html += `<div class="missing-box"><h4>⚠ ${imgState.missing.length} ${t("img_items_no_img")}</h4><div class="chips">`;
    html += imgState.missing.slice(0,150).map(m=>`<span class="chip">${esc(m)}</span>`).join("");
    if (imgState.missing.length>150) html += `<span class="chip">… +${imgState.missing.length-150}</span>`;
    html += `</div></div>`;
  }

  html += `<div class="imggrid">`;
  html += imgState.filtered.map(im => {
    const dup = dupNames.has(im.name);
    const checked = imgState.sel.has(im.name);
    return `
    <div class="imgcard ${im.oversized ? "over" : ""} ${dup ? "dup" : ""}">
      <input type="checkbox" class="img-cb" data-name="${esc(im.name)}" ${checked ? "checked" : ""} />
      ${im.oversized ? `<span class="badge over">${t("badge_large")}</span>` : ""}
      ${dup ? '<span class="badge dup">dup</span>' : ""}
      <img src="${API}/image.php?name=${encodeURIComponent(im.name)}" loading="lazy" />
      <div class="n" title="${esc(im.name)}">${esc(im.item)}</div>
      <div class="s">${fmtSize(im.size)}${im.w ? ` · ${im.w}×${im.h}` : ""}</div>
      <div class="card-acts">
        <button class="mini" data-opt="${esc(im.name)}" ${imgState.gd ? "" : "disabled"}>${t("optimize_btn")}</button>
        <button class="mini del" data-del="${esc(im.name)}">🗑</button>
      </div>
    </div>`;
  }).join("");
  html += `</div>`;
  main.innerHTML = html;
  $("#preview").style.display = "none";

  // wiring
  $("#imgSearch").oninput = (e) => renderImages(e.target.value);
  $("#imgSearch").focus();
  const inp = $("#imgSearch"); inp.setSelectionRange(inp.value.length, inp.value.length);

  $("#imgSelAll").onchange = (e) => {
    if (e.target.checked) imgState.filtered.forEach(im => imgState.sel.add(im.name));
    else imgState.sel.clear();
    renderImages(query);
  };
  main.querySelectorAll(".img-cb").forEach(cb => cb.onchange = () => {
    if (cb.checked) imgState.sel.add(cb.dataset.name); else imgState.sel.delete(cb.dataset.name);
    updateImgSel();
  });
  main.querySelectorAll("[data-opt]").forEach(b => b.onclick = () => openOptimizeDialog(b.dataset.opt));
  main.querySelectorAll("[data-del]").forEach(b => b.onclick = () => deleteImages([b.dataset.del]));
  $("#imgAnalyze").onclick = analyzeImages;
  $("#imgOptLarge").onclick = () => optimizeMany(imgState.all.filter(im=>im.oversized).map(im=>im.name));
  $("#imgOptSel").onclick = () => optimizeMany([...imgState.sel]);
  $("#imgDelSel").onclick = () => deleteImages([...imgState.sel]);
  updateImgSel();
}

function updateImgSel() {
  const n = imgState.sel.size;
  $("#imgSelInfo").textContent = n ? `${n} ${t("selected")}` : "";
  $("#imgOptSel").disabled = !n || !imgState.gd;
  $("#imgDelSel").disabled = !n;
}

// Einzel-Bild: öffnet den Vorschau-Dialog (wie oxedit)
let optState = { name: null, srcW: 0, srcH: 0, before: 0, sizes: [], pick: null };

async function openOptimizeDialog(name) {
  if (!imgState.gd) return toast(t("t_gd_missing"), "err");
  const im = imgState.all.find(x => x.name === name);
  if (!im) return;
  optState.name = name;
  optState.srcW = im.w || 0; optState.srcH = im.h || 0; optState.before = im.size;

  // Größen-Optionen: Originalkante + sinnvolle kleinere Stufen
  const maxEdge = Math.max(im.w || 128, im.h || 128);
  const opts = [];
  opts.push({ px: maxEdge, label: `${maxEdge}px (orig)` });
  [96, 64, 48].forEach(p => { if (p < maxEdge) opts.push({ px: p, label: `${p}px` }); });
  optState.sizes = opts;
  optState.pick = opts.length > 1 ? opts[1].px : opts[0].px; // default: erste kleinere Stufe

  // before-Bild
  $("#optBeforeImg").src = `${API}/image.php?name=${encodeURIComponent(name)}`;
  $("#optBeforeKb").textContent = fmtSize(im.size);
  $("#optBeforePx").textContent = im.w ? `${im.w}×${im.h}` : "";

  // size buttons
  $("#optSizes").innerHTML = `<span class="lbl">${t("opt_resize_to")} (${t("opt_source")} ${im.w||"?"}×${im.h||"?"}):</span>` +
    opts.map(o => `<button data-px="${o.px}" class="${o.px===optState.pick?"active":""}">${o.label}</button>`).join("");
  $("#optSizes").querySelectorAll("button").forEach(b => b.onclick = () => {
    optState.pick = Number(b.dataset.px);
    $("#optSizes").querySelectorAll("button").forEach(x => x.classList.toggle("active", x === b));
    refreshOptPreview();
  });

  $("#optModal").classList.add("show");
  refreshOptPreview();
}

async function refreshOptPreview() {
  $("#optAfterImg").src = ""; 
  $("#optAfterKb").textContent = "…"; $("#optAfterPx").textContent = "";
  $("#optSavings").textContent = t("opt_computing"); $("#optSavings").className = "opt-savings";
  const r = await fetch(`${API}/images.php`, { method:"POST", headers:authHeaders(),
    body: JSON.stringify({ action:"preview", name: optState.name, maxSize: optState.pick }) });
  const d = await r.json();
  if (!r.ok) { $("#optSavings").textContent = d.error || "Fehler"; $("#optSavings").className = "opt-savings none"; return; }
  $("#optAfterImg").src = d.dataUrl;
  $("#optAfterKb").textContent = fmtSize(d.after);
  $("#optAfterPx").textContent = `${d.newW}×${d.newH}`;
  if (d.savedBytes > 0) {
    $("#optSavings").innerHTML = `${t("opt_saves")} <span class="save-amt">${fmtSize(d.savedBytes)}</span> (${d.percent}% ${t("opt_smaller")}): ${fmtSize(d.before)} → ${fmtSize(d.after)}`;
    $("#optSavings").className = "opt-savings";
  } else {
    $("#optSavings").textContent = `${t("opt_no_save")} (${fmtSize(d.before)} → ${fmtSize(d.after)})`;
    $("#optSavings").className = "opt-savings none";
  }
}

async function applyOptimize() {
  const r = await fetch(`${API}/images.php`, { method:"POST", headers:authHeaders(),
    body: JSON.stringify({ action:"optimize", names:[optState.name], maxSize: optState.pick }) });
  const d = await r.json();
  if (!r.ok) {
    // Backend liefert hint bei Rechte-Problem
    const msg = d.hint ? `${d.error}\n\n${d.hint}` : (d.error || "Fehlgeschlagen");
    alert(msg);
    return toast(d.error || "Fehlgeschlagen", "err");
  }
  $("#optModal").classList.remove("show");
  const res = (d.results || [])[0];
  if (res && res.ok === false) return toast(`Nicht optimiert: ${res.msg}`, "err");
  if (res && res.skipped) return toast("Diese Größe bringt keine Ersparnis – kleinere Stufe wählen", "err");
  if (d.savedBytes > 0) toast(`${t("t_optimized")} ${fmtSize(d.savedBytes)} ${t("t_saved_amount")}`, "ok");
  else toast(t("t_no_change_size"), "err");
  loadImages();
}

// Mehrere Bilder direkt (kein Dialog möglich bei vielen) – fragt nur Zielgröße ab
async function optimizeMany(names) {
  if (!names.length) return toast(t("t_nothing_sel"), "err");
  if (!imgState.gd) return toast(t("t_gd_missing"), "err");
  if (!confirm(`${names.length} ${t("c_optimize")}`)) return;
  toast(`Optimiere ${names.length} Bilder…`);
  const r = await fetch(`${API}/images.php`, { method:"POST", headers:authHeaders(),
    body: JSON.stringify({ action:"optimize", names, maxSize:128 }) });
  const d = await r.json();
  if (!r.ok) {
    const msg = d.hint ? `${d.error}\n\n${d.hint}` : (d.error || "Fehlgeschlagen");
    alert(msg);
    return toast(d.error || "Fehlgeschlagen", "err");
  }
  const failed = (d.results || []).filter(x => x.ok === false);
  if (failed.length && d.savedBytes === 0) return toast(`Keins optimiert. Beispiel-Fehler: ${failed[0].msg}`, "err");
  toast(`${t("t_optimized")} ${fmtSize(d.savedBytes)} ${t("t_saved_amount")}${failed.length?` · ${failed.length} ✗`:""}`, failed.length ? "err" : "ok");
  loadImages();
}

async function deleteImages(names) {
  if (!names.length) return;
  if (!confirm(`${names.length} ${t("c_delete_imgs")}`)) return;
  const r = await fetch(`${API}/images.php`, { method:"POST", headers:authHeaders(), body: JSON.stringify({ action:"delete", names }) });
  const d = await r.json();
  if (!r.ok) return toast(d.error || "Löschen fehlgeschlagen", "err");
  toast(`${d.deleted} ${t("t_deleted")}`, "ok");
  loadImages();
}

async function analyzeImages() {
  toast("Analysiere…");
  const r = await fetch(`${API}/images.php`, { method:"POST", headers:authHeaders(), body: JSON.stringify({ action:"analyze" }) });
  const d = await r.json();
  if (!r.ok) return toast(d.error || "Analyse fehlgeschlagen", "err");
  const dupTot = (d.dupes||[]).reduce((a,g)=>a+g.names.length,0);
  toast(`${(d.dupes||[]).length} Dup-Gruppen · ${(d.oversized||[]).length} große Bilder`, "ok");
  imgState.dupes = d.dupes || [];
  renderImages($("#imgSearch")?.value || "");
}

// ===========================================================================
// BULK EDIT
// ===========================================================================
function openBulk() {
  if (!state.selected.size) return;
  $("#bulkN").textContent = state.selected.size;
  $("#bulkModal").classList.add("show");
}
async function applyBulk() {
  const field = $("#bulkField").value;
  const value = $("#bulkValue").value;
  const items = [...state.selected];
  const r = await fetch(`${API}/bulk.php`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ items, field, value }) });
  const d = await r.json();
  if (!r.ok) return toast(d.error || "Bulk fehlgeschlagen", "err");
  toast(`${d.updated} Items aktualisiert ✔`, "ok");
  $("#bulkModal").classList.remove("show");
  state.selected.clear();
  await loadItems();
}

// ===========================================================================
// WIRING
// ===========================================================================
$$(".rail-item").forEach(el => el.onclick = () => setTab(el.dataset.tab));
$("#search").oninput = () => {
  if (state.tab === "items") renderItemsList();
  else if (state.tab === "weapons") renderWeaponsList();
};
$("#addBtn").onclick = () => { if (state.tab === "items") newItem(); else if (state.tab === "weapons") addWeapon(); };
$("#reloadBtn").onclick = () => { checkHealth(); if (state.tab === "items") loadItems(); else if (state.tab === "weapons") loadWeapons(); else loadImages(); };
$("#saveWeaponsBtn").onclick = saveWeapons;

$("#selClearBtn").onclick = () => { state.selected.clear(); renderItemsList(); };
$("#bulkDelBtn").onclick = () => delItems([...state.selected]);
$("#bulkEditBtn").onclick = openBulk;
$("#bulkCancel").onclick = () => $("#bulkModal").classList.remove("show");
$("#bulkApply").onclick = applyBulk;

// optimize modal
$("#optClose").onclick = () => $("#optModal").classList.remove("show");
$("#optCancel").onclick = () => $("#optModal").classList.remove("show");
$("#optApply").onclick = applyOptimize;
$("#optModal").onclick = (e) => { if (e.target.id === "optModal") $("#optModal").classList.remove("show"); };

$$(".pv-head .seg button").forEach(b => b.onclick = () => {
  state.pvMode = b.dataset.pv;
  $$(".pv-head .seg button").forEach(x => x.classList.toggle("active", x === b));
  const ib = $("#compInsertBtn");
  if (state.tab === "weapons") {
    if (ib) ib.style.display = "none"; // wird in renderComponentSql wieder eingeblendet falls fehlende
    updateWeaponPreview();
  } else {
    if (ib) ib.style.display = "none";
    updatePreview();
  }
});
$("#copyPv").onclick = () => { navigator.clipboard.writeText($("#pvcode").textContent); toast(t("pv_copied"), "ok"); };
$("#dupBadge").onclick = () => { $("#search").value = ""; const dups = findDuplicates(); state.items.sort((a,b) => dups.has(b.item) - dups.has(a.item)); renderItemsList(); };

// ===========================================================================
// i18n - statische Texte übersetzen + Sprachumschalter
// ===========================================================================
function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.dataset.i18n;
    const txt = t(key);
    // Buttons mit Icon-Präfix: nur den Textteil ersetzen wäre komplex,
    // daher kompletten Text setzen (Icons sind in den Übersetzungen enthalten)
    el.textContent = txt;
  });
  document.querySelectorAll("[data-i18n-ph]").forEach(el => {
    el.setAttribute("placeholder", t(el.dataset.i18nPh));
  });
  // aktive Sprache im Switch markieren
  document.querySelectorAll("#langSwitch button").forEach(b =>
    b.classList.toggle("active", b.dataset.lang === LANG));
  document.documentElement.lang = LANG;
}

function switchLang(l) {
  setLang(l);
  applyI18n();
  // aktuelle Ansicht neu rendern, damit dynamische Texte mitkommen
  if (state.tab === "items") { renderItemsList(); if (state.current) renderItemEditor(); else showEmpty(); }
  else if (state.tab === "weapons") { renderWeaponsList(); if (state.current) renderWeaponEditor(); else showEmpty(); }
  else if (state.tab === "images") { renderImages($("#imgSearch")?.value || ""); }
  checkHealth();
}

document.querySelectorAll("#langSwitch button").forEach(b =>
  b.onclick = () => switchLang(b.dataset.lang));

// init
applyI18n();
checkHealth();
loadItems();
