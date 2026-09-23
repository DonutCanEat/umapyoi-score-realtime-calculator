/**
 * C4：**訓練評分**（純函數，零 I/O）——「邊項訓練今次加分最多」。
 *
 * ## 呢個係咩／唔係咩
 *
 * ⛔ 呢度**冇**、亦**唔准有**「每項訓練加幾多點」嘅硬編碼數字：遊戲冇公開，
 *    而且加成跟**支援卡組合／友情亮唔亮／幹勁／訓練等級**變 → 任何寫死嘅表都會教錯人。
 * ✅ 所以本模組係**照實測樣本計**：
 *     ① 樣本（`data/training-gains.json`，每筆 = 你實機見到嘅一次加成）逐筆用
 *        `tables.js` 嘅**精確** `statPoints()` 差分算「呢次訓練值幾多評價分」；
 *     ② 同一項訓練有多筆樣本就出**中位數 ＋ min–max 差距 ＋ 樣本數**（唔准假裝好準）；
 *     ③ **冇樣本嘅訓練 = `known: false`**，照列出來但唔排名、唔出分（唔准估）。
 *
 * ⚠️ 技能Pt 另外列（`skillPt`）：Pt **唔係**評價分（要換成技能才有分），所以**唔會**
 *    加落 `score` 度 —— 混埋一齊就係出錯數。
 * ⚠️ 屬性封頂（`STAT_MAX` 2000）：`v + gain` 會夾返 2000，超出嘅加成值 0 分。
 */

import { STAT_MAX, statPoints } from './tables.js';

/** 五項訓練（＝五維，順序同 `evaluate.STAT_KEYS` 一致）。 */
export const TRAINING_TYPES = Object.freeze([
  Object.freeze({ key: 'speed', label: '速度' }),
  Object.freeze({ key: 'stamina', label: '持久力' }),
  Object.freeze({ key: 'power', label: '力量' }),
  Object.freeze({ key: 'guts', label: '根性' }),
  Object.freeze({ key: 'wit', label: '智力' }),
]);

export const TRAINING_KEYS = Object.freeze(TRAINING_TYPES.map((t) => t.key));

/** 訓練等級下限／上限（遊戲 Lv1–Lv5）。 */
export const TRAINING_LEVEL_MIN = 1;
export const TRAINING_LEVEL_MAX = 5;

/** 一個屬性值 → 加 `gain` 點之後嘅值（夾入 0–`STAT_MAX`；唔合法一律當 0）。 */
export function applyGain(value, gain) {
  const v = Number.isFinite(Number(value)) ? Number(value) : 0;
  const g = Number.isFinite(Number(gain)) ? Number(gain) : 0;
  return Math.max(0, Math.min(STAT_MAX, v + g));
}

/**
 * 一筆加成值幾多評價分（精確差分，唔係估）。
 *
 * @param {number[]} stats 而家五維（速度／持久／力量／根性／智力）
 * @param {Record<string, number>} gains 屬性 key → 加幾多點
 * @returns {number} 評價分（封頂之後真正加得到嗰部分）
 */
export function gainsScore(stats, gains) {
  const values = Array.isArray(stats) ? stats : [];
  let total = 0;
  for (const [i, key] of TRAINING_KEYS.entries()) {
    const before = Number.isFinite(Number(values[i])) ? Number(values[i]) : 0;
    const after = applyGain(before, gains?.[key] ?? 0);
    if (after !== before) total += statPoints(after) - statPoints(before);
  }
  return total;
}

/** 中位數（偶數個 → 中間兩個平均；空陣列 → null）。 */
function median(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const sorted = [...list].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * 驗一筆樣本（唔合法就 throw 並**點名**邊一欄 —— 靜默跳過壞樣本 ＝ 用緊唔知咩數據）。
 *
 * @param {unknown} sample
 * @returns {{at:string|null, training:string, level:number, gains:Record<string,number>, skillPt:number|null, energy:number|null, note:string}}
 */
export function validateSample(sample) {
  if (!sample || typeof sample !== 'object' || Array.isArray(sample)) {
    throw new Error(`訓練樣本要係物件（實得 ${JSON.stringify(sample)}）`);
  }
  const training = sample.training;
  if (!TRAINING_KEYS.includes(training)) {
    throw new Error(`訓練樣本嘅 \`training\` 唔合法：${JSON.stringify(training)}（要係 ${TRAINING_KEYS.join('／')}）`);
  }
  const level = Number(sample.level);
  if (!Number.isInteger(level) || level < TRAINING_LEVEL_MIN || level > TRAINING_LEVEL_MAX) {
    throw new Error(`訓練樣本嘅 \`level\` 要係 ${TRAINING_LEVEL_MIN}–${TRAINING_LEVEL_MAX} 嘅整數（實得 ${JSON.stringify(sample.level)}）`);
  }
  const rawGains = sample.gains;
  if (!rawGains || typeof rawGains !== 'object' || Array.isArray(rawGains)) {
    throw new Error('訓練樣本嘅 `gains` 要係物件（屬性 key → 加幾多點）');
  }
  const gains = {};
  for (const [key, value] of Object.entries(rawGains)) {
    if (!TRAINING_KEYS.includes(key)) {
      throw new Error(`\`gains\` 入面嘅屬性 \`${key}\` 唔合法（要係 ${TRAINING_KEYS.join('／')}）`);
    }
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`\`gains.${key}\` 要係非負數（實得 ${JSON.stringify(value)}）`);
    }
    if (n > 0) gains[key] = n;
  }
  if (Object.keys(gains).length === 0) {
    throw new Error('訓練樣本嘅 `gains` 一定要有至少一項加成（空白樣本冇用）');
  }
  const optionalNumber = (value, name) => {
    if (value === undefined || value === null) return null;
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error(`\`${name}\` 要係數字或者唔填（實得 ${JSON.stringify(value)}）`);
    return n;
  };
  return {
    at: typeof sample.at === 'string' && sample.at ? sample.at : null,
    training,
    level,
    gains,
    skillPt: optionalNumber(sample.skillPt, 'skillPt'),
    energy: optionalNumber(sample.energy, 'energy'),
    note: typeof sample.note === 'string' ? sample.note : '',
  };
}

/**
 * 讀一個訓練增益檔（＝ `data/training-gains.json` 嘅內容）。
 *
 * @param {unknown} json 已 parse 嘅 JSON
 * @returns {{schema:number, note:string, samples:Array}}
 */
export function parseTrainingFile(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('訓練增益檔要係物件（含 `samples` 陣列）');
  }
  if (!Array.isArray(json.samples)) {
    throw new Error('訓練增益檔要有 `samples` 陣列（冇樣本就用空陣列，唔准缺）');
  }
  return {
    schema: Number(json.schema) || 1,
    note: typeof json.note === 'string' ? json.note : '',
    samples: json.samples.map(validateSample),
  };
}

/**
 * 排訓練：每一項訓練用**適用嘅樣本**計「今次值幾多評價分」。
 *
 * ⚠️ 適用＝ `training` 一樣，而且（有指定 `level` 嘅話）`level` 一樣。
 *    如果指定咗等級但嗰項冇嗰個等級嘅樣本 → 當**未收集**（唔准用其他等級頂替：
 *    唔同等級加成唔同）。
 * ⚠️ 排先後用**中位數**；`min`／`max` 一齊出，等用家睇到樣本差幾遠。
 *
 * @param {{stats:number[], samples:Array, level?:number|null}} args
 * @returns {{rows:Array, unknown:Array, note:string, level:number|null}}
 */
export function rankTrainings({ stats, samples, level = null } = {}) {
  const list = Array.isArray(samples) ? samples.map(validateSample) : [];
  const wanted = Number.isInteger(level) ? level : null;
  const rows = [];
  const unknown = [];
  for (const { key, label } of TRAINING_TYPES) {
    const applicable = list.filter((s) => s.training === key && (wanted === null || s.level === wanted));
    if (applicable.length === 0) {
      unknown.push({ key, label, reason: wanted === null ? '未收集任何樣本' : `未收集 Lv${wanted} 嘅樣本` });
      continue;
    }
    const scores = applicable.map((s) => gainsScore(stats, s.gains));
    const skillPts = applicable.filter((s) => s.skillPt !== null).map((s) => s.skillPt);
    const main = [...new Set(applicable.flatMap((s) => Object.keys(s.gains)))];
    rows.push({
      key,
      label,
      known: true,
      score: median(scores),
      min: Math.min(...scores),
      max: Math.max(...scores),
      samples: applicable.length,
      levels: [...new Set(applicable.map((s) => s.level))].sort((a, b) => a - b),
      stats: main,
      skillPt: median(skillPts),
      example: applicable[0].gains,
    });
  }
  // 排先後：加分多啲行先；同分就跟遊戲原本嘅訓練次序（速度→持久→力量→根性→智力），
  // 令同一份數據每次跑都出同一個次序（唔准靠 sort 嘅穩定性碰運氣）。
  const order = (key) => TRAINING_KEYS.indexOf(key);
  rows.sort((a, b) => b.score - a.score || order(a.key) - order(b.key));
  const note = rows.length === 0
    ? '未有訓練樣本 —— 用 `node tools/training.js --add=…` 記低實機見到嘅加成先計得到'
    : unknown.length > 0
      ? `最加分：${rows[0].label}（+${rows[0].score.toFixed(0)} 分，${rows[0].samples} 個樣本）；未收集：${unknown.map((u) => u.label).join('、')}`
      : `最加分：${rows[0].label}（+${rows[0].score.toFixed(0)} 分，${rows[0].samples} 個樣本）`;
  return { rows, unknown, note, level: wanted };
}
