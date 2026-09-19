/**
 * `src/hud` 共用嘅小工具（獨立審計 L1）。
 *
 * ## 為何要抽
 *
 * `layout.js`（幾何／拖位反推）同 `config.js`（設定檔驗證）各自寫咗一套
 * **一模一樣**嘅 `describe()`／`isPlainObject()`，另外一個叫 `num()`（有限數字否則 fallback）、
 * 一個叫 `clamp()`。呢啲函數全部係「砌錯誤訊息」同「防 NaN 入到用戶個設定檔」用 ——
 * 兩邊走樣嘅話，同一份壞設定會喺唔同路徑出唔同訊息（甚至一邊過閘一邊唔過）。
 *
 * ⚠️ 錯誤訊息措辭**唔可以喺呢度統一**：呼叫者嘅句子（「要喺 −1 到 1」／「前細後大」…）
 *    係測試同實機診斷靠嘅嘢，呢度只提供「值點樣變成可讀文字」。
 */

/**
 * 一個值 → 錯誤訊息用嘅可讀文字。
 *
 * - 字串會加引號（`「abc」`）：唔係嘅話 `"0.3"` 同 `0.3` 喺訊息睇落一樣，
 *   而本專案**刻意**唔收數字字串（見 `config.js` `numAt()`）。
 * - `undefined` 明寫 `undefined`（`JSON.stringify` 會回 `undefined` 字面值，唔可以直接串）。
 * - 其餘 `JSON.stringify()`；`JSON.stringify()` 會 throw 嘅值（循環參照、
 *   `BigInt`）就回 `String(v)`（唔可以令「砌訊息」自己爆）。
 *
 * @param {unknown} v
 * @returns {string}
 */
export function describe(v) {
  if (typeof v === 'string') return `「${v}」`;
  if (v === undefined) return 'undefined';
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** 係唔係「普通物件」（唔係 null、唔係陣列、唔係函數）。 */
export function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 夾一個數入 `[lo, hi]`；**唔係有限數字**（`NaN`／`undefined`／字串）就回 `lo`。
 *
 * ⚠️ 呢個係 `clampLayout()`（設定窗 slider／拖位反推）嘅唯一夾法 ——
 * 回 `lo` 而唔係 throw 係刻意嘅：用戶拉爆 slider 唔應該令程式爆，
 * 但**寫檔**嗰條路一定要另外 `validateConfig()` 守住（見 `config.js`）。
 */
export function clampNumber(v, lo, hi) {
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

/**
 * 「有限數字就收，否則用 fallback」——**唔會**做字串轉換
 * （`"0.3"` 係 `NaN` 而唔係 `0.3`：靜默 coerce 係本專案明令禁止嘅）。
 *
 * @param {unknown} v
 * @param {number} [fallback]
 * @returns {number}
 */
export function finiteOr(v, fallback = NaN) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
