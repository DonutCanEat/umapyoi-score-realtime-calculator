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
 */

import { existsSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
  const stamp = Number.isNaN(at.getTime()) ? new Date().toISOString() : at.toISOString();
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
 * @param {string} filePath
 * @param {{maxBytes?:number}} [options]
 * @returns {{path:string, write:(level:string, text:string)=>void, rotated:boolean}}
 */
export function openLogFile(filePath, options = {}) {
  const maxBytes = options.maxBytes ?? LOG_MAX_BYTES;
  let rotated = false;
  try {
    if (existsSync(filePath) && shouldRotate(statSync(filePath).size, maxBytes)) {
      const prev = `${filePath}.1`;
      renameSync(filePath, prev); // 覆蓋上一代（Windows 上同名已存在會 throw → 包住）
      rotated = true;
    }
  } catch {
    /* 輪替失敗唔理：照寫落去（大不了個檔大啲） */
  }
  return {
    path: filePath,
    rotated,
    write(level, text) {
      try {
        writeFileSync(filePath, formatLogLine(level, text), { flag: 'a', encoding: 'utf8' });
      } catch {
        /* 寫唔到就靜靜放棄（唔准影響主流程） */
      }
    },
  };
}
