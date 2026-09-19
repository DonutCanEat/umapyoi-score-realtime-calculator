/**
 * D5：技能分「已讀進度」顯示（`hudState({ skillRead })`）。
 *
 * 為何要單獨一個檔：呢條線嘅危險唔係「唔識顯示」，而係**改變現狀** ——
 * `skillScore === null` 嗰句「？／總分 ≥ X」係「技能未讀到」嘅老實講法，
 * 加進度提示唔可以令**唔傳 `skillRead` 嘅舊呼叫**（例如所有舊測試）有任何分別。
 * 所以呢個檔一半係測新行為，一半係測「舊行為一個字都冇變」。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { hudState } from '../src/hud/layout.js';

const SCORE = { total: 32334, rank: 'UE2', statScore: 30000 };

/** summary 入面「技能分」嗰項（冇就 undefined）。 */
const skillItem = (s) => s.summary.find((x) => x.key === 'skill');

test('D5：未傳 skillRead → 同以前一模一樣（「？／總分 ≥ X」）', () => {
  const plain = hudState({ score: SCORE });
  assert.equal(skillItem(plain).value, '？／總分 ≥ 32334');
  // 傳 null／undefined／垃圾一律當「冇呢個資料」（唔准 throw）
  for (const bad of [null, undefined, 0, 'x', [], {}, { count: 0 }, { count: -3 }, { count: 2.5 }]) {
    const s = hudState({ score: SCORE, skillRead: bad });
    assert.equal(skillItem(s).value, '？／總分 ≥ 32334', `skillRead=${JSON.stringify(bad)} 應該當冇`);
  }
});

test('D5：認到 N 招 → 出「≥ 已知分（已讀 N 招）」（下限，唔係實數）', () => {
  const s = hudState({ score: SCORE, skillRead: { count: 7, points: 1234 } });
  assert.equal(skillItem(s).value, '≥ 1234（已讀 7 招）');
  assert.match(skillItem(s).value, /≥/, '⭐ 一定要有「≥」—— 未認到嘅招可能仲有，唔可以當實數');
});

test('D5：points 缺席／唔合法 → 當 0（唔准出 NaN）', () => {
  assert.equal(skillItem(hudState({ score: SCORE, skillRead: { count: 3 } })).value, '≥ 0（已讀 3 招）');
  assert.equal(skillItem(hudState({ score: SCORE, skillRead: { count: 3, points: 'abc' } })).value,
    '≥ 0（已讀 3 招）');
  assert.equal(skillItem(hudState({ score: SCORE, skillRead: { count: 3, points: NaN } })).value,
    '≥ 0（已讀 3 招）');
});

test('D5：技能分真係讀到（Phase 2 完成）→ 照舊出實數，唔會多餘噉出「已讀」', () => {
  const s = hudState({
    score: { total: 32334, rank: 'UE2', statScore: 30000, skillScore: 4321 },
    skillRead: { count: 12, points: 4321 },
  });
  assert.equal(skillItem(s).value, '4321', '有實數就出實數（`skillRead` 只係未齊嗰陣用）');
});

test('D5：閂 skillScore 顯示 → skillRead 都唔會漏出嚟', () => {
  const s = hudState({
    score: SCORE,
    skillRead: { count: 7, points: 1234 },
    display: { skillScore: false },
  });
  assert.equal(skillItem(s), undefined);
});

test('D5：其他 summary 項／總分完全唔受影響（進度提示唔可以連累隔籬）', () => {
  const before = hudState({ score: SCORE });
  const after = hudState({ score: SCORE, skillRead: { count: 7, points: 1234 } });
  assert.equal(after.total, before.total);
  assert.deepEqual(
    after.summary.filter((x) => x.key !== 'skill'),
    before.summary.filter((x) => x.key !== 'skill'),
  );
  assert.deepEqual(after.lines, before.lines);
  assert.equal(after.note, before.note);
});
