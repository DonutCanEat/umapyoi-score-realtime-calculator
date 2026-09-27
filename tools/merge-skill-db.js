#!/usr/bin/env node
/**
 * **合併技能庫**：bwiki 計算器頁（繁中服當前狀態）＋ GameTora（日服繁體名）→ `data/skill-db-tw.json`。
 *
 * ## 為何要（2026-09-27）
 *
 * ⭐ 用戶指出：**bwiki 係繁中服、GameTora 係日服** → 日服進度快，有技能日服有繁中冇。
 * 而 bwiki「评分计算器」頁**已經更新**（1323 → **1585 招**，每招有 `评价分` ＝ base）。
 * 佢覆蓋 GameTora 590 缺口入面 **273 招**（131 個進化技全部 ＋ 142 個一般技）。
 *
 * ## 用法
 *
 *   node tools/merge-skill-db.js --page=data/calc-page-tw-2026-09-27.html   # 只報告（唔寫檔）
 *   node tools/merge-skill-db.js --page=… --write                          # 真寫入（會先備份）
 *   node tools/merge-skill-db.js --page=… --out=data/skill-db-tw.merged.json  # 寫去另一個檔
 *
 * ## ⛔ 規矩（寫死喺 `src/umascore/skill-db-merge.js`，呢度唔准繞過）
 *
 * · 固有技（GameTora rarity 5）**唔准入** —— 分數 = ★ × Lv，唔係 page base
 * · 冇 base 就唔准入（地雷 #4）
 * · 既有項**只更新** `base`／`skillPt`，**唔准改名**
 * · 新招嘅繁體名要由 GameTora 嚟；冇就標 `nameSource: 'jp'`（唔准靜默當繁體）
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCalculatorPage } from '../src/umascore/bwiki-calc-page.js';
import { mergeSkillDb } from '../src/umascore/skill-db-merge.js';
import { bareFlags, flagValue, toolArgs } from './lib/args.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = toolArgs();
const flags = bareFlags(args);

const pagePath = flagValue(args, 'page');
if (!pagePath) {
  console.error('要畀 --page=<計算器頁 HTML>（例如 --page=data/calc-page-tw-2026-09-27.html）');
  console.error('攞頁：node tools/fetch-bwiki-skill-pages.js --titles=… 或者直接 fetch action=parse&page=评分计算器');
  process.exit(2);
}
const absPage = join(ROOT, pagePath);
if (!existsSync(absPage)) {
  console.error(`搵唔到 ${pagePath}`);
  process.exit(2);
}

const calcSkills = parseCalculatorPage(readFileSync(absPage, 'utf8'));
console.log(`計算器頁 ${pagePath}：${calcSkills.length} 招（有 base ${calcSkills.filter((s) => s.base !== null).length}）`);
if (calcSkills.length === 0) {
  console.error('⚠️ 解析到 0 招 —— 唔准繼續（好可能係解析壞咗）');
  process.exit(1);
}

const dbPath = join(ROOT, 'data', 'skill-db-tw.json');
const dbRaw = JSON.parse(readFileSync(dbPath, 'utf8'));
const dbSkills = Array.isArray(dbRaw) ? dbRaw : (dbRaw.skills ?? []);

const gtPath = join(ROOT, 'data', 'gametora', 'skills.json');
const gtRaw = existsSync(gtPath) ? JSON.parse(readFileSync(gtPath, 'utf8')) : [];
const gametoraRows = Array.isArray(gtRaw) ? gtRaw : (gtRaw.skills ?? []);

// 逐頁 bwiki 結果（可選）：補計算器頁冇嘅 base
const pageSkills = [];
const pageDir = join(ROOT, 'data', 'bwiki-pages');
if (existsSync(pageDir)) {
  const { readdirSync } = await import('node:fs');
  for (const f of readdirSync(pageDir).filter((x) => x.endsWith('.json'))) {
    try { pageSkills.push(JSON.parse(readFileSync(join(pageDir, f), 'utf8'))); } catch { /* 壞 cache 跳過 */ }
  }
}

const r = mergeSkillDb({ calcSkills, dbSkills, gametoraRows, pageSkills });

console.log('\n── 統計 ──');
for (const [k, v] of Object.entries(r.stats)) console.log(`   ${k}: ${v}`);
console.log(`   本庫由 ${r.stats.dbSkills} → **${r.skills.length}** 招`);

if (flags.has('--list')) {
  console.log('\n── 更新咗嘅（頭 30）──');
  for (const u of r.updated.slice(0, 30)) console.log(`   ${u.name}：base ${u.from.base}→${u.to.base}　PT ${u.from.skillPt}→${u.to.skillPt}`);
  console.log('\n── 加入嘅（頭 40）──');
  for (const a of r.added.slice(0, 40)) console.log(`   [${a.kind}] ${a.name}（jp=${a.nameJp}）base=${a.base} PT=${a.skillPt}　[${a.nameSource}]`);
  if (r.added.length > 40) console.log(`   …仲有 ${r.added.length - 40} 招（--json 睇曬）`);
  if (r.skipped.length) {
    console.log(`\n── 跳過嘅（頭 20／共 ${r.skipped.length}）──`);
    for (const s of r.skipped.slice(0, 20)) console.log(`   ${s.name}：${s.reason}`);
  }
}

if (flags.has('--json')) console.log(JSON.stringify({ stats: r.stats, updated: r.updated, added: r.added, skipped: r.skipped.slice(0, 200) }, null, 1));

const OUT = flagValue(args, 'out');
if (!flags.has('--write') && !OUT) {
  console.log('\n（只報告。要寫入就加 --write，或者 --out=<另一個檔>）');
  process.exit(0);
}

const target = OUT ? join(ROOT, OUT) : dbPath;
if (!OUT && existsSync(dbPath)) {
  const bak = `${dbPath}.bak-${new Date().toISOString().slice(0, 10)}`;
  copyFileSync(dbPath, bak);
  console.log(`\n備份：${bak.replace(ROOT, '')}`);
}
const next = Array.isArray(dbRaw) ? r.skills : { ...dbRaw, skills: r.skills };
if (!Array.isArray(next)) {
  next.count = r.skills.length;
  next.mergedAt = new Date().toISOString();
  next.mergeSource = `${pagePath} + data/gametora/skills.json`;
}
writeFileSync(target, `${JSON.stringify(next, null, 1)}\n`);
console.log(`✅ 寫咗 ${target.replace(ROOT, '')}（${r.skills.length} 招）`);
console.log('⚠️ 一定要跑 `node tools/fit-score.js` 確認仍然 5/5 誤差 0');
