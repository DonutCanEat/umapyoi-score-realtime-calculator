# AGENTS.md

賽馬娘（ウマ娘）**桌面版即時評價分偵測器**。
讀遊戲畫面 → 即時算出「當下評價分」→ 以 HUD 疊加喺遊戲上面。

> 呢份文件係專案嘅「記憶」。**改任何嘢之前先讀呢份**。
>
> ⚠️ 為咗令呢份文件**讀得完**（agent 嘅工作區指令預算 65,536 bytes），
> 三份大表已經搬去 `docs/`（D4，2026-09-19）—— **同你嘅改動有關就要開嚟睇**：
> - `docs/pitfalls.md`：**30 條地雷**（改影像／計分／HUD 之前必讀）
> - `docs/known-issues.md`：已知待辦 ＋ **未修**嘅技術債（§9.1）
> - `docs/backlog.md`：總 Backlog（A／B／C／D，邊項做咗／做緊）
>
> 呢份文件保留：提交紀律、現況、指令、檔案地圖、公式、設計原則、驗收標準、地雷**索引**。

---

## 0. 提交紀律（**每一次改動都要 commit**，唔准累積）

> 用戶明確要求：**每做一個改動就 commit 一次**，方便後續追蹤同回溯。
> 唔好做一大堆嘢先一次過 commit —— 咁樣出事嗰陣搵唔返係邊一步搞壞。

**倉庫位置**：本專案係**獨立 git 倉庫**，根目錄 = 專案目錄本身。

```bash
git -C "D:\File\Program Project\Umapyoi Score Realtime Calculator" log --oneline
```

⚠️ **唔係** `D:\File\Program Project\.git` 嗰個（嗰個係多專案共用倉庫，
用嚟放 `TimeMate/`、舊嘅 `Umapyoi/` 等，**追蹤唔到本專案**；而且喺 workspace 之外，
沙盒會擋 `.git/index.lock` → commit 一定失敗）。本專案獨立成庫，兩者互不干擾。

**每次改動嘅流程（順序唔可以掉亂）**：

1. 改嘢
2. 跑 §8「改動後必做」嘅相關驗收 —— **驗收唔過就唔准 commit**
3. `git add <今次改動嘅檔案>`（**唔好** `git add -A` 亂加）
4. `git commit`（見下面格式）
5. 喺回覆入面講明 commit 咗咩

**Commit message 格式**：`<type>(<scope>): <繁中一句話>`

| type | 用喺 |
|---|---|
| `feat` | 新功能／新工具 |
| `fix` | 修 bug、修讀錯數 |
| `docs` | AGENTS.md／docs／註釋 |
| `test` | 測試 |
| `chore` | 雜項（依賴、忽略清單、版號）|
| `refactor` | 唔改行為嘅重構 |
| `perf` | 速度 |

scope 用：`vision`（影像）／`score`（計分核心）／`skills`／`electron`／`tools`／`docs`。

- 內容要寫**為何**，同埋**實測數據**（例：`30/30`、`0/8`、`誤差 0`），
  唔好只寫「更新檔案」。
- 一個 commit 一件事。大改動可以拆幾個 commit，但**每個 commit 之後個庫都要係可用狀態**
  （測試過得）。
- 唔會 commit：`node_modules/`、`.npm-cache/`、`.electron-cache/`、`.cache-local/`、
  `dist/`、`out/`、`*.log`（`.gitignore` 已擋）。
- **`shots/` 要 commit**：字形模板同驗收閘都靠佢哋（`--verify` 30/30），唔好當垃圾忽略。

---

## 1. 現況

| 階段 | 內容 | 狀態 |
|---|---|---|
| Phase 0 | 評價分運算核心 | ✅ **誤差 = 0**（**5 條**實機樣本全部吻合；第 5 條 `05-東海帝皇-超越地平線-UD1.json` 係**第一次用遊戲自己顯示嘅評價点**做真值 —— 35,050 ＝ 五維 26,702 ＋ 技能 8,348）|
| Phase 0 | 技能資料庫（1323 招）＋ 進化技能 override | ✅ |
| Phase 1 | 畫面擷取（`npm start` 跑得通）| ✅ |
| Phase 1 | **五維數字辨識（零校準）** | ✅ 兩條路都通：**畫面 A 面板條**（`statbar.js`）**14/14 全中**（1356→2560 五個解析度 ＋ 1929×1085 新樣本 ＋ 4 個實機失敗／金色格回歸 ＋ 4 個實機狀態樣本）＋ **負樣本 6/6 唔出數**（其他畫面唔准出數，見地雷 #30 —— 包括**培育結束確認**嘅「能力值」／「技能」tab 同**賽馬娘詳情**面板）；ステータス面板排法 **30/30**。✅ 已實機跑過（`npm start`，1920 窗），修好間歇性「讀唔清」（地雷 #25）同**金色格靜默讀錯**（地雷 #26）|
| Phase 1 | HUD overlay ＋ 設定面板 | ✅ **可用**（透明置頂穿透；顯示評價点 + 五維逐格 + 技能分 `？／總分 ≥ X` ＋ 金色格提示 ＋ **ランク目標（仲差幾多分升級，C5）** ＋ **成長曲線（C3，SVG 折線）**）。**已做**：`hud-position.json` 存檔（env > 檔案 > 預設）、獨立**設定窗**（8 個數值 slider ＋ **9 個顯示選項**，改動即時生效）、**對位模式（`UMAPYOI_HUD_EDIT=1`）可以直接拖 HUD**（放手即反推 + 存檔）＋ 設定窗跟住更新（唔會「拖完撳儲存就彈返」）。✅ **2026-09-19 用戶實機驗過（原話：「而家 hud 冇問題」）**。⏸️ **唔做**：跟住遊戲視窗移動（**用戶 2026-09-19 決定** —— 可以用拖位擺去自己想擺嘅位，跟窗冇必要；見 §9 ①）。對位模式期間切換仍然要重開程式（✅ **2026-09-19 用戶實機驗過**：新嗰行「升級 … 差 …」正常顯示；原話「呢兩樣都ok」）|
| Phase 2 | 技能 icon 識別（自動知學咗邊啲技能）| ⏸️ **暫停（用戶 2026-09-19 指示：暫時唔處理技能呢一 part）** —— 已經做好嘅部分見下面，隨時可以接返。原狀態：🚧 **兩步做好**：① 技能畫面欄／行偵測器（`skillscreen.js`，8 張實機圖全部搵到 7 行）；② **名稱框抽取**（112 個全部抽到）＋ **影像比對可行性已量化**（互相最佳配對中位數 **0.986**、撞分上限 **0.604** —— 見 `docs/skill-screen.md` §5）。⏳ 未做：接上**候選名單**（見 §9）|
| Phase 3 | what-if 模擬（加一招加幾多分／Pt）、成長曲線 | ✅ **C1 已做 ＋ 2026-09-19 用戶實機驗過（原話「呢兩樣都ok」）**：`src/umascore/whatif.js`（純函數）＋ `tools/whatif.js` CLI ＋ **獨立 what-if 窗**（`electron/whatif.html`，`UMAPYOI_NO_WHATIF=1` 唔開）＋ `src/umascore/aptitude.js`（適性規則**單一來源**）。✅ **C3 成長曲線亦已做（未實機驗）**：`src/hud/history.js`（樣本記錄／去重／上限／折線座標，純函數）＋ HUD 用 SVG polyline 畫（顯示選項 `history`，第 9 個）|
| Phase 4 | 事件選項助手（已 mark，見 `docs/vision-design.md` §5.5）| 暫緩 |
| Phase 5 | **打包（A9）** | ✅ **已做（2026-09-19）**：`npm.cmd run pack:win`（electron-builder，`portable` target）→ `dist/UmapyoiScoreRealtimeCalculator-0.1.0-portable.exe` **95.7 MB** 單檔。asar 白名單 48 項（`electron/**`＋`src/**`＋2 個 runtime data JSON＋`package.json`）。⚠️ 順手修好一個真 bug：打包後 `ROOT` 係唯讀 asar，原本文寫死 `join(ROOT,'shots',…)` → 一 dump 就爆 → 抽出 `src/hud/write-root.js`（同 `config-path.js` 一樣嘅純函數決策）。✅ 實測：打包版開得到（`MainWindowTitle`＝「Umapyoi 擷取」）、非法 env 即刻 exit 1（行緊同一套邏輯）、asar 內模板／技能庫讀得到（79809／458862 bytes 可 parse）。⚠️ 未實機對住遊戲跑、未設 icon、未簽名 —— 詳情 `docs/packaging.md` |

> **影像辨識里程碑（2026-09）**：由實機截圖直接讀出五維，
> uma1／uma3／uma4 三條紀錄 **30/30 格完全命中真值**（`node tools/read-stats.js`）。
> 過程中修好一個一直潛伏嘅根因（見地雷 #12）＋ **重建咗字形模板**
> （舊模板係垃圾，見地雷 #15）。
>
> **色相窗口／徽章色相規律（2026-09-18）**：量化咗數字墨同徽章嘅色相／亮度分佈
> （見地雷 #20/#21、`docs/vision-design.md` §2.2.1）：數字墨 hue 25–26°、徽章 hue 17–44°
> → **色相剔唔走徽章**，靠結構條件；門檻已參數化，附回歸閘 `node tools/diag-hue.js --assert`。
>
> **同一輪意外發現（地雷 #22）**：整條管線**只喺原生尺度行得通**；
> 執行時 640px 縮圖之下偵測 0/8（數字得 5.7px 高）。實時管線要修呢樣先。
>
> **實機量測（2026-09-18，5 張 1356→2560 截圖，`shots/live/`）**：
> ① UI **完全等比縮放**（cell pitch ÷ 圖闊 = 0.0495 恆定）、面板 normalized y 0.691–0.703 恆定
> → **相對 ROI 可行**（地雷 #24）；② 但實機**讀錯欄**：判準揀到「/上限」而唔係數值
> （讀 `1946/1600/…` 而真值 `226/54/139/85/102`），5/5 解析度都錯，信心仲有 0.55–0.70
> → **靜默報錯數**（地雷 #23）。
>
> **同日已修（2026-09-18）**：新增 `src/vision/statbar.js` 走「相對 ROI → 切大數值行/上限行 →
> 只按右邊界間距揀 5 個 → 信心閘」→ 實機 5 張 **5/5 全中**；
> 擷取端改為只傳面板 ROI（原生像素）→ 頻寬由 ~8MB/幀跌到 ~0.5MB/幀（地雷 #22 亦解）。
> 模板改用「面板截圖 ＋ 實機面板條」一齊訓練（雙閘）。
>
> **實機跑（2026-09-18，1920 窗）＋ 修好間歇性「讀唔清」**：實際開 `npm start` 對住遊戲跑，
> 成功讀到 `727/198/361/261/272`（信心 0.80）；但出現間歇性失敗 →
> 加「失敗自動 dump 幀」機制，用**真失敗幀**（唔係靠估）定位到根因（地雷 #25）
> → 修正後重播全部 dump 幀：**修好 4、退步 0**；三個失敗幀入 `shots/live/roi-regress-*.png`
> 做永久回歸 → 實機面板條閘 **8/8**。
>
> **第二次實機跑（47 幀 dump）**：**35 幀其實係「唔喺面板畫面」**（開選單／轉場，屬正常）、
> 10 幀讀到而且數值完全一致、2 幀真問題（真數字「8」得 0.41；選單細字被當成面板條）。
> → 除咗修嗰兩樣，仲加咗 `notBar` 判斷：唔喺面板畫面就**唔再報「讀唔清」**，
> log 由每 5 秒變每 30 秒一次，而且唔會 dump 幀（dump 目錄留返真問題）。
> ⚠️ 順手量到：**放寬亮度門檻反而讀錯**（見地雷 #25），所以維持 0.62。
>
> **第三次實機跑（60 幀 dump）：金色格 → 靜默讀錯（地雷 #26）**。用戶報
> 「1489 讀成 1483、1613 讀成 1513」→ 查真幀證實：屬性升咗之後數字變**金色**，
> 淺金高光（亮度 0.98）過唔到墨色窗口 → 字形被侵蝕（每個字元相似度只剩 0.46–0.60）
> → 打和／揀錯。金幀入 `shots/live/roi-regress-gold.png` 做永久回歸。
>
> **同輪修好（2026-09-18 晚）**：用戶澄清「**只要數值超過 1200 就會變金**」→
> 金色係**長期狀態**，即係「偵測到金色就唔出數」= 千二點之後**永遠冇數**，唔可行。
> 再查真幀揭出**真正根因唔止顏色窗口**：墨點遮罩嘅「深色字喺淺色底上面」結構條件
> （窗口淺色比例 ≥ 0.4）被淺金高光推爆 → **反而削走筆劃**（同格墨量 137/176/188 → 119/89/137）。
> **正解**：逐格量墨點色相 p90，確認為金色格就用放寬嘅 `lightFraction`（0.3）重做遮罩
> → 3 個原本靜默讀錯嘅實機幀**讀返 1489**（信心 0.72），退步 0。

---

## 2. 指令

> ⚠️ 呢部機嘅 PowerShell 執行原則擋咗 `npm.ps1`（`因為這個系統上已停用指令碼執行`）。
> 喺 pwsh 入面要跑 **`npm.cmd`**，或者直接用 `node`：
> `node --test --test-isolation=none test/*.test.js`

```bash
npm.cmd start             # 開 Electron（需要遊戲開住）＋ HUD overlay ＋ HUD 設定窗
npm.cmd test              # 單元測試（333 個，必須全過；⭐ 乾淨 checkout 一樣要全過 —— 見 §8）
node tools/check-renderer-syntax.js  # ⭐ 語法閘：4 個 HTML inline script ＋ electron/main.js
                                     #    ＋ src/**（31 檔）＋ tools/**（34 檔）—— 見 §8 4b
                                     # ⚠️ 2026-09-19 擴充：之前只驗 renderer，結果兩個工具
                                     #    喺 HEAD 已經爆 SyntaxError 都冇人知（見 §8 4b）
node tools/collect-diagnostics.js    # ⭐ D2 一鍵診斷包 → diagnostics/diag-<時間>/report.md
node tools/collect-diagnostics.js --run-gates   # 順手跑齊 5 個閘並把尾部輸出寫落報告（慢）
node tools/collect-diagnostics.js --with-dumps  # 連最近 5 個 dump 幀一齊複製落 files/
                                    # ⚠️ `diagnostics/` 唔入 git（一次性支援資料）
node_modules\.bin\electron.cmd tools\verify-renderer-load.js
                                    # ⭐ **renderer 實載閘**（H1 第二步嘅必要驗證）：真係開 Electron
                                    #    載入 4 個 HTML（`show:false`，**唔需要開遊戲**），斷言
                                    #    ① page 冇 throw ② main→renderer 通（送真 payload 讀 DOM）
                                    #    ③ renderer→main 通（等「開窗即問」嗰條 channel 到）
                                    #    ⚠️ 一定要用 **Electron** 跑（`node` 跑冇意義）；
                                    #    ⚠️ 如果環境漏咗 `ELECTRON_RUN_AS_NODE=1`（DSH agent shell
                                    #       會漏）→ 先 `Remove-Item Env:\ELECTRON_RUN_AS_NODE`，
                                    #       唔然 electron.exe 會用 Node 模式跑（`import … from
                                    #       'electron'` 即刻爆／攞到 npm shim）
npm.cmd run pack:win                # ⭐ A9 打包：electron-builder → portable 單檔 exe
                                    #    → dist/UmapyoiScoreRealtimeCalculator-<版>-portable.exe
                                    #    （實測 0.1.0 = **95.7 MB**；`dist/` 唔入 git）
                                    #    ⚠️ 打包版 `ROOT` ＝ 唯讀 app.asar → 設定檔同 dump 位置
                                    #       全靠兩個純函數決策（`config-path.js`／`write-root.js`）
                                    #        —— 詳情同驗收紀錄：`docs/packaging.md`
# IPC channel 名嘅唯一來源 = electron/ipc-channels.cjs（**CommonJS**：renderer 係 classic script）
#   `main.js`（29 處）＋ **4 個 renderer** 都已經改用 `IPC_CHANNELS.<key>`
#   （renderer 係 `const { IPC_CHANNELS } = require('./ipc-channels.cjs');`）。
#   `test/ipc-wiring.test.js` 會逐個對照 map（打錯字／改咗 map 冇改 HTML → 即刻 fail），
#   仲釘死「renderer 唔准再出現 channel 字面值」同「解構一定要早過第一次用」。
#   ⚠️ 改呢個 require（路徑／`.cjs` 副檔名／搬檔）之後**一定要跑實載閘**（見上）；
#      失敗模式係「page 一開頭 throw → 全部 IPC listener 靜默唔註冊」（靜態閘捉唔到）。

# HUD 相關開關（環境變數）
#   ⚠️ **四個**旗標（UMAPYOI_NO_HUD／UMAPYOI_NO_SETTINGS／UMAPYOI_NO_WHATIF／UMAPYOI_HUD_EDIT）
#      嘅**確切**語意（唯一讀法 = `src/hud/env-flag.js` 嘅 `envFlag()`，唔准用 truthiness）：
#        開  ＝ 只有 "1" 或者 "true"（**大小寫唔敏感**，"TRUE"/"True"/"TrUe" 都算；前後空白忽略）
#        閂  ＝ "0"／"false"／空字串／**冇 set**
#        ⚠️ 其他值（"yes"／"on"／"2"／"tru"／"-1"…）＝ **當冇開，而且會 log 警告**
#           （唔認識嘅值唔准靜默當開或者當閂）
#        ⚠️ 純空白（"  "）trim() 之後就係空字串 → 同 "" 一樣當閂而**唔警告**（刻意一致）
#        ⚠️ 以前用 truthiness → `UMAPYOI_NO_HUD=0` 竟然會**閂咗 HUD**（'0' 係非空字串 = truthy），
#           同文件寫嘅「=1」對唔上（已修，見 §9.1）
#   UMAPYOI_NO_HUD=1            唔開 HUD（⭐ 連設定窗都唔開；淨係要 console log 嗰陣用）
#   UMAPYOI_NO_SETTINGS=1       唔開設定窗（HUD 照開）—— 做防擷取測試時想畫面乾淨就用
#   UMAPYOI_NO_WHATIF=1         唔開 what-if 模擬窗（C1；HUD／設定窗照開）
#   UMAPYOI_HUD_EDIT=1          ⭐ 對位模式：HUD 顯示自己嘅範圍／偏移，而且可以直接拖（放手即存檔）
#                               ⚠️ 對位模式下 HUD **全程**食滑鼠事件（唔止拖緊嗰陣）—— 見 §6.4
#
#   ── 位置／大細：⚠️ 2026-09-19 起 **`size` 為準**（`x[1]` 由 `x[0] + size.w` 推導）──
#   UMAPYOI_HUD_X=0.01,0.20     HUD 左／右邊界（÷ 內容區闊度）＝「範圍」
#   UMAPYOI_HUD_Y=0.70,0.95     HUD 上／下邊界
#   UMAPYOI_HUD_W=0.30 / _H=0.24  大細（＝「size」；同一個軸有寫就係 source of truth）
#   UMAPYOI_HUD_DX=-0.005       額外橫向偏移（同 _DY 一樣係相對值，可以負）
#
#   逐軸（`x` 對 `size.w`、`y` 對 `size.h`）獨立判斷，規則**只有四條**：
#     ① **只 set 範圍**（`_X`／`_Y`）→ 大細**由範圍推**（`size.w = x[1] − x[0]`）。
#        ⚠️ 唔會維持預設 0.212×0.255：實測 `UMAPYOI_HUD_X=0.1,0.3` 舊行為 size.w = 0.212
#        （＝靜默改咗用戶寫嘅範圍），新行為 size.w = **0.2**（＝0.3 − 0.1 = 0.2，範圍講咩就係咩）
#     ② **只 set 大細**（`_W`／`_H`）→ `x[1]`／`y[1]` 跟住推（起點唔變：env 範圍 → 檔案 → 預設）
#     ③ **同軸同時寫死範圍同大細而唔一致** → ⭐ **以 `size` 為準 ＋ 大聲警告**（`[設定] ⚠️ …`）
#        **唔會 throw**。理由：`anchorHud()` 只用 `x[0]` 定位、用 `size` 決定大細，
#        `x[1]` **根本唔影響渲染** → 為一個被忽略嘅冗餘欄位令程式開唔到係錯方向
#        （舊行為：throw → `main.js` catch → `app.exit(1)` → **完全開唔到程式**）
#     ④ 兩樣都冇寫 → 預設（0.598–0.810 × 0.030–0.285，即 0.212 × 0.255）
#   ⚠️ **真正會 throw** 只有「**推導出嚟嘅範圍唔合法**」：
#        `x[0] + size.w > 1`（訊息含「右邊界」）、`size.w <= 0`（訊息含 `size.w`）、
#        `x[0] < 0`、`offset` 超出 ±1、範圍唔夠兩個數字／前後倒轉
#   ⭐ **正例（唔會 throw，實測過）**：下面六行**一齊用係合法嘅** ——
#        `UMAPYOI_HUD_X=0.01,0.20` ＋ `UMAPYOI_HUD_Y=0.70,0.95` ＋ `UMAPYOI_HUD_W=0.30`
#        ＋ `UMAPYOI_HUD_H=0.24` ＋ `UMAPYOI_HUD_DX=-0.005` ＋ `UMAPYOI_HUD_DY=-0.67`
#        → 實測 `x=[0.01,0.31]`、`y=[0.70,0.94]`、`size 0.30×0.24`、`dx=-0.005`、`dy=-0.67`
#        ＋ 兩個警告（`x[1]` 寫死 0.20 vs 推導 0.31；`y[1]` 寫死 0.95 vs 推導 0.94）
#   UMAPYOI_DUMP_FRAMES=5       頭 5 幀每幀都 dump（⭐ 驗「HUD 有冇被自己擷取到」用）

# HUD 設定檔（`hud-position.json`）—— 位置／大細／顯示選項
#   優先次序：**環境變數 > 設定檔 > 預設**（全部經 `resolveHudConfig()`）
#   路徑：開發模式 = <專案根>/hud-position.json；打包（或 ROOT 落喺 .asar）= app.getPath('userData')
#   ⚠️ 實際用邊條路徑一定 log（`[設定] 檔案：…`），唔准靜默 fallback
#   ⚠️ 合併之後會再 validate → `UMAPYOI_HUD_X=0.9,0.5`（倒轉）**會 throw + 即刻收工**
#      （以前係靜默擺去唔可能嘅位置）；但「範圍同大細唔一致」只會**警告**（見上面 ③）
#   ⚠️ 推導出嚟嘅 `size`／`x[1]`／`y[1]` 一律收斂到 6 位小數（`layout.js` `round6()`）——
#      唔係嘅話「還原預設 → 拖 → 存」會把 `0.21200000000000008` 寫入用戶個檔
#   ⚠️ `hud-position.json` 唔入 git（runtime 用戶狀態，人人唔同）

node src/cli.js 600 600 600 600 600        # 手動試算 → 5715 / C+

# ── Phase 3：C1 what-if ＋ C4 升級建議 ──
node tools/advice.js --stats=1200,600,600,600,600
                                           # ⭐ C4：屬性邊際效率（每加 1 點值幾多分）＋
                                           #    「仲差 N 分大約要加幾多點」（--json 有全部數據）
                                           #    ⚠️ 唔係「邊個訓練最好」（要訓練增益表，本專案未有）

node tools/whatif.js --stats=1200,600,600,600,600 --skill=弧線的教授
                                           # ⭐ 唔開 Electron 都試算得到（同 what-if 窗共用
                                           #    `src/umascore/whatif.js`，唔可能算出唔同答案）
node tools/whatif.js --stats=... --skill=弧線的教授 --grades=距離:S   # 指定適性（冇寫嘅類別一律假設 A 並講明）
node tools/whatif.js --stats=... --skill=直線 --all                  # 列晒所有命中（最多 200）
node tools/whatif.js --stats=... --skill=弧線的教授 --json           # 餵落其他工具用

# ── Phase 0（計分核心）──
node tools/fetch-skill-db.js               # 由 bwiki 拎技能庫（有 cache）
node tools/fetch-skill-db.js --refresh     # 強制重抓
node tools/fill-ground-truth.js            # 用技能庫自動填 ground truth
node tools/fit-score.js                    # 對答案（應該 5/5、總誤差 0）
node tools/breakdown.js                    # 逐招明細表（肉眼核對用）

# ── Phase 1（影像辨識）──
node tools/read-stats.js shots/gt/uma1-p1.png --gt=data/ground-truth/01-小栗帽-星光躍動-UD3.json
                                           # ⭐ 由截圖讀五維＋對答案（--trace 睇每個字元分數）
node tools/build-glyph-templates.js        # 建字形模板（面板截圖 ＋ 實機面板條；**雙閘**）
node tools/build-glyph-templates.js --verify
node tools/diag-statbar.js                 # ⭐ 實機面板條定位（ROI／切行／相對比例）
node tools/diag-statbar.js --read          # ⭐ 對 `data/live-truth.json` 真值（應該 14/14）
                                           #    ＋ 自動跑 `shots/negatives/`（其他畫面唔准出數，6/6）
                                           #    ⚠️ 有真值對唔上／負樣本讀到數 → exit 1（真閘）
node tools/diag-statbar.js --read --cropped --trace            # 模擬 renderer 剪 ROI（執行時路徑）
node tools/replay-dumps.js --verbose       # ⭐ 重播實機 dump 幀（驗證「讀唔清」嘅修正，見地雷 #25）
node tools/raw-to-png.js shots/live-debug  # dump 幀（.raw）轉 PNG，畀上面兩個工具讀
node tools/tune-detect.js --quick          # 參數掃描（用真值做評分）
node tools/tune-detect.js --hue            # ⭐ 色相窗口／亮度門檻單軸掃描（量安全邊界）
node tools/diag-hue.js                     # ⭐ 量數字墨／ランク徽章真實色相分佈
node tools/diag-hue.js --assert            # ⭐ 色相回歸閘（數字墨要全喺窗口內、徽章唔可以整塊入遮罩）
node tools/experiment-mask.js              # ⭐ 掃描墨點遮罩門檻喺真值圖上嘅命中率（搵安全邊界；見地雷 #26）
node tools/diag-scale.js                   # ⭐ 縮圖尺度診斷（量「執行時 640px 讀唔讀得到」）
node tools/diag-scale.js --probe=0.336     # 分清係色相窗口失守定係下游結構門檻失守
node tools/diag-scale.js --tune=0.336      # 細尺度參數掃描（救唔救得返）
node tools/diag-row.js <png>               # 偵測結果
node tools/diag-row.js <png> --lines       # 文字行／密集帶
node tools/diag-row.js <png> --profile=y0,y1   # 逐行墨點數
node tools/diag-row.js <png> --line=y0,y1  # 某行嘅字群同間距
node tools/diag-row.js <png> --gray=x0,x1,y0,y1  # 灰度圖（**睇得到字形**）
node tools/diag-row.js <png> --templates   # 印出所有字形模板
node tools/diag-shots.js                   # 列出所有截圖尺寸

# ── Phase 2（技能畫面）──
node tools/diag-skills.js shots/gt/uma1-p1-skills.png        # ⭐ 技能畫面欄／行偵測（--all 跑晒 8 張）
node tools/diag-skills.js shots/gt/uma1-p1-skills.png --gray=60,110,50,440   # 灰度圖（睇字形）
node tools/crop-png.js shots/gt/uma1-p1-skills.png 50,60,440,105 out.png --scale=4  # 剪區域睇字形
node tools/skillrow-sheet.js 3 --col=1        # ⭐ 只睇「遊戲列 3 右欄」跨 8 張圖（肉眼核對用）
node tools/skillname-sheet.js                 # 8 圖 × 14 格拼成一張大對照表
node tools/dump-namebox.js uma1-p1-skills.png 1 1 --scale=4  # 單一格像素（原圖色＋遮罩）
node tools/diag-namepairs.js --top=20 --dump  # 跨圖最佳配對 + 對照圖
node tools/diag-nameocl.js --tol=3            # 幾何自標註（⚠️ 前提唔完全成立，見 docs §5.4）
node tools/diag-namematch.js --dump           # ⭐ 唔需要真值嘅可行性檢定（互相最佳配對／假陰性）

# ── Phase 2：收圖 → 建技能名影像庫 ──
#   UMAPYOI_SKILL_DUMP=1 npm.cmd start   ⭐ 連拍模式：1:1 整個內容區、逐頁存 PNG（同一頁自動略過）
#      ⚠️ 呢個都係「開關旗標」（2026-09-19 起）：經 `envFlag()` 讀 → 只認 1／true，
#         `=0`／`=false`／空字串／冇 set 都係**閂**（以前 `Boolean(...)` → `=0` 竟然會開咗，
#         已經修；見 `docs/known-issues.md` §9.1 第 7 條）
#   UMAPYOI_SKILL_MAX=400                最多存幾頁（預設 400）
#   UMAPYOI_CAPTURE_FPS=1                連拍幀率（預設 1；一幀 4–6MB，唔需要密）
#   ⚠️ `_SKILL_MAX`／`_CAPTURE_FPS`／`UMAPYOI_DUMP_FRAMES` 係**數字**旋鈕 → 經 `envNumber()` 讀
#      （唔合法／非正數 → 大聲警告 ＋ 用預設，唔准靜默；實作：`src/hud/env-flag.js`）
node tools/build-skill-library.js             # ⭐ 逐頁抽名框 → 跨頁去重 → data/skill-name-lib/
                                              # ⚠️ 呢個工具**冇乾跑模式**：一跑就會覆寫
                                              #    data/skill-name-lib/（80 個追蹤檔）＋由 shots/skill-dump/
                                              #    重新生成一大堆 PNG。想「只驗唔寫」→ 用
                                              #    `node tools/diag-namematch.js`／`--top=… diag-namepairs`（唯讀）
node tools/skill-lib-sheet.js --sort=merge    # ⭐ 拼大圖人手覆核（最可疑排前面）
```

**驗收標準**（全部都要）：
1. `npm.cmd test` 全過（現時 **333 個**；⭐ 乾淨 `git archive HEAD` checkout 一樣要全過）
2. `node tools/fit-score.js` 顯示 `可以計誤差 5/5　完全命中 5/5　總絕對誤差 0`
3. 動到影像嘅話：`node tools/build-glyph-templates.js --exclude=uma2 --verify`
   → **面板截圖 30/30**（三閘：**實機面板條 14/14**、**負樣本 6/6 唔出數**），全部都要中
   ⚠️ 負樣本（`shots/negatives/`）有任何一幀讀到數 → **唔會寫檔**（同其他失敗一樣）
4. 動到墨點／色相／亮度門檻嘅話：`node tools/diag-hue.js --assert` 要通過
5. 動到實機面板條（`statbar.js`／`capture.html`）嘅話：
   `node tools/diag-statbar.js --read` → **14/14**（自動對 `data/live-truth.json`）
   ＋ **負樣本 6/6 唔出數**；＋ `node tools/replay-dumps.js` → **退步 0**
   ⚠️ `replay-dumps` 仲會報「修正假陽性」同「冇當時結果記錄（every 幀）」——
      後者係 `UMAPYOI_DUMP_FRAMES` 影嘅任意幀（冇 reason 亦冇 stats）→ **唔准當佢係 OK**
      （舊版 `tagOf(undefined)` = OK → 假退步；2026-09-19 已修）

任何改動令呢幾樣唔達標，就係改壞咗。

---

## 3. 檔案地圖（**完整版喺 `docs/file-map.md`**）

```
src/umascore/   # 計分核心（純函數）：tables.js（精確 statPoints ＋ ランク表）／skills.js／
                #   evaluate.js（唯一要 100% 準）／aptitude.js（適性規則單一來源）／
                #   whatif.js（C1）／advice.js（C4）／profiles.js／calibrate.js
src/vision/     # 影像：inkmask.js（墨點遮罩，關鍵）／digitrow.js（gt 排法）／statbar.js（實機面板條 ⭐）／
                #   glyphs.js／reader.js（多數投票）／png.js／pngwrite.js／skillscreen.js／skillname.js
src/capture/    # source.js ⭐ 揀擷取來源（排除自己嘅窗；純函數、有測試）
src/hud/        # layout.js（幾何＋顯示狀態）／config.js（設定檔層）／config-path.js（設定檔擺邊）／
                #   write-root.js（⭐ A9：dump／連拍要寫邊 —— 打包後 ROOT 係唯讀 asar）／
                #   env-flag.js（環境變數唯一讀法）／history.js（C3 成長曲線核心）
electron/       # main.js（主程序：擷取 → 讀五維 → 計分 → 推 HUD）／ipc-channels.cjs（channel 名唯一來源）／
                #   capture.html／hud.html／settings.html（設定窗）／whatif.html（what-if 窗）
test/           # 333 條（`npm.cmd test`）—— 純函數 ＋ 幾個**接線閘**（static wiring gate）
tools/          # 32 個 CLI：診斷／建模板／對答案／what-if／advice／診斷包／renderer 實載閘…（見 §2）
data/           # skill-db-tw.json（1323 招）／glyph-templates.json／live-truth.json／ground-truth/
                #   ⚠️ runtime 只讀頭兩個 → **打包白名單要有佢哋**（見 `docs/packaging.md` §5）
shots/          # ⭐ 證據庫 —— **每個目錄係咩睇 `shots/README.md`**（邊啲入 git／加檔入邊個閘）
                #   gt/（面板排法）／live/（實機 ＋ 失敗幀回歸）／negatives/（唔准出數）／
                #   debug-crops/（人手剪放大圖）／live-debug/、skill-dump/（唔入 git）
docs/           # formula.md／vision-design.md／skill-screen.md／pitfalls.md（30 條地雷）／
                #   known-issues.md／backlog.md／file-map.md／design.md／packaging.md（A9）
```

⚠️ 每個檔案嘅**用途、為何咁做、有咩閘**：睇 `docs/file-map.md`（完整版）。

---

## 4. 核心公式（全部已用實機樣本驗證）

```
總評價點 = Σ 五維評價點 + Σ 技能評價點
ランク   = 查 RANK_THRESHOLDS
```

### 4.1 五維：**精確演算法**（唔准改返做分段直線）

`src/umascore/tables.js` 嘅 `statPoints()`：

```js
const koeffi = [0.5, 0.8, 1, 1.3, 1.6, 1.8, 2.1, 2.4, 2.6, 2.8, 2.9, 3, 3.1, 3.3,
                3.4, 3.5, 3.9, 4.1, 4.2, 4.3, 5.2, 5.5, 6.6, 6.8, 6.9];  // 每 50 點
const ovk    = [7.888, 8, 8.1, …, 18.3];                              // 1200 以上每 10 點

v > 1200 → oval = v - 1200; v = 1200
v += 1; q = ⌊v/50⌋; r = v mod 50
result = Σ_{i<q} 50·koeffi[i] + r·koeffi[q]
oval > 0 → 再加 oval 部分；最後 floor
```

**已驗證錨點**：102→68、502→853、902→2217、600→1143、1200→3841、2000→14280

**屬性上限 2000**（屬性上限開放之後）。**舊社群表只到 1200，唔夠用。**

### 4.2 ランク表

`RANK_THRESHOLDS`，由 `G`（0）到 `UA`（55200），包括 `UG/UF/UE/UD/UC/UB` 各 1–9。
已用 **5 條**實機樣本驗證（全部由遊戲顯示嘅分／ランク反查）：
`20589→UG2`、`28211→UF8`、`30134→UE2`、`36575→UD3`，同埋
⭐ **`35050→UD1`（2026-09-19 用戶提供嘅「賽馬娘詳情」面板自己顯示嘅評價点 ＋ 徽章）**。
⚠️ 舊文件寫嘅「32334→UE2」係**已作廢嘅 UE6 紀錄**嘅數（見 `02-西野花…UE2.json` 嘅 note）。

### 4.3 技能

```
技能分 = round(基礎評價分 × Π 適用嘅適性倍率)

適性倍率：S/A=1.1、B/C=0.9、D/E/F=0.8、G=0.7
⭐ 同一類別內取【最大】，跨類別先相乘
   「中距離, 長距離」→ max      「前列, 中距離」→ 相乘
⭐ 草地／沙地【唔乘】（測試樣本有「良好場地◎」而仍然誤差 0）

固有技能：★1~2 = 120 × Lv、★3~5 = 170 × Lv
繼承・固有技能：每個固定 180
劇本進化技能（技能Pt = 0）：有真實評價分，**可以係負數**（例如 −174）
```

---

## 5. 地雷清單（30 條）—— ⭐ **詳情喺 `docs/pitfalls.md`**

> ⚠️ **動到相關範圍之前，一定要開 `docs/pitfalls.md` 睇全條**（呢度只係索引；
> 每一條都係實際踩過嘅坑，寫明「⛔ 舊寫法／錯假設」同「✅ 正解」，通常連住一個閘）。
> 呢一節以前直接寫喺呢份文件，但 30 條令 `AGENTS.md` 超咗讀取預算（65,536 bytes）
> → **檔尾嘅待辦／Backlog 根本讀唔到**（D4，2026-09-19 拆章）。

| # | 一句（詳見 `docs/pitfalls.md`）|
|---|---|
| 1 | 用分段直線插值計五維 |
| 2 | 信 wikiru 舊表「400 → 557」 |
| 3 | 技能名直接字串比對 |
| 4 | 資料庫揾唔到就當「繼承固有 180」 |
| 5 | ◎ 雙圈睇成 ○ 單圈 |
| 6 | 多條件適性「同類相乘」 |
| 7 | 草地／沙地照乘適性 |
| 8 | 把「自己嘅固有技能」同「同名嘅繼承固有」撈亂 |
| 9 | 技能清單靠人手抄 |
| 10 | 用「粉紅色」嚟揾ステータス面板 |
| 11 | 用 `longestPinkRun()` 呢類「連續段」做特徵 |
| 12 | 只用「顏色」判數字墨（`isDigitInk` 睇色相 + 亮度） |
| 13 | 按「墨量」揀數字行 |
| 14 | 用「中位間距 × 2.2」做砌數字嘅自適應門檻 |
| 15 | 相信 `data/glyph-templates.json` 舊模板 |
| 16 | 假設「每格字元數 = 數字位數」 |
| 17 | 用「揀令最差分數最高嘅後綴」剔雜訊 |
| 18 | `tightenBand()` 門檻設太高（例如峰值 0.4） |
| 19 | 假設 `shots/gt/uma2-*.png` 同 `02-西野花…UE2.json` 對應 |
| 20 | 以為可以用色相視窗剔走ランク徽章 |
| 21 | 色相窗口「隨手調闊／調窄」當係無害微調 |
| 22 | 以為「縮圖 640px 冇問題，只係未試」 |
| 23 | 以為「gt 30/30 = 實機行得通」 |
| 24 | 假設遊戲 UI 係固定像素大細 |
| 25 | 以為「相似度 0.55 門檻好安全」，同埋「數字框入面一定只有數字」 |
| 27 | 以為「揀擷取來源」係小事，同埋「自己個窗標題唔會撞到遊戲關鍵字」 |
| 28 | 以為「拖位只改 `offset`」同「slider `max=1`」冇問題 |
| 29 | 以為「拖完 HUD 就完」—— 唔記得通知設定窗 |
| 30 | 以為「只有面板條先砌得出 5 個等距數字」 |

---

## 6. 影像辨識設計原則（**完整版喺 `docs/design.md`**）

> ⚠️ 改影像／HUD 之前**一定要讀 `docs/design.md`**（§6.1 兩條路、§6.2 三個畫面、
> §6.3 為何 CV 邏輯放 Node、§6.4 HUD overlay 全部細節、§6.5 技能畫面、§6.6 what-if）。
> 呢度只留**唔可以唔知嘅骨架**：

- **零校準**：唔准加手動框選（用戶明確要求即時偵測）。
- **畫面 A（育成主畫面）走 `statbar.js`**：相對 ROI → 切「大數值行／上限行」→
  只按**右邊界間距**揀 5 個 → 讀數 ＋ 信心閘（地雷 #23）。
- **畫面 B（技能）＝ Phase 2，暫停中**；**畫面 C（Pt）＝ what-if 用技能庫嘅 `skillPt`**。
- **CV 邏輯一律喺 Node 主程序**（renderer 由 `file://` 載入 → ESM 會被 CORS 擋）：
  renderer 只「擷取 → 1:1 剪 ROI → 傳 raw RGBA」→ 所以核心邏輯可以 `node --test`。
- **HUD 底線：正常模式一定穿透**（`setIgnoreMouseEvents(true)`，四重保險；對位模式例外）。
- **唔出數只有三種**：`notBar`（換咗畫面）／真失敗／信心不足 —— 唔准亂估（黃金格例外，見地雷 #26）。

---

## 7. 開發環境（Windows，實測）

| 事項 | 實情 |
|---|---|
| Node | v24（**冇 Python、冇 .NET SDK**）|
| npm cache | 必須指入 workspace（`.npmrc` 已設），否則沙盒會擋 `%LOCALAPPDATA%` |
| Electron 下載 | 要同時設 `ELECTRON_CACHE` **同** `LOCALAPPDATA` 指入 workspace（`.cache-local/`）|
| **Smart App Control** | 必須**關閉**，否則 `electron.exe` 會被擋（`spawn UNKNOWN`／`An Application Control policy has blocked this file`）。呢個係機器政策，唔係程式問題 |
| 最終打包 | Electron → portable 單檔 exe。✅ **A9 實測（2026-09-19）**：`npm.cmd run pack:win` → **95.7 MB**（NSIS 壓縮；`win-unpacked` 內嘅 electron.exe 本身 234.9 MB）。⚠️ icon 未設（用 Electron 預設）、未簽名（SmartScreen 會攔）。詳細流程／白名單／驗收：`docs/packaging.md` |

---

## 8. 改動後必做

1. `npm.cmd test`（或 `node --test --test-isolation=none test/*.test.js`）— **333 個測試必須全過**
   ⭐ **驗收閘一定要可以由乾淨 checkout 重現**：測試**唔准**依賴 repo 根嘅 runtime 檔
   （`hud-position.json` 唔入 git）或者其他未追蹤檔（`shots/skill-dump/`、`shots/live-debug/`、
   `.cache-local/` 之類）。驗法：`git archive HEAD` 抽出乾淨樹跑一次 → 要同工作樹一樣全過
   （歷史：2026-09-19 修好之前乾淨樹 **179 pass／1 fail**（`hud-config.test.js` 要求 repo 根
   有 `hud-position.json`），修好之後兩邊一樣；而家工作樹係 **333／0**
   （2026-09-19 兩次核對：H1 之後乾淨 HEAD **327／0** vs 工作樹 **328／0**；
   A9 再加 5 條 `write-root` 測試 → 333，查法一樣：`git archive` 出乾淨樹跑一次）。
   ⚠️ **唔准**用 `skip`／`if (!existsSync(...)) return;` 迴避 —— 咁樣只係把「驗唔到」
   變成「靜默通過」。要用嘅話就**自己控制環境**（例如 `os.tmpdir()` ＋ `process.chdir()`）。
   ⚠️ 涉及 cwd 嘅測試一定要**同步** ＋ `finally` 還原（`--test-isolation=none` 之下
   所有測試共用一個 process，`chdir` 係全域狀態）。
2. `node tools/fit-score.js` — 必須 `完全命中 5/5　總絕對誤差 0`
3. 如果改咗五維／技能／ランク相關嘅嘢，`node tools/breakdown.js` 逐招核對一次
4. **如果改咗影像相關嘅嘢**：
   - `node tools/build-glyph-templates.js --exclude=uma2 --verify` → **30/30（面板截圖）
     ＋ 14/14（實機面板條）＋ 負樣本 6/6 唔出數**
   - `node tools/read-stats.js shots/gt/uma1-p1.png --gt=data/ground-truth/01-小栗帽-星光躍動-UD3.json` → 5/5
   - 上唔到 30/30 就**唔好**寫模板檔（工具自己會擋，唔好繞過）
   - 動到墨點／色相／亮度門檻：`node tools/diag-hue.js --assert` 要通過
     ＋ `node tools/tune-detect.js --hue` 睇下有冇踩到安全邊界（見 `docs/design.md` §6.1）
   - 動到實機面板條（`statbar.js`／`capture.html`）：
     `node tools/diag-statbar.js --read` → **14/14**（自動對 `data/live-truth.json`）
     ＋ **負樣本 6/6 唔出數** ＋ `node tools/replay-dumps.js` → **退步 0**
4b. **語法閘（唔理改咗咩，最好都跑）：`node tools/check-renderer-syntax.js` → 全部 `✓`。**
   ⚠️ 為何要：四個 HTML 係 classic script（`require('electron')` ＋ DOM）
   → **入唔到 `node --test`**，打錯一個字（少個括號、`await` 喺非 async）嘅後果係
   **renderer 一開頭 throw → 之後所有 IPC listener 都註冊唔到 → HUD／設定窗靜默唔郁**。
   ⚠️ **2026-09-19 擴充**：而家連 `src/**`（31 檔）＋ `tools/**`（34 檔）一齊驗 ——
   因為去重審計期間一次過揭發**兩個工具喺 HEAD 已經爆 `SyntaxError`**
   （`tools/diag-skills.js` 用咗冇宣告嘅 `scale`；`tools/dump-namebox.js` 同一個 scope
   宣告咗兩次 `scale`）：兩者都係「冇測試、冇閘、冇人跑」嘅檔，靜默壞咗好耐 ——
   而佢哋**係驗收閘本身**（`diag-statbar --read`／`replay-dumps`…），壞咗連驗收都做唔到。
   呢個閘只驗語法（`node --check`，唔執行、唔 resolve import → 唔需要 electron／任何依賴），
   邏輯錯同「export 名打錯」要靠 `npm.cmd test`。
   ⚠️ 想驗「閘真係捉得到」：`node tools/check-renderer-syntax.js <一個裝咗壞檔嘅目錄>` → 應該 exit 1。
4c. **改到 renderer 嘅 `require`／channel 用法（或者改 `electron/ipc-channels.cjs`）**：
   `node_modules\.bin\electron.cmd tools\verify-renderer-load.js` → **4 個窗全過**（14 項 ✓）。
   ⚠️ 為何：`require('./ipc-channels.cjs')` 喺 renderer 一解唔到，page 就**開頭 throw**
   → 之後所有 `ipcRenderer.on()` 靜默唔註冊（窗開得到但永遠唔郁）——
   `npm.cmd test` 同語法閘**只睇文字，捉唔到**。呢個閘真係開 Electron、真係來回送 IPC。
   ✅ **唔需要開遊戲**（`show:false`）；⚠️ 要真 Electron（見 §2 嗰行嘅 `ELECTRON_RUN_AS_NODE` 註記）。
5. 更新 `docs/formula.md`（公式）或者 `docs/vision-design.md`（影像）
6. **`git commit`**（見 §0：每次改動都要 commit，驗收唔過唔准 commit）

> **唔准為咗「跑得快」而犧牲精度**。呢個專案嘅核心價值就係「顯示嘅數同遊戲一模一樣」，
> 而唔係「估得接近」。誤差 0 係花咗好多輪先達到，唔好退返去。

---

## 9. 已知待辦（交接）—— 詳情喺 `docs/known-issues.md`

> ⭐ **想搵嘢做就睇 `docs/backlog.md`**（A／B／C／D 四大類，標明使唔使開遊戲同大細）。
> 呢一節連 §9.1「已知限制／技術債」已經搬去 `docs/known-issues.md`（D4，2026-09-19）。
> ⚠️ **最緊要嘅三句**（唔准唔知）：
> 1. **§9.1 嗰啲係「未修」**（獨立審計發現）—— 唔准當已修；改動前先讀。
> 2. **Phase 2（技能識別）暫停中**（用戶 2026-09-19 指示）—— 已做好嘅部分喺 `docs/known-issues.md`，隨時接返。
> 3. **HUD 跟遊戲視窗移動 = 唔做**（用戶 2026-09-19 決定；理由同量測數據都留住喺嗰份）。

---

## 10. 總 Backlog（A／B／C／D）—— ⭐ **詳情喺 `docs/backlog.md`**

> 完整清單（每項嘅內容、狀態、大細）搬咗去 `docs/backlog.md`（D4，2026-09-19）。
> 快速記憶：**A** 唔使開遊戲（A8 清舊碼 ✅、**A9 打包 ✅（2026-09-19）**、A10 `shots/` 大掃除 ✅…）／
> **B** 要開遊戲（B4 收數字樣本、B5 其他畫面負樣本，都係 🔄 做緊）／
> **C** 新功能（C1 what-if ✅、C3 成長曲線 ✅、C4 升級建議 🚧、C5 ランク目標 ✅…）／
> **D** agent 提議（D2 診斷包 ✅、D4 就係呢次拆章、D5 技能分進度 ✅…）。
