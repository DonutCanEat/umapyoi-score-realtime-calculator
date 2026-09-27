#!/usr/bin/env node
/**
 * **GameTora skills.json → 同本專案技能庫比對 ＋ 分類**（補技能庫嘅工作單）。
 *
 * 為何要：`data/gametora/skills.json`（1910 招，`tools/fetch-gametora.js` 抓）係**外部對照來源**。
 * 但「有咩新招」「係固有定進化」「係邊隻馬」要**逐項分類**，唔可以人手睇 1900 項。
 *
 * 用法：
 *   node tools/analyze-gametora-skills.js                    # 摘要 ＋ 缺口清單
 *   node tools/analyze-gametora-skills.js --json             # 餵落其他工具／寫檔用
 *   node tools/analyze-gametora-skills.js --write            # 寫 data/skill-db-gaps.json（machine-generated）
 *
 * ⚠️ 名一律用 `name_tw`（繁中）；`name_en`／`jpname` 只作參考。
 * ⚠️ 呢個工具**唔會**把新技能加入評分（`base`／`skillPt`／種類未確認之前唔准 —— 地雷 #4）。
 */

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeSkillName } from '../src/umascore/whatif.js';
import { diffAgainstDb } from '../src/umascore/skilllist-diff.js';
import { bareFlags, toolArgs } from './lib/args.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const flags = bareFlags(toolArgs());
const GT = join(ROOT, 'data', 'gametora', 'skills.json');
if (!existsSync(GT)) {
  console.error('搵唔到 data/gametora/skills.json，先跑：node tools/fetch-gametora.js');
  process.exit(2);
}
const rows = JSON.parse(readFileSync(GT, 'utf8'));
const list = Array.isArray(rows) ? rows : (rows.skills ?? []);
const db = JSON.parse(readFileSync(join(ROOT, 'data', 'skill-db-tw.json'), 'utf8'));
const gapsPath = join(ROOT, 'data', 'skill-db-gaps.json');
const gaps = existsSync(gapsPath) ? JSON.parse(readFileSync(gapsPath, 'utf8')) : { skills: [] };

/** 由 GameTora 一項抽出「本專案要用嘅欄位」（全部可能係 undefined → 唔准當真值）。 */
function shape(s) {
  const gv = s.gene_version ?? null;
  return {
    id: s.id ?? null,
    name: s.name_tw ?? null,
    nameEn: s.name_en ?? s.enname ?? null,
    nameJp: s.jpname ?? null,
    desc: s.desc_tw ?? null,
    rarity: s.rarity ?? null,
    iconId: s.iconid ?? null,
    tid: s.tid ?? null,
    evolutionOf: gv ?? null,
    preEvo: s.pre_evo ?? null,
    versions: s.versions ?? null,
    char: s.char ?? null,
    type: s.type ?? null,
  };
}

const items = list.map(shape);
const named = items.filter((s) => s.name);
console.log(`GameTora：${list.length} 項（有名 ${named.length}、冇名 ${items.length - named.length}）`);

// rarity 分佈（睇「固有／進化」點標）
const rarityCount = new Map();
for (const s of items) {
  const k = typeof s.rarity === 'string' ? s.rarity : JSON.stringify(s.rarity ?? null);
  rarityCount.set(k, (rarityCount.get(k) ?? 0) + 1);
}
console.log('rarity 分佈：', [...rarityCount.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join('　'));

const evolutions = items.filter((s) => s.evolutionOf);
console.log(`有 \`gene_version\`（固有技嘅**繼承版本**；每個有 \`cost\`）：${evolutions.length}`);
const withPre = items.filter((s) => s.preEvo);
console.log(`有 \`pre_evo\`（**進化技能**：rarity 6 → 前提 base 技）：${withPre.length}`);
console.log(`普通技能（兩樣都冇）：${items.filter((s) => !s.evolutionOf && !s.preEvo).length}`);

// ⭐ 實測：rarity 6 = 進化技能（672 招全部有 pre_evo）、rarity 5 = 固有（馬娘固有技）
const r6 = items.filter((s) => String(s.rarity) === '6');
const r5 = items.filter((s) => String(s.rarity) === '5');
console.log(`rarity 6（進化）：${r6.length}　其中 ${r6.filter((s) => s.preEvo).length} 個有 pre_evo`);
console.log(`rarity 5（固有）：${r5.length}　其中 ${r5.filter((s) => s.evolutionOf).length} 個有 gene_version（＝可以繼承）`);
const withCond = items.filter((s) => list.find((x) => x.id === s.id)?.evo_cond);
console.log(`有 \`evo_cond\`（進化條件）：${withCond.length}`);
if (withPre.length) {
  const raw = list.find((x) => x.id === withPre[0].id);
  console.log(`\`pre_evo\` 樣本（${withPre[0].name}）：${JSON.stringify(raw.pre_evo)}`
    + `${raw.evo_cond ? `　evo_cond=${JSON.stringify(raw.evo_cond).slice(0, 120)}` : ''}`);
}
if (evolutions.length) {
  const e = evolutions[0];
  console.log(`\`gene_version\` 樣本（${e.name}，cost=${e.evolutionOf?.cost ?? '?'}）：`
    + `${JSON.stringify(e.evolutionOf).slice(0, 200)}`);
}

// ── 比對 ──
const r = diffAgainstDb(named.map((s) => s.name), db.skills, normalizeSkillName, gaps.skills);
console.log(`\n比對（只計有名嘅）：候選 ${r.candidates.length}、inDb **${r.inDb.length}**、已記錄 ${r.inGaps.length}、未記錄 **${r.missing.length}**`);
console.log(`即係本專案技能庫（${db.skills.length} 招）覆蓋 GameTora 嘅 ${(r.inDb.length / Math.max(1, r.candidates.length) * 100).toFixed(1)}%`);

const missingSet = new Set(r.missing.map(normalizeSkillName));
const missingItems = items.filter((s) => s.name && missingSet.has(normalizeSkillName(s.name)));
const byRarity = new Map();
for (const m of missingItems) {
  const k = typeof m.rarity === 'string' ? m.rarity : JSON.stringify(m.rarity ?? null);
  byRarity.set(k, (byRarity.get(k) ?? 0) + 1);
}
console.log(`\n缺口 ${missingItems.length} 招，按 rarity：`, [...byRarity.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join('　'));
console.log('\n缺口（頭 60 個；★ = 有進化／繼承版本資訊）：');
for (const m of missingItems.slice(0, 60)) {
  const tag = m.evolutionOf ? '★' : ' ';
  console.log(`   ${tag} ${m.name}${m.nameEn ? `（${m.nameEn}）` : ''}　id=${m.id}　rarity=${typeof m.rarity === 'string' ? m.rarity : JSON.stringify(m.rarity)}`
    + `${m.preEvo ? `　pre_evo=${JSON.stringify(m.preEvo).slice(0, 40)}` : ''}`);
}
if (missingItems.length > 60) console.log(`   …仲有 ${missingItems.length - 60} 個`);

if (flags.has('--json')) {
  console.log(`\n${JSON.stringify({ total: list.length, inDb: r.inDb.length, missing: missingItems }, null, 1).slice(0, 400)}…`);
}

if (flags.has('--write')) {
  const have = new Set(gaps.skills.map((s) => normalizeSkillName(s.name)));
  const add = missingItems.filter((m) => !have.has(normalizeSkillName(m.name))).map((m) => ({
    name: m.name,
    nameEn: m.nameEn ?? null,
    gametoraId: m.id ?? null,
    rarity: typeof m.rarity === 'string' ? m.rarity : m.rarity ?? null,
    desc: m.desc ?? null,
    evolutionOf: m.evolutionOf ?? null,
    preEvo: m.preEvo ?? null,
    effect: null,
    category: '待確認（GameTora 對照；base／Pt 未確認）',
    base: null,
    skillPt: null,
    from: 'data/gametora/skills.json',
  }));
  gaps.skills = [...gaps.skills, ...add].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  gaps.checkedAt = '2026-09-27';
  gaps.gametoraTotal = list.length;
  writeFileSync(gapsPath, `${JSON.stringify(gaps, null, 2)}\n`);
  console.log(`\n✅ 寫咗 ${add.length} 個新缺口 → data/skill-db-gaps.json（合共 ${gaps.skills.length}）`);
}
