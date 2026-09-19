#!/usr/bin/env node
/**
 * 由 bwiki（賽馬娘 WIKI）拎技能評價分資料庫。
 *
 * 背景：`繁中评分计算器` 用 `{{#ask: [[分类:繁中技能]] ... |template=Calc_skillData_fan}}`
 * 把全部技能 render 成一句句 `skillData.push(skraw)`。所以**只需要一個 request**，
 * 拎渲染好嘅頁面就已經有齊 ~1000 個技能（逐個 query 打會被 WAF 擋，HTTP 567）。
 *
 * 用法：
 *   node tools/fetch-skill-db.js              # 有 cache 就用 cache
 *   node tools/fetch-skill-db.js --refresh    # 強制重新下載
 *   node tools/fetch-skill-db.js --lang=cn    # 簡中版
 *
 * 輸出：data/skill-db-<lang>.json
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { flagValue, hasFlag } from './lib/args.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const API = 'https://wiki.biligame.com/umamusume/api.php';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const PAGES = {
  tw: { title: '繁中评分计算器', nameKey: '技能名', pointKey: '评价分' },
  cn: { title: '评分计算器', nameKey: '技能名', pointKey: '评价分' },
};

function parseArgs(argv) {
  // ⚠️ 值／旗標讀法住喺 `tools/lib/args.js`（審計 M6）；呢度保留 `parseArgs()` 嘅形狀
  //    （回 `{lang, refresh}`），因為呼叫點同測試都用呢個名。
  return {
    lang: flagValue(argv, 'lang') ?? 'tw',
    refresh: hasFlag(argv, 'refresh'),
  };
}

/** 解析一句 `var skraw={ "k":v, ... }; skillData.push(skraw);` */
const SKRAW_RE = /var\s+skraw\s*=\s*\{([\s\S]*?)\}\s*;\s*skillData\.push\(skraw\)/g;
const PAIR_RE = /"([^"]+)"\s*:\s*(?:"((?:[^"\\]|\\.)*)"|parseInt\("(-?\d+)"\)|(-?\d+(?:\.\d+)?))/g;

function parseSkills(html) {
  const skills = [];
  for (const match of html.matchAll(SKRAW_RE)) {
    const body = match[1];
    const raw = {};
    for (const pair of body.matchAll(PAIR_RE)) {
      const [, key, strValue, intValue, numValue] = pair;
      if (strValue !== undefined) raw[key] = strValue.replace(/\\"/g, '"');
      else if (intValue !== undefined) raw[key] = Number(intValue);
      else raw[key] = Number(numValue);
    }
    const base = Number(String(raw['评价分'] ?? '').replace(/[^\d.-]/g, ''));
    skills.push({
      id: Number(raw.id) || null,
      groupId: Number(raw.group_id) || null,
      name: raw['技能名'] ?? null,
      simplifiedName: raw['中文名'] ?? null,
      // 條件限制字串，例如「前列」「短距離」「通用」
      condition: String(raw['条件限制'] ?? '').trim(),
      // 基礎評價分（未乘適性倍率）
      base: Number.isFinite(base) ? base : null,
      skillPt: Number(raw['所需技能PT']) || null,
      special: Number(raw['特殊']) || 0,
      type: Number(raw['类型']) || null,
      color: raw['颜色'] ?? null,
      icon: raw['图标'] ?? null,
    });
  }
  // 移除重複 id
  const byId = new Map();
  for (const skill of skills) {
    if (skill.id === null) continue;
    if (!byId.has(skill.id)) byId.set(skill.id, skill);
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

async function fetchPage(title, attempt = 0) {
  const url = `${API}?action=parse&format=json&prop=text&page=${encodeURIComponent(title)}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Referer: `https://wiki.biligame.com/umamusume/${encodeURIComponent(title)}`,
    },
  });
  const text = await response.text();
  if (response.status !== 200 || !text.startsWith('{')) {
    if (attempt < 3) {
      const wait = 5000 * (attempt + 1);
      process.stderr.write(`  HTTP ${response.status}，${wait / 1000}s 後重試…\n`);
      await new Promise((resolve) => setTimeout(resolve, wait));
      return fetchPage(title, attempt + 1);
    }
    throw new Error(`拎唔到頁面：HTTP ${response.status}`);
  }
  const payload = JSON.parse(text);
  return payload?.parse?.text?.['*'] ?? '';
}

const { lang, refresh } = parseArgs(process.argv.slice(2));
const config = PAGES[lang];
if (!config) throw new Error(`未知語言：${lang}`);

const cachePath = join(ROOT, 'data', `calc-page-${lang}.html`);
const dbPath = join(ROOT, 'data', `skill-db-${lang}.json`);
mkdirSync(dirname(dbPath), { recursive: true });

let html;
if (!refresh && existsSync(cachePath)) {
  html = readFileSync(cachePath, 'utf8');
  process.stderr.write(`用 cache：${cachePath}（${html.length} bytes）\n`);
} else {
  process.stderr.write(`下載 ${config.title}…\n`);
  html = await fetchPage(config.title);
  writeFileSync(cachePath, html, 'utf8');
}

const skills = parseSkills(html);
if (skills.length === 0) throw new Error('解析唔到任何技能，頁面格式可能改咗');

const missingBase = skills.filter((skill) => skill.base === null).length;
const conditions = {};
for (const skill of skills) {
  conditions[skill.condition || '(空)'] = (conditions[skill.condition || '(空)'] ?? 0) + 1;
}

writeFileSync(
  dbPath,
  `${JSON.stringify({
    lang,
    source: `${API}?action=parse&page=${config.title}`,
    fetchedAt: new Date().toISOString(),
    count: skills.length,
    conditions,
    skills,
  }, null, 2)}\n`,
  'utf8',
);

console.log(`✅ ${skills.length} 個技能 → ${dbPath}`);
if (missingBase > 0) console.log(`⚠️ ${missingBase} 個技能冇評價分`);
console.log(`條件限制種類：${Object.entries(conditions).map(([k, v]) => `${k || '(空)'}×${v}`).join('  ')}`);
