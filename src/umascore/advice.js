/**
 * C4：**屬性邊際效率建議**（純函數，零 I/O）。
 *
 * ## 呢個係咩／唔係咩（唔准當佢係「邊個訓練最好」）
 *
 * 真嘅「訓練建議」（邊個訓練加最多分）要**每種訓練嘅屬性增益同成長率** —— 本專案**冇**嗰份資料
 * （遊戲冇公開、要實測收集），所以呢度做嘅係**可以從現有核心精確計出嚟**嗰部分：
 *
 *   ① 每個屬性嘅**邊際效率**：`statPoints(v + 1) − statPoints(v)` ＝「再加 1 點呢個屬性，評價分多幾多」
 *      （用 `tables.js` 嘅精確演算法，唔係估）；
 *   ② 「仲差 N 分到下一個ランク」→ 每個屬性**大約要加幾多點**（＝ `ceil(N / 邊際)`）。
 *
 * ⚠️ 點數係**估算**（唔可以講死）：邊際效率會隨屬性值上升而變，所以：
 *    - 建議係「用**而家**嘅邊際」計 → 因為邊際通常隨值上升，呢個數係**上界**（加咁多一定夠，
 *      有機會少過就夠）—— 有測試用 `evaluate()` 驗證「加咗建議點數之後真係到咗目標ランク」。
 *    - 屬性封頂（2000）嘅話邊際 = 0 → **唔可以**建議加（會除以 0），要老實講「已封頂」。
 */

import { evaluate } from './evaluate.js';
import { STAT_LABELS, STAT_KEYS } from './evaluate.js';
import { STAT_MAX, statPoints } from './tables.js';

/**
 * 一個屬性值 → 再加 1 點會多幾多評價分。
 *
 * ⚠️ 用差分（`statPoints(v+1) − statPoints(v)`）而唔係公式微分：`statPoints()` 係
 * **分段 + floor**，微分會同實際唔一致（地雷 #1 就係「自己砌公式」）。
 *
 * @param {number} value 0–2000
 * @returns {number} 0（已封頂／唔合法）
 */
export function marginalPoints(value) {
  const v = Number(value);
  if (!Number.isFinite(v) || v < 0 || v >= STAT_MAX) return 0;
  const base = Math.floor(v);
  return statPoints(base + 1) - statPoints(base);
}

/**
 * 五維逐個屬性嘅邊際效率（由高到低排）。
 *
 * @param {number[]} stats 五個屬性值（速度／持久／力量／毅力／智力）
 * @returns {Array<{index:number, key:string, label:string, value:number, marginal:number, capped:boolean}>}
 */
export function statEfficiency(stats) {
  const values = Array.isArray(stats) ? stats : [];
  const rows = STAT_KEYS.map((key, index) => {
    const value = Number(values[index]);
    const safe = Number.isFinite(value) ? value : 0;
    const marginal = marginalPoints(safe);
    return {
      index,
      key,
      label: STAT_LABELS[key],
      value: safe,
      marginal,
      capped: safe >= STAT_MAX || marginal <= 0,
    };
  });
  // 邊際高嘅排前面；同分就按屬性值低嘅先（低值通常仲有成長空間）→ 結果穩定
  return rows.sort((a, b) => b.marginal - a.marginal || a.value - b.value || a.index - b.index);
}

/**
 * 「仲差 N 分到 X ランク」→ 每個屬性大約要加幾多點。
 *
 * ⚠️ 唔會 throw（純查數）；`gap` 係 0 或者已經最高ランク → 回 `{ gap: 0, ... }` 而唔係亂建議。
 * ⚠️ 已封頂嘅屬性**唔會**出現喺 `options`（唔可以叫用戶加一個加唔到嘅嘢）。
 *
 * @param {number[]} stats
 * @param {{player?:object, points?:number}} [options] `player` 傳落 `evaluate()`（例如已知技能）
 * @returns {{
 *   gap:number, nextRank:string|null, targetTotal:number|null,
 *   best:{label:string, marginal:number, points:number}|null,
 *   options:Array<{index:number,key:string,label:string,value:number,marginal:number,points:number}>,
 *   note:string
 * }}
 */
export function trainingAdvice(stats, options = {}) {
  const result = evaluate({ stats: toPlayerStats(stats), ...options.player });
  const next = result.nextRank;
  const rows = statEfficiency(stats).filter((r) => !r.capped);
  const base = {
    gap: next ? next.gap : 0,
    nextRank: next ? next.rank : null,
    targetTotal: next ? next.threshold : null,
    best: null,
    options: [],
    note: '',
  };
  if (!next) {
    return { ...base, note: `已經係最高ランク（${result.rank}），冇下一個目標` };
  }
  if (rows.length === 0) {
    return { ...base, note: '五個屬性都封頂（2000）→ 只可以靠技能分再上' };
  }
  const optionsList = rows.map((r) => ({ ...r, points: Math.ceil(next.gap / r.marginal) }));
  const top = optionsList[0];
  return {
    ...base,
    best: { label: top.label, marginal: top.marginal, points: top.points },
    options: optionsList,
    note: `仲差 ${next.gap} 分到 ${next.rank}：加「${top.label}」最有效率`
      + `（每點 +${top.marginal.toFixed(2)} 分 → 約 ${top.points} 點）；`
      + '⚠️ 點數係估算（邊際會隨屬性值變），加咗之後要再睇實際數字',
  };
}

/** 五維陣列 → `evaluate()` 要嘅物件（唔合法當 0；`evaluate()` 自己會驗範圍）。 */
function toPlayerStats(stats) {
  const values = Array.isArray(stats) ? stats : [];
  return Object.fromEntries(
    STAT_KEYS.map((key, i) => [key, Number.isFinite(Number(values[i])) ? Number(values[i]) : 0]),
  );
}
