# Electron 去重审计报告

> 版本：**2026-09-19 按現行樹重核**（基準 commit `8febf94`，267 測試全過、`fit-score` 5/5 誤差 0）
> ⚠️ 第一版報告係對住舊樹寫嘅：當時嘅 **H1（適性規則雙實作）已經修好**
> （`src/umascore/aptitude.js` 已存在，檔頭註釋自己引用「獨立審計 H1」）；
> `src/vision/anchor.js`／`panel.js` 亦已經清走（A8）。以下係重核之後嘅結果。

## 摘要

- 工作區：`D:\File\Program Project\Umapyoi Score Realtime Calculator`（獨立 git 倉庫）
- 掃描範圍（分層）：
  - **main**：`electron/main.js`（~1630 行，唯一主程序）
  - **preload**：**冇**（刻意冇；4 個 renderer 都用 `nodeIntegration:true` + `contextIsolation:false` + classic script，理由見 AGENTS §6.3）
  - **renderer**：`electron/capture.html`、`hud.html`、`settings.html`、`whatif.html`
  - **shared（Node 側純邏輯，零 Electron）**：`src/hud/`（5）、`src/vision/`（9）、`src/umascore/`（9）、`src/capture/`（1）、`src/cli.js`
  - **tools（診斷／驗收 CLI）**：`tools/`（32）
  - **test**：`test/`（23 檔、267 條）
- 排除目錄：`node_modules/`、`.git/`、`.npm-cache/`、`.electron-cache/`、`.cache-local/`、`dist/`、`out/`、`diagnostics/`、`shots/**/*.png`（證據庫）、`data/*.json`（生成物）
- 文件約數：**85 個原始檔**（main 1、renderer 4、shared 25、tools 32、test 23）
- 發現簇數：high **3** / med **9** / low **3**
- **已修／已消失**（唔再係問題）：適性規則雙實作（`aptitude.js`）、`anchor.js`／`panel.js` 棄用碼、
  `settings.html` `round()` vs `round6()`（**已經有閘**：`test/hud-settings-html.test.js` 真係由 HTML 抽出 `round()`／`fieldBounds()` 再執行比對）

## Top 问题

- **H1** · `extractShared` · IPC channel 字串散落 5 個檔（**現時 24 條**，含新增 8 條 `whatif-*`），冇 channel map、冇靜態閘
- **H2** · `nearDuplicate` · 「切字元 → 讀數 → 信心閘」主迴圈喺 `reader.js` 同 `statbar.js` 各寫一套
- **H3** · `extractShared` · 16:9 內容框推算三處，而 `roi.aspect` 呢個 IPC 欄位**傳咗但 renderer 冇讀**
- **M1** · 環境變數讀法三個半實作（`envFlag()`、`Boolean(process.env.X)`、`Number(...||0)`、「有冇 set」×2）
- **M2** · **四個** `BrowserWindow` 工廠重複 `webPreferences`／`setContentProtection`／`loadFile`／`closed` 清理
- **M3** · 逐列／逐欄墨量投影同「連續段掃描」演算法 9 處變體（`src/vision/`）
- **M4** · `pickBestFive()` / `pickFiveBySpacing()`：同一套組合搜尋（連 `advance()` 都一樣）寫兩次
- **M5** · HUD 設定檔寫入路徑兩套（`.tmp` + `rename` vs 直接 `writeFileSync`）
- **M6** · tools CLI 參數解析 5 種寫法、散落 25+ 檔
- **M7** · 色相／亮度／分位數計算喺 tools 重複（`diag-hue.js` 自己一套 `hsv()`）
- **M8** · 去均值＋L2 歸一化／內積相似度兩套（`glyphs.js` vs `skillname.js`）
- **M9** · tools 顯示寬度／`pad()`／CJK 寬字正則抄兩份
- **L1** · `src/hud` 兩個檔各有一套 `describe()`（＋`clamp()`／`num()` 小工具）
- **L2** · `test/` 內 4 個 `makeImage()` fixture builder
- **L3** · `main.js` 兩個 dump 函數共用「建目錄＋時間戳＋寫檔」

## 重复簇明细

### H1 · extractShared · IPC channel 字串散落 5 個檔（冇 channel map）

- 位置：
  - `electron/main.js`：`ipcMain.on` L1331（`frame`）、L1439（`capture-error`）、L1454／L1465／L1480／L1501（`hud-config-*`）、L1522／L1532／L1555／L1567（`whatif-*`）、L1589／L1601／L1622（`hud-drag-*`）；`webContents.send` L901（`hud`）、L1246（`no-source`）、L1257（`roi`）、L1266（`start`）、L1268（`fps`）、L1269（`crop`）
  - `electron/capture.html` L59、L64、L69、L78、L85、L109、L178
  - `electron/hud.html` L130、L190、L201、L213
  - `electron/settings.html` L406、L422、L518、L521、L532
  - `electron/whatif.html` L311、L317、L352、L355、L359、L375、L386、L396、L405、L407
- 分層：main + renderer（×4）
- 證據：24 條 channel 全部係字面值，每條最少寫兩次，冇任何機制強制對齊：
  ```js
  ipcMain.on('whatif-eval', (event, payload) => { … });                    // main.js L1567
  ipcRenderer.send('whatif-eval', { key: picked.key, stats, grades });     // whatif.html L311
  ```
  ⚠️ `send` 去冇 handler 嘅 channel **唔會報錯**（`ipcRenderer.send` 靜默丟棄）→ 打錯一個字母＝靜默死線。`check-renderer-syntax.js` 只驗語法，捉唔到 channel 名。
- 建議模組：`electron/ipc-channels.cjs`（`IPC_CHANNELS` 凍結物件）＋ 一條**靜態閘測試** `test/ipc-wiring.test.js`
- 風險：IPC boundary
- 工作量：S（閘測試）＋ S（map，可選）
- 改造建議：
  1. ⚠️ Renderer 係 classic script（`require('electron')`、ESM 會被 `file://` CORS 擋，AGENTS §6.3）→ 共用檔一定要係 **`.cjs`** 或者 JSON，唔可以 `export const`。
  2. 第一步做**零行為改動嘅靜態閘**（照 `test/hud-settings-html.test.js` 嘅做法，真係由檔案抽字面值）：
     ① 由 `main.js` 抽 `ipcMain.on('X')` → 集合 A；② 由 4 個 HTML 抽 `ipcRenderer.send('X')` → 集合 B；斷言 `B ⊆ A`；
     ③ 抽 `webContents.send('X')` → C，`ipcRenderer.on('X')` → D，斷言 `C ⊆ D`；
     ④ 順手斷言「兩邊都有嘅 channel 一定同名」（捉改名唔同步）。
     ⚠️ 唔准斷言 `A ⊆ B`（將來可能加「暫時冇人用」嘅 handler），亦唔准逐檔硬綁（`hud` 只去 hud.html 係實作細節，綁死會令重構變難）。
  3. 第二步（可選）才換 `IPC_CHANNELS.*`，一次一個 channel。

### H2 · nearDuplicate · 「切字元 → 讀數 → 信心閘」主迴圈兩套

- 位置：`src/vision/reader.js` `readStats()`（L38 起，迴圈 L43–53）vs `src/vision/statbar.js` `readStatBar()`（L484 起，迴圈 L495–514）
- 分層：shared（`src/vision`）
- 證據：兩邊都係「逐個數字框 → `extractGlyphs()` → `readNumberTrimmed()` → 取 `min` 做信心 → 唔係純數字就帶 reason 回 null」：
  ```js
  // reader.js L45–52
  for (const num of row.numbers) {
    const glyphs = extractGlyphs(image, mask, { x0: num.x0, x1: num.x1 }, row.y0, row.y1);
    const read = readNumberTrimmed(glyphs, templates, options);
    confidence = Math.min(confidence, read.confidence);
    if (!/^\d+$/.test(read.text)) return { stats: null, confidence, row, reason: `第 ${texts.length + 1} 個數字讀唔清（「${read.text}」）`, … };
  ```
  ```js
  // statbar.js L495–514：同一個迴圈，但（a）多 detail 字串、（b）每格 mask 可能唔同（金色格）
  const read = readNumberTrimmed(entry.glyphs, templates, o);
  confidence = Math.min(confidence, read.confidence);
  if (!/^\d+$/.test(read.text)) { const detail = …; return { … reason: `第 ${i + 1} 個數值讀唔清…` }; }
  ```
  兩個 reader 嘅「唔出數」出口亦已經分開演化：`statbar` 有 `notBar`／`highlighted`／`minConfidence`，`reader` 有 `MIN_STAT`／`MAX_STAT` 範圍閘。
- 建議模組：`src/vision/readGlyphs.js` → `readGlyphBoxes({ image, boxes, templates, options, maskFor, describeDetail })`
- 風險：none
- 工作量：M
- 改造建議：
  1. 抽共同部分（`extractGlyphs` + `readNumberTrimmed` + `min` 信心 + 失敗索引），`maskFor(num)` 同 `describeDetail(num, read, i)` 由呼叫者注入。
  2. ⚠️ **唔准**合併兩個 reader 嘅門檻／措辭／出口（`notBar`、`highlighted`、信心閘、`MIN_STAT`／`MAX_STAT`）—— 呢啲係實機量出嚟嘅安全邊界同診斷訊息。
  3. 驗收（§8）：`node tools/diag-statbar.js --read` → 14/14 ＋ 負樣本 6/6；`build-glyph-templates --exclude=uma2 --verify` → 面板 30/30 ＋ 實機 14/14 ＋ 負樣本 6/6；`replay-dumps` 退步 0。

### H3 · extractShared · 16:9 內容框推算三處（＋一個傳咗冇人讀嘅 IPC 欄位）

- 位置：
  - `src/hud/layout.js` L18（`CONTENT_ASPECT`）、L69–79（`contentRect()`）
  - `src/vision/statbar.js` L65（`aspect: 9/16`）、`contentBox()`
  - `electron/capture.html` L41（`const CONTENT_ASPECT = 9 / 16;`）、L133–134（`contentH`／`contentTop`）
  - `electron/main.js` L1258、L1264（經 IPC 傳 `aspect`）
- 分層：shared + main + renderer
- 證據：同一條規則（「圖比 16:9 高 → 多出嘅部分喺**頂部**」）三份實作，`layout.js` 自己都寫明「跟 `statbar.js` 嘅 `contentBox()` 同一條規則」＝靠人記住。⭐ **已經漂移**：`main.js` 傳咗 `aspect`，而 `capture.html` L64–66 收到之後只 `roi = rect`，**從來冇讀 `rect.aspect`**。
- 建議模組：`src/vision/content-box.js` → `contentBox(frame, aspect)` 回 `{ x, y, width, height, top }`；`layout.contentRect()` 變薄 wrapper，`capture.html` 用主程序傳落嚟嘅 `rect.aspect ?? (9/16)`
- 風險：IPC boundary（renderer 唔可以 import ESM）
- 工作量：S
- 改造建議：
  1. 先**接線**（行為等價：今日 `aspect` 一定係 `9/16`），令兩邊即刻同一個來源；呢一步單獨 commit。
  2. 再抽 `contentBox()` 一支，`contentRect()` 同 `statbar.contentBox()` 都叫佢。
  3. ⚠️ `main.js` 自認嘅「`area` 係 DIP、`game.width` 係物理像素」單位問題**唔喺本次範圍**，唔准順手改。
  4. 驗收：`npm.cmd test`（`hud.test.js`）＋ `node tools/check-renderer-syntax.js`＋（因為動到 `capture.html`）`diag-statbar --read` 14/14、負樣本 6/6、`replay-dumps` 退步 0。

### M1 · extractShared · 環境變數讀法三個半實作

- 位置：
  - 正解：`src/hud/env-flag.js` L42–56（`envFlag()`）；`main.js` L135–141 四個旗標都用佢
  - `electron/main.js` L967：`const SKILL_DUMP = Boolean(process.env.UMAPYOI_SKILL_DUMP);` ← ⛔ 違反 AGENTS §2「唯一讀法」
  - `electron/main.js` L950、L969、L1268：`Number(process.env.X || 0) || 0`（同款寫三次）
  - `electron/main.js` L313（`hudEnvOverridden` 自己判「有 set」）vs `src/hud/config.js`（`set()`）
- 分層：main（＋shared 應為單一來源）
- 證據：
  ```js
  const DUMP_EVERY = Number(process.env.UMAPYOI_DUMP_FRAMES || 0) || 0;   // main.js L950
  const SKILL_DUMP = Boolean(process.env.UMAPYOI_SKILL_DUMP);             // main.js L967
  const SKILL_MAX  = Number(process.env.UMAPYOI_SKILL_MAX || 400) || 400; // main.js L969
  ```
  ⚠️ 具體後果：`UMAPYOI_SKILL_DUMP=0` 而家會**開咗**連拍模式（`'0'` 係非空字串 = truthy）—— 同 AGENTS 記過嘅 `UMAPYOI_NO_HUD=0` 坑一模一樣。
- 建議模組：擴充 `src/hud/env-flag.js` → `envNumber(name, { env, fallback })`、`envIsSet(name, env)`
- 風險：none（但 `SKILL_DUMP` 換 `envFlag()` 係**行為改動**，要獨立 commit ＋ 更新 AGENTS §2）
- 工作量：S
- 改造建議：先加兩個純函數（連測試，跟現有 `env-flag` 測試嘅風格：`onWarn` 可收集、唔 intercept console）→ 換 `Number(...)` 三處（純等價）→ 最後才單獨處理 `SKILL_DUMP` 嘅旗標語意（寫明係改動）。

### M2 · nearDuplicate · 四個 BrowserWindow 工廠重複

- 位置：`electron/main.js` L185–227（HUD）、L748–771（設定窗）、L787–808（what-if 窗）、L1069–1083（擷取窗）
- 分層：main
- 證據：
  ```js
  webPreferences: { nodeIntegration: true, contextIsolation: false },  // L200 / L765 / L802 / L1076（四處一樣）
  win.setContentProtection(true);                                       // L219 / L770 / L807 / L1082
  win.loadFile(join(__dirname, 'x.html'));                              // L227 / L771 / L808 / L1083
  ```
- 建議模組：`electron/window-factory.js` → `createAppWindow({ file, options, onClosed })`
- 風險：security exposure（`contextIsolation:false` ×4；本專案係**刻意**設計，但集中一處之後將來收緊只改一個位）
- 工作量：M
- 改造建議：抽共用部分；⛔ **唔准**把 HUD 嘅 `setIgnoreMouseEvents(true)` → `setFocusable` → `setHudInteractive(HUD_EDIT)` 次序搬入通用工廠（AGENTS §6.4 四重保險）；HUD（透明／`frame:false`／`focusable:false`）同其他三個窗（有框／可 focus）物理上互斥，唔可以「統一」。

### M3 · nearDuplicate · 逐列／逐欄墨量投影同「連續段掃描」9 處變體

- 位置（全部 `src/vision/` ＋ `main.js` 一處）：
  - 列投影：`inkmask.js` L222（`maskRowCounts`）、`skillscreen.js` L82（`rowInkProfile`）、`denseBands`（`digitrow.js` L185）、`tightenBand`（L231）、`detectDigitRow` 內墨量迴圈、`statbar.js` 嘅 `countInk`／`bandStats`
  - 欄投影：`digitrow.js` `columnsToGroups`（L38）、`glyphs.js` `extractGlyphs`（L27）、`skillscreen.js` `nameBoxInSpan`／`columnSpans`、`skillname.js` `nameBoxFeature`／`nameBoxesOfPage`、`main.js` `dumpSkillPage` 內嘅進度欄投影（L1011 起）
  - 段掃描：`findTextLines`（`inkmask.js` L244）、`findSkillRows`（`skillscreen.js`）、`denseBands`、`tightenBand`、`columnsToGroups`、`nameBoxesInRow`、`columnSpans`、`trimNameSegments`（`skillname.js`）
- 分層：shared（`src/vision`）+ main（1 處）
- 證據：同一句「逐行加總」散落多次：
  ```js
  for (let y = y0; y <= y1; y += 1) { const base = y * width; for (let x = 0; x < width; x += 1) n += mask[base + x]; }
  ```
  同一句「gap 累積到門檻就切段」散落 9 次（`minGap=3`／`gapMax=width*0.02`／`gapMax=width*clusterGap`／`gapNeed=10`…骨架一樣、參數唔同）。
- 建議模組：`src/vision/projection.js` → `rowCounts(mask, width, y0, y1)`、`columnCounts(mask, width, y0, y1, { x0, x1 })`、`runSpans(values, { minValue, minGap })`、`densestRun(values, { ratio })`
- 風險：none
- 工作量：M（拆兩個 commit）
- 改造建議：
  1. 先抽**完全等價**嘅投影（逐位元一樣），風險最低。
  2. `runSpans()` 逐個呼叫點**保留原本參數同 ink 語意**（有啲點計 `ink`、有啲唔計）——呢啲門檻全部係實測安全邊界（pitfalls #14／#18／#21／#26），**唔准「順手調成一致」**。
  3. `tightenBand()` 嘅「揀墨量最多嘅連續段」係特例，唔好強行歸一。
  4. 驗收：§8 全套（267 test／`diag-statbar --read` 14/14＋負樣本 6/6／`--verify` 30/30＋14/14＋6/6／`diag-hue --assert`／`replay-dumps` 退步 0／`diag-skills --all` 7 列）。

### M4 · nearDuplicate · `pickBestFive()` vs `pickFiveBySpacing()`：組合搜尋寫兩次

- 位置：`src/vision/digitrow.js` L112–148 vs `src/vision/statbar.js`（`pickFiveBySpacing`；`advance()` 分別喺 L119／L320，**逐字一樣**）
- 分層：shared（`src/vision`）
- 證據：
  ```js
  const idx = [0, 1, 2, 3, 4];
  const advance = () => { let i = 4; while (i >= 0 && idx[i] === n - 5 + i) i -= 1; … };
  ```
  成本函數刻意唔同（`digitrow` 用闊度＋間距變異；`statbar` 只用右邊界 `x1` 間距 —— 地雷 #23 嘅解法）。
- 建議模組：`src/vision/combinations.js` → `forEachCombination5(n, fn)`
- 風險：none｜工作量：S
- 改造建議：只抽迭代器；⚠️ 唔准把 `pickFiveBySpacing` 退回「闊度」判準。

### M5 · nearDuplicate · HUD 設定檔寫入路徑兩套（原子性唔一致）

- 位置：`electron/main.js` L350–353（`saveHudConfigFile()`：`.tmp` + `renameSync`）vs `src/hud/config.js` L591（`saveConfig()`：直接 `writeFileSync`）
- 分層：main vs shared
- 證據：`main.js` L352–353 自己砌 tmp 再做原子寫；`saveConfig()` 其他呼叫者（含 6 處測試）係直接寫 → 原子性依賴呼叫者。
- 建議模組：`src/hud/config.js` → `saveConfig(config, { filePath, atomic = true })`
- 風險：none（但涉用戶 `hud-position.json`，**唔准改輸出格式**：2 空格縮排＋尾隨換行）
- 工作量：S
- 改造建議：把 `.tmp` + `rename` 收入 `saveConfig()`，`main.js` 只保留 log 同 env 覆蓋警告；加「寫入中途失敗唔留半個檔」測試。

### M6 · nearDuplicate · tools CLI 參數解析 5 種寫法、25+ 檔

- 位置（節錄）：
  - `includes('--x')`：`tune-detect.js` L26–27、`fill-ground-truth.js` L36、`build-glyph-templates.js` L38、`diag-hue.js` L30、`advice.js` L37
  - `.find(a => a.startsWith('--name='))`：`skillname-sheet.js` L27、`skill-lib-sheet.js` L25、`find-skill-crop.js` L31、`build-skill-library.js` L38、`read-stats.js` L31、`diag-row.js` L36
  - `filter` flags／positional：`skillrow-sheet.js` L25–29、`dump-namebox.js` L22–24、`diag-namepairs.js` L27–30、`diag-nameocl.js` L39–42、`diag-namematch.js` L37–38
  - `Set(process.argv)`：`whatif.js` L36、`collect-diagnostics.js` L34
  - 手寫 `parseArgs()`：`fit-score.js` L22–30、`fetch-skill-db.js` L34、`src/cli.js`
- 分層：tools（＋`src/cli.js`）｜風險：none｜工作量：M
- 建議模組：`tools/lib/args.js` → `parseToolArgs(argv, { flags = [], values = [] })`
- 改造建議：⚠️ AGENTS §2 每條指令簽名係**對外介面**（`--gt=`／`--verify`／`--exclude=`／`--trace`／`--cropped`／`--quick`／`--hue`／`--all`／`--match=`…），逐字保留；一個 commit 一個工具，跑返該工具原本嘅驗收。

### M7 · nearDuplicate · 色相／亮度／分位數計算喺 tools 重複

- 位置：正解 `src/vision/inkmask.js` L65–76（`pixelHue`）、L114（亮度）；重複 `tools/diag-hue.js` L39–51（`hsv()`：同一條 hue ＋同一條亮度公式）、L53–57（`pct()`）、`tools/diag-scale.js`（兩處 inline 亮度）；另一套分位數 `src/vision/statbar.js` `inkHuePercentile()`
- 分層：tools vs shared｜風險：none｜工作量：S
- 建議模組：`inkmask.js` 加出 `pixelLum(r,g,b)`、`percentile(sorted, p)`；`diag-hue.js`／`diag-scale.js` 直接 import
- 改造建議：只抽純函數，唔准改任何 `DEFAULT_INK_OPTIONS` 值；改完即刻跑 `node tools/diag-hue.js --assert`。

### M8 · nearDuplicate · 「去均值＋L2／內積相似度」兩套

- 位置：`src/vision/glyphs.js` L116–136（`standardize()`／`similarity()`）vs `src/vision/skillname.js` L181–194（`nameBoxFeature()` 尾段＋`nameSimilarity()`）
- 分層：shared（`src/vision`）｜風險：none｜工作量：S
- 建議模組：`src/vision/similarity.js` → `standardizeVec(vec)`、`cosineSimilarity(a, b)`
- 改造建議：只抽「去均值＋L2＋內積」；**特徵抽取唔准動**（`glyphs` 16×24 面積採樣 vs `skillname` 480×40 絕對尺度＋輕微模糊，差異係刻意嘅，見 AGENTS §6.5）。驗收：`test/skillname.test.js`、`test/vision.test.js`。

### M9 · nearDuplicate · tools 顯示寬度 `pad()` ＋ CJK 寬字正則抄兩份

- 位置：`tools/fit-score.js` L73–86（`WIDE`／`displayWidth`／`pad`／`lpad`）vs `tools/breakdown.js` L25–30（同一條正則 inline ＋ `pad`／`num`）
- 分層：tools｜風險：none｜工作量：S
- 建議模組：`tools/lib/width.js` → `displayWidth()`／`pad()`／`lpad()`
- 改造建議：抽一支；`fit-score` 嘅報表格式係「5/5 誤差 0」驗收嘅一部分，輸出闊度要肉眼對一次。

### L1 · nearDuplicate · `src/hud` 兩個檔各有一套 `describe()`

- 位置：`src/hud/layout.js`（`describe()`／`clamp()`／`num()`）vs `src/hud/config.js`（`describe()`／`numAt()`／`isPlainObject()`）
- 分層：shared（`src/hud`）｜風險：none｜工作量：S
- 建議模組：`src/hud/util.js`（或者由 `layout.js` export）
- 改造建議：⚠️ 兩邊措辭**唔一樣**（`config.js` 多一個「字串用引號包住」分支）→ 只抽共同部分，錯誤訊息唔准統一（測試有斷言訊息內容）。

### L2 · nearDuplicate · `test/` 內 4 個 `makeImage()` fixture builder

- 位置：`test/statbar.test.js` L41、`test/skillscreen.test.js` L21、`test/skillname.test.js` L30、`test/vision.test.js` L23（`makeCanvas`）
- 分層：test｜風險：none｜工作量：S
- 建議模組：`test/helpers/image.js`
- 改造建議：⚠️ 只抽「砌底色 RGBA buffer」呢一步；每個測試嘅**合成內容**（字形、格距）係刻意唔同嘅實測情境，唔准合併。⚠️ 亦唔准為咗共用而改測試語意（267 條要全過）。

### L3 · nearDuplicate · `main.js` 兩個 dump 函數共用「建目錄＋時間戳＋寫檔」

- 位置：`electron/main.js` `dumpSkillPage()`（L1011 起）vs `dumpFrame()`（L1052 起）
- 分層：main｜風險：none｜工作量：S
- 建議模組：`electron/main.js` 內部小工具（唔值得開新檔）：`ensureDir()`＋`writeDumpFile()`
- 改造建議：只抽「`existsSync` + `mkdirSync(recursive)` + 時間戳」；⚠️ 兩個 dump 嘅**檔案格式唔同**（`.raw`＋`.json` vs `.png`），唔准統一。

## 不建议动的项

- `node_modules/`、鎖檔、`dist/`、`out/`、`diagnostics/`：第三方／建置／一次性支援資料。
- `data/glyph-templates.json`、`data/skill-db-tw.json`：**生成物**（由 `build-glyph-templates.js`／`fetch-skill-db.js` 產），唔可以手改。
- `shots/**/*.png`（尤其 `live/roi-regress-*.png`、`negatives/`）：**證據庫／永久回歸樣本**，AGENTS §0 明講要入 git。
- `data/ground-truth/*.json`、`data/live-truth.json`、`data/skill-name-labels.json`（已知有錯位）：人手真值，唔准「整理」。
- 四個 HTML 嘅 inline CSS 同 classic-script 寫法（`require('electron')`）：主題／用途完全唔同，而且 `file://` 下 ESM 唔可行（AGENTS §6.3）→ H1／H3 一定要用**靜態閘測試**或者 **IPC 傳值**，唔可以改成 import。
- ✅ `electron/settings.html` 嘅 `round()`／`fieldBounds()`：**已經有閘**（`test/hud-settings-html.test.js` 真係由 HTML 抽出嚟執行比對）→ 唔需要再抽，亦唔准改 HTML 嘅寫法令 regex 對唔上。
- ✅ `src/umascore/aptitude.js`：**已經係單一來源**（上一輪審計 H1 已修），唔准再開第二套適性規則。
- `src/umascore/tables.js` 嘅公式常數表（`STAT_KOEFFI`／`RANK_THRESHOLDS`）：本身係單一來源。
- 一堆 `normalize*` 同名函數（`normalizeGlyph`／`normalizeStats`／`normalizeValidateOptions`／`normalizeName`…）：似但語意唔同，**唔係重複**。
- 文件之間嘅重複敘述（AGENTS／`docs/design.md`／`docs/pitfalls.md`／程式碼註釋三處講同一件事）：刻意嘅跨檔冗餘。

## 建议落地顺序

1. **H1**：IPC wiring 靜態閘測試（純新增測試、零行為改動）；跑 `npm.cmd test`。
2. **H3**：先接線 `roi.aspect`（行為等價，單獨 commit）；之後再抽 `contentBox()`。
3. **H2**：抽 `readGlyphBoxes()`；驗收 §8 全套。
4. **M1**：`envNumber()`／`envIsSet()` → 換 `Number(...)` 三處 → 最後單獨處理 `SKILL_DUMP` 旗標語意。
5. **M5** → **M4** → **M8** → **M7** → **M9** → **M6**（其餘 tools）→ **M2** → **M3**。
6. **L1–L3**：順手做（每個獨立 commit）。

## 备注

- 本报告由只读审计 Preset 生成（唯一寫入係本報告檔）；未修改任何業務源碼。
- 若涉及 model/DTO，建议字段全部可选，避免缺字段导致解析失败。本專案實例：main → renderer 嘅 `roi` payload 有選填欄位 `aspect`（**現時冇人讀**）、`frame` payload 嘅 `cropped` 亦係選填；將來若收成共用 model，**所有欄位一律 optional ＋ 有預設**（要向後兼容「新 main ＋ 舊 renderer」同「舊 main ＋ 新 renderer」）。
- 本專案**冇 preload**：如果將來加，`electron/ipc-channels.cjs`（H1）正好可以一次過變成 preload 嘅白名單來源。
- 每次改動之後嘅驗收閘（AGENTS §8）：`npm.cmd test` 267 全過、`fit-score` 5/5 誤差 0、動影像就 30/30＋14/14＋負樣本 6/6、動墨點／色相就 `diag-hue --assert`、動 `statbar.js`／`capture.html` 就 `diag-statbar --read` 14/14＋6/6＋`replay-dumps` 退步 0、動 `electron/*.html` 或 `main.js` 就 `check-renderer-syntax.js` 全 ✓。
