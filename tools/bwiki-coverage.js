#!/usr/bin/env node
/**
 * **bwiki 每招一頁 ↔ 本專案技能庫 ↔ GameTora 三方對帳**（**完全離線**，唔上網）。
 *
 * 邏輯本體喺 `src/umascore/bwiki-coverage.js`（純函數、有測試）；呢個檔只負責讀檔同印嘢。
 *
 * 用法：
 *   node tools/bwiki-coverage.js                  # 摘要（用 data/bwiki-pages/ 逐頁 cache）
 *   node tools/bwiki-coverage.js --new            # 列出本庫未有、而**有 base** 嘅招（頭 60）
 *   node tools/bwiki-coverage.js --new --all      # 列曬
 *   node tools/bwiki-coverage.js --nobase         # 只列「有頁但抽唔到 base」（要人手睇）
 *   node tools/bwiki-coverage.js --ambiguous      # 列同名幾頁（兩邊都唔當命中）
 *   node tools/bwiki-coverage.js --json > x.json  # 機器讀（⚠️ PowerShell 會寫 UTF-16 → 用 cmd 或者 --out=）
 *   node tools/bwiki-coverage.js --out=x.json     # 直接寫 UTF-8 檔（建議，避免 PowerShell 編碼問題）
 */

import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reconcile, describeCoverage, mergeable } from '../src/umascore/bwiki-coverage.js';
import { shapeSkill } from '../src/umascore/gametora-skills.js';
// ⭐ 收空白（獨立審計 M7）：以前呢度自己寫一份 `replace(/\s+/g,' ').trim()`。
import { collapseSpaces } from '../src/umascore/skill-name-key.js';
import { bareFlags, flagValue, toolArgs } from './lib/args.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = toolArgs();
const flags = bareFlags(args);

/** 逐頁 cache → 一頁一個（`data/bwiki-pages/*.json`）。 */
function loadPages() {
  const dir = join(ROOT, 'data', 'bwiki-pages');
  if (!existsSync(dir)) return [];
  const pages = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    try {
      pages.push(JSON.parse(readFileSync(join(dir, f), 'utf8')));
    } catch { /* 壞 cache → 跳過（唔准當有一頁） */ }
  }
  return pages;
}

const pages = loadPages();
if (pages.length === 0) {
  console.error('data/bwiki-pages/ 冇 cache → 先跑：node tools/fetch-bwiki-skill-pages.js');
  process.exit(2);
}

const dbRaw = JSON.parse(readFileSync(join(ROOT, 'data', 'skill-db-tw.json'), 'utf8'));
const localSkills = Array.isArray(dbRaw) ? dbRaw : (dbRaw.skills ?? []);

const gtPath = join(ROOT, 'data', 'gametora', 'skills.json');
const gtRaw = existsSync(gtPath) ? JSON.parse(readFileSync(gtPath, 'utf8')) : [];
const gametoraSkills = (Array.isArray(gtRaw) ? gtRaw : (gtRaw.skills ?? []))
  .map(shapeSkill).filter((s) => s?.name);

const r = reconcile({ pages, localSkills, gametoraSkills });

const rows = r.newPages.map(({ page, inGametora }) => {
  const m = mergeable(page);
  return {
    name: collapseSpaces(page.nameTw),
    nameCn: collapseSpaces(page.nameCn) || null,
    pageTitle: page.pageTitle,
    rarity: page.rarity ?? null,
    kind: page.kind ?? 'unknown',
    base: page.base ?? null,
    skillPt: page.skillPt ?? null,
    ptPerPoint: page.ptPerPoint ?? null,
    condition: page.condition ?? null,
    inGametora,
    mergeable: m.ok,
    mergeReason: m.reason,
  };
});
const withBase = rows.filter((x) => x.mergeable);

const OUT = flagValue(args, 'out');
if (OUT) {
  writeFileSync(join(ROOT, OUT), `${JSON.stringify({
    checkedAt: new Date().toISOString(),
    ...r,
    newPages: rows,
  }, null, 1)}\n`);
  console.log(`✅ 寫咗 ${OUT}（${rows.length} 個本庫未有嘅頁）`);
}

if (flags.has('--json')) {
  console.log(JSON.stringify({ ...r, newPages: rows }, null, 1));
  process.exit(0);
}

for (const line of describeCoverage(r)) console.log(line);
console.log('\n種類（全部頁）：', Object.entries(r.kindCounts).map(([k, v]) => `${k}×${v}`).join('　'));
const mergeKind = {};
for (const x of withBase) mergeKind[x.kind] = (mergeKind[x.kind] ?? 0) + 1;
console.log(`本庫未有嘅頁：${rows.length}　其中**入得庫**（有 base 而且唔係固有）：**${withBase.length}**`,
  Object.entries(mergeKind).map(([k, v]) => `${k}×${v}`).join('　'));
console.log(`  ⚠️ 有頁但**抽唔到 base**（要人手睇）：${rows.filter((x) => x.base === null).length}`);
console.log(`  ⚠️ 固有技（★ × Lv，唔准用 page base）：${rows.filter((x) => !x.mergeable && x.base !== null).length}`);
console.log(`  GameTora 都話有嘅：${withBase.filter((x) => x.inGametora).length}／${withBase.length}（兩個來源互相印證）`);

const showList = flags.has('--nobase') ? rows.filter((x) => x.base === null)
  : flags.has('--new') ? withBase
    : flags.has('--allnew') ? rows
      : [];
if (showList.length) {
  const all = flags.has('--all');
  const limit = all ? showList.length : 60;
  console.log(`\n${flags.has('--nobase') ? '抽唔到 base' : flags.has('--allnew') ? '本庫未有嘅全部頁' : '本庫未有而有 base'}：`);
  for (const x of showList.slice(0, limit)) {
    const gtMark = x.inGametora ? '　[GameTora 有]' : '';
    console.log(`   [${x.kind} ${x.rarity ?? '?'}] ${x.name}　base=${x.base}　PT=${x.skillPt}${gtMark}`);
  }
  if (!all && showList.length > limit) console.log(`   …仲有 ${showList.length - limit} 個（--all 睇曬）`);
}

if (flags.has('--ambiguous') && r.ambiguous.length) {
  console.log(`\n歧義（同一個命名空間裡面同名幾頁 → 兩邊都唔當命中，${r.ambiguous.length} 組）：`);
  for (const g of r.ambiguous.slice(0, 40)) console.log(`   ${g.join('　;　')}`);
  if (r.ambiguous.length > 40) console.log(`   …仲有 ${r.ambiguous.length - 40} 組`);
}
if (r.unknownNamespace.length) {
  console.log(`\n⚠️ 唔認識嘅命名空間（${r.unknownNamespace.length}）：${r.unknownNamespace.slice(0, 10).join('　')}`);
}
