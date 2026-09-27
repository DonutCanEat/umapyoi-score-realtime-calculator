/**
 * 「執行時要寫檔（dump 幀／連拍 PNG）嘅根目錄」嘅決策（純函數，零 Electron 依賴）。
 *
 * ## 為何要（同 `config-path.js` 同一個病，但今次係 A9 打包）
 *
 * `main.js` 兩處會**寫入**檔案：
 *   - `shots/live-debug/`：讀唔清時 dump 嗰幀（`.raw` ＋ `.json`）
 *   - `shots/skill-dump/`：`UMAPYOI_SKILL_DUMP=1` 連拍模式逐頁存 PNG
 * 兩者本來都係 `join(ROOT, 'shots', …)`。開發模式冇問題，但**打包之後
 * `ROOT` ＝ `…/resources/app.asar`（唯讀）** → `mkdirSync()` 會 throw
 * `ENOTDIR`／`EROFS` → 一個「讀唔清」就會令整個程式爆掉（而「讀唔清」係一定會發生嘅事）。
 *
 * 所以「可寫根目錄」同「設定檔位置」一樣要**集中一個決策**，而且一定要 log 實際用咗邊條路徑
 * （唔准靜默 fallback）。
 *
 * ## 規則
 *
 * | 情況 | 根目錄 | 為何 |
 * |---|---|---|
 * | 開發模式（`!isPackaged`）| `<專案根>` | 同以前一樣：`shots/live-debug` 睇得到、`tools/raw-to-png.js` 直接用 |
 * | 已打包 **或者** `ROOT` 喺 `.asar` 入面 | `<userData>` | asar 唯讀；userData 一定寫得入（同 `config-path.js` 一致） |
 *
 * ⚠️ 打包之後嘅 dump 路徑係 `<userData>/shots/live-debug` —— 唔係專案根（打包版冇專案根）。
 *    要睇嗰啲 dump：喺 repo 跑 `node tools/raw-to-png.js "<userData>/shots/live-debug"`。
 */

import { join } from 'node:path';

// ⭐ 獨立審計 M2：同 `config-path.js` 逐項一樣嘅決策收斂成一支。
//    ⚠️ `why` 文案仍然由呢度提供（dump 嘅解釋同設定檔嘅**刻意唔同**，見檔頭）。
import { WRITABLE_ROOT_WHERE, resolveWritableRoot } from './writable-root.js';

/** `writeRootFor()` 回嘅「用咗邊條規則」（方便 log 同測試斷言）。 */
// ⚠️ 同 `config-path.js` **同一個 object**。
export const WRITE_ROOT_WHERE = WRITABLE_ROOT_WHERE;

/**
 * 決定「執行時寫入」嘅根目錄。
 *
 * @param {{
 *   isPackaged?: boolean,   // app.isPackaged
 *   rootDir?: string,       // 專案根目錄（main.js 嘅 ROOT）；開發模式用
 *   userDataDir?: string,   // app.getPath('userData')；打包後用
 * }} options
 * @returns {{root:string, where:string, why:string}} `why` 係一句繁中解釋，直接 log 得
 */
export function writeRootFor({ isPackaged = false, rootDir, userDataDir } = {}) {
  return resolveWritableRoot({
    isPackaged,
    rootDir,
    userDataDir,
    whyDev: '開發模式 → dump／連拍寫喺專案根（睇得到、`tools/raw-to-png.js` 直接用）',
    whyPackaged: '已打包（app.isPackaged=true）→ dump／連拍寫喺 userData（專案目錄可能唯讀）',
    whyAsar: '專案目錄喺 app.asar 入面（唯讀）→ dump／連拍寫喺 userData',
  });
}

/** 由根目錄砌出一個寫入子目錄（純函數，只為免兩邊各寫一次 `join`）。 */
export function underWriteRoot(root, ...parts) {
  if (typeof root !== 'string' || root === '') {
    throw new Error(`writeRoot 要係非空字串，實得 ${JSON.stringify(root)}`);
  }
  return join(root, ...parts);
}
