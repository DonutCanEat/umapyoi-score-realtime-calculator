/**
 * `src/hud/log-file.js` 嘅單元測試。
 *
 * 為何要：log 檔係「出事之後唯一嘅現場」（打包版係 GUI 程式，`console.log` 冇地方去）。
 * 所以「格式」「輪替門檻」「路徑」都唔可以走樣 —— 而且**寫唔到都唔准令程式爆**。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  LOG_FILENAME,
  LOG_MAX_BYTES,
  formatLogLine,
  logFilePathFor,
  openLogFile,
  shouldRotate,
} from '../src/hud/log-file.js';

test('log-file：一行嘅格式係 ISO 時間 ＋ [level] ＋ 訊息 ＋ 換行', () => {
  const line = formatLogLine('warn', '[HUD] 唔見咗', new Date('2026-09-19T10:24:41.123Z'));
  assert.equal(line, '2026-09-19T10:24:41.123Z [warn] [HUD] 唔見咗\n');
  // 時間唔合法都唔准出 Invalid Date（寧願用「而家」）
  assert.match(formatLogLine('log', 'x', new Date('nope')), /^\d{4}-\d{2}-\d{2}T.*\[log\] x\n$/);
});

test('log-file：路徑係 join(root, umapyoi.log)，空 root 要 throw', () => {
  assert.equal(logFilePathFor('C:\\proj'), join('C:\\proj', LOG_FILENAME));
  assert.throws(() => logFilePathFor(''), /非空字串/);
  assert.throws(() => logFilePathFor(undefined), /非空字串/);
});

test('log-file：輪替門檻（到上限先輪替；唔合法嘅數值唔輪替）', () => {
  assert.equal(shouldRotate(0), false);
  assert.equal(shouldRotate(LOG_MAX_BYTES - 1), false);
  assert.equal(shouldRotate(LOG_MAX_BYTES), true);
  assert.equal(shouldRotate(NaN), false);
  assert.equal(shouldRotate(-5), false);
  assert.equal(shouldRotate(100, 100), true);
});

test('log-file：寫入真檔（append）＋ 到上限會輪替成 .1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'umapyoi-log-'));
  try {
    const file = join(dir, LOG_FILENAME);

    // ① 正常寫入：兩行都喺檔入面（append，唔會覆蓋）
    const first = openLogFile(file);
    first.write('log', '第一行');
    first.write('error', '第二行');
    assert.equal(first.rotated, false);
    const text = readFileSync(file, 'utf8');
    assert.match(text, /\[log\] 第一行/);
    assert.match(text, /\[error\] 第二行/);
    assert.equal(text.split('\n').filter(Boolean).length, 2);

    // ② 超過上限 → 開檔時就輪替（舊檔搬去 .1），新檔由零開始
    writeFileSync(file, 'x'.repeat(200), 'utf8');
    const second = openLogFile(file, { maxBytes: 100 });
    assert.equal(second.rotated, true, '到上限應該輪替');
    assert.equal(readFileSync(`${file}.1`, 'utf8'), 'x'.repeat(200), '舊內容要留住（做證據）');
    second.write('log', '輪替之後');
    assert.equal(readFileSync(file, 'utf8').includes('輪替之後'), true);
    assert.equal(readFileSync(file, 'utf8').includes('xxxx'), false, '新檔唔應該有舊內容');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('log-file：寫唔到都唔准爆（路徑唔存在 → write() 靜靜放棄）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'umapyoi-log-'));
  try {
    const sink = openLogFile(join(dir, '冇呢個目錄', LOG_FILENAME));
    assert.doesNotThrow(() => sink.write('log', '照寫'));
    assert.equal(existsSync(join(dir, '冇呢個目錄', LOG_FILENAME)), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
