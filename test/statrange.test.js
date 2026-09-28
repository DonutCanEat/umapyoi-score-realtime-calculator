/**
 * 五維數值合理性檢查（`src/vision/statrange.js`）嘅單元測試。
 *
 * 為何要：`docs/vision-design.md` 早就寫明 `0 ≤ 值 ≤ 2600`，但**只有 `reader.js` 做**；
 * 生產路徑（`statbar.js` 實機面板條／`resultpanel.js` 培育結束確認）以前係
 * `texts.map(Number)` 就交出去 → 一次 4 位數誤讀（`9999`）會靜默變成評價分
 * （設計審查 2026-09-28 S3）。呢個檔釘住支共用函數，另外兩個 reader 各自有測試驗接駁。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { checkStatRange, STAT_MAX, STAT_MIN } from '../src/vision/statrange.js';

test('statrange：範圍內（連邊界 0／2600）都要過', () => {
  assert.deepEqual(checkStatRange([0, 1, 2600, 1200, 999]).ok, true);
  assert.equal(checkStatRange([STAT_MIN, STAT_MAX]).ok, true);
  // 真實樣本（實機 live-truth 之一）
  assert.equal(checkStatRange([1133, 259, 462, 358, 420]).ok, true);
});

test('statrange：離譜值要擋（呢個就係生產路徑以前嘅縫）', () => {
  for (const [bad, index] of [[[9999, 54, 139, 85, 102], 0], [[226, 54, 139, 85, 99999], 4], [[-1, 1, 1, 1, 1], 0]]) {
    const out = checkStatRange(bad);
    assert.equal(out.ok, false, `${bad.join('/')} 應該唔合理`);
    assert.equal(out.index, index, `要指出係第 ${index + 1} 個`);
    assert.match(out.reason, /唔合理/, '訊息要講「唔合理」（實機診斷靠佢）');
    assert.match(out.reason, new RegExp(String(bad[index])), '訊息要帶住個壞值');
  }
  assert.equal(checkStatRange([226, 54, 139, 85, 2601]).ok, false, '2601 已經超出上界');
});

test('statrange：NaN 一定要擋（淨係比大小係捉唔到 NaN 嘅）', () => {
  const nan = checkStatRange([Number('?'), 54, 139, 85, 102]);
  assert.equal(nan.ok, false);
  assert.equal(nan.index, 0);
  assert.match(nan.reason, /第 1 個數值唔合理/);
  // 防「只用 < / > 比較」呢個寫法
  assert.equal(Number.NaN < STAT_MIN, false);
  assert.equal(Number.NaN > STAT_MAX, false);
  for (const bad of [[Number.NaN], [Infinity], [-Infinity], [undefined], ['226']]) {
    assert.equal(checkStatRange(bad).ok, false, `${JSON.stringify(bad)} 唔應該當合理`);
  }
});

test('statrange：冇值可以檢查就要報（唔准靜默過）', () => {
  for (const bad of [[], null, undefined, '226,54']) {
    const out = checkStatRange(bad);
    assert.equal(out.ok, false, `${JSON.stringify(bad)} 唔應該當過`);
    assert.ok(out.reason.length > 0, '要有理由');
  }
});

test('statrange：呼叫者可以收窄（測試用），但預設上下界唔准改', () => {
  assert.equal(checkStatRange([226, 54, 139, 85, 102], { max: 100 }).ok, false);
  assert.equal(checkStatRange([226, 54, 139, 85, 102], { max: 300 }).ok, true);
  assert.equal(checkStatRange([50, 54, 139, 85, 102], { min: 100 }).ok, false);
  assert.equal(STAT_MIN, 0);
  assert.equal(STAT_MAX, 2600, '上界 2600（留餘量畀屬性上限再開放）—— 唔准收緊到 2000');
});
