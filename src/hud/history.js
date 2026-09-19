/**
 * C3：**成長曲線**（五維／評價点隨時間變化）嘅純函數核心。
 *
 * 為何要獨立一層（同 `layout.js` 一樣嘅理由）：Electron 視窗嘅 code 冇得 `node --test`，
 * 但「點樣記錄」「點樣縮成折線」係最容易出錯（而且錯咗只會**靜靜地畫一條錯嘅線**）。
 * 所以：記錄／去重／上限／座標換算全部喺呢度，`main.js` 只負責每幀餵數據、
 * `hud.html` 只負責把 `points` 塞入 `<polyline>`。
 *
 * ## 三個唔准妥協嘅設計決定
 *
 * 1. **只在「數值真係變咗」先記錄**：讀值係 5fps，每幀記一筆嘅話 10 分鐘就 3000 點，
 *    而且 99% 係重複 → 曲線會被「時間軸」壓扁（其實係靜止嘅一段會被拉長）。
 *    `pushSample()` 遇到同上一筆完全相同（`total` ＋ 五維）就**唔加**。
 * 2. **有上限**（`max`）：長時間育成會爆記憶，而且 HUD 只畫得落 ~100 點。
 *    超過就掉最舊嗰筆（＝滑動視窗，同用戶直覺一致：睇最近嘅成長）。
 * 3. **唔准畫錯**：非有限數字（NaN／undefined）一律當冇；`max === min`（一直冇變）時
 *    畫**中間一條橫線**（唔可以除以 0 得出 NaN 座標 → 成條線消失）。
 */

/** 曲線最多保留幾多筆（＝滑動視窗）。240 筆 × 大約每 5 秒一變 ≈ 20 分鐘成長。 */
export const MAX_HISTORY = 240;

/** 折線嘅座標系（renderer 用同一個 `viewBox`，唔使再夾一次）。 */
export const SPARK_WIDTH = 100;
export const SPARK_HEIGHT = 22;
const SPARK_PAD = 1.5;

/**
 * 一筆樣本係唔係「同之前一樣」（＝唔值得記錄）。
 *
 * 比較 `total` 同**五維逐格**：只有技能分變化（五維冇變）嘅話 `total` 一樣唔會記，
 * 但呢個功能係「五維成長曲線」，技能分唔喺呢條線嘅範圍（而且技能分而家讀唔到）。
 *
 * ⚠️ `stats` 一邊有一邊冇（例如呼叫者冇傳五維）→ 當**唔同**（保守：寧願多記一筆，
 *    都唔好把「五維變咗但 total 未變」嘅一刻靜靜地吞咗）。
 */
function sameSample(a, b) {
  if (!a || !b) return false;
  if (a.total !== b.total) return false;
  const x = Array.isArray(a.stats) ? a.stats : null;
  const y = Array.isArray(b.stats) ? b.stats : null;
  if (!x || !y) return x === y;
  if (x.length !== y.length) return false;
  return x.every((v, i) => v === y[i]);
}

/**
 * 加一筆樣本 → **新陣列**（純函數，唔改傳入嗰個；方便測試同避免 HUD 收到半途狀態）。
 *
 * @param {Array<{at:number,total:number,stats:number[]}>} history
 * @param {{at:number,total:number,stats:number[]}} sample ⚠️ `total` 唔係有限數字 → 唔記
 * @param {{max?:number}} [options]
 * @returns {Array<object>} 同一個參照：冇變（重複樣本／唔合法）時**原封不動回傳**
 */
export function pushSample(history, sample, options = {}) {
  const list = Array.isArray(history) ? history : [];
  const max = Number.isFinite(options.max) && options.max > 0 ? Math.floor(options.max) : MAX_HISTORY;
  if (!sample || !Number.isFinite(sample.total)) return list;
  const entry = {
    at: Number.isFinite(sample.at) ? sample.at : 0,
    total: sample.total,
    stats: Array.isArray(sample.stats) ? [...sample.stats] : null,
  };
  const last = list[list.length - 1];
  if (sameSample(last, entry)) return list; // 重複 → 唔加（亦唔改 `at`：曲線嘅 x 係「幾時開始係呢個值」）
  const next = [...list, entry];
  return next.length > max ? next.slice(next.length - max) : next;
}

/**
 * 樣本序列 → 折線座標（`SPARK_WIDTH` × `SPARK_HEIGHT` 座標系）。
 *
 * @param {Array<{total:number}>} history
 * @returns {Array<{x:number,y:number}>} 少過 2 個有效點 → `[]`（畫唔到線，renderer 應該出文字）
 */
export function sparklinePoints(history) {
  const values = (Array.isArray(history) ? history : [])
    .map((s) => (s && Number.isFinite(s.total) ? s.total : null))
    .filter((v) => v !== null);
  if (values.length < 2) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const usable = SPARK_HEIGHT - SPARK_PAD * 2;
  const step = SPARK_WIDTH / (values.length - 1);
  return values.map((v, i) => ({
    x: round2(i * step),
    // ⚠️ `span === 0`（一直冇變）→ 畫正中間一條橫線。唔可以除 0：會得出 NaN → 整條線消失。
    y: round2(span === 0 ? SPARK_HEIGHT / 2 : SPARK_HEIGHT - SPARK_PAD - ((v - min) / span) * usable),
  }));
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

/**
 * 曲線嘅文字摘要（HUD 一行）。
 *
 * @param {Array<{at:number,total:number}>} history
 * @returns {{count:number, first:number|null, latest:number|null, delta:number, spanMs:number,
 *            from:number|null, to:number|null}|null} 冇樣本 → `null`
 */
export function historySummary(history) {
  const list = (Array.isArray(history) ? history : []).filter((s) => s && Number.isFinite(s.total));
  if (list.length === 0) return null;
  const first = list[0];
  const last = list[list.length - 1];
  const from = Number.isFinite(first.at) ? first.at : null;
  const to = Number.isFinite(last.at) ? last.at : null;
  return {
    count: list.length,
    first: first.total,
    latest: last.total,
    delta: last.total - first.total,
    spanMs: from !== null && to !== null ? Math.max(0, to - from) : 0,
    from,
    to,
  };
}

/**
 * HUD 要顯示嘅「成長曲線」view（`hudState()` 直接用）。
 *
 * ⚠️ 點解唔喺 renderer 計：`main.js` 同 `hud.html` 都入唔到 `node --test`，
 * 呢個函數係唯一可以測到「唔夠點／一直冇變／有 NaN」嘅地方。
 *
 * @param {Array<object>} history
 * @param {{now?:number, max?:number}} [options] `max` 只影響 view 標記（記錄上限交畀 `pushSample`）
 * @returns {{count:number, points:Array<{x:number,y:number}>, width:number, height:number,
 *            delta:number, spanMs:number, latest:number|null, capped:boolean}|null}
 */
export function historyView(history, options = {}) {
  const summary = historySummary(history);
  if (!summary) return null;
  const max = Number.isFinite(options.max) && options.max > 0 ? Math.floor(options.max) : MAX_HISTORY;
  return {
    count: summary.count,
    points: sparklinePoints(history),
    width: SPARK_WIDTH,
    height: SPARK_HEIGHT,
    delta: summary.delta,
    spanMs: summary.spanMs,
    latest: summary.latest,
    // 用戶睇得出「呢條線只係最近一段」（＝已經滿咗、舊嘅被掉走）
    capped: summary.count >= max,
  };
}
