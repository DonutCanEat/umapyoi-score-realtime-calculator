#!/usr/bin/env node
/**
 * **由 bwiki「每招一頁」抓技能資料（含基礎評價分 `base`）**。
 *
 * ## 為何需要（2026-09-27）
 *
 * · `繁中评分计算器`（`tools/fetch-skill-db.js`）**只有 1323 招** → 同 GameTora（1910 項）
 *   一比就知**真正缺口 587 招**（r1×103、r2×61、r3×22、r4×22、r5 固有×250、r6 進化×129）。
 * · bwiki 另有**每招一頁**：命名空間 `繁/` **2135 頁** ＋ `继承技/` **269 頁**，
 *   頁面文字**有「评价分」**（＝`base`）＋「共需技能PT」＋稀有度／前置／可進化。
 * · GameTora **冇** base（278 個 manifest key 都冇）→ **bwiki 係唯一來源**。
 *
 * ## 收藏同禮貌
 *
 * · 逐頁 cache（`data/bwiki-pages/<安全檔名>.json`）→ **可以斷點續跑**（Ctrl+C 之後再跑唔會重抓）。
 * · 每頁之間 sleep（預設 900ms）—— 打太密會被 WAF 擋（HTTP 567，見 `fetch-skill-db.js` 註釋）。
 *
 * 用法：
 *   node tools/fetch-bwiki-skill-pages.js                 # 全部（繁/ ＋ 继承技/）
 *   node tools/fetch-bwiki-skill-pages.js --limit=50      # 只抓頭 50 頁（試跑）
 *   node tools/fetch-bwiki-skill-pages.js --only=繁/       # 只抓某個前綴
 *   node tools/fetch-bwiki-skill-pages.js --delay=1500    # 慢啲（被擋就用）
 *   node tools/fetch-bwiki-skill-pages.js --titles=names.txt   # 只抓指定頁名（一行一個）
 *
 * ⚠️ 一次過抓 2400 頁大約 **40 分鐘**（900ms × 2400）→ 建議 `run_in_background: true`。
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSkillPage } from '../src/umascore/bwiki-skill-page.js';
import { bareFlags, flagValue, toolArgs } from './lib/args.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = toolArgs();
const flags = bareFlags(args);
const API = 'https://wiki.biligame.com/umamusume/api.php';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';
const H = { 'User-Agent': UA, Referer: 'https://wiki.biligame.com/umamusume/' };
const DELAY = Number(flagValue(args, 'delay') ?? 900);
const LIMIT = Number(flagValue(args, 'limit') ?? 0);
const ONLY = flagValue(args, 'only');
const OUT = join(ROOT, 'data', 'bwiki-skill-pages.json');
const CACHE = join(ROOT, 'data', 'bwiki-pages');
mkdirSync(CACHE, { recursive: true });

const safe = (title) => `${title.replace(/[/\\:*?"<>|]/g, '_')}.json`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiJson(params, attempt = 0) {
  const url = `${API}?format=json&${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: H });
  const text = await res.text();
  if (!text.startsWith('{')) {
    if (attempt < 3) {
      const wait = 5000 * (attempt + 1);
      process.stderr.write(`  ⚠️ HTTP ${res.status}，${wait / 1000}s 後重試…\n`);
      await sleep(wait);
      return apiJson(params, attempt + 1);
    }
    throw new Error(`API 唔通：HTTP ${res.status}`);
  }
  return JSON.parse(text);
}

/** 抓某個前綴嘅全部頁名。 */
async function listPages(prefix) {
  const titles = [];
  let cont = null;
  do {
    const r = await apiJson({ action: 'query', list: 'allpages', apprefix: prefix, aplimit: '500', ...(cont ? { apcontinue: cont } : {}) });
    for (const p of r?.query?.allpages ?? []) titles.push(p.title);
    cont = r?.continue?.apcontinue ?? null;
  } while (cont);
  return titles;
}

const prefixes = ONLY ? [ONLY] : ['繁/', '继承技/'];
const TITLES = flagValue(args, 'titles');
const titles = [];
if (TITLES) {
  // 由檔案讀指定頁名（一行一個；`#` 開頭同空行當註釋）—— 用嚟只補某批缺口。
  const file = TITLES.includes('\\') || TITLES.includes('/') ? TITLES : join(ROOT, TITLES);
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (t && !t.startsWith('#')) titles.push(t);
  }
  console.log(`由 ${TITLES} 讀到 ${titles.length} 個頁名`);
} else {
  for (const p of prefixes) {
    const list = await listPages(p);
    console.log(`「${p}」${list.length} 頁`);
    titles.push(...list);
    await sleep(DELAY);
  }
}
const target = LIMIT > 0 ? titles.slice(0, LIMIT) : titles;
console.log(`\n要抓 ${target.length} 頁（delay ${DELAY}ms → 約 ${(target.length * DELAY / 60000).toFixed(0)} 分鐘）`);

const results = [];
let fetched = 0;
let cached = 0;
let failed = 0;
for (const [i, title] of target.entries()) {
  const cachePath = join(CACHE, safe(title));
  if (existsSync(cachePath)) {
    try { results.push(JSON.parse(readFileSync(cachePath, 'utf8'))); cached += 1; continue; } catch { /* 壞 cache → 重抓 */ }
  }
  try {
    const j = await apiJson({ action: 'parse', prop: 'text', page: title });
    const html = j?.parse?.text?.['*'] ?? '';
    if (!html) { failed += 1; process.stderr.write(`❌ ${title}：冇內容\n`); continue; }
    const parsed = { ...parseSkillPage(html, { title }), pageTitle: title, htmlBytes: html.length };
    writeFileSync(cachePath, `${JSON.stringify(parsed)}\n`);
    results.push(parsed);
    fetched += 1;
  } catch (e) {
    failed += 1;
    process.stderr.write(`❌ ${title}：${e.message}\n`);
  }
  if ((i + 1) % 25 === 0) {
    process.stdout.write(`  進度 ${i + 1}/${target.length}（新抓 ${fetched}、cache ${cached}、失敗 ${failed}）\n`);
  }
  await sleep(DELAY);
}

const withBase = results.filter((r) => r.base !== null).length;
const byKind = new Map();
for (const r of results) byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1);

writeFileSync(OUT, `${JSON.stringify({
  source: `${API}?action=parse&page=<繁/技能名>`,
  fetchedAt: new Date().toISOString(),
  count: results.length,
  withBase,
  byKind: Object.fromEntries(byKind),
  skills: results,
}, null, 1)}\n`);

console.log(`\n✅ ${results.length} 頁 → data/bwiki-skill-pages.json（新抓 ${fetched}、cache ${cached}、失敗 ${failed}）`);
console.log(`   有 base（评价分）：${withBase}／${results.length}`);
console.log(`   種類：${[...byKind.entries()].map(([k, v]) => `${k}×${v}`).join(' ')}`);
if (flags.has('--samples')) {
  console.log('\n樣本：');
  for (const r of results.slice(0, 10)) console.log(`   ${r.nameTw} base=${r.base} PT=${r.skillPt} kind=${r.kind}`);
}
