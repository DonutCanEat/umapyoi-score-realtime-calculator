/**
 * 五維數值**合理性檢查**（唯一一份）—— 設計審查 2026-09-28 S3。
 *
 * ## 為何要抽呢個檔
 *
 * `docs/vision-design.md`（§2.3「數值合理性檢查」）早就寫明 **`0 ≤ 值 ≤ 2600`**，
 * 但實作上**只有 `reader.js`（gt 排法）真係做**：
 *   - 生產路徑係 `statbar.js`（`cropped=true`，實機面板條）同 `resultpanel.js`
 *     （培育結束確認），兩者以前都係 `const stats = texts.map(Number);` 就交出去；
 *   - 而 `readNumberTrimmed()` 嘅 `maxDigits = 4` → 一次誤讀可以砌出 **`9999`**，
 *     之後直接入 `evaluate()` → 總分／ランク／「仲差幾多分升級」一齊錯，**冇任何訊息**。
 * → 所以檢查收埋喺一支純函數，三個 reader 一齊用（措施語同 `reader.js` 舊有**逐字一樣**，
 *   唔准改，實機診斷靠佢）。
 *
 * ## 上界為何係 2600（唔准收緊）
 *
 * 遊戲單項上限係 **2000**，但屬性上限**開放過**（歷史上由 1200 → 2000），所以留 ~30% 餘量。
 * `reader.js` 由 2026-09-18 起就用 2600，一直冇殺錯良民（gt 30/30、實機 15/15）。
 * ⚠️ 收緊到 2000 會令「上限再開放」之後嘅真值變成「唔出數」——**唔准**。
 */

/** 五維合理範圍（`docs/vision-design.md`「數值合理性檢查」）。 */
export const STAT_MIN = 0;
export const STAT_MAX = 2600;

/**
 * 檢查一串已讀出嘅數值（通常係 5 個）合唔合理。
 *
 * @param {number[]} values `texts.map(Number)` 之後嘅值
 * @param {{min?:number, max?:number}} [options] 呼叫者可以收窄（測試用；唔准放寬到唔合理）
 * @returns {{ok:boolean, index:number, value:number|null, reason:string}}
 *          `index` ＝ 第一個唔合理嘅位置（0-based；`ok` 嗰陣係 -1）
 */
export function checkStatRange(values, { min = STAT_MIN, max = STAT_MAX } = {}) {
  if (!Array.isArray(values) || values.length === 0) {
    return { ok: false, index: -1, value: null, reason: '冇讀到任何數值' };
  }
  for (const [i, v] of values.entries()) {
    // ⚠️ `Number.isFinite` 一定要有：`Number('?')` 係 NaN，`NaN < min` 同 `NaN > max`
    //    兩者都係 false → 淨係比大小係**捉唔到 NaN**（呢個就係舊版三個 reader 嘅縫）。
    if (!Number.isFinite(v) || v < min || v > max) {
      // ⚠️ 措辭同 `reader.js` 舊版逐字一樣（見檔頭）
      return { ok: false, index: i, value: Number.isFinite(v) ? v : null, reason: `第 ${i + 1} 個數值唔合理（${v}）` };
    }
  }
  return { ok: true, index: -1, value: null, reason: '' };
}
