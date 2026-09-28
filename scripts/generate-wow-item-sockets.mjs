#!/usr/bin/env node
/**
 * Regenerates src/lib/wow-item-sockets.data.json — how many gem sockets an
 * equipped item has — from Blizzard's client game data (DB2), mirrored by
 * wago.tools. Run after a content patch:  node scripts/generate-wow-item-sockets.mjs
 *
 *   sockets(item) = base sockets (ItemSparse.SocketType_0..2 non-zero)
 *                 + socket bonuses (ItemBonus rows with Type 6 = "Socket",
 *                   Value_0 = socket count) of the item's bonus lists
 *
 * Warcraft Logs reports an item's id, bonus list ids and filled gems, but not
 * its sockets; this table closes that gap. Validated against 23 193 equipped
 * items from 75 public Midnight raid reports: no item carried more gems than
 * computed sockets. Only prismatic (type 7) base sockets are listed — every
 * current-content socket is prismatic; a missing entry can only under-count
 * sockets, which the audit treats as "unknown", never as a missing gem.
 */
import { writeFileSync } from "node:fs";

const OUT = new URL("../src/lib/wow-item-sockets.data.json", import.meta.url);
const WAGO = "https://wago.tools/db2";

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function table(name, filter) {
  const url = `${WAGO}/${name}/csv?${new URLSearchParams(Object.entries(filter).map(([k, v]) => [`filter[${k}]`, v]))}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const [header, ...rows] = parseCsv(await response.text());
  return { header, rows: rows.filter((row) => row.length === header.length) };
}

// wago filters match substrings: keep only exact Type 6 rows.
const bonus = await table("ItemBonus", { Type: "6" });
const [bType, bValue, bParent] = ["Type", "Value_0", "ParentItemBonusListID"].map((c) => bonus.header.indexOf(c));
const socketsByBonusList = {};
for (const row of bonus.rows) {
  if (row[bType] !== "6") continue;
  socketsByBonusList[row[bParent]] = (socketsByBonusList[row[bParent]] ?? 0) + Number(row[bValue]);
}

const sparse = await table("ItemSparse", { SocketType_0: "7" });
const socketCols = ["SocketType_0", "SocketType_1", "SocketType_2"].map((c) => sparse.header.indexOf(c));
const itemsBySocketCount = {};
for (const row of sparse.rows) {
  const count = socketCols.filter((col) => row[col] && row[col] !== "0").length;
  if (count === 0) continue;
  (itemsBySocketCount[count] ??= []).push(Number(row[0]));
}
for (const ids of Object.values(itemsBySocketCount)) ids.sort((a, b) => a - b);
// Unnamed DB2 columns carry the client build ("Field_12_1_5_69594_011").
const buildOf = (header) => header.map((c) => c.match(/^Field_(\d+_\d+_\d+_\d+)_/)?.[1]).find(Boolean)?.replaceAll("_", ".");
const build = buildOf(sparse.header) ?? buildOf((await table("SpellItemEnchantment", { ID: "8052" })).header) ?? null;

writeFileSync(
  OUT,
  `${JSON.stringify({
    source: "Blizzard DB2 via wago.tools: ItemSparse.SocketType_0..2 (prismatic), ItemBonus Type 6",
    build,
    generatedAt: new Date().toISOString().slice(0, 10),
    socketsByBonusList,
    itemsBySocketCount,
  })}\n`,
);
console.log(
  `build ${build}: ${Object.keys(socketsByBonusList).length} socket bonus lists, ` +
    `${Object.values(itemsBySocketCount).reduce((n, ids) => n + ids.length, 0)} items with base sockets`,
);
