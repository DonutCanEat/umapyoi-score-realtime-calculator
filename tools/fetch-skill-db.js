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
 *   node tools/fetch-skill-db.js --dry-run    # 只報告會寫咩，**一個位元組都唔寫**
 *   node tools/fetch-skill-db.js --force      # 庫縮水都照覆寫（跳過守門）
 *
 * 輸出：data/skill-db-<lang>.json
 *
 * ⚠️ **唔會靜默縮庫**（設計審查 2026-09-28 L6）：以前解析完就直接覆寫主資料庫
 *    （1589 招、62 萬 bytes，整個計分核心嘅唯一來源）—— 上游改版或者 WAF 回一段
 *    唔完整嘅 HTML，只要唔係「零個技能」就照寫，而大部分測試只檢查「庫存在而且非空」
 *    → 靜默縮水可以一路入到 commit。而家：
 *    ① 寫入前經 `tools/lib/skill-db-guard.js` 嘅 `decideDbReplace()` 對「絕對下限」
 *       ＋「歷史高位（`maxCount`）」—— 跌穿就 **exit 1，唔寫檔**，要 `--force` 先過；
 *    ② 覆寫之前**先備份**去 `data/backups/`（唔入 git）；
 *    ③ 新庫會記住 `maxCount`（見過最多幾多招），所以連「上游真係刪招」都攔得住。
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { flagValue, hasFlag } from './lib/args.js';
import { decideDbReplace, previousDbInfoFromText, planDbWrite, backupPathFor } from './lib/skill-db-guard.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const API = 'https://wiki.biligame.com/umamusume/api.php';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/**
 * 絕對下限（**唔准**降）：由 bwiki 個計算器頁而家穩定 render 出 ~1300 招，
 * 2026-09-27 補庫之後主庫係 1589 招。歷史上呢個數從來冇跌過；
 * 設 1000 嘅意思係「跌到呢個位以下一定係解析出問題，唔係上游真係刪招」。
 * ⚠️ 呢個門檻**唔准**因為「跑唔過」而調低 —— 要嘅係 `--force`，唔係調門檻。
 */
const MIN_SKILL_COUNT = 1000;


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
    dryRun: hasFlag(argv, 'dry-run'),
    force: hasFlag(argv, 'force'),
  };
}

/** 解析一句 `var skraw={ "k":v, ... }; skillData.push(skraw);` */
const SKRAW_RE = /var\s+skraw\s*=\s*\{([\s\S]*?)\}\s*;\s*skillData\.push\(skraw\)/g;
const PAIR_RE = /"([^"]+)"\s*:\s*(?:"((?:[^"\\]|\\.)*)"|parseInt\("(-?\d+)"\)|(-?\d+(?:\.\d+)?))/g;

/**
 * `颜色` **值**嘅簡 → 繁對照（bwiki 係簡體 wiki）。
 *
 * ⚠️ 為何要喺度轉：本專案其餘文字一律繁體；`color` 係顯示用元資料
 *    （目前冇任何程式讀），但留住簡體會令「全 repo 繁體」嘅約定穿窿，
 *    而且 `npm.cmd run fetch` 之後會**靜默還原**做簡體。
 * ⚠️ 只轉**值**：`raw['颜色']` 個 **key 唔准改** —— 佢係 bwiki 嘅欄位名，
 *    改咗就連 API 都對唔上（同 `繁中评分计算器`／`评价分` 一樣道理）。
 */
const COLOR_TW = Object.freeze({ 黄色: '黃色', 绿色: '綠色', 蓝色: '藍色', 红色: '紅色' });

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
      color: COLOR_TW[raw['颜色']] ?? raw['颜色'] ?? null,
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

const { lang, refresh, dryRun, force } = parseArgs(process.argv.slice(2));
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

// ── 寫入守門（設計審查 2026-09-28 L6）──────────────────────────────────────
// 決策／砌檔／備份名一律住喺 `tools/lib/skill-db-guard.js`（純函數、有測試）；
// 呢度只負責 I/O 同 exit code。
const dbText = existsSync(dbPath) ? readFileSync(dbPath, 'utf8') : null;
let previous;
try {
  previous = previousDbInfoFromText(dbText);
} catch (error) {
  // ⛔ 現有庫壞咗唔准當「冇庫」（當咗就等於守門失效）→ 直接收工，唔覆寫。
  process.stderr.write(`⛔ 讀唔到現有庫（${dbPath}）：${error.message}\n`);
  process.stderr.write('   （個庫壞咗本身就係要人睇一眼嘅事 —— 修好或者刪走之後再跑）\n');
  process.exit(1);
}
const { previousCount, maxCount } = previous;
const decision = decideDbReplace({
  count: skills.length,
  previousCount,
  maxCount,
  minCount: MIN_SKILL_COUNT,
  force,
});

console.log(`解析到 ${skills.length} 招；現有庫 ${previousCount ?? '(冇)'} 招、歷史高位 ${decision.peak || '(冇)'} 招`);

if (!decision.ok) {
  process.stderr.write(`⛔ 唔寫檔：${decision.detail}\n`);
  process.stderr.write('   （呢個守門係防止上游改版／WAF 令個庫靜默縮水 —— 真係要覆寫就加 --force）\n');
  process.exit(1);
}
if (decision.reason === 'force') {
  console.log(`⚠️ 跳過縮水守門（--force）：${decision.detail}`);
}

const nextDb = planDbWrite({
  lang,
  source: `${API}?action=parse&page=${config.title}`,
  count: skills.length,
  conditions,
  skills,
  peak: decision.peak,
});

if (dryRun) {
  console.log(`🔎 --dry-run：唔會寫檔。打算寫 ${dbPath}（${skills.length} 招）`);
  if (missingBase > 0) console.log(`⚠️ ${missingBase} 個技能冇評價分`);
  console.log(`條件限制種類：${Object.entries(conditions).map(([k, v]) => `${k || '(空)'}×${v}`).join('  ')}`);
  process.exit(0);
}

// 覆寫前先備份（唔入 git；`data/backups/` 已喺 .gitignore）。
if (existsSync(dbPath)) {
  const backupDir = join(ROOT, 'data', 'backups');
  mkdirSync(backupDir, { recursive: true });
  // ⚠️ `backupPathFor()` 用 `/` 砌路徑（同 repo 其他地方一致），所以 `taken` 都要係 `/`。
  const backupDirSlash = backupDir.replace(/\\/g, '/');
  const taken = readdirSync(backupDir).map((name) => `${backupDirSlash}/${name}`);
  const backupPath = backupPathFor({ dir: backupDirSlash, lang, when: new Date(), taken });
  copyFileSync(dbPath, backupPath);
  console.log(`🗄️  舊庫已備份 → ${backupPath}`);
}

writeFileSync(dbPath, `${JSON.stringify(nextDb, null, 2)}\n`, 'utf8');

console.log(`✅ ${skills.length} 個技能 → ${dbPath}`);
if (missingBase > 0) console.log(`⚠️ ${missingBase} 個技能冇評價分`);
console.log(`條件限制種類：${Object.entries(conditions).map(([k, v]) => `${k || '(空)'}×${v}`).join('  ')}`);
