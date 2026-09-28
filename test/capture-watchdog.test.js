/**
 * 擷取凍結 watchdog（`electron/capture-watchdog.js`）嘅單元測試 ＋ 接線閘。
 *
 * ## 為何要
 *
 * 設計審查 S4 第四刀。呢段係 2026-09-19 實機事故（「一開頭 detect 到，去到一半就固定咗，
 * 之後十分鐘都話唔見面板條」）嘅防線：以前係 `main.js` 五個 module-level 可變全域
 * （`lastFrameAt`／`framesInWindow`／`recoverAttempts`／`lastRecoverAt`／`heartbeatTick`）
 * 散住喺收幀 handler、兩個 `setInterval`、`beginCapture()`、「強制更新」四條路，**零覆蓋**。
 *
 * 四條政策一定要釘死：
 *   ① **節流**：10 秒內唔重複試（唔係嘅話一次凍結會連開幾次擷取）；
 *   ② **上限**：試夠 5 次就停手 ＋ 大聲叫用戶重開程式（唔准無限重試／靜默）；
 *   ③ **重試之後要「畀新一輪時間」**（唔係嘅話 5 秒後又話凍結）；
 *   ④ 心跳：一幀都收唔到 → 警告 ＋ 試救；幀數窗口**無論如何**都歸零。
 *
 * ⚠️ 呢個閘唔算「實機已驗」：真嘅驗收仍然要用戶跑 `npm start` 睇長跑有冇凍結。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FRAME_FREEZE_MS,
  HEARTBEAT_LOG_EVERY,
  MAX_CAPTURE_RECOVERS,
  RECOVER_THROTTLE_MS,
  createCaptureWatchdog,
} from '../electron/capture-watchdog.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = readFileSync(join(ROOT, 'electron/main.js'), 'utf8');

/** 剝註釋（同 `test/hud-history-wiring.test.js` 同一招：唔剝就會「註釋冒充實作」）。 */
function stripComments(text) {
  return String(text)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
}

const MAIN_CODE = stripComments(MAIN);

/** 可推時間嘅假時鐘 ＋ 收集 log 嘅 watchdog。 */
function makeWatchdog({ started = true, canRestart = true, restart } = {}) {
  let t = 1_000_000;
  const log = [];
  const warn = [];
  const error = [];
  const restarts = [];
  const wd = createCaptureWatchdog({
    now: () => t,
    isStarted: () => started,
    canRestart: () => canRestart,
    restart: restart ?? ((why) => restarts.push(why)),
    onLog: (m) => log.push(m),
    onWarn: (m) => warn.push(m),
    onError: (m) => error.push(m),
  });
  return { wd, log, warn, error, restarts, advance: (ms) => { t += ms; }, now: () => t };
}

test('watchdog：`markStarted()` 係新一輪 —— 記時間、窗口歸零、重試次數歸零', () => {
  const { wd, now } = makeWatchdog();
  assert.equal(wd.state().lastFrameAt, 0, '未開擷取之前冇幀時間');
  wd.markStarted();
  assert.equal(wd.state().lastFrameAt, now());
  assert.equal(wd.state().framesInWindow, 0);
  assert.equal(wd.state().recoverAttempts, 0);
});

test('watchdog：有幀到 → 更新最後幀時間 ＋ 窗口幀數 +1', () => {
  const { wd, advance, now } = makeWatchdog();
  wd.markStarted();
  advance(400);
  wd.noteFrame();
  wd.noteFrame();
  assert.equal(wd.state().lastFrameAt, now());
  assert.equal(wd.state().framesInWindow, 2);
});

test('watchdog：凍結判斷係**嚴格大於** 15 秒（邊界值唔准飄）', () => {
  const { wd, restarts, advance } = makeWatchdog();
  wd.markStarted();
  advance(FRAME_FREEZE_MS);
  assert.equal(wd.checkFreeze(), false, '啱啱好等於唔算凍結');
  advance(1);
  assert.equal(wd.checkFreeze(), true, '過咗就要救');
  assert.equal(restarts.length, 1);
  assert.equal(FRAME_FREEZE_MS, 15000, '值本身係行為（實機調過）：改要連測試一齊改');
});

test('watchdog：未開始擷取（冇 sourceId）→ 唔檢查、唔試救', () => {
  const { wd, restarts, advance } = makeWatchdog({ started: false });
  wd.markStarted();
  advance(FRAME_FREEZE_MS * 10);
  assert.equal(wd.checkFreeze(), false);
  assert.equal(wd.state().recoverAttempts, 0);
  assert.equal(restarts.length, 0);
});

test('watchdog：冇窗／窗爆咗（`canRestart` false）→ 唔算一次重試', () => {
  const { wd, restarts, advance } = makeWatchdog({ canRestart: false });
  wd.markStarted();
  advance(FRAME_FREEZE_MS + 1);
  assert.equal(wd.checkFreeze(), false);
  assert.equal(wd.state().recoverAttempts, 0, '唔准把「試唔到」當成「試過」');
  assert.equal(restarts.length, 0);
});

test('watchdog：節流 —— 10 秒內唔准重複試，過咗就可以（邊界：啱啱好 10 秒就准）', () => {
  const { wd, restarts, advance } = makeWatchdog();
  wd.markStarted();
  // ⚠️ 用 `attempt()` 直接驗節流：凍結檢查本身要隔 15 秒先會觸發，
  //    所以「短時間內連續試」只會由 renderer 報錯／心跳嗰兩條路發生。
  assert.equal(wd.attempt('renderer 報錯：mock'), true);
  assert.equal(wd.attempt('renderer 報錯：mock'), false, '10 秒內唔准再試');
  assert.equal(restarts.length, 1);
  advance(RECOVER_THROTTLE_MS - 1);
  assert.equal(wd.attempt('renderer 報錯：mock'), false, '仲爭 1ms 都唔准');
  advance(1);
  assert.equal(wd.attempt('renderer 報錯：mock'), true, '過咗節流窗口就准');
  assert.equal(restarts.length, 2);
  assert.equal(RECOVER_THROTTLE_MS, 10000);
});

test('watchdog：試夠 5 次 → 停手，而且要大聲叫用戶重開程式（唔准靜默）', () => {
  const { wd, restarts, error, advance } = makeWatchdog();
  wd.markStarted();
  for (let i = 0; i < MAX_CAPTURE_RECOVERS; i += 1) {
    advance(FRAME_FREEZE_MS + RECOVER_THROTTLE_MS + 2);
    wd.checkFreeze();
  }
  assert.equal(restarts.length, MAX_CAPTURE_RECOVERS);
  advance(FRAME_FREEZE_MS + RECOVER_THROTTLE_MS + 2);
  assert.equal(wd.checkFreeze(), false, '第 6 次唔准再試');
  assert.equal(restarts.length, MAX_CAPTURE_RECOVERS);
  assert.equal(error.length, 1);
  assert.match(error[0], new RegExp(`已經重試 ${MAX_CAPTURE_RECOVERS} 次都收唔到幀`));
  assert.match(error[0], /唔再自動試，請重開程式/);
  assert.equal(MAX_CAPTURE_RECOVERS, 5);
});

test('watchdog：重試之後要「畀新一輪時間」—— 唔係嘅話 5 秒後又話凍結', () => {
  const { wd, restarts, advance, now } = makeWatchdog();
  wd.markStarted();
  advance(FRAME_FREEZE_MS + 1);
  wd.checkFreeze();
  assert.equal(wd.state().lastFrameAt, now(), '重試成功之後最後幀時間要推到而家');
  assert.equal(wd.checkFreeze(), false, '即刻再檢查唔應該再觸發');
  assert.equal(restarts.length, 1);
});

test('watchdog：重試訊息措辭（連次數）＋ 重啟真係收到原因', () => {
  const { wd, warn, restarts, advance } = makeWatchdog();
  wd.markStarted();
  advance(20000);
  wd.checkFreeze();
  assert.deepEqual(restarts, ['已經 20 秒冇收到幀']);
  assert.equal(warn.length, 1);
  assert.equal(warn[0], '[擷取] ⚠️ 已經 20 秒冇收到幀 → 重新啟動擷取（第 1/5 次）');
});

test('watchdog：重啟本身 throw → 出 error 但唔准爆（亦唔准當冇試過）', () => {
  const { wd, error, advance } = makeWatchdog({
    restart: () => { throw new Error('mock 送 IPC 失敗'); },
  });
  wd.markStarted();
  advance(FRAME_FREEZE_MS + 1);
  assert.equal(wd.checkFreeze(), true);
  assert.equal(wd.state().recoverAttempts, 1, '送 IPC 失敗都已經算用咗一次');
  assert.equal(error.length, 1);
  assert.match(error[0], /重啟失敗：mock 送 IPC 失敗/);
});

test('watchdog：心跳一幀都收唔到 → 警告 ＋ 試救，而且窗口歸零', () => {
  const { wd, warn, restarts } = makeWatchdog();
  wd.markStarted();
  assert.equal(wd.heartbeat(), 'recovered', '第一次心跳（冇幀）應該即刻試救');
  assert.match(warn[0], /最近 60 秒\*\*一幀都收唔到\*\*/);
  assert.match(warn[0], /最後一幀：0 秒前/);
  assert.equal(wd.state().framesInWindow, 0);
  assert.equal(restarts.length, 1);
  // 節流未過 → 第二次心跳只可以警告（唔准靜默，亦唔准重複重啟）
  assert.equal(wd.heartbeat(), 'warned');
  // 3 句 = ① 第一次心跳警告 ② 第一次真係重啟（attempt 自己嗰句） ③ 第二次心跳警告
  assert.equal(warn.length, 3);
  assert.match(warn[2], /一幀都收唔到/);
  assert.equal(restarts.length, 1);
});

test('watchdog：心跳「從來冇幀」嘅措辭（同 snapshot 一致）', () => {
  const { wd, warn } = makeWatchdog();
  // 冇 `markStarted()` → lastFrameAt 保持 0
  wd.heartbeat();
  assert.match(warn[0], /最後一幀：從來冇/);
  assert.match(warn[0], /擷取可能凍結咗/);
});

test('watchdog：心跳有幀 → 每 5 個週期先報一次（唔准每分鐘洗版）', () => {
  const { wd, log, warn } = makeWatchdog();
  wd.markStarted();
  const results = [];
  for (let i = 0; i < HEARTBEAT_LOG_EVERY; i += 1) {
    wd.noteFrame();
    results.push(wd.heartbeat());
  }
  assert.deepEqual(results, ['quiet', 'quiet', 'quiet', 'quiet', 'logged']);
  assert.equal(log.length, 1);
  assert.match(log[0], /心跳：最近 60 秒收到 1 幀/);
  assert.equal(warn.length, 0, '有幀就唔准嘈');
  assert.equal(HEARTBEAT_LOG_EVERY, 5);
});

test('watchdog：`resetForManualRefresh()` 連節流一齊歸零（手動更新＝重新開始）', () => {
  const { wd, restarts, advance } = makeWatchdog();
  wd.markStarted();
  advance(FRAME_FREEZE_MS + 1);
  wd.checkFreeze();
  assert.equal(restarts.length, 1);
  wd.resetForManualRefresh();
  assert.equal(wd.state().recoverAttempts, 0);
  assert.equal(wd.state().lastRecoverAt, 0);
  advance(FRAME_FREEZE_MS + 1);
  assert.equal(wd.checkFreeze(), true, '手動更新之後應該即刻容忍一次自動救援');
  assert.equal(restarts.length, 2);
});

test('watchdog：`markStarted()` **唔清**節流（同手動更新唔同 —— 呢個係真實行為差異）', () => {
  const { wd, restarts, advance } = makeWatchdog();
  wd.markStarted();
  assert.equal(wd.attempt('renderer 報錯：mock'), true);
  wd.markStarted();
  assert.equal(wd.state().lastRecoverAt > 0, true, '`markStarted()` 唔准扮手動更新');
  advance(RECOVER_THROTTLE_MS - 1);
  assert.equal(wd.attempt('renderer 報錯：mock'), false, '節流仍然生效');
  assert.equal(restarts.length, 1);
});

test('watchdog：`state()` 係副本 —— 外面改唔到內部狀態', () => {
  const { wd } = makeWatchdog();
  wd.markStarted();
  const s = wd.state();
  s.recoverAttempts = 999;
  s.lastFrameAt = 999;
  assert.equal(wd.state().recoverAttempts, 0);
  assert.notEqual(wd.state().lastFrameAt, 999);
});

test('接線閘：`main.js` 唔准再留住嗰 5 個可變全域（政策唯一一份）', () => {
  assert.match(
    MAIN_CODE,
    /import \{ createCaptureWatchdog, MAX_CAPTURE_RECOVERS \} from '\.\/capture-watchdog\.js';/,
    '`main.js` 要由 `capture-watchdog.js` 匯入',
  );
  assert.match(MAIN_CODE, /const captureWatchdog = createCaptureWatchdog\(\{/);
  assert.match(MAIN_CODE, /captureWatchdog\.noteFrame\(\)/, '收幀 handler 要經 `noteFrame()`');
  assert.match(MAIN_CODE, /captureWatchdog\.markStarted\(\)/, '`beginCapture()` 要經 `markStarted()`');
  assert.match(MAIN_CODE, /captureWatchdog\.resetForManualRefresh\(\)/, '「強制更新」要經佢');
  assert.match(MAIN_CODE, /captureWatchdog\.checkFreeze\(\)/);
  assert.match(MAIN_CODE, /captureWatchdog\.heartbeat\(\)/);
  assert.match(MAIN_CODE, /const captureState = captureWatchdog\.state\(\)/, '快照要經 `state()`');
  for (const dead of ['lastFrameAt', 'framesInWindow', 'recoverAttempts', 'lastRecoverAt', 'heartbeatTick']) {
    assert.ok(
      !new RegExp(`(let|const) ${dead}\\b`).test(MAIN_CODE),
      `\`${dead}\` 唔准再喺 \`main.js\` 宣告（唯一一份喺 watchdog 入面）`,
    );
    assert.ok(
      !MAIN_CODE.includes(`${dead} =`) && !MAIN_CODE.includes(`${dead} +=`),
      `\`${dead}\` 唔准再喺 \`main.js\` 賦值`,
    );
  }
  assert.ok(!/const FRAME_FREEZE_MS =/.test(MAIN_CODE), '`FRAME_FREEZE_MS` 唔准喺 `main.js` 再寫一份');
  assert.ok(!/const MAX_CAPTURE_RECOVERS =/.test(MAIN_CODE), '`MAX_CAPTURE_RECOVERS` 唔准再寫一份');
  assert.ok(
    !MAIN_CODE.includes('一幀都收唔到'),
    '`main.js` 唔准再抄一份心跳警告文字（兩份措辭就會分叉）',
  );
});
