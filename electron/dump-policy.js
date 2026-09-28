/**
 * dump（除錯幀）政策（**零 Electron 依賴**）—— 由 `electron/main.js` 抽出來（設計審查 S4 第五刀）。
 *
 * ## 為何要抽
 *
 * 「dump 幾多、dump 邊啲、crop 點解」呢三件事以前散喺 `main.js`：`MAX_DUMPS=40`／
 * `dumpCount`／`okDumps`／`everyCount`／`parseCrop()`／`samePage()` ＋ 兩個呼叫點，
 * **零測試覆蓋**。而佢哋係「出問題之後仲有冇現場可查」嘅唯一保證：
 *
 *   ① **總量上限**（40）：dump 係除錯用，唔准無限寫落用戶硬碟；
 *   ② **成功幀上限**（3）：成功幀只係對照組，多過幾張冇意思；
 *   ③ **每幀模式上限**（`UMAPYOI_DUMP_FRAMES=N`）：頭 N 幀，驗「HUD 有冇被自己影到」用；
 *   ④ **crop 解析**：`UMAPYOI_DUMP_CROP` 唔合法一定要**大聲 throw**（唔准靜默用預設，
 *      否則用戶以為自己設咗，其實 dump 出嚟嘅係另一橛）；
 *   ⑤ **同一頁去重**（連拍收圖）：逐列墨量差異 ≤ 0.01 當同一頁（用戶翻頁會拍到重複）。
 *
 * ⚠️ 語意細節（唔准改）：`noteEveryFrame()` 係「**試過** dump 一格」——
 *    就算寫檔失敗都已經用咗一格（同原本 `everyCount += 1` 喺 `dumpFrame()` **之前**一致）；
 *    而總量同成功幀只喺**真係寫入成功**之後至加（`noteDumped()`）。
 */

/** dump 總量上限（除錯檔，唔准無限寫）。 */
export const MAX_DUMPS = 40;
/** 「成功幀」對照組上限（多過幾張冇意思）。 */
export const MAX_OK_DUMPS = 3;
/** 連拍收圖嘅預設剪裁（對擷取框比例；實機量出嚟，見 `main.js` 嗰段註解）。 */
export const DEFAULT_SKILL_CROP = '0.06,0.16,0.32,0.79';

/**
 * 解析 `UMAPYOI_DUMP_CROP=x,y,w,h`（內容區比例）。
 *
 * ⚠️ 唔合法一律 **throw**（訊息要夠清楚，用戶睇得到自己打錯咩）—— 唔准靜默 fallback。
 *
 * @param {string|undefined|null} value
 * @returns {{x:number,y:number,w:number,h:number}|null} 空值 → `null`（＝用預設）
 */
export function parseCrop(value) {
  if (!value) return null;
  const parts = String(value).split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`UMAPYOI_DUMP_CROP 格式應該係 x,y,w,h（內容區比例），實得「${value}」`);
  }
  const [x, y, w, h] = parts;
  if (w <= 0 || h <= 0) throw new Error(`UMAPYOI_DUMP_CROP 嘅 w／h 要 > 0，實得「${value}」`);
  return { x, y, w, h };
}

/**
 * 兩頁指紋係唔係同一頁（逐列墨量差異 ≤ 0.01 就當一樣）。
 *
 * @param {ArrayLike<number>} a
 * @param {ArrayLike<number>} b
 * @returns {boolean} 長度唔同 → `false`（唔准 throw）
 */
export function samePage(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (Math.abs(a[i] - b[i]) > 0.01) return false;
  }
  return true;
}

/**
 * dump 預算（計數器狀態機）。
 *
 * @param {object} [options]
 * @param {number} [options.maxTotal]
 * @param {number} [options.maxOk]
 */
export function createDumpBudget({ maxTotal = MAX_DUMPS, maxOk = MAX_OK_DUMPS } = {}) {
  let total = 0;
  let ok = 0;
  let every = 0;

  return {
    /** `dumpFrame()` 嘅第一道閘：總量未爆。 */
    canDump() {
      return total < maxTotal;
    },

    /**
     * 「頭 N 幀每幀都存」仲有冇額？
     *
     * @param {number} everyN（`UMAPYOI_DUMP_FRAMES`；0／唔合法 = 唔開）
     */
    canEvery(everyN) {
      return Number.isFinite(everyN) && everyN > 0 && every < everyN;
    },

    /** 成功幀對照組仲有冇額。 */
    canOk() {
      return ok < maxOk;
    },

    /**
     * 記一次「試過 dump 一幀」。
     *
     * @returns {number} 累計試過幾多幀（呼叫方要用嚟 log「第 N 幀已存」）
     */
    noteEveryFrame() {
      every += 1;
      return every;
    },

    /**
     * 真係寫入成功之後叫（總量 ＋ 成功幀）。
     *
     * @param {'every'|'fail'|'ok'|string} kind
     */
    noteDumped(kind) {
      total += 1;
      if (kind === 'ok') ok += 1;
    },

    /** 診斷快照用（每次回新物件，外面改唔到內部狀態）。 */
    state() {
      return { total, ok, every, maxTotal, maxOk };
    },
  };
}
