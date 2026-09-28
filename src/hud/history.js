/**
 * C3：**成長曲線**（五維／評價點隨時間變化）嘅純函數核心。
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
 *
 * ## ⭐ 2026-09-28 兩個修正（設計審查 M7）
 *
 * **① x 軸一定要配得上「N 分鐘」嗰句**：舊版 `sparklinePoints()` 用**樣本序號**做 x
 * （`i * step`），但 `historySummary()` 同時用真時間算 `spanMs`，而 HUD 就出
 * 「成長 +300（**3 分鐘**）」（`hud.html`）→ 兩者講緊唔同嘅嘢：只要樣本**間距唔平均**
 * （實際上係咁：5 秒一變同 5 分鐘一變混住），條線嘅「斜率」就完全唔代表成長速度。
 * 而家：`at` 齊全而且時間有跨度 → x 用**真時間**（`axis: 'time'`）；
 * 冇時間資訊（例如 `at` 全部一樣）→ 退返序號（`axis: 'index'`），而且 `historyView()`
 * 會**講明**用邊個，唔會靜默二選一。
 *
 * **② 成長曲線一定要有場次邊界**：實查 `main.js` —— 面板條（育成中）同「培育結束確認」
 * （`score.source = 'result'`，數值係**下限**）餵**同一條**陣列，而且冇任何 reset
 * → 換窗／撳「強制更新」／轉去培育結束確認之後，條線同「成長 +N」都係**跨場次混算**
 * （最壞情況：攞住「育成中嘅五維」同「培育結束嘅五維」相減，出一個冇意義嘅數）。
 * 而家 `pushSample()` 收到**唔同 `session`** 就由頭開一條新線（唔會兩場夾埋一齊畫）。
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
 * ⭐ **場次邊界**（設計審查 M7）：`sample.session` 同上一筆唔同 → **由頭開一條新線**
 * （回 `[entry]`，唔係 append）。⚠️ 順序好緊要：場次檢查要**早過**去重檢查 ——
 * 新場次第一筆好可能同舊場次最後一筆數值一樣（例如兩次都係 `total = 1234`），
 * 如果先去重就會當「冇變」而吞咗個邊界。
 *
 * ⚠️ 冇傳 `session`（舊呼叫者／舊測試）→ 一律 `null`，同 `null` 相等 → 行為同以前一樣。
 *
 * @param {Array<{at:number,total:number,stats:number[],session?:string|null}>} history
 * @param {{at:number,total:number,stats:number[],session?:string|null}} sample
 *        ⚠️ `total` 唔係有限數字 → 唔記
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
    session: typeof sample.session === 'string' ? sample.session : null,
  };
  const last = list[list.length - 1];
  // ⭐ 場次變咗 → 舊線同新線唔可以畫埋一齊（見檔頭 ②）。
  //    ⚠️ 一定要用 `sessionOf()` 正規化：外面砌（或者舊版留落嚟）嘅 entry 係**冇**
  //    `session` 欄位嘅 → `undefined !== null` 就會誤判成「新場次」而清空條線
  //    （實測：`test/hud-history.test.js`「max 唔合法 → 用預設」即刻捉到）。
  if (last && sessionOf(last) !== entry.session) return [entry];
  if (sameSample(last, entry)) return list; // 重複 → 唔加（亦唔改 `at`：曲線嘅 x 係「幾時開始係呢個值」）
  const next = [...list, entry];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** 正規化場次：字串以外（`undefined`／`null`／數字／冇欄位）一律當「冇場次」。 */
function sessionOf(entry) {
  return typeof entry?.session === 'string' ? entry.session : null;
}

/** 抽出「有效樣本」（`total` 係有限數字）—— `sparklinePoints()`／`historyAxis()`／摘要共用。 */
function validSamples(history) {
  return (Array.isArray(history) ? history : []).filter((s) => s && Number.isFinite(s.total));
}

/**
 * 折線嘅 x 軸語意（設計審查 M7）：`'time'`（x 用真時間）抑或 `'index'`（x 用樣本序號）。
 *
 * - 兩點以上、**兩端 `at` 都係有限數字而且有跨度** → `'time'`。
 * - 其他（`at` 全部一樣／唔齊／只得一點）→ `'index'`（＝冇時間資訊可用，唔准靠估）。
 *
 * ⚠️ 呢個函數存在嘅唯一理由：令「x 軸係咩」**講得出**（`historyView().axis`），
 *    而唔係靜默二選一 —— HUD 出「（N 分鐘）」嗰句就係建基於此。
 *
 * @param {Array<{at:number,total:number}>} history
 * @returns {'time'|'index'}
 */
export function historyAxis(history) {
  const list = validSamples(history);
  if (list.length < 2) return 'index';
  const t0 = list[0].at;
  const t1 = list[list.length - 1].at;
  return Number.isFinite(t0) && Number.isFinite(t1) && t1 > t0 ? 'time' : 'index';
}

/**
 * 樣本序列 → 折線座標（`SPARK_WIDTH` × `SPARK_HEIGHT` 座標系）。
 *
 * x 軸：見 `historyAxis()` —— 有時間就用時間（所以條線嘅橫向距離＝真時間，
 * 配得上 HUD 嗰句「（N 分鐘）」）；冇時間就平均分佈。
 *
 * @param {Array<{at:number,total:number}>} history
 * @returns {Array<{x:number,y:number}>} 少過 2 個有效點 → `[]`（畫唔到線，renderer 應該出文字）
 */
export function sparklinePoints(history) {
  const samples = validSamples(history);
  if (samples.length < 2) return [];
  const values = samples.map((s) => s.total);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const usable = SPARK_HEIGHT - SPARK_PAD * 2;
  const step = SPARK_WIDTH / (samples.length - 1);
  const axis = historyAxis(history);
  const t0 = samples[0].at;
  const t1 = samples[samples.length - 1].at;
  const timeSpan = t1 - t0;
  let prevX = 0;
  return samples.map((s, i) => {
    // ⚠️ 時間軸之下中間嗰啲 `at` 可能唔合法（或者因為時鐘調整而**倒後**）→
    //    夾返落去 ＋ 夾住單調唔減，唔然條線會摺埋／跳返轉頭。
    const raw = axis === 'time' && Number.isFinite(s.at) ? ((s.at - t0) / timeSpan) * SPARK_WIDTH : i * step;
    const x = round2(Math.min(SPARK_WIDTH, Math.max(prevX, Math.max(0, raw))));
    prevX = x;
    return {
      x,
      // ⚠️ `span === 0`（一直冇變）→ 畫正中間一條橫線。唔可以除 0：會得出 NaN → 整條線消失。
      y: round2(span === 0 ? SPARK_HEIGHT / 2 : SPARK_HEIGHT - SPARK_PAD - ((s.total - min) / span) * usable),
    };
  });
}


function round2(v) {
  return Math.round(v * 100) / 100;
}

/**
 * 曲線嘅文字摘要（HUD 一行）。
 *
 * @param {Array<{at:number,total:number,session?:string|null}>} history
 * @returns {{count:number, first:number|null, latest:number|null, delta:number, spanMs:number,
 *            from:number|null, to:number|null, session:string|null, axis:'time'|'index'}|null}
 *          冇樣本 → `null`
 */
export function historySummary(history) {
  const list = validSamples(history);
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
    // ⭐ 場次（設計審查 M7）：同一條線入面所有樣本一定係同一個場次（`pushSample()` 保證）。
    session: sessionOf(last),
    axis: historyAxis(list),
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
 *            delta:number, spanMs:number, latest:number|null, capped:boolean,
 *            axis:'time'|'index', session:string|null}|null}
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
    // ⭐ 設計審查 M7：x 軸係真時間定樣本序號（HUD 出「（N 分鐘）」嗰句要配得上）＋ 場次。
    axis: summary.axis,
    session: summary.session,
  };
}
