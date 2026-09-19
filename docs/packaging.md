# 打包（A9）：Electron → portable 單檔 exe

> 2026-09-19 做（backlog A9）。**唔使開遊戲就做得到**，而且做嗰陣揭發一個真 bug（見 §4）。

## 1. 指令

```bash
npm.cmd run pack:win          # = electron-builder --win portable --publish never
```

輸出：

| 檔案 | 大細（實測 2026-09-19） | 用途 |
|---|---|---|
| `dist/UmapyoiScoreRealtimeCalculator-0.1.0-portable.exe` | **95.7 MB** | ⭐ 交付物：單檔、雙擊即開（NSIS portable，會自己解壓去 `%TEMP%` 再跑） |
| `dist/win-unpacked/` | electron.exe 234.9 MB ＋ `resources/app.asar` | 未壓版（除錯用：可以直接睇 asar 內容、跑得快啲） |

`dist/` **唔入 git**（`.gitignore` 已有）。

⚠️ 我哋環境（DSH agent shell）要留意兩樣，用戶自己部機唔會遇到：

- `npm.cmd install` 會因為沙盒擋咗 piped-stdio spawn 而 `EPERM` → 加 `--ignore-scripts`
  （electron 已經裝好，唔需要 postinstall）。
- electron-builder 內部一樣要 spawn（收集 node modules／nsis）→ 沙盒要放行先跑得完。
- `ELECTRON_BUILDER_CACHE` 可以指入 workspace（`.cache-local/electron-builder/`），
  佢會喺嗰度放 `nsis-3.0.4.1`／`nsis-resources-3.4.1`／`7zip-win-x64`（約 10 MB）。

## 2. 打包設定（`package.json` 嘅 `build` 欄）

| 設定 | 值 | 為何 |
|---|---|---|
| `files` | `electron/**`、`src/**`、`data/glyph-templates.json`、`data/skill-db-tw.json`、`package.json` | ⭐ **白名單**：唔用預設「全包」——`shots/`（證據庫，過百 MB）、`test/`、`tools/`、`docs/` 對打包版完全冇用 |
| `asar` | `true` | 一個檔、載入快；⚠️ **唯讀** → 所有寫入要另找位置（見 §3） |
| `electronDist` | `node_modules/electron/dist` | 直接用**已經下載好**嘅 Electron（唔使再落 235 MB zip）；實測 electron-builder 會 log「using custom unpacked Electron distribution」 |
| `npmRebuild` | `false` | 專案冇 native 依賴 → 唔需要 rebuild（少一個 spawn 失敗點） |
| `win.target` | `portable`（x64） | 單檔 exe |
| `portable.artifactName` | `UmapyoiScoreRealtimeCalculator-${version}-portable.exe` | 檔名帶版本，方便回溯 |

實測 asar 內容 = **48 項**（`node node_modules/@electron/asar/bin/asar.js list dist/win-unpacked/resources/app.asar`），
啱啱好就係白名單：`data/` 2 個 JSON、`electron/` 7 個檔、`src/**`、`package.json`。

## 3. 打包之後嘅路徑規則（⭐ 最重要嘅一節）

打包版 **`ROOT` 唔再係專案根**，而係 `…/resources/app.asar`（**唯讀**）。
所以「寫入」一定要另找位置，兩處都有**純函數 ＋ 單元測試**守住：

| 寫咩 | 決策 | 開發模式 | 打包模式 |
|---|---|---|---|
| `hud-position.json` | `src/hud/config-path.js` `configPathFor()` | `<專案根>/hud-position.json` | `<userData>/hud-position.json` |
| dump 幀／連拍 PNG | `src/hud/write-root.js` `writeRootFor()` | `<專案根>/shots/live-debug`、`/shots/skill-dump` | `<userData>/shots/live-debug`、`/shots/skill-dump` |

`<userData>` ＝ `app.getPath('userData')`，實測打包版係
**`%APPDATA%\umapyoi-score-realtime-calculator\`**（`app.getName()` 用 `package.json` 嘅 `name`，
唔係 `productName`）。

⚠️ **寫入路徑唔准靜默 fallback**：兩個函數喺「開發模式冇 `rootDir`」或者
「打包模式冇 `userDataDir`」都會 **throw**（唔會靜靜寫去一個下次讀唔返嘅位）。

### 為何要 `write-root.js`（A9 揭發嘅真 bug）

`main.js` 本來寫死 `join(ROOT, 'shots', 'live-debug')`。開發模式冇事，但打包之後：
`mkdirSync()` 對 asar 路徑一定 throw（`ENOTDIR`／`EROFS`）——
而嗰段 code 係喺**「讀唔清」出錯嗰陣**才跑（`dumpFrame()`）→
即係「一有問題就成個程式爆」，最差嘅時機。連拍模式（`UMAPYOI_SKILL_DUMP=1`）同理。

修法：抽出 `src/hud/write-root.js`（`writeRootFor()` ＋ `underWriteRoot()`），
`main.js` 用 `debugDir()`／`skillDumpDir()` 兩個小函數（lazy：真正要寫檔先問 `app.getPath`）。

## 4. 驗收（實測紀錄 2026-09-19）

1. **打包成功**：`exit 0`，log 見到 `building target=portable file=dist\…-portable.exe archs=x64`。
2. **asar 內容正確**：48 項，全部都係白名單（冇 `shots/`／`test/`／`tools/`／`docs/`）。
3. **asar 讀得到**（用 Electron 自己嘅 fs —— 普通 Node 讀唔到 asar）：
   ```
   ✓ data/glyph-templates.json：79809 bytes・可 parse = true
   ✓ data/skill-db-tw.json：458862 bytes・可 parse = true
   ✓ electron/main.js：59153 bytes
   ```
4. **打包版真係行到**（`dist/win-unpacked/…exe`）：
   - 正常啟動 → 程序**唔會即刻退出**，而且 `Get-Process` 見到
     `MainWindowTitle = 「Umapyoi 擷取」`（擷取窗真係開咗）。
   - `UMAPYOI_HUD_X=0.9,0.5`（前後倒轉，AGENTS §2 寫明**會 throw**）→ **exit code 1**，
     證明打包版行緊**同一套** main.js 邏輯（唔係空殼）。
   - 第一次啟動就建立 `%APPDATA%\umapyoi-score-realtime-calculator\`（Chromium 快取）→
     userData 位置同上面表格一致。
5. **portable 單檔 exe 開得成**：`dist\…-portable.exe` 跑 20 秒唔會退出。

## 5. 已知未驗／限制（唔准當已驗）

- ⚠️ **未實機對住遊戲跑過**：打包版讀五維／HUD 顯示要開遊戲才驗得到（同開發版一樣嘅管線，
  但打包版係第一次用 asar 路徑）。
- ⚠️ **未驗**：打包版按「儲存」之後 `%APPDATA%\…\hud-position.json` 真係寫入（邏輯有單元測試，
  但冇實機按過）。
- ⚠️ **未設 icon**：electron-builder log 講 `default Electron icon is used`（想換就要放
  `build/icon.ico` 再喺 `build.win.icon` 指過去）。
- ⚠️ **未簽名**：log 有 `signing with signtool.exe`，但冇憑證 → Windows SmartScreen 會攔
  （用戶要「仍要執行」）。另外 **Smart App Control 一定要關**（見 AGENTS §7），
  唔係嘅話 `electron.exe` 會被系統擋。
- ⚠️ portable 版每次開都會解壓去 `%TEMP%`（幾百 MB、幾秒）—— 想要開得快就用
  `--win nsis`（安裝版）或者直接發 `dist/win-unpacked/` 整個資料夾。
- ⚠️ **`data/` 只包兩個檔**（實測 runtime 只讀呢兩個：`glyph-templates.json` 喺 `main.js` 頂層、
  `skill-db-tw.json` 喺 what-if 窗問嗰陣）。將來如果程式要讀**多一個** data 檔
  （`tools/` 用嘅唔算），**一定要同步加落 `build.files`**，唔係打包版會靜默少一個功能
  （`glyph-templates` 缺失只會出警告、唔會爆 —— 即係「靜默壞」）。
