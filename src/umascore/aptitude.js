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
 * ## ⚠️ 為何要有一張「別名表」（2026-09-28；設計審查 S1）
 *
 * 技能庫嘅 `condition` 字串**唔係只有一種寫法**：同一批招有繁中／簡體／日文式關鍵字並存
 * （實測 1589 條之中 **211 條**嘅條件用咗別名寫法 —— 例：`先行`＝前列、`差行`＝居中、
 * `逃马`＝領頭、`追马`＝後追、`中距离`＝中距離、`英里`＝一哩）。
 * 以前呢啲字串**一個都認唔到** → `aptitudesFor()` 回 `[]` → 靜默當「通用」×1.0
 * （實測 `node tools/whatif.js --skill=替え玉一丁、承ります♪ --grades=距離:S` 會印
 * 「適性 通用（冇適性條件）→ ×1.0」，而**同一段**又印「條件 中距离」＝自相矛盾；
 * 單招少 10%～30% 分，`advice`／`delta`／`rankUp` 一齊偏）。
 * → 而家全部收喺 `APTITUDE_ALIASES`（**唯一一份**），並有閘釘住
 * （`test/aptitude-coverage.test.js`：技能庫唔准再出現「認唔到嘅條件」）。
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
 * ⭐ **關鍵字別名**（簡體／日文式寫法 → 遊戲面板嘅正名）—— 設計審查 S1 嘅修正。
 *
 * 為何要有：技能庫嘅 `condition` 混合咗幾種寫法（見檔頭）。**冇呢張表**嘅話，
 * 認唔到嘅條件會靜默當「通用」×1.0（唔會 throw、唔會警告）→ 計出嚟嘅技能分偏低，
 * 而且睇落一切正常。
 *
 * ⚠️ 呢張表係**按實測資料逐個加**嘅（唔准「順手」加一堆未見過嘅變體）：
 *    加一個就要問「同一組係唔係真係取最大？」，加錯會令分數**偏高**而冇人知。
 *    `test/aptitude-coverage.test.js` 會逐條掃技能庫，出現新寫法就即刻紅。
 * ⚠️ 值一定要係 `MULTIPLIER_GROUPS` 入面**真實存在**嘅正名（測試釘住）。
 */
export const APTITUDE_ALIASES = Object.freeze({
  // ── 腳質（同組取最大）──
  大逃: '領頭',
  逃马: '領頭',
  先行: '前列',
  差行: '居中',
  差马: '居中',
  追马: '後追',
  // ── 距離（同組取最大）──
  短距离: '短距離',
  中距离: '中距離',
  长距离: '長距離',
  英里: '一哩',
});

/**
 * 每一組**實際要比對**嘅關鍵字 ＝ 正名（`MULTIPLIER_GROUPS`）＋ 別名（`APTITUDE_ALIASES`）。
 *
 * ⚠️ 次序：正名行先（`groupHits()` 揀代表字嘅行為同以前一樣），別名跟住表嘅定義次序
 *    → 同一個輸入永遠同一個輸出（唔准靠 `Set`／物件遍歷嘅不確定次序）。
 */
export const MULTIPLIER_KEYWORDS_BY_GROUP = Object.freeze(
  MULTIPLIER_GROUPS.map((group) => Object.freeze([
    ...group,
    ...Object.keys(APTITUDE_ALIASES).filter(
      (alias) => group.includes(APTITUDE_ALIASES[alias]) && !group.includes(alias),
    ),
  ])),
);

/**
 * 場地關鍵字（**刻意唔乘**，見上面規則 ③）。
 *
 * 為何要明列：`test/aptitude-coverage.test.js` 要分得清「呢條條件認唔到（＝有病）」
 * 同「呢條條件淨係講場地（＝依設計 ×1.0）」。冇呢張清單就只可以靠「認唔到就當冇事」，
 * 即係倒返去靜默。
 */
export const NON_MULTIPLIER_KEYWORDS = Object.freeze(['草地', '芝', '沙地', '泥地']);

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
 * 但技能條件字串會出現其他寫法（`大逃`／`先行`／`差行`／`逃马`／`追马`…）
 * → 一律經 `APTITUDE_ALIASES` 查同一個 key。
 *
 * @param {string} keyword
 * @returns {string}
 */
export function aptitudeKeyOf(keyword) {
  const key = String(keyword ?? '').trim();
  return APTITUDE_ALIASES[key] ?? key;
}

/**
 * 一條技能條件 → 要乘嘅適性等級陣列（**同類已取最大**）。
 *
 * @param {string} condition 技能條件字串（例如 `'前列, 中距離'`、`'通用'`、`'草地'`）
 * @param {Record<string,string>} [aptitudeMap] 適性表：`{前列:'S', 中距離:'A', …}`
 *        （key 係遊戲面板嗰啲名；`大逃`／`先行`／`中距离` 一律經 `aptitudeKeyOf()` 查正名）
 * @returns {string[]} 例如 `['S', 'A']`；冇任何一類命中就係 `[]`（＝×1.0）
 *
 * ⚠️ `[]` 有兩個完全唔同嘅來源，**唔准當佢哋一樣**：
 *    ① 條件真係「通用」／淨係講場地（草地・沙地）→ 依設計 ×1.0；
 *    ② 條件用咗一張**未收錄嘅寫法**（例：新伺服器嘅簡體譯名）→ 咁係**病**：
 *       分數會靜默偏低。②由 `test/aptitude-coverage.test.js` 逐條掃技能庫擋住。
 *
 * ⚠️ 同一類有多個關鍵字命中（真實資料：`'中距離, 長距離'`）→ 只回**一個**等級。
 *    如果兩者倍率**一樣**（例如 S 同 A 都係 1.1），代表邊個係**唔影響分數**嘅
 *    （只影響顯示）→ 取 `MULTIPLIER_KEYWORDS_BY_GROUP` 順序最先嗰個，
 *    保證同一個輸入永遠同一個輸出。
 */
export function aptitudesFor(condition, aptitudeMap = {}) {
  const text = String(condition ?? '');
  const grades = [];
  for (const group of MULTIPLIER_KEYWORDS_BY_GROUP) {
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
 * ⚠️ 呢個函數同 `aptitudesFor()` 用**同一個** `MULTIPLIER_KEYWORDS_BY_GROUP`，
 * 所以兩者唔可能講唔同嘅嘢（假如加咗一組／一個別名，兩邊自動一齊變）。
 *
 * @param {string} condition
 * @returns {Array<{key:string, keyword:string}>} `key` = 分組代表名（`腳質`／`距離`）
 */
export function groupHits(condition) {
  const text = String(condition ?? '');
  const names = ['腳質', '距離'];
  const hits = [];
  for (const [i, group] of MULTIPLIER_KEYWORDS_BY_GROUP.entries()) {
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
