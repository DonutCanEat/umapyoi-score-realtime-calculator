#!/usr/bin/env node
/**
 * **用 bwiki 逐頁 cache 補 `skillPt`**（只補 `null`，**唔准覆蓋已經有嘅值**）。
 *
 * ## 為何要
 *
 * 實測（2026-09-27）：本庫有 4 招 `skillPt = null`（`內側英雄`／`外側英雄`／
 * `對一哩競賽的意志`／`對長距離競賽的意志`），而 bwiki 逐頁寫住 **0**（唔收 Pt）。
 * `base` 兩邊一致 —— 即係只欠 PT。`null` 同 `0` 係**唔同**嘅事（地雷 #4）：
 * 顯示「PT 未知」同「唔收 Pt」對用戶係唔同嘅意思。
 *
 * ⚠️ **只補 `null`**：已經有值嘅一律唔郁（唔准用另一個來源覆蓋已確認嘅值）。
 * ⚠️ 只認逐頁 cache 入面**種類唔係固有**嘅頁（固有技嘅 base 唔可以當 base）。
 *
 * 用法：
 *   node tools/fill-missing-skillpt.js            # 只報告
 *   node tools/fill-missing-skillpt.js --write    # 真寫入（會備份）
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { skillNameKey } from '../src/umascore/skill-name-key.js';
import { bareFlags, toolArgs } from './lib/args.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = toolArgs();
const flags = bareFlags(args);
// ⭐ 對帳 key（獨立審計 M7）：以前呢度自己砌一份，同其餘四處逐字一樣。
const key = (s) => skillNameKey(s);

const dir = join(ROOT, 'data', 'bwiki-pages');
const pages = existsSync(dir)
  ? readdirSync(dir).filter((f) => f.endsWith('.json'))
    .map((f) => { try { return JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { return null; } }).filter(Boolean)
  : [];
const pageIdx = new Map();
for (const p of pages) {
  for (const n of [p.nameTw, p.nameCn]) {
    const k = key(n);
    if (k && !pageIdx.has(k)) pageIdx.set(k, p);
  }
}

const dbPath = join(ROOT, 'data', 'skill-db-tw.json');
const raw = JSON.parse(readFileSync(dbPath, 'utf8'));
const skills = Array.isArray(raw) ? raw : (raw.skills ?? []);

const filled = [];
for (const s of skills) {
  if (s.skillPt !== null && s.skillPt !== undefined) continue; // ⛔ 唔准覆蓋
  const p = pageIdx.get(key(s.name)) ?? pageIdx.get(key(s.simplifiedName)) ?? pageIdx.get(key(s.nameJp));
  if (!p || p.kind === 'unique') continue;
  if (p.skillPt === null || p.skillPt === undefined) continue;
  filled.push({ name: s.name, from: null, to: p.skillPt, page: p.pageTitle });
  s.skillPt = p.skillPt;
}

console.log(`逐頁 cache ${pages.length} 頁　本庫 ${skills.length} 招`);
console.log(`補咗 \`skillPt\`：**${filled.length}** 招`);
for (const f of filled) console.log(`   ${f.name}（${f.page}）：null → ${f.to}`);

if (!flags.has('--write')) {
  console.log('\n（只報告。要寫入就加 --write）');
  process.exit(0);
}
if (filled.length === 0) { console.log('冇嘢要寫。'); process.exit(0); }
const bak = `${dbPath}.bak-${new Date().toISOString().slice(0, 10)}`;
copyFileSync(dbPath, bak);
console.log(`\n備份：${bak.replace(ROOT, '')}`);
const next = Array.isArray(raw) ? skills : { ...raw, skills };
writeFileSync(dbPath, `${JSON.stringify(next, null, 1)}\n`);
console.log(`✅ 寫咗 ${dbPath.replace(ROOT, '')}`);
console.log('⚠️ 一定要跑 `node tools/fit-score.js` 確認仍然 5/5 誤差 0');
