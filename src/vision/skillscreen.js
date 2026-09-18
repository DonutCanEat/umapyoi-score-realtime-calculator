/**
 * 技能畫面（畫面 B）嘅**欄／行偵測**（Phase 2 第一步）。
 *
 * ## 為何唔可以照抄面板條嗰套
 *
 * 育成主畫面係「5 個數字一行」（`statbar.js`）；技能畫面係**兩欄清單，每行一格**
 * （icon ＋ 技能名 ＋ 右邊 Lv），而且每格係**淺色圓角矩形**（技能名棕色字、有淺色描邊）。
 * 結構完全唔同，所以另開一層。
 *
 * ## 用咩做判準
 *
 * 每個技能列係「**橫向一大條、上下留白**」嘅結構 → 用**列墨量 profile**（唔係純顏色：
 * 技能列底色係跟技能類型嘅漸變色，唔可以寫死色相，同地雷 #10 一樣道理）。
 * 尋找連續嘅「夠墨」列段，再按高度／間距分群。
 *
 * ## 版面實測（食 `shots/gt/*-skills.png`）
 *
 * 詳見 `docs/skill-screen.md`。UI 係等比縮放（地雷 #24），所以全部用**相對值**。
 */

import { buildInkMask } from './inkmask.js';

/**
 * 預設參數。
 *
 * ⚠️ **窗半徑同淺色比例唔可以照抄面板條嗰套**（實測 `shots/gt/uma1-p1-skills.png`）：
 *   半徑 3 → 墨點只得 **0.13%**（收唔到技能名）；半徑 6 → 0.58%；
 *   **半徑 11 + 淺色比例 0.2 → 1.92%**，此時 6 條技能列先清清楚楚出得嚟。
 * 原因：技能名係**棕色字喺淺色漸變底上**（底係藍／青／粉漸變，唔似面板條嘅近白底），
 * 窗太細就會被「窗口要夠多淺色底」呢個條件篩走。
 */
export const DEFAULT_SKILLSCREEN_OPTIONS = Object.freeze({
  /** 墨點遮罩窗半徑（技能畫面用大窗，見上面註解）。 */
  windowRadius: 11,
  /** 窗口淺色比例門檻（技能畫面放寬到 0.2）。 */
  lightFraction: 0.2,
  minRowInk: 0.01,      // 一條技能列最少要有幾多墨（÷ 圖闊）先算「有嘢」
  minRowHeight: 0.02,   // 列高下限（÷ 圖高）
  maxRowHeight: 0.12,   // 列高上限（÷ 圖高）—— 超過就係兩列黏埋，要再切
});

/**
 * 逐列墨量（用背景受控遮罩，同主線一致）。
 *
 * @param {{data:Uint8ClampedArray,width:number,height:number}} image
 * @param {object} [options]
 * @returns {{counts:Int32Array, mask:Uint8Array}}
 */
export function rowInkProfile(image, options = {}) {
  const o = { ...DEFAULT_SKILLSCREEN_OPTIONS, ...options };
  const mask = buildInkMask(image, { windowRadius: o.windowRadius, lightFraction: o.lightFraction });
  const counts = new Int32Array(image.height);
  for (let y = 0; y < image.height; y += 1) {
    let c = 0;
    const base = y * image.width;
    for (let x = 0; x < image.width; x += 1) c += mask[base + x];
    counts[y] = c;
  }
  return { counts, mask };
}

/**
 * 由列 profile 切出「技能列」（連續夠墨嘅列段 → 合併／切開）。
 *
 * @param {Int32Array} counts
 * @param {number} width 圖闊（用嚟把門檻變成相對值）
 * @param {number} height 圖高
 * @param {object} [options]
 * @returns {Array<{y0:number,y1:number,height:number,ink:number}>}
 */
export function findSkillRows(counts, width, height, options = {}) {
  const o = { ...DEFAULT_SKILLSCREEN_OPTIONS, ...options };
  const minInk = Math.max(4, Math.round(width * o.minRowInk));
  const maxH = Math.max(8, Math.round(height * o.maxRowHeight));
  // ① 連續夠墨嘅列段
  const raw = [];
  let y = 0;
  while (y < counts.length) {
    if (counts[y] < minInk) { y += 1; continue; }
    let y1 = y;
    let ink = counts[y];
    while (y1 + 1 < counts.length && counts[y1 + 1] >= minInk) { y1 += 1; ink += counts[y1]; }
    raw.push({ y0: y, y1, ink });
    y = y1 + 1;
  }

  // ② 太高嘅段（兩三列黏埋）→ 用「列墨量最低點」切開
  const out = [];
  for (const seg of raw) {
    const h = seg.y1 - seg.y0 + 1;
    if (h <= maxH) { out.push(seg); continue; }
    const pieces = Math.ceil(h / maxH);
    const step = h / pieces;
    for (let i = 0; i < pieces; i += 1) {
      const a = Math.round(seg.y0 + i * step);
      const b = Math.round(seg.y0 + (i + 1) * step) - 1;
      let ink = 0;
      for (let yy = a; yy <= b; yy += 1) ink += counts[yy];
      out.push({ y0: a, y1: b, ink });
    }
  }

  return out
    .map((s) => ({ ...s, height: s.y1 - s.y0 + 1 }))
    .filter((s) => s.height >= Math.max(4, Math.round(height * o.minRowHeight)));
}

/**
 * 一條技能列入面嘅**橫向範圍**（兩欄分開）。
 *
 * @param {Uint8Array} mask
 * @param {number} width
 * @param {number} y0
 * @param {number} y1
 * @param {object} [options]
 * @returns {Array<{x0:number,x1:number,ink:number}>} 通常 2 個（左欄／右欄）
 */
export function columnSpans(mask, width, y0, y1, options = {}) {
  const o = { ...DEFAULT_SKILLSCREEN_OPTIONS, ...options };
  const cols = new Int32Array(width);
  for (let y = y0; y <= y1; y += 1) {
    const base = y * width;
    for (let x = 0; x < width; x += 1) cols[x] += mask[base + x];
  }
  const minCol = Math.max(1, Math.round((y1 - y0 + 1) * 0.04));
  const spans = [];
  let start = -1;
  let gap = 0;
  // 欄與欄之間嘅空隙：實測兩欄之間有一條明顯空白 → 用圖闊 2% 做門檻
  const gapMax = Math.max(2, Math.round(width * 0.02));
  for (let x = 0; x < width; x += 1) {
    if (cols[x] >= minCol) {
      if (start < 0) start = x;
      gap = 0;
    } else if (start >= 0) {
      gap += 1;
      if (gap >= gapMax) {
        spans.push({ x0: start, x1: x - gap, ink: 0 });
        start = -1;
      }
    }
  }
  if (start >= 0) spans.push({ x0: start, x1: width - 1, ink: 0 });
  for (const s of spans) {
    let ink = 0;
    for (let x = s.x0; x <= s.x1; x += 1) ink += cols[x];
    s.ink = ink;
  }
  return spans.filter((s) => s.x1 > s.x0);
}
