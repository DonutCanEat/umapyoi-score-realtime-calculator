#!/usr/bin/env node
/**
 * 印出「庫項 → 首次出現位置」清單（`data/skill-name-truth.json` 嘅標名工作單）。
 *
 * 為何要：配名係**人手核對**嘅工作（`index.json` 只記頁／列／欄，冇記名），
 * 而冇配名嘅庫項會令 reader 靜默唔出數。所以要有張單，逐個庫項對住
 * `tools/nameboxes-sheet.js` 出嘅放大圖核，核完寫落 `data/skill-name-truth.json`。
 *
 * 用法：
 *   node tools/truth-template.js > data/skill-name-truth.json     # 出模板（名留空）
 *   node tools/truth-template.js --list                           # 只列清單（人睇）
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bareFlags, toolArgs } from './lib/args.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = toolArgs();
const listOnly = bareFlags(args).has('--list');

const indexPath = join(ROOT, 'data', 'skill-name-lib', 'index.json');
const truthPath = join(ROOT, 'data', 'skill-name-truth.json');
const lib = JSON.parse(readFileSync(indexPath, 'utf8'));
const existing = existsSync(truthPath) ? JSON.parse(readFileSync(truthPath, 'utf8')) : null;
const byId = new Map((existing?.items ?? []).map((it) => [it.id, it]));

const items = lib.items.map((it) => {
  const old = byId.get(it.id);
  const entry = {
    id: it.id,
    name: old?.name ?? '',
    firstSeen: `${it.firstSeen.page} 列${it.firstSeen.row + 1}欄${it.firstSeen.col + 1}`,
    occurrences: it.occurrences,
  };
  if (old?.note) entry.note = old.note;
  return entry;
});

if (listOnly) {
  for (const it of items) {
    console.log(`${it.id}　${it.firstSeen}　×${it.occurrences}　${it.name || '（未標）'}`);
  }
  process.exit(0);
}

console.log(JSON.stringify({
  note: '技能名影像庫（data/skill-name-lib/index.json）逐個庫項嘅真值名。⚠️ 一定要人手核過（工具：node tools/nameboxes-sheet.js <頁> → shots/live-debug/<頁>-r*_c*.png 放大圖）；name 一定要係 data/skill-db-tw.json 搵得到嘅名。firstSeen 係 index.json 嘅紀錄，唔准改。',
  generatedBy: 'tools/truth-template.js',
  items,
}, null, 2));
