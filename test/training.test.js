/**
 * C4：訓練評分（`src/umascore/training.js`）＋ 訓練增益樣本檔。
 *
 * 為何要（呢個模組最易出錯嘅地方）：
 *   ① 「加分」一定要用 `tables.js` 嘅**精確** `statPoints()` 差分 —— 自己砌公式／用微分
 *      就會出錯數（地雷 #1）；
 *   ② 屬性封頂（2000）之後加成**值 0 分**，唔可以照加；
 *   ③ 冇樣本嘅訓練**唔准排名、唔准估**（呢個就係「唔好亂出數」嘅底線）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { STAT_MAX, statPoints } from '../src/umascore/tables.js';
import {
  TRAINING_KEYS,
  TRAINING_TYPES,
  applyGain,
  gainsScore,
  parseTrainingFile,
  rankTrainings,
  validateSample,
} from '../src/umascore/training.js';

const sample = (training, level, gains, extra = {}) => ({ training, level, gains, ...extra });
const FLAT = [600, 600, 600, 600, 600];

test('training：gainsScore 一定等於精確 statPoints 差分（唔准自己砌公式／微分）', () => {
  // 逐個屬性驗（同時驗「順序對得上 STAT_KEYS：速度／持久／力量／根性／智力」）
  for (const [i, key] of TRAINING_KEYS.entries()) {
    for (const value of [102, 502, 902, 1200, 1846, 1999]) {
      const stats = [0, 0, 0, 0, 0];
      stats[i] = value;
      const gain = 12;
      assert.equal(
        gainsScore(stats, { [key]: gain }),
        statPoints(value + gain) - statPoints(value),
        `${key} ${value}→${value + gain} 應該等於精確差分`,
      );
    }
  }
  // 多屬性一齊加 → 逐項相加（訓練通常一主一副）
  const stats = [1846, 1074, 1179, 965, 1390];
  assert.equal(
    gainsScore(stats, { speed: 12, power: 6 }),
    (statPoints(1858) - statPoints(1846)) + (statPoints(1185) - statPoints(1179)),
  );
  // 實測數字（防手腳改咗核心都唔覺）：1846→1858 = 196、1179→1185 = 40 → 236
  assert.equal(gainsScore(stats, { speed: 12, power: 6 }), 236);
});

test('training：屬性封頂（2000）之後，超出嘅加成值 0 分', () => {
  assert.equal(applyGain(1999, 12), STAT_MAX, '唔准超過 2000');
  assert.equal(applyGain(100, -150), 0, '夾落 0（唔准出負數）');
  assert.equal(applyGain(100, -50), 50, '冇超界就照加（呢度只係夾範圍，唔係「負數一律當 0」）');
  assert.equal(applyGain(undefined, 12), 12, '冇值當 0');
  const capped = [STAT_MAX, 600, 600, 600, 600];
  assert.equal(gainsScore(capped, { speed: 12 }), 0, '已封頂 ＝ 0 分（唔可以照 statPoints 加落去）');
  assert.equal(gainsScore([1999, 600, 600, 600, 600], { speed: 12 }), statPoints(2000) - statPoints(1999));
});

test('training：rankTrainings 照樣本排名，冇樣本嘅一律當「未收集」（唔准估）', () => {
  const stats = [1846, 1074, 1179, 965, 1390];
  const result = rankTrainings({
    stats,
    samples: [
      sample('speed', 3, { speed: 12, power: 6 }, { skillPt: 4 }),
      sample('stamina', 3, { stamina: 10, guts: 4 }),
      sample('stamina', 3, { stamina: 12, guts: 6 }),
    ],
  });
  assert.deepEqual(result.rows.map((r) => r.key), ['speed', 'stamina'], '加分多啲行先');
  assert.equal(result.rows[0].score, 236);
  assert.equal(result.rows[0].skillPt, 4, '技能Pt 要另外出（唔係評價分）');
  assert.equal(result.rows[1].samples, 2, '同項多筆樣本要計晒');
  assert.equal(result.rows[1].min, gainsScore(stats, { stamina: 10, guts: 4 }));
  assert.equal(result.rows[1].max, gainsScore(stats, { stamina: 12, guts: 6 }));
  assert.ok(result.rows[1].score >= result.rows[1].min && result.rows[1].score <= result.rows[1].max, '中位數要落喺 min–max 之間');
  assert.deepEqual(result.unknown.map((u) => u.key), ['power', 'guts', 'wit'], '冇樣本嘅訓練唔准排名');
  assert.match(result.note, /未收集：力量、根性、智力/);
});

test('training：指定等級之後，唔同等級嘅樣本唔准頂替（加成唔同）', () => {
  const stats = FLAT;
  const samples = [sample('speed', 2, { speed: 20 }), sample('speed', 5, { speed: 40 })];
  const lv2 = rankTrainings({ stats, samples, level: 2 });
  assert.equal(lv2.rows[0].score, gainsScore(stats, { speed: 20 }), 'Lv2 要用 Lv2 嘅樣本');
  assert.equal(lv2.rows[0].samples, 1);
  assert.deepEqual(lv2.unknown.map((u) => u.key), ['stamina', 'power', 'guts', 'wit'], '只收集咗 speed Lv2');
  const lv3 = rankTrainings({ stats, samples, level: 3 });
  assert.equal(lv3.rows.length, 0, '冇 Lv3 樣本 → 一項都唔可以排名');
  assert.match(lv3.unknown[0].reason, /未收集 Lv3/);
});

test('training：完全冇樣本 → 唔出分、note 指路（唔准靜默出 0）', () => {
  const result = rankTrainings({ stats: FLAT, samples: [] });
  assert.deepEqual(result.rows, []);
  assert.equal(result.unknown.length, TRAINING_TYPES.length);
  assert.match(result.note, /--add/);
});

test('training：壞樣本一定 throw 而且點名邊一欄（唔准靜默跳過）', () => {
  const cases = [
    [null, /要係物件/],
    [{ training: 'luck', level: 3, gains: { speed: 1 } }, /`training` 唔合法/],
    [sample('speed', 0, { speed: 1 }), /`level` 要係 1–5/],
    [sample('speed', 9, { speed: 1 }), /`level` 要係 1–5/],
    [sample('speed', 3, null), /`gains` 要係物件/],
    [sample('speed', 3, { speed: 1, luck: 2 }), /屬性 `luck` 唔合法/],
    [sample('speed', 3, { speed: -1 }), /`gains.speed` 要係非負數/],
    [sample('speed', 3, {}), /至少一項加成/],
    [sample('speed', 3, { speed: 1 }, { skillPt: '好多' }), /`skillPt` 要係數字/],
  ];
  for (const [bad, re] of cases) {
    assert.throws(() => validateSample(bad), re, `實得 ${JSON.stringify(bad)} 要 throw`);
  }
  // 0 點嘅屬性唔會入 gains（唔會污染「主屬性」清單），但唔算錯
  const ok = validateSample(sample('speed', 3, { speed: 12, power: 0 }));
  assert.deepEqual(ok.gains, { speed: 12 });
});

test('training：parseTrainingFile 缺 `samples` 一定 throw（唔准當空）', () => {
  assert.throws(() => parseTrainingFile({}), /`samples` 陣列/);
  assert.throws(() => parseTrainingFile(null), /要係物件/);
  assert.deepEqual(parseTrainingFile({ samples: [] }).samples, []);
});

test('training：⭐ 出貨嗰份 data/training-gains.json 一定要讀得入（空樣本都算合法）', () => {
  const json = JSON.parse(readFileSync(new URL('../data/training-gains.json', import.meta.url), 'utf8'));
  const parsed = parseTrainingFile(json); // 壞檔會 throw → 呢條就係閘
  assert.ok(Array.isArray(parsed.samples));
  // ⚠️ 唔准喺 repo 入面「偷放」假樣本當真數據：樣本一定要有 `at`（實測日期）先算數。
  for (const s of parsed.samples) {
    assert.ok(s.at, `樣本 ${JSON.stringify(s)} 冇 \`at\`（實測日期）—— 唔准放來源不明嘅數字入 repo`);
  }
});
