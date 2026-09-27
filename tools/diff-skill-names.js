#!/usr/bin/env node
/**
 * **技能名清單比對**：外部名單（GameTora 貼上／其他來源）→ 邊啲唔喺本專案技能庫。
 *
 * 為何要：補技能庫（尤其固有／進化）最貴嘅一步係「邊啲真係冇」—— 人手逐個睇 1323 招
 * 一定漏，所以要有個**可重複、唔靠估**嘅比對步驟（呢個就係「唔准靠人手抄」嘅落實，見地雷 #9）。
 *
 * 輸入：一個 JSON，`{ "rawPaste": ["…每一行…"] }`（原始貼上，唔使清理）。
 *   例：`data/gametora-paste-2026-09-27.json`
 *
 * 用法：
 *   node tools/diff-skill-names.js data/gametora-paste-2026-09-27.json
 *   node tools/diff-skill-names.js <file> --json        # 餵落其他工具用
 *   node tools/diff-skill-names.js <file> --kind=進化技能   # 只列「…的進化技能」句（進化前提）
 *
 * 過濾規則（全部可覆寫）：UI 字詞白名單、側欄（支援卡／角色名）、效果句、進化前提句。
 * ⚠️ 呢個工具**只讀**，唔會改 `data/` 任何檔。
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeSkillName } from '../src/umascore/whatif.js';
import { bareFlags, flagValue, positionalArgs, toolArgs } from './lib/args.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = toolArgs();
const flags = bareFlags(args);
const file = positionalArgs(args)[0];
if (!file) {
  console.error('用法：node tools/diff-skill-names.js <名單 JSON> [--json] [--kind=進化技能]');
  process.exit(2);
}
const kind = flagValue(args, 'kind');
const abs = existsSync(file) ? resolve(file) : join(ROOT, file);
if (!existsSync(abs)) {
  console.error(`搵唔到 ${abs}`);
  process.exit(2);
}
const paste = JSON.parse(readFileSync(abs, 'utf8'));
const raw = paste.rawPaste ?? paste.names ?? [];
if (!Array.isArray(raw) || !raw.length) {
  console.error('檔入面要有一個非空嘅 `rawPaste`（或者 `names`）陣列');
  process.exit(2);
}
const db = JSON.parse(readFileSync(join(ROOT, 'data', 'skill-db-tw.json'), 'utf8'));
const gaps = existsSync(join(ROOT, 'data', 'skill-db-gaps.json'))
  ? JSON.parse(readFileSync(join(ROOT, 'data', 'skill-db-gaps.json'), 'utf8'))
  : { skills: [] };

// ── 分類 ──
const UI = new Set([
  '1. 技能目錄', '2. 角色目錄', '3. 支援卡目錄', '4. 訓練事件幫手', '5. 比較工具', '[顯示全部]',
  '工具 ▼', '資料庫 ▼', '賽馬娘@GameTora', '篩選：', '精簡檢視', '詳細檢視', '總是顯示全部結果',
  '醒目提示高稀有技能', '在技能詳情中隱藏稀有度為 R 的支援卡片', '隱私權政策', '連結', '捐款', '回報錯誤',
  'Discord', '顯示技能ID',
]);
const SIDEBAR = new Set(['唯獨愛你', '機伶金花', '無聲鈴鹿', '目白拉茉奴', '西薩里奧', '萊茵實力', '勇敢之心']);
const EFFECT_START = /^(變得|若|在|因為|傳達|拚命|雖然|隨機|使)/;
const MAX_NAME_LEN = 12; // 遊戲技能名最長實測 9 個字（`競賽的精髓・體能`）；超過就當效果句

const evolution = [];
const candidates = [];
const dropped = [];
for (const line of raw) {
  const t = String(line).trim();
  if (!t) continue;
  if (t.includes('的進化技能')) { evolution.push(t); continue; }
  if (UI.has(t) || SIDEBAR.has(t)) { dropped.push([t, 'UI／側欄']); continue; }
  if (EFFECT_START.test(t)) { dropped.push([t, '效果句']); continue; }
  if ([...t].length > MAX_NAME_LEN) { dropped.push([t, '太長（似效果句）']); continue; }
  if (/[：:▼]/.test(t) || /^\d/.test(t)) { dropped.push([t, 'UI 標記／日期']); continue; }
  candidates.push(t);
}

const known = new Set();
for (const s of db.skills) {
  if (s.name) known.add(normalizeSkillName(s.name));
  if (s.simplifiedName) known.add(normalizeSkillName(s.simplifiedName));
}
const gapSet = new Set((gaps.skills ?? []).map((s) => normalizeSkillName(s.name)));

const inDb = [];
const inGaps = [];
const missing = [];
for (const c of candidates) {
  const n = normalizeSkillName(c);
  if (known.has(n)) inDb.push(c);
  else if (gapSet.has(n)) inGaps.push(c);
  else missing.push(c);
}

if (flags.has('--json')) {
  console.log(JSON.stringify({
    source: abs, lines: raw.length, candidates: candidates.length,
    dropped: dropped.length, evolutionLines: evolution.length,
    inDb, inGaps, missing,
  }, null, 2));
  process.exit(missing.length ? 1 : 0);
}

if (kind) {
  console.log(`「${kind}」句 ${evolution.length} 條：`);
  for (const e of evolution) console.log(`   ${e}`);
  process.exit(0);
}

console.log(`名單 ${raw.length} 行 → 候選名 ${candidates.length} 個（丟 ${dropped.length} 行、進化前提句 ${evolution.length} 條）`);
console.log(`\n✅ 已經喺技能庫（${inDb.length}）：${inDb.join('、') || '（冇）'}`);
if (inGaps.length) console.log(`📌 已經記喺 data/skill-db-gaps.json（${inGaps.length}）：${inGaps.join('、')}`);
console.log(`\n❌ 唔喺技能庫、亦未記錄（${missing.length}）：`);
for (const m of missing) console.log(`   ${m}`);
if (dropped.length) {
  console.log('\n丟棄樣本（頭 6 行；想睇全部就自己開檔）：');
  for (const [t, why] of dropped.slice(0, 6)) console.log(`   [${why}] ${t.slice(0, 40)}`);
}
process.exit(missing.length ? 1 : 0);
