/**
 * GameTora 數據路徑解析（`src/umascore/gametora-data.js`）嘅單元測試。
 *
 * 為何要測：呢條路徑係**反推**出嚟嘅（webpack 模組 50840），而且 hash 一轉舊 URL 就 404。
 * 所以「冇 hash 就唔准砌路徑」呢個防呆一定要有測試守住 —— 唔係就會靜默抓錯嘢／抓空氣。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { dataPath, hashOf, manifestPath, resolveDataUrl } from '../src/umascore/gametora-data.js';

test('manifestPath：砌得出 `/data/manifests/<game>.json`；冇 game → null', () => {
  assert.equal(manifestPath('umamusume'), '/data/manifests/umamusume.json');
  assert.equal(manifestPath(''), null);
  assert.equal(manifestPath(null), null);
});

test('hashOf：字串／數字都收；冇 key／空值／唔係 object → null', () => {
  assert.equal(hashOf({ skills: 'f4a1e02d' }, 'skills'), 'f4a1e02d');
  assert.equal(hashOf({ skills: 12345 }, 'skills'), '12345');
  assert.equal(hashOf({ skills: '' }, 'skills'), null);
  assert.equal(hashOf({ other: 'x' }, 'skills'), null);
  assert.equal(hashOf(null, 'skills'), null);
  assert.equal(hashOf('nope', 'skills'), null);
});

test('dataPath：砌得出 `/data/<game>/<key>.<hash>.json`；冇 hash → null（唔准砌空 hash）', () => {
  assert.equal(dataPath('umamusume', 'skills', 'f4a1e02d'), '/data/umamusume/skills.f4a1e02d.json');
  assert.equal(dataPath('umamusume', 'skills', null), null);
  assert.equal(dataPath('umamusume', '', 'abc'), null);
  assert.equal(dataPath('', 'skills', 'abc'), null);
});

test('resolveDataUrl：正常情況砌出完整 URL（base 尾斜線唔會搞出 //）', () => {
  const r = resolveDataUrl('https://gametora.com', 'umamusume', 'skills', { skills: 'f4a1e02d' });
  assert.equal(r.ok, true);
  assert.equal(r.url, 'https://gametora.com/data/umamusume/skills.f4a1e02d.json');
  const r2 = resolveDataUrl('https://gametora.com/', 'umamusume', 'skills', { skills: 'abc' });
  assert.equal(r2.url, 'https://gametora.com/data/umamusume/skills.abc.json');
});

test('resolveDataUrl：manifest 冇呢個 key → ok:false ＋ 講明有咩 key（唔准亂砌）', () => {
  const r = resolveDataUrl('https://gametora.com', 'umamusume', 'skills', { characters: 'x', supports: 'y' });
  assert.equal(r.ok, false);
  assert.equal(r.url, null);
  assert.match(r.reason, /skills/);
  assert.match(r.reason, /characters/);
});
