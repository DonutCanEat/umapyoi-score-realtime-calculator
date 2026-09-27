#!/usr/bin/env node
/**
 * **技能名清單比對**：外部名單（GameTora 貼上／其他來源）→ 邊啲唔喺本專案技能庫。
 *
 * 為何要：補技能庫（尤其固有／進化）最貴嘅一步係「邊啲真係冇」—— 人手逐個睇 1323 招
 * 一定漏，所以要有個**可重複、唔靠估**嘅比對步驟（落實「唔准靠人手抄」，見地雷 #9）。
 *
 * 輸入：一個 JSON，`{ "rawPaste": ["…每一行…"] }`（原始貼上，唔使清理）。
 *   例：`data/gametora-paste-2026-09-27b.json`
 *
 * 用法：
 *   node tools/diff-skill-names.js data/gametora-paste-2026-09-27b.json
 *   node tools/diff-skill-names.js <file> --json          # 餵落其他工具用
 *   node tools/diff-skill-names.js <file> --prereq        # 只列「…的固有／繼承技能」前提句
 *   node tools/diff-skill-names.js <file> --evolution     # 只列「…的進化技能」前提句
 *
 * ⚠️ 分類邏輯住喺 `src/umascore/skilllist-diff.js`（純函數、有測試）—— 呢個檔只負責 I/O 同輸出。
 * ⚠️ 呢個工具**只讀**，唔會改 `data/` 任何檔；有「未記錄」嘅名 → exit 1（可以當閘）。
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeSkillName } from '../src/umascore/whatif.js';
import { diffAgainstDb } from '../src/umascore/skilllist-diff.js';
import { bareFlags, positionalArgs, toolArgs } from './lib/args.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = toolArgs();
const flags = bareFlags(args);
const file = positionalArgs(args)[0];
if (!file) {
  console.error('用法：node tools/diff-skill-names.js <名單 JSON> [--json] [--prereq] [--evolution]');
  process.exit(2);
}
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

const r = diffAgainstDb(raw, db.skills, normalizeSkillName, gaps.skills);

if (flags.has('--json')) {
  console.log(JSON.stringify({
    source: abs,
    lines: raw.length,
    candidates: r.candidates.length,
    dropped: r.dropped.length,
    evolutionLines: r.evolution.length,
    prerequisiteLines: r.prerequisites.length,
    inDb: r.inDb,
    inGaps: r.inGaps,
    missing: r.missing,
  }, null, 2));
  process.exit(r.missing.length ? 1 : 0);
}

if (flags.has('--prereq')) {
  console.log(`「…的固有／繼承技能」前提句 ${r.prerequisites.length} 條：`);
  for (const e of r.prerequisites) console.log(`   ${e}`);
  process.exit(0);
}
if (flags.has('--evolution')) {
  console.log(`「…的進化技能」前提句 ${r.evolution.length} 條：`);
  for (const e of r.evolution) console.log(`   ${e}`);
  process.exit(0);
}

console.log(`名單 ${raw.length} 行 → 候選名 ${r.candidates.length} 個`
  + `（丟 ${r.dropped.length} 行、進化前提句 ${r.evolution.length} 條、固有前提句 ${r.prerequisites.length} 條）`);
console.log(`\n✅ 已經喺技能庫（${r.inDb.length}）：${r.inDb.join('、') || '（冇）'}`);
if (r.inGaps.length) console.log(`📌 已經記喺 data/skill-db-gaps.json（${r.inGaps.length}）：${r.inGaps.join('、')}`);
console.log(`\n❌ 唔喺技能庫、亦未記錄（${r.missing.length}）：`);
for (const m of r.missing) console.log(`   ${m}`);
if (r.dropped.length) {
  console.log('\n丟棄樣本（頭 6 行；想睇全部就自己開檔）：');
  for (const [t, why] of r.dropped.slice(0, 6)) console.log(`   [${why}] ${t.slice(0, 40)}`);
}
process.exit(r.missing.length ? 1 : 0);
