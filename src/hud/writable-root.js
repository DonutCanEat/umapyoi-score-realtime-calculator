/**
 * 「執行時可寫入嘅根目錄」嘅**唯一**決策（純函數，零 Electron 依賴）—— 獨立審計 M2。
 *
 * ## 為何要抽
 *
 * 同一條規則以前有**兩個實作**：`config-path.js`（HUD 設定檔擺邊）同
 * `write-root.js`（dump 幀／連拍 PNG 寫邊）。兩者逐項一樣：
 *   · 同一個 `.asar` 判斷（`/\.asar([\\/]|$)/i`）；
 *   · 同一個分支（`!isPackaged && !inAsar` → 專案根；否則 → userData）；
 *   · 同一句 throw（「唔准靜默用其他位置」）；
 *   · 同一組 enum 值（`dev-root`／`packaged-userData`）。
 *
 * 為何唔可以任由佢分裂：呢個決策**冇第二次機會** —— 揀錯路徑嘅症狀係
 * 「用戶按咗儲存，下次開程式讀唔返」或者**打包版一寫檔就爆**
 * （`ROOT` 喺唯讀 asar 入面 → `ENOTDIR`／`EROFS`），而兩者都係靜默嘅。
 *
 * ## ⚠️ 唯一嘅唔同：`why` 文案（唔准統一）
 *
 * 兩個模組嘅 `why` **刻意唔同**：
 *   · 設定檔：講「睇得到、改得到、唔入 git」；
 *   · dump／連拍：講「`tools/raw-to-png.js` 直接用」。
 * 兩句都有人（同測試）靠 —— 所以呢度食 `whyDev`／`whyPackaged`／`whyAsar` 三個參數，
 * **唔准**喺呢度寫死一句通用文案。
 */

/** 「用咗邊條規則」嘅 enum（設定檔同 dump 共用**同一個** frozen object）。 */
export const WRITABLE_ROOT_WHERE = Object.freeze({
  devRoot: 'dev-root',
  packagedUserData: 'packaged-userData',
});

/**
 * 決定可寫入嘅根目錄。
 *
 * @param {{
 *   isPackaged?: boolean,   // app.isPackaged
 *   rootDir?: string,       // 專案根目錄（main.js 嘅 ROOT）；開發模式用
 *   userDataDir?: string,   // app.getPath('userData')；打包後用
 *   whyDev: string,         // 開發模式嘅解釋（呼叫方提供，見檔頭）
 *   whyPackaged: string,    // 已打包嘅解釋
 *   whyAsar: string,        // 專案目錄喺 .asar 入面嘅解釋
 * }} options
 * @returns {{root:string, where:string, why:string}}
 */
export function resolveWritableRoot({
  isPackaged = false,
  rootDir,
  userDataDir,
  whyDev,
  whyPackaged,
  whyAsar,
} = {}) {
  // ⚠️ `.asar` 判斷唔係多餘：打包之後 `ROOT` ＝ `…/resources/app.asar`，
  //    直接寫入會 throw `ENOTDIR`／`EROFS`。呢個判斷令「打包設定」同「實際行為」一致。
  const inAsar = typeof rootDir === 'string' && /\.asar([\\/]|$)/i.test(rootDir);

  if (!isPackaged && !inAsar) {
    if (!rootDir) throw new Error('開發模式（isPackaged=false）要提供 rootDir —— 唔准靜默用其他位置');
    return { root: rootDir, where: WRITABLE_ROOT_WHERE.devRoot, why: whyDev };
  }

  if (!userDataDir) {
    throw new Error('已打包／asar 模式要提供 userDataDir（app.getPath("userData")）—— 唔准靜默用其他位置');
  }
  return {
    root: userDataDir,
    where: WRITABLE_ROOT_WHERE.packagedUserData,
    why: inAsar ? whyAsar : whyPackaged,
  };
}
