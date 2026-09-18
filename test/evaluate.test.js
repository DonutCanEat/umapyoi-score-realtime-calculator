import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STAT_BREAKPOINTS,
  STAT_POINTS,
  STAT_MAX,
  statPoints,
  StatCurve,
  rankFor,
  nextRankGap,
  RANK_THRESHOLDS,
  normalSkillPoints,
  uniqueSkillPoints,
  skillPoints,
  INHERITED_UNIQUE_POINTS,
  evaluate,
  getProfile,
} from '../src/umascore/index.js';

test('五維演算法：所有舊社群取樣點都要完全對得上', () => {
  for (let i = 0; i < STAT_BREAKPOINTS.length; i += 1) {
    assert.equal(
      statPoints(STAT_BREAKPOINTS[i]),
      STAT_POINTS[i],
      `屬性 ${STAT_BREAKPOINTS[i]} 應該係 ${STAT_POINTS[i]} 分`,
    );
  }
});

test('五維演算法：社群實測值 102→68、502→853、902→2217（舊分段直線做唔到）', () => {
  assert.equal(statPoints(102), 68);
  assert.equal(statPoints(502), 853);
  assert.equal(statPoints(902), 2217);
});

test('五維演算法：五維全 600 = 5715（同 umsatei 預設 1143pt 吻合）', () => {
  const curve = new StatCurve();
  assert.equal(curve.pointsFor(600), 1143);
  assert.equal(curve.totalFor([600, 600, 600, 600, 600]), 5715);
});

test('五維演算法：1200 以上（屬性上限開放）單調上升', () => {
  assert.equal(statPoints(1200), 3841);
  assert.equal(statPoints(1201), 3849);
  assert.equal(statPoints(1300), 4688);
  assert.equal(statPoints(2000), 14280);
  let previous = statPoints(1200);
  for (let v = 1201; v <= STAT_MAX; v += 1) {
    const current = statPoints(v);
    assert.ok(current >= previous, `屬性 ${v} 應該唔會跌（${previous} → ${current}）`);
    previous = current;
  }
});

test('五維演算法：超出上限會 clamp，負數當 0', () => {
  assert.equal(statPoints(2000), statPoints(9999));
  assert.equal(statPoints(-100), 0);
  assert.equal(statPoints(0), 0);
});

test('ランク：邊界值（包括新加嘅 UE/UD/UC/UB/UA）', () => {
  assert.equal(rankFor(0), 'G');
  assert.equal(rankFor(299), 'G');
  assert.equal(rankFor(300), 'G+');
  assert.equal(rankFor(5715), 'C+');
  assert.equal(rankFor(19200), 'SS+');
  assert.equal(rankFor(19600), 'UG');
  // 四條實機樣本
  assert.equal(rankFor(20589), 'UG2');
  assert.equal(rankFor(28211), 'UF8');
  assert.equal(rankFor(32332), 'UE6');
  assert.equal(rankFor(36575), 'UD3');
  assert.equal(rankFor(32100), 'UE6');
  assert.equal(rankFor(32099), 'UE5');
  assert.equal(rankFor(36200), 'UD3');
  assert.equal(rankFor(36199), 'UD2');
  assert.equal(rankFor(55200), 'UA');
  assert.equal(rankFor(55199), 'UB9');
  assert.equal(rankFor(999999), 'UA');
});

test('ランク閾值：必須遞增而且冇重複', () => {
  const seen = new Set();
  for (let i = 0; i < RANK_THRESHOLDS.length; i += 1) {
    const [min, name] = RANK_THRESHOLDS[i];
    assert.ok(!seen.has(name), `ランク ${name} 重複`);
    seen.add(name);
    if (i > 0) {
      assert.ok(min > RANK_THRESHOLDS[i - 1][0], `${name} 嘅門檻冇大過上一個`);
    }
  }
});

test('nextRankGap：距離升級仲差幾多', () => {
  assert.deepEqual(nextRankGap(5600), { rank: 'B', gap: 900, threshold: 6500 });
  assert.equal(nextRankGap(55200), null);
});

test('技能：非固有技能係數（217 × 1.1 = 239）', () => {
  assert.equal(normalSkillPoints(217), 217);
  assert.equal(normalSkillPoints(217, ['S']), 239);
  assert.equal(normalSkillPoints(217, ['A']), 239);
  assert.equal(normalSkillPoints(217, ['B']), 195);
  assert.equal(normalSkillPoints(217, ['G']), 152);
  assert.equal(normalSkillPoints(217, ['S', 'S']), 263);
});

test('技能：固有技能評價點', () => {
  assert.equal(uniqueSkillPoints(1, 1), 120);
  assert.equal(uniqueSkillPoints(2, 5), 600);
  assert.equal(uniqueSkillPoints(3, 4), 680);
  assert.equal(uniqueSkillPoints(4, 5), 850);
  assert.equal(uniqueSkillPoints(5, 6), 1020);
  assert.throws(() => uniqueSkillPoints(1, 6), /最多 5/);
});

test('技能：繼承・固有技能固定 180', () => {
  assert.equal(skillPoints({ kind: 'inherited-unique' }), 180);
  assert.equal(INHERITED_UNIQUE_POINTS, 180);
});

test('evaluate：五維全 600、無技能 → 5715 / C+', () => {
  const result = evaluate({ stats: [600, 600, 600, 600, 600] });
  assert.equal(result.statScore, 5715);
  assert.equal(result.skillScore, 0);
  assert.equal(result.total, 5715);
  assert.equal(result.rank, 'C+');
  assert.equal(result.statMax, STAT_MAX);
});

test('evaluate：完整例子（1200/600/600/600/600 + 固有★4Lv5 + 2 繼承固有 + 1 技能）', () => {
  const result = evaluate({
    stats: [1200, 600, 600, 600, 600],
    uniqueSkills: [{ star: 4, level: 5 }],
    inheritedUniqueCount: 2,
    skills: [{ base: 217, aptitudes: ['S'] }],
  });
  assert.equal(result.statScore, 8413);
  assert.equal(result.breakdown.uniqueScore, 850);
  assert.equal(result.breakdown.inheritedScore, 360);
  assert.equal(result.breakdown.normalScore, 239);
  assert.equal(result.skillScore, 1449);
  assert.equal(result.total, 9862);
  assert.equal(result.rank, 'B+');
});

test('evaluate：屬性超過 1200 都用精確演算法', () => {
  const result = evaluate({ stats: [1840, 1324, 1222, 1206, 1125] });
  assert.equal(result.breakdown.stats[0].points, 11522);
  assert.ok(result.statScore > 25000, `五維分應該合理，實際 ${result.statScore}`);
});

test('evaluate：三個版本 profile 都出得同一個結果', () => {
  const tw = evaluate({ stats: [600, 600, 600, 600, 600] }, { profileId: 'tw' });
  const jp = evaluate({ stats: [600, 600, 600, 600, 600] }, { profileId: 'jp' });
  assert.equal(tw.total, jp.total);
  assert.equal(getProfile('cn').rankThresholds.length, RANK_THRESHOLDS.length);
});

test('evaluate：可以用物件形式傳五維', () => {
  const result = evaluate({ stats: { speed: 600, stamina: 600, power: 600, guts: 600, wit: 600 } });
  assert.equal(result.total, 5715);
});

test('evaluate：錯誤輸入要拋錯，唔好靜靜哋當 0', () => {
  assert.throws(() => evaluate({ stats: [1, 2, 3] }), /需要 5 個值/);
  assert.throws(() => evaluate({ stats: { speed: 'abc' } }), /唔係有效數字/);
  assert.throws(() => normalSkillPoints(100, ['X']), /未知嘅適性等級/);
});
