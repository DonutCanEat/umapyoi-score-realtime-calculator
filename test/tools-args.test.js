/**
 * `tools/lib/args.js` 嘅單元測試（獨立審計 M6）。
 *
 * 為何要：呢個模組接手咗 30+ 個工具嘅參數讀法，最易錯嘅係**值參數**嗰個
 * `name.length + 3`（`--` 兩格 ＋ `=` 一格）。所以除咗基本例子，
 * 仲會**逐個長度**驗（1／2／5 個字嘅名），同以前嗰句手寫寫法逐個對比。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { bareFlags, flagValue, flagValues, hasFlag, positionalArgs, toolArgs } from '../tools/lib/args.js';

test('args：hasFlag 係嚴格比對（唔理 `=value` 嗰種）', () => {
  const argv = ['--verify', '--exclude=uma2', 'shots/x.png'];
  assert.equal(hasFlag(argv, 'verify'), true);
  assert.equal(hasFlag(argv, 'exclude'), false, '--exclude=uma2 唔算係裸旗標 --exclude');
  assert.equal(hasFlag(argv, 'nope'), false);
  // 以前嘅寫法逐字等價
  assert.equal(hasFlag(argv, 'verify'), argv.includes('--verify'));
});

test('args：flagValue 同以前 `slice(name.length + 3)` 逐個長度都一樣', () => {
  const names = ['a', 'gt', 'gray', 'exclude', 'profile'];
  const argv = names.map((n, i) => `--${n}=v${i}`);
  // ⚠️ 以前嘅手寫寫法（原封不動抄落嚟做對照）——就係要證明新舊一致
  const legacy = (list, name) => list.find((x) => x.startsWith(`--${name}=`))?.slice(name.length + 3);
  for (const [i, n] of names.entries()) {
    assert.equal(flagValue(argv, n), `v${i}`, `--${n}= 嘅值`);
    assert.equal(flagValue(argv, n), legacy(argv, n), `「${n}」新舊寫法要一樣`);
  }
  // 冇寫 → undefined（唔可以回 ''
  assert.equal(flagValue(argv, 'missing'), undefined);
  assert.equal(legacy(argv, 'missing'), undefined);
  // 空值一樣要讀得到（`--gt=` → ''）
  assert.equal(flagValue(['--gt='], 'gt'), '');
  // 值入面有 `=` 都要成段攞返
  assert.equal(flagValue(['--mask=a=1,b=2'], 'mask'), 'a=1,b=2');
  // 同名幾次 → 取第一個（同 `.find()` 一樣）
  assert.equal(flagValue(['--x=1', '--x=2'], 'x'), '1');
});

test('args：flagValues 攞曬重複嘅值（保持次序）', () => {
  const argv = ['--page=a.png', '--top=20', '--page=b.png'];
  assert.deepEqual(flagValues(argv, 'page'), ['a.png', 'b.png']);
  assert.deepEqual(flagValues(argv, 'nope'), []);
  assert.deepEqual(flagValues(['--x=1', '--x=1'], 'x'), ['1', '1'], '重複嘅值唔會去重');
});

test('args：positionalArgs 保持原本次序、唔會誤食值參數', () => {
  const argv = ['shots/a.png', '--lines', 'shots/b.png', '--gray=1,2,3,4'];
  assert.deepEqual(positionalArgs(argv), ['shots/a.png', 'shots/b.png']);
  assert.deepEqual(positionalArgs(['--all']), []);
  // 值參數嘅值**唔會**變成位置參數（同以前一樣：`--gt=x` 係一個 token）
  assert.deepEqual(positionalArgs(['--gt=data/x.json']), []);
});

test('args：bareFlags 只收冇 `=` 嘅旗標（而且保留 `--` 前綴）', () => {
  const set = bareFlags(['--json', '--grades=距離:S', 'shots/x.png']);
  assert.equal(set.has('--json'), true);
  assert.equal(set.has('--grades'), false, '有 = 嘅唔算裸旗標');
  assert.equal(set.has('--grades=距離:S'), false, '而且唔會用完整字串入 set');
  assert.equal(set.size, 1);
  // 同以前嘅寫法逐字等價
  const legacy = new Set(['--json', '--grades=距離:S', 'shots/x.png'].filter((a) => a.startsWith('--') && !a.includes('=')));
  assert.deepEqual([...set], [...legacy]);
});

test('args：toolArgs 只係 `process.argv.slice(2)`（唔偷偷讀全域）', () => {
  const before = process.argv.slice(2);
  assert.deepEqual(toolArgs(['--a']), ['--a'], '傳咗就用傳入嗰個');
  assert.deepEqual(toolArgs(), before, '唔傳就係當前 process 嘅參數尾段');
});
