/**
 * `src/hud/startup-resource.js` 嘅測試（設計審查 2026-09-28 M6）。
 *
 * ## 為何要測
 *
 * 呢個模組嘅**唯一用途**係「啟動資源唔妥嗰陣唔好靜默」—— 佢自己靜默咗就完全冇意義。
 * 所以四個失敗模式（唔見／檢查唔到／讀唔到／壞 JSON／結構唔對）**全部**要有測試，
 * 而且要**釘住 `electron/main.js` 真係用咗呢套政策**（唔准改返轉頭做靜默僵屍）。
 *
 * ⚠️ 呢個檔**唔會開 Electron**（沙盒開唔到）→ 用**接線閘**（讀 `main.js` 原始碼）釘住行為；
 *    真 Electron 行為由用戶端 `node_modules\.bin\electron.cmd tools\verify-renderer-load.js` 驗。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  GLYPH_DIGITS,
  STARTUP_EXIT_CODE,
  checkGlyphTemplates,
  loadRequiredJson,
  startupFailureReport,
} from '../src/hud/startup-resource.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MAIN_JS = readFileSync(join(ROOT, 'electron', 'main.js'), 'utf8');
const TEMPLATE_PATH = 'C:\\proj\\data\\glyph-templates.json';
const HINT = '跑 `node tools/build-glyph-templates.js` 重新產生字形模板';

/** 砌一個假 I/O（全部真實檔案都唔會碰）。 */
function fakeIo({ present = true, text = '{"templates":{}}', failExists = null, failRead = null } = {}) {
  return {
    exists: () => {
      if (failExists) throw new Error(failExists);
      return present;
    },
    readText: () => {
      if (failRead) throw new Error(failRead);
      return text;
    },
  };
}

test('loadRequiredJson：唔見檔 → code=missing，訊息含實際路徑，唔會 throw', () => {
  const r = loadRequiredJson({ path: TEMPLATE_PATH, hint: HINT, ...fakeIo({ present: false }) });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'missing');
  assert.match(r.error.message, /搵唔到/);
  assert.ok(r.error.message.includes(TEMPLATE_PATH), '訊息要含實際路徑（用戶要直接去搵）');
  assert.equal(r.error.hint, HINT);
});

test('loadRequiredJson：連「檢查存唔存在」都爆 → 當資源問題（唔准 throw 出去）', () => {
  const r = loadRequiredJson({
    path: TEMPLATE_PATH,
    hint: HINT,
    ...fakeIo({ failExists: 'EPERM: operation not permitted' }),
  });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'unreadable');
  assert.match(r.error.message, /EPERM/);
});

test('loadRequiredJson：讀唔到（權限／壞檔）→ code=unreadable ＋ 保留原始錯誤訊息', () => {
  const r = loadRequiredJson({
    path: TEMPLATE_PATH,
    hint: HINT,
    ...fakeIo({ failRead: 'EACCES: permission denied' }),
  });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'unreadable');
  assert.match(r.error.message, /EACCES/);
  assert.equal(r.error.hint, HINT);
});

test('loadRequiredJson：壞 JSON → code=invalid（唔准靜默當冇事繼續開）', () => {
  const r = loadRequiredJson({ path: TEMPLATE_PATH, hint: HINT, ...fakeIo({ text: '{ "templates": ' }) });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'invalid');
  assert.match(r.error.message, /唔係合法 JSON/);
  assert.match(r.error.message, /唔可以當冇事繼續開/);
});

test('loadRequiredJson：正常 → 回已解析嘅值（parse 收到原文）', () => {
  let seen = null;
  const r = loadRequiredJson({
    path: TEMPLATE_PATH,
    hint: HINT,
    ...fakeIo({ text: '{"templates":{"0":[1]}}' }),
    parse: (t) => {
      seen = t;
      return JSON.parse(t);
    },
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { templates: { 0: [1] } });
  assert.equal(seen, '{"templates":{"0":[1]}}');
});

test('checkGlyphTemplates：冇 templates 物件／係陣列 → 致命 no-templates', () => {
  for (const json of [{}, { templates: null }, { templates: [] }, null]) {
    const r = checkGlyphTemplates(json, { path: TEMPLATE_PATH });
    assert.equal(r.ok, false, `${JSON.stringify(json)} 應該係致命`);
    assert.equal(r.error.code, 'no-templates');
    assert.match(r.error.message, /唔似字形模板/);
  }
});

test('checkGlyphTemplates：templates 係空物件 → 致命 empty-templates（0 個字形＝靜默僵屍）', () => {
  const r = checkGlyphTemplates({ templates: {} }, { path: TEMPLATE_PATH });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'empty-templates');
  assert.match(r.error.message, /0 個字形/);
});

test('checkGlyphTemplates：缺字元 → 唔致命但一定要警告（唔准靜默降級）', () => {
  const r = checkGlyphTemplates({ templates: { 0: [1], 1: [1], 2: [1] } }, { path: TEMPLATE_PATH });
  assert.equal(r.ok, true);
  assert.match(r.warning, /缺少 3/);
  assert.match(r.warning, /讀唔到/);
});

test('checkGlyphTemplates：齊 0–9 → 冇警告（正式檔實測就係咁）', () => {
  const templates = Object.fromEntries([...GLYPH_DIGITS].map((d) => [d, [1]]));
  const r = checkGlyphTemplates({ templates });
  assert.equal(r.ok, true);
  assert.equal(r.warning, undefined);
  // 真實檔案亦要過（防止將來 build 工具改咗 key 而冇人知）
  const real = JSON.parse(readFileSync(join(ROOT, 'data', 'glyph-templates.json'), 'utf8'));
  assert.deepEqual(checkGlyphTemplates(real).ok, true);
  assert.equal(Object.keys(real.templates).sort().join(''), [...GLYPH_DIGITS].sort().join(''));
});

test('startupFailureReport：訊息＋提示＋log 路徑一份過（對話框同 log 講同一件事）', () => {
  const error = { code: 'missing', path: TEMPLATE_PATH, message: `搵唔到 ${TEMPLATE_PATH}`, hint: HINT };
  const r = startupFailureReport({ error, logPath: 'C:\\proj\\umapyoi.log' });
  assert.equal(r.title, 'Umapyoi 開唔到');
  assert.ok(r.detail.includes(TEMPLATE_PATH));
  assert.ok(r.detail.includes(HINT));
  assert.ok(r.detail.includes('C:\\proj\\umapyoi.log'));
});

test('startupFailureReport：冇 log 路徑都要講明（唔准靜默留白）', () => {
  const r = startupFailureReport({ error: { message: 'x', hint: 'y' } });
  assert.match(r.detail, /未開到 log 檔/);
});

test('接線閘：electron/main.js 真係行呢套政策（模板唔見／壞唔准再靜默）', () => {
  assert.equal(STARTUP_EXIT_CODE, 1);
  for (const needle of ['loadRequiredJson', 'checkGlyphTemplates', 'fatalStartup', 'startupFailureReport']) {
    assert.ok(MAIN_JS.includes(needle), `main.js 應該用 ${needle}()`);
  }
  assert.ok(MAIN_JS.includes('dialog.showErrorBox('), '要用系統對話框（打包版用戶先睇得到原因）');
  assert.ok(MAIN_JS.includes('app.exit(STARTUP_EXIT_CODE)'), '要用同一個 exit code 收工');
  assert.ok(MAIN_JS.includes('showErrorBox(report.title, report.detail)'), '對話框要用同一份報告文字');
});

test('接線閘：舊嘅靜默做法唔准返轉頭（實測嗰兩個就係 M6 嘅根因）', () => {
  assert.ok(
    !MAIN_JS.includes('templates = {}'),
    '唔准再有「模板唔見就當空模板繼續開」嘅 fallback（HUD 會永遠等面板條）',
  );
  assert.ok(
    !MAIN_JS.includes('JSON.parse(readFileSync(TEMPLATE_PATH'),
    '唔准喺 module scope 直接 parse（import 期 throw ＝ GUI 版連 stack 都睇唔到）',
  );
  assert.ok(
    !MAIN_JS.includes('[模板] ⚠️ 搵唔到'),
    '舊嗰句「搵唔到模板」警告要換成致命錯誤（否則又變靜默僵屍）',
  );
});
