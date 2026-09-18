/**
 * HUD 設定存檔層（`src/hud/config.js`）嘅單元測試。
 *
 * 為何要測：位置存錯／數值被靜默當 0，係「用戶自己調好嘅位」一夜之間走樣嘅成因，
 * 而且實機睇唔出係邊一步寫壞 → 全部規則（預設重用、throw、優先次序、round-trip）用測試守住。
 *
 * ⚠️ 測試一律用 `os.tmpdir()` 嘅臨時目錄，唔會寫到專案目錄（唔會整污糟 repo）。
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_HUD_CONFIG,
  DEFAULT_HUD_DISPLAY,
  HUD_CONFIG_FILENAME,
  HUD_DISPLAY_KEYS,
  defaultConfigPath,
  defaultHudConfig,
  loadConfig,
  resolveHudConfig,
  saveConfig,
  validateConfig,
} from '../src/hud/config.js';
import {
  DEFAULT_HUD_LAYOUT,
  DEFAULT_HUD_OFFSET,
  DEFAULT_HUD_SIZE,
  layoutFromEnv,
} from '../src/hud/layout.js';

const root = mkdtempSync(join(tmpdir(), 'umapyoi-hud-config-'));
after(() => rmSync(root, { recursive: true, force: true }));

/** 每次攞一個未用過嘅檔案路徑（避免測試互相影響）。 */
let seq = 0;
const freshPath = (name) => join(root, `${++seq}-${name}`);
const writeRaw = (path, text) => writeFileSync(path, text, 'utf8');

// ───────────────────────── 預設 ─────────────────────────

test('hud-config 預設：位置／大細全部重用 layout.js 嘅預設（唔可以自己打一次數字）', () => {
  assert.deepEqual(DEFAULT_HUD_CONFIG.layout.x, [...DEFAULT_HUD_LAYOUT.x]);
  assert.deepEqual(DEFAULT_HUD_CONFIG.layout.y, [...DEFAULT_HUD_LAYOUT.y]);
  assert.deepEqual(DEFAULT_HUD_CONFIG.layout.offset, { ...DEFAULT_HUD_OFFSET });
  assert.deepEqual(DEFAULT_HUD_CONFIG.layout.size, { ...DEFAULT_HUD_SIZE });
  // 同 layoutFromEnv({}) 完全同形 → 可以直接餵 anchorHud／hudState
  assert.deepEqual(DEFAULT_HUD_CONFIG.layout, layoutFromEnv({}));
});

test('hud-config 預設顯示選項：涵蓋 HUD 現有每一項（總分／逐格／五維分／技能分／金色格／note／edit）', () => {
  for (const key of ['total', 'stats', 'statScore', 'skillScore', 'goldMark', 'note', 'edit']) {
    assert.equal(DEFAULT_HUD_CONFIG.display[key], true, `${key} 要預設開（＝同今日 HUD 一樣）`);
  }
  // 唔可以有多／少 key（形狀要同 HUD 顯示項目一致）
  assert.deepEqual(Object.keys(DEFAULT_HUD_CONFIG.display).sort(), [...HUD_DISPLAY_KEYS].sort());
  assert.deepEqual(DEFAULT_HUD_CONFIG.display, { ...DEFAULT_HUD_DISPLAY });
});

test('hud-config 預設：改 defaultHudConfig() 出嚟嘅副本唔會污染常數', () => {
  const a = defaultHudConfig();
  a.layout.x[0] = 0.999;
  a.layout.size.w = 0.999;
  a.display.total = false;
  assert.deepEqual(DEFAULT_HUD_CONFIG.layout.x, [...DEFAULT_HUD_LAYOUT.x], '常數唔可以俾人改到');
  assert.equal(DEFAULT_HUD_CONFIG.display.total, true);
  assert.equal(defaultConfigPath('D').endsWith(HUD_CONFIG_FILENAME), true);
  assert.equal(HUD_CONFIG_FILENAME, 'hud-position.json');
});

// ───────────────────────── loadConfig ─────────────────────────

test('hud-config loadConfig：檔案唔存在 → 回預設（未存過檔係正常狀態）', () => {
  const path = freshPath('nope.json');
  assert.equal(existsSync(path), false);
  assert.deepEqual(loadConfig({ filePath: path }), defaultHudConfig());
});

test('hud-config loadConfig：壞 JSON → throw（唔准靜默回預設）', () => {
  const broken = freshPath('broken.json');
  writeRaw(broken, '{ "layout": { "x": [0.1, 0.2] '); // 少咗結尾
  assert.throws(() => loadConfig({ filePath: broken }), /唔係合法 JSON/);

  const empty = freshPath('empty.json');
  writeRaw(empty, '');
  assert.throws(() => loadConfig({ filePath: empty }), /唔係合法 JSON/);
});

test('hud-config loadConfig：欄位唔合法 → throw（唔准當 0、唔准回預設）', () => {
  const cases = [
    ['x 前後倒轉', { layout: { x: [0.9, 0.1] } }, /layout\.x/],
    ['y 前後一樣', { layout: { y: [0.5, 0.5] } }, /layout\.y/],
    ['x 超出 0–1', { layout: { x: [-0.1, 0.2] } }, /0–1/],
    ['x 唔夠兩個', { layout: { x: [0.1] } }, /兩個數字/],
    ['x 係字串（唔准靜默 coerce）', { layout: { x: ['0.1', 0.2] } }, /有限數字/],
    ['x 係 NaN', { layout: { x: [null, 0.2] } }, /有限數字/],
    ['size 0', { layout: { size: { w: 0, h: 0.2 } } }, /layout\.size\.w/],
    ['offset 太離譜', { layout: { offset: { dx: 5 } } }, /layout\.offset\.dx/],
    ['頂層打錯字（dispaly）', { dispaly: { total: false } }, /唔認識「dispaly」/],
    ['layout 打錯字（siz）', { layout: { siz: { w: 0.2, h: 0.2 } } }, /唔認識「siz」/],
    ['display 值唔係 boolean', { display: { total: 'yes' } }, /display\.total/],
    ['display 打錯字', { display: { skillScores: true } }, /唔認識「skillScores」/],
    ['layout 唔係物件', { layout: [0.1, 0.2] }, /layout 要係物件/],
    ['頂層係陣列', [1, 2], /要係一個物件/],
    ['頂層係 null', null, /要係一個物件/],
  ];
  for (const [name, body, re] of cases) {
    const path = freshPath('bad.json');
    writeRaw(path, JSON.stringify(body));
    assert.throws(() => loadConfig({ filePath: path }), re, `應該 throw：${name}`);
  }
});

test('hud-config loadConfig：分節／欄位可以只寫一部分，其餘補預設（唔算唔合法）', () => {
  const path = freshPath('partial.json');
  writeRaw(path, JSON.stringify({ layout: { x: [0.1, 0.2] }, display: { total: false } }));
  const cfg = loadConfig({ filePath: path });
  assert.deepEqual(cfg.layout.x, [0.1, 0.2]);
  assert.deepEqual(cfg.layout.y, [...DEFAULT_HUD_LAYOUT.y], '冇寫嘅欄位補預設');
  assert.deepEqual(cfg.layout.size, { ...DEFAULT_HUD_SIZE });
  assert.equal(cfg.display.total, false);
  assert.equal(cfg.display.skillScore, true, '冇寫嘅顯示項照預設開');
  assert.deepEqual(Object.keys(cfg.layout).sort(), ['offset', 'size', 'x', 'y'], '回嘅係完整形狀');
});

// ───────────────────────── validateConfig ─────────────────────────

test('hud-config validateConfig：回正規化新 object，唔會改到入嗰個', () => {
  const input = { layout: { x: [0.2, 0.4], offset: { dx: -0.01 } }, display: { stats: false } };
  const out = validateConfig(input);
  assert.deepEqual(out.layout.x, [0.2, 0.4]);
  assert.equal(out.layout.offset.dx, -0.01);
  assert.equal(out.layout.offset.dy, 0, '冇寫嘅補預設');
  assert.equal(out.display.stats, false);
  assert.equal(out.display.total, true);
  input.layout.x[0] = 0.9;
  input.display.stats = true;
  assert.deepEqual(out.layout.x, [0.2, 0.4], '回嘅係新 object（唔係 alias）');
  assert.equal(out.display.stats, false);
  // 空 object（＝乜都冇寫）一樣合法 → 等於預設
  assert.deepEqual(validateConfig({}), defaultHudConfig());
});

// ───────────────────────── 優先次序 ─────────────────────────

test('hud-config resolveHudConfig：環境變數 > config 檔 > 預設（逐欄位）', () => {
  const fileConfig = {
    layout: { x: [0.1, 0.2], y: [0.3, 0.4], offset: { dx: 0.01, dy: 0.02 }, size: { w: 0.3, h: 0.4 } },
    display: { total: false, goldMark: true },
  };

  // 冇 env → 檔案值勝過預設
  const fromFile = resolveHudConfig({}, fileConfig);
  assert.deepEqual(fromFile.layout.x, [0.1, 0.2]);
  assert.deepEqual(fromFile.layout.y, [0.3, 0.4]);
  assert.equal(fromFile.layout.size.w, 0.3);
  assert.equal(fromFile.display.total, false, 'display 冇 env 呢回事 → 跟檔案');

  // env 逐欄位蓋過檔案，冇 set 嘅欄位保持檔案值
  const mixed = resolveHudConfig(
    { UMAPYOI_HUD_X: '0.5,0.7', UMAPYOI_HUD_DX: '-0.05', UMAPYOI_HUD_W: '0.6' },
    fileConfig,
  );
  assert.deepEqual(mixed.layout.x, [0.5, 0.7], 'env 要蓋過檔案');
  assert.deepEqual(mixed.layout.y, [0.3, 0.4], '冇 set env 嘅欄位跟檔案');
  assert.equal(mixed.layout.offset.dx, -0.05);
  assert.equal(mixed.layout.offset.dy, 0.02, 'dx／dy 各自獨立');
  assert.equal(mixed.layout.size.w, 0.6);
  assert.equal(mixed.layout.size.h, 0.4);

  // 冇檔案 → 預設，env 照樣蓋過預設
  const noFile = resolveHudConfig({ UMAPYOI_HUD_Y: '0.8,0.9' }, null);
  assert.deepEqual(noFile.layout.y, [0.8, 0.9]);
  assert.deepEqual(noFile.layout.x, [...DEFAULT_HUD_LAYOUT.x]);
  assert.deepEqual(noFile.display, { ...DEFAULT_HUD_DISPLAY });
});

test('hud-config resolveHudConfig：env 打嘅值啱啱好等於預設都要蓋過檔案（唔准用「同預設比較」判斷有冇 set）', () => {
  const fileConfig = validateConfig({ layout: { x: [0.1, 0.2] } });
  const cfg = resolveHudConfig(
    { UMAPYOI_HUD_X: `${DEFAULT_HUD_LAYOUT.x[0]},${DEFAULT_HUD_LAYOUT.x[1]}` },
    fileConfig,
  );
  assert.deepEqual(cfg.layout.x, [...DEFAULT_HUD_LAYOUT.x], 'env 有 set 就算等於預設都要贏');
});

test('hud-config resolveHudConfig：env 唔合法／超範圍／檔案唔合法 → 一律 throw', () => {
  // 解析（重用 layoutFromEnv）本身已經會 throw
  assert.throws(() => resolveHudConfig({ UMAPYOI_HUD_X: 'abc' }, null), /UMAPYOI_HUD_X/);
  assert.throws(() => resolveHudConfig({ UMAPYOI_HUD_Y: '0.7' }, null), /UMAPYOI_HUD_Y/);
  // layoutFromEnv 只查「係唔係數字」，範圍由合併之後嘅 validate 守住
  assert.throws(() => resolveHudConfig({ UMAPYOI_HUD_X: '0.9,0.5' }, null), /前細後大/);
  assert.throws(() => resolveHudConfig({ UMAPYOI_HUD_X: '0.1,1.5' }, null), /0–1/);
  assert.throws(() => resolveHudConfig({ UMAPYOI_HUD_W: '0' }, null), /layout\.size\.w/);
  // 檔案唔合法都唔可以靜默當冇事
  assert.throws(() => resolveHudConfig({}, { layout: { x: [0.9, 0.1] } }), /前細後大/);
  // 回傳一定要係完整形狀
  assert.deepEqual(Object.keys(resolveHudConfig({}, null)).sort(), ['display', 'layout']);
});

// ───────────────────────── 存檔 round-trip ─────────────────────────

test('hud-config saveConfig → loadConfig：round-trip 一致（UTF-8 JSON、檔名 hud-position.json）', () => {
  const dir = freshPath('save-dir');
  const path = join(dir, HUD_CONFIG_FILENAME); // 連目錄都未存在 → saveConfig 要自己開
  const custom = {
    layout: { x: [0.11, 0.22], y: [0.33, 0.44], offset: { dx: -0.015, dy: 0.25 }, size: { w: 0.31, h: 0.41 } },
    display: { total: false, statScore: false },
  };

  const written = saveConfig(custom, { filePath: path });
  assert.equal(written, path, '要回實際寫入路徑');
  assert.equal(existsSync(path), true);

  const loaded = loadConfig({ filePath: path });
  assert.deepEqual(loaded, validateConfig(custom), '讀返嚟要同寫入嘅一模一樣');
  assert.deepEqual(loaded.layout.x, [0.11, 0.22]);
  assert.equal(loaded.display.total, false);
  assert.equal(loaded.display.goldMark, true, '冇寫嘅顯示項寫檔時會補預設');

  // 檔案要係人類睇得明嘅 UTF-8 JSON（有縮排＋尾隨換行）
  const text = readFileSync(path, 'utf8');
  assert.match(text, /\n {2}"layout": \{\n/);
  assert.match(text, /\n$/);

  // 寫檔再讀再寫 → 穩定（唔會愈寫愈走樣）
  saveConfig(loaded, { filePath: path });
  assert.deepEqual(loadConfig({ filePath: path }), loaded);
});

test('hud-config saveConfig：validate 唔過就 throw，而且**唔會**寫壞檔落去', () => {
  const path = freshPath('never-written.json');
  assert.throws(() => saveConfig({ layout: { x: [0.9, 0.1] } }, { filePath: path }), /前細後大/);
  assert.equal(existsSync(path), false, '⭐ 寧願寫唔到，都唔可以寫一個壞檔落去');

  // 已經有嘅檔唔可以被壞設定蓋爛
  saveConfig(defaultHudConfig(), { filePath: path });
  const good = readFileSync(path, 'utf8');
  assert.throws(() => saveConfig({ display: { nope: 1 } }, { filePath: path }), /唔認識「nope」/);
  assert.equal(readFileSync(path, 'utf8'), good, '舊檔要原封不動');
});
