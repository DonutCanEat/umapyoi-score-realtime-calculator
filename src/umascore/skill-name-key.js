/**
 * 技能名 → **對帳用嘅 key**（純函數，零依賴）。
 *
 * ## 為何要抽（獨立審計 M7）
 *
 * `normalizeSkillName(decodeEntities(String(s ?? '').replace(/\s+/g, ' ').trim()))`
 * 呢一句一字不改出現喺**五個地方**（`tools/verify-skill-bases.js`、
 * `tools/fill-missing-skillpt.js`、`src/umascore/bwiki-coverage.js` ×2、
 * `src/umascore/skill-db-merge.js`），另外「只收空白」嘅前置步驟亦有兩處。
 *
 * 為何**唔可以**任由佢分裂：呢個 key 係「bwiki 頁 ↔ 本庫 ↔ GameTora」三方對帳嘅**唯一**
 * 配對依據 —— 五份之中有一份走樣（例如漏咗 entity 解碼），症狀係**假缺口／假命中**：
 * 明明有嘅招會被當成「未補」，而對帳數字（`一致 1318`）會靜靜地唔同咗，
 * 睇落好似「來源更新咗」咁，最難查。
 *
 * ## 三層，次序唔准掉亂
 *
 * 1. `collapseSpaces()`：換行／tab／連續空白 → 單一空格（bwiki HTML 出嚟嘅名有換行）；
 * 2. `decodeEntities()`：`打call&amp;回應` → `打call&回應`（本庫有 3 個名帶 entity）；
 * 3. `normalizeSkillName()`：去標點（`・`／`．`／`.`…）、去空白、轉細寫。
 *
 * ⚠️ `decodeEntities()` 仍然住喺 `gametora-skills.js`（`test/gametora-skills.test.js`
 *    直接由嗰度 import），呢度只係**借用**，唔准搬走（要搬就要 re-export，多一層轉接唔值）。
 * ⚠️ `normalizeSkillName()` 亦唔准改（`test/whatif.test.js` 守標點等價）。
 */

import { decodeEntities } from './gametora-skills.js';
import { normalizeSkillName } from './whatif.js';

/**
 * 收窄空白：連續空白（連換行／tab）→ 單一空格，順手去前後空白。
 *
 * ⚠️ 一定要 `String(v ?? '')`（唔係 `String(v)`）：`null` 會變 `'null'` 呢個**假名**
 *    → 會同真係叫「null」嘅嘢撞 key。
 *
 * @param {unknown} v
 * @returns {string}
 */
export function collapseSpaces(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * 技能名 → 對帳 key（entity 解碼 ＋ 收空白 ＋ 去標點 ＋ 細寫）。
 *
 * @param {unknown} name
 * @returns {string} 空／缺值 → `''`（呼叫方要自己決定「空 key 唔准入索引」）
 */
export function skillNameKey(name) {
  return normalizeSkillName(decodeEntities(collapseSpaces(name)));
}
