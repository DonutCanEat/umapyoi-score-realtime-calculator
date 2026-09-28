/**
 * 「剔走唔可能係數字嘅碎片」嘅**共用規則**（唯一一份；設計審查 2026-09-28 L9）。
 *
 * ## 為何要抽
 *
 * 呢個過濾器本來住喺 `src/vision/statbar.js`（`dropNonDigits()`），之後 `resultpanel.js`
 * 直接借嚟用。問題係**兩邊嘅「最短字元高度」政策唔同、但個預設值收埋喺被借用嗰邊**：
 *
 * - `statbar.js` 嘅 `minGlyphHeightRatio = 0.8` 係**「唔似面板條」結構閘**嘅一部分
 *   （實測支援卡列表「Lv27…」徽章行字高比 0.64 會變假陽性，見地雷 #30）；
 * - `resultpanel.js` 嘅 `DEFAULT_RESULT_OPTIONS` **冇**呢個欄位 → 佢一路行
 *   `options.minGlyphHeightRatio ?? 0.55` 呢個**隱形預設**。
 *
 * 即係話：邊個傳一包 statbar 味嘅 options 入去 `readResultPanel()`，
 * 就會**靜默**由 0.55 變 0.8，而且冇任何嘢會嘈。呢個模組把規則收埋一份，
 * 並且**強制**每個呼叫方自己講明政策（`ratio` **冇預設值**，唔傳就 throw）。
 *
 * ## 契約
 *
 * - `filterDigitGlyphs(glyphs, { ratio, minWidth })` —— **`ratio` 一定要有**：
 *   唔傳／唔合法（非有限數、≤0、>1）→ throw；`minWidth` 唔傳 → 用共享預設
 *   `DEFAULT_MIN_GLYPH_WIDTH`（3px，實測最窄真字元「1」喺最細實機窗 1356px 之下約 4px）。
 * - 純函數、零 I/O；**唔會**讀 env／檔案／`DEFAULT_*_OPTIONS`。
 * - 語意（同 2026-09-18 實機 bug 嘅原修正逐字一樣）：
 *   ① **高度**：同一個數字入面所有字元高度一樣 → 矮過最高字元 `ratio` 嘅一定唔係數字；
 *   ② **闊度**：格與格之間嘅半透明虛線分隔線會間歇性落入墨色窗口，佢係 **1px 闊、
 *      同字元一樣高** → 高度判準捉唔到，但「闊 ≤2px 一定唔係數字」捉得到。
 * - 安全網（唔准改）：`maxHeight < 6` 唔剔；剔完一個都冇 → 回原本全部；
 *   單一字元唔郁（可能真係細字）。
 */

/**
 * 共享嘅最小字元闊度（px）。真字元最窄嘅係「1」：實機面板條 6px、
 * 最細實機窗（1356px 闊）之下約 4px → 門檻 3 兩邊都留到餘量。
 */
export const DEFAULT_MIN_GLYPH_WIDTH = 3;

/**
 * 由一群候選字元剔走「唔可能係數字」嘅碎片。
 *
 * @param {Array<{width:number,height:number}>} glyphs
 * @param {{ratio:number, minWidth?:number}} options `ratio` 一定要有（見檔頭）
 * @returns {Array<{width:number,height:number}>}
 */
export function filterDigitGlyphs(glyphs, options = {}) {
  const { ratio, minWidth = DEFAULT_MIN_GLYPH_WIDTH } = options;
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) {
    throw new Error(
      `filterDigitGlyphs 一定要有合法嘅 ratio（0 < ratio ≤ 1）—— 收到 ${ratio}。` +
      '⛔ 唔准有隱形預設：請由呼叫方傳（見本檔檔頭「為何要抽」）。',
    );
  }
  if (!Number.isFinite(minWidth) || minWidth < 1) {
    throw new Error(`filterDigitGlyphs 收到唔合法嘅 minWidth：${minWidth}`);
  }

  if (!glyphs || glyphs.length <= 1) return glyphs ?? [];
  const maxHeight = Math.max(...glyphs.map((g) => g.height));
  if (maxHeight < 6) return glyphs; // 太細就唔敢剔（可能係細字）
  const minHeight = Math.max(4, Math.round(maxHeight * ratio));
  const kept = glyphs.filter((g) => g.height >= minHeight && g.width >= minWidth);
  return kept.length ? kept : glyphs;
}
