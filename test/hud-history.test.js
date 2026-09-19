/**
 * C3：成長曲線（`src/hud/history.js`）嘅單元測試。
 *
 * 為何測得咁細：呢個檔案嘅錯誤**唔會 throw**，只會靜靜地畫一條唔啱嘅線
 * （或者成條線消失）。所以每一條規矩（去重／上限／除 0／NaN／唔夠點）都要綁死。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_HISTORY,
  SPARK_HEIGHT,
  SPARK_WIDTH,
  historySummary,
  historyView,
  pushSample,
  sparklinePoints,
} from '../src/hud/history.js';

const s = (total, at = 0, stats = null) => ({ at, total, stats });

test('C3：重複樣本唔會入記錄（讀值 5fps，每幀記一筆會壓扁時間軸）', () => {
  let h = [];
  h = pushSample(h, s(100, 1000, [1, 2, 3, 4, 5]));
  const after1 = h;
  h = pushSample(h, s(100, 1005, [1, 2, 3, 4, 5]));
  assert.equal(h, after1, '同一個 total ＋ 五維 → 同一個參照（冇新陣列、冇新entry）');
  assert.equal(h.length, 1);
  h = pushSample(h, s(101, 1010, [1, 2, 3, 4, 5]));
  assert.equal(h.length, 2, '真變化就要記');
  h = pushSample(h, s(101, 1015, [1, 2, 3, 4, 6]));
  assert.equal(h.length, 3, '五維變咗（就算 total 一樣）都要記');
});

test('C3：唔合法樣本唔准入記錄，而且唔准 throw', () => {
  const h = [s(100, 1)];
  for (const bad of [null, undefined, {}, { at: 1 }, { total: NaN }, { total: '100' }, 5, 'x']) {
    assert.equal(pushSample(h, bad), h, `bad=${JSON.stringify(bad)} 應該原封不動`);
  }
  assert.equal(pushSample(null, s(100, 1)).length, 1, '傳 null 當空陣列（唔准 throw）');
  assert.equal(pushSample(h, s(100, 1)).length, 1, '同上一筆一樣 → 唔加');
});

test('C3：有上限，超過就掉最舊（滑動視窗）', () => {
  let h = [];
  for (let i = 0; i < 10; i += 1) h = pushSample(h, s(i, i), { max: 4 });
  assert.equal(h.length, 4);
  assert.deepEqual(h.map((x) => x.total), [6, 7, 8, 9], '留住最近 4 筆');
  assert.equal(pushSample([s(1, 1)], s(2, 2), { max: 0 }).length, 2, 'max 唔合法 → 用預設');
  assert.equal(MAX_HISTORY, 240, '預設上限（改嘅話要同時改呢個數同註釋）');
});

test('C3：折線座標要喺 100×22 之內，而且單調上升嘅線一定要向上', () => {
  const pts = sparklinePoints([s(0, 0), s(50, 1), s(100, 2)]);
  assert.equal(pts.length, 3);
  assert.deepEqual(pts.map((p) => p.x), [0, SPARK_WIDTH / 2, SPARK_WIDTH]);
  assert.ok(pts[0].y > pts[1].y && pts[1].y > pts[2].y, '值越大 y 越細（SVG 向下為正）');
  for (const p of pts) {
    assert.ok(p.x >= 0 && p.x <= SPARK_WIDTH, `x 出界：${p.x}`);
    assert.ok(p.y >= 0 && p.y <= SPARK_HEIGHT, `y 出界：${p.y}`);
  }
});

test('C3：一直冇變（max === min）要畫中間橫線，唔准 NaN', () => {
  const pts = sparklinePoints([s(500, 0), s(500, 1), s(500, 2)]);
  assert.equal(pts.length, 3);
  for (const p of pts) {
    assert.ok(Number.isFinite(p.y), `y 唔可以係 NaN（除 0）：${p.y}`);
    assert.equal(p.y, SPARK_HEIGHT / 2);
  }
});

test('C3：唔夠點／有 NaN 樣本 → 唔畫線（返空陣列，畀 renderer 出文字）', () => {
  assert.deepEqual(sparklinePoints([]), []);
  assert.deepEqual(sparklinePoints([s(100, 0)]), [], '一點畫唔到線');
  assert.deepEqual(sparklinePoints(null), []);
  // NaN／壞 entry 會被剔走，剩返兩個有效點照畫
  const pts = sparklinePoints([s(1, 0), { at: 1, total: NaN }, s(3, 2)]);
  assert.equal(pts.length, 2);
  assert.ok(pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
});

test('C3：摘要講得出「由幾多升到幾多、用咗幾久」', () => {
  const sum = historySummary([s(10000, 1000), s(10300, 61000), s(10800, 181000)]);
  assert.deepEqual(sum, {
    count: 3, first: 10000, latest: 10800, delta: 800, spanMs: 180000, from: 1000, to: 181000,
  });
  assert.equal(historySummary([]), null);
  assert.equal(historySummary(null), null);
  assert.equal(historySummary([{ at: 5, total: NaN }]), null, '全部唔合法 → null（唔可以出 NaN 摘要）');
});

test('C3：historyView 係 HUD 收到嘅嘢（冇樣本 → null，唔會出半截 view）', () => {
  assert.equal(historyView([]), null);
  assert.equal(historyView(null), null);
  const v = historyView([s(100, 0), s(200, 60000)]);
  assert.equal(v.count, 2);
  assert.equal(v.width, SPARK_WIDTH);
  assert.equal(v.height, SPARK_HEIGHT);
  assert.equal(v.delta, 100, 'HUD 出「+100」用');
  assert.equal(v.spanMs, 60000);
  assert.equal(v.latest, 200);
  assert.equal(v.capped, false);
});

test('C3：滿咗上限 → capped（HUD 要講明「只係最近一段」）', () => {
  let h = [];
  for (let i = 0; i < 5; i += 1) h = pushSample(h, s(i, i), { max: 3 });
  assert.equal(historyView(h, { max: 3 }).capped, true);
  assert.equal(historyView([s(1, 1), s(2, 2)], { max: 3 }).capped, false);
});
