#!/usr/bin/env node
/**
 * **查一招技能**（GameTora 對照 ＋ 本專案技能庫狀態）。
 *
 * 用途：改嘢之前一句話答得到「呢招係固有／進化定普通？進化前提係咩？我哋庫有冇？」
 * ——唔使再開瀏覽器人手睇。
 *
 * 用法：
 *   node tools/gametora-skill.js 孤獨的英傑
 *   node tools/gametora-skill.js --id=110031
 *   node tools/gametora-skill.js 弧線 --all          # 列曬所有包含「弧線」嘅
 *   node tools/gametora-skill.js --kind=evolution --list   # 列進化技能（＋前提）
 *   node tools/gametora-skill.js --kind=unique --missing   # 列「固有但本庫冇」
 *   node tools/gametora-skill.js --stats             # 種類／覆蓋統計
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeSkillName } from '../src/umascore/whatif.js';
import { describeSkill, findById, findBySkillName, inLocalDb, shapeSkill } from '../src/umascore/gametora-skills.js';
import { bareFlags, flagValue, positionalArgs, toolArgs } from './lib/args.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = toolArgs();
const flags = bareFlags(args);
const GT = join(ROOT, 'data', 'gametora', 'skills.json');
if (!existsSync(GT)) {
  console.error('搵唔到 data/gametora/skills.json，先跑：node tools/fetch-gametora.js');
  process.exit(2);
}
const rowsRaw = JSON.parse(readFileSync(GT, 'utf8'));
const rows = Array.isArray(rowsRaw) ? rowsRaw : (rowsRaw.skills ?? []);
const db = JSON.parse(readFileSync(join(ROOT, 'data', 'skill-db-tw.json'), 'utf8'));

const kind = flagValue(args, 'kind');
const idArg = flagValue(args, 'id');

if (flags.has('--stats')) {
  const shaped = rows.map(shapeSkill).filter((s) => s?.name);
  const byKind = new Map();
  let miss = 0;
  for (const s of shaped) {
    byKind.set(s.kind, (byKind.get(s.kind) ?? 0) + 1);
    if (!inLocalDb(db.skills, s, normalizeSkillName)) miss += 1;
  }
  console.log(`GameTora 有名項 ${shaped.length}／${rows.length}`);
  console.log('種類：', [...byKind.entries()].map(([k, v]) => `${k}×${v}`).join('　'));
  console.log(`本專案技能庫（${db.skills.length} 招）冇嘅：**${miss}**`);
  for (const k of ['unique', 'evolution', 'normal']) {
    const list = shaped.filter((s) => s.kind === k);
    const m = list.filter((s) => !inLocalDb(db.skills, s, normalizeSkillName));
    console.log(`   ${k}：${list.length} 招，其中本庫冇 ${m.length}`);
  }
  process.exit(0);
}

if (kind) {
  const shaped = rows.map(shapeSkill).filter((s) => s?.name && s.kind === kind);
  const list = flags.has('--missing')
    ? shaped.filter((s) => !inLocalDb(db.skills, s, normalizeSkillName))
    : shaped;
  console.log(`GameTora \`${kind}\` ${list.length} 招${flags.has('--missing') ? '（本專案技能庫冇嘅）' : ''}：`);
  for (const s of list.slice(0, 300)) {
    const pre = s.kind === 'evolution' && s.preEvo ? `　前提=${JSON.stringify(s.preEvo)}` : '';
    const gene = s.geneVersion ? `　繼承版本cost=${s.geneVersion.cost ?? '?'}` : '';
    console.log(`   ${s.name}${s.nameEn ? `（${s.nameEn}）` : ''}　id=${s.id}${pre}${gene}`);
  }
  if (list.length > 300) console.log(`   …仲有 ${list.length - 300} 招`);
  process.exit(0);
}

if (idArg) {
  const s = findById(rows, idArg);
  console.log(describeSkill(s, { inDb: inLocalDb(db.skills, s, normalizeSkillName) }).join('\n'));
  process.exit(s ? 0 : 1);
}

const query = positionalArgs(args)[0];
if (!query) {
  console.error('用法：node tools/gametora-skill.js <技能名> [--all]　或者 --id=<遊戲ID>／--kind=unique|evolution|normal／--stats');
  process.exit(2);
}
const { hit, ambiguous, reason } = findBySkillName(rows, query, normalizeSkillName);
if (!hit) {
  console.error(`❌ 搵唔到「${query}」：${reason}`);
  for (const a of ambiguous) console.error(`   候選：${a}`);
  process.exit(1);
}
console.log(describeSkill(hit, { inDb: inLocalDb(db.skills, hit, normalizeSkillName) }).join('\n'));

if (flags.has('--all')) {
  const all = rows.map(shapeSkill).filter((s) => s?.name && normalizeSkillName(s.name).includes(normalizeSkillName(query)));
  if (all.length > 1) {
    console.log(`\n其他命中（${all.length}）：`);
    for (const s of all.slice(0, 40)) console.log(`   ${s.name}　id=${s.id}　rarity=${s.rarity}`);
  }
}
