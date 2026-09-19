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
 * 用戶要為技能條件入面**每一類**揀等級（脚質／距離），規則見 `aptitude.js`
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
 * 例如技能條件係「前列, 中距離」而用戶揀 `{脚質:'S', 距離:'A'}`
 * → `{前列:'S', 中距離:'A'}`（key 用**條件字串入面真正出現嘅關鍵字**，
 * 所以 `大逃` 呢類同義詞都會照樣查到 `領頭` 嗰格 —— 見 `aptitudeKeyOf()`）。
 *
 * @param {string} condition
 * @param {Record<string,'S'|'A'|'B'|'C'|'D'|'E'|'F'|'G'>} grades 例：`{脚質:'S', 距離:'A'}`
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
 * @param {object} [player] 現況。⚠️ **唔使**俾晒全部嘢：
 *        淨係得五維（HUD 讀到嘅嘢）就傳 `{stats:[…]}` —— 咁 `before.total` 就係五維分，
 *        同 HUD 顯示嘅「評價点」一致（技能未讀到之前係咁，見 AGENTS §6.2）。
 * @param {{base:number, condition?:string, name?:string, skillPt?:number}} skill 想加嘅技能
 * @param {Record<string,string>} [grades] 每一類適性等級（例：`{脚質:'A', 距離:'A'}`）
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
