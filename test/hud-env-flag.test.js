/**
 * `envFlag()`（`src/hud/env-flag.js`）嘅單元測試。
 *
 * 為何要測（呢個函數之前係「零覆蓋靜默位」）：佢係三個開關旗標
 * （`UMAPYOI_NO_HUD`／`UMAPYOI_NO_SETTINGS`／`UMAPYOI_HUD_EDIT`）嘅**唯一**真相來源，
 * 但一直住喺 `electron/main.js`（import 咗 `electron` → 入唔到 `node --test`）
 * → 行為正確（上一個 worker 手動核對 21/21）但**冇任何自動閘**。
 *
 * 讀錯一邊嘅後果（AGENTS §6.4 底線）：
 *   - `UMAPYOI_NO_HUD`／`UMAPYOI_NO_SETTINGS` 讀反 → 開多／開少一個窗
 *   - `UMAPYOI_HUD_EDIT` 讀反 → HUD 唔穿透（**用戶點唔到遊戲**）或者對位模式唔開
 * 所以下面**逐個值**綁死行為（21 個），而且警告要**真係收集得到**
 * （唔准 intercept `console`：咁樣會令測試同真實警告鏈路脫節）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ENV_FLAG_OFF, ENV_FLAG_ON, envFlag, envIsSet, envNumber } from '../src/hud/env-flag.js';

const NAME = 'UMAPYOI_TEST_FLAG';

/** 行一次 `envFlag()`，收集警告（唔靠 intercept `console`）。 */
function run(raw, { unset = false } = {}) {
  const warnings = [];
  const env = unset ? {} : { [NAME]: raw };
  const value = envFlag(NAME, env, (message) => warnings.push(message));
  return { value, warnings };
}

/** 斷言：某個原始值 → 開／閂，而且警告符合預期。 */
function assertFlag(raw, expected, { warns = false } = {}) {
  const { value, warnings } = run(raw);
  const label = `${NAME}＝「${raw}」（${typeof raw}）`;
  assert.equal(value, expected, `${label} 應該係 ${expected ? '開' : '閂'}`);
  if (warns) {
    assert.equal(warnings.length, 1, `${label} 一定要大聲警告（唔准靜默）：${warnings.join('｜')}`);
    assert.ok(warnings[0].includes(NAME), `警告要講得出變數名：${warnings[0]}`);
    assert.ok(warnings[0].includes(String(raw)), `警告要講得出個值：${warnings[0]}`);
    assert.ok(warnings[0].includes('唔認識'), `警告要講明「唔認識」：${warnings[0]}`);
  } else {
    assert.deepEqual(warnings, [], `${label} 唔應該有警告：${warnings.join('｜')}`);
  }
}

// ───────────────────── 開（7 個值）─────────────────────

test('envFlag：只有 1／true（大小寫唔敏感、前後空白忽略）＝ 開', () => {
  for (const raw of ['1', 'true', 'TRUE', 'True', ' true ', 'TrUe', ' 1 ']) {
    assertFlag(raw, true);
  }
  assert.deepEqual([...ENV_FLAG_ON], ['1', 'true'], '「開」嘅值清單要係 1／true');
});

// ───────────────────── 閂（7 個值，冇警告）─────────────────────

test('envFlag：0／false（連大小寫變體）／空字串／冇 set ／undefined／null ＝ 閂，而且唔嘈', () => {
  // ⭐ 呢個就係原本嘅 bug：`UMAPYOI_NO_HUD=0` 以前係 truthy → 竟然**閂咗 HUD**。
  for (const raw of ['0', 'false', 'FALSE', '']) {
    assertFlag(raw, false);
  }
  // 冇 set（`process.env` 冇呢個 key）／刻意 `undefined`／`null` → 一樣係閂，唔警告。
  assertFlag(undefined, false);
  assertFlag(null, false);
  assert.deepEqual(run(undefined, { unset: true }).warnings, [], '冇 set 唔應該有警告');
  assert.equal(run(undefined, { unset: true }).value, false, '冇 set ＝ 閂');
  assert.deepEqual([...ENV_FLAG_OFF], ['0', 'false', ''], '「閂而唔嘈」嘅值清單要係 0／false／空字串');
});

// ───────────────────── 唔認識（7 個值）→ 閂 ＋ 警告 ─────────────────────

test('envFlag：唔認識嘅值（yes／on／2／no／off／tru／-1）＝ 閂，而且一定要大聲警告', () => {
  for (const raw of ['yes', 'on', '2', 'no', 'off', 'tru', '-1']) {
    assertFlag(raw, false, { warns: true });
  }
});

test('envFlag：唔認識嘅值一定要嘈（唔准靜默當開或者當閂）—— 連大小寫變體都係', () => {
  for (const raw of ['YES', 'On', 'tru ', '1.0', '01']) {
    assertFlag(raw, false, { warns: true });
  }
  // ⚠️ 順帶綁住大小寫唔敏感嗰個方向（唔好誤以為 `TRue` 係「唔認識」）：
  assertFlag('TRue', true);
  assertFlag('tRuE', true);
});

test('envFlag：純空白（`\'  \'`）嘅處理同「空字串」一致（唔嘈）—— 呢個係**刻意**嘅決定', () => {
  // ⚠️ 老實記錄：`'  '` `trim()` 之後就係 `''`，而 `''` 係「用戶刻意 set 空」＝明確閂
  //    → 所以**唔會**警告（同「唔認識嘅值要 warn」唔衝突：呢個值最後就係空）。
  //    （任務允許「順手令純空白都有警告」，但實作係先 `trim()` 再判斷 → 保持同 `''` 一致，
  //      唔會令行為分叉；呢條測試就係把嗰個決定綁死。）
  const blank = run('  ');
  assert.equal(blank.value, false, '純空白 ＝ 閂');
  assert.deepEqual(blank.warnings, [], '純空白同空字串一致 → 唔嘈');
  assert.equal(run('').value, false);
  assert.deepEqual(run('').warnings, []);
});

// ───────────────────── 21/21 對照表（回歸）─────────────────────

test('envFlag：21 個值嘅行為一次性綁死（1/true 系 7 個開、7 個閂、7 個唔認識）', () => {
  const table = [
    // 開（7）
    ['1', true], ['true', true], ['TRUE', true], ['True', true], [' true ', true], ['TrUe', true], [' 1 ', true],
    // 閂（7，冇警告）
    ['0', false], ['false', false], ['FALSE', false], ['', false],
    [undefined, false], [null, false], ['0 ', false],
    // 唔認識（7，要警告）
    ['yes', false], ['on', false], ['2', false], ['no', false], ['off', false], ['tru', false], ['-1', false],
  ];
  assert.equal(table.length, 21, '呢張表要啱啱好 21 行（同審計核對嗰 21 個值一致）');
  const openSet = new Set(['1', 'true', 'TRUE', 'True', ' true ', 'TrUe', ' 1 ']);
  for (const [raw, expected] of table) {
    const { value, warnings } = run(raw);
    const label = `${NAME}＝${JSON.stringify(raw)}`;
    assert.equal(value, expected, `${label} 應該係 ${expected}`);
    if (openSet.has(raw) || value === false) {
      // 「唔認識」嘅 7 個一定要有警告；其餘（開／明確閂）唔准有。
      const unknown = ['yes', 'on', '2', 'no', 'off', 'tru', '-1'].includes(raw);
      assert.equal(warnings.length, unknown ? 1 : 0, `${label} 警告數目唔啱：${warnings.join('｜')}`);
    }
  }
});

// ───────────────────── 其他契約 ─────────────────────

test('envFlag：預設 env ＝ process.env、預設 onWarn ＝ console.warn（漏傳都唔會靜默）', () => {
  const name = 'UMAPYOI_ENV_FLAG_TEST_TMP';
  const before = process.env[name];
  try {
    process.env[name] = '1';
    assert.equal(envFlag(name), true, '唔傳 env 要用 process.env');
    process.env[name] = 'TRUE';
    assert.equal(envFlag(name), true);
    process.env[name] = '0';
    assert.equal(envFlag(name), false);
    delete process.env[name];
    assert.equal(envFlag(name), false, 'process.env 冇呢個 key ＝ 閂');
    // ⚠️ 唔認識嘅值而唔傳 `onWarn` → 一定要用 `console.warn`（唔准靜默）。
    //    呢度**刻意**暫時換走 `console.warn`（唯一一處 intercept）：證明預設真係佢。
    const calls = [];
    const original = console.warn;
    console.warn = (message) => calls.push(message);
    try {
      process.env[name] = 'yes';
      assert.equal(envFlag(name), false);
    } finally {
      console.warn = original;
    }
    assert.equal(calls.length, 1, '預設 onWarn 一定要係 console.warn');
    assert.ok(calls[0].includes('唔認識'), `預設警告內容要一致：${calls[0]}`);
  } finally {
    if (before === undefined) delete process.env[name];
    else process.env[name] = before;
  }
});

test('envFlag：傳一個怪嘅 env（null）都唔會爆（當冇 set）', () => {
  assert.equal(envFlag(NAME, null, () => {}), false);
  assert.equal(envFlag(NAME, undefined, () => {}), false);
});

// ─────────────── envIsSet（「有冇 set」嘅唯一判斷，審計 M1）───────────────
//
// 為何要：同一個判斷以前散落兩處（`electron/main.js` 砌 `hudEnvOverridden`、
// `config.js` 合併 env > 檔案 > 預設嘅 `set()`）→ 走樣就會出現
// 「明明冇 set 但當 set 咗」嘅靜默行為（例如明明用緊預設，卻同用戶講「env 會蓋過你」）。

test('envIsSet：undefined／null／空字串／純空白 = 冇 set；其餘（連 "0"）都算 set', () => {
  const cases = [
    [undefined, false], [null, false], ['', false], ['   ', false],
    ['0', true], ['false', true], ['1', true], ['0.3', true], [' 0.3 ', true], ['yes', true],
  ];
  for (const [raw, expected] of cases) {
    assert.equal(envIsSet(NAME, { [NAME]: raw }), expected, `「${raw}」應該係 ${expected ? 'set 咗' : '冇 set'}`);
  }
  // 冇 set（key 完全唔存在）＋ 怪 env 都唔准爆
  assert.equal(envIsSet(NAME, {}), false);
  assert.equal(envIsSet(NAME, null), false);
  assert.equal(envIsSet(NAME, undefined), false);
  // 預設 env = process.env（同 envFlag 一致）
  const before = process.env[NAME];
  try {
    process.env[NAME] = '0.42';
    assert.equal(envIsSet(NAME), true, '預設要讀 process.env');
    delete process.env[NAME];
    assert.equal(envIsSet(NAME), false);
  } finally {
    if (before === undefined) delete process.env[NAME];
    else process.env[NAME] = before;
  }
});

// ─────────────── envNumber（數字旋鈕，審計 M1）───────────────
//
// 為何要：`UMAPYOI_DUMP_FRAMES`／`_SKILL_MAX`／`_CAPTURE_FPS` 以前係
// `Number(process.env.X || fallback) || fallback` —— 即係「唔係數字就靜默用 fallback」，
// 用戶打錯 `UMAPYOI_SKILL_MAX=4oo` 完全冇提示。而家一樣回 fallback，但**一定要嘈**。

/** 行一次 `envNumber()`，收集警告（唔靠 intercept `console`）。 */
function runNumber(raw, options = {}) {
  const warnings = [];
  const env = 'unset' in options ? {} : { [NAME]: raw };
  const { unset, ...rest } = options;
  const value = envNumber(NAME, { env, onWarn: (m) => warnings.push(m), ...rest });
  return { value, warnings };
}

test('envNumber：冇 set → 回 fallback 而且唔警告（冇 set 係正常狀態）', () => {
  const { value, warnings } = runNumber(undefined, { unset: true, fallback: 7 });
  assert.equal(value, 7);
  assert.deepEqual(warnings, [], '冇 set 唔應該嘈');
  // 空字串／純空白一樣當冇 set（同 envIsSet 一致）
  assert.equal(runNumber('', { fallback: 400 }).value, 400);
  assert.equal(runNumber('  ', { fallback: 400 }).value, 400);
  assert.deepEqual(runNumber(' ', { fallback: 400 }).warnings, []);
});

test('envNumber：合法數字照收（連前後空白／小數／負數）', () => {
  assert.equal(runNumber('5').value, 5);
  assert.equal(runNumber('5', { fallback: 9 }).value, 5);
  assert.equal(runNumber(' 12 ').value, 12);
  assert.equal(runNumber('2.5').value, 2.5);
  assert.equal(runNumber('0').value, 0);
  assert.equal(runNumber('-3').value, -3);
  for (const raw of ['5', ' 12 ', '2.5']) {
    assert.deepEqual(runNumber(raw).warnings, [], `「${raw}」係正常值，唔應該嘈`);
  }
});

test('envNumber：唔係有限數字 → 回 fallback ＋ 一定要大聲警告（唔准靜默）', () => {
  // ⚠️ 唔可以用 `Number(raw)` 之外嘅「自己解析」：`envNumber()` 嘅契約就係
  //    「同 `Number()` 一致」（所以 `'0x10'`、`'1e3'` 呢類係**合法**嘅，
  //    下面嘅「唔合法」只用真正 `NaN`／`Infinity` 嘅寫法）。
  for (const raw of ['abc', '4oo', '1,5', 'NaN', 'Infinity', '1 2']) {
    const { value, warnings } = runNumber(raw, { fallback: 400 });
    assert.equal(value, 400, `「${raw}」應該回 fallback`);
    assert.equal(warnings.length, 1, `「${raw}」一定要警告：${warnings.join('｜')}`);
    assert.ok(warnings[0].includes(NAME), `警告要講得出變數名：${warnings[0]}`);
    assert.ok(warnings[0].includes(String(raw)), `警告要講得出個值：${warnings[0]}`);
    assert.ok(warnings[0].includes('400'), `警告要講得出 fallback：${warnings[0]}`);
  }
  // 同 `Number()` 一致嘅「睇落怪但合法」寫法：照收，唔嘈
  assert.equal(runNumber('0x10').value, 16);
  assert.equal(runNumber('1e3').value, 1000);
  assert.deepEqual(runNumber('0x10').warnings, []);
});

test('envNumber：positive: true 時 0／負數 → 回 fallback ＋ 警告（以前會被 || 靜默當 fallback）', () => {
  // ⭐ 呢條就係原本 `Number(x || 400) || 400` 嘅行為（`'0'` → 400），
  //    只係而家會嘈一句 —— 唔准靜默改咗用戶寫嘅嘢。
  for (const raw of ['0', '-1', '0.0']) {
    const { value, warnings } = runNumber(raw, { fallback: 400, positive: true });
    assert.equal(value, 400, `「${raw}」應該回 fallback（同舊行為一致）`);
    assert.equal(warnings.length, 1, `「${raw}」要警告`);
    assert.ok(warnings[0].includes('正數'), warnings[0]);
  }
  // 唔傳 positive 就照收 0（語意明確：唔係每個旋鈕都要求正數）
  assert.equal(runNumber('0', { fallback: 400 }).value, 0);
});

test('envNumber：預設 fallback 係 0、預設 onWarn 係 console.warn、怪 env 唔會爆', () => {
  assert.equal(envNumber(NAME, { env: {} }), 0, '預設 fallback = 0');
  assert.equal(envNumber(NAME, { env: null }), 0);
  const before = process.env[NAME];
  const calls = [];
  const original = console.warn;
  console.warn = (message) => calls.push(message);
  try {
    process.env[NAME] = '唔係數字';
    assert.equal(envNumber(NAME), 0, '預設 env = process.env');
  } finally {
    console.warn = original;
    if (before === undefined) delete process.env[NAME];
    else process.env[NAME] = before;
  }
  assert.equal(calls.length, 1, '預設 onWarn 一定要係 console.warn（唔准靜默）');
});
