import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeSample,
  analyzeSamples,
  segmentIndex,
  getProfile,
  SEGMENT_COUNT,
  SEGMENT_SIZE,
} from '../src/umascore/index.js';

const FLAT_600 = { stats: [600, 600, 600, 600, 600] };

test('段索引：每 50 點一段，覆蓋 0–2000', () => {
  assert.equal(SEGMENT_SIZE, 50);
  assert.equal(SEGMENT_COUNT, 40);
  assert.equal(segmentIndex(0), 0);
  assert.equal(segmentIndex(49), 0);
  assert.equal(segmentIndex(50), 1);
  assert.equal(segmentIndex(600), 12);
  assert.equal(segmentIndex(1199), 23);
  assert.equal(segmentIndex(1200), 24);
  assert.equal(segmentIndex(1999), 39);
  assert.equal(segmentIndex(2000), 39);
  assert.equal(segmentIndex(9999), 39);
});

test('analyzeSample：完全吻合嘅樣本 delta = 0', () => {
  const row = analyzeSample({ id: 'perfect', ...FLAT_600, total: 5715, rank: 'C+' });
  assert.equal(row.predictedStatScore, 5715);
  assert.equal(row.skillScore, 0);
  assert.equal(row.impliedStatScore, 5715);
  assert.equal(row.delta, 0);
  assert.equal(row.rankMatch, true);
  assert.deepEqual(row.stats, [600, 600, 600, 600, 600]);
});

test('analyzeSample：遊戲總分高咗 5 分 → delta = +5', () => {
  const row = analyzeSample({ id: 'off', ...FLAT_600, total: 5720 });
  assert.equal(row.delta, 5);
  assert.equal(row.rankMatch, null);
});

test('analyzeSample：技能分會被扣除，唔會污染五維誤差', () => {
  const row = analyzeSample({
    id: 'with-skills',
    stats: [600, 600, 600, 600, 600],
    uniqueSkills: [{ star: 4, level: 5 }],
    inheritedUniqueCount: 2,
    skills: [{ base: 217, aptitudes: ['S'] }],
    total: 5715 + 850 + 360 + 239,
  });
  assert.equal(row.skillScore, 1449);
  assert.equal(row.skillScoreSource, 'computed');
  assert.equal(row.impliedStatScore, 5715);
  assert.equal(row.delta, 0);
});

test('analyzeSample：可以自己填 skillScore（跳過技能計算）', () => {
  const row = analyzeSample({ id: 'manual', ...FLAT_600, skillScore: 1000, total: 6715 });
  assert.equal(row.skillScoreSource, 'sample');
  assert.equal(row.skillScore, 1000);
  assert.equal(row.delta, 0);
});

test('analyzeSample：冇 total 就要拋錯', () => {
  assert.throws(() => analyzeSample({ id: 'bad', ...FLAT_600 }), /缺少有效嘅 total/);
});

test('analyzeSamples：統計同段覆蓋率', () => {
  const samples = [
    { id: 'a', ...FLAT_600, total: 5715 },
    { id: 'b', ...FLAT_600, total: 5720 },
  ];
  const report = analyzeSamples(samples, { profile: getProfile('tw') });
  assert.equal(report.count, 2);
  assert.equal(report.exactCount, 1);
  assert.equal(report.sumAbsDelta, 5);
  assert.equal(report.maxAbsDelta, 5);
  // 五維全部 600 → 第 12 段
  assert.deepEqual(Object.keys(report.segmentCoverage).map(Number).sort((a, b) => a - b), [12]);
});

test('analyzeSamples：冇指定 profile 就用預設（繁中服）', () => {
  const report = analyzeSamples([{ id: 'x', ...FLAT_600, total: 5715 }]);
  assert.equal(report.profileId, 'tw');
});

test('技能冇填 base → 唔可以靜靜哋當 0，要標示 incomplete', () => {
  const row = analyzeSample({
    id: 'no-base',
    stats: [600, 600, 600, 600, 600],
    skills: [{ name: '直線加速' }],
    total: 5715,
  });
  assert.equal(row.skillScore, null);
  assert.equal(row.skillScoreSource, 'incomplete');
  assert.equal(row.unresolvedSkills, 1);
  assert.equal(row.delta, null);
});

test('固有技能冇填★數 → 一樣要標示 incomplete（★數決定 120 定 170）', () => {
  const row = analyzeSample({
    id: 'no-star',
    stats: [600, 600, 600, 600, 600],
    uniqueSkills: [{ name: '勝利的躍動', star: null, level: 5 }],
    total: 5715,
  });
  assert.equal(row.skillScore, null);
  assert.equal(row.skillScoreSource, 'incomplete');
  assert.equal(row.delta, null);
});

test('屬性超出上限 2000 → 要出 outOfRange 警示（唔可以靜靜哋 clamp）', () => {
  const row = analyzeSample({
    id: 'over-cap',
    stats: [2100, 1324, 600, 600, 600],
    total: 36575,
  });
  assert.deepEqual(row.outOfRange, [2100]);
  assert.equal(row.predicted.statMax, 2000);
});

test('analyzeSamples：計唔到誤差嘅樣本唔會拉低統計', () => {
  const report = analyzeSamples([
    { id: 'ok', ...FLAT_600, total: 5715 },
    { id: 'blocked', stats: [600, 600, 600, 600, 600], skills: [{ name: '無 base' }], total: 9999 },
  ]);
  assert.equal(report.scoredCount, 1);
  assert.equal(report.unscoredCount, 1);
  assert.equal(report.sumAbsDelta, 0);
  assert.equal(report.exactCount, 1);
});
