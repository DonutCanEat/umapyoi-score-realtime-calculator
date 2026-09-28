/**
 * 讀取結果 → 診斷分類（`src/vision/read-summary.js`）嘅單元測試。
 *
 * 為何要：設計審查 M1 —— `main.js` 以前用 `read.highlighted` 判「金色格跳過」，
 * 但 `highlighted` 嘅真正意思係「呢行係金色」（**失敗路徑一樣帶住佢**）→
 * 一行真失敗（格框切得唔準）會被當成預期之內：寫錯診斷快照、沉默 5s→10s、
 * **唔 dump 幀**（最需要證據嗰陣冇證據）。呢個檔釘住「金格失敗要當真失敗查」。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyRead, FAIL_QUIET_MS, NOT_BAR_QUIET_MS } from '../src/vision/read-summary.js';

test('read-summary：讀到數 → ok（`highlighted` 喺呢度先係「要標金格」）', () => {
  const plain = classifyRead({ stats: [226, 54, 139, 85, 102] });
  assert.equal(plain.ok, true);
  assert.equal(plain.kind, 'ok（讀到）');
  assert.equal(plain.goldRow, false);
  assert.equal(plain.shouldDump, false);

  const gold = classifyRead({ stats: [1489, 543, 655, 624, 628], highlighted: true });
  assert.equal(gold.kind, 'ok（讀到）');
  assert.equal(gold.goldRow, true, '金格成功讀到 → 只係標記，唔影響分類');
});

test('read-summary：換咗畫面（notBar）→ 唔 dump、log 稀疏（30s）', () => {
  const out = classifyRead({ stats: null, notBar: true, reason: '唔見面板條' });
  assert.equal(out.kind, 'notBar（唔見面板條）');
  assert.equal(out.quietMs, NOT_BAR_QUIET_MS);
  assert.equal(out.shouldDump, false, '換畫面係正常，唔應該洗版 dump');
  assert.equal(out.notBar, true);
  assert.equal(out.reason, '唔見面板條');
});

test('⭐ read-summary：金格＋失敗 → 一定要當「真失敗」（唔准「金色格跳過」）', () => {
  const out = classifyRead({
    stats: null, highlighted: true, reason: '第 1 個數值讀唔清（「?」）',
  });
  assert.equal(out.kind, 'fail（讀唔清）', '⛔ 唔准再出現「skip（金色格跳過）」');
  assert.equal(out.goldRow, true, '金格資訊要照記（快照／dump 用）');
  assert.equal(out.shouldDump, true, '⭐ 真失敗要 dump 幀 —— 呢個就係 M1 嘅核心');
  assert.equal(out.quietMs, FAIL_QUIET_MS, '沉默時間要跟真失敗（5s），唔係舊行為嘅 10s');
  assert.notEqual(out.quietMs, 10000);
});

test('read-summary：普通真失敗 → dump ＋ 5s', () => {
  const out = classifyRead({ stats: null, reason: '唔似面板條' });
  assert.equal(out.kind, 'fail（讀唔清）');
  assert.equal(out.shouldDump, true);
  assert.equal(out.quietMs, FAIL_QUIET_MS);
  assert.equal(out.goldRow, false);
});

test('read-summary：notBar ＋ 金格 → 仍然係 notBar（notBar 優先）', () => {
  const out = classifyRead({ stats: null, notBar: true, highlighted: true, reason: '唔似面板條' });
  assert.equal(out.kind, 'notBar（唔見面板條）');
  assert.equal(out.shouldDump, false);
  assert.equal(out.goldRow, true);
});

test('read-summary：未讀過（null）→ unknown，唔准當成功', () => {
  const out = classifyRead(null);
  assert.equal(out.ok, false);
  assert.match(out.kind, /unknown/);
  assert.equal(out.shouldDump, false);
});

test('read-summary：`reason` 缺席唔准出 undefined（快照會寫落檔案）', () => {
  for (const read of [{ stats: null }, { stats: null, notBar: true }, null]) {
    const out = classifyRead(read);
    assert.equal(typeof out.reason, 'string');
    assert.equal(out.reason.includes('undefined'), false);
  }
});
