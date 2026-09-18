/**
 * 實機五維面板條（畫面 A 育成主畫面）嘅定位。
 *
 * ## 為何需要獨立一層（2026-09-18 實機量測）
 *
 * 舊做法（`detectDigitRow()`）係「喺全圖搵 5 個闊度相近嘅等距數字」。
 * 喺 gt 截圖（ステータス面板：5 個 4 位數字一行）行得通，但喺實機育成主畫面**一定讀錯**：
 * 每個屬性格係「**大數值（上）＋ `/上限`（下、細字）**」，
 * 上限全部 4 位、闊度一致 → 完美符合舊判準；數值係 2–3 位、闊度唔一致 → 被淘汰。
 * 實測 5 個解析度（1356→2560）**5/5 都揀到上限欄**，信心仲有 0.55–0.70
 * → 會靜默顯示錯嘅五維分（見 AGENTS 地雷 #23）。
 *
 * ## 為何用「相對 ROI」而唔係再靠結構搜尋
 *
 * 用戶確認：賽馬娘桌面版**冇固定解析度，只有固定 16:9**。
 * 實測 5 個解析度：
 *   - cell pitch ÷ 圖闊 = **0.0494–0.0498（恆定）**
 *   - 面板列 normalized y = **0.691–0.703（恆定）**
 * → UI 完全等比縮放、面板相對位置穩定，所以**寫死相對座標係安全嘅**
 *   （同「寫死色相」完全兩回事 —— 色相會跟隻馬嘅主題色變，見地雷 #10）。
 *
 * 好處：① 插畫／其他 UI 自動排除，唔會再撞到「按墨量揀錯行」（地雷 #13）；
 * ② 只傳 ROI 就夠（頻寬由 8MB/幀跌到 ~0.8MB/幀）；
 * ③ 字高可以自己控制（重採樣到模板尺度）。
 */

import { buildInkMask, findTextLines } from './inkmask.js';
import { denseBands, tightenBand, columnsToGroups, groupsToNumbers } from './digitrow.js';
import { extractGlyphs, readNumberTrimmed } from './glyphs.js';

/** 預設參數（相對座標係 ÷ 內容區 16:9）。 */
export const DEFAULT_STATBAR_OPTIONS = Object.freeze({
  aspect: 9 / 16,      // 遊戲內容區比例
  roiX: [0.15, 0.44],   // 實測面板條橫向佔 0.164–0.426（5 個解析度一致）
  roiY: [0.645, 0.735], // 實測面板列 y 0.691–0.703，上下各留邊
  targetGlyphHeight: 17, // 模板建立時嘅字高（gt 截圖實測）
  minBandInk: 20,
});

/**
 * 內容區（扣走 Windows 標題列）。截圖如果比 16:9 高，多出嘅部分係頂部標題列。
 *
 * @returns {{top:number,height:number,width:number}}
 */
export function contentBox(image, options = {}) {
  const aspect = options.aspect ?? DEFAULT_STATBAR_OPTIONS.aspect;
  const expected = Math.round(image.width * aspect);
  if (image.height <= expected) return { top: 0, height: image.height, width: image.width };
  return { top: image.height - expected, height: expected, width: image.width };
}

/** 剪出一個區域（1:1 像素，零重採樣）。 */
export function cropImage(image, x0, y0, x1, y1) {
  const cx0 = Math.max(0, Math.min(image.width - 1, x0));
  const cy0 = Math.max(0, Math.min(image.height - 1, y0));
  const cx1 = Math.max(cx0 + 1, Math.min(image.width, x1));
  const cy1 = Math.max(cy0 + 1, Math.min(image.height, y1));
  const width = cx1 - cx0;
  const height = cy1 - cy0;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const s = ((y + cy0) * image.width + (x + cx0)) * 4;
      const o = (y * width + x) * 4;
      out[o] = image.data[s];
      out[o + 1] = image.data[s + 1];
      out[o + 2] = image.data[s + 2];
      out[o + 3] = image.data[s + 3];
    }
  }
  return { data: out, width, height };
}

/**
 * 面積平均重採樣（近似 canvas `drawImage` 嘅 box filter）。
 * 用途：把 ROI 內嘅字高正規化到模板尺度，令任何解析度都行同一條管線。
 */
export function resampleImage(image, factor) {
  if (Math.abs(factor - 1) < 1e-6) return image;
  const width = Math.max(1, Math.round(image.width * factor));
  const height = Math.max(1, Math.round(image.height * factor));
  const out = new Uint8ClampedArray(width * height * 4);
  const xr = image.width / width;
  const yr = image.height / height;
  for (let y = 0; y < height; y += 1) {
    const sy0 = Math.floor(y * yr);
    const sy1 = Math.max(sy0 + 1, Math.min(image.height, Math.floor((y + 1) * yr)));
    for (let x = 0; x < width; x += 1) {
      const sx0 = Math.floor(x * xr);
      const sx1 = Math.max(sx0 + 1, Math.min(image.width, Math.floor((x + 1) * xr)));
      let r = 0; let g = 0; let b = 0; let n = 0;
      for (let sy = sy0; sy < sy1; sy += 1) {
        for (let sx = sx0; sx < sx1; sx += 1) {
          const p = (sy * image.width + sx) * 4;
          r += image.data[p]; g += image.data[p + 1]; b += image.data[p + 2]; n += 1;
        }
      }
      const o = (y * width + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return { data: out, width, height };
}

/** 一條帶嘅墨量同橫向範圍。 */
function bandStats(mask, width, y0, y1) {
  let ink = 0;
  let xMin = -1;
  let xMax = -1;
  for (let y = y0; y <= y1; y += 1) {
    const base = y * width;
    for (let x = 0; x < width; x += 1) {
      if (!mask[base + x]) continue;
      ink += 1;
      if (xMin < 0 || x < xMin) xMin = x;
      if (x > xMax) xMax = x;
    }
  }
  return { ink, xMin, xMax, spread: xMax < 0 ? 0 : (xMax - xMin + 1) / width };
}

/**
 * 定位實機五維面板條：內容框 → 相對 ROI → ROI 內切「大數值行」同「上限行」。
 *
 * 分類規則：兩行都橫跨成條 ROI（spread 大），而且**大數值行明顯高過上限行**
 * （實測字高：數值 ≈ 0.0098×圖闊、上限 ≈ 0.0064×圖闊 → 比例 ~1.5）。
 *
 * @returns {{roi:object, image:object, mask:Uint8Array, values:object|null, limits:object|null, scale:number, reason?:string}}
 */
export function locateStatBar(image, options = {}) {
  const o = { ...DEFAULT_STATBAR_OPTIONS, ...options };
  const box = contentBox(image, o);
  // whole: true = 交嚟嘅圖**已經係 ROI**（renderer 直接剪好面板條先傳，見 electron/capture.html）
  const whole = o.whole === true;
  const x0 = whole ? 0 : Math.round(image.width * o.roiX[0]);
  const x1 = whole ? image.width : Math.round(image.width * o.roiX[1]);
  const y0 = whole ? 0 : box.top + Math.round(box.height * o.roiY[0]);
  const y1 = whole ? image.height : box.top + Math.round(box.height * o.roiY[1]);
  const roi = cropImage(image, x0, y0, x1, y1);
  const mask = buildInkMask(roi, o);

  const bands = [];
  for (const line of findTextLines(roi, mask, o)) {
    const cuts = denseBands(mask, roi.width, line, o).map((b) => tightenBand(mask, roi.width, b.y0, b.y1, o));
    cuts.push(tightenBand(mask, roi.width, line.y0, line.y1, o));
    for (const c of cuts) {
      if (c.y1 < c.y0) continue;
      const height = c.y1 - c.y0 + 1;
      const stats = bandStats(mask, roi.width, c.y0, c.y1);
      if (stats.ink < o.minBandInk) continue;
      if (bands.some((b) => b.y0 === c.y0 && b.y1 === c.y1)) continue; // 去重
      bands.push({ y0: c.y0, y1: c.y1, height, ...stats });
    }
  }
  bands.sort((a, b) => a.y0 - b.y0);

  const meta = { roi: { x: x0, y: y0, width: roi.width, height: roi.height }, image: roi, mask, bands };
  if (bands.length < 2) {
    return { ...meta, values: null, limits: null, scale: 1, reason: `ROI 內只搵到 ${bands.length} 條帶` };
  }

  // 大數值行 = 最高而且橫向覆蓋夠闊嘅一條
  // （覆蓋門檻唔可以設太高：ROI 係為咗包住面板條而設，但數值本身右對齊、
  //   實測 5 個數值只佔圖闊 0.164–0.385，即 ROI 嘅 ~0.76；
  //   真實截圖量到 0.90 係因為同一行仲有右邊「技能Pt」格。用 0.6 留足夠餘量。）
  const minValuesSpread = o.minValuesSpread ?? 0.6;
  const minLimitsSpread = o.minLimitsSpread ?? 0.5;
  const tall = bands.filter((b) => b.spread >= minValuesSpread).sort((a, b) => b.height - a.height);
  if (!tall.length) {
    return { ...meta, values: null, limits: null, scale: 1, reason: '冇一條帶橫跨成條 ROI' };
  }
  const values = tall[0];
  // 上限行 = 喺大數值行**下面**（嚴格喺帶尾之後，避免揀到同一行嘅子帶）、同樣橫跨得夠闊嘅帶
  const limits = bands
    .filter((b) => b.y0 > values.y1 && b.spread >= minLimitsSpread)
    .sort((a, b) => b.height - a.height)[0] ?? null;

  const scale = Math.min(4, Math.max(0.5, o.targetGlyphHeight / values.height));
  return { ...meta, values, limits, scale };
}

/**
 * 由一堆候選數字揀出五維嘅 5 個 —— **只按右邊界間距**（唔用闊度）。
 *
 * 為何唔用 `pickBestFive()`：嗰個用「闊度相近」做成本，但實機五維數值係 2–3 位數、
 * 闊度天生唔一致（226／54／139／85／102），而**上限**先係全部 4 位、闊度一致。
 * 用闊度做判準就會揀到上限（呢個就係地雷 #23 嘅根因）。
 *
 * 為何用**右邊界 x1** 而唔係左邊界 x0：實機數值喺格內係**右對齊**，
 * 所以 x0 間距會跟位數交替（實測 105/76/103/77），但 x1 間距係真正等距
 * （實測 90/90/90/89；隔籬「技能Pt」格係 75 → 會被淘汰）。
 */
export function pickFiveBySpacing(numbers, options = {}) {
  const n = numbers.length;
  if (n < 5) return null;
  if (n === 5) return { numbers, cost: 0, gaps: [] };

  let best = null;
  const idx = [0, 1, 2, 3, 4];
  const advance = () => {
    let i = 4;
    while (i >= 0 && idx[i] === n - 5 + i) i -= 1;
    if (i < 0) return false;
    idx[i] += 1;
    for (let j = i + 1; j < 5; j += 1) idx[j] = idx[j - 1] + 1;
    return true;
  };
  do {
    const sel = idx.map((i) => numbers[i]);
    const gaps = [];
    for (let i = 1; i < 5; i += 1) gaps.push(sel[i].x1 - sel[i - 1].x1);
    const minGap = Math.min(...gaps);
    if (minGap < (options.minPitch ?? 3)) continue;
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const varSum = gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length;
    const cost = varSum / (mean * mean); // 相對方差：等距 = 0
    if (!best || cost < best.cost) best = { numbers: sel, cost, gaps };
  } while (advance());
  return best;
}

/**
 * 抽出實機面板條嘅 5 個數值框同各自嘅字元（讀數同**建模板**共用同一條路，
 * 唔可以兩邊各寫一次，否則會出現「訓練用一套、讀數用另一套」嘅偏差）。
 *
 * @returns {{located:object, entries:Array<{num:object,glyphs:Array}>|null, reason?:string}}
 */
export function collectStatBarGlyphs(image, options = {}) {
  const o = { ...DEFAULT_STATBAR_OPTIONS, ...options };
  const located = locateStatBar(image, o);
  if (!located.values) {
    return { located, entries: null, reason: located.reason ?? '搵唔到面板條' };
  }
  const { values } = located;
  const roi = located.image;

  // ⚠️ 遮罩一定要喺**整個 ROI**（有背景）上面做，唔可以剪一條貼邊條帶：
  //    貼邊條帶冇淺色底 → 「深色字喺淺色底」結構條件失效 → 有環嘅數字（6/8/9）
  //    筆劃被剔走、碎裂成兩橛（實測：3 位數字切成 4 個字元）。
  //    只係之後嘅**投影**限制喺大數值行嘅 y 範圍（唔理上限行），就唔會撞到上限。
  const f = values.height / o.targetGlyphHeight;
  const minGap = Math.max(1, Math.round(3 * f));
  const numberGap = Math.max(4, Math.round(10 * f));
  const windowRadius = Math.min(12, Math.max(2, Math.round(6 * f)));
  const mask = buildInkMask(roi, { ...o, windowRadius });

  const groups = columnsToGroups(mask, roi.width, values.y0, values.y1, { ...o, minGap });
  const all = groupsToNumbers(groups, { ...o, numberGap });
  const picked = pickFiveBySpacing(all, o);
  if (!picked) {
    return { located, entries: null, reason: `候選數字唔夠／唔等距（候選 ${all.length} 個）` };
  }
  const entries = picked.numbers.map((num) => ({
    num,
    glyphs: extractGlyphs(roi, mask, { x0: num.x0, x1: num.x1 }, values.y0, values.y1),
  }));
  return { located, entries, reason: undefined };
}

/**
 * 讀實機五維面板條。
 *
 * ## 為何唔重採樣（2026-09-18 實測踩過）
 *
 * 一開始想「把條帶重採樣到模板尺度（17px）先跑」→ **失敗**：
 * 24px 嘅字縮到 17px 之後筆劃變薄，反鋸齒令筆劃像素變淺（lum 升過 0.62）→
 * 墨點遮罩穿窿 → 一個「6」被切成兩橛、字元數爆數（實測 3 位數字切成 4–7 個字元）。
 *
 * **正解**：喺**原生解析度**做遮罩同切字（筆劃完整），而
 * `extractGlyphs()` 本身會把**每個字元**正規化到 16×24 網格（尺度不變），
 * 所以真正要跟尺度縮放嘅只有「砌數字／切字群」嗰幾個像素門檻。
 *
 * @param {{data:Uint8ClampedArray,width:number,height:number}} image 整個視窗（可以含標題列）
 * @param {Record<string, Float32Array>} templates 字形模板
 * @param {object} [options]
 * @returns {{stats:number[]|null, texts:string[]|null, confidence:number, row:object|null, reason?:string}}
 */
export function readStatBar(image, templates, options = {}) {
  const o = { ...DEFAULT_STATBAR_OPTIONS, ...options };
  const { located, entries, reason } = collectStatBarGlyphs(image, o);
  const values = located.values;
  if (!entries) {
    return { stats: null, texts: null, confidence: 0, row: values ?? null, reason };
  }

  const texts = [];
  let confidence = 1;
  for (const [i, entry] of entries.entries()) {
    const read = readNumberTrimmed(entry.glyphs, templates, o);
    confidence = Math.min(confidence, read.confidence);
    if (!/^\d+$/.test(read.text)) {
      return {
        stats: null, texts: [...texts, read.text], confidence, row: values,
        reason: `第 ${i + 1} 個數值讀唔清（「${read.text}」）`,
      };
    }
    texts.push(read.text);
  }

  const stats = texts.map(Number);
  if (o.minConfidence !== undefined && confidence < o.minConfidence) {
    return {
      stats: null, texts, confidence, row: values,
      reason: `信心 ${confidence.toFixed(2)} < ${o.minConfidence}（寧願唔出數，唔可以出錯數）`,
    };
  }
  return { stats, texts, confidence, row: values };
}
