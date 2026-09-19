/**
 * 終端機表格用嘅「顯示闊度」同補空格工具（**唯一一份**）。
 *
 * ## 為何要（獨立審計 M9）
 *
 * 中文／全形字喺終端佔 **2 格**，但 `String.prototype.padEnd()` 係數 `length`
 * （中文都當 1）→ 直接 `padEnd()` 砌出嚟嘅表格會歪。所以 `tools/fit-score.js`
 * 自己寫咗 `displayWidth()`／`pad()`／`lpad()`，而 `tools/breakdown.js` 又抄咗
 * 同一條 CJK 寬字正則同一份 `pad()`。呢啲表格係**驗收證據**
 * （`fit-score` 要顯示「完全命中 5/5　總絕對誤差 0」），所以集中一份。
 *
 * ⚠️ 呢個檔只做「量闊度同補空格」，唔負責欄位內容同排版（每個工具嘅欄闊係
 *    佢自己嘅格式契約，唔准統一）。
 */

/**
 * 「佔兩格」嘅字元類別：漢字／假名／全形標點等。
 *
 * ⚠️ 呢條正則係**逐字沿用**原本兩個工具嘅版本（`fit-score.js`／`breakdown.js`
 * 一字不差）—— 收窄或者擴闊都會令已對齊嘅表格走位。
 */
export const WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6\u25CB\u25CE\u30FB]/;

/**
 * 一段文字喺終端佔幾多格（CJK／全形當 2，其餘當 1）。
 *
 * @param {unknown} text
 * @returns {number}
 */
export function displayWidth(text) {
  let width = 0;
  for (const ch of String(text)) width += WIDE.test(ch) ? 2 : 1;
  return width;
}

/**
 * 靠左補空格到指定**顯示**闊度（唔夠就補，夠咗唔會截短）。
 *
 * @param {unknown} text
 * @param {number} width 目標顯示闊度
 * @returns {string}
 */
export function pad(text, width) {
  const s = String(text);
  return s + ' '.repeat(Math.max(0, width - displayWidth(s)));
}

/**
 * 靠右補空格到指定**顯示**闊度（數字欄用）。
 *
 * @param {unknown} text
 * @param {number} width
 * @returns {string}
 */
export function lpad(text, width) {
  const s = String(text);
  return ' '.repeat(Math.max(0, width - displayWidth(s))) + s;
}
