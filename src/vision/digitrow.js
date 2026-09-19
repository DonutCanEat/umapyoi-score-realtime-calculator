/**
 * 五維數字列偵測（**色彩與插畫無關**）。
 *
 * ## 設計原則
 *
 * 1. **唔可以靠面板顏色**：ステータス面板顏色跟隻馬嘅主題色（用戶實機確認），
 *    任何寫死色相嘅判定都會喺其他馬身上失效。
 * 2. **唔可以靠「墨量」揀行**：實測全畫面截圖入面，插畫嘅墨點比真正數字多一個數量級，
 *    按墨量排名一定揀錯（呢個係之前一直失敗嘅根因）。
 * 3. **唔可以只用顏色判墨**：暖色插畫會大量通過純顏色判準 →
 *    一定要配「深色字喺淺色底上面」嘅結構條件，見 `inkmask.js`。
 *
 * ## 現行流程
 *
 * ```
 * buildInkMask()      顏色 + 淺色底 → 墨點遮罩（剔走插畫）
 * findTextLines()     連續有墨嘅行 → 文字行
 * denseBands()        行內再切「密集帶」→ 真正嘅字身範圍（避免兩行黏埋）
 * columnsToGroups()   欄投影 → 字群
 * groupsToNumbers()   用間距砌返「數字」
 * pickBestFive()      由候選揀最似五維嘅 5 個
 * scoreNumberRow()    結構評分（寬度相近、等距、有高度）
 * coverage            5 個數字要佔盡該行嘅墨（文字段落會有大量殘墨 → 淘汰）
 * ```
 */

import { buildInkMask, findTextLines, isDigitInk, maskRowCounts } from './inkmask.js';
import { forEachCombination5 } from './combinations.js';
import { columnCounts, countInk, densestRun, rowCounts, runSpans } from './projection.js';

export { isDigitInk, buildInkMask, findTextLines, maskRowCounts };

/** 逐行墨點數（保留舊名，內部用遮罩）。 */
export function inkRowCounts(image, options = {}) {
  const mask = options.mask ?? buildInkMask(image, options);
  return maskRowCounts(image, mask);
}

/** 一行帶入面做欄投影，切出字形群組。 */
export function columnsToGroups(mask, width, y0, y1, options = {}) {
  const minGap = options.minGap ?? 3;
  const minInk = options.minInk ?? 2;

  // ⚠️ 投影同切段都係 `projection.js` 嘅共用實作（審計 M3；行為同以前逐位元一樣）：
  //    `trimTrailingGap: true` ＝ 以前嗰句「尾段 `x1 = width - 1 - gap`」
  const cols = columnCounts(mask, width, y0, y1);
  return runSpans(cols, { minValue: minInk, gapTolerance: minGap, trimTrailingGap: true })
    .map((run) => ({ x0: run.from, x1: run.to, ink: run.ink }))
    .filter((g) => g.x1 >= g.x0);
}

/**
 * 把字形群組砌返做「數字」。
 *
 * ⚠️ 2026-09 修正：唔可以再用「中位間距 × 2.2」嘅自適應門檻。
 *    實測 uma2 嘅格係「[徽章雜訊][數字]」，徽章同數字之間隔 13~17px，
 *    而數字內部只隔 2~7px。用中位數會畀徽章嘅大間距拉高門檻
 *    （median 13 → 門檻 30）→ 徽章同數字黏成同一個「數字」（闊 70px）→ 切字元爆數。
 *
 *    真實分佈嘅安全邊界好闊：
 *      數字內部位間距：2–7px
 *      數字之間（格與格）：28–68px
 *      徽章與數字之間：11–20px
 *    → 用**固定門檻 10px** 同時切開「格與格」同「徽章與數字」，兩邊都唔會誤切。
 */
export function groupsToNumbers(groups, options = {}) {
  if (groups.length === 0) return [];
  const threshold = options.numberGap ?? 10;

  const numbers = [];
  let current = { x0: groups[0].x0, x1: groups[0].x1, parts: [groups[0]], ink: groups[0].ink ?? 0 };
  for (let i = 1; i < groups.length; i += 1) {
    const gap = groups[i].x0 - groups[i - 1].x1 - 1;
    if (gap >= threshold) {
      numbers.push(current);
      current = { x0: groups[i].x0, x1: groups[i].x1, parts: [groups[i]], ink: groups[i].ink ?? 0 };
    } else {
      current.x1 = groups[i].x1;
      current.parts.push(groups[i]);
      current.ink += groups[i].ink ?? 0;
    }
  }
  numbers.push(current);
  return numbers;
}

/**
 * 由一堆候選「數字」揀出最好嘅 5 個。
 *
 * 為何需要：一個格係「[ランク徽章][數字]」，徽章同屬性名都可能會混入，
 * 所以切出嚟嘅候選通常多過 5 個。五維嘅特徵係「**5 個、寬度相近、間距相近**」
 * → 用組合搜尋揀最似嗰組。
 */
export function pickBestFive(numbers, options = {}) {
  if (numbers.length < 5) return null;
  if (numbers.length === 5) return { numbers, cost: 0 };

  let best = null;
  // 組合迭代器住喺 `combinations.js`（同 `statbar.pickFiveBySpacing()` 共用**同一份**）。
  // ⚠️ 成本函數（闊度 + 間距變異）同門檻係呢條「gt 排法」路專用 ——
  //    面板條嗰條**刻意唔同**（只按右邊界間距，見 pitfalls #23），唔准順手統一。
  // ⚠️ `visit` 入面用 `return` ＝ 原本嘅 `continue`。
  forEachCombination5(numbers.length, (idx) => {
    const sel = idx.map((i) => numbers[i]);
    const widths = sel.map((s) => s.x1 - s.x0 + 1);
    const gaps = [];
    for (let i = 1; i < 5; i += 1) gaps.push(sel[i].x0 - sel[i - 1].x1 - 1);
    if (gaps.some((g) => g < 3)) return;

    const wMean = widths.reduce((a, b) => a + b, 0) / 5;
    const gMean = gaps.reduce((a, b) => a + b, 0) / 4;
    if (wMean < 8 || gMean <= 0) return;
    const wVar = widths.reduce((a, w) => a + (w - wMean) ** 2, 0) / 5 / (wMean ** 2);
    const gVar = gaps.reduce((a, g) => a + (g - gMean) ** 2, 0) / 4 / (gMean ** 2);
    const cost = wVar + gVar * (options.spacingWeight ?? 1.5);

    if (!best || cost < best.cost) {
      best = { numbers: sel, cost, widthSpread: Math.max(...widths) / Math.min(...widths) };
    }
  });

  return best;
}

/** 結構評分：五維數字係「5 個、同級、等距、有高度」。唔合格回 null。 */
export function scoreNumberRow(numbers, y0, y1, options = {}) {
  if (numbers.length !== 5) return null;
  const widths = numbers.map((n) => n.x1 - n.x0 + 1);
  const minW = Math.min(...widths);
  const maxW = Math.max(...widths);
  if (minW < 8) return null;
  // 適性列（草地S/沙地B/短距離E…）都有 5 個色塊，但寬度差好遠。
  if (maxW / minW > (options.maxWidthSpread ?? 1.5)) return null;

  const gaps = [];
  for (let i = 1; i < numbers.length; i += 1) {
    gaps.push(numbers[i].x0 - numbers[i - 1].x1 - 1);
  }
  const minGap = Math.min(...gaps);
  const maxGap = Math.max(...gaps);
  if (minGap < 3) return null;                          // 數字之間要有明顯間距
  if (maxGap / Math.max(1, minGap) > 2.5) return null;  // 間距要相近（等距排列）

  const bandHeight = y1 - y0 + 1;
  if (bandHeight < 8) return null;
  return {
    bandHeight,
    spacing: Math.round((minGap + maxGap) / 2),
    widthSpread: Number((maxW / minW).toFixed(2)),
  };
}

/**
 * 喺一條文字行入面，再切出「密集帶」。
 *
 * 為何需要：文字行係用低門檻切嘅，所以兩行字會黏成一條（例如 y=747..782 其實係
 * 兩行數字）。密集帶用「逐行墨點數 ≥ 該行峰值嘅某個比例」再切一次，
 * 就會得到真正嘅字身範圍。
 */
export function denseBands(mask, width, line, options = {}) {
  const minRatio = options.bandRatio ?? 0.35;
  const maxHeight = options.maxBandHeight ?? 60;
  // ⚠️ 投影係共用實作（審計 M3）；`counts[i]` 對應第 `line.y0 + i` 行
  const counts = rowCounts(mask, width, line.y0, line.y1);
  let peak = 0;
  for (let i = 0; i < counts.length; i += 1) {
    if (counts[i] > peak) peak = counts[i];
  }
  if (peak === 0) return [];
  const threshold = Math.max(2, peak * minRatio);

  // ⚠️ 切段用共用實作（審計 M3）：容忍度 1（一唔夠密就切開）。
  //    以前嘅手寫版有個 `i === counts.length - 1` 特例（最後一行夠密都要收段）——
  //    `runSpans()` 嘅尾段處理（`trimTrailingGap: false`）已經等價。
  return runSpans(counts, { minValue: threshold, gapTolerance: 1 })
    .map((run) => ({ y0: line.y0 + run.from, y1: line.y0 + run.to, height: run.to - run.from + 1 }))
    .filter((band) => band.height <= maxHeight);
}

/**
 * 收窄一條帶到「真正嘅字身範圍」。
 *
 * 為何需要（2026-09 實測）：文字行嘅上下經常黏住稀疏嘅雜訊（邊框、插畫邊緣、
 * 相鄰元素），令帶高由 17px 變 32px。帶太高會有兩個惡果：
 *   1. 切字元時會夾埋雜訊 → 字元數唔對；
 *   2. 字形被拉長 → 歸一化之後同模板對唔上 → 讀錯數。
 *
 * 做法：以帶內墨點峰值嘅 `ratio`（預設 0.25）做門檻，取**包含峰值**嘅連續段。
 * 實測 uma1（峰值 144，帶 259..283 → 收窄到 259..276）
 * 同 uma2（峰值 158，帶 251..282 → 收窄到 258..275），兩者都準。
 *
 * ⚠️ 門檻唔可以設得太高（例如 0.4）：字形嘅橫劃（例如「8」中間、「5」頂）會令
 *    個別行嘅墨點數遠高於其他行，太高嘅門檻會令收窄出嚟嘅帶只剩一兩行（實測過）。
 */
export function tightenBand(mask, width, y0, y1, options = {}) {
  const ratio = options.tightenRatio ?? 0.25;
  // ⚠️ 投影係共用實作（審計 M3）。`counts[i]` 對應第 `y0 + i` 行。
  //    （舊版有個 `peakIndex` 但從來冇任何地方讀 → 已經刪走，行為不變。）
  const counts = rowCounts(mask, width, y0, y1);
  let peak = -1;
  for (let i = 0; i < counts.length; i += 1) {
    if (counts[i] > peak) peak = counts[i];
  }
  if (peak <= 0) return { y0, y1 };
  const threshold = Math.max(1, peak * ratio);

  // 揀「墨量最多」嘅連續段，而唔係「包含第一條峰值行」嗰段。
  // 原因：一枝獨秀嘅單行（例如邊框線）都可能有全帶最高嘅墨量，
  // 揀佢會得出只有一兩行嘅帶（實測踩過）。同墨量就揀較長、再揀較前。
  // ⚠️ 規則住喺 `projection.densestRun()`（審計 M3；同以前手寫版同一條規則）
  const best = densestRun(counts, threshold);
  if (!best) return { y0, y1 };
  return { y0: y0 + best.from, y1: y0 + best.to };
}

/**
 * 全圖搜尋「五維數字列」。
 *
 * @returns {{y0,y1,numbers,spacing,coverage,confidence}|null}
 */
export function detectDigitRow(image, options = {}) {
  const { data, width, height } = image;
  const mask = options.mask ?? buildInkMask(image, options);
  const lines = findTextLines(image, mask, options);

  let best = null;
  const consider = (y0, y1, lineInk) => {
    const height = y1 - y0 + 1;
    if (height < (options.minHeight ?? 8)) return;
    if (height > (options.maxHeight ?? 70)) return;

    const groups = columnsToGroups(mask, width, y0, y1, options);
    if (groups.length < 5) return;
    const allNumbers = groupsToNumbers(groups, options);
    const picked = allNumbers.length === 5 ? { numbers: allNumbers, cost: 0 } : pickBestFive(allNumbers, options);
    if (!picked) return;
    const score = scoreNumberRow(picked.numbers, y0, y1, options);
    if (!score) return;

    // 5 個數字要佔盡該行嘅墨：文字段落／插畫會有大量殘墨 → 淘汰。
    const usedInk = picked.numbers.reduce((sum, n) => sum + (n.ink ?? 0), 0);
    const coverage = lineInk > 0 ? usedInk / lineInk : 0;
    if (coverage < (options.minCoverage ?? 0.55)) return;

    const cost = picked.cost;
    if (!best || coverage > best.coverage + 1e-9 || (Math.abs(coverage - best.coverage) < 1e-9 && cost < best.cost)) {
      best = {
        y0,
        y1,
        numbers: picked.numbers,
        coverage,
        cost,
        ...score,
      };
    }
  };

  // 1) 先用「密集帶」試（可以分開黏埋嘅兩行），每條都收窄到字身範圍
  const bands = [];
  for (const line of lines) {
    for (const band of denseBands(mask, width, line, options)) {
      bands.push(tightenBand(mask, width, band.y0, band.y1, options));
    }
    bands.push(tightenBand(mask, width, line.y0, line.y1, options));
  }
  for (const band of bands) {
    if (band.y1 < band.y0) continue;
    // ⚠️ 框墨量用共用實作（審計 M3）：同一格帶唔應該有兩個唔同嘅數
    consider(band.y0, band.y1, countInk(mask, width, band.y0, band.y1));
  }
  if (!best) return null;

  return {
    y0: best.y0,
    y1: best.y1,
    numbers: best.numbers.map((n) => ({ x0: n.x0, x1: n.x1, ink: n.ink, parts: n.parts })),
    spacing: best.spacing,
    coverage: Number(best.coverage.toFixed(3)),
    confidence: Math.min(1, best.coverage * (best.widthSpread <= 1.6 ? 1 : 0.75)),
  };
}
