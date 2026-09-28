/**
 * 擷取凍結 watchdog（**零 Electron 依賴**）—— 由 `electron/main.js` 抽出來（設計審查 S4 第四刀）。
 *
 * ## 為何要抽
 *
 * 呢段係 2026-09-19 實機事故（「一開頭 detect 到，去到一半就固定咗，之後十分鐘都話唔見面板條」）
 * 嘅防線：以前 `main.js` 用 **5 個 module-level 可變全域**（`lastFrameAt`／`framesInWindow`／
 * `recoverAttempts`／`lastRecoverAt`／`heartbeatTick`）散住喺收幀 handler、兩個 `setInterval`、
 * `beginCapture()`、同「強制更新」嗰條路，**零測試覆蓋**。
 * 三條政策最易靜默走樣，所以一定要釘死（有測試）：
 *
 *   ① **節流**：10 秒內唔重複試（唔係嘅話一個凍結會連開幾次擷取）；
 *   ② **上限**：試夠 `MAX_CAPTURE_RECOVERS` 次就**停手**，並大聲叫用戶重開程式
 *      （唔准無限重試，亦唔准靜默）；
 *   ③ **重試之後要「畀新一輪時間」**（`lastFrameAt = now()`）—— 唔係嘅話 5 秒後又話凍結。
 *
 * ⚠️ 呢個模組**唔會自己開 interval**（時間源係外面嘅 `setInterval`），亦唔識 Electron：
 *    「可唔可以重試」（有窗、有 sourceId）同「實際點重試」都由呼叫方注入。
 */

/** 最多自動重試幾次（之後要人手重開程式）。 */
export const MAX_CAPTURE_RECOVERS = 5;
/** 幾耐冇收到幀就當凍結（毫秒）。 */
export const FRAME_FREEZE_MS = 15000;
/** 兩次重試之間最少隔幾久（節流，毫秒）。 */
export const RECOVER_THROTTLE_MS = 10000;
/** 心跳每幾個週期 log 一次（唔係每次都 log，免得洗版；週期由呼叫方嘅 `setInterval` 決定）。 */
export const HEARTBEAT_LOG_EVERY = 5;

/**
 * @param {object} [options]
 * @param {() => number} [options.now] 時間源（測試注入）
 * @param {() => boolean} [options.isStarted] 而家有冇喺擷取（冇 sourceId → 唔檢查凍結）
 * @param {() => boolean} [options.canRestart] 而家**可唔可以**重試（冇窗／窗已 destroy → 唔算一次）
 * @param {(why:string) => void} [options.restart] 真正重啟（main.js 送 IPC）
 * @param {(text:string) => void} [options.onLog]
 * @param {(text:string) => void} [options.onWarn]
 * @param {(text:string) => void} [options.onError]
 */
export function createCaptureWatchdog({
  now = Date.now,
  isStarted = () => true,
  canRestart = () => true,
  restart = () => {},
  onLog = (text) => console.log(text),
  onWarn = (text) => console.warn(text),
  onError = (text) => console.error(text),
} = {}) {
  let lastFrameAt = 0;
  let framesInWindow = 0;
  let recoverAttempts = 0;
  let lastRecoverAt = 0;
  let heartbeatTick = 0;

  /** 最後一幀距離而家幾久（從來冇幀 → `null`）。 */
  const sinceMs = () => (lastFrameAt ? now() - lastFrameAt : null);

  /**
   * 試救：叫 renderer 重新開始擷取。
   *
   * @param {string} why 人類睇得明嘅原因（會入 log）
   * @returns {boolean} 真係試咗重啟？
   */
  function attempt(why) {
    if (!canRestart()) return false;
    if (now() - lastRecoverAt < RECOVER_THROTTLE_MS) return false; // 節流
    if (recoverAttempts >= MAX_CAPTURE_RECOVERS) {
      onError(`[擷取] ⛔ 已經重試 ${recoverAttempts} 次都收唔到幀（${why}）→ 唔再自動試，請重開程式。`);
      return false;
    }
    recoverAttempts += 1;
    lastRecoverAt = now();
    lastFrameAt = now(); // ⭐ 畀新一輪時間（唔係嘅話 5 秒後又話凍結）
    onWarn(`[擷取] ⚠️ ${why} → 重新啟動擷取（第 ${recoverAttempts}/${MAX_CAPTURE_RECOVERS} 次）`);
    try {
      restart(why);
    } catch (error) {
      onError(`[擷取] ⚠️ 重啟失敗：${error?.message ?? error}`);
    }
    return true;
  }

  return {
    /**
     * 直接試救（唔經凍結／心跳檢查）—— 呼叫方自己判斷原因，例如 renderer 報錯。
     *
     * @param {string} why
     * @returns {boolean} 真係試咗重啟？
     */
    attempt,

    /** 有幀到（收幀 handler 每幀叫一次）。 */
    noteFrame() {
      lastFrameAt = now();
      framesInWindow += 1;
    },

    /** 開得成新一輪擷取（`beginCapture()` 用）—— 重試次數歸零，但**唔清**節流時間。 */
    markStarted() {
      lastFrameAt = now();
      framesInWindow = 0;
      recoverAttempts = 0; // 開得成新一輪 → 重試次數歸零
    },

    /**
     * 用戶按「強制更新」＝重新開始：重試次數同節流**一齊**歸零
     * （手動更新之後應該即刻容忍一次自動救援）。
     */
    resetForManualRefresh() {
      recoverAttempts = 0;
      lastRecoverAt = 0;
    },

    /**
     * 凍結檢查（每 5 秒叫一次）：> `FRAME_FREEZE_MS` 冇幀 → 試救。
     *
     * @returns {boolean} 有冇觸發重啟
     */
    checkFreeze() {
      if (!isStarted() || !lastFrameAt) return false;
      const since = now() - lastFrameAt;
      if (since > FRAME_FREEZE_MS) {
        return attempt(`已經 ${Math.round(since / 1000)} 秒冇收到幀`);
      }
      return false;
    },

    /**
     * 心跳（每分鐘叫一次）：一幀都收唔到 → 大聲警告 ＋ 試救；否則每
     * `HEARTBEAT_LOG_EVERY` 個週期報一次幀數。無論如何都把窗口幀數歸零。
     *
     * @returns {'recovered'|'warned'|'logged'|'quiet'}
     */
    heartbeat() {
      heartbeatTick += 1;
      const since = sinceMs() === null ? null : Math.round(sinceMs() / 1000);
      let result = 'quiet';
      if (framesInWindow === 0) {
        // ⚠️ 訊息一定要喺 `attempt()` **之前**砌好：`attempt()` 會推遲 `lastFrameAt`
        //    （「冇幀幾久」係講而家呢一刻，唔係重試之後）。
        onWarn(
          '[擷取] ⚠️ 心跳：最近 60 秒**一幀都收唔到**（最後一幀：'
          + `${since === null ? '從來冇' : `${since} 秒前`}）—— 擷取可能凍結咗`,
        );
        const tried = attempt('60 秒冇收到任何幀');
        result = tried ? 'recovered' : 'warned';
      } else if (heartbeatTick % HEARTBEAT_LOG_EVERY === 0) {
        onLog(`[擷取] 心跳：最近 60 秒收到 ${framesInWindow} 幀（最後一幀 ${since ?? '—'} 秒前）`);
        result = 'logged';
      }
      framesInWindow = 0;
      return result;
    },

    /** 診斷快照用：全部狀態（唔准由外面改到內部狀態 → 每次回新物件）。 */
    state() {
      return {
        lastFrameAt,
        framesInWindow,
        recoverAttempts,
        heartbeatTick,
        lastRecoverAt,
      };
    },
  };
}
