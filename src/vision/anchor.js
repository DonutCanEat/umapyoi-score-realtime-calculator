/**
 * ⛔ **已棄用（2026-09）—— 唔好用，亦唔好接入主流程。**
 *
 * 呢個模組靠「粉紅標題列」揾ステータス面板，但實機驗證證明呢條路係錯嘅：
 *   1. 面板顏色跟**隻馬嘅主題色**走，唔一定粉紅（用戶實機確認）
 *   2. 更根本：只用顏色判「數字墨」，遊戲插畫會大量通過（見 `inkmask.js` 嘅說明）
 *
 * 現行做法：`src/vision/reader.js`（背景受控墨點 → 捉五個數字），
 * 完全唔需要面板錨點。詳見 AGENTS.md 地雷 #10/#11/#12。
 *
 * 保留呢個檔案同 `test/anchor.test.js` 只係為咗唔想一次過刪太多嘢；
 * 任何新功能都唔應該 import 佢。
 *
 * ────────────────────────────────────────────────────────────────
 * 錨點偵測：喺遊戲畫面入面揾出「ステータス面板」（粉紅標題列 + 白色格）。
 *
 * 呢個係零校準設計嘅核心：
 *   1. 每幀揾錨點 → 拎到 bounding box
 *   2. 其他所有 ROI 都用「相對錨點」嘅比例計出嚟
 *   3. 遊戲視窗點 resize / 移動 / 改 DPI 都自動食得住
 *
 * 純函數、零 I/O，方便單元測試。輸入係 canvas `getImageData()` 嘅結果。
 */

/** 粉紅標題列嘅判定（繁中服ステータス面板）。 */
const PINK = Object.freeze({ rMin: 195, gMax: 150, bMin: 80, bMax: 205 });

/** 白色格嘅判定。 */
const WHITE_MIN = 236;

function isPink(r, g, b) {
  return r >= PINK.rMin && g <= PINK.gMax && b >= PINK.bMin && b <= PINK.bMax;
}

function isWhite(r, g, b) {
  return r >= WHITE_MIN && g >= WHITE_MIN && b >= WHITE_MIN;
}

/**
 * 喺一行入面揾最長嘅粉紅連續段。
 * @returns {{start:number,length:number}}
 */
export function longestPinkRun(data, width, y, x0, x1, minRun) {
  let best = { start: -1, length: 0 };
  let runStart = -1;
  for (let x = x0; x <= x1; x += 1) {
    const i = (y * width + x) * 4;
    const pink = isPink(data[i], data[i + 1], data[i + 2]);
    if (pink && runStart < 0) runStart = x;
    if ((!pink || x === x1) && runStart >= 0) {
      const end = pink ? x : x - 1;
      const length = end - runStart + 1;
      if (length > best.length) best = { start: runStart, length };
      runStart = -1;
    }
  }
  return best.length >= minRun ? best : { start: -1, length: 0 };
}

/**
 * 偵測ステータス面板。
 *
 * 策略：由上而下掃描，揾最闊嘅粉紅橫帶（標題列），
 * 再喺佢下面揾白色格嘅範圍（面板主體）。
 *
 * @param {{data:Uint8ClampedArray,width:number,height:number}} image
 * @param {object} [options]
 * @returns {{x,y,width,height,headerHeight,confidence}|null}
 */
export function detectStatPanel(image, options = {}) {
  const { data, width, height } = image;
  const minRunRatio = options.minRunRatio ?? 0.25; // 粉紅帶至少要佔畫面闊度 25%
  const minRun = Math.floor(width * minRunRatio);
  const yStart = Math.floor(height * (options.yStartRatio ?? 0.05));
  const yEnd = Math.floor(height * (options.yEndRatio ?? 0.95));
  const x0 = 0;
  const x1 = width - 1;

  // 1) 揾候選標題列
  //    ⚠️ 唔可以淨係揀「最長粉紅 run」——技能列表入面嘅粉紅色技能列（劇本進化技能）
  //    闊度同ステータス標題列差唔多，會揀錯位。
  //    所以連「下面有幾多白格」一齊評分：真面板下面係一片白色格，技能列下面係紫色底。
  const whiteRowsBelow = (bandTop, run) => {
    const step = Math.max(1, Math.floor(run.length / 40));
    const left = run.start;
    const right = run.start + run.length - 1;
    let rows = 0;
    for (let y = bandTop + 1; y <= Math.min(yEnd, bandTop + Math.floor(height * 0.25)); y += 1) {
      let white = 0;
      let total = 0;
      for (let x = left; x <= right; x += step) {
        const i = (y * width + x) * 4;
        total += 1;
        if (isWhite(data[i], data[i + 1], data[i + 2])) white += 1;
      }
      if (total > 0 && white / total >= 0.5) rows += 1;
    }
    return rows;
  };

  // ⚠️ 2026-08 實測：唔可以用「連續粉紅帶高度」做約束。
  //    真實標題列係**漸變色 + 有文字同 icon**，橫向連續段會被打斷，
  //    所以佢唔係一條高而連續嘅粉紅帶；加咗高度約束反而全部偵測失敗（實測過）。
  //    → 正確方向係「先揾白色格帶，再確認上面有粉紅」（見下方 TODO）。
  const minBandHeight = 1;

  let headerY = -1;
  let headerRun = { start: -1, length: 0 };
  let headerBandHeight = 0;
  let bestScore = -1;
  const seenGeometry = new Set();
  for (let y = yStart; y <= yEnd; y += 1) {
    const run = longestPinkRun(data, width, y, x0, x1, minRun);
    if (run.length === 0) continue;
    const key = `${run.start}:${run.length}`;
    if (seenGeometry.has(key)) continue; // 同一條帶唔重複計
    seenGeometry.add(key);

    // 量呢條帶有幾高
    const bandMinRun = Math.floor(run.length * 0.6);
    let bandHeight = 1;
    for (let yy = y + 1; yy <= yEnd; yy += 1) {
      if (longestPinkRun(data, width, yy, run.start - 2, run.start + run.length + 2, bandMinRun).length === 0) break;
      bandHeight += 1;
    }
    if (bandHeight < minBandHeight) continue;

    const score = whiteRowsBelow(y, run) * 10000 + bandHeight * 100 + run.length;
    if (score > bestScore) {
      bestScore = score;
      headerRun = run;
      headerY = y;
      headerBandHeight = bandHeight;
    }
  }
  if (headerY < 0) return null;

  const left = headerRun.start;
  const right = headerRun.start + headerRun.length - 1;

  // 2) 標題列底：由 headerY 向下行，粉紅比例仍然高嘅就當係標題列
  let headerBottom = headerY;
  for (let y = headerY + 1; y <= yEnd; y += 1) {
    const run = longestPinkRun(data, width, y, left - 2, right + 2, Math.floor((right - left) * 0.6));
    if (run.length === 0) break;
    headerBottom = y;
  }

  // 3) 由標題列下面開始揾白色格嘅底（連續白色比例要夠高）
  const sampleStep = Math.max(1, Math.floor(headerRun.length / 40));
  let bottom = headerBottom;
  let whiteRows = 0;
  for (let y = headerBottom + 1; y <= Math.min(yEnd, headerBottom + Math.floor(height * 0.25)); y += 1) {
    let white = 0;
    let total = 0;
    for (let x = left; x <= right; x += sampleStep) {
      const i = (y * width + x) * 4;
      total += 1;
      if (isWhite(data[i], data[i + 1], data[i + 2])) white += 1;
    }
    if (total > 0 && white / total >= 0.5) {
      bottom = y;
      whiteRows += 1;
    } else if (whiteRows > 3) {
      break; // 已經過咗面板
    }
  }
  if (bottom <= headerY) return null;

  // 3) 標題列頂：由 headerY 向上行，粉紅比例仍然高嘅就當係標題列
  let top = headerY;
  for (let y = headerY - 1; y >= Math.max(0, headerY - Math.floor(height * 0.05)); y -= 1) {
    const run = longestPinkRun(data, width, y, left - 2, right + 2, Math.floor((right - left) * 0.6));
    if (run.length === 0) break;
    top = y;
  }

  const panelHeight = bottom - top + 1;
  const confidence = Math.min(
    1,
    (headerRun.length / width) * 1.5 + Math.min(whiteRows / 40, 1) * 0.5,
  );

  return {
    x: left,
    y: top,
    width: right - left + 1,
    height: panelHeight,
    headerHeight: headerBottom - top + 1,
    confidence,
  };
}

/**
 * 由面板 bounding box 同相對比例，計出一個 ROI 嘅實際像素位置。
 * 因為 UI 係等比縮放，scaleX === scaleY。
 */
export function roiFromPanel(panel, roi) {
  return {
    x: Math.round(panel.x + roi.x * panel.width),
    y: Math.round(panel.y + roi.y * panel.height),
    width: Math.round(roi.width * panel.width),
    height: Math.round(roi.height * panel.height),
  };
}
