/**
 * ウマ娘 評價分資料表（ステータス評價點 / ランク閾值）。
 *
 * 資料來源見 docs/formula.md。
 * 呢個檔案係「資料 + 純函數」，唔應該混入 UI 或影像邏輯。
 *
 * ⚠️ 2026-08 更新：由 bwiki「繁中评分计算器」widget 拎到**完整演算法**，
 *    覆蓋 0–2000（屬性上限開放之後），唔再需要用近似分段直線。
 *    已用社群實測值驗證：102→68、502→853、902→2217、600→1143、1200→3841 全部命中。
 */

/** 遊戲內單項屬性上限（屬性上限開放之後）。 */
export const STAT_MAX = 2000;

/** 演算法入面「基礎」部分嘅分界點。 */
export const STAT_BASE_MAX = 1200;

/**
 * 每 50 點一段嘅係數（index = floor((值+1)/50)）。
 * 25 個，覆蓋 0–1250。
 */
export const STAT_KOEFFI = Object.freeze([
  0.5, 0.8, 1, 1.3, 1.6, 1.8, 2.1, 2.4, 2.6, 2.8, 2.9, 3, 3.1, 3.3, 3.4, 3.5,
  3.9, 4.1, 4.2, 4.3, 5.2, 5.5, 6.6, 6.8, 6.9,
]);

/** 1200 以上：每 10 點一段嘅係數。 */
export const STAT_OVERFLOW_KOEFFI = Object.freeze([
  7.888, 8, 8.1, 8.3, 8.4, 8.5, 8.6, 8.8, 8.9, 9, 9.2, 9.3, 9.4, 9.6, 9.7, 9.8,
  10, 10.1, 10.2, 10.3, 10.5, 10.6, 10.7, 10.9, 11, 11.1, 11.3, 11.4, 11.5, 11.7,
  11.8, 11.9, 12.1, 12.2, 12.3, 12.4, 12.6, 12.7, 12.8, 13, 13.1, 13.2, 13.4, 13.5,
  13.6, 13.8, 13.9, 14, 14.1, 14.3, 14.4, 14.5, 14.7, 14.8, 14.9, 15.1, 15.2, 15.3,
  15.5, 15.6, 15.7, 15.9, 16, 16.1, 16.2, 16.4, 16.5, 16.6, 16.8, 16.9, 17, 17.2,
  17.3, 17.4, 17.6, 17.7, 17.8, 17.9, 18.1, 18.2, 18.3,
]);

/**
 * 單項屬性值 → 評價點（精確演算法）。
 *
 * 邏輯完全跟 bwiki 繁中评分计算器 嘅 `五维计算()`：
 *   1. 超過 1200 嘅部分抽去做 oval，基礎值固定用 1200
 *   2. 值 +1 之後，每 50 點一段乘 STAT_KOEFFI 累加
 *   3. oval > 0 就再加 1200 以上嘅部分（每 10 點一段）
 *   4. 最後 floor
 */
export function statPoints(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  let v = Math.min(Math.max(numeric, 0), STAT_MAX);

  let oval = 0;
  if (v > STAT_BASE_MAX) {
    oval = v - STAT_BASE_MAX;
    v = STAT_BASE_MAX;
  }

  let result = 0;
  v += 1;

  const q = Math.floor(v / 50);
  const r = v % 50;
  let i;
  for (i = 0; i < q; i += 1) result += 50 * STAT_KOEFFI[i];
  result += r * STAT_KOEFFI[i];

  if (oval > 0) {
    if (oval < 9) {
      const ovq = Math.floor(oval / 10);
      const ovr = oval % 10;
      let j;
      for (j = 0; j < ovq; j += 1) result += 10 * STAT_OVERFLOW_KOEFFI[j];
      result += ovr * STAT_OVERFLOW_KOEFFI[j];
    } else {
      result = 3912;
      oval += 1;
      const ovq = Math.floor(oval / 10);
      const ovr = oval % 10;
      let j;
      for (j = 1; j < ovq; j += 1) result += Math.ceil(10 * STAT_OVERFLOW_KOEFFI[j]);
      result += Math.ceil(ovr * STAT_OVERFLOW_KOEFFI[j]);
    }
  }

  return Math.floor(result);
}

/** 相容舊介面：一個冇狀態嘅曲線物件。 */
export class StatCurve {
  constructor({ max = STAT_MAX } = {}) {
    this.max = max;
  }

  /** 單項評價點（超出上限會 clamp 到上限）。 */
  pointsFor(value) {
    return statPoints(value);
  }

  /** 五維評價點合計。 */
  totalFor(values) {
    let sum = 0;
    for (const value of values) sum += statPoints(value);
    return sum;
  }
}

export const DEFAULT_STAT_CURVE = new StatCurve();

/** 舊社群表嘅取樣點，淨係留嚟做參考／回歸測試，唔再用嚟計算。 */
export const STAT_BREAKPOINTS = Object.freeze([
  0, 50, 100, 150, 200, 250, 300, 350, 400,
  500, 600, 700, 800, 900, 1000, 1050, 1100, 1150, 1200,
]);

/**
 * 對應上面取樣點嘅評價點。
 * ⚠️ 400 係 **577**（唔係 wikiru 舊表寫嘅 557 —— 嗰個係打錯，
 *    用 557 反推會令 500 變成 557 而唔係公認嘅 847）。
 */
export const STAT_POINTS = Object.freeze([
  0, 25, 66, 116, 181, 261, 352, 457, 577,
  847, 1143, 1463, 1808, 2209, 2635, 2895, 3171, 3501, 3841,
]);

/**
 * ランク閾值：[最低評價點, ランク]，必須遞增。
 * 來源：bwiki 繁中评分计算器 `评级` computed（完整到 UA）。
 */
export const RANK_THRESHOLDS = Object.freeze([
  [0, 'G'], [300, 'G+'], [600, 'F'], [900, 'F+'], [1300, 'E'], [1800, 'E+'],
  [2300, 'D'], [2900, 'D+'], [3500, 'C'], [4900, 'C+'], [6500, 'B'], [8200, 'B+'],
  [10000, 'A'], [12100, 'A+'], [14500, 'S'], [15900, 'S+'], [17500, 'SS'],
  [19200, 'SS+'], [19600, 'UG'], [20000, 'UG1'], [20400, 'UG2'], [20800, 'UG3'],
  [21200, 'UG4'], [21600, 'UG5'], [22100, 'UG6'], [22500, 'UG7'], [23000, 'UG8'],
  [23400, 'UG9'], [23900, 'UF'], [24300, 'UF1'], [24800, 'UF2'], [25300, 'UF3'],
  [25800, 'UF4'], [26300, 'UF5'], [26800, 'UF6'], [27300, 'UF7'], [27800, 'UF8'],
  [28300, 'UF9'], [28800, 'UE'], [29400, 'UE1'], [29900, 'UE2'], [30400, 'UE3'],
  [31000, 'UE4'], [31500, 'UE5'], [32100, 'UE6'], [32700, 'UE7'], [33200, 'UE8'],
  [33800, 'UE9'], [34400, 'UD'], [35000, 'UD1'], [35600, 'UD2'], [36200, 'UD3'],
  [36800, 'UD4'], [37500, 'UD5'], [38100, 'UD6'], [38700, 'UD7'], [39400, 'UD8'],
  [40000, 'UD9'], [40700, 'UC'], [41300, 'UC1'], [42000, 'UC2'], [42700, 'UC3'],
  [43400, 'UC4'], [44000, 'UC5'], [44700, 'UC6'], [45400, 'UC7'], [46200, 'UC8'],
  [46900, 'UC9'], [47600, 'UB'], [48300, 'UB1'], [49000, 'UB2'], [49800, 'UB3'],
  [50500, 'UB4'], [51300, 'UB5'], [52000, 'UB6'], [52800, 'UB7'], [53600, 'UB8'],
  [54400, 'UB9'], [55200, 'UA'],
]);

/** 舊名，保持相容。 */
export const JP_RANK_THRESHOLDS = RANK_THRESHOLDS;

/**
 * 評價點 → ランク。
 */
export function rankFor(total, thresholds = RANK_THRESHOLDS) {
  const value = Number(total) || 0;
  let label = thresholds[0][1];
  for (const [min, name] of thresholds) {
    if (value >= min) label = name;
    else break;
  }
  return label;
}

/** 距離下一個ランク仲差幾多分（已係最高ランク就回 null）。 */
export function nextRankGap(total, thresholds = RANK_THRESHOLDS) {
  const value = Number(total) || 0;
  for (const [min, name] of thresholds) {
    if (value < min) return { rank: name, gap: min - value, threshold: min };
  }
  return null;
}
