#!/usr/bin/env node
/**
 * **進化技能鏈表**（GameTora 數據 → 人可讀）。
 *
 * 你（用戶）2026-09-27 提示：GameTora 每個技能撳「更多」有**馬娘頭像＋名**。
 * 我哋唔使讀頭像 —— 數據入面 `char` / `pre_evo.card_id` 就係馬娘 id，
 * 對 `characters.json` 就攞到名（頭像同一個 id 都砌得出）。
 *
 * 用法：
 *   node tools/skill-evolution-chains.js                 # 全部 672 條進化（頭 40）
 *   node tools/skill-evolution-chains.js --all           # 全部列
 *   node tools/skill-evolution-chains.js --missing       # 只列「本專案技能庫冇」嗰啲
 *   node tools/skill-evolution-chains.js --owners        # 順便列「邊隻馬有呢招固有技」
 *   node tools/skill-evolution-chains.js --write         # 寫 data/skill-evolution-chains.json
 *
 * 前置：`node tools/fetch-gametora.js --keys=skills,characters`
 */

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeSkillName } from '../src/umascore/whatif.js';
import { evolutionChains, ownersOf, skillNameOf } from '../src/umascore/skill-owners.js';
import { bareFlags, toolArgs } from './lib/args.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const flags = bareFlags(toolArgs());
const skillsPath = join(ROOT, 'data', 'gametora', 'skills.json');
const charsPath = join(ROOT, 'data', 'gametora', 'characters.json');
if (!existsSync(skillsPath)) {
  console.error('搵唔到 data/gametora/skills.json，先跑：node tools/fetch-gametora.js');
  process.exit(2);
}
const skills = JSON.parse(readFileSync(skillsPath, 'utf8'));
const rows = Array.isArray(skills) ? skills : (skills.skills ?? []);

let charById = new Map();
if (existsSync(charsPath)) {
  const chars = JSON.parse(readFileSync(charsPath, 'utf8'));
  const list = Array.isArray(chars) ? chars : Object.values(chars);
  for (const c of list) {
    // ⚠️ GameTora `characters.json` 用 `char_id`（唔係 `id`）——實測 163 個角色
    const id = Number(c?.char_id ?? c?.id);
    if (Number.isFinite(id)) charById.set(id, c);
  }
}

const db = JSON.parse(readFileSync(join(ROOT, 'data', 'skill-db-tw.json'), 'utf8'));
const known = new Set();
for (const s of db.skills) {
  if (s.name) known.add(normalizeSkillName(s.name));
  if (s.simplifiedName) known.add(normalizeSkillName(s.simplifiedName));
}
const inDb = (name) => Boolean(name) && known.has(normalizeSkillName(name));

const { chains, orphans } = evolutionChains(rows, charById);
console.log(`進化技能（有 pre_evo）${chains.length + orphans.length} 條：`
  + `搵到前提 ${chains.length}、**搵唔到前提 ${orphans.length}**`);
console.log(`角色資料：${charById.size ? `${charById.size} 個（characters.json）` : '⚠️ 冇 characters.json → 只出 id'}`);
if (orphans.length) {
  console.log('\n⚠️ 搵唔到「前提技」嘅（要人手核，唔准當冇）：');
  for (const o of orphans.slice(0, 10)) console.log(`   ${o.name}（id=${o.id}）前提→ ${JSON.stringify(o.preEvo ?? o.baseSkillId)}`);
}

let list = flags.has('--missing') ? chains.filter((c) => !inDb(c.name)) : chains;
console.log(`\n${flags.has('--missing') ? '本庫冇嘅進化技能' : '進化技能'} ${list.length} 條：`);
const show = flags.has('--all') ? list : list.slice(0, 40);
for (const c of show) {
  const owners = c.charNames.length ? c.charNames.join('、') : (c.cardId ? `卡id=${c.cardId}` : '（冇）');
  console.log(`   ${c.name}${c.nameEn ? `（${c.nameEn}）` : ''}`
    + `　前提：【${c.baseSkillName ?? '❓'}】（id=${c.baseSkillId ?? '?'}）`
    + `　擁有者：${owners}`
    + `${inDb(c.name) ? '' : '　【本庫未收錄】'}`);
}
if (!flags.has('--all') && list.length > 40) console.log(`   …仲有 ${list.length - 40} 條（--all 睇曬）`);

if (flags.has('--owners')) {
  const unique = rows.filter((r) => String(r.rarity) === '5');
  console.log(`\n固有技能（rarity 5）擁有者 ${unique.length} 招：`);
  for (const r of unique.slice(0, 60)) {
    const o = ownersOf(r, charById);
    console.log(`   ${skillNameOf(r)}　→　${o.charNames.join('、') || (o.charIds.join(',') || '（冇 char 欄位）')}`);
  }
  if (unique.length > 60) console.log(`   …仲有 ${unique.length - 60} 招`);
}

if (flags.has('--write')) {
  const out = join(ROOT, 'data', 'skill-evolution-chains.json');
  writeFileSync(out, `${JSON.stringify({
    note: '進化技能鏈（machine-generated：node tools/skill-evolution-chains.js --write）。'
      + '⚠️ base 評價分唔喺呢度（GameTora 冇）→ 計分前要另外攞。',
    source: 'data/gametora/skills.json ＋ characters.json',
    checkedAt: '2026-09-27',
    total: chains.length + orphans.length,
    chains,
    orphans,
  }, null, 2)}\n`);
  console.log(`\n✅ 寫咗 data/skill-evolution-chains.json（${chains.length} 條鏈 ＋ ${orphans.length} 條孤兒）`);
}
