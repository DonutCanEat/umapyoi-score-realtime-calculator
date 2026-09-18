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
  /** 墨點遮罩窗半徑（技能畫面用大窗，見上面註解）。**呢個係「參考尺度」嘅像素值。** */
  windowRadius: 11,
  /** 窗口淺色比例門檻（技能畫面放寬到 0.2）。 */
  lightFraction: 0.2,
  minRowInk: 0.01,      // 一條技能列最少要有幾多墨（÷ 圖闊）先算「有嘢」
  minRowHeight: 0.02,   // 列高下限（÷ 圖高）
  maxRowHeight: 0.12,   // 列高上限（÷ 圖高）—— 超過就係兩列黏埋，要再切
  /** 一列裡面「字／墨塊」之間幾闊嘅空隙先算分隔（÷ 圖闊）。 */
  clusterGap: 0.012,
  /** 欄邊門檻：欄墨量要 ≥ 峰值 × 呢個比例先算「有字」（濾走反鋸齒尾巴）。 */
  columnEdge: 0.25,
  /** 左右兩欄嘅分界（÷ 圖闊）。實測兩欄之間喺 0.33–0.43 之間乜都冇。 */
  columnSplit: 0.38,
  /** icon 最小闊度（÷ 圖闊）：第一個夠闊嘅墨塊就當係 icon。 */
  iconMinWidth: 0.045,
  /** 技能名同右邊 `Lv5` 之間嘅空隙（÷ 圖闊），夠闊就當右邊嗰舊係 Lv。 */
  lvGap: 0.03,
  /**
   * ⭐ **參考闊度**（像素）：`windowRadius` 同「最低像素門檻」都係喺**呢個尺度**量出嚟嘅。
   *
   * 為何要有：遊戲**冇固定解析度**（地雷 #24），所以同一套 UI 喺細窗／大窗之下，
   * 字高可以差一倍以上。所有寫死嘅**像素**門檻（遮罩窗半徑 11、最低列高 8px、
   * 名框前綴 5px…）喺另一半尺度就會失效。
   *
   * ⚠️ **實測踩過**：用戶收返嚟嘅實拍係 1928 窗（技能名 ~10px 高、行距 ~63px），
   * 而真值圖係 1140 尺度（字高 ~25px、行距 **124px**）→ 同一張技能清單，
   * 用 11px 遮罩窗去讀 10px 嘅字 → 列偵測爆到 **9–12 列**（正解 7 列）。
   * → 所有像素門檻一律 × (圖闊 ÷ referenceWidth)。
   */
  referenceWidth: 1140,
});

/**
 * 由圖闊推尺度因子（1.0 = 參考尺度 1140 闊）。
 *
 * 所有**像素**門檻都要 × 呢個值，否則換個窗大細就失效（見 `referenceWidth` 註解）。
 */
export function skillScale(width, options = {}) {
  const o = { ...DEFAULT_SKILLSCREEN_OPTIONS, ...options };
  return width / o.referenceWidth;
}

/**
 * 逐列墨量（用背景受控遮罩，同主線一致）。
 *
 * @param {{data:Uint8ClampedArray,width:number,height:number}} image
 * @param {object} [options]
 * @returns {{counts:Int32Array, mask:Uint8Array}}
 */
export function rowInkProfile(image, options = {}) {
  const o = { ...DEFAULT_SKILLSCREEN_OPTIONS, ...options };
  // ⭐ 遮罩窗半徑要跟尺度（細窗要用細窗，大窗要用大窗）
  const radius = Math.max(3, Math.round(o.windowRadius * skillScale(image.width, o)));
  const mask = buildInkMask(image, { windowRadius: radius, lightFraction: o.lightFraction });
  const counts = new Int32Array(image.height);
  for (let y = 0; y < image.height; y += 1) {
    let c = 0;
    const base = y * image.width;
    for (let x = 0; x < image.width; x += 1) c += mask[base + x];
    counts[y] = c;
  }
  return { counts, mask, windowRadius: radius, scale: skillScale(image.width, o) };
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
  const scale = skillScale(width, o);
  const minInk = Math.max(2, Math.round(width * o.minRowInk));
  const maxH = Math.max(4, Math.round(height * o.maxRowHeight));
  // ⭐ 「最低幾高先算一列」係像素門檻 → 要跟尺度（實測 1140 尺度 = 8px）
  const minH = Math.max(2, Math.round(8 * scale));
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
    .filter((s) => s.height >= Math.max(minH, Math.round(height * o.minRowHeight)));
}

/**
 * 由一個「技能列」抽出**技能名**嘅範圍（剔走左邊 icon 同右邊 Lv）。
 *
 * ## 為何要分三步
 *
 * 一行係「[icon][技能名][…][Lv]」。要攞到「技能名」就要：
 *   ① 攞整行嘅橫向墨跡分佈；
 *   ② **剔走 icon**：icon 係一個**彩色方框**（橙／綠／藍），闊度約 0.05–0.08×圖闊，
 *      緊貼行嘅左邊 → 由左邊起跳過第一個「夠闊嘅墨塊」；
 *   ③ **剔走右邊 Lv**：`Lv5` 喺最右，同技能名之間有明顯空隙 → 由右邊起，
 *      遇到大空隙就截。
 *
 * ⚠️ 唔可以用顏色剔 icon（icon 顏色跟技能類型，橙／綠／藍都有）→ 同地雷 #10 一樣道理。
 * ⚠️ 回傳嘅係**相對座標**（÷ 圖闊），叫嘅人自己 × 圖闊。
 *
 * @param {Uint8Array} mask
 * @param {number} width
 * @param {number} y0
 * @param {number} y1
 * @param {{x0:number,x1:number}} span 該欄嘅橫向範圍（`columnSpans()` 嘅輸出）
 * @param {object} [options]
 * @returns {{x0:number,x1:number,iconX1:number|null,rightCut:number|null}|null}
 *          搵唔到名就回 null（⚠️ 唔可以回一個亂咁嚟嘅框）
 */
export function nameBoxInSpan(mask, width, y0, y1, span, options = {}) {
  const o = { ...DEFAULT_SKILLSCREEN_OPTIONS, ...options };
  const cols = new Int32Array(span.x1 - span.x0 + 1);
  for (let y = y0; y <= y1; y += 1) {
    const base = y * width;
    for (let c = 0; c < cols.length; c += 1) cols[c] += mask[base + span.x0 + c];
  }
  return nameBoxFromColumns(cols, span.x0, width, y0, y1, o);
}

/**
 * 同上，但用「該行**所有**墨跡」嘅欄分佈（唔限 span）。
 * 用途：一行通常有兩欄（左／右），要分開處理。
 *
 * @param {Int32Array} cols 逐欄墨量（索引 0 = 圖最左）
 * @param {number} width
 * @param {object} [options]
 */
export function nameBoxesInRow(cols, width, options = {}) {
  const o = { ...DEFAULT_SKILLSCREEN_OPTIONS, ...options };
  const minCol = 1;
  const gapMax = Math.max(2, Math.round(width * o.clusterGap));
  const spans = [];
  let start = -1;
  let gap = 0;
  for (let x = 0; x < cols.length; x += 1) {
    if (cols[x] >= minCol) {
      if (start < 0) start = x;
      gap = 0;
    } else if (start >= 0) {
      gap += 1;
      if (gap >= gapMax) {
        spans.push({ x0: start, x1: x - gap });
        start = -1;
      }
    }
  }
  if (start >= 0) spans.push({ x0: start, x1: width - 1 });

  // 分兩欄：兩欄之間嘅大空隙（實測 x ≈ 0.33–0.43×圖闊 之間乜都冇）
  const mid = width * o.columnSplit;
  const left = spans.filter((s) => (s.x0 + s.x1) / 2 < mid);
  const right = spans.filter((s) => (s.x0 + s.x1) / 2 >= mid);
  const out = [];
  for (const group of [left, right]) {
    if (!group.length) { out.push(null); continue; }
    const x0 = Math.min(...group.map((s) => s.x0));
    const x1 = Math.max(...group.map((s) => s.x1));
    const sub = new Int32Array(x1 - x0 + 1);
    for (const s of group) for (let x = s.x0; x <= s.x1; x += 1) sub[x - x0] += cols[x];
    out.push(nameBoxFromColumns(sub, x0, width, 0, 0, o));
  }
  return out;
}

function nameBoxFromColumns(cols, offset, width, y0, y1, o) {
  const max = Math.max(...cols);
  if (max < 2) return null;
  // 夠墨嘅欄（相對峰值）
  const edge = Math.max(1, Math.round(max * o.columnEdge));
  const runs = [];
  let start = -1;
  for (let c = 0; c < cols.length; c += 1) {
    if (cols[c] >= edge) {
      if (start < 0) start = c;
    } else if (start >= 0) {
      runs.push({ x0: start, x1: c - 1 });
      start = -1;
    }
  }
  if (start >= 0) runs.push({ x0: start, x1: cols.length - 1 });
  if (!runs.length) return null;

  // ① 剔 icon：最左邊、闊度 ≥ iconMinWidth×圖闊 嘅墨塊
  const iconMinW = Math.max(2, Math.round(width * o.iconMinWidth));
  let iconX1 = null;
  if (runs[0].x1 - runs[0].x0 + 1 >= iconMinW) {
    iconX1 = offset + runs[0].x1;
    runs.shift();
  }
  if (!runs.length) return null;

  // ② 剔右邊 Lv：最後一個墨塊同前面隔得夠遠（≥ lvGap×圖闊）→ 當佢係 Lv
  const lvGap = Math.max(2, Math.round(width * o.lvGap));
  let rightCut = null;
  if (runs.length >= 2) {
    const last = runs[runs.length - 1];
    const prev = runs[runs.length - 2];
    if (last.x0 - prev.x1 >= lvGap) {
      rightCut = offset + last.x0;
      runs.pop();
    }
  }
  if (!runs.length) return null;

  // ③ 頭尾之間**所有**墨塊合併成「名」嘅範圍（中間嘅空隙係字距，唔可以當分隔）
  const x0 = offset + runs[0].x0;
  const x1 = offset + runs[runs.length - 1].x1;
  return { x0, x1, iconX1, rightCut, colSpanCount: runs.length };
}
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
