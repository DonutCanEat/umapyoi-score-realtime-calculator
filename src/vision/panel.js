/**
 * ⛔ **已棄用（2026-09）—— 唔好用，亦唔好接入主流程。**
 *
 * 呢個係 `anchor.js` 嘅「粉紅比例」改良版，但同樣係靠顏色 → 同樣唔可靠
 * （面板顏色跟隻馬嘅主題色走）。現行做法見 `src/vision/reader.js`。
 * 詳見 AGENTS.md 地雷 #10/#11/#12。
 *
 * ────────────────────────────────────────────────────────────────
 * ステータス面板偵測（第二版：用「粉紅比例」而唔係「連續粉紅段」）。
 *
 * 為何要重寫（2026-08 實測）：
 *   `anchor.js` v1 用 `longestPinkRun()`，要求一條**連續**粉紅段 ≥ 畫面闊 25%。
 *   但真實標題列係「漸變色 + 有文字同 icon」，橫向連續段會被打斷，
 *   喺育成主畫面度最長連續段遠遠唔夠 475px → 直接 `搵唔到`。
 *
 * v2 改用**逐行粉紅比例**：
 *   育成主畫面實測 —— 標題列 y=721~743 嘅粉紅比例約 **24.8%**，
 *   而其他行只有 1~7% → 分離度極高。
 *
 * 面板結構（實測 uma1-p1，585 闊）：
 *   y=724      飽和粉紅 (255,133,195)  ← 頂邊
 *   y=728~764  淺粉紅 (255,224,239)    ← 數值格
 *   y=744~756  深棕 (122,65,24)        ← 數字本身
 *   y=768      飽和粉紅                 ← 底邊
 */

/** 飽和粉紅（標題列／邊線）。 */
export function isHeaderPink(r, g, b) {
  return r >= 195 && g <= 160 && b >= 80 && b <= 215;
}

/** 淺粉紅（數值格底色）。 */
export function isCellPink(r, g, b) {
  return r >= 240 && g >= 150 && g <= 235 && b >= 190 && b <= 245;
}

/** 深棕色（數字本身）。 */
export function isDigitInk(r, g, b) {
  return r >= 80 && r <= 165 && g >= 30 && g <= 105 && b <= 70;
}

/** 逐行粉紅比例。 */
export function pinkRowRatios(image) {
  const { data, width, height } = image;
  const ratios = new Float64Array(height);
  for (let y = 0; y < height; y += 1) {
    let pink = 0;
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (isHeaderPink(data[i], data[i + 1], data[i + 2])) pink += 1;
    }
    ratios[y] = pink / width;
  }
  return ratios;
}

/**
 * 偵測ステータス面板。
 *
 * @param {{data:Uint8ClampedArray,width:number,height:number}} image
 * @param {{minPeakRatio?:number, bandFalloff?:number, yStartRatio?:number, yEndRatio?:number}} [options]
 * @returns {{x,y,width,height,headerHeight,peakRatio,confidence}|null}
 */
export function detectPanelByRatio(image, options = {}) {
  const { data, width, height } = image;
  const minPeakRatio = options.minPeakRatio ?? 0.12;
  const bandFalloff = options.bandFalloff ?? 0.7;
  const yStart = Math.floor(height * (options.yStartRatio ?? 0.05));
  const yEnd = Math.floor(height * (options.yEndRatio ?? 0.95));

  const ratios = pinkRowRatios(image);

  // 1) 揀粉紅比例最高嘅行做中心
  let peak = yStart;
  for (let y = yStart; y <= yEnd; y += 1) if (ratios[y] > ratios[peak]) peak = y;
  if (ratios[peak] < minPeakRatio) return null;

  // 2) 上下擴展成帶（比例跌到峰值嘅 70% 以下就停）
  const threshold = ratios[peak] * bandFalloff;
  let top = peak;
  let bottom = peak;
  while (top > yStart && ratios[top - 1] >= threshold) top -= 1;
  while (bottom < yEnd && ratios[bottom + 1] >= threshold) bottom += 1;

  // 3) 帶嘅左右範圍＝帶內粉紅像素嘅 min/max x
  let left = width;
  let right = -1;
  for (let y = top; y <= bottom; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (isHeaderPink(data[i], data[i + 1], data[i + 2])) {
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  if (right <= left) return null;

  // 4) 向下延伸：把淺粉紅數值格同深棕數字都包埋入面板高度
  const spanWidth = right - left + 1;
  const sampleStep = Math.max(1, Math.floor(spanWidth / 60));
  let panelBottom = bottom;
  for (let y = bottom + 1; y <= Math.min(yEnd, bottom + Math.floor(height * 0.2)); y += 1) {
    let relevant = 0;
    let total = 0;
    for (let x = left; x <= right; x += sampleStep) {
      const i = (y * width + x) * 4;
      total += 1;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (isCellPink(r, g, b) || isDigitInk(r, g, b)) relevant += 1;
    }
    if (total > 0 && relevant / total >= 0.4) panelBottom = y;
    else if (panelBottom > bottom + 2) break;
  }

  const headerHeight = bottom - top + 1;
  const confidence = Math.min(1, ratios[peak] / 0.25);

  return {
    x: left,
    y: top,
    width: spanWidth,
    height: panelBottom - top + 1,
    headerHeight,
    peakRatio: ratios[peak],
    confidence,
  };
}
