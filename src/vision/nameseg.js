/**
 * 技能名 → **逐字元**像素切分（Phase 2 字元模板路線）。
 *
 * ## 為何唔可以「用空隙切」
 *
 * 實測（`runSpans` gap=3）：112 格只得 **17.7%** 切得出正確字元數 ——
 * 因為好多字自己會裂開（`彳`／`亍`、片假名 `ソ`、英文 `Q.E.D.` 嘅點），
 * 而且**字距同字內空隙同一量級**（技能名係密排）。所以「空隙 = 字邊界」係錯假設。
 *
 * ## 正解：帶「字元預算」嘅 DP
 *
 * 我哋**已經知道**呢一格嘅字串（`data/skill-name-truth.json`）→ 即係知道有幾個字元。
 * 於是問題變成：「把 `[lo,hi]` 切做 n 段、每段闊度似一個字元、切點落喺低墨位」。
 * 成本函數：
 *   · `costWidth`：`|段闊 / 目標闊 − 1|`（⚠️ 字型係等寬，所以「一字符 = 一個目標闊」）；
 *   · `costGap`：切點位嘅墨量（相對該格墨量中位數）→ 鼓勵切喺字與字之間。
 * ⚠️ 書籤（`bookmark`）同成本函數都要有測試；呢個係**唯一**由像素推字邊界嘅地方。
 */

/**
 * 呢個字元佔「幾個字元闊」（＝字型嘅等寬單位）。
 *
 * ⚠️ 實測（112 格）：`・`（U+30FB 全形碼點）同 `！`／`？`（全形碼點）喺遊戲字型
 * **只佔半形闊度**（框闊 ÷ 字元闊度單位：`好，要上啦！` ≈ 3.5 個全形、
 * `競賽的精髓・體能` ≈ 7 個全形）—— 唔當半形嘅話 DP 會把兩個字併成一段（實測 max 段闊 56px vs 單位 28px）。
 * 所以「全形碼點」唔可以當「全形闊度」，一定要按**實際闊度單位**計。
 */
export function charWidthUnits(ch) {
  const code = ch.codePointAt(0);
  // 半形 ASCII：`win`、`Q.E.D.`、`777`
  if (code <= 0x2f || (code >= 0x30 && code <= 0x39) || (code >= 0x3a && code <= 0x40)
    || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a) || code === 0x7b) {
    return 0.6;
  }
  // 半形闊度嘅 CJK 標點（實測）
  if ('・！？：；，．、ー～「」（）'.includes(ch)) return 0.5;
  return 1;
}

/**
 * 由逐欄墨量切出「逐字元」嘅欄範圍。
 *
 * @param {Int32Array|number[]} cols 框內逐欄墨量（`cols[i]` 對應框內第 i 欄）
 * @param {{from:number,to:number}} span 名嘅範圍（含頭含尾；由 `trimNameSegments()` 嚟）
 * @param {string} text 呢一格嘅字串（長度 = 字元數）
 * @param {{widthSlack?:number, gapWeight?:number, asciiUnits?:number}} [opts]
 * @returns {{
 *   ok:boolean, reason:string|null,
 *   spans:Array<{from:number,to:number}>, costs:number[],
 *   unit:number, widthCost:number, gapCost:number
 * }}
 */
export function segmentNameChars(cols, span, text, opts = {}) {
  const chars = [...text];
  const n = chars.length;
  const widthSlack = opts.widthSlack ?? 0.25; // 一段嘅闊度可以偏離目標 ±25%
  const gapWeight = opts.gapWeight ?? 1;
  const lo = span.from;
  const hi = span.to;
  const fail = (reason) => ({ ok: false, reason, spans: [], costs: [], unit: 0, widthCost: 0, gapCost: 0 });
  if (!n) return fail('冇字串');
  if (hi - lo + 1 < n) return fail('範圍太窄（每字不足 1 像素）');

  // 目標闊度：等寬字型 → 總闊 ÷ 總字元闊度單位。⚠️ 唔用「平均」而係「加權」，
  // 因為同一格可能混全形同半形（`win Q.E.D.`）。
  const units = chars.map(charWidthUnits);
  const unitSum = units.reduce((s, u) => s + u, 0);
  const totalW = hi - lo + 1;
  const unit = totalW / unitSum;
  if (!(unit > 1)) return fail(`目標闊度唔合理（${unit.toFixed(2)}px）`);

  // 切點成本表：cutCost[i] = 喺「lo + i」位（即 i 之後切）嘅墨量懲罰
  const colsOfSpan = [];
  for (let i = 0; i <= totalW; i += 1) colsOfSpan.push(cols[lo + i] ?? 0);
  const inkSum = colsOfSpan.reduce((s, v) => s + v, 0);
  const inkAvg = inkSum / Math.max(1, colsOfSpan.length);
  const cutCost = colsOfSpan.map((v) => gapWeight * (v / Math.max(1, inkAvg)));

  // DP：state = (字元 index, 已用闊度) → 最低成本
  const W = totalW;
  const INF = Number.POSITIVE_INFINITY;
  const dp = [];
  const back = [];
  for (let k = 0; k <= n; k += 1) {
    dp.push(new Float64Array(W + 1).fill(INF));
    back.push(new Int32Array(W + 1).fill(-1));
  }
  dp[0][0] = 0;
  const minLen = new Float64Array(n + 1);
  const maxLen = new Float64Array(n + 1);
  for (let k = 1; k <= n; k += 1) {
    minLen[k] = Math.max(1, Math.floor(units[k - 1] * unit * (1 - widthSlack)));
    maxLen[k] = Math.max(1, Math.ceil(units[k - 1] * unit * (1 + widthSlack)));
  }
  for (let k = 1; k <= n; k += 1) {
    const loLen = Math.max(1, minLen[k]);
    const hiLen = Math.min(W, maxLen[k]);
    for (let w = 0; w <= W; w += 1) {
      if (!Number.isFinite(dp[k - 1][w])) continue;
      for (let len = loLen; len <= hiLen; len += 1) {
        const nw = w + len;
        if (nw > W) break;
        const widthCost = Math.abs(len / (units[k - 1] * unit) - 1);
        const cost = dp[k - 1][w] + widthCost + cutCost[w + len];
        if (cost < dp[k][nw]) { dp[k][nw] = cost; back[k][nw] = w; }
      }
    }
  }
  if (!Number.isFinite(dp[n][W])) return fail('冇合法切法（闊度預算對唔上）');

  // 回溯
  let w = W;
  const lens = new Array(n);
  for (let k = n; k >= 1; k -= 1) { const prev = back[k][w]; lens[k - 1] = w - prev; w = prev; }
  let cursor = lo;
  const spans = lens.map((len) => { const s = { from: cursor, to: cursor + len - 1 }; cursor += len; return s; });

  let widthCost = 0;
  let gapCost = 0;
  for (let k = 0; k < n; k += 1) {
    widthCost += Math.abs(lens[k] / (units[k] * unit) - 1);
    if (k < n - 1) gapCost += cutCost[spans[k].to - lo + 1];
  }
  return { ok: true, reason: null, spans, costs: lens.map(Number), unit, widthCost, gapCost };
}
