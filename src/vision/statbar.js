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

import { buildInkMask, findTextLines, pixelHue } from './inkmask.js';
import { denseBands, tightenBand, columnsToGroups, groupsToNumbers } from './digitrow.js';
import { extractGlyphs, readNumberBoxes } from './glyphs.js';
import { forEachCombination5 } from './combinations.js';
// ⚠️ `countInk` 已經改用 `projection.js` 嘅共用版（審計 M3：以前呢個檔自己寫一份）。
import { columnCounts, countInk } from './projection.js';

/**
 * 墨點像素嘅**色相分位數**（用嚟分「正常橙棕」同「金色高亮」）。
 * 實測：正常幀 p90 ≈ 27.2–27.8°、金幀 p90 ≈ 37.5–38.7°。
 *
 * @param {number} [x0] 限定橫向範圍（用嚟逐格判斷係唔係金色格）
 */
function inkHuePercentile(roi, mask, y0, y1, p, x0 = 0, x1 = roi.width - 1) {
  const hues = [];
  for (let y = y0; y <= y1; y += 1) {
    const base = y * roi.width;
    for (let x = x0; x <= x1; x += 1) {
      if (!mask[base + x]) continue;
      const q = (base + x) * 4;
      const hue = pixelHue(roi.data[q], roi.data[q + 1], roi.data[q + 2]);
      if (hue !== null) hues.push(hue);
    }
  }
  if (!hues.length) return null;
  hues.sort((a, b) => a - b);
  return hues[Math.min(hues.length - 1, Math.floor(hues.length * p))];
}

/** 預設參數（相對座標係 ÷ 內容區 16:9）。 */
export const DEFAULT_STATBAR_OPTIONS = Object.freeze({
  aspect: 9 / 16,      // 遊戲內容區比例
  roiX: [0.15, 0.44],   // 實測面板條橫向佔 0.164–0.426（5 個解析度一致）
  roiY: [0.645, 0.735], // 實測面板列 y 0.691–0.703，上下各留邊
  targetGlyphHeight: 17, // 模板建立時嘅字高（gt 截圖實測）
  minBandInk: 20,
  minValuesSpread: 0.6,
  minLimitsSpread: 0.5,
  /**
   * 接受門檻（原本 0.55）。
   * 實機數字係**漸變色**（上淺下深），墨點遮罩會削走較淺嘅上半 →
   * 同模板嘅相似度天然偏低。實測掃描（`shots/live-debug/` 47 幀 ＋ 8 張真值圖）：
   *   0.45 → 讀到 9 幀；0.40 → 讀到 10 幀（多一幀，真值「8」得 0.41）；
   *   再低（0.35/0.30/0.25）冇任何額外好處，而且讀到嘅值**全部同已知值一致**（零不一致）。
   * 安全網：① 由右邊貪心收；② `dropNonDigits()`；③ `looksLikeStatBar()` 尺寸檢查；
   * ④ 幀間多數投票（3/5）。
   */
  minAccept: 0.40,
  /**
   * 「唔似面板條」檢查（下界）：由 ROI 闊度**推算**正常面板條嘅字高。
   * 因為 UI 係等比縮放 → 數值字高 ≈ 0.0098×圖闊（實測 5 個解析度），
   * 而 ROI 佔圖闊 (roiX[1] − roiX[0])。
   * 用途：其他畫面（例如選單、ステータス列表）都有「一行字」，但字會細好多；
   * 咁樣就唔應該報「讀唔清」嚇人，而係老實講「唔似面板條」。
   *
   * ⚠️ **2026-09-19 收緊 0.6 → 0.8（實機假陽性，見 AGENTS 地雷 #30）**：
   * 支援卡列表嘅「Lv27／Lv27／Lv25／Lv25／Lv25」徽章行一樣係「5 個等距數字」，
   * 字高比 = **0.64** —— 舊門檻 0.6 啱啱好放佢過關，於是**靜默讀出 27/27/25/25/25**
   * （用戶當時真實數值係 700+）。實測 14 張真值圖（6 全窗 ＋ 8 已剪 ROI，包括一張
   * 被對話框遮住嘅）字高比 = **0.85–0.96** → 門檻 **0.8** 兩邊都留到餘量
   * （比最低真值低 0.05、比假陽性高 0.16）。
   * ⚠️ 唔准調返落 0.6：0.6–0.8 之間係「假陽性會過、真值唔會跌到」嘅危險帶。
   */
  minGlyphHeightRatio: 0.8,
  /**
   * 「唔似面板條」檢查（結構）：**上限行一定要真係有字**。
   *
   * 真面板條**一定**有「/上限」行（一行細字數字）。實測真值圖嘅上限行墨量
   * **164–1599 粒**（2026-09-19 加入 `live-1929x1085.png` 之後重測，範圍不變；
   * 最細嗰張係 1356 闊 ＋ 上限行被削到 2px 高）。
   * 而支援卡列表嗰種假陽性，「上限行」其實只係**卡片邊線**（4px 高、**24 粒墨**）
   * → 用絕對墨量下限 60 分得開（比最低真值低 2.7×、比假陽性高 2.5×）。
   *
   * ⚠️ **唔可以用「上限行墨量 ÷ 大數值行墨量」嘅比值**：實測真值圖 0.10–0.62，
   *    假陽性 0.03 —— 同真值嘅下緣（0.10）太近，而且真值圖入面有一張
   *    （`roi-live-387.png`，面板被對話框遮住）**完全冇上限行** → 用比值就會殺錯良民。
   *    所以：**冇上限行嗰陣唔用呢條閘**（交返畀上面嘅字高比閘把關）。
   */
  minLimitsInk: 60,
  minGlyphHeight: 6,
  expectedGlyphHeightK: 0.0098,
  /**
   * 「金色格」偵測（屬性達到 1200 之後，遊戲會把**嗰一格**數字畫成金色）。
   *
   * 用戶 2026-09-18 確認兩件事：① **逐格獨立** —— 只有過 1200 嗰格變金，
   * 其餘格照舊橙棕（實測金幀：1489 金、543/655/624/628 橙棕）；
   * ② **一達到 1200 就即刻變金**（唔係等訓練完／唔係短暫高亮）。
   * → 所以一定要**逐格**判斷（`x0`/`x1` 限定範圍），唔可以用整條面板條嘅平均。
   *
   * 判準：該格墨點嘅**色相 p90**。實測正常幀 27.2–27.8°、金幀 37.5–44° → 用 33 分開。
   */
  goldHueThreshold: 33,
  goldMinInk: 80,
  /**
   * **金色數字專用嘅遮罩**（地雷 #26 嘅正解）。
   *
   * 用戶 2026-09-18 確認：**「只要數值超過 1200 就會變金」** —— 即係金色唔係
   * 升屬性之後嘅短暫高亮，而係**長期狀態**。所以「偵測到金色就唔出數」等於
   * 千二點之後**永遠冇數**，唔可行。
   *
   * 實測根因：金色數字係「深金邊 ＋ 極淺金高光」（高光 `rgb(255,255,214)`、亮度 0.98），
   * 而墨點遮罩除咗顏色窗口，仲有「深色字喺淺色底上面」嘅**結構條件**
   * （窗口內淺色比例 ≥ `lightFraction` 0.4）。金色格嘅淺金高光令窗口淺色比例
   * **超標** → 反而削走筆劃 → 字形被侵蝕（實測墨量由 137/176/188 跌到 119/89/137）
   * → 「9」同「3」打和、揀錯（1489 → **1483**，實測 60 幀 dump 入面 3 幀中招）。
   *
   * 量到嘅解法（`node tools/experiment-mask.js`，9 張真值圖）：
   *   `lightFraction` 0.4 → **8/9**（金幀讀成 1483）；**0.35 / 0.30 / 0.25 → 9/9**；
   *   另外 `lightMin` 180 都救得返（9/9）。但**唔可以全局放寬**：咁樣結構條件變弱，
   *   其他畫面嘅雜訊會被當成墨（dump 重播嘅 FAIL 由 10 幀升到 20 幀）。
   *   → 所以只喺**確認係金色**嘅格放寬，其餘照舊。
   */
  goldLightFraction: 0.3,
});

/**
 * 由 ROI 闊度推算「正常面板條嘅字高」（像素）。
 * @param {number} roiWidth
 * @param {object} [options]
 */
export function expectedGlyphHeight(roiWidth, options = {}) {
  const o = { ...DEFAULT_STATBAR_OPTIONS, ...options };
  const span = o.roiX[1] - o.roiX[0];
  return (roiWidth * o.expectedGlyphHeightK) / span;
}

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

/**
 * 一條帶嘅墨量同橫向範圍。
 *
 * ⚠️ 用共用欄投影（審計 M3）：呢條帶嘅墨量＝逐欄加總，而 `xMin`／`xMax` 就係
 * 「第一欄／最後一欄有墨」——整數運算，同以前逐格數**逐位元一樣**。
 * （舊寫法逐格掃一次同時做三件事；呢個版本掃一次欄投影，帶嘅數目好少，成本可以忽略。）
 */
function bandStats(mask, width, y0, y1) {
  const cols = columnCounts(mask, width, y0, y1);
  let ink = 0;
  let xMin = -1;
  let xMax = -1;
  for (let x = 0; x < cols.length; x += 1) {
    if (!cols[x]) continue;
    ink += cols[x];
    if (xMin < 0) xMin = x;
    xMax = x;
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
  // 組合迭代器住喺 `combinations.js`（同 `digitrow.pickBestFive()` 共用**同一份**）。
  // ⚠️ 成本函數（**只**按右邊界 x1 間距嘅相對方差）同 `minPitch` 係呢條路專用，
  //    唔准換成「闊度相近」（pitfalls #23：咁會揀到 `/上限` 欄）。
  // ⚠️ `visit` 入面用 `return` ＝ 原本嘅 `continue`。
  forEachCombination5(n, (idx) => {
    const sel = idx.map((i) => numbers[i]);
    const gaps = [];
    for (let i = 1; i < 5; i += 1) gaps.push(sel[i].x1 - sel[i - 1].x1);
    const minGap = Math.min(...gaps);
    if (minGap < (options.minPitch ?? 3)) return;
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const varSum = gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length;
    const cost = varSum / (mean * mean); // 相對方差：等距 = 0
    if (!best || cost < best.cost) best = { numbers: sel, cost, gaps };
  });
  return best;
}

/**
 * 剔走「唔可能係數字」嘅碎片。
 *
 * 為何需要（2026-09-18 實機 dump 實測）：第 5 格數字右邊有時會多一舊 **3×4 像素**
 * 嘅碎片（格線／高亮邊緣之類）。`readNumberTrimmed()` 係由右邊貪心收，
 * 一撞到低分就即刻停 → 成格報「?」，連左邊三個正確嘅數字都讀唔到。
 *
 * 判準：同一個數字入面，**所有字元高度一定一樣**（同一字型、同一行），
 * 所以矮過最高字元 55% 嘅一定唔係數字。
 */
export function dropNonDigits(glyphs, options = {}) {
  if (!glyphs || glyphs.length <= 1) return glyphs ?? [];
  const ratio = options.minGlyphHeightRatio ?? 0.55;
  const maxHeight = Math.max(...glyphs.map((g) => g.height));
  if (maxHeight < 6) return glyphs; // 太細就唔敢剔（可能係細字）
  const minHeight = Math.max(4, Math.round(maxHeight * ratio));
  const kept = glyphs.filter((g) => g.height >= minHeight);
  return kept.length ? kept : glyphs;
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
    return {
      located,
      entries: null,
      notBar: true,
      reason: located.reason ?? '搵唔到面板條',
    };
  }
  const { values } = located;
  const roi = located.image;

  // ⭐ 結構閘（2026-09-19 實機假陽性，見 AGENTS 地雷 #30）：上限行一定要真係有字。
  //    支援卡列表「Lv27…」徽章行下面只係一條卡片邊線（4px 高、24 粒墨）
  //    → 舊版照當佢係面板條，靜默讀出 27/27/25/25/25（用戶真實數值係 700+）。
  //    實測真值圖上限行墨量 164–1599 → 下限 60 分得開（冇上限行嗰陣唔用呢條閘）。
  if (located.limits && located.limits.ink < o.minLimitsInk) {
    return {
      located,
      entries: null,
      notBar: true,
      highlighted: false,
      reason:
        `唔似面板條（上限行只有 ${located.limits.ink} 粒墨，遠少過下限 ${o.minLimitsInk} —— ` +
        `真面板條嘅上限行係一行細字數字）`,
    };
  }

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
  const candidates = all.map((n) => `${n.x0}-${n.x1}(${n.parts.length}字)`);

  // 金色格（屬性 > 1200，長期金色）→ 個別用放寬嘅結構條件重做一次遮罩，
  // 否則淺金高光會令字形被侵蝕（實測 1489 → 1483，見 goldLightFraction 註釋）。
  const hueP90 = inkHuePercentile(roi, mask, values.y0, values.y1, 0.9);
  const highlighted = hueP90 !== null && hueP90 >= o.goldHueThreshold
    && countInk(mask, roi.width, values.y0, values.y1) >= o.goldMinInk;
  let relaxedMask = null;
  const maskFor = (num) => {
    if (!highlighted) return mask;
    const cellHue = inkHuePercentile(roi, mask, values.y0, values.y1, 0.9, num.x0, num.x1);
    if (cellHue === null || cellHue < o.goldHueThreshold) return mask;
    if (!relaxedMask) {
      relaxedMask = buildInkMask(roi, { ...o, windowRadius, lightFraction: o.goldLightFraction });
    }
    return relaxedMask;
  };

  const picked = pickFiveBySpacing(all, o);
  if (!picked) {
    return {
      located,
      entries: null,
      highlighted,
      candidates,
      reason: `候選數字唔夠／唔等距（候選 ${all.length} 個：${candidates.join(' ')}）`,
    };
  }
  const entries = picked.numbers.map((num) => {
    const useMask = maskFor(num);
    const raw = extractGlyphs(roi, useMask, { x0: num.x0, x1: num.x1 }, values.y0, values.y1);
    return { num, glyphs: dropNonDigits(raw, o), rawGlyphs: raw.length, mask: useMask };
  });

  // 「唔似面板條」檢查：真面板條嘅數字會填滿收窄後嘅帶（實測字高 ≈ 帶高），
  // 而字高應該 ≈ 0.0098×圖闊（UI 等比縮放）。其他畫面雖然都有「一行字」，
  // 但字會細好多 → 唔應該報「讀唔清」嚇人，老實講「唔似面板條」就好。
  const heights = entries.flatMap((e) => e.glyphs.map((g) => g.height)).sort((a, b) => a - b);
  const medianHeight = heights.length ? heights[Math.floor(heights.length / 2)] : 0;
  const expected = expectedGlyphHeight(roi.width, o);
  const minHeight = Math.max(o.minGlyphHeight, expected * o.minGlyphHeightRatio);
  if (medianHeight < minHeight) {
    return {
      located,
      entries: null,
      notBar: true,
      highlighted,
      candidates,
      reason:
        `唔似面板條（字元高 ${medianHeight}px 遠細過預期 ${Math.round(expected)}px；` +
        `帶高 ${values.height}px）`,
    };
  }
  return { located, entries, candidates, highlighted, reason: undefined };
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
  const { located, entries, reason, candidates, notBar, highlighted } = collectStatBarGlyphs(image, o);
  const values = located.values;
  if (!entries) {
    return {
      stats: null, texts: null, confidence: 0, row: values ?? null, reason, candidates,
      notBar: Boolean(notBar), highlighted: Boolean(highlighted),
    };
  }

  // 逐格讀數：交**共用**迴圈（信心取 min、一失敗即停 —— 同 `reader.readStats()`
  // 共用 `glyphs.readNumberBoxes()`，見獨立審計 H2）。
  // ⚠️ 呢條路嘅失敗訊息要附字元分數（診斷徽章黏埋／筆劃磨斷）——由 callback 砌，
  //    措辭同以前逐字一樣。
  const { texts, confidence, failed } = readNumberBoxes(
    entries.map((entry) => ({ box: entry.num, glyphs: entry.glyphs })),
    templates,
    o,
    (item, read, i) => {
      const detail = read.detail
        .map((d, k) => `${d.match.label}${d.match.score.toFixed(2)}(w${item.glyphs[k].width}h${item.glyphs[k].height})`)
        .join(' ');
      return (
        `第 ${i + 1} 個數值讀唔清（「${read.text}」，x=${item.box.x0}-${item.box.x1}，` +
        `切到 ${item.glyphs.length} 個字元：${detail || '—'}）`
      );
    },
  );
  if (failed) {
    return {
      stats: null, texts: [...texts, failed.read.text], confidence, row: values, candidates,
      highlighted: Boolean(highlighted),
      reason: failed.reason,
    };
  }

  const stats = texts.map(Number);
  if (o.minConfidence !== undefined && confidence < o.minConfidence) {
    return {
      stats: null, texts, confidence, row: values,
      highlighted: Boolean(highlighted),
      reason: `信心 ${confidence.toFixed(2)} < ${o.minConfidence}（寧願唔出數，唔可以出錯數）`,
    };
  }
  // `highlighted` 只係提示（該格屬性 > 1200，遊戲用金色顯示）—— 數值照出，
  // 因為金色係長期狀態，唔可以唔出數（見 goldLightFraction 註釋）。
  return { stats, texts, confidence, row: values, notBar: false, highlighted: Boolean(highlighted) };
}
