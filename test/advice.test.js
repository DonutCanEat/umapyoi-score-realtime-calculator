/**
 * C4：屬性邊際效率建議（`src/umascore/advice.js`）嘅單元測試。
 *
 * 兩條底線：
 *   ① 邊際效率一定要同 `statPoints()` **一致**（唔准自己砌公式 → 地雷 #1）；
 *   ② 「差 N 分要加幾多點」嘅估算**真係到得了目標ランク**（唔可以講一個到唔到嘅數）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { marginalPoints, statEfficiency, trainingAdvice } from '../src/umascore/advice.js';
import { evaluate, STAT_KEYS } from '../src/umascore/evaluate.js';
import { STAT_MAX, statPoints } from '../src/umascore/tables.js';

const STATS = [1200, 600, 600, 600, 600];

test('C4：邊際效率 ＝ statPoints(v+1) − statPoints(v)（唔准自己砌公式）', () => {
  for (const v of [0, 1, 49, 50, 99, 1200, 1500, 1999]) {
    assert.equal(marginalPoints(v), statPoints(v + 1) - statPoints(v), `v=${v}`);
  }
});

test('C4：邊際效率係「望遠鏡和」—— 分段加埋一定要等於總分差（同核心庫一致）', () => {
  let sum = 0;
  for (let v = 900; v < 950; v += 1) sum += marginalPoints(v);
  assert.equal(sum, statPoints(950) - statPoints(900), '逐點邊際加埋 = 總分差');
});

test('C4：封頂（≥2000）／唔合法 → 0（唔可以叫用戶加一個加唔到嘅嘢）', () => {
  assert.equal(marginalPoints(2000), 0);
  assert.equal(marginalPoints(2500), 0);
  assert.equal(marginalPoints(-5), 0);
  assert.equal(marginalPoints(NaN), 0);
  assert.equal(marginalPoints('abc'), 0);
});

test('C4：statEfficiency 由高到低排，而且 capped 標記要老實', () => {
  const rows = statEfficiency([2000, 600, 600, 600, 600]);
  assert.equal(rows.length, 5);
  // ⚠️ 比較 `key` 而唔係中文標籤：核心庫嘅標籤（`STAT_LABELS`）同 HUD 嘅短標籤
  //    （`layout.js` `STAT_LABELS_ZH`）**刻意唔同**（HUD 位置窄）→ 唔可以綁死中文。
  assert.equal(rows[0].key, 'stamina', '速度封頂（邊際 0）→ 四個 600 排前面');
  assert.equal(rows[4].key, 'speed');
  assert.equal(rows[4].value, 2000);
  assert.equal(rows[4].capped, true);
  for (let i = 1; i < rows.length; i += 1) {
    assert.ok(rows[i - 1].marginal >= rows[i].marginal, '要遞減排序');
  }
  // 唔合法輸入唔准 throw
  assert.equal(statEfficiency(null).length, 5);
  assert.ok(statEfficiency(['x']).every((r) => Number.isFinite(r.value)));
  // 五個屬性一個都唔少（排序只係次序，唔係內容）
  assert.deepEqual([...statEfficiency(STATS).map((r) => r.key)].sort(), [...STAT_KEYS].sort());
});

test('C4：差少少升級 → 建議嘅點數**真係到得到**目標ランク（估算唔可以呃人）', () => {
  const before = evaluate({ stats: toObj(STATS) });
  const gap = before.nextRank.gap;
  assert.ok(gap > 0);
  const advice = trainingAdvice(STATS);
  assert.equal(advice.gap, gap);
  assert.ok(advice.best, '應該有建議');
  assert.ok(advice.best.points > 0);

  // ⭐ 關鍵：跟建議加落去，真係升到級（用 evaluate() 驗，唔係自己加）
  const idx = advice.options[0].index;
  const bumped = [...STATS];
  bumped[idx] += advice.best.points;
  const after = evaluate({ stats: toObj(bumped) });
  assert.ok(after.total >= advice.targetTotal,
    `跟建議加 ${advice.best.points} 點「${advice.best.label}」應該到 ${advice.targetTotal}，實得 ${after.total}`);
});

test('C4：options 每個屬性都有自己嘅點數（用戶想練邊個都得）', () => {
  const advice = trainingAdvice(STATS);
  assert.equal(advice.options.length, 5);
  for (const opt of advice.options) {
    assert.ok(opt.marginal > 0 && opt.points > 0);
    assert.ok(Number.isInteger(opt.points), '點數要係整數（ceil）');
    const bumped = [...STATS];
    bumped[opt.index] += opt.points;
    assert.ok(evaluate({ stats: toObj(bumped) }).total >= advice.targetTotal,
      `加 ${opt.points} 點「${opt.label}」應該夠升級`);
  }
  assert.match(advice.note, /估算/, '⚠️ 一定要講明點數係估算');
});

test('C4：封頂屬性唔會出現喺建議（除以 0 會出 Infinity）', () => {
  // ⚠️ 一定要揀一個「仲有下一個ランク」嘅五維（四條 2000 已經係 UA，冇 gap 就冇建議可言）
  const stats = [2000, 500, 500, 500, 500];
  const advice = trainingAdvice(stats);
  assert.ok(advice.gap > 0, '呢個五維應該仲有得升');
  assert.ok(advice.options.every((o) => o.label !== '速度'), '封頂嘅屬性唔可以入建議');
  assert.ok(advice.options.every((o) => Number.isFinite(o.points) && o.points > 0));
  assert.ok(advice.options.some((o) => o.capped === false));
  assert.equal(advice.best.label, advice.options[0].label, '建議要跟排序第一位');
});

test('C4：冇下一個ランク（已 UA）／五個都封頂 → 老實講，唔准亂建議', () => {
  const top = trainingAdvice([2000, 2000, 2000, 2000, 2000]);
  assert.equal(top.nextRank, null);
  assert.equal(top.gap, 0);
  assert.equal(top.best, null);
  assert.match(top.note, /最高ランク|封頂/);

  // 五維爆表但 total 因為技能分而唔夠 → nextRank 有值，但冇任何屬性可以加
  const capped = trainingAdvice([2000, 2000, 2000, 2000, 2000], {
    player: { skills: [], uniqueSkills: [], inheritedUniqueCount: 0 },
  });
  assert.equal(capped.options.length, 0);
  assert.equal(capped.best, null);
});

/** 五維陣列 → `evaluate()` 要嘅物件。 */
function toObj(stats) {
  return Object.fromEntries(STAT_KEYS.map((k, i) => [k, stats[i]]));
}

test('C4：唔合法輸入唔准 throw（HUD／窗會亂傳嘢）', () => {
  for (const bad of [null, undefined, [], [1], ['x', 'y', 'z', 'w', 'v'], 5]) {
    const a = trainingAdvice(bad);
    assert.ok(Number.isFinite(a.gap), `gap 要係數字：${JSON.stringify(bad)}`);
  }
  assert.equal(STAT_MAX, 2000);
});
