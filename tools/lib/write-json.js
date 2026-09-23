/**
 * 寫 JSON 檔（**原子寫 ＋ fsync**）—— 工具用嘅共用細函數。
 *
 * 為何要（唔止係「靚啲」）：
 *   ① `writeFileSync()` 只係寫入 OS page cache，停電／硬斷電之下會留低**空檔或者半截 JSON**
 *      （同 `src/hud/config.js` 嘅 `saveConfig()` 一樣嘅理由，技術債 §9.1-6）；
 *   ② 收集樣本嘅檔（例如 `data/training-gains.json`）係**用家自己嘅實測紀錄**，
 *      寫壞咗就冇咗 —— 唔可以當佢係即棄 cache。
 *
 * ⚠️ 失敗一定清走 `.tmp`（唔係會喺用戶目錄留垃圾）。
 */

import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * @param {string} path 目標路徑（父目錄唔存在會自動開）
 * @param {unknown} value 要寫嘅值（會 `JSON.stringify(value, null, 2)` ＋ 尾隨換行）
 * @returns {string} 實際寫入嘅路徑
 */
export function writeJsonAtomic(path, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  try {
    const fd = openSync(tmp, 'w');
    try {
      writeSync(fd, text);
      fsyncSync(fd); // ⭐ 一定要喺 rename 之前落磁碟
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
  } catch (error) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* 清唔到都唔應該蓋過原本嗰個錯誤 */
    }
    throw error;
  }
  return path;
}
