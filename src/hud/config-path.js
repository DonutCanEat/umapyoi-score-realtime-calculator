/**
 * 「HUD 設定檔擺邊」嘅決策（純函數，零 Electron 依賴）。
 *
 * 為何要抽出嚟做獨立一層：`app.isPackaged` 同 `app.getPath('userData')` 只有喺
 * Electron 入面先有，但「揀錯路徑」係一種**靜默災難** —— 用戶按咗「儲存」，
 * 存咗去一個下次開程式已經唔會再讀嘅位（或者打包之後 `ROOT` 指入唯讀 asar
 * → 寫入直接失敗），而用戶完全睇唔出發生咩事。
 * → 決策邏輯抽成純函數，用 `node --test` 守住；`main.js` 只負責餵 `app.*` 嘅值
 *   **同埋一定要 log 實際用咗邊條路徑**（唔准靜默 fallback）。
 *
 * ## 規則
 *
 * | 情況 | 位置 | 為何 |
 * |---|---|---|
 * | 開發模式（`!app.isPackaged`）| `<專案根>/hud-position.json` | 用戶同 agent 都睇得到、改得到、入唔入 git 一眼睇清 |
 * | 已打包 **或者** 專案目錄喺 `.asar` 入面 | `<userData>/hud-position.json` | asar 係唯讀，寫入一定失敗 → 只有 userData 可靠 |
 *
 * ⚠️ `.asar` 判斷唔係多餘：打包之後 `ROOT` ＝ `…/resources/app.asar`，
 * 直接寫入會 throw `ENOTDIR`／`EROFS`。呢個判斷令「打包設定」同「實際行為」一致。
 */

import { join } from 'node:path';

import { HUD_CONFIG_FILENAME } from './config.js';
// ⭐ 獨立審計 M1：「值 → 可讀文字」以前喺呢度**又**寫咗一份（同 util.js 逐個分支一樣）
//    → 收斂成一支，唔然兩邊走樣就會同一份壞值出唔同訊息。
import { describe } from './util.js';
// ⭐ 獨立審計 M2：同 `write-root.js` 逐項一樣嘅「可寫根目錄」決策收斂成一支
//    （同一個 .asar 判斷、同一個分支、同一句 throw）。⚠️ `why` 文案由呢度提供。
import { WRITABLE_ROOT_WHERE, resolveWritableRoot } from './writable-root.js';

/** `configPathFor()` 會回嘅「用咗邊條規則」（方便 log 同測試斷言）。 */
// ⚠️ 同 `write-root.js` **同一個 object**（以前兩份，走樣就會 log 出唔同嘅規則名）。
export const CONFIG_PATH_WHERE = WRITABLE_ROOT_WHERE;

/**
 * 決定 HUD 設定檔嘅完整路徑。
 *
 * @param {{
 *   isPackaged?: boolean,      // app.isPackaged
 *   rootDir?: string,          // 專案根目錄（main.js 嘅 ROOT）；開發模式用
 *   userDataDir?: string,      // app.getPath('userData')；打包後用
 *   filename?: string,         // 預設 hud-position.json（由 config.js 借過嚟，兩邊唔會走樣）
 * }} options
 * @returns {{path:string, where:string, why:string}} `why` 係一句繁中解釋，直接 log 得
 */
export function configPathFor({
  isPackaged = false,
  rootDir,
  userDataDir,
  filename = HUD_CONFIG_FILENAME,
} = {}) {
  if (typeof filename !== 'string' || filename === '') {
    throw new Error(`設定檔名要係非空字串，實得 ${describe(filename)}`);
  }
  if (filename.includes('/') || filename.includes('\\')) {
    throw new Error(`設定檔名唔可以有路徑分隔符（只係一個檔名），實得「${filename}」`);
  }

  const { root, where, why } = resolveWritableRoot({
    isPackaged,
    rootDir,
    userDataDir,
    whyDev: '開發模式（app.isPackaged=false）→ 擺喺專案根目錄（睇得到、改得到、唔入 git）',
    whyPackaged: '已打包（app.isPackaged=true）→ 擺喺 userData（專案目錄可能唯讀）',
    whyAsar: '專案目錄喺 app.asar 入面（唯讀）→ 擺喺 userData',
  });
  // ⚠️ 呢度只負責「根目錄 ＋ 檔名」；「揀邊個根目錄（連 throw）」一律由 `resolveWritableRoot()` 決定。
  return { path: join(root, filename), where, why };
}
