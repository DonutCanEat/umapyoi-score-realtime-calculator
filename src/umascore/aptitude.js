/**
 * 適性倍率規則（**唯一一份實作**）。
 *
 * 為何要開呢個檔案：呢條規則以前喺 `tools/fill-ground-truth.js` 同
 * `src/umascore/skills.js` 各有一套（獨立審計 H1：核心庫嗰套係「全部條件一律相乘」，
 * 即係**冇「同類取最大」**）→ 地雷 #6 只守到一半（ground truth 檔案啱，
 * 但 anyone 直接叫核心庫就會計錯）。C1 what-if 係第一個「核心庫要自己揀適性」嘅功能，
 * 所以規則收埋喺呢度，兩邊共用。
 *
 * ## 規則（來源見 `docs/formula.md`；AGENTS 地雷 #6）
 *
 *   ① **同類取最大**：腳質（領頭／大逃／前列／居中／後追）之間只取**最大**嗰個倍率，
 *      距離（短距離／中距離／一哩／長距離）同理。
 *      ⚠️ wiki 文字寫「相乘」係**唔準確**嘅，要跟 widget 嘅 if 鏈。
 *   ② **跨類別相乘**：「前列, 中距離」→ 前列 × 中距離。
 *   ③ **場地（草地／沙地）唔乘**（個 if 鏈冇場地分支；
 *      小栗帽 UG2 ground truth 有「良好場地◎」而總誤差仍然 = 0 可證）。
 *   ④ 通用（冇條件）技能 = ×1.0。
 *
 * 驗證：4 條 ground truth 樣本（每條都啱啱好有一招多條件技能）總絕對誤差 **0**
 * （`node tools/fit-score.js`）。
 */

/**
 * 需要「同類取最大」嘅關鍵字分組。
 *
 * ⚠️ 順序有意義：`aptitudesFor()` 回嘅等級陣列次序跟呢度
 * （先腳質、後距離），同 ground truth JSON 嘅慣例一致。
 * ⚠️ 草地／沙地**刻意唔喺呢度**（見上面規則 ③）。
 */
export const MULTIPLIER_GROUPS = Object.freeze([
  Object.freeze(['領頭', '大逃', '前列', '居中', '後追']),
  Object.freeze(['短距離', '中距離', '一哩', '長距離']),
]);

/**
 * 適性等級 → 倍率。
 *
 * ⚠️ `S`／`A` 同 `B`／`C` 各自同倍率（1.1／0.9）係**刻意**嘅：
 * 呢個表係「等級 → 倍率」，同 `skills.js` 嘅 `APTITUDE_COEFFICIENT`
 * （等級 → 係數，1.1 = 1 + 0.1）係同一件事嘅兩種寫法，兩邊數值一定要對得上。
 */
export const GRADE_MULTIPLIER = Object.freeze({
  S: 1.1,
  A: 1.1,
  B: 0.9,
  C: 0.9,
  D: 0.8,
  E: 0.8,
  F: 0.8,
  G: 0.7,
});

/**
 * 遊戲／wiki 嘅關鍵字 → 適性表嘅 key。
 *
 * 為何要：遊戲面板只顯示「領頭／前列／居中／後追」四個腳質，
 * 但技能條件字串會出現「大逃」（＝ 領頭系嘅另一個寫法）→ 要查同一個 key。
 *
 * @param {string} keyword
 * @returns {string}
 */
export function aptitudeKeyOf(keyword) {
  return keyword === '大逃' ? '領頭' : keyword;
}

/**
 * 一條技能條件 → 要乘嘅適性等級陣列（**同類已取最大**）。
 *
 * @param {string} condition 技能條件字串（例如 `'前列, 中距離'`、`'通用'`、`'草地'`）
 * @param {Record<string,string>} [aptitudeMap] 適性表：`{前列:'S', 中距離:'A', …}`
 *        （key 係遊戲面板嗰啲名；`大逃` 會查 `領頭`）
 * @returns {string[]} 例如 `['S', 'A']`；冇任何一類命中就係 `[]`（＝×1.0）
 *
 * ⚠️ 同一類有多個關鍵字命中（真實資料：`'中距離, 長距離'`）→ 只回**一個**等級。
 *    如果兩者倍率**一樣**（例如 S 同 A 都係 1.1），代表邊個係**唔影響分數**嘅
 *    （只影響顯示）→ 取 `MULTIPLIER_GROUPS` 順序最先嗰個，保證同一個輸入永遠同一個輸出。
 */
export function aptitudesFor(condition, aptitudeMap = {}) {
  const text = String(condition ?? '');
  const grades = [];
  for (const group of MULTIPLIER_GROUPS) {
    let bestGrade = null;
    let bestMultiplier = -Infinity;
    for (const keyword of group) {
      if (!text.includes(keyword)) continue;
      const grade = aptitudeMap?.[aptitudeKeyOf(keyword)];
      if (!grade) continue;
      const multiplier = GRADE_MULTIPLIER[String(grade).toUpperCase()] ?? 1;
      if (multiplier > bestMultiplier) {
        bestMultiplier = multiplier;
        bestGrade = grade;
      }
    }
    if (bestGrade !== null) grades.push(bestGrade);
  }
  return grades;
}

/**
 * 條件入面每一類嘅來源關鍵字（**診斷／UI 用**，唔參與計分）。
 *
 * 為何要：what-if 窗要同用戶講「你揀嘅係『前列』（腳質）× 『中距離』（距離）」
 * —— 唔講清楚嘅話，用戶見到「+239 分」都唔知係假設咗邊個適性。
 * ⚠️ 呢個函數同 `aptitudesFor()` 用**同一個** `MULTIPLIER_GROUPS`，
 * 所以兩者唔可能講唔同嘅嘢（假如加咗一組，兩邊自動一齊變）。
 *
 * @param {string} condition
 * @returns {Array<{key:string, keyword:string}>} `key` = 分組代表名（`腳質`／`距離`）
 */
export function groupHits(condition) {
  const text = String(condition ?? '');
  const names = ['腳質', '距離'];
  const hits = [];
  for (const [i, group] of MULTIPLIER_GROUPS.entries()) {
    for (const keyword of group) {
      if (text.includes(keyword)) {
        hits.push({ key: names[i] ?? `組${i}`, keyword });
        break;
      }
    }
  }
  return hits;
}

/**
 * 等級陣列 → 總倍率（`GRADE_MULTIPLIER` 連乘）。
 *
 * ⚠️ 呢度只係「把已揀好嘅等級乘埋」，**唔係**判準 ——
 * 「同類取最大」一定要喺 `aptitudesFor()` 做咗先（唔好喺度再判一次）。
 *
 * @param {string[]} grades
 * @returns {number}
 */
export function multiplierForGrades(grades = []) {
  let multiplier = 1;
  for (const grade of grades) {
    multiplier *= GRADE_MULTIPLIER[String(grade).trim().toUpperCase()] ?? 1;
  }
  return multiplier;
}
