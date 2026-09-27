/**
 * **C1 what-if 模擬**：加一招技能 → 加幾多評價分、要幾多 Pt、會唔會升級。
 *
 * 呢個檔係**純函數**（零 I/O、零 Electron），所以：
 *   ① `node --test` 直接測得到（核心值唔可以錯 —— 同 `evaluate.js` 一樣係「唯一要 100% 準」）；
 *   ② 將來的 what-if 窗同 `tools/whatif.js` CLI 都係叫呢度，唔會各寫一套。
 *
 * ## 為何「加一招」唔使重算成條評價分公式
 *
 * 評價分 = Σ 五維分 + Σ 技能分，而**技能之間冇互動**（每招嘅分只取決於
 * 自己嘅 base × 自己嘅適性倍率）→ 加一招嘅 Δ 就係嗰招本身嘅分。
 * 但呢個模組**照樣用 `evaluate()` 算 after**（唔係自己加）：
 * 單一公式來源，順便令「after − before === 該招分數」變成一個測試得到嘅不變式
 * （一旦 `aptitude.js` 同 `skills.js` 走樣，測試即刻紅）。
 *
 * ## 適性（最易錯嘅位）
 *
 * 用戶要為技能條件入面**每一類**揀等級（腳質／距離），規則見 `aptitude.js`
 * （同類取最大、跨類別相乘、**草地／沙地唔乘**、通用技能 ×1.0）。
 * ⚠️ 唔准喺呢度自己乘 —— 一律經 `aptitudesFor()`。
 *
 * ## Pt
 *
 * 技能庫嘅 `skillPt` 就係遊戲「點技能」要嘅 Pt（實測：通用技能 360、固有 0）。
 * ⚠️ `skillPt = 0` 係**劇本進化技能**（唔使 Pt 但**有**評價分，可以係負數）——
 * 唔可以當「冇資料」。
 */

import { evaluate } from './evaluate.js';
import { normalSkillPoints } from './skills.js';
import {
  aptitudeKeyOf,
  aptitudesFor,
  groupHits,
  multiplierForGrades,
} from './aptitude.js';

/**
 * 技能名正規化：遊戲畫面同 wiki 用嘅標點可以唔同。
 *
 * ⚠️ 同 `tools/fill-ground-truth.js` 嗰條**一樣**（嗰邊係喺長技能清單入面比對技能名，
 * 一樣會撞到標點問題）。保持兩邊一致係刻意嘅 —— 但唔急住抽共用，
 * 因為兩者嘅用途（搜尋 vs 對答案）同容錯要求唔同；改嘅時候要一齊改。
 *
 * 實例：遊戲「競賽的精髓・體能」(U+30FB) vs wiki「競賽的精髓．體能」(U+FF0E)。
 *
 * @param {string} name
 * @returns {string}
 */
export function normalizeSkillName(name) {
  return String(name ?? '')
    .replace(/[\u30FB\uFF0E\u00B7\u2027\u2022\uFF65·．・.]/g, '')
    .replace(/[\s\u3000（）()［］\[\]〜~]/g, '')
    .toLowerCase();
}

/**
 * 喺技能庫入面搜尋（名／簡體名都搵；標點唔同都搵得到）。
 *
 * 為何要自己一個（唔用陣列 `filter` 一句）：搜尋係 what-if 窗最主要嘅互動，
 * 而「打『精髓體能』要搵到『競賽的精髓・體能』」呢種行為一定要有測試守住。
 * 排序：**開頭命中優先**（打「弧線」想先見到「弧線的教授」而唔係「曲線的…」），
 * 然後名短嘅先（＝更似精確命中），最後按名排序（結果穩定，唔會每次唔同）。
 *
 * @param {Array<{name?:string, simplifiedName?:string, base?:number}>} skills 技能庫
 * @param {string} query 用戶打嘅字
 * @param {{limit?:number}} [options]
 * @returns {Array<object>} 最多 `limit` 個（預設 20）；空白查詢 → `[]`（唔准倒 1300 條出嚟）
 */
export function searchSkills(skills, query, options = {}) {
  const limit = Number.isFinite(options.limit) ? Number(options.limit) : 20;
  const needle = normalizeSkillName(query);
  if (!needle) return [];
  const hits = [];
  for (const skill of skills ?? []) {
    const names = [skill?.name, skill?.simplifiedName].filter(Boolean).map(normalizeSkillName);
    const index = names.findIndex((n) => n.includes(needle));
    if (index < 0) continue;
    hits.push({ skill, starts: names[index].startsWith(needle) ? 0 : 1, len: names[index].length });
  }
  hits.sort((a, b) => a.starts - b.starts
    || a.len - b.len
    || String(a.skill.name ?? '').localeCompare(String(b.skill.name ?? '')));
  return hits.slice(0, Math.max(0, limit)).map((h) => h.skill);
}

/**
 * 由「每一類揀咗嘅等級」砌出 `aptitude.js` 要嘅適性表。
 *
 * 例如技能條件係「前列, 中距離」而用戶揀 `{腳質:'S', 距離:'A'}`
 * → `{前列:'S', 中距離:'A'}`（key 用**條件字串入面真正出現嘅關鍵字**，
 * 所以 `大逃` 呢類同義詞都會照樣查到 `領頭` 嗰格 —— 見 `aptitudeKeyOf()`）。
 *
 * @param {string} condition
 * @param {Record<string,'S'|'A'|'B'|'C'|'D'|'E'|'F'|'G'>} grades 例：`{腳質:'S', 距離:'A'}`
 * @returns {Record<string,string>}
 */
export function aptitudeMapFor(condition, grades = {}) {
  const map = {};
  for (const hit of groupHits(condition)) {
    const grade = grades?.[hit.key];
    if (grade) map[aptitudeKeyOf(hit.keyword)] = grade;
  }
  return map;
}

/**
 * 搜尋技能 → **IPC 用嘅條目**（`key` 係技能庫 index）。
 *
 * 為何要喺核心庫砌（而唔係喺 `electron/main.js` 砌）：`main.js` import 咗 `electron`
 * → **入唔到 `node --test`**，呢段「搜尋結果 → 窗要用嘅欄位」就變成零覆蓋；
 * 而佢有兩個真陷阱（兩邊都靜默）：
 *   ① `key` 一定要係**技能庫 index**（窗只可以傳 key 返嚟，唔准傳 base 上嚟自己計）；
 *   ② `skillPt` 缺席一定要 `null`，**唔可以**當 0（0 係劇本進化技能嘅真值）。
 *
 * @param {Array<object>} skills 技能庫
 * @param {string} query
 * @param {{limit?:number}} [options]
 * @returns {Array<{key:number,name:string,condition:string,base:number,skillPt:number|null,
 *                  groups:Array<{key:string,keyword:string}>}>}
 */
export function skillSearchItems(skills, query, options = {}) {
  return searchSkills(skills, query, options).map((skill) => ({
    key: (skills ?? []).indexOf(skill),
    name: skill?.name ?? '',
    condition: skill?.condition ?? '',
    base: Number(skill?.base),
    skillPt: Number.isFinite(Number(skill?.skillPt)) ? Number(skill.skillPt) : null,
    groups: groupHits(skill?.condition ?? ''),
  }));
}

/**
 * 驗「窗傳上嚟嘅五維」（**唔可信輸入**）。
 *
 * 為何要驗：what-if 窗**容許用戶自己打字**（唔開遊戲一樣試算得到），
 * 所以嗰五個數唔係嚟自擷取，而係嚟自一個可以亂打嘅輸入框。
 * 屬性上限係 2000（`tables.js` `STAT_MAX`）→ 超出範圍／NaN 一律當唔合法（唔准靜默夾）。
 *
 * @param {unknown} raw
 * @returns {number[]} 五個 0–2000 嘅數字
 */
export function parseStatInput(raw) {
  if (!Array.isArray(raw) || raw.length !== 5) {
    throw new Error(`五維要係 5 個數字，實得 ${JSON.stringify(raw)}`);
  }
  const stats = raw.map((v) => Number(v));
  for (const [i, v] of stats.entries()) {
    if (!Number.isFinite(v) || v < 0 || v > 2000) {
      throw new Error(`五維第 ${i + 1} 個要係 0–2000 嘅數字，實得 ${JSON.stringify(raw[i])}`);
    }
  }
  return stats;
}

/**
 * 把「用戶打／貼上嘅一大串技能名」切開做一項一項。
 *
 * ⚠️⚠️ **逗號唔可以當分隔符**：技能庫實測有 **17 招自己個名含逗號**
 * （全形 `，` 同半形都有：`好，要上啦！`、`來，跟我一起做吧！`、`看過來，好戲開始了！`、
 * `小菜一碟，輕而易舉♪`、`我不會、放棄的～！`、`不焦急、不逞強`…）——
 * 一用逗號切，呢啲招就會**靜默變咗另一招或者認唔到**（實測 bug：`好，要上啦！` → `好` → `好鬥`）。
 * 所以採用嘅慣例係「**一行一招**」（遊戲清單本來就係一行一招，複製落嚟天然係咁）。
 *
 * 規則：按 換行／tab／分號 切 → trim → 丟空項（保留重複項，交由 `resolveSkillList()`
 * 按「庫項」去重 —— 因為 `直線` 同 `直线` 係同一招，用字串比對會當兩招）。
 *
 * @param {string} text
 * @returns {string[]} 每一項技能名（原樣，未正規化、未去重）
 */
export function splitSkillList(text) {
  return String(text ?? '')
    .split(/[;；\t\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 逐項技能名 → 技能庫條目。
 *
 * ⚠️ **唔准亂猜**（三條規則，全部都要有測試守住）：
 *   ① 正規化後**完全相等** → 用嗰個（唯一解）；
 *   ② 冇完全相等、而**只有一個**候選，而且用戶打嘅字係候選名嘅一部分 → 用嗰個（＝縮寫）；
 *   ③ 其餘（零候選／多個候選）→ `unresolved: true` ＋ 列出候選，**唔計分**。
 *      ⚠️ 以前「冇完全相等就當第一個命中」係**靜默認錯招**（實測：`好` → `好鬥`）。
 *
 * @param {Array<object>} skills 技能庫（`data/skill-db-tw.json` 嘅 `skills`）
 * @param {string} text 用戶打／貼嘅一串技能名（一行一招）
 * @returns {{
 *   items: Array<{query:string, skill:object|null, resolved:boolean, ambiguous:boolean, candidates:string[]}>,
 *   duplicates: string[], unresolved: string[]
 * }}
 */
export function resolveSkillList(skills, text) {
  const items = [];
  const unresolved = [];
  const duplicates = [];
  const seenSkill = new Set();

  for (const query of splitSkillList(text)) {
    const needle = normalizeSkillName(query);
    // ① 正規化後完全相等 —— ⚠️ **一定要喺全庫搵**，唔可以淨係睇 `searchSkills()` 嘅前幾個：
    //    實測 `直線加速` 因為「開頭命中優先」嘅排序，會被「中距離直線◎」等名擠出前 10 名
    //    → 用前幾個嚟判「完全相等」會靜默認成另一招。
    const exact = needle
      ? (skills ?? []).filter((s) => [s?.name, s?.simplifiedName]
        .filter(Boolean)
        .some((n) => normalizeSkillName(n) === needle))
      : [];
    const hits = searchSkills(skills, query, { limit: 10 });
    // ② 唯一候選 ＋ 係候選名嘅一部分（縮寫，例：`弧線的教授` → `弧線的教授` 嘅前綴）
    const typed = hits.length === 1
      && [hits[0].name, hits[0].simplifiedName].filter(Boolean)
        .some((n) => normalizeSkillName(n).includes(needle));
    const skill = exact[0] ?? (typed ? hits[0] : null);
    const candidates = hits.slice(0, 5).map((s) => s?.name ?? '');
    const ambiguous = !skill && hits.length > 1;
    if (!skill) unresolved.push(query);

    // 同一招出現兩次 → 第二個當重複（唔准計兩次分）。
    // ⚠️ 用**庫項名**做 key（唔係用 query 字串）：`直線` 同 `直线` 係同一招，
    //    用字串比對會當兩招 → 靜默計兩次分。
    if (!skill) { items.push({ query, skill: null, resolved: false, ambiguous, candidates }); continue; }

    const key = normalizeSkillName(skill.name);
    if (seenSkill.has(key)) { duplicates.push(query); continue; }
    seenSkill.add(key);

    items.push({ query, skill, resolved: true, ambiguous: false, candidates: [] });
  }

  return { items, duplicates, unresolved };
}

/**
 * 一個技能（＋用戶揀嘅適性）→ 佢自己嘅評價分。
 *
 * @param {{base:number, condition?:string}} skill
 * @param {Record<string,string>} [grades] 每一類嘅等級（見 `aptitudeMapFor()`）
 * @returns {number} 已四捨五入（同遊戲顯示一致）
 */
export function skillPointsFor(skill, grades = {}) {
  const condition = skill?.condition ?? '';
  return normalSkillPoints(skill?.base, aptitudesFor(condition, aptitudeMapFor(condition, grades)));
}

/** 只計分數嘅嗰部分（`evaluate()` 回好多嘢，呢度只抽要顯示嘅）。 */
function scoreOf(player) {
  const result = evaluate(player);
  return {
    statScore: result.statScore,
    skillScore: result.skillScore,
    total: result.total,
    rank: result.rank,
    nextRank: result.nextRank,
  };
}

/**
 * ⭐ 主菜：「而家嘅狀態」＋「想加嘅一招」＋「嗰招嘅適性」→ 加幾多分／夠唔夠升級。
 *
 * @param {object} [player] 現況。⚠️ **唔使**俾曬全部嘢：
 *        淨係得五維（HUD 讀到嘅嘢）就傳 `{stats:[…]}` —— 咁 `before.total` 就係五維分，
 *        同 HUD 顯示嘅「評價點」一致（技能未讀到之前係咁，見 AGENTS §6.2）。
 * @param {{base:number, condition?:string, name?:string, skillPt?:number}} skill 想加嘅技能
 * @param {Record<string,string>} [grades] 每一類適性等級（例：`{腳質:'A', 距離:'A'}`）
 * @returns {{
 *   name:string|null, base:number, condition:string, pt:number|null,
 *   groups:Array<{key:string, keyword:string, grade:string|null}>,
 *   aptitudes:string[], multiplier:number, points:number,
 *   before:object, after:object, rankUp:boolean, gapBefore:number|null, gapAfter:number|null,
 *   reached:boolean
 * }}
 */
export function whatIfAddSkill(player = {}, skill, grades = {}) {
  if (!skill || !Number.isFinite(Number(skill.base))) {
    throw new Error(`what-if 要一個有 base 嘅技能，實得 ${JSON.stringify(skill)}`);
  }
  const condition = skill.condition ?? '';
  const map = aptitudeMapFor(condition, grades);
  const aptitudes = aptitudesFor(condition, map);
  const points = normalSkillPoints(skill.base, aptitudes);

  const before = scoreOf(player);
  // 照樣用 evaluate() 計 after（單一公式來源，見檔頭註解）
  const after = scoreOf({
    ...player,
    skills: [...(player.skills ?? []), { base: skill.base, aptitudes }],
  });

  const gapBefore = before.nextRank?.gap ?? null;
  const gapAfter = after.nextRank?.gap ?? null;
  return {
    name: skill.name ?? null,
    base: Number(skill.base),
    condition,
    // ⚠️ `skillPt` 缺席 → null（唔知），**唔可以**當 0（0 係「劇本進化技能」嘅真值）
    pt: Number.isFinite(Number(skill.skillPt)) ? Number(skill.skillPt) : null,
    groups: groupHits(condition).map((hit) => ({
      ...hit,
      grade: map[aptitudeKeyOf(hit.keyword)] ?? null,
    })),
    aptitudes,
    multiplier: multiplierForGrades(aptitudes),
    points,
    before,
    after,
    rankUp: before.rank !== after.rank,
    gapBefore,
    gapAfter,
    // 加呢招之後已經係最高ランク（`after.nextRank === null`）—— 同「仲差幾多」係兩件事
    reached: after.nextRank === null,
  };
}

/**
 * ⭐ 文字批量版：`--skills=`／貼上一大串技能名 → **一次過**算總分同每招嘅邊際分。
 *
 * 為何唔係「逐招叫 `whatIfAddSkill()` 加埋」就算：
 *   ① 總分一定要由 `evaluate()` **全量重算一次**（單一公式來源，同 `whatIfAddSkill` 一樣做法）
 *      → 順便令「Σ 邊際分 vs 全量 Δ」變成一個測得到嘅不變式（走樣即刻紅）；
 *   ② 適性係**逐招**計（唔同招條件唔同），所以 `grades` 照舊逐招傳落 `whatIfAddSkill()`。
 *
 * ⚠️ `pointsByIdx` 只計 `normalSkillPoints`（普通技能路線）；技能庫有 `base` 嘅招全部適用。
 * ⚠️ 「Σ 邊際分」同「全量 Δ」理論上會有 ≤1 分差距（逐招四捨五入 vs 全量先加後捨）——
 *    所以 `sumMismatch` 係一個**會回報**嘅欄位，唔准靜默當佢一定係 0。
 *
 * @param {object} [player] 現況（最少 `{stats:[…]}`；有 `skills` 就一齊計）
 * @param {Array<{skill:object|null}>} items 由 `resolveSkillList()` 嚟（未解析嘅項會被略過）
 * @param {Record<string,string>} [grades] 適性等級（例：`{腳質:'S', 距離:'A'}`）
 * @returns {{
 *   skills: object[], entries: object[],
 *   before: object, after: object, delta: number, sumPoints: number, sumMismatch: number,
 *   rankUp: boolean
 * }}
 */
export function whatIfSkillList(player = {}, items = [], grades = {}) {
  const usable = (items ?? []).filter((it) => it?.skill && Number.isFinite(Number(it.skill.base)));
  const entries = usable.map((it) => ({
    query: it.query ?? null,
    assumed: [],
    result: whatIfAddSkill(player, it.skill, grades),
  }));
  const built = entries.map(({ result }) => ({ base: result.base, aptitudes: result.aptitudes }));

  const before = scoreOf(player);
  // ⚠️ 全量一次過（唔係用 `whatIfAddSkill` 嘅 after 疊埋）
  const after = scoreOf({ ...player, skills: [...(player.skills ?? []), ...built] });
  const sumPoints = entries.reduce((sum, e) => sum + e.result.points, 0);

  return {
    skills: usable.map((it) => it.skill),
    entries,
    before,
    after,
    delta: after.total - before.total,
    sumPoints,
    sumMismatch: (after.total - before.total) - sumPoints,
    rankUp: before.rank !== after.rank,
  };
}
