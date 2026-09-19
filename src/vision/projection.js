/**
 * 逐列／逐欄墨量投影 ＋ 連續段掃描（**唯一一份**，獨立審計 M3）。
 *
 * ## 為何要抽
 *
 * 影像管線最基本嘅兩個動作係「逐行加總墨點」同「逐欄加總墨點」，跟住就係
 * 「由一堆數值切出連續段」。呢兩樣嘢以前喺 `src/vision/` 入面總共寫咗 **9 次**
 * （`inkmask`／`digitrow`／`skillscreen`／`skillname`／`statbar`，連 `main.js` 嘅收圖
 * 進度顯示都自己一份）—— 骨架一樣、每次都要重新睇一次「係唔係 inclusive 邊界」。
 *
 * ## ⚠️ 呢度**只**做「投影」同「切段」——唔碰任何門檻
 *
 * 每一個呼叫點嘅門檻（`minRowInk`／`minGap`／`bandRatio`／`tightenRatio`…）都係
 * **實測安全邊界**（見 pitfalls #14／#18／#21／#26）：呢個檔一律由呼叫者傳入，
 * 唔會幫你揀、亦唔准「順手統一」。
 *
 * ## 熱路徑
 *
 * 每幀都會跑 → 一律 `Int32Array` ＋ 索引迴圈（零 `map`／`reduce`／閉包分配）。
 * 加總次序同原本逐字一樣（整數加法其實唔受次序影響，但保持一樣最易逐位元核對）。
 */

/**
 * 逐列墨點數（`rowCounts(mask, width, y0, y1)[i]` 對應第 `y0 + i` 行）。
 *
 * @param {Uint8Array} mask 長度 `width*height`，1 = 墨
 * @param {number} width 圖闊
 * @param {number} [y0] 起始行（含）
 * @param {number} [y1] 結束行（含）；唔傳 = 去到 `mask` 尾
 * @returns {Int32Array} 長度 `y1 - y0 + 1`
 */
export function rowCounts(mask, width, y0 = 0, y1 = null) {
  const last = y1 ?? Math.floor(mask.length / width) - 1;
  const counts = new Int32Array(Math.max(0, last - y0 + 1));
  for (let y = y0; y <= last; y += 1) {
    const base = y * width;
    let c = 0;
    for (let x = 0; x < width; x += 1) c += mask[base + x];
    counts[y - y0] = c;
  }
  return counts;
}

/**
 * 逐欄墨點數（`columnCounts(...)[i]` 對應第 `x0 + i` 欄）。
 *
 * @param {Uint8Array} mask
 * @param {number} width
 * @param {number} y0 起始行（含）
 * @param {number} y1 結束行（含）
 * @param {number} [x0] 起始欄（含）
 * @param {number} [x1] 結束欄（含）；唔傳 = 去到圖最右
 * @returns {Int32Array} 長度 `x1 - x0 + 1`
 */
export function columnCounts(mask, width, y0, y1, x0 = 0, x1 = null) {
  const last = x1 ?? width - 1;
  const cols = new Int32Array(Math.max(0, last - x0 + 1));
  for (let y = y0; y <= y1; y += 1) {
    const base = y * width;
    for (let c = 0; c < cols.length; c += 1) cols[c] += mask[base + x0 + c];
  }
  return cols;
}

/**
 * 一個矩形範圍入面嘅總墨量（＝「框入面有幾多粒墨」）。
 *
 * 用途：判「呢條帶夠唔夠墨先算一條帶」（`statbar` 嘅 `minBandInk`／金色格門檻）同
 * 診斷工具嘅覆蓋率。
 *
 * @param {Uint8Array} mask
 * @param {number} width
 * @param {number} y0
 * @param {number} y1
 * @returns {number}
 */
export function countInk(mask, width, y0, y1) {
  let n = 0;
  for (let y = y0; y <= y1; y += 1) {
    const base = y * width;
    for (let x = 0; x < width; x += 1) n += mask[base + x];
  }
  return n;
}

/**
 * 由一串數值切出「連續段」（＝連續有足夠墨嘅行／欄）。
 *
 * 語意（**逐字對應**以前 9 個手寫版本嘅行為，唔係重新設計）：
 *   - 一段 ＝ 連續「`values[i] >= minValue`」嘅索引
 *   - 段與段之間最多忍 `gapTolerance` 個唔夠墨嘅索引（＝以前嘅 `minGap`／`gapMax`／`gapNeed`）
 *   - 段嘅 `to`（含）永遠係**最後一個夠墨嘅索引**（中間嘅 gap 唔計）
 *   - `ink` ＝ 段入面**夠墨**嗰啲索引嘅值加埋（gap 嗰啲唔計）—— 以前有啲版本計、有啲唔計，
 *     一律照計（唔要就唔好讀）
 *
 * ⚠️ **尾段規則係明示參數**（唔可以靠慣例）：如果行到最尾都未收段（＝尾嗰啲仍然夠墨，
 *    或者尾嗰啲係 gap 但未夠 `gapTolerance`）：
 *      - `trimTrailingGap: true` → `to = 尾 - gap`（削走尾部嗰幾個 gap 索引）
 *      - `trimTrailingGap: false` → `to = 尾`（**唔削**）
 *    實測兩個做法都真係有人用（`columnsToGroups`／`trimNameSegments` 用 true；
 *    `nameBoxesInRow`／`columnSpans`／`findTextLines`／`denseBands` 用 false）——
 *    ⚠️ 當 `gapTolerance === 1` 時兩者**等價**（尾段有 gap 就一定已經喺迴圈內收咗）。
 *
 * @param {Int32Array|number[]} values 逐行／逐欄嘅墨量
 * @param {{minValue?:number, gapTolerance?:number, trimTrailingGap?:boolean}} [options]
 * @returns {Array<{from:number, to:number, ink:number}>} `from`／`to` 都係 inclusive 索引
 */
export function runSpans(values, { minValue = 1, gapTolerance = 1, trimTrailingGap = false } = {}) {
  const runs = [];
  let start = -1;
  let gap = 0;
  let ink = 0;
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] >= minValue) {
      if (start < 0) { start = i; ink = 0; }
      gap = 0;
      ink += values[i];
    } else if (start >= 0) {
      gap += 1;
      if (gap >= gapTolerance) {
        runs.push({ from: start, to: i - gap, ink });
        start = -1;
        gap = 0;
      }
    }
  }
  if (start >= 0) {
    runs.push({ from: start, to: values.length - 1 - (trimTrailingGap ? gap : 0), ink });
  }
  return runs;
}

/**
 * 由一串數值揀「墨量最多」嘅連續段（`tightenBand()` 用）。
 *
 * 規則（同原本手寫版一樣）：先比 `ink`，打同比**長度**（長者勝），再打同就**取最先**（索引細者勝）。
 * ⚠️ 「長者勝」唔可以省：實測一枝獨秀嘅單行（例如邊框線）都可能係最高墨量，
 *    冇呢條就會收窄成一兩行（pitfalls #18）。
 *
 * @param {Int32Array|number[]} values
 * @param {number} minValue 段嘅最低值（＝峰值 × `tightenRatio`）
 * @returns {{from:number, to:number, ink:number, length:number}|null}
 */
export function densestRun(values, minValue) {
  const runs = runSpans(values, { minValue, gapTolerance: 1 });
  let best = null;
  for (const run of runs) {
    const length = run.to - run.from + 1;
    if (!best || run.ink > best.ink || (run.ink === best.ink && length > best.length)) {
      best = { from: run.from, to: run.to, ink: run.ink, length };
    }
  }
  return best;
}
