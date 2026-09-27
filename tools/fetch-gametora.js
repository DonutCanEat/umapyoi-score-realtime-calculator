#!/usr/bin/env node
/**
 * **由 GameTora 抓技能數據**（唔使用瀏覽器、唔使用人手貼）。
 *
 * 原理（2026-09-27 由 webpack 模組 50840 反推）：
 *   `/data/manifests/umamusume.json` → 攞 `skills` 嘅 hash → `/data/umamusume/skills.<hash>.json`
 *
 * 用法：
 *   node tools/fetch-gametora.js                      # 抓 skills → data/gametora/skills.json（＋摘要）
 *   node tools/fetch-gametora.js --keys=skills,skill_effect_values
 *   node tools/fetch-gametora.js --manifest           # 只印 manifest（睇有咩 key）
 *   node tools/fetch-gametora.js --dry                # 只印解析出嚟嘅 URL，唔寫檔
 *   node tools/fetch-gametora.js --diff               # 抓完即刻同本專案技能庫比對
 *
 * ⚠️ 抓落嚟嘅檔**唔會入 git 做 runtime 資料**（擺 `data/gametora/`）；佢係**外部對照來源**，
 *    要用嘅時候要經 `tools/diff-skill-names.js`／人工核實，唔准當真值（見地圖 #9）。
 * ⚠️ 只讀公開數據（網站自己嘅 `/data/*.json`），唔會登入、唔會寫任何嘢去對方網站。
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { manifestPath, resolveDataUrl } from '../src/umascore/gametora-data.js';
import { normalizeSkillName } from '../src/umascore/whatif.js';
import { diffAgainstDb } from '../src/umascore/skilllist-diff.js';
import { bareFlags, flagValue, toolArgs } from './lib/args.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = toolArgs();
const flags = bareFlags(args);
const BASE = flagValue(args, 'base') ?? 'https://gametora.com';
const GAME = flagValue(args, 'game') ?? 'umamusume';
const keys = (flagValue(args, 'keys') ?? 'skills').split(',').map((s) => s.trim()).filter(Boolean);
const OUT_DIR = join(ROOT, 'data', 'gametora');
const H = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) umapyoi-score-tool', accept: 'application/json,*/*' };

const r1 = await fetch(`${BASE}${manifestPath(GAME)}`, { headers: H });
if (!r1.ok) {
  console.error(`❌ manifest 抓唔到：HTTP ${r1.status}（${manifestPath(GAME)}）`);
  process.exit(1);
}
const manifest = await r1.json();
console.log(`manifest ${manifestPath(GAME)}：${Object.keys(manifest).length} 個 key`);
if (flags.has('--manifest')) {
  for (const [k, v] of Object.entries(manifest)) console.log(`   ${k} = ${v}`);
  process.exit(0);
}

let failed = 0;
for (const key of keys) {
  const { ok, url, reason } = resolveDataUrl(BASE, GAME, key, manifest);
  if (!ok) { console.error(`❌ ${key}：${reason}`); failed += 1; continue; }
  console.log(`\n${key} → ${url}`);
  if (flags.has('--dry')) continue;

  const r = await fetch(url, { headers: H });
  if (!r.ok) { console.error(`   ❌ HTTP ${r.status}`); failed += 1; continue; }
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { console.error(`   ❌ 唔係合法 JSON：${e.message}`); failed += 1; continue; }

  mkdirSync(OUT_DIR, { recursive: true });
  const out = join(OUT_DIR, `${key}.json`);
  writeFileSync(out, `${JSON.stringify(json, null, 1)}\n`);
  const n = Array.isArray(json) ? json.length : Object.keys(json).length;
  console.log(`   ✅ 寫咗 data/gametora/${key}.json（${text.length} bytes，${Array.isArray(json) ? `${n} 項` : `${n} 個 key`}）`);

  if (keys.length === 1 && Array.isArray(json)) {
    const sample = json.slice(0, 3).map((s) => `${s.name ?? s.text ?? '?'}(id=${s.id ?? '?'})`).join(' , ');
    console.log(`   樣本：${sample}`);
    const names = json.map((s) => s.name).filter((s) => typeof s === 'string');
    console.log(`   有名嘅項：${names.length}`);
  }
}

if (flags.has('--diff') && !flags.has('--dry')) {
  const p = join(OUT_DIR, 'skills.json');
  if (!existsSync(p)) { console.error('冇 data/gametora/skills.json，先跑一次抓取'); process.exit(1); }
  const gt = JSON.parse(readFileSync(p, 'utf8'));
  const db = JSON.parse(readFileSync(join(ROOT, 'data', 'skill-db-tw.json'), 'utf8'));
  const gaps = existsSync(join(ROOT, 'data', 'skill-db-gaps.json'))
    ? JSON.parse(readFileSync(join(ROOT, 'data', 'skill-db-gaps.json'), 'utf8')) : { skills: [] };
  const rows = Array.isArray(gt) ? gt : (gt.skills ?? []);
  const names = rows.map((s) => (typeof s === 'string' ? s : s?.name)).filter(Boolean);
  const r = diffAgainstDb(names, db.skills, normalizeSkillName, gaps.skills);
  console.log(`\n比對：GameTora ${names.length} 個名 → 候選 ${r.candidates.length}`
    + `、inDb ${r.inDb.length}、已記錄 ${r.inGaps.length}、**未記錄 ${r.missing.length}**`);
  for (const m of r.missing) console.log(`   ❌ ${m}`);
}

process.exit(failed ? 1 : 0);
