/**
 * **IPC channel 接線閘**：`electron/main.js` ↔ 4 個 renderer HTML。
 *
 * ## 為何要（獨立審計 H1，呢個係真存在嘅靜默死線）
 *
 * 本專案**冇 preload**（AGENTS §6.3）：5 個檔各自用字面值寫 channel 名 ——
 * 現時 24 條，每條最少寫兩次，而 **`ipcRenderer.send()` 去一個冇 handler 嘅
 * channel 係靜默丟棄**（唔會 throw、唔會 log）。即係打錯一個字母（`hud-config-save`
 * → `hud-config-saved`）嘅後果係「按咗儲存但冇反應」，而：
 *   - `npm.cmd test` 照樣全綠
 *   - `node tools/check-renderer-syntax.js` 只驗語法，捉唔到 channel 名
 * → 呢個閘就係補呢個洞（同 `hud-settings-html.test.js` 同一個思路：
 *   **真係由檔案抽字面值**，唔准寫死一份期望清單同自己比）。
 *
 * ## 斷言範圍（刻意「唔綁死拓樸」）
 *
 * ① renderer `send` ⊆ main `on`   —— 每個 send 一定要有 handler（最重要嗰條）
 * ② main `send` ⊆ renderer `on`   —— 每個 send 一定要有人收（否則 HUD／窗永遠唔更新）
 * ③ `invoke` ⊆ `handle`           —— 現時 0 條，但將來加 preload 一樣守得住
 * ④ channel 名唔可以只用大小寫／連字符分辨（`hudConfig` vs `hud-config`）
 *
 * ⚠️ **唔斷言** main `on` ⊆ renderer `send`：將來可能加「暫時冇人叫」嘅 handler
 *    （例如留返診斷用），嗰陣唔應該令測試變紅。
 * ⚠️ **唔逐檔綁死**（例如「`hud` 只可以去 hud.html」）：路由係實作細節，
 *    綁死會令正常重構（換窗、拆窗）都要改測試。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
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
 * 為何一定要（實測踩到）：`main.js` 嘅註釋本身會提到 `ipcMain.on('frame')`
 * ——唔剝註釋嘅話，**註釋**會被當成「有 handler」，於是有人改咗真 handler 名
 * 而註釋冇改，閘就會**假 pass**（最危險嘅一種閘）。
 *
 * ⚠️ `//` 前面係 `:`（`https://…`）或者引號嗰種唔算註釋，唔可以剝。
 */
function stripComments(text) {
  return String(text)
    .replace(/<!--[\s\S]*?-->/g, '')       // HTML 註釋
    .replace(/\/\*[\s\S]*?\*\//g, '')      // JS 區塊註釋
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1'); // JS 行註釋（保留前面嗰個字元）
}

/** 抽所有 `xxx('channel'` 嘅 channel 名。 */
function matchAll(text, re) {
  return [...text.matchAll(re)].map((m) => m[1]);
}

/** 真檔嘅**程式碼**（剝咗註釋），給需要精確比對嘅抽取器用。 */
function codeOf(rel, text) {
  return stripComments(readText(rel, text));
}

const MAIN_HANDLER_RE = /ipcMain\.on\(\s*'([^']+)'/g;
/** main 側三種 send 寫法：`win.webContents.send(…)`／`sender.send(…)`／`event.sender.send(…)`。 */
const MAIN_SEND_RE = /(?:webContents|sender)\.send\(\s*'([^']+)'/g;
const MAIN_HANDLE_RE = /ipcMain\.handle\(\s*'([^']+)'/g;
const RENDERER_SEND_RE = /ipcRenderer\.send\(\s*'([^']+)'/g;
const RENDERER_ON_RE = /ipcRenderer\.on\(\s*'([^']+)'/g;
const RENDERER_INVOKE_RE = /ipcRenderer\.invoke\(\s*'([^']+)'/g;

/** main 註冊嘅 handler（`ipcMain.on`）。 */
function mainHandlers(text) {
  return matchAll(codeOf(MAIN_FILE, text), MAIN_HANDLER_RE);
}

/** main 推落 renderer 嘅 channel（連來源檔名，失敗訊息要講得出邊度揾到）。 */
function mainSends() {
  return matchAll(codeOf(MAIN_FILE), MAIN_SEND_RE).map((channel) => ({ channel, file: MAIN_FILE }));
}

/** 全部 renderer 嘅 `send`／`on`／`invoke`（每條記住佢喺邊個檔）。 */
function rendererCalls(re) {
  const out = [];
  for (const file of RENDERER_FILES) {
    for (const channel of matchAll(codeOf(file), re)) out.push({ channel, file });
  }
  return out;
}

/** 集合差：喺 `calls` 但唔喺 `known`（回傳仍然帶 file 資訊）。 */
function missing(calls, known) {
  const set = new Set(known);
  return calls.filter(({ channel }) => !set.has(channel));
}

/** 砌失敗訊息：channel ＋ 邊個檔用咗 ＋ 另一邊真正有咩。 */
function describe(list, knownLabel, known) {
  return list
    .map(({ channel, file }) => `  - \`${channel}\`（${file}）`)
    .join('\n') + `\n  另一邊（${knownLabel}）真正有：${[...new Set(known)].sort().join('、')}`;
}

// ─────────────────────────── 前提檢查（regex 唔准過時）───────────────────────────

test('IPC 接線閘：兩個 regex 真係抽得到嘢（唔係抽到空集合就靜默 pass）', () => {
  const handlers = mainHandlers();
  const sends = mainSends();
  const rSend = rendererCalls(RENDERER_SEND_RE);
  const rOn = rendererCalls(RENDERER_ON_RE);

  assert.ok(handlers.length >= 10, `main.js 應該有 ≥10 個 ipcMain.on，實得 ${handlers.length} 個：${handlers}`);
  assert.ok(sends.length >= 6, `main.js 應該有 ≥6 次 webContents/sender.send，實得 ${sends.length}：${sends.map((s) => s.channel)}`);
  assert.ok(rSend.length >= 8, `4 個 HTML 加埋應該有 ≥8 次 ipcRenderer.send，實得 ${rSend.length}：${rSend.map((s) => s.channel)}`);
  assert.ok(rOn.length >= 8, `4 個 HTML 加埋應該有 ≥8 次 ipcRenderer.on，實得 ${rOn.length}：${rOn.map((s) => s.channel)}`);
  // 每個檔都要有嘢（防止「某個窗冇咗 IPC 但冇人知」）
  for (const file of RENDERER_FILES) {
    const n = rSend.filter((c) => c.file === file).length + rOn.filter((c) => c.file === file).length;
    assert.ok(n >= 2, `${file} 應該至少有 2 個 IPC 呼叫（send／on），實得 ${n} 個`);
  }
});

// ─────────────────────────── ① renderer send → main handler ───────────────────────────

test('IPC 接線閘：renderer 每次 send 都要有 main handler（打錯字＝靜默死線）', () => {
  const handlers = mainHandlers();
  const bad = missing(rendererCalls(RENDERER_SEND_RE), handlers);
  assert.deepEqual(
    bad, [],
    '⛔ 有 renderer send 去冇 handler 嘅 channel（`ipcRenderer.send()` 係靜默丟棄，唔會報錯）：\n'
      + describe(bad, 'ipcMain.on', handlers),
  );
});

// ─────────────────────────── ② main send → renderer on ───────────────────────────

test('IPC 接線閘：main 每次 send 都要有 renderer 收（冇人收＝窗永遠唔更新）', () => {
  const listens = rendererCalls(RENDERER_ON_RE).map((c) => c.channel);
  const bad = missing(mainSends(), listens);
  assert.deepEqual(
    bad, [],
    '⛔ 有 main send 出去冇人聽嘅 channel（`webContents.send()` 冇 listener 係靜默丟棄）：\n'
      + describe(bad, 'ipcRenderer.on', listens),
  );
});

// ─────────────────────────── ③ invoke／handle（現時 0 條，將來守得住）───────────────────────────

test('IPC 接線閘：每條 ipcRenderer.invoke 都要有 ipcMain.handle（將來加 preload 都唔會漏）', () => {
  const handles = matchAll(codeOf(MAIN_FILE), MAIN_HANDLE_RE);
  const invokes = rendererCalls(RENDERER_INVOKE_RE);
  const bad = missing(invokes, handles);
  assert.deepEqual(
    bad, [],
    '⛔ 有 invoke 去冇 handle 嘅 channel（`invoke()` 會 reject，但錯誤可能被吞）：\n'
      + describe(bad, 'ipcMain.handle', handles),
  );
});

// ─────────────────────────── ④ channel 名唔准「只差大小寫／連字符」───────────────────────────

test('IPC 接線閘：channel 名唔可以只靠大小寫／連字符分辨（兩個名好易撈亂）', () => {
  const all = [
    ...mainHandlers(),
    ...mainSends().map((s) => s.channel),
    ...rendererCalls(RENDERER_SEND_RE).map((c) => c.channel),
    ...rendererCalls(RENDERER_ON_RE).map((c) => c.channel),
  ];
  // 正規化（去連字符 ＋ 轉細楷）之後撞名 = 兩個好易打錯嘅 channel
  const byNormalized = new Map();
  for (const channel of new Set(all)) {
    const key = channel.replace(/[-_]/g, '').toLowerCase();
    const prev = byNormalized.get(key);
    if (prev !== undefined && prev !== channel) {
      assert.fail(`⛔ channel「${prev}」同「${channel}」只差大小寫／連字符 → 好易打錯而靜默失效`);
    }
    byNormalized.set(key, channel);
  }
  assert.ok(byNormalized.size >= 10, `應該有 ≥10 條唔同嘅 channel，實得 ${byNormalized.size}`);
});

// ─────────────────────────── 測試自己嘅測試 ───────────────────────────

test('IPC 接線閘：抽取器真係由文字抽（餵假內容要有唔同結果）', () => {
  const fakeMain = "ipcMain.on('alpha', () => {});\nipcMain.on('beta', () => {});";
  assert.deepEqual(mainHandlers(fakeMain), ['alpha', 'beta']);
  const fakeHtml = "ipcRenderer.send('gamma', 1);\nipcRenderer.on('delta', () => {});";
  assert.deepEqual(matchAll(fakeHtml, RENDERER_SEND_RE), ['gamma']);
  assert.deepEqual(matchAll(fakeHtml, RENDERER_ON_RE), ['delta']);
  // 同真檔唔同（證明唔係回一個常數）
  assert.notDeepEqual(mainHandlers(fakeMain), mainHandlers());
  // ⭐ 剝註釋真係做緊嘢：`main.js` 嘅註釋本身有提到 `ipcMain.on('frame')`
  //    （唔剝嘅話「註釋」會冒充 handler → 有人改咗真 handler 名都會假 pass）
  assert.ok(
    matchAll(readText(MAIN_FILE), MAIN_HANDLER_RE).length > mainHandlers().length,
    'main.js 嘅註釋應該提到過 ipcMain.on(...) → 剝註釋呢一步係真做緊嘢',
  );
  // 但唔可以誤剝 URL（`//` 前面係 `:`）
  assert.ok(
    stripComments("// 註釋\nconst u = 'https://example.com/a';").includes('https://example.com/a'),
    '剝註釋唔可以連 URL 都剝走',
  );
  assert.ok(!stripComments("// ipcMain.on('ghost')").includes('ghost'), '行註釋要剝乾淨');
  assert.ok(!stripComments('<!-- ipcRenderer.send("ghost") -->').includes('ghost'), 'HTML 註釋要剝乾淨');
});

/**
 * ⭐ 最重要嗰條：**證明個閘真係捉得到**（唔係空轉）。
 *
 * 做法：喺**記憶體**入面改真檔嘅文字（唔寫任何檔、唔碰 git），
 * 模擬「有人把 handler 名改咗但 renderer 冇跟」呢個真實事故，然後確認兩個方向都報得中：
 *   ① 改 main.js 嘅 handler 名 → 「renderer send 冇 handler」要捉到
 *   ② 改 main.js 嘅 send 名     → 「main send 冇人聽」要捉到
 */
test('IPC 接線閘：真檔改名就一定要報（用 in-memory 突變證明個閘唔係空轉）', () => {
  const main = codeOf(MAIN_FILE);
  const handlers = mainHandlers();
  const listens = rendererCalls(RENDERER_ON_RE).map((c) => c.channel);
  // ⚠️ 一個 channel 可能喺幾個地方出現（實測 `hud-config` 有兩處 send：
  //    `replyHudConfig()` ＋ `notifySettingsWindow()`）→ 一定要**全部**換走，
  //    唔可以只換第一個（只換第一個會令突變無效，自測就會假失敗）。
  const renameAll = (text, from, to) => text.split(`'${from}'`).join(`'${to}'`);

  // ① main 側 handler 改名（renderer 照舊 send 舊名）
  const renamedHandler = handlers[0];
  const mutatedHandlers = mainHandlers(renameAll(main, renamedHandler, `${renamedHandler}-typo`));
  assert.ok(
    !mutatedHandlers.includes(renamedHandler),
    `突變冇生效（「${renamedHandler}」仲喺集合內）—— 呢個自測本身失效`,
  );
  const badSends = missing(rendererCalls(RENDERER_SEND_RE), mutatedHandlers);
  assert.ok(
    badSends.some((c) => c.channel === renamedHandler),
    `⛔ 改咗 handler 名（「${renamedHandler}」）但閘捉唔到 —— 呢個閘係空轉`,
  );

  // ② main 側 send 改名（renderer 照舊 on 舊名）
  const renamedSend = mainSends()[0].channel;
  const typoSend = `${renamedSend}-typo`;
  const mutatedSends = matchAll(renameAll(main, renamedSend, typoSend), MAIN_SEND_RE)
    .map((channel) => ({ channel, file: MAIN_FILE }));
  assert.ok(!mutatedSends.some((c) => c.channel === renamedSend), '突變冇生效，自測失效');
  const badListens = missing(mutatedSends, listens);
  // ⚠️ 報出嚟嘅一定係**新名**（`typoSend`）：舊名（`renamedSend`）已經冇人 send，
  //    renderer 嗰邊仲留住一個永遠收唔到嘢嘅 listener —— 呢個就係「靜默唔更新」嘅實況。
  assert.ok(
    badListens.some((c) => c.channel === typoSend),
    `⛔ 改咗 send 名（「${renamedSend}」→「${typoSend}」）但閘捉唔到 —— 呢個閘係空轉`,
  );
});
