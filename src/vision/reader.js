/**
 * 由「一張畫面」讀出五維 → 計評價分。
 *
 * 呢一層負責把影像管線同計分核心（`src/umascore`）駁埋一齊，
 * 並且做**幀間穩定化**：單幀讀錯唔應該即刻反映到 HUD 上面。
 *
 * 純函數（除咗 StatTracker 有狀態），零 I/O，可以直接 `node --test`。
 */

import { buildInkMask } from './inkmask.js';
import { detectDigitRow } from './digitrow.js';
import { extractGlyphs, readNumberBoxes } from './glyphs.js';
import { evaluate } from '../umascore/evaluate.js';

/** 五維合理範圍（屬性上限可以變，但唔會超過 2000 好多）。 */
const MIN_STAT = 0;
const MAX_STAT = 2600;

/**
 * 由模板 JSON（`data/glyph-templates.json`）建立 runtime 模板表。
 */
export function loadTemplates(json) {
  const templates = {};
  for (const [label, arr] of Object.entries(json.templates ?? {})) {
    templates[label] = arr instanceof Float32Array ? arr : Float32Array.from(arr);
  }
  return templates;
}

/**
 * 讀一張圖嘅五維。
 *
 * @param {{data:Uint8ClampedArray,width:number,height:number}} image
 * @param {Record<string, Float32Array>} templates
 * @param {object} [options]
 * @returns {{stats:number[]|null, confidence:number, row:object|null, reason?:string, numbers?:string[]}}
 */
export function readStats(image, templates, options = {}) {
  const mask = options.mask ?? buildInkMask(image, options);
  const row = detectDigitRow(image, { mask, ...options });
  if (!row) return { stats: null, confidence: 0, row: null, reason: '搵唔到五維數字列' };

  // 逐個框抽字元 → 交**共用**迴圈讀數（信心取 min、一失敗即停：`glyphs.readNumberBoxes()`，
  // 同實機面板條嗰條路共用同一份；見獨立審計 H2）。
  const items = row.numbers.map((num) => ({
    box: num,
    glyphs: extractGlyphs(image, mask, { x0: num.x0, x1: num.x1 }, row.y0, row.y1),
  }));
  const { texts, confidence, failed } = readNumberBoxes(
    items, templates, options,
    // ⚠️ 訊息措辭同以前逐字一樣（`第 N 個數字讀唔清`）
    (item, read, i, done) => `第 ${done.length + 1} 個數字讀唔清（「${read.text}」）`,
  );
  if (failed) {
    return {
      stats: null,
      confidence,
      row,
      reason: failed.reason,
      numbers: [...texts, failed.read.text],
    };
  }

  const stats = texts.map(Number);
  for (const [i, v] of stats.entries()) {
    if (!Number.isFinite(v) || v < MIN_STAT || v > MAX_STAT) {
      return { stats: null, confidence, row, reason: `第 ${i + 1} 個數值唔合理（${v}）`, numbers: texts };
    }
  }
  return { stats, confidence, row, numbers: texts };
}

/**
 * 幀間穩定化：多數投票 + 單調性檢查。
 *
 * 為何需要：
 *   1. 動畫／轉場其間可能只讀到一半，單幀就出數會令 HUD 跳。
 *   2. 五維喺育成期間**只會上升**（除咗事件扣屬性），所以大幅下跌當讀錯。
 */
export class StatTracker {
  constructor(options = {}) {
    this.windowSize = options.windowSize ?? 5;
    this.minVotes = options.minVotes ?? 3;
    this.buffer = [];
    this.current = null;
  }

  /** 記一幀。`stats` 可以係 null（讀唔到）。 */
  push(stats) {
    this.buffer.push(stats);
    if (this.buffer.length > this.windowSize) this.buffer.shift();

    const counts = new Map();
    for (const entry of this.buffer) {
      if (!entry) continue;
      const key = entry.join(',');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    let bestKey = null;
    let bestCount = 0;
    for (const [key, count] of counts) {
      if (count > bestCount) {
        bestKey = key;
        bestCount = count;
      }
    }
    if (bestKey === null || bestCount < this.minVotes) {
      return { stable: false, stats: this.current };
    }
    const candidate = bestKey.split(',').map(Number);

    // 五維通常只升唔跌 → 下跌**多數**當讀錯。
    // 但遊戲事件真係會扣屬性，所以如果整個窗口（每幀都一樣）都係跌，
    // 就當係真嘅變化接受，唔會卡死。
    const unanimous = bestCount === this.buffer.length;
    if (this.current && candidate.some((v, i) => v < this.current[i]) && !unanimous) {
      return { stable: false, stats: this.current, rejected: candidate };
    }

    const changed = !this.current || this.current.some((v, i) => v !== candidate[i]);
    this.current = candidate;
    return { stable: true, stats: candidate, changed };
  }

  reset() {
    this.buffer = [];
    this.current = null;
  }
}

/**
 * 五維 → 評價分（唔計技能）。
 *
 * @returns {{statScore:number, total:number, rank:string, nextRank:object}|null}
 */
export function scoreStats(stats, options = {}) {
  if (!stats) return null;
  const [speed, stamina, power, guts, wit] = stats;
  const result = evaluate({
    stats: { speed, stamina, power, guts, wit },
    skills: [],
    uniqueSkills: [],
    inheritedUniqueCount: 0,
    ...options.player,
  }, options);
  return {
    statScore: result.statScore,
    total: result.total,
    rank: result.rank,
    nextRank: result.nextRank,
  };
}
