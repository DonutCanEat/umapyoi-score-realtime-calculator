# Electron 去重审计报告

> 版本：**2026-09-19 v5（執行紀錄：全部簇做完 —— M6／L2／L3 收尾）**
> - 基準：commit `8febf94`（重核時 267 測試、`fit-score` 5/5 誤差 0）
> - 執行後：**318 測試全過**（新增 51 條閘；267 → 318）、`fit-score` 5/5 誤差 0、
>   `--verify` 30/30＋實機 14/14＋負樣本 6/6、`diag-statbar --read` 14/14＋6/6、
>   `replay-dumps` 退步 0、`diag-hue --assert` ✓、`diag-skills --all` 8×(7 列)
> - **語法閘**：`check-renderer-syntax.js` 已經由「只驗 4 個 HTML ＋ main.js」擴充到
>   **＋ `src/**`（29 檔）＋ `tools/**`（33 檔）**
> - ⚠️ v1 報告係對住舊樹寫嘅：當時嘅 **H1（適性規則雙實作）已經修好**
>   （`src/umascore/aptitude.js`；`anchor.js`／`panel.js` 亦已清走）
> - ⚠️ v2 嘅簇編號**已經改變過一次**，閱讀舊 commit message 嘅時候以「簇標題」為準（唔好靠編號）。

## 摘要

- 工作區：`D:\File\Program Project\Umapyoi Score Realtime Calculator`（獨立 git 倉庫）
- 分層：**main** `electron/main.js`／**preload 冇**（刻意）／**renderer** `capture.html`、`hud.html`、`settings.html`、`whatif.html`／
  **shared** `src/{hud,vision,umascore,capture}`＋`src/cli.js`／**tools** 32 個 CLI／**test** 23 檔
- 排除：`node_modules/`、`.git/`、各快取、`diagnostics/`、`shots/**/*.png`（證據庫）、`data/*.json`（生成物）
- 文件約數：**85 個原始檔**（main 1、renderer 4、shared 25、tools 32、test 23）
- 簇數：high **3** / med **9** / low **3** —— **15 簇全部做完**（H1／H3 只做咗關鍵一步，
>   第二步係可選）；另外**順手修好 2 個 HEAD 已經壞咗嘅工具**同**加咗 2 個新閘**

## Top 问题（現況）

| # | 簇 | 狀態 |
|---|---|---|
| H1 | IPC channel 字串散落 5 個檔（24 條，冇 channel map、冇閘） | ✅ **已修**（`electron/ipc-channels.cjs` 單一來源：`main.js` 29 處 ＋ **4 個 renderer** 全部改用；`test/ipc-wiring.test.js` 靜態閘 ＋ `tools/verify-renderer-load.js` **實載閘**） |
| H2 | 「切字元 → 讀數 → 信心閘」主迴圈兩套 | ✅ **已修**（`glyphs.readNumberBoxes()`） |
| H3 | 16:9 內容框推算三處 ＋ `roi.aspect` 傳咗冇人讀 | ✅ **已修**（`content-box.js` 單一來源）｜✅ **已接線**（renderer 跟主程序） |
| M1 | 環境變數讀法三個半實作 | ✅ **已修**（`envNumber()`／`envIsSet()`）＋ `UMAPYOI_SKILL_DUMP` 一齊修 |
| M2 | 四個 `BrowserWindow` 工廠重複 `webPreferences` | ✅ **已修**（`electron/web-preferences.js` ＋防漂移閘） |
| M3 | 逐列／逐欄墨量投影同「連續段掃描」9 處變體 | ✅ **已修**（`src/vision/projection.js`：投影 ＋ `runSpans()`／`densestRun()`） |
| M4 | `pickBestFive()` / `pickFiveBySpacing()` 組合搜尋寫兩次 | ✅ **已修**（`src/vision/combinations.js`） |
| M5 | 設定檔寫入路徑兩套（原子性唔一致） | ✅ **已修**（`saveConfig({ atomic: true })`） |
| M6 | tools CLI 參數解析 5 種寫法、25+ 檔 | ✅ **已修**（`tools/lib/args.js` ＋ 28 個工具） |
| M7 | 色相／亮度計算喺 tools 重複 | ✅ **已修**（`pixelHue`／`pixelLum`） |
| M8 | 去均值＋L2／內積相似度**三**套 | ✅ **已修**（`src/vision/similarity.js`） |
| M9 | tools 顯示寬度／`pad()` 抄兩份 | ✅ **已修**（`tools/lib/width.js`） |
| L1 | `src/hud` 兩個檔各有一套小工具 | ✅ **已修**（`src/hud/util.js`） |
| L2 | `test/` 內 4 個 `makeImage()` fixture builder | ✅ **已修**（`test/helpers/image.js`） |
| L3 | `main.js` 兩個 dump 函數共用「建目錄＋時間戳」 | ✅ **已修**（`ensureDir()`／`dumpStamp()`） |
| 額外 | `diag-skills.js`／`dump-namebox.js` 喺 HEAD 已經爆 `SyntaxError` | ✅ **已修** ＋ 加咗語法閘（見下） |

## 執行紀錄（每個 commit 都跑齊相關驗收先 commit）

| Commit | 簇 | 內容 | 驗收數據 |
|---|---|---|---|
| `b700ad0` | H1 | `test/ipc-wiring.test.js`：由 5 個檔抽 channel 字面值（**剝註釋後**）斷言 `renderer send ⊆ main on`、`main send ⊆ renderer on`，附 in-memory 突變自測證明閘唔係空轉 | 274/274（+7） |
| `f579771` | H3 | `capture.html` 改用主程序傳落嚟嘅 `roi.aspect`（欄位選填 → 舊 main 照用後備值，行為等價） | 語法閘 ✓、274/274、`--read` 14/14＋6/6、退步 0 |
| `2726900` | M4 | `src/vision/combinations.js`（`forEachCombination5`），兩個 picker 共用；成本函數／門檻刻意留喺呼叫者 | 279/279、30/30＋14/14＋6/6、5/5、14/14＋6/6、色相閘 ✓、退步 0 |
| `b5d3d8a` | M8 | `src/vision/similarity.js`（`standardizeInPlace`／`standardize`／`cosineSimilarity`），**三份實作變一份** | 285/285、同上全套 |
| `74bc923` | M9 | `tools/lib/width.js`；改動前後**逐行 diff 過兩個工具嘅完整輸出 → 完全一樣** | 285/285、fit-score 5/5 誤差 0 |
| `5bde2df` | M7 | `inkmask.pixelLum()` ＋ `isDigitInk` 內部改用；`diag-hue`／`diag-scale` 直接 import（同樣 diff 過輸出：135 行＋29 行完全一樣） | 285/285、全套閘 ✓ |
| `d8bb7ec` | M5 | `saveConfig({ atomic = true })`（`.tmp`＋`rename`，失敗清 `.tmp`），`main.js` 唔再自己砌 tmp；新增 3 條閘 | 288/288、語法閘 ✓ |
| `a5455ca` | M1 | `envNumber()`／`envIsSet()`；數字旋鈕三處＋「有冇 set」兩處收斂（`positive: true` 保住舊行為，只多警告） | 294/294、語法閘 ✓、實測 `=4oo` → 0＋1 警告 |
| `0e5285b` | M1 | `UMAPYOI_SKILL_DUMP` 改用 `envFlag()`（**行為改動**：`=0` 由開變閂）＋ `docs/known-issues.md` §9.1 第 7 條改為已修 | 294/294、語法閘 ✓、實測 0／false／1／true／yes 五個值 |
| `9a64211` | H2 | `glyphs.readNumberBoxes()`；兩個 reader 共用（失敗訊息由 callback 砌，措辭逐字保留），新增 5 條閘 | 299/299、30/30＋14/14＋6/6、5/5、14/14＋6/6、退步 0 |
| `f969b7d` | L1 | `src/hud/util.js`（`describe`／`isPlainObject`／`clampNumber`／`finiteOr`） | 299/299、語法閘 ✓、fit-score 5/5 |
| `bbd78c7` | M2 | `electron/web-preferences.js`（凍結常數）＋ 4 個窗共用＋防漂移閘（剝註釋） | 303/303、語法閘 ✓ |
| `26b6d6d` | 順手修 | `tools/diag-skills.js` 補返 `scale` 解構（**HEAD 已經爆** `ReferenceError`，唔係 `--gray` 嘅用法全中） | `--all` → 8 張圖全部 **7 列** |
| （M3-①） | M3 | `src/vision/projection.js`：`rowCounts`／`columnCounts`／`countInk`；9 處手寫投影收斂（含 `statbar.bandStats` 改用欄投影、`tightenBand` 刪死碼 `peakIndex`、`main.js` 收圖進度） | 307/307、30/30＋14/14＋6/6、5/5、14/14＋6/6、色相閘、退步 0、`diag-skills --all` 8×7 列 |
| `b299bb0` | M3 | `runSpans(values,{minValue,gapTolerance,trimTrailingGap})`／`densestRun()`；7 處手寫切段收斂。**A/B 對照證明逐位元等價**（stash 回 HEAD 跑 `diag-namematch`／`diag-namepairs` → 數字完全一樣） | 312/312、全套閘 + fit-score 5/5 誤差 0 |
| `81d9c3e` | 額外 | `tools/dump-namebox.js` 修重複宣告 `scale`（**HEAD 已經爆** `SyntaxError`） | 實跑 → 1140×950、7 列 |
| `e855f15` | M6 | `tools/lib/args.js`（6 支函數）＋ **28 個工具**改用；`fix` 嘅 dump-namebox 順手一齊 | 318/318、20 個唯讀工具輸出**逐行一樣（1022 行）** |
| `2ca3644` | 額外 | 語法閘擴充：`src/**`（29）＋ `tools/**`（33）＋ 原本 4 HTML ＋ main.js；加可選 CLI 參數令閘可以自測 | 全 ✓（exit 0）；餵壞檔目錄 → exit 1 |
| `646fac9` | L2 | `test/helpers/image.js`（`solidImage()`）——4 個測試檔收斂；⚠️ 只抽 buffer 嗰步（`paint()`／`fill()` 語意有微差，留返） | 318/318（測試語意零改動） |
| `e2eed96` | L3 | `ensureDir()`／`dumpStamp()`（檔內小工具）；diff 只有 4 行 | 語法閘 ✓、318/318、`git diff` 逐行核對 |
| （H1 尾） | H1 | **4 個 renderer 改用 `require('./ipc-channels.cjs')`**（26 處字面值清零）＋ 閘加「renderer 唔准再寫字面值／解構要早過第一次用」＋ 新工具 `tools/verify-renderer-load.js`（真開 Electron 載入 4 個窗、雙向送 IPC 讀 DOM） | 實載閘 **14/14 ✓**、328/328（乾淨 HEAD 327/327）、語法閘 ✓、`fit-score` 5/5 誤差 0、`diag-statbar --read` 14/14＋負樣本 6/6、`replay-dumps` 退步 0、`diag-hue --assert` ✓ |

## 剩餘（**可選**，唔做都可以）

- ✅ H1 第二步：**已完成**（`electron/ipc-channels.cjs` ＋ `main.js` ＋ 4 個 HTML 全部換成常數；
  驗證方式 = 新嘅 `tools/verify-renderer-load.js`，佢正正係為咗「實機驗」而寫）。
- ✅ H3 第二步：**已完成**（`src/vision/content-box.js`：`contentRect()`／`contentBox()`／
  `capture.html` 三者用同一支）。
- ⚠️ **唔應該做**：`tools/diag-skillnames.js` 自己一套特徵抽取（見新發現 1）—— 佢讀嘅標註已知有錯位。
- ⚠️ 仲要實機驗嘅嘢（本報告嘅改動**冇開過遊戲**）：`npm.cmd start` 睇 HUD 穿透／四個窗、
  `UMAPYOI_HUD_EDIT=1` 拖位、`UMAPYOI_DUMP_FRAMES=5` 睇 dump 檔名時間戳。
  ⚠️ **DSH agent shell 開唔到 Electron**（沙盒擋 mojo named pipe／cache 授權 → `platform_channel.cc`
  FATAL；另外環境會漏 `ELECTRON_RUN_AS_NODE=1` → electron.exe 會用 Node 模式跑）——
  呢類驗證要喺用戶自己嘅終端做。

## 過程中新發現（v2 未有記錄）

1. **`tools/diag-skillnames.js` 都有一份 `standardize()`**（第三份）——M8 已經一齊收斂。
   同一個檔仲有自己一套 **模糊／特徵抽取**（`extractNames()` 內）同 `skillname.nameBoxFeature()`
   高度相似 → 呢個係 **M8 嘅延伸（未做）**，但因為嗰個工具讀嘅
   `data/skill-name-labels.json` 係「已知有錯位」嘅標註（AGENTS §3），唔建議為咗佢再動 `skillname.js`。
2. **兩套分位數係刻意唔同，唔應該合併**：`tools/diag-hue.pct()` 用 `Math.round((n−1)·p)`（診斷）、
   `statbar.inkHuePercentile()` 用 `Math.floor(n·p)`（**判準門檻**：金色格 p90 ≥ 33，pitfalls #26）。
   改索引會令邊緣個案翻邊 → M7 只合併色相／亮度公式，兩套分位數都加咗註釋寫明係刻意。
3. **靜態閘一定要剝註釋**（兩次都踩到）：`main.js` 嘅註釋本身寫住 `ipcMain.on('frame')` 同
   `nodeIntegration:true + contextIsolation:false` → 唔剝就會「用註釋冒充實作」而**假 pass**／**假 fail**。
   `test/ipc-wiring.test.js` 同 `test/electron-window-prefs.test.js` 都有剝註釋＋自測。
4. **`UMAPYOI_SKILL_DUMP` 係 known-issues §9.1 第 7 條記住嘅最後一個 truthiness 坑** → 已修（見上表）。
5. **`docs/` 嘅測試數目會漂**：`AGENTS.md` 三處寫「267 個測試」→ 已經改成 312。
   ⚠️ 將來加測試要順手更新（呢個係文檔同步，唔係 code）。
6. **`tools/diag-skills.js` 喺 HEAD 已經壞咗**（`ReferenceError: scale is not defined`）：
   非 `--gray` 嘅用法（包括 AGENTS §2 寫住嘅 `--all`）全部即爆 → 已修（`26b6d6d`）。
   ⭐ **同類第二個**：`tools/dump-namebox.js` 都有同一個病（`scale` 喺同一個 scope 宣告兩次
   → `SyntaxError`）→ 已修（`81d9c3e`）。
   ⚠️ **根因唔係「兩個工具手民之誤」而係「`tools/` 冇語法閘」** → 已加：
   `check-renderer-syntax.js` 而家連 `src/**`（29 檔）＋ `tools/**`（33 檔）一齊驗
   （`2ca3644`）。呢類「冇測試、冇閘、冇人跑」嘅檔，正正係最需要閘嘅地方。
7. **`skillname.js` 檔頭嗰組實測數字（34 對、中位數 0.986）已經過時**：今日重跑係
   **33 對、p50 0.974、≥0.9 有 75 對**。⚠️ 但**唔可以**當成「重構改壞咗」——
   已用 A/B（stash 回 HEAD）證明兩邊**數字完全一樣**；差異係樣本集／偵測細節之前改過。
   已喺檔頭加日期註記，講明引用前要自己跑一次。
8. ⚠️ **教訓：`tools/build-skill-library.js` 冇乾跑模式**（一跑就覆寫
   `data/skill-name-lib/` 80 個追蹤檔 ＋ 由 `shots/skill-dump/` 生成一大堆新 PNG）。
   今次為咗「睇下 Phase 2 條路會唔會爆」而誤跑，要即刻
   `git checkout -- data/skill-name-lib` ＋ `git clean -f -- data/skill-name-lib` 還原。
   → 已經喺 AGENTS §2 嗰行加咗警告。**下次要驗 Phase 2 路，用 `diag-namematch`／
   `diag-namepairs`（唯讀）就夠，唔好跑 build。**

## 不建议动的项

- `node_modules/`、鎖檔、`dist/`、`out/`、`diagnostics/`：第三方／建置／一次性支援資料。
- `data/glyph-templates.json`、`data/skill-db-tw.json`：**生成物**，唔可以手改。
- `shots/**/*.png`（尤其 `live/roi-regress-*.png`、`negatives/`）：**證據庫／永久回歸樣本**，AGENTS §0 明講要入 git。
- `data/ground-truth/*.json`、`data/live-truth.json`、`data/skill-name-labels.json`（已知有錯位）：人手真值。
- 四個 HTML 嘅 inline CSS 同 classic-script 寫法：**唔係可修嘅重複**（`file://` + ESM CORS，AGENTS §6.3）→ 要用「靜態閘測試」或者「IPC 傳值」。
- ✅ `settings.html` 嘅 `round()`／`fieldBounds()`：**已經有閘**（`test/hud-settings-html.test.js` 真係由 HTML 抽出嚟執行比對）。
- ✅ `src/umascore/aptitude.js`：**已經係單一來源**，唔准再開第二套適性規則。
- `src/umascore/tables.js` 嘅公式常數表：本身係單一來源。
- 一堆 `normalize*` 同名函數：似但語意唔同，**唔係重複**。
- 文件之間嘅重複敘述（AGENTS／`docs/design.md`／`docs/pitfalls.md`／程式碼註釋）：刻意嘅跨檔冗餘。

## 建议落地顺序（**已經全部做完**）

1. ~~**M6**（tools CLI 參數，逐字保留 CLI 介面）~~ ✅ `e855f15`
2. ~~**L2**（test fixture builder，只抽砌 buffer 嗰步）~~ ✅ `646fac9`
3. ~~**L3**（dump 小工具，檔內重構）~~ ✅ `e2eed96`
4. ~~可選（未做）：H1 第二步（`.cjs` channel map）、H3 第二步（`content-box.js`）~~ ✅ **兩樣都做完**
   ⚠️ **唔應該做**：`tools/diag-skillnames.js` 自己一套特徵抽取（見新發現 1）——
   佢讀嘅標註已知有錯位，為佢改共用模組唔值得。

## 备注

- 本報告嘅 v1／v2 由只讀審計 Preset 生成；**v3 之後嘅改動係按用戶指示實際落手做嘅**
  （用戶原話：「總之點都要commit 同埋你可以開始做」），每一步都跑齊相關驗收先 commit。
- 若涉及 model/DTO，建议字段全部可选，避免缺字段导致解析失败。實例：`roi.aspect`（今次已經接線，
  但欄位保持選填 → 舊 main 照用後備值）、`frame.cropped`；將來收成共用 model 時
  **所有欄位一律 optional ＋ 有預設**（要向後兼容「新 main ＋ 舊 renderer」同「舊 main ＋ 新 renderer」）。
- 本專案**冇 preload**：如果將來加，`electron/ipc-channels.cjs`（H1 第二步）正好可以變成 preload 嘅白名單來源。
- 每次改動之後嘅驗收閘（AGENTS §8）：`npm.cmd test` **318** 全過、`fit-score` 5/5 誤差 0、
  動影像就 30/30＋14/14＋負樣本 6/6、動墨點／色相就 `diag-hue --assert`、
  動 `statbar.js`／`capture.html` 就 `diag-statbar --read` 14/14＋6/6＋`replay-dumps` 退步 0、
  **任何改動都建議跑 `check-renderer-syntax.js`**（而家 4 HTML ＋ main.js ＋ `src/**` ＋ `tools/**`）。
