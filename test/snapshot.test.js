/**
 * `src/hud/snapshot.js` 嘅單元測試（「寫入診斷 log」掣用）。
 *
 * 為何要：呢個快照係用戶按掣之後、**出事嗰一刻**嘅唯一紀錄（打包版冇 console）。
 * 所以：① 格式要穩定（日後 grep 得到）；② **唔准 throw** —— 用戶按掣係想攞資料，
 * 唔係想再製造一個錯誤（循環引用／undefined／Error 物件都要頂得住）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SNAPSHOT_HEADER, describeValue, formatSnapshot } from '../src/hud/snapshot.js';

test('snapshot：第一行係可 grep 嘅標記 ＋ ISO 時間 ＋ 模式／版本', () => {
  const text = formatSnapshot({ kind: 'packaged', version: '0.1.0' }, [], new Date('2026-09-19T12:34:56.789Z'));
  const [first, second] = text.split('\n');
  assert.equal(first, `${SNAPSHOT_HEADER} 2026-09-19T12:34:56.789Z ===`);
  assert.match(second, /模式=packaged/);
  assert.match(second, /版本=0\.1\.0/);
  assert.ok(text.endsWith('\n'), '結尾要有換行（append 落檔嘅習慣）');
});

test('snapshot：section 同 row 嘅格式（標題一行、每行兩個空格縮排）', () => {
  const text = formatSnapshot({}, [
    { title: '基本', rows: [['版本', '0.1.0'], ['打包', true]] },
    { title: '擷取', rows: [['最後一幀', '3 秒前']] },
  ], new Date('2026-09-19T00:00:00.000Z'));
  assert.match(text, /\n\[基本\]\n  版本：0\.1\.0\n  打包：true\n/);
  assert.match(text, /\n\[擷取\]\n  最後一幀：3 秒前\n/);
  assert.ok(text.indexOf('[基本]') < text.indexOf('[擷取]'), 'section 要跟輸入次序');
});

test('snapshot：壞資料唔准 throw（undefined／物件／Error／循環引用／缺欄位）', () => {
  const circular = { a: 1 };
  circular.self = circular;
  assert.equal(describeValue(undefined), '（冇）');
  assert.equal(describeValue(null), 'null');
  assert.equal(describeValue(''), '（空字串）');
  assert.equal(describeValue(new Error('爆咗')), 'Error: 爆咗');
  assert.equal(describeValue({ x: 1 }), '{"x":1}');
  assert.equal(typeof describeValue(circular), 'string', '循環引用要退回字串，唔可以爆');
  assert.doesNotThrow(() => formatSnapshot(undefined, undefined, new Date('nope')));
  assert.doesNotThrow(() => formatSnapshot({}, [null, { title: 42 }, { title: 'ok', rows: [['只有一個'], 'x'] }]));
  // 時間唔合法 → 用「而家」，唔會出 Invalid Date
  assert.doesNotMatch(formatSnapshot({}, [], new Date('nope')), /Invalid Date/);
});
