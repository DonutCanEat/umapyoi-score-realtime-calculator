# 檔案地圖（完整版）

> 由 `AGENTS.md` §3 搬過嚟（D4，2026-09-19）。**內容一個字都冇改**。
> `AGENTS.md` 保留一份壓縮版（邊個目錄做咩）＋ 指向呢度。

## 3. 檔案地圖

```
src/umascore/
  tables.js       # ⭐ 五維精確演算法 statPoints() ＋ ランク表（G→UA）
  skills.js       # 技能評價點（適性倍率、固有、繼承固有）
  profiles.js     # 版本 profile（tw / cn / jp，現時三個共用同一張表）
  evaluate.js     # evaluate()：唯一需要 100% 準確嘅核心，純函數零 I/O
  aptitude.js     # ⭐ 適性倍率規則**唯一一份實作**（同類取最大、跨類別相乘、草地／沙地唔乘）：
                  #    MULTIPLIER_GROUPS／GRADE_MULTIPLIER／aptitudeKeyOf()／aptitudesFor()／
                  #    groupHits()／multiplierForGrades()。`tools/fill-ground-truth.js` 同
                  #    what-if 都係用呢份（獨立審計 H1 去重；地雷 #6 由「只守一半」變單一來源）
  whatif.js       # ⭐ C1 what-if（純函數零 I/O）：searchSkills()／skillSearchItems()／
                  #    aptitudeMapFor()／skillPointsFor()／parseStatInput()／
                  #    whatIfAddSkill()（加一招 → Δ分／Pt／ランク變化；`after` 照樣經 evaluate() 計，
                  #    令「Δ ＝ 該招自己嘅分」變成一個測得到嘅不變式）
  advice.js       # ⭐ C4 升級建議（純函數）：marginalPoints()（= statPoints(v+1) − statPoints(v)，
                  #    **差分**而唔係微分 → 同核心庫一致）／statEfficiency()（邊際排序）／
                  #    trainingAdvice()（差 N 分 → 每屬性約要幾多點；封頂屬性**唔准入建議**）
  calibrate.js    # 對答案邏輯
  index.js        # re-export

src/vision/
  inkmask.js      # ⭐ 背景受控墨點遮罩（顏色 + 「深色字喺淺色底」）＋ 文字行切分
  digitrow.js     # ⭐ 五維數字列偵測（密集帶、收窄、砌數字、揀 5 個、結構評分）
  statbar.js      # ⭐⭐ **實機面板條**（畫面 A）：相對 ROI → 切大數值行/上限行 →
                  #    只按右邊界間距揀 5 個 → 讀數 ＋ 信心閘（見地雷 #23/#24）
  glyphs.js       # 切字元 → 尺度歸一化 → 模板比對（NCC）＋ 由右邊貪心收剔徽章
  resultpanel.js  # ⭐⭐ **培育結束確認（畫面 D）數字欄 reader**（2026-09-23）：固定相對 ROI →
                  #    逐行墨量切 5 行（要均勻）→ 每行右邊數字框 → 字形比對；
                  #    `lightFraction` **0.05**（面板半透明，數字騎住剪影 —— 地雷 #32）
  reader.js       # ⭐ 影像 → 五維 → 評價分；幀間多數投票（StatTracker）
  png.js          # 零依賴 PNG 解碼器（讀實機截圖用）
  pngwrite.js     # 零依賴 PNG **編碼**器（dump 實機幀做證據用；有 round-trip 測試）
  skillscreen.js  # ⭐ 技能畫面（畫面 B）欄／行／名框偵測（見 §6.5）
  skillname.js    # ⭐ 技能名「影像特徵」＋比對（絕對尺度；Phase 2 識字路線，見 §6.5）
  # ⚠️ `anchor.js`／`panel.js`（靠粉紅色揾面板 → 地雷 #10/#11）**2026-09-19 已刪**（A8）：
  #    當時寫「保留只為舊測試」，但冇任何 src／tools／electron 用佢哋，唯一引用係自己嗰個測試
  #    → 留住只會令人以為「有兩套面板偵測」。要睇歷史：`git log -- src/vision/anchor.js`。

src/capture/
  source.js       # ⭐ 揀「擷取來源」嘅純函數（零 Electron、可 node --test）：
                  #    pickGameSource()（**排除本程式自己嘅窗**：HWND 硬排除 ＋ 標題第二重）、
                  #    matchScore()（完全相符 3／開頭 2／包含 1）、windowHandleOf()。
                  #    ⚠️ 呢個係「唔可以再揀錯窗」嘅單一來源（見地雷 #27）

src/cli.js        # 手動試算

src/hud/
  layout.js       # ⭐ HUD overlay 嘅**幾何 + 顯示狀態**（純函數，可 node --test）：
                  #    相對位置、內容框推算、四態（ok／stale／none／edit）、顯示選項、
                  #    clampLayout()（用戶郁過嘅值一律夾成合法）、
                  #    layoutFromBounds()／relativeFromBounds()（拖完反推：位置寫 x[0]／y[0] ＋
                  #    夾入內容區、offset 歸零、size 唔郁 —— 見地雷 #28）、
                  #    round6()（6 位小數收斂；config.js 推導 size／x[1] 都用佢，避免寫浮點噪音入用戶個檔）
  config.js       # ⭐ HUD 設定存檔層（`hud-position.json`）：DEFAULT_HUD_CONFIG／
                  #    validateConfig()／loadConfig()／saveConfig()／resolveHudConfig()（env > 檔案 > 預設）／
                  #    assertFullDisplay()（9 個 display key 齊全嘅閘，applyHudConfig 用）
                  #    ⚠️ 語意（2026-09-19）：**size 為準**，x[1] = x[0] + size.w 由推導得出；
                  #       寫死嘅 x[1] 同推導值唔一致 → 警告（onWarn，唔 throw）；
                  #       只有「推導出嚟嘅範圍唔合法」才 throw（見 §2／§6.4）
  config-path.js  # ⭐ 設定檔擺邊（純函數）：開發 = 專案根；打包／asar = app.getPath('userData')
  write-root.js   # ⭐ A9：dump／連拍要**寫**邊（純函數）：開發 = 專案根（同以前一樣）；
                  #    打包／asar = app.getPath('userData')。⚠️ 為何要：打包後 ROOT 係唯讀
                  #    asar，原本文寫死 join(ROOT,'shots',…) → mkdirSync throw（ENOTDIR／EROFS），
                  #    而且係喺「讀唔清」出錯嗰陣才爆。underWriteRoot() 順手集中 join
  log-file.js     # ⭐ 執行時 log 檔（`<writeRoot>/umapyoi.log`，2 MB 輪替成 `.1`）：
                  #    formatLogLine()／shouldRotate()／openLogFile()。⚠️ 為何要：打包版係
                  #    GUI 程式 → `console.log` 冇地方去（實測 redirect stdout 都係空）→
                  #    「HUD 突然唔見」之類嘅事故完全冇現場。寫唔到唔准令程式爆
  snapshot.js     # ⭐ 診斷快照嘅**純格式化**（`formatSnapshot()`／`describeValue()`）：
                  #    擷取窗「寫入診斷 log」掣（同 `UMAPYOI_SNAPSHOT_AFTER`）用。
                  #    ⚠️ 呢個函數**唔准 throw**（循環引用／undefined／Error 都要頂得住）——
                  #       用戶按掣係想攞資料，唔係想再製造一個錯誤
  history.js      # ⭐ C3 成長曲線核心（純函數，可 node --test）：pushSample()（**只記真變化**、
                  #    有上限 MAX_HISTORY=240、NaN 唔准入）／sparklinePoints()（100×22 折線座標；
                  #    `max === min` 畫中間橫線，**唔准除 0 出 NaN**）／historySummary()／historyView()
  env-flag.js     # ⭐ 環境變數開關旗標嘅**唯一**讀法（`envFlag()`，純函數可 node --test）：
                  #    只有 "1"／"true"（大小寫唔敏感）＝ 開；0／false／空字串／冇 set ＝ 閂；
                  #    其他值 ＝ 閂 ＋ 警告（`onWarn` 可收集）。main.js 四個旗標都用佢

electron/
  main.js         # 主程序：視窗列舉 → statbar.readStatBar()（cropped）／reader.readStats()
                  #    → evaluate() → console log ＋ **推落 HUD**（見 §6.4）
                  #    另有：HUD 設定窗管理、滑鼠穿透 funnel（setHudInteractive）、拖位 IPC
  capture.html    # 擷取 renderer：getUserMedia → **1:1 剪面板 ROI**（冇 ROI 就退回 640px 縮圖）
                  #    ⭐ 兩粒手動掣（用戶 2026-09-19 要求）：「強制更新」（送 `refresh` →
                  #    重新揀來源 ＋ 重開擷取）同「寫入診斷 log」（送 `snapshot` → 快照＋最後一幀 PNG）；
                  #    掣嘅結果經 `notice` 顯示喺狀態列（唔准靜默）
                  #    ⚠️ `start` handler **不准早退**：主程序靠再叫一次 start 去救「凍結」
                  #    ⚠️ 串流 track ended／3 秒冇畫面都要報 `capture-error`
  hud.html        # HUD overlay renderer：透明無邊框，只畫主程序推落嚟嘅 view（＋對位模式拖位
                  #    ＋ C3 成長曲線嘅 SVG polyline —— **只畫唔計**，座標由 `src/hud/history.js` 嚟）
  settings.html   # ⭐ HUD 設定窗（**普通視窗**，classic script）：8 個數值 slider ＋ 9 個顯示選項
                  #    ⚠️ 標題唔准含遊戲關鍵字（會蓋過 BrowserWindow 嘅 title，見地雷 #27）
                  #    ⚠️ slider 上下限由純函數 fieldBounds() 動態計（冇死區）＋
                  #       用戶互動中唔搶佢手上嗰個控制 ＋ 顯示 HUD 實際螢幕像素範圍（地雷 #28）
  whatif.html     # ⭐ C1 what-if 模擬窗（**普通視窗**，classic script）：實機五維（可改＝手動輸入）
                  #    ＋ 技能搜尋 ＋ 適性下拉 ＋ 即時試算。⚠️ 標題一樣唔准含遊戲關鍵字；
                  #    ⚠️ 窗**唔准**自己計分（只 send／聽，算式一律喺 `src/umascore/whatif.js`）
                  #    ⚠️ 開／閂由 `UMAPYOI_NO_WHATIF` 喺啟動時決定（同設定窗一樣）

test/
  capture-source.test.js # ⭐ 擷取來源挑選（**排除本程式自己嘅窗**、標題三級相符、
                      #    同分保留原本次序、唔合法輸入唔准 throw —— 見地雷 #27）
  hud-config-sync.test.js # ⭐ **接線閘**（static wiring gate）：拖 HUD（主程序自己改設定）之後
                      #    一定要通知設定窗（`remote: true`）＋ 設定窗收到一定要寫返落表單
                      #    —— 防止「拖完再撳儲存就彈返舊位」靜默復發（見地雷 #29；兩個檔都入唔到 node --test）
  hud.test.js         # HUD 幾何／狀態（anchorHud／contentRect／hudState 基本行為）
  hud-display.test.js # ⭐ 顯示選項（9 個 boolean，含 rankTarget／history）＋ 金色格嘅**真實粒度**（整體 boolean）
  hud-clamp.test.js   # ⭐ clampLayout()（slider 拉爆／拖位反推共用嘅夾法）
  hud-drag.test.js    # ⭐ 拖完反推：round-trip（±1px）、唔改 size、30 次唔漂；
                      #    ⭐ 位置寫入 x0／y0 ＋ offset 歸零；⭐ 拖出界一律夾返入內容區；
                      #    ⭐ 舊檔嘅飽和 offset（dx=1／dy=−0.82）唔會再令拖位卡死（地雷 #28）
  hud-config.test.js  # HUD 設定存檔層（env > 檔案 > 預設；唔合法一律 throw；
                      #    ⭐ 含「AGENTS §2 六行環境變數一齊用唔准 throw」回歸測試
                      #    ＋ assertFullDisplay()／onWarn 警告收集）
                      #    ⭐ 另有「onWarn 單一鏈路」測試：**由設定檔引起**嘅警告一定要
                      #    經 caller 嘅 `onWarn`（caller 收 1 個、裸 `console.warn` 收 0 個、
                      #    檔案／env 兩條路嘅措辭要一致）＋ `loadConfig()` 舊呼叫寫法唔准破
                      #    （冇參數／`{}`／`{filePath}`／多傳 onWarn／檔案唔存在／舊式字串）
                      #    ⭐ 另有「冇 filePath ＝ 讀 cwd 嗰個 `hud-position.json`」：
                      #    **自己 `process.chdir()` 去 `os.tmpdir()` 嘅臨時目錄**，兩個分支都真驗
                      #    （冇檔 → 回預設、唔准 throw；有檔 → 真係讀到嗰個檔）—— 理由：唔准斷言
                      #    「repo 根有 `hud-position.json`」（嗰個檔唔入 git，乾淨 checkout 冇 → 見 §8）
  hud-config-path.test.js # ⭐ 設定檔路徑決策（開發 vs 打包 vs asar）
  write-root.test.js  # ⭐ A9 寫入根目錄決策（5 條）：開發 = 專案根／打包 = userData／
                      #    `ROOT` 落喺 .asar 就算 isPackaged=false 都用 userData／
                      #    缺 rootDir 或 userDataDir 一律 throw（唔准靜默 fallback）／
                      #    underWriteRoot 砌得出 `shots/live-debug`、`shots/skill-dump`
  log-file.test.js    # ⭐ 執行時 log 檔（5 條）：一行格式（ISO ＋ [level]）／路徑決策／
                      #    輪替門檻（到上限先輪替、唔合法數值唔輪替）／真檔 append ＋ 輪替成 `.1`／
                      #    寫唔到唔准爆
  snapshot.test.js    # ⭐ 診斷快照格式化（3 條）：第一行可 grep 嘅標記 ＋ ISO 時間／
                      #    section 次序同縮排／壞資料（undefined／Error／循環引用／缺欄位）
                      #    一律唔准 throw
  hud-settings-html.test.js # ⭐ 「設定窗 ↔ config.js 欄位對齊」：**真係由 `electron/settings.html` 抽**
                      #    `DISPLAY_FIELDS`／`NUM_FIELDS` 再同 `HUD_DISPLAY_KEYS`／layout 欄位比對
                      #    （之前呢兩份清單係人手抄嘅，加一格／少一格冇人知）
                      #    ⭐ 另有 3 條由 HTML **抽 `fieldBounds()` 出嚟執行**（唔係抄公式）：
                      #    「x0 上限唔可以再寫死成 1」、「任何情況下拉到最大都仍然合法（冇死區）」、
                      #    「大細下限／x1 起碼值／dx dy 嘅 ±1」（地雷 #28）
  hud-env-flag.test.js # ⭐ `envFlag()` 21 個值嘅行為（1／true 系 7 個開、7 個閂、7 個唔認識要警告）
                      #    ＋ 預設 env＝process.env、預設 onWarn＝console.warn
  whatif.test.js      # ⭐ C1 what-if 核心（23 條）：適性同類取最大／跨類別相乘／場地唔乘、
                      #    「Δ 一定等於該招自己嘅分」不變式、進化技能負分、skillPt=0 唔准當冇資料、
                      #    標點無關搜尋、IPC 契約（skillSearchItems 嘅 key／parseStatInput 範圍）
  hud-history.test.js # ⭐ C3 成長曲線核心（9 條）：重複唔記／五維變咗要記／上限滑動視窗／
                      #    單調線向上／一直冇變畫中間橫線（唔准 NaN）／唔夠點返空／摘要
  hud-history-wiring.test.js # ⭐ C3 **接線閘**（main.js ↔ hud.html）：**dedupe key 一定要包含
                      #    `view.history`**（唔加＝條線永遠唔郁，而且靜默）、要真餵 pushSample()、
                      #    renderer 只畫唔計、設定窗要有 `history` 一格
  hud-skillprogress.test.js # ⭐ D5 技能分「已讀 N 招」：出「≥ P（已讀 N 招）」／唔傳就唔准變
  advice.test.js      # ⭐ C4 建議核心（9 條）：邊際 = 差分／望遠鏡和／封頂唔准入建議／
                      #    「跟建議加真係升到級」（用 evaluate() 反證，唔係自己加）
  whatif-window.test.js # ⭐ C1 **接線閘**（main.js ↔ whatif.html 兩個檔都入唔到 node --test）：
                      #    renderer 送嘅 channel 一定要有 main handler（反之亦然）、標題唔准含遊戲
                      #    關鍵字（地雷 #27）＋ main/HTML 標題要一致、五維標籤同 HUD 一致、
                      #    窗唔准自己計分、loadFile 路徑 ＋ setContentProtection ＋ ready-to-show

tools/
  fetch-skill-db.js      # bwiki 技能庫抓取
  fill-ground-truth.js   # 技能名 → base／條件／適性；override 機制
  fit-score.js           # 對答案報表
  breakdown.js           # 逐招明細表
  advice.js              # ⭐ C4 升級建議 CLI（邊際效率 ＋ 差 N 分要加幾多點）
  whatif.js              # ⭐ C1 what-if CLI（加一招幾多分／Pt／升唔升級）—— 同 what-if 窗共用
                         #    `src/umascore/whatif.js`，所以 CLI 同窗一定同一個答案（headless 可驗）
  read-stats.js          # ⭐ 截圖 → 五維（可 --gt 對答案、--trace 睇字元分數）
  read-result.js         # ⭐⭐ **培育結束確認（畫面 D）閘**（2026-09-23）：`--all` ＝
                         #    `data/result-truth.json` 全部要完全命中 ＋ `shots/negatives/` 全部唔准出數
  build-glyph-templates.js  # ⭐ 建字形模板（面板截圖 ＋ 實機面板條；驗證唔過就唔寫檔）
  tune-detect.js         # 參數掃描（用 ground truth 做客觀評分；--hue = 色相窗口單軸掃描）
  diag-row.js            # ⭐ 純文字環境睇圖（--gray/--map/--lines/--profile/--templates）
  diag-statbar.js        # ⭐ 實機面板條診斷（--read/--cropped/--trace/--bands）
  diag-hue.js            # ⭐ 量數字墨／徽章色相分佈（--assert = 色相回歸閘）
  experiment-mask.js     # ⭐ 掃描墨點遮罩門檻喺真值圖上嘅命中率（搵安全邊界；地雷 #26）
  diag-scale.js          # ⭐ 縮圖尺度診斷（--scale／--tune／--probe；見地雷 #22）
  diag-skills.js         # ⭐ 技能畫面欄／行偵測（Phase 2；--all 跑晒 8 張實機圖）
  skillname-sheet.js     # 8 圖 × 14 名框拼成一張大對照表（肉眼標註用）
  skillrow-sheet.js      # ⭐ 只睇「某遊戲列」跨 8 張圖（最易肉眼對齊；--col=N 只睇一邊）
  dump-namebox.js        # 單一名框嘅像素（原圖色＋遮罩）—— 抽取有 bug 時唯一可靠嘅查法
  diag-namepairs.js      # 跨圖最佳配對（--show=… 查墨跡尺寸、--dump 寫對照圖）
  diag-nameocl.js        # 幾何自標註（⚠️ 前提唔完全成立，見 docs/skill-screen.md §5.4）
  diag-namematch.js      # ⭐ 唔需要真值嘅可行性檢定（互相最佳配對／假陰性；--dump）
  build-skill-library.js # ⭐ 逐頁技能畫面 → 抽名框 → 跨頁去重 → data/skill-name-lib/
  skill-lib-sheet.js     # ⭐ 把影像庫拼成一張大圖（人手覆核「同一招有冇重複項目」）
  crop-png.js            # 剪一個區域出 PNG（--scale=N 放大，睇字形用）
  replay-dumps.js        # ⭐ 重播 `shots/live-debug/*.raw`（驗證「讀唔清」修正，見地雷 #25）
  raw-to-png.js          # dump 幀（.raw ＋ .json）轉 PNG，畀上面兩個工具讀
  diag-shots.js          # 列出所有截圖尺寸
  collect-diagnostics.js # ⭐ D2 一鍵診斷包：環境（Node／Electron／UMAPYOI_*）／Git 狀態／
                         #    `hud-position.json` 內容／影像資料數量／最近 dump meta；
                         #    `--run-gates` 跑齊 5 個閘、`--with-dumps` 抄 dump 幀。
                         #    ⚠️ 任何一項收集唔到都要照寫（標明原因），唔准爆
  check-renderer-syntax.js # ⭐ renderer inline script 嘅**語法閘**（抽出 `<script>` 再 `node --check`）——
                         #    四個 HTML 入唔到 `node --test`（classic script ＋ DOM），打錯一個字
                         #    就係「HUD 靜默唔郁」而冇錯誤訊息 → 呢個係最低成本嘅防線（見 §8 4b）
                         #    ⚠️ 2026-09-19 擴充到 src/**（31）＋ tools/**（34）
  verify-renderer-load.js # ⭐ **renderer 實載閘**（H1 完成嗰陣加）：用 **Electron** 跑（唔係 node），
                         #    真開 4 個窗（show:false、唔需要遊戲）載入 4 個 HTML，斷言
                         #    ① page 冇 throw（＝ require('./ipc-channels.cjs') 解得開）
                         #    ② main→renderer 送真 payload 後讀 DOM ③ renderer→main 收得到
                         #    ⚠️ 靜態閘捉唔到「page 開頭 throw → listener 靜默唔註冊」（見 §8 4c）

data/
  skill-db-tw.json       # 1323 招技能（繁中）
  skill-overrides.json   # 主 DB 冇收錄嘅技能（繼承技）
  glyph-templates.json   # ⭐ 10 個數字字形模板（16×24，NCC 用）
  live-truth.json        # ⭐ 實機面板條真值（values ＋ 每張圖 perShot 例外；`roi-*` = 已剪 ROI）
  result-truth.json      # ⭐ **培育結束確認（畫面 D）真值**（2026-09-23）：檔名 → 五維 ＋ 信心；
                         #    由 `tools/read-result.js --all` 覆核（完全命中，唔准差一個數）
  skill-name-lib/        # ⭐ 技能名影像庫（index.json ＋ img/*.png；個名未配）
  skill-name-labels.json # ⚠️ 我第一次人手標註嘅 112 格（**已知有錯位**，唔要當真值）
  calc-page-tw.html      # bwiki 頁面 cache
  ground-truth/*.json    # 5 條培育完成紀錄（誤差 0 嘅證據；05 = 第一次用遊戲顯示嘅分）

shots/
  gt/*.png               # ステータス面板排法（30/30 嘅證據）
  live/live-*.png        # ⭐ 實機育成主畫面 1356→2560 五個解析度
  live/roi-regress-*.png # ⭐ **實機失敗幀**（已剪 ROI）—— 永久回歸案例（地雷 #25/#26）
  live/roi-live-*.png    # ⭐ 實機**成功**幀（已剪 ROI，每個檔名尾 = 速度值）；真值喺 `live-truth.json`
  negatives/*.png        # ⭐ **負樣本**（其他畫面：支援卡列表／插畫…）—— 每一幀都**唔准出數**；
                         #    資料夾本身就係宣告（加檔就自動入五個閘，見地雷 #30）
  result/*.png           # ⭐ **培育結束確認（畫面 D）正面樣本**（整個遊戲視窗）；真值喺 `result-truth.json`
  skill-dump/            # ⭐ 技能連拍收到嘅頁面 PNG（UMAPYOI_SKILL_DUMP=1；唔入 git）
  live-debug/            # ⚠️ 執行時自動 dump（.raw ＋ .json，唔入 git）；有代表性嘅
                         #    手動複製去 shots/live/ 再入 live-truth 做正式回歸
  debug-crops/*.png      # ⭐ 早期**人手剪**嘅面板／字形放大圖（`reference.png`、`panel-full.png`、
                         #    `crop-*`…）—— 純粹理解用，**唔入任何閘**（A10 由 `shots/` 根目錄搬入）
  README.md              # ⭐ **每個目錄係咩、邊啲入 git、加檔之後會入邊個閘** —— 睇之前先睇呢份

docs/
  formula.md             # 公式推導、驗證、來源
  vision-design.md       # 影像辨識設計（座標模型、畫面清單、邊界情況）
  skill-screen.md        # ⭐ 技能畫面（Phase 2）實測版面 ＋ 識字嘅硬限制同可行路線
  packaging.md           # ⭐ A9 打包：指令／輸出大細／白名單／打包後嘅路徑規則／驗收紀錄／未驗清單
```

⚠️ `package.json` 嘅 `build` 欄 = electron-builder 設定（A9）：
`files` 白名單（`electron/**`＋`src/**`＋2 個 runtime data JSON＋`package.json`）、
`asar: true`、`electronDist: node_modules/electron/dist`（唔使重新下載 Electron）、
`npmRebuild: false`、`win.target: portable`。⚠️ **將來加 runtime data 檔要同步加落白名單**。
