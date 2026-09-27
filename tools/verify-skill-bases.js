#!/usr/bin/env node
/**
 * **交叉驗證**：用 bwiki 逐頁 cache 獨立核 `data/skill-db-tw.json` 嘅 `base`／`skillPt`。
 *
 * ## 為何要
 *
 * 本庫嘅 `base` 全部由**計算器頁**（`data/calc-page-tw-2026-09-27.html`）嚟 —— 即係
 * **一個來源**。逐頁抓返嚟嘅 cache 係**另一個獨立來源**（同一招嘅頁面有「评价分」），
 * 兩邊對唔上就代表其中一邊有問題（或者頁面未更新）。
 *
 * ⚠️ 比對規則：
 *   · 只比**逐頁 `kind` 係一般／進化／劇情／活動**嘅頁 —— 逐頁標「独特」嘅唔比 base
 *     （固有技能分數 = ★ × Lv，頁面嘅 240／340 唔係 base）。
 *   · 名對唔上就唔比（唔准靠估）。
 *   · 對唔上嘅一律**報出嚟**，唔准靜默當「一致」。
 *
 * 用法：
 *   node tools/verify-skill-bases.js              # 摘要
 *   node tools/verify-skill-bases.js --diff       # 列出唔一致嘅
 *   node tools/verify-skill-bases.js --limit=40   # 最多列幾多
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeSkillName } from '../src/umascore/whatif.js';
import { decodeEntities } from '../src/umascore/gametora-skills.js';
import { bareFlags, flagValue, toolArgs } from './lib/args.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = toolArgs();
const flags = bareFlags(args);

const key = (s) => normalizeSkillName(decodeEntities(String(s ?? '').replace(/\s+/g, ' ').trim()));
const dir = join(ROOT, 'data', 'bwiki-pages');
if (!existsSync(dir)) {
  console.error('冇 data/bwiki-pages/ → 先跑 node tools/fetch-bwiki-skill-pages.js');
  process.exit(2);
}
const pages = readdirSync(dir).filter((f) => f.endsWith('.json'))
  .map((f) => { try { return JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { return null; } })
  .filter(Boolean);

const dbRaw = JSON.parse(readFileSync(join(ROOT, 'data', 'skill-db-tw.json'), 'utf8'));
const db = Array.isArray(dbRaw) ? dbRaw : (dbRaw.skills ?? []);
const dbIdx = new Map();
for (const s of db) {
  for (const n of [s.name, s.simplifiedName, s.nameJp]) {
    const k = key(n);
    if (k && !dbIdx.has(k)) dbIdx.set(k, s);
  }
}

/** 逐頁 cache 入面「唔可以當 base」嘅種類（固有＝★ × Lv）。 */
const NOT_BASE = new Set(['unique']);

/**
 * 已知而且**有理由**嘅唔一致（**唔係**「容許誤差」，係要寫明點解）。
 *
 * ⚠️ 加嘢入嚟之前一定要有證據。呢個 map 只可以放「已經查清楚邊個來源啱」嘅個案。
 */
const KNOWN_MISMATCH = new Map([
  ['才華橫溢', {
    pageBase: 508, dbBase: 633,
    reason: '⭐ 計算器頁最新值係 633（`秘める気のない才気`，同 GameTora id 111302211 對得上）；'
      + '`繁/才華橫溢` 嗰頁仲係**舊值 508**（未更新）→ 以計算器頁為準。'
      + '2026-09-27 實測同一招喺新頁改咗 id（舊 203431 → 新 111302211）',
  }],
]);

let compared = 0;
let same = 0;
let known = 0;
const diffs = [];
const skippedKind = [];
let noDb = 0;
for (const p of pages) {
  if (!p || p.base === null || p.base === undefined) continue;
  if (NOT_BASE.has(p.kind)) { skippedKind.push(p); continue; }
  const row = dbIdx.get(key(p.nameTw)) ?? dbIdx.get(key(p.nameCn));
  if (!row) { noDb += 1; continue; }
  compared += 1;
  const baseSame = (row.base ?? null) === p.base;
  const ptSame = (p.skillPt ?? null) === null || (row.skillPt ?? null) === p.skillPt;
  if (baseSame && ptSame) { same += 1; continue; }
  // ⚠️ 已知個案：仍然要**計入分母**（唔准靜默當佢一致），但分開報。
  const kn = KNOWN_MISMATCH.get(row.name);
  if (kn && kn.pageBase === p.base && kn.dbBase === row.base) { known += 1; continue; }
  diffs.push({ name: row.name, page: p.pageTitle, dbBase: row.base ?? null, pageBase: p.base, dbPt: row.skillPt ?? null, pagePt: p.skillPt ?? null });
}

console.log(`逐頁 cache ${pages.length} 頁`);
console.log(`可比嘅（頁面種類唔係固有、而且本庫對得上名）：**${compared}**`);
console.log(`　一致：**${same}**（${compared ? ((same / compared) * 100).toFixed(1) : '0'}%）`
  + `　已知有理由嘅唔一致：${known}　**真正有問題：${diffs.length}**`);
console.log(`跳過（固有技，頁面 base 唔可以當 base）：${skippedKind.length}`);
console.log(`本庫對唔上名（唔比，唔准估）：${noDb}`);
if (known && flags.has('--known')) {
  console.log('\n已知而且有理由嘅唔一致：');
  for (const [name, k] of KNOWN_MISMATCH) console.log(`   ${name}：頁 ${k.pageBase} vs 本庫 ${k.dbBase}\n      理由：${k.reason}`);
}
if (flags.has('--unmatched')) {
  console.log('\n對唔上名嘅逐頁：');
  const limit = Number(flagValue(args, 'limit') ?? 40);
  const list = pages.filter((p) => p && p.kind !== 'unique' && p.base !== null && p.base !== undefined
    && !dbIdx.has(key(p.nameTw)) && !dbIdx.has(key(p.nameCn)));
  for (const p of list.slice(0, limit)) {
    console.log(`   ${p.pageTitle}（kind=${p.kind} base=${p.base}）nameTw=${JSON.stringify(p.nameTw)} nameCn=${JSON.stringify(p.nameCn)}`);
  }
  if (list.length > limit) console.log(`   …仲有 ${list.length - limit} 個`);
}
if (diffs.length) {
  console.log('\n唔一致嘅：');
  const limit = Number(flagValue(args, 'limit') ?? (flags.has('--diff') ? 200 : 20));
  for (const d of diffs.slice(0, limit)) {
    console.log(`   ${d.name}（${d.page}）：base ${d.dbBase} vs 頁 ${d.pageBase}　PT ${d.dbPt} vs ${d.pagePt}`);
  }
  if (diffs.length > limit) console.log(`   …仲有 ${diffs.length - limit} 個（--limit=999）`);
}
process.exit(diffs.length ? 1 : 0);
