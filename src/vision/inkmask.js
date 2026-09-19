/**
 * 墨點遮罩（背景受控）：決定「邊啲像素係我哋想要嘅數字墨」。
 *
 * ## 為何需要呢一層（2026-09 實測，重大修正）
 *
 * 舊版 `digitrow.js` 嘅 `isDigitInk(r,g,b)` 只用「顏色」判準：
 *   色相 15–50°（橙棕）+ 亮度 < 0.62。
 *
 * 但真實**全畫面**截圖（1902×1101）入面，遊戲嘅插畫／背景係一大片暖色調，
 * 大量像素啱啱好落入呢個窗口。實測 `shots/debug-crops/reference.png`：
 *
 *   原始墨點 = 67,917 粒
 *   當中最長一條「文字行」係 y=400..939（高 540 行！）、墨點 48,372 粒
 *   → 即係成幅插畫都被當成「一行文字」
 *
 * 後果：`detectDigitRow()` 按「墨量」揀行 → 一定揀到插畫 → 永遠讀唔到數字。
 * 呢個就係之前「數字列偵測唔到」嘅真正根因（唔係門檻調得唔好）。
 *
 * ## 修正：數字墨一定要「深色字喺淺色底上面」
 *
 * 遊戲 UI 嘅數值格係**近白底**（實測 min(r,g,b) ≥ 200），而插畫係中色調漸變。
 * 所以加一個**色彩無關**嘅結構條件：一個墨點像素嘅周邊窗口，
 * 一定要有足夠比例嘅淺色底。
 *
 * 加咗之後：67,917 → 22,125 粒（保留 32.6%），插畫整條消失，
 * 真正嘅數字行（y=747..782，橫跨 x=310..811）走返出嚟。
 *
 * 實作用**積分圖**（summed-area table）查窗口淺色比例，O(1) per pixel，
 * 全圖 2.09M 像素約幾十 ms；實時管線收到嘅係 640px 縮圖，更加快。
 */

/**
 * 墨色判準嘅門檻（可調 —— `tools/tune-detect.js --hue` 會掃描呢幾個值量安全邊界）。
 *
 * ⚠️ **實測（2026-09，`node tools/diag-hue.js`，8 張實機圖 40 格）**：
 *   數字墨 hue p5..p95 = **25..26°**（min 25、max 41–44）、lum p5..p95 = 0.32..0.59。
 *   即係窗口 15–50° 兩邊都有好大餘量 —— 收窄係安全嘅，同時暖色雜物會少啲。
 *   但**徽章色相同數字墨重疊**（實測徽章 hue 17–44°），所以唔可以靠色相剔徽章，
 *   一定要靠結構條件（淺色底）＋ `readNumberTrimmed()` 由右邊貪心收。詳見 §2.2。
 */
export const DEFAULT_INK_OPTIONS = Object.freeze({
  deltaMin: 30,   // 灰／黑（冇色相）唔算墨
  hueMin: 15,     // 橙棕窗口下界
  hueMax: 50,     // 橙棕窗口上界
  lumMax: 0.62,   // 亮度上界（太光 = 淺色底，唔係字）
  /**
   * **金色高光窗口**（第二個窗口，預設**關**）。
   *
   * 為何需要（2026-09-18 實機 dump 實測）：屬性升咗之後，遊戲會把該格數字畫成**金色**，
   * 而金色係「深金邊 ＋ 極淺金高光」（實測 `rgb(255,255,214)`、色相 60°、亮度 **0.98**）。
   * 淨用橙棕窗口（lum < 0.62）會**削走淺金部分** → 連「9」嘅上圈左邊筆劃都冇咗 →
   * 形狀變成似「3」（實測 3:0.60 vs 9:0.60 打和）→ **靜默讀錯**（1489 讀成 1483）。
   *
   * 為何唔可以單純調高 lumMax：面板底色本身都係暖色（實測色相 27–44°、亮度 0.63–0.92），
   * 一放寬就會連底都當成墨 → 全盤污染。但**淺金**嘅色相（實測 50–70°）同底（≤44°）分得開，
   * 所以用「色相 50–70°、飽和 ≥ 40、亮度 < 0.99」呢個獨立窗口去捉高光。
   */
  goldHueMin: undefined,
  goldHueMax: undefined,
  goldDeltaMin: undefined,
  goldLumMax: undefined,
});

/** 一格像素嘅色相（0–360）；灰／黑（冇色相）回 null。 */
export function pixelHue(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta < 1) return null;
  let hue;
  if (max === r) hue = 60 * (((g - b) / delta) % 6);
  else if (max === g) hue = 60 * ((b - r) / delta + 2);
  else hue = 60 * ((r - g) / delta + 4);
  if (hue < 0) hue += 360;
  return hue;
}

/** 用預設補齊局部門檻（唔完整嘅 options 唔可以直接用，否則 undefined 會令比較全部 false）。 */
export function resolveInkOptions(options) {
  if (!options) return DEFAULT_INK_OPTIONS;
  if (
    options.deltaMin !== undefined &&
    options.hueMin !== undefined &&
    options.hueMax !== undefined &&
    options.lumMax !== undefined
  ) {
    return options; // 已經齊全（熱路徑：buildInkMask 傳嘅就係完整 object）→ 唔使再分配
  }
  return Object.freeze({ ...DEFAULT_INK_OPTIONS, ...options });
}

/**
 * 一格像素嘅顏色係唔係「數字墨色」。
 *
 * 兩個窗口（OR）：
 *   1. 橙棕（一般狀態）：色相 hueMin–hueMax、亮度 < lumMax
 *   2. 淺金高光（屬性升咗之後）：色相 goldHueMin–goldHueMax、亮度 < goldLumMax
 *      —— 預設關（`goldHueMin` 係 undefined）；實測要開先讀得啱金色數字（見上面註釋）。
 *
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {Partial<typeof DEFAULT_INK_OPTIONS>} [options] 唔傳 = 用預設門檻
 */
export function isDigitInk(r, g, b, options) {
  const o = resolveInkOptions(options);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta < o.deltaMin) return false; // 灰／黑（冇色相）唔係數字墨

  const hue = pixelHue(r, g, b);

  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // 窗口 1：橙棕
  // ランク徽章本身有金／粉／綠／藍／紫，但**實測金徽章 hue 17–44°**
  // 落喺窗口內 → 色相剔唔走佢，要靠亮度同結構條件（見 §2.2）。
  if (hue >= o.hueMin && hue <= o.hueMax && lum < o.lumMax) return true;

  // 窗口 2：淺金高光（屬性升咗之後嘅金色數字）—— 預設關
  if (
    o.goldHueMin !== undefined &&
    hue >= o.goldHueMin &&
    hue <= o.goldHueMax &&
    delta >= o.goldDeltaMin &&
    lum < o.goldLumMax
  ) {
    return true;
  }
  return false;
}

/** 預設參數。 */
export const DEFAULT_MASK_OPTIONS = Object.freeze({
  lightMin: 200,       // 淺色底：min(r,g,b) 幾多以上先算「淺色」
  windowRadius: 6,     // 查窗口半徑（13×13）
  lightFraction: 0.4,  // 窗口內淺色比例門檻
  ...DEFAULT_INK_OPTIONS,
});

/**
 * 建立背景受控嘅墨點遮罩。
 *
 * ⚠️ `lightFraction` 係全局嘅結構條件，**唔可以隨便放寬**（見地雷 #21／#26）：
 * 佢係「深色字喺淺色底上面」嘅判準，放寬會令暖色插畫／選單雜訊重新入遮罩。
 * 但**金色格**（屬性 > 1200 之後長期金色）嘅淺金高光會把窗口淺色比例推爆
 * → 反而削走筆劃 → 所以 `statbar.js` 會**只喺金色格**用 `goldLightFraction` 重做遮罩。
 *
 * @param {{data:Uint8ClampedArray,width:number,height:number}} image
 * @param {Partial<typeof DEFAULT_MASK_OPTIONS>} [options]
 * @returns {Uint8Array} 長度 width*height，1 = 數字墨
 */
export function buildInkMask(image, options = {}) {
  const merged = { ...DEFAULT_MASK_OPTIONS, ...options };
  const { lightMin, windowRadius, lightFraction } = merged;
  // 墨色門檻只砌一次（每像素都用同一個 object，避免熱路徑分配）
  const inkOptions = {
    deltaMin: merged.deltaMin,
    hueMin: merged.hueMin,
    hueMax: merged.hueMax,
    lumMax: merged.lumMax,
    goldHueMin: merged.goldHueMin,
    goldHueMax: merged.goldHueMax,
    goldDeltaMin: merged.goldDeltaMin,
    goldLumMax: merged.goldLumMax,
  };
  const { data, width, height } = image;
  const n = width * height;
  const mask = new Uint8Array(n);

  // 淺色底遮罩（同時記住邊啲像素係墨色候選）
  const light = new Uint8Array(n);
  const candidate = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    const p = i * 4;
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    if (Math.min(r, g, b) >= lightMin) light[i] = 1;
    else if (isDigitInk(r, g, b, inkOptions)) candidate[i] = 1;
  }

  // 積分圖：integral[(y+1)*(width+1)+(x+1)] = 左上角 (0,0)..(y,x) 嘅淺色總數
  const stride = width + 1;
  const integral = new Int32Array(stride * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    const rowBase = y * width;
    const outBase = (y + 1) * stride;
    const prevBase = y * stride;
    for (let x = 0; x < width; x += 1) {
      rowSum += light[rowBase + x];
      integral[outBase + x + 1] = integral[prevBase + x + 1] + rowSum;
    }
  }

  const minNeeded = lightFraction;
  for (let y = 0; y < height; y += 1) {
    const y0 = y - windowRadius < 0 ? 0 : y - windowRadius;
    const y1 = y + windowRadius >= height ? height - 1 : y + windowRadius;
    const rowBase = y * width;
    const topBase = y0 * stride;
    const bottomBase = (y1 + 1) * stride;
    const area = (y1 - y0 + 1) * 1;
    for (let x = 0; x < width; x += 1) {
      if (!candidate[rowBase + x]) continue;
      const x0 = x - windowRadius < 0 ? 0 : x - windowRadius;
      const x1 = x + windowRadius >= width ? width - 1 : x + windowRadius;
      const lightCount =
        integral[bottomBase + x1 + 1] - integral[topBase + x1 + 1] -
        integral[bottomBase + x0] + integral[topBase + x0];
      const total = area * (x1 - x0 + 1);
      if (lightCount >= total * minNeeded) mask[rowBase + x] = 1;
    }
  }

  return mask;
}

/** 逐行墨點數（用遮罩）。 */
export function maskRowCounts(image, mask) {
  const { width, height } = image;
  const counts = new Int32Array(height);
  for (let y = 0; y < height; y += 1) {
    const base = y * width;
    let c = 0;
    for (let x = 0; x < width; x += 1) c += mask[base + x];
    counts[y] = c;
  }
  return counts;
}

/**
 * 由遮罩切出「文字行」：連續有足夠墨點嘅行。
 *
 * 為何要切行：唔可以先砌大帶再切字。插畫／密集文字會令幾行黏成一條巨帶，
 * 之後「高度上限」會連真正嘅數字行都濾走（舊版踩過）。
 *
 * @returns {Array<{y0:number,y1:number,height:number,ink:number}>}
 */
export function findTextLines(image, mask, options = {}) {
  const minRowInk = options.minRowInk ?? 3;
  const counts = maskRowCounts(image, mask);
  const lines = [];
  let y = 0;
  while (y < counts.length) {
    if (counts[y] < minRowInk) { y += 1; continue; }
    let y1 = y;
    let ink = counts[y];
    while (y1 + 1 < counts.length && counts[y1 + 1] >= minRowInk) {
      y1 += 1;
      ink += counts[y1];
    }
    lines.push({ y0: y, y1, height: y1 - y + 1, ink });
    y = y1 + 1;
  }
  return lines;
}
