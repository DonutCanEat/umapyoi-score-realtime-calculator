/**
 * 執行時 log 檔（A6 嘅最小版 ＋ 為咗查「HUD 突然唔見」而加）。
 *
 * ## 為何要（用戶 2026-09-19 報「HUD 出現咗一陣跟住就唔見咗」）
 *
 * 打包版係 GUI 程式（Windows subsystem = WINDOWS）→ **`console.log` 冇地方去**
 * （我哋實測 redirect stdout 一樣係空），所以用戶部機出事嗰陣，唯一嘅證據
 * （`[評價分] …`／`[讀唔到] …`／`[HUD] renderer 死咗 …`）**全部睇唔到**。
 * 有咗 log 檔之後：出事之後直接讀 `<writeRoot>/umapyoi.log` 就有齊現場。
 *
 * ⚠️ 放喺 `writeRootFor()` 決定嘅位置（開發 = 專案根；打包 = userData），
 *    同 dump 幀一樣 —— 打包版 `ROOT` 係唯讀 asar，唔可以寫入。
 *
 * ## 為何要輪替
 *
 * 程式長期開住，正常模式每 30 秒就有機會出一行 → 唔輪替會無限長大。
 * 到上限就**改名做 `.1`**（只留一代），唔會刪走唯一嘅證據。
 *
 * ⚠️ 上限**一定要喺每一行寫入之前都查**（設計審查 L2）：以前淨係 `openLogFile()`
 *    嗰一刻查一次 → **單一長 session**（用戶最常見嘅用法：開住唔閂）可以無限長大，
 *    同上面「唔輪替會無限長大」自己寫嘅理由直接矛盾。
 *    為咗唔喺熱路徑每行 `statSync()`，呢度喺記憶體記住「呢個檔而家幾多 bytes」
 *    （開檔時 stat 一次 ＋ 每次寫入加 `Buffer.byteLength(line)`）。
 */

import { existsSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ⭐ 時間戳（獨立審計 L1）：以前呢度同 `snapshot.js` 各自寫咗一份「唔合法 → 用而家」。
import { safeIso } from './stamp.js';

/** log 檔名（同 `hud-position.json` 一樣擺喺 writable root）。 */
export const LOG_FILENAME = 'umapyoi.log';

/** 到幾大就輪替（2 MB ≈ 十幾萬行，足夠覆蓋一次實機 session）。 */
export const LOG_MAX_BYTES = 2 * 1024 * 1024;

/** log 檔嘅完整路徑（純函數）。 */
export function logFilePathFor(root) {
  if (typeof root !== 'string' || root === '') {
    throw new Error(`log 根目錄要係非空字串，實得 ${JSON.stringify(root)}`);
  }
  return join(root, LOG_FILENAME);
}

/**
 * 一行 log（純函數，方便 `node --test`）。
 *
 * @param {string} level 'log'｜'warn'｜'error'
 * @param {string} text 已經砌好嘅訊息
 * @param {Date} [at]
 */
export function formatLogLine(level, text, at = new Date()) {
  const stamp = safeIso(at);
  return `${stamp} [${level}] ${String(text)}\n`;
}

/** 依大細決定要唔要輪替（純函數）。 */
export function shouldRotate(sizeBytes, maxBytes = LOG_MAX_BYTES) {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return false;
  return sizeBytes >= maxBytes;
}

/**
 * 開一條 log 檔（需要時先輪替），回一個 `write(level, text)` 函數。
 *
 * ⚠️ 所有 I/O 都包 try/catch：**log 寫唔到唔准令程式爆**
 *    （寫 log 係輔助功能，唔應該成為新嘅死因）。
 *
 * ⚠️ 輪替**喺開檔同每一行寫入前**都會查（設計審查 L2）：
 *    `bytes` 係「而家呢個檔已經寫咗幾多 bytes」（開檔 stat 一次 ＋ 之後自己加），
 *    所以單一長 session 一樣守得住 `maxBytes`（唔會無限長大）。
 *
 * @param {string} filePath
 * @param {{maxBytes?:number}} [options]
 * @returns {{path:string, write:(level:string, text:string)=>void, rotated:boolean,
 *            rotations:number, bytesWritten:()=>number}} `rotated` = 開檔時輪替過；
 *            `rotations` = 累計（含寫入期間嘅輪替）；`bytesWritten()` = 而家個檔幾多 bytes
 */
export function openLogFile(filePath, options = {}) {
  const maxBytes = options.maxBytes ?? LOG_MAX_BYTES;
  let rotated = false;
  // 而家呢個檔已經有幾多 bytes（`statSync` 一格都唔夠準：上次寫入之後可能死過機，
  // 所以開檔一定重新 stat 一次，唔可以靠上次 session 嘅數）。
  let bytes = 0;
  let rotateBroken = false; // 輪替失敗過就唔再試（同註釋「輪替失敗唔理：照寫落去」一致）
  let rotations = 0;

  try {
    if (existsSync(filePath)) bytes = statSync(filePath).size;
  } catch {
    bytes = 0; // stat 唔到就當 0（寧願細看細，唔好因為 stat 失敗就連 log 都唔寫）
  }

  /** 輪替（舊檔搬去 `.1`）。@returns {boolean} 成唔成功 */
  const rotateNow = () => {
    try {
      renameSync(filePath, `${filePath}.1`); // 覆蓋上一代（Windows 上同名已存在會 throw → 包住）
      bytes = 0;
      rotations += 1;
      return true;
    } catch {
      rotateBroken = true; // 只有一次機會（再試只會每次寫入都 throw）
      return false;
    }
  };

  try {
    if (bytes > 0 && shouldRotate(bytes, maxBytes)) rotated = rotateNow();
  } catch {
    /* 輪替失敗唔理：照寫落去（大不了個檔大啲） */
  }

  return {
    path: filePath,
    rotated,
    /** 累計輪替次數（唔止開檔嗰一次）。 */
    get rotations() {
      return rotations;
    },
    bytesWritten: () => bytes,
    write(level, text) {
      try {
        const line = formatLogLine(level, text);
        const lineBytes = Buffer.byteLength(line, 'utf8');
        // ⭐ 每一行都查上限（L2）。`bytes > 0` 係防止「單行本身大過上限」時
        //    每行都輪替（一個空檔冇必要輪替）。
        if (!rotateBroken && bytes > 0 && bytes + lineBytes > maxBytes) rotateNow();
        writeFileSync(filePath, line, { flag: 'a', encoding: 'utf8' });
        bytes += lineBytes;
      } catch {
        /* 寫唔到就靜靜放棄（唔准影響主流程） */
      }
    },
  };
}
