#!/usr/bin/env node
/**
 * **技能庫缺口報告**：GameTora 有、本專案技能庫（`data/skill-db-tw.json`）冇嘅技能。
 *
 * 為何要唔用 `diff-skill-names.js`：嗰個係為**貼上嘅文字名單**寫嘅（要剔 UI／效果句／
 * 長度上限），所以會**誤殺真技能名**（例如 `introduction：My body`、`CUTTING×DRIVE！`
 * 呢類長英文名）。呢個工具**唔做文字過濾**，直接逐個同本庫比對 → 數字先準。
 *
 * 用法：
 *   node tools/skill-gaps.js                 # 摘要 ＋ 頭 40 個缺口
 *   node tools/skill-gaps.js --all           # 全部列出
 *   node tools/skill-gaps.js --kind=unique   # 只看固有（r5）／--kind=evolution（r6）／normal
 *   node tools/skill-gaps.js --write         # 寫落 data/skill-db-gaps.json（machine-generated）
 *   node tools/skill-gaps.js --json          # JSON 輸出入（餵落其他工具）
 *
 * ⚠️ 缺口一律 `base=null`／`skillPt=null`（GameTora 冇基礎評價分）—— **唔准**估（地雷 #4）。
 */

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeSkillName } from '../src/umascore/whatif.js';
import { decodeEntities, shapeSkill } from '../src/umascore/gametora-skills.js';
import { bareFlags, flagValue, toolArgs } from './lib/args.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = toolArgs();
const flags = bareFlags(args);
const GT = join(ROOT, 'data', 'gametora', 'skills.json');
if (!existsSync(GT)) {
  console.error('搵唔到 data/gametora/skills.json，先跑：node tools/fetch-gametora.js');
  process.exit(2);
}
const gtRaw = JSON.parse(readFileSync(GT, 'utf8'));
const gtRows = Array.isArray(gtRaw) ? gtRaw : (gtRaw.skills ?? []);
const gt = gtRows.map(shapeSkill).filter((s) => s?.name);
const db = JSON.parse(readFileSync(join(ROOT, 'data', 'skill-db-tw.json'), 'utf8'));

const known = new Set();
for (const s of db.skills) {
  if (s.name) known.add(normalizeSkillName(s.name));
  if (s.simplifiedName) known.add(normalizeSkillName(s.simplifiedName));
}
// ⚠️ 本庫有 3 個名帶未解碼 entity（`打call&amp;回應`…）→ 兩邊都要試解碼版本，
//    唔係就會出現「假缺口」（呢 3 招其實已經有）。
const missAll = gt.filter((s) => {
  const n = normalizeSkillName(s.name);
  if (known.has(n)) return false;
  const decoded = normalizeSkillName(decodeEntities(s.name));
  return !known.has(decoded);
});

const kind = flagValue(args, 'kind');
const list = kind ? missAll.filter((s) => s.kind === kind) : missAll;

const byKind = new Map();
const byRarity = new Map();
for (const s of missAll) {
  byKind.set(s.kind, (byKind.get(s.kind) ?? 0) + 1);
  byRarity.set(String(s.rarity), (byRarity.get(String(s.rarity)) ?? 0) + 1);
}

if (flags.has('--json')) {
  console.log(JSON.stringify({
    gametoraRows: gtRows.length, gametoraNamed: gt.length, localDb: db.skills.length,
    missing: list.length, byKind: Object.fromEntries(byKind), byRarity: Object.fromEntries(byRarity),
    items: list,
  }, null, 2));
  process.exit(0);
}

console.log(`GameTora 有名項 ${gt.length}／${gtRows.length}　本庫 ${db.skills.length} 招`);
console.log(`缺口（GameTora 有、本庫冇）：**${missAll.length}**${kind ? `（只列 ${kind}：${list.length}）` : ''}`);
console.log('  種類：', [...byKind.entries()].map(([k, v]) => `${k}×${v}`).join('　'));
console.log('  rarity：', [...byRarity.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `r${k}×${v}`).join('　'));
console.log('  ⚠️ 全部 `base=null`：GameTora 冇基礎評價分 → 計分前要另外攞（唔准估）');

const show = flags.has('--all') ? list : list.slice(0, 40);
console.log(`\n${flags.has('--all') ? '全部' : '頭 40 個'}：`);
for (const s of show) {
  const evo = s.kind === 'evolution' ? `　前提=${JSON.stringify(s.preEvo)}` : '';
  const gene = s.geneVersion ? '　有繼承版本' : '';
  console.log(`   [${s.kind} r${s.rarity}] ${s.name}${s.nameEn ? `（${s.nameEn}）` : ''}　id=${s.id}${evo}${gene}`);
}
if (!flags.has('--all') && list.length > 40) console.log(`   …仲有 ${list.length - 40} 個（--all 睇曬）`);

if (flags.has('--write')) {
  const gapsPath = join(ROOT, 'data', 'skill-db-gaps.json');
  const gaps = existsSync(gapsPath) ? JSON.parse(readFileSync(gapsPath, 'utf8')) : {};
  // ⚠️ 之前嘅缺口檔有部分係「貼上名單」推導嘅（可能夾到雜訊）→ 呢次用 GameTora 結構化數據**重寫**
  //    清單部分（保留 note／todo）。
  const items = missAll.map((s) => ({
    name: s.name,
    nameEn: s.nameEn ?? null,
    gametoraId: s.id ?? null,
    rarity: s.rarity ?? null,
    kind: s.kind,
    desc: s.desc ?? null,
    evolutionOf: null,
    preEvo: s.preEvo ?? null,
    evoCond: s.evoCond ?? null,
    hasGeneVersion: Boolean(s.geneVersion),
    effect: null,
    category: s.kind === 'unique' ? '固有技能（分數 = ★ × Lv，唔需要 base）'
      : s.kind === 'evolution' ? '進化技能（要 base）' : '一般技能（要 base）',
    base: null,
    skillPt: null,
    source: 'data/gametora/skills.json',
  })).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  gaps.skills = items;
  gaps.checkedAt = '2026-09-27';
  gaps.gametoraTotal = gt.length;
  gaps.note = `${(gaps.note ?? '').split('⚠️ 呢個') [0]}⚠️ 呢個清單係由 GameTora 結構化數據生成（node tools/skill-gaps.js --write），`
    + '唔准手改。全部 base=null（GameTora 冇基礎評價分）→ 計分前要另外攞，唔准估（地雷 #4）。';
  writeFileSync(gapsPath, `${JSON.stringify(gaps, null, 2)}\n`);
  console.log(`\n✅ 重寫 data/skill-db-gaps.json：${items.length} 個缺口（machine-generated）`);
}
