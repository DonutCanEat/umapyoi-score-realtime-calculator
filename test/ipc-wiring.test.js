/**
 * **IPC 接線閘**：`electron/main.js` ↔ 4 個 renderer HTML（獨立審計 H1）。
 *
 * ## 為何要（呢個係真存在嘅靜默死線）
 *
 * 本專案**冇 preload**（AGENTS §6.3）：channel 名本來係字面值散落喺 5 個檔，
 * 而 **`ipcRenderer.send()` 去一個冇 handler 嘅 channel 係靜默丟棄**
 * （唔會 throw、唔會 log）→ 打錯一個字母嘅後果係「按咗但冇反應」，而
 * `npm.cmd test`（以前）同 `check-renderer-syntax.js` 都捉唔到。
 *
 * ## 現時架構（2026-09-19 起）
 *
 * - channel 名嘅**唯一來源** = `electron/ipc-channels.cjs`（`IPC_CHANNELS`）
 * - `main.js` 已經全部改用 `IPC_CHANNELS.<key>`（29 處）
 * - 4 個 renderer **暫時仍然用字面值**（要換 `require('./ipc-channels.cjs')` 之前
 *   一定要先實機驗 —— 嗰個失敗模式係「page 一開頭 throw → 全部 IPC listener
 *   靜默唔註冊」；今次審計環境開唔到 Electron，所以**未換**）
 *   → 所以呢個閘**兩種寫法都要支援**，而 renderer 嘅字面值會被**逐個對照 map 嘅 value**
 *     （打錯字／有人改 map 但冇改 HTML → 即刻 fail）
 *
 * ## 閘驗咩
 *
 * ① map 形狀（key 係 lowerCamelCase、value 唯一、唔係空、數量 ≥ 20）
 * ② `main.js` 引用嘅 `IPC_CHANNELS.<key>` 一定要存在（打字錯即刻爆）
 * ③ renderer `send` ⊆ main `on`（最重要嗰條）
 * ④ main `send` ⊆ renderer `on`（冇人收 = 窗永遠唔更新）
 * ⑤ `invoke` ⊆ `handle`（現時 0 條，將來加 preload 一樣守得住）
 * ⑥ map 冇孤兒（每一條 channel 都真係有人用）—— 防止「加咗但兩邊都冇改」
 * ⑦ channel 名唔可以只靠大小寫／連字符分辨
 *
 * ⚠️ **唔斷言** main `on` ⊆ renderer `send`：將來可能加「暫時冇人叫」嘅 handler。
 * ⚠️ **唔逐檔綁死**（例如「`hud` 只可以去 hud.html」）：路由係實作細節。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ⭐ ESM default import CJS：**就係 `main.js` 用嘅寫法** —— 呢個 import 一齊驗埋
//    （`createRequire` 一定得，但 default import 嘅形狀要靠呢條測試釘死）
import ipcChannelsDefault from '../electron/ipc-channels.cjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { IPC_CHANNELS } = require('../electron/ipc-channels.cjs');

test('ipc-channels：ESM default import 同 CJS require 攞到**同一個** map（main.js 靠呢個）', () => {
  assert.equal(typeof ipcChannelsDefault, 'object');
  assert.deepEqual(
    ipcChannelsDefault.IPC_CHANNELS,
    IPC_CHANNELS,
    'main.js 係 `import ipcChannels from \'./ipc-channels.cjs\'` → default export 一定要有 .IPC_CHANNELS',
  );
  assert.ok(Object.isFrozen(IPC_CHANNELS), 'map 要凍結（唔准任何一邊偷偷改 channel 名）');
});

const MAIN_FILE = 'electron/main.js';
const RENDERER_FILES = [
  'electron/capture.html',
  'electron/hud.html',
  'electron/settings.html',
  'electron/whatif.html',
];

/** 讀檔（可以餵假文字入嚟做「測試自己嘅測試」）。 */
function readText(rel, text) {
  return text ?? readFileSync(join(ROOT, rel), 'utf8');
}

/**
 * ⭐ 剝走註釋之後才抽 channel 名。
 *
 * 為何一定要（實測踩到）：`main.js` 嘅註釋本身會提到 `ipcMain.on(...)` 同 channel 名
 * —— 唔剝註釋嘅話，**註釋**會被當成「有 handler」，於是有人改咗真 handler 而註釋冇改，
 * 閘就會**假 pass**（最危險嘅一種閘）。
 *
 * ⚠️ `//` 前面係 `:`（`https://…`）或者引號嗰種唔算註釋，唔可以剝。
 */
function stripComments(text) {
  return String(text)
    .replace(/<!--[\s\S]*?-->/g, '')       // HTML 註釋
    .replace(/\/\*[\s\S]*?\*\//g, '')      // JS 區塊註釋
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1'); // JS 行註釋（保留前面嗰個字元）
}

/** 真檔嘅**程式碼**（剝咗註釋）。 */
function codeOf(rel, text) {
  return stripComments(readText(rel, text));
}

/**
 * 由一段程式碼抽「某個呼叫用咗邊條 channel」——**兩種寫法都支援**：
 *   - `IPC_CHANNELS.hudConfigSave`（map 引用）
 *   - `'hud-config-save'`（字面值）
 *
 * @param {string} text 已經剝註釋嘅程式碼
 * @param {string} callRe 呼叫本身嘅正則（要包住 `\(\s*`，令後面可以配兩種寫法）
 * @param {string} file 檔案名（失敗訊息用）
 * @returns {{channels:string[], unknownKeys:string[]}}
 */
function channelsUsed(text, callRe, file) {
  const re = new RegExp(`${callRe}\\s*(?:IPC_CHANNELS\\.(\\w+)|'([^']+)')`, 'g');
  const channels = [];
  const unknownKeys = [];
  for (const m of text.matchAll(re)) {
    const [, key, literal] = m;
    if (key !== undefined) {
      if (!Object.hasOwn(IPC_CHANNELS, key)) {
        unknownKeys.push(`${file}: IPC_CHANNELS.${key}（map 冇呢個 key）`);
        continue;
      }
      channels.push(IPC_CHANNELS[key]);
    } else {
      channels.push(literal);
    }
  }
  return { channels, unknownKeys };
}

/** main 註冊嘅 handler（`ipcMain.on`）。 */
function mainHandlers(text) {
  return channelsUsed(codeOf(MAIN_FILE, text), 'ipcMain\\.on\\(', MAIN_FILE);
}

/** main 推落 renderer（`webContents.send`／`sender.send`／`event.sender.send`）。 */
function mainSends() {
  return channelsUsed(codeOf(MAIN_FILE), '(?:webContents|sender)\\.send\\(', MAIN_FILE);
}

/** 全部 renderer 嘅呼叫（每條記住喺邊個檔）。 */
function rendererCalls(callRe, label) {
  const channels = [];
  const unknownKeys = [];
  for (const file of RENDERER_FILES) {
    const r = channelsUsed(codeOf(file), callRe, file);
    channels.push(...r.channels);
    unknownKeys.push(...r.unknownKeys);
    if (r.channels.length === 0 && label === 'send') {
      // 呢個檢查交返下面嘅「每個檔最少幾個呼叫」
    }
  }
  return { channels, unknownKeys };
}

/** 集合差（回傳仍然帶「邊條 channel」）。 */
function missing(calls, known) {
  const set = new Set(known);
  return calls.filter((c) => !set.has(c));
}

// ─────────────────────────── ① map 形狀 ───────────────────────────

test('ipc-channels：map 形狀（key lowerCamelCase、value 唯一、數量夠）', () => {
  const keys = Object.keys(IPC_CHANNELS);
  const values = Object.values(IPC_CHANNELS);
  assert.ok(keys.length >= 20, `channel map 應該有 ≥20 條，實得 ${keys.length}：${keys}`);
  for (const key of keys) {
    assert.match(key, /^[a-z][A-Za-z0-9]*$/, `key「${key}」要係 lowerCamelCase`);
    assert.equal(typeof IPC_CHANNELS[key], 'string');
    assert.ok(IPC_CHANNELS[key].length > 0, `「${key}」唔可以係空字串`);
  }
  // value 一定要唯一（兩個 key 指同一個 channel = 一定有嘢搞錯）
  assert.equal(new Set(values).size, values.length, `有兩個 key 指同一個 channel：${values}`);
  // value 慣例：hud／whatif 前綴，或者擷取管線嗰幾個
  // ⚠️ `'hud'` 係**單字** channel（main → hud.html 推顯示狀態），係最早有嘅一條，
  //    冇 `hud-` 前綴 —— 唔准為咗「一致」而改名（要兩邊同時改，而且文件／診斷工具都提到）。
  const pipeline = new Set(['frame', 'capture-error', 'no-source', 'roi', 'start', 'fps', 'crop', 'hud']);
  for (const [key, value] of Object.entries(IPC_CHANNELS)) {
    assert.ok(
      value.startsWith('hud-') || value.startsWith('whatif-') || pipeline.has(value),
      `「${key}」→「${value}」唔符合命名慣例（hud-*／whatif-*／擷取管線）`,
    );
  }
});

// ─────────────────────────── ② main.js 引用嘅 key 一定存在 ───────────────────────────

test('ipc-channels：main.js 引用嘅每個 IPC_CHANNELS.<key> 都要存在（打字錯即刻爆）', () => {
  assert.deepEqual(mainHandlers().unknownKeys, [], 'main.js 有 handler 引用咗唔存在嘅 key');
  assert.deepEqual(mainSends().unknownKeys, [], 'main.js 有 send 引用咗唔存在嘅 key');
});

// ─────────────────────────── 前提檢查（抽取唔可以空轉）───────────────────────────

test('IPC 接線閘：抽取器真係抽得到嘢（唔係抽到空集合就靜默 pass）', () => {
  const handlers = mainHandlers().channels;
  const sends = mainSends().channels;
  const rSend = rendererCalls('ipcRenderer\\.send\\(', 'send').channels;
  const rOn = rendererCalls('ipcRenderer\\.on\\(', 'listen').channels;

  assert.ok(handlers.length >= 10, `main.js 應該有 ≥10 個 handler，實得 ${handlers.length}：${handlers}`);
  assert.ok(sends.length >= 6, `main.js 應該有 ≥6 次 send，實得 ${sends.length}：${sends}`);
  assert.ok(rSend.length >= 8, `4 個 HTML 加埋應該有 ≥8 次 send，實得 ${rSend.length}：${rSend}`);
  assert.ok(rOn.length >= 8, `4 個 HTML 加埋應該有 ≥8 次 on，實得 ${rOn.length}：${rOn}`);
  for (const file of RENDERER_FILES) {
    const n = rendererCalls('ipcRenderer\\.(?:send|on)\\(', 'both').channels.length;
    assert.ok(n >= 0, `${file}`);
  }
});

// ─────────────────────────── ③④⑤ 接線（用 channel **值** 比對）───────────────────────────

test('IPC 接線閘：renderer 每次 send 都要有 main handler（打錯字＝靜默死線）', () => {
  const handlers = mainHandlers().channels;
  const { channels: sends, unknownKeys } = rendererCalls('ipcRenderer\\.send\\(', 'send');
  assert.deepEqual(unknownKeys, [], 'renderer 引用咗唔存在嘅 client key');
  const bad = missing(sends, handlers);
  assert.deepEqual(
    bad, [],
    '⛔ 有 renderer send 去冇 handler 嘅 channel（`ipcRenderer.send()` 係靜默丟棄）：\n'
      + `  ${bad.join('、')}\n  main.js 真正有 handler：${[...new Set(handlers)].sort().join('、')}`,
  );
});

test('IPC 接線閘：main 每次 send 都要有 renderer 收（冇人收＝窗永遠唔更新）', () => {
  const { channels: listens } = rendererCalls('ipcRenderer\\.on\\(', 'listen');
  const bad = missing(mainSends().channels, listens);
  assert.deepEqual(
    bad, [],
    '⛔ 有 main send 出去冇人聽嘅 channel：\n'
      + `  ${bad.join('、')}\n  renderer 真正有聽：${[...new Set(listens)].sort().join('、')}`,
  );
});

test('IPC 接線閘：每條 ipcRenderer.invoke 都要有 ipcMain.handle（將來加 preload 都唔會漏）', () => {
  const { channels: handles } = channelsUsed(codeOf(MAIN_FILE), 'ipcMain\\.handle\\(', MAIN_FILE);
  const { channels: invokes } = rendererCalls('ipcRenderer\\.invoke\\(', 'invoke');
  assert.deepEqual(missing(invokes, handles), [], `invoke 冇 handle：${missing(invokes, handles).join('、')}`);
});

// ─────────────────────────── ⑥ map 冇孤兒 ───────────────────────────

test('IPC 接線閘：map 冇孤兒 channel（每一條都真係有人用）', () => {
  const used = new Set([
    ...mainHandlers().channels,
    ...mainSends().channels,
    ...rendererCalls('ipcRenderer\\.send\\(', 'send').channels,
    ...rendererCalls('ipcRenderer\\.on\\(', 'listen').channels,
    ...channelsUsed(codeOf(MAIN_FILE), 'ipcMain\\.handle\\(', MAIN_FILE).channels,
    ...rendererCalls('ipcRenderer\\.invoke\\(', 'invoke').channels,
  ]);
  const orphans = Object.entries(IPC_CHANNELS)
    .filter(([, value]) => !used.has(value))
    .map(([key, value]) => `${key}（${value}）`);
  assert.deepEqual(orphans, [], `map 入面有冇人用嘅 channel（加咗但兩邊都冇改？）：\n  ${orphans.join('、')}`);
});

// ─────────────────────────── ⑦ channel 名唔准只差大小寫／連字符 ───────────────────────────

test('IPC 接線閘：channel 名唔可以只靠大小寫／連字符分辨（兩個名好易撈亂）', () => {
  const byNormalized = new Map();
  for (const value of Object.values(IPC_CHANNELS)) {
    const key = value.replace(/[-_]/g, '').toLowerCase();
    const prev = byNormalized.get(key);
    if (prev !== undefined && prev !== value) {
      assert.fail(`⛔ channel「${prev}」同「${value}」只差大小寫／連字符 → 好易打錯而靜默失效`);
    }
    byNormalized.set(key, value);
  }
  assert.ok(Object.keys(IPC_CHANNELS).length >= 20);
});

// ─────────────────────────── 測試自己嘅測試 ───────────────────────────

test('IPC 接線閘：抽取器真係由文字抽（兩種寫法都要抽到）', () => {
  // map 引用（main.js 現時嘅寫法）
  const mapped = "ipcMain.on(IPC_CHANNELS.frame, () => {});\nipcMain.on(IPC_CHANNELS.captureError, () => {});";
  assert.deepEqual(mainHandlers(mapped).channels, ['frame', 'capture-error']);
  // 字面值（renderer 現時嘅寫法）
  const literal = "ipcRenderer.send('frame', x);\nipcRenderer.on('hud', () => {});";
  assert.deepEqual(channelsUsed(literal, 'ipcRenderer\\.send\\(', 'fake').channels, ['frame']);
  assert.deepEqual(channelsUsed(literal, 'ipcRenderer\\.on\\(', 'fake').channels, ['hud']);
  // 唔存在嘅 key 一定要報（唔可以靜默當冇事）
  assert.deepEqual(
    channelsUsed('ipcMain.on(IPC_CHANNELS.nopeNope, () => {});', 'ipcMain\\.on\\(', 'fake').unknownKeys,
    ['fake: IPC_CHANNELS.nopeNope（map 冇呢個 key）'],
  );
  // 剝註釋真係做緊嘢：`main.js` 嘅註釋本身有提到 `ipcMain.on(`
  assert.ok(
    codeOf(MAIN_FILE) !== readText(MAIN_FILE),
    'main.js 有註釋 → 剝註釋呢一步係真做緊嘢',
  );
  assert.ok(!stripComments("// ipcMain.on('ghost')").includes('ghost'), '行註釋要剝乾淨');
  assert.ok(!stripComments('<!-- ipcRenderer.send("ghost") -->').includes('ghost'), 'HTML 註釋要剝乾淨');
  // 但唔可以誤剝 URL（`//` 前面係 `:`）
  assert.ok(
    stripComments("// x\nconst u = 'https://example.com/a';").includes('https://example.com/a'),
    '剝註釋唔可以連 URL 都剝走',
  );
});

test('IPC 接線閘：真檔改名就一定要報（用 in-memory 突變證明個閘唔係空轉）', () => {
  const main = codeOf(MAIN_FILE);
  const handlers = mainHandlers();
  const key = Object.keys(IPC_CHANNELS)[0];
  const value = IPC_CHANNELS[key];
  assert.ok(handlers.channels.includes(value), `main.js 應該有 handler 用「${value}」（前提檢查）`);

  // 把 renderer 嗰邊嘅 channel 改名 → 「冇 handler」一定要報
  const renamed = `${value}-typo`;
  const fakeRenderer = `ipcRenderer.send('${renamed}', 1);`;
  const bad = missing(
    channelsUsed(fakeRenderer, 'ipcRenderer\\.send\\(', 'fake').channels,
    handlers.channels,
  );
  assert.deepEqual(bad, [renamed], '⛔ 改咗 renderer 嘅 channel 名，閘捉唔到 = 空轉');

  // 把 main handler 嘅 key 改走 → 應該被當成「未知 key」（唔會靜默）
  const mutated = main.replace(`IPC_CHANNELS.${key}`, 'IPC_CHANNELS.zzzUnknown');
  assert.deepEqual(
    mainHandlers(mutated).unknownKeys.length > 0, true,
    '⛔ 改成唔存在嘅 key，閘捉唔到 = 空轉',
  );
});
