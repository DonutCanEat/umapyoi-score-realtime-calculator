/**
 * `src/hud/stamp.js` 嘅單元測試（**獨立審計 L1**）。
 *
 * 為何要：時間戳走樣嘅症狀係**檔名對唔上**（同一個快照嘅 `.log` 同 `.png` 差一秒
 * → 用戶／工具冇辦法配對），或者喺 Windows 寫出一個**唔合法嘅檔名**（`:`）。
 * 呢兩個都係「出事之後寫證據」嗰條路，壞咗最難查（因為佢本身就係唯一現場）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { safeIso, stampForFilename } from '../src/hud/stamp.js';

test('stampForFilename：固定時間 → 可預期嘅檔名（`:`／`.` 換成 `-`）', () => {
  assert.equal(stampForFilename(new Date('2026-09-19T10:24:41.123Z')), '2026-09-19T10-24-41-123Z');
});

test('safeIso：唔合法嘅 Date 唔准出 NaN／throw（寧願用「而家」）', () => {
  const out = safeIso(new Date('nope'));
  assert.doesNotMatch(out, /NaN/);
  assert.match(out, /^\d{4}-\d{2}-\d{2}T/);
});

test('stampForFilename：結果唔可以有 `:`／`.`（Windows 檔名保留字元）', () => {
  for (const at of [new Date('2026-09-19T10:24:41.123Z'), new Date('nope'), new Date(0)]) {
    const stamp = stampForFilename(at);
    assert.doesNotMatch(stamp, /[:.]/, `stamp=${stamp}`);
    assert.equal(stamp, stamp.trim(), '檔名唔可以有前後空白');
    assert.notEqual(stamp, '', '檔名唔可以係空字串');
  }
});

test('同一個 `now` 餵入去 → 快照 `.log` 同 `.png` 名字一致（唔准差一秒）', () => {
  const now = new Date('2026-09-19T23:59:59.999Z');
  const stamp = stampForFilename(now);
  const logName = `${stamp}-snapshot.log`;
  const pngName = `${stamp}-snapshot.png`;
  assert.equal(logName.replace(/\.log$/, ''), pngName.replace(/\.png$/, ''));

  // ⚠️ 反面教材：如果兩個檔名各自叫一次 `new Date()`，跨秒就會配對唔到。
  const a = stampForFilename(new Date('2026-09-19T10:24:41.999Z'));
  const b = stampForFilename(new Date('2026-09-19T10:24:42.001Z'));
  assert.notEqual(a, b, '兩個唔同時間一定要出唔同 stamp（工具靠 stamp 配對 .log／.png）');
});

test('safeIso：合法 Date 逐字等於 toISOString()（輸出格式唔准變）', () => {
  const at = new Date('2026-09-19T10:24:41.123Z');
  assert.equal(safeIso(at), at.toISOString());
});
