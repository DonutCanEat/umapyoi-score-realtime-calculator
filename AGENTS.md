# AGENTS.md

賽馬娘（ウマ娘）**桌面版即時評價分偵測器**。
讀遊戲畫面 → 即時算出「當下評價分」→ 以 HUD 疊加喺遊戲上面。

> 呢份文件係專案嘅「記憶」。**改任何嘢之前先讀呢份**，
> 特別係「地雷清單」一節 —— 嗰啲全部係實際踩過、驗證過嘅坑。

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
| Phase 0 | 評價分運算核心 | ✅ **誤差 = 0**（4 條實機樣本全部吻合）|
| Phase 0 | 技能資料庫（1323 招）＋ 進化技能 override | ✅ |
| Phase 1 | 畫面擷取（`npm start` 跑得通）| ✅ |
| Phase 1 | **五維數字辨識（零校準）** | ✅ 兩條路都通：**畫面 A 面板條**（`statbar.js`）**13/13 全中**（1356→2560 五個解析度 ＋ 4 個實機失敗／金色格回歸 ＋ 4 個實機狀態樣本）＋ **負樣本 3/3 唔出數**（其他畫面唔准出數，見地雷 #30）；ステータス面板排法 **30/30**。✅ 已實機跑過（`npm start`，1920 窗），修好間歇性「讀唔清」（地雷 #25）同**金色格靜默讀錯**（地雷 #26）|
| Phase 1 | HUD overlay ＋ 設定面板 | ✅ **可用**（透明置頂穿透；顯示評價点 + 五維逐格 + 技能分 `？／總分 ≥ X` ＋ 金色格提示）。**已做**：`hud-position.json` 存檔（env > 檔案 > 預設）、獨立**設定窗**（8 個數值 slider ＋ 7 個顯示選項，改動即時生效）、**對位模式（`UMAPYOI_HUD_EDIT=1`）可以直接拖 HUD**（放手即反推 + 存檔）＋ 設定窗跟住更新（唔會「拖完撳儲存就彈返」）。✅ **2026-09-19 用戶實機驗過（原話：「而家 hud 冇問題」）**。⏸️ **唔做**：跟住遊戲視窗移動（**用戶 2026-09-19 決定** —— 可以用拖位擺去自己想擺嘅位，跟窗冇必要；見 §9 ①）。對位模式期間切換仍然要重開程式 |
| Phase 2 | 技能 icon 識別（自動知學咗邊啲技能）| ⏸️ **暫停（用戶 2026-09-19 指示：暫時唔處理技能呢一 part）** —— 已經做好嘅部分見下面，隨時可以接返。原狀態：🚧 **兩步做好**：① 技能畫面欄／行偵測器（`skillscreen.js`，8 張實機圖全部搵到 7 行）；② **名稱框抽取**（112 個全部抽到）＋ **影像比對可行性已量化**（互相最佳配對中位數 **0.986**、撞分上限 **0.604** —— 見 `docs/skill-screen.md` §5）。⏳ 未做：接上**候選名單**（見 §9）|
| Phase 3 | what-if 模擬（加一招加幾多分／Pt）、成長曲線 | 未開始 |
| Phase 4 | 事件選項助手（已 mark，見 `docs/vision-design.md` §5.5）| 暫緩 |

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
npm.cmd test              # 單元測試（202 個，必須全過；⭐ 乾淨 checkout 一樣要全過 —— 見 §8）
node tools/check-renderer-syntax.js  # ⭐ renderer inline script 語法閘（三個 HTML ＋ main.js；見 §8 4b）

# HUD 相關開關（環境變數）
#   ⚠️ 三個旗標（UMAPYOI_NO_HUD／UMAPYOI_NO_SETTINGS／UMAPYOI_HUD_EDIT）嘅**確切**語意
#      （唯一讀法 = `src/hud/env-flag.js` 嘅 `envFlag()`，唔准用 truthiness）：
#        開  ＝ 只有 "1" 或者 "true"（**大小寫唔敏感**，"TRUE"/"True"/"TrUe" 都算；前後空白忽略）
#        閂  ＝ "0"／"false"／空字串／**冇 set**
#        ⚠️ 其他值（"yes"／"on"／"2"／"tru"／"-1"…）＝ **當冇開，而且會 log 警告**
#           （唔認識嘅值唔准靜默當開或者當閂）
#        ⚠️ 純空白（"  "）trim() 之後就係空字串 → 同 "" 一樣當閂而**唔警告**（刻意一致）
#        ⚠️ 以前用 truthiness → `UMAPYOI_NO_HUD=0` 竟然會**閂咗 HUD**（'0' 係非空字串 = truthy），
#           同文件寫嘅「=1」對唔上（已修，見 §9.1）
#   UMAPYOI_NO_HUD=1            唔開 HUD（⭐ 連設定窗都唔開；淨係要 console log 嗰陣用）
#   UMAPYOI_NO_SETTINGS=1       唔開設定窗（HUD 照開）—— 做防擷取測試時想畫面乾淨就用
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

# ── Phase 0（計分核心）──
node tools/fetch-skill-db.js               # 由 bwiki 拎技能庫（有 cache）
node tools/fetch-skill-db.js --refresh     # 強制重抓
node tools/fill-ground-truth.js            # 用技能庫自動填 ground truth
node tools/fit-score.js                    # 對答案（應該 4/4、總誤差 0）
node tools/breakdown.js                    # 逐招明細表（肉眼核對用）

# ── Phase 1（影像辨識）──
node tools/read-stats.js shots/gt/uma1-p1.png --gt=data/ground-truth/01-小栗帽-星光躍動-UD3.json
                                           # ⭐ 由截圖讀五維＋對答案（--trace 睇每個字元分數）
node tools/build-glyph-templates.js        # 建字形模板（面板截圖 ＋ 實機面板條；**雙閘**）
node tools/build-glyph-templates.js --verify
node tools/diag-statbar.js                 # ⭐ 實機面板條定位（ROI／切行／相對比例）
node tools/diag-statbar.js --read          # ⭐ 對 `data/live-truth.json` 真值（應該 13/13）
                                           #    ＋ 自動跑 `shots/negatives/`（其他畫面唔准出數，3/3）
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
#   UMAPYOI_SKILL_MAX=400                最多存幾頁（預設 400）
#   UMAPYOI_CAPTURE_FPS=1                連拍幀率（預設 1；一幀 4–6MB，唔需要密）
node tools/build-skill-library.js             # ⭐ 逐頁抽名框 → 跨頁去重 → data/skill-name-lib/
node tools/skill-lib-sheet.js --sort=merge    # ⭐ 拼大圖人手覆核（最可疑排前面）
```

**驗收標準**（全部都要）：
1. `npm.cmd test` 全過（現時 **202 個**；⭐ 乾淨 `git archive HEAD` checkout 一樣要全過）
2. `node tools/fit-score.js` 顯示 `可以計誤差 4/4　完全命中 4/4　總絕對誤差 0`
3. 動到影像嘅話：`node tools/build-glyph-templates.js --exclude=uma2 --verify`
   → **面板截圖 30/30**（三閘：**實機面板條 13/13**、**負樣本 3/3 唔出數**），全部都要中
   ⚠️ 負樣本（`shots/negatives/`）有任何一幀讀到數 → **唔會寫檔**（同其他失敗一樣）
4. 動到墨點／色相／亮度門檻嘅話：`node tools/diag-hue.js --assert` 要通過
5. 動到實機面板條（`statbar.js`／`capture.html`）嘅話：
   `node tools/diag-statbar.js --read` → **13/13**（自動對 `data/live-truth.json`）
   ＋ **負樣本 3/3 唔出數**；＋ `node tools/replay-dumps.js` → **退步 0**
   ⚠️ `replay-dumps` 仲會報「修正假陽性」同「冇當時結果記錄（every 幀）」——
      後者係 `UMAPYOI_DUMP_FRAMES` 影嘅任意幀（冇 reason 亦冇 stats）→ **唔准當佢係 OK**
      （舊版 `tagOf(undefined)` = OK → 假退步；2026-09-19 已修）

任何改動令呢幾樣唔達標，就係改壞咗。

---

## 3. 檔案地圖

```
src/umascore/
  tables.js       # ⭐ 五維精確演算法 statPoints() ＋ ランク表（G→UA）
  skills.js       # 技能評價點（適性倍率、固有、繼承固有）
  profiles.js     # 版本 profile（tw / cn / jp，現時三個共用同一張表）
  evaluate.js     # evaluate()：唯一需要 100% 準確嘅核心，純函數零 I/O
  calibrate.js    # 對答案邏輯
  index.js        # re-export

src/vision/
  inkmask.js      # ⭐ 背景受控墨點遮罩（顏色 + 「深色字喺淺色底」）＋ 文字行切分
  digitrow.js     # ⭐ 五維數字列偵測（密集帶、收窄、砌數字、揀 5 個、結構評分）
  statbar.js      # ⭐⭐ **實機面板條**（畫面 A）：相對 ROI → 切大數值行/上限行 →
                  #    只按右邊界間距揀 5 個 → 讀數 ＋ 信心閘（見地雷 #23/#24）
  glyphs.js       # 切字元 → 尺度歸一化 → 模板比對（NCC）＋ 由右邊貪心收剔徽章
  reader.js       # ⭐ 影像 → 五維 → 評價分；幀間多數投票（StatTracker）
  png.js          # 零依賴 PNG 解碼器（讀實機截圖用）
  pngwrite.js     # 零依賴 PNG **編碼**器（dump 實機幀做證據用；有 round-trip 測試）
  skillscreen.js  # ⭐ 技能畫面（畫面 B）欄／行／名框偵測（見 §6.5）
  skillname.js    # ⭐ 技能名「影像特徵」＋比對（絕對尺度；Phase 2 識字路線，見 §6.5）
  anchor.js       # ⚠️ 已棄用（靠粉紅色揾面板 → 見地雷 #10/#11），保留只為舊測試
  panel.js        # ⚠️ 同上（粉紅比例版），未接入主流程

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
                  #    assertFullDisplay()（7 個 display key 齊全嘅閘，applyHudConfig 用）
                  #    ⚠️ 語意（2026-09-19）：**size 為準**，x[1] = x[0] + size.w 由推導得出；
                  #       寫死嘅 x[1] 同推導值唔一致 → 警告（onWarn，唔 throw）；
                  #       只有「推導出嚟嘅範圍唔合法」才 throw（見 §2／§6.4）
  config-path.js  # ⭐ 設定檔擺邊（純函數）：開發 = 專案根；打包／asar = app.getPath('userData')
  env-flag.js     # ⭐ 環境變數開關旗標嘅**唯一**讀法（`envFlag()`，純函數可 node --test）：
                  #    只有 "1"／"true"（大小寫唔敏感）＝ 開；0／false／空字串／冇 set ＝ 閂；
                  #    其他值 ＝ 閂 ＋ 警告（`onWarn` 可收集）。main.js 三個旗標都用佢

electron/
  main.js         # 主程序：視窗列舉 → statbar.readStatBar()（cropped）／reader.readStats()
                  #    → evaluate() → console log ＋ **推落 HUD**（見 §6.4）
                  #    另有：HUD 設定窗管理、滑鼠穿透 funnel（setHudInteractive）、拖位 IPC
  capture.html    # 擷取 renderer：getUserMedia → **1:1 剪面板 ROI**（冇 ROI 就退回 640px 縮圖）
  hud.html        # HUD overlay renderer：透明無邊框，只畫主程序推落嚟嘅 view（＋對位模式拖位）
  settings.html   # ⭐ HUD 設定窗（**普通視窗**，classic script）：8 個數值 slider ＋ 7 個顯示選項
                  #    ⚠️ 標題唔准含遊戲關鍵字（會蓋過 BrowserWindow 嘅 title，見地雷 #27）
                  #    ⚠️ slider 上下限由純函數 fieldBounds() 動態計（冇死區）＋
                  #       用戶互動中唔搶佢手上嗰個控制 ＋ 顯示 HUD 實際螢幕像素範圍（地雷 #28）

test/
  capture-source.test.js # ⭐ 擷取來源挑選（**排除本程式自己嘅窗**、標題三級相符、
                      #    同分保留原本次序、唔合法輸入唔准 throw —— 見地雷 #27）
  hud-config-sync.test.js # ⭐ **接線閘**（static wiring gate）：拖 HUD（主程序自己改設定）之後
                      #    一定要通知設定窗（`remote: true`）＋ 設定窗收到一定要寫返落表單
                      #    —— 防止「拖完再撳儲存就彈返舊位」靜默復發（見地雷 #29；兩個檔都入唔到 node --test）
  hud.test.js         # HUD 幾何／狀態（anchorHud／contentRect／hudState 基本行為）
  hud-display.test.js # ⭐ 顯示選項（7 個 boolean）＋ 金色格嘅**真實粒度**（整體 boolean）
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
  hud-settings-html.test.js # ⭐ 「設定窗 ↔ config.js 欄位對齊」：**真係由 `electron/settings.html` 抽**
                      #    `DISPLAY_FIELDS`／`NUM_FIELDS` 再同 `HUD_DISPLAY_KEYS`／layout 欄位比對
                      #    （之前呢兩份清單係人手抄嘅，加一格／少一格冇人知）
                      #    ⭐ 另有 3 條由 HTML **抽 `fieldBounds()` 出嚟執行**（唔係抄公式）：
                      #    「x0 上限唔可以再寫死成 1」、「任何情況下拉到最大都仍然合法（冇死區）」、
                      #    「大細下限／x1 起碼值／dx dy 嘅 ±1」（地雷 #28）
  hud-env-flag.test.js # ⭐ `envFlag()` 21 個值嘅行為（1／true 系 7 個開、7 個閂、7 個唔認識要警告）
                      #    ＋ 預設 env＝process.env、預設 onWarn＝console.warn

tools/
  fetch-skill-db.js      # bwiki 技能庫抓取
  fill-ground-truth.js   # 技能名 → base／條件／適性；override 機制
  fit-score.js           # 對答案報表
  breakdown.js           # 逐招明細表
  read-stats.js          # ⭐ 截圖 → 五維（可 --gt 對答案、--trace 睇字元分數）
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
  check-renderer-syntax.js # ⭐ renderer inline script 嘅**語法閘**（抽出 `<script>` 再 `node --check`）——
                         #    三個 HTML 入唔到 `node --test`（classic script ＋ DOM），打錯一個字
                         #    就係「HUD 靜默唔郁」而冇錯誤訊息 → 呢個係最低成本嘅防線（見 §8 4b）

data/
  skill-db-tw.json       # 1323 招技能（繁中）
  skill-overrides.json   # 主 DB 冇收錄嘅技能（繼承技）
  glyph-templates.json   # ⭐ 10 個數字字形模板（16×24，NCC 用）
  live-truth.json        # ⭐ 實機面板條真值（values ＋ 每張圖 perShot 例外；`roi-*` = 已剪 ROI）
  skill-name-lib/        # ⭐ 技能名影像庫（index.json ＋ img/*.png；個名未配）
  skill-name-labels.json # ⚠️ 我第一次人手標註嘅 112 格（**已知有錯位**，唔要當真值）
  calc-page-tw.html      # bwiki 頁面 cache
  ground-truth/*.json    # 4 條培育完成紀錄（誤差 0 嘅證據）

shots/
  gt/*.png               # ステータス面板排法（30/30 嘅證據）
  live/live-*.png        # ⭐ 實機育成主畫面 1356→2560 五個解析度
  live/roi-regress-*.png # ⭐ **實機失敗幀**（已剪 ROI）—— 永久回歸案例（地雷 #25/#26）
  live/roi-live-*.png    # ⭐ 實機**成功**幀（已剪 ROI，每個檔名尾 = 速度值）；真值喺 `live-truth.json`
  negatives/*.png        # ⭐ **負樣本**（其他畫面：支援卡列表／插畫…）—— 每一幀都**唔准出數**；
                         #    資料夾本身就係宣告（加檔就自動入四個閘，見地雷 #30）
  skill-dump/            # ⭐ 技能連拍收到嘅頁面 PNG（UMAPYOI_SKILL_DUMP=1；唔入 git）
  live-debug/            # ⚠️ 執行時自動 dump（.raw ＋ .json，唔入 git）；有代表性嘅
                         #    手動複製去 shots/live/ 再入 live-truth 做正式回歸

docs/
  formula.md             # 公式推導、驗證、來源
  vision-design.md       # 影像辨識設計（座標模型、畫面清單、邊界情況）
  skill-screen.md        # ⭐ 技能畫面（Phase 2）實測版面 ＋ 識字嘅硬限制同可行路線
```

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
已用 4 條實機樣本驗證：
`20589→UG2`、`28211→UF8`、`32334→UE2`、`36575→UD3`。

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

## 5. 地雷清單（全部踩過，唔好再踩）

| # | 地雷 | 正確做法 |
|---|---|---|
| 1 | 用分段直線插值計五維 | 用 `statPoints()` 精確演算法 |
| 2 | 信 wikiru 舊表「400 → 557」 | **400 → 577**（557 係打錯，用 557 反推 500 會變 557 而唔係 847）|
| 3 | 技能名直接字串比對 | **要正規化標點**：`競賽的精髓・體能`(U+30FB) vs wiki `競賽的精髓．體能`(U+FF0E) |
| 4 | 資料庫揾唔到就當「繼承固有 180」 | 要先查係咪**劇本進化技能**（技能Pt = 0）或者**繼承技**（wiki 命名空間 `繁/继承技/`）|
| 5 | **◎ 雙圈睇成 ○ 單圈** | 兩者 base 差 45 分（129 vs 174、217 vs 262）。呢個錯我犯過，令 5 招 × 45 = 225 分偏差 |
| 6 | 多條件適性「同類相乘」 | 要**同類取最大**（wiki 文字寫「相乘」係唔準確，要跟 widget 嘅 if 鏈）|
| 7 | 草地／沙地照乘適性 | **唔乘** |
| 8 | 把「自己嘅固有技能」同「同名嘅繼承固有」撈亂 | 彩色漸變 + Lv = 自己嘅；同名但冇 Lv = 繼承固有 |
| 9 | 技能清單靠人手抄 | 已實測會漏／錯（◎、標點）。**長遠要靠 icon 識別（Phase 2）** |
| 10 | **用「粉紅色」嚟揾ステータス面板** | ⛔ **面板顏色係跟隻馬嘅主題色，唔一定粉紅**（用戶實機確認）。任何寫死色相嘅判定都會喺其他馬身上失效。要改成**色彩無關**：直接捉「5 個數字」嘅結構 |
| 11 | 用 `longestPinkRun()` 呢類「連續段」做特徵 | 標題列有文字同 icon，橫向連續段會被打斷。要用**逐行比例**或者**結構**做特徵 |
| 12 | ⭐ **只用「顏色」判數字墨**（`isDigitInk` 睇色相 + 亮度） | ⛔ 呢個係之前一直偵測唔到嘅**真正根因**。遊戲插畫／背景係一大片暖色調，大量像素啱啱好落喺「橙棕 + 偏暗」窗口入面。實測 `shots/reference.png`：原始墨點 67,917 粒，當中最長一條「文字行」係 **y=400..939（高 540 行）、墨點 48,372 粒** = 成幅插畫被當成一行文字。**正解**：墨點一定要係「**深色字喺淺色底上面**」→ `inkmask.js` 用積分圖查窗口淺色比例（色彩無關）。加咗之後 67,917 → 22,125，插畫整條消失 |
| 13 | 按「墨量」揀數字行 | ⛔ 插畫墨量比真正數字多一個數量級，按墨量排名一定揀錯。**正解**：先切文字行（`findTextLines`）→ 行內再切密集帶（`denseBands`）→ 用「砌得出 5 個等距數字」＋「5 個數字要佔盡該行墨量（coverage）」做判準 |
| 14 | 用「中位間距 × 2.2」做砌數字嘅自適應門檻 | ⛔ 徽章同數字之間隔 11~20px，而數字內部只隔 2~7px；中位數會被徽章嘅大間距拉高（median 13 → 門檻 30）→ 徽章同數字黏成一個「數字」→ 切字元爆數。**正解**：固定門檻 10px（真實分佈嘅安全邊界好闊：數字內部 2–7、格與格 28–68）|
| 15 | 相信 `data/glyph-templates.json` 舊模板 | ⛔ 舊模板係用**一列錯嘅字**建立（舊偵測器揀錯行）＋ 驗證步驟比錯嘢（用全部字元比真值位數），所以模板完全垃圾（相似度 0.07~0.6）。**正解**：`build-glyph-templates.js` 而家有硬閘 —— **驗證唔到 100% 就唔寫檔**。任何改動之後要跑 `--verify` |
| 16 | 假設「每格字元數 = 數字位數」 | ⛔ ランク徽章有冇被墨點遮罩收錄，係跟隻馬嘅主題色（實測 uma1 冇、uma2/uma3 有）。**正解**：`readNumberTrimmed()` 由**右邊**貪心收（數字右對齊），遇到低分字元就停 |
| 17 | 用「揀令最差分數最高嘅後綴」剔雜訊 | ⛔ 會**過度截短**：模板係平均值，同一串數字總有啲字元分數低啲，掉走最弱嗰個一定令最差分數上升 → 「1840」讀成「40」（實測）。要用 #16 嘅貪心法 |
| 18 | `tightenBand()` 門檻設太高（例如峰值 0.4） | ⛔ 字形嘅橫劃（「8」中間、「5」頂）會令個別行墨點數遠高於其他行，太高嘅門檻會令收窄出嚟嘅帶只剩一兩行。用 **0.25**，而且揀「墨量最多」嘅連續段而唔係「包含第一條峰值行」嗰段 |
| 19 | 假設 `shots/gt/uma2-*.png` 同 `02-西野花…UE2.json` 對應 | ⛔ **對唔應**。同一套模板喺 uma1/uma3/uma4 係 30/30 全中，但 uma2 兩張圖一致讀出 **1937/993/1077/848/1198**（相似度 0.78~0.99、次選分數明顯低 → 唔係讀錯），即五維分 24626、ランク UF1。JSON 嘅 note 自己寫「取代舊嘅 UE6 紀錄」，所以**截圖應該係舊一輪**。→ 建模板要 `--exclude=uma2`；長遠要補返對應嘅截圖或者更正 JSON（⏸️ **用戶 2026-09-19 決定唔理** —— 唔重要；但 `--exclude=uma2` 呢個閘**唔准拆**）|
| 20 | **以為可以用色相視窗剔走ランク徽章** | ⛔ **徽章色相同數字墨重疊**（實測 8 張圖：徽章 hue **17–44°**、數字墨 hue **25–26°**；uma4 徽章 17–27° 幾乎一樣）。金／銅徽章色相落喺窗口內，亮度（0.34–0.60）都低過 0.62 → **色相＋亮度都剔唔走**。真正剔走徽章嘅係**結構條件**（徽章坐喺主題色漸變底 → 窗口淺色比例唔夠），成品殘墨只有 16~84 粒。→ 唔好靠色相做徽章判準；任何「徽章色相」推論（例如當讀數防錯）要用**位置／形狀**，唔好用色相。閘：`node tools/diag-hue.js --assert` |
| 21 | 色相窗口「隨手調闊／調窄」當係無害微調 | ⛔ 色相窗口係**行偵測**嘅命脈，唔止係清潔度：實測色相／亮度**全開**（0–360°、唔限亮度）→ 偵測由 8/8 張跌到 **2/8 張**（暖色插畫淹沒）。反過來 `hueMin` 一過 25° 就 **0/8 張**（真數字墨就係 25–26°）。安全範圍：`hueMin` 0–25、`hueMax` 35–90、`lumMax` 0.50–0.70、`deltaMin` 0–60。→ 改之前跑 `node tools/tune-detect.js --hue` |
| 22 | ⭐ **以為「縮圖 640px 冇問題，只係未試」** | ⛔ 實測（`node tools/diag-scale.js`）：整條管線**只喺原生尺度行得通**（1.0 → 30/40 全對；0.9 → 25/40；0.8 → 20/40；0.6 → 0/40；**0.336 = 實機 640px → 偵測 0/8、讀中 0/40**）。死因**唔係**色相窗口（探針顯示細尺度仲收到 14–22% 墨），而係下游寫死嘅像素門檻假設字高 ≈17px：`scoreNumberRow()` `minHeight 8`、`minGap 3`、`groupsToNumbers()` 固定 10px、`buildInkMask()` `windowRadius 6`。而且調參救唔返（`--tune=0.336` 45 個組合全部 0/8）。→ 動擷取端之前一定跑 `diag-scale.js`；見 `docs/vision-design.md` §2.2.2。 ✅ **2026-09-18 已修**：唔再縮全畫面，改為 renderer **1:1 剪面板 ROI**（原生像素，~0.5MB/幀），`main.js` 用 `readStatBar({ whole: true })` |
| 23 | ⭐⭐ **以為「gt 30/30 = 實機行得通」** | ⛔ **最嚴重嘅一個**。gt 截圖係**另一種排法**（5 個同位數、闊度相近嘅 4 位數字一行，格距 110px、字高 17px）。實機**育成主畫面**每個屬性格係「**大數值（上面）＋ `/上限`（下面細字）**」→ 現行「揀 5 個闊度最相近嘅等距數字」判準**一定揀到『上限』欄**（上限全部 4 位、闊度一致；數值 2–3 位、闊度唔一致）。實測 5 個解析度（1356→2560）**5/5 都讀錯欄**：讀出 `1946/1600/1600/1500/1450`（＝上限）而真值係 `226/54/139/85/102`，信心仲有 0.55–0.70 → **靜默報錯數**。而且 band 會把「大數值行＋細上限行」**合併**，砌數字時混行 → 連上限都讀唔準。→ 實機要**先切行（大數值 / 細上限）再砌數字**，唔可以靠「闊度相近」呢個判準。 ✅ **2026-09-18 已修**：`src/vision/statbar.js`（相對 ROI → 切行 → 只按右邊界間距揀 5 個 → 信心閘），實機 5/5；另加 10 個合成測試（`test/statbar.test.js`）守住 |
| 24 | **假設遊戲 UI 係固定像素大細** | ⛔ 賽馬娘桌面版**冇固定解析度，只有固定 16:9**（用戶確認）。實測 5 個解析度：cell pitch ÷ 圖闊 = **0.0494–0.0498（恆定）**、面板列 normalized y = **0.691–0.703（恆定）** → **UI 完全等比縮放、面板相對位置穩定**。即係：① 唔可以用固定 `THUMB_WIDTH`（1280 窗同 4K 窗行為完全唔同）；② **相對 ROI 係可行而且穩定**（同地雷 #10 嘅「寫死色相」唔同：寫死**相對座標**喺固定比例之下係安全嘅）；③ 字高 ∝ 圖闊（實機量到：數值 ≈ 0.0098×闊、上限 ≈ 0.0064×闊）→ 要「正規化字高」而唔係「固定解析度」 |
| 25 | ⭐ **以為「相似度 0.55 門檻好安全」，同埋「數字框入面一定只有數字」** | ⛔ 實機（1920 窗）會出現「第 5 個數值讀唔清」，三個根因都係違反呢啲假設：① 數字**右邊多咗一舊 3×4 像素碎片**（格線／高亮邊緣，0.28 分）→ `readNumberTrimmed()` 由右邊貪心收，一撞到低分就**即刻停** → 成格報「?」，連左邊正確數字都讀唔到；② 真數字「8」最佳匹配**仍然係 8**，但得 **0.41** —— 實機數字係**漸變色**（上淺下深），墨點遮罩削走較淺嘅上半 → 相似度天然偏低；③ 其他畫面（選單／列表）嘅**細字**都會被當成面板條 → 報「讀唔清」（假警報）。**正解**：`dropNonDigits()`（同字數字元一定同高）＋ `minAccept` **0.40**（實測掃描：0.45 讀到 9 幀、0.40 讀到 10 幀、再低冇用，而且全部同已知值一致）＋ `expectedGlyphHeight()` 判斷（UI 等比 → 字高 ≈ 0.0098×圖闊，遠細過就判 **`notBar`**，log 同 dump 都分開處理）。⚠️ **試過但否決**：放寬 `lumMax` 0.62 → 0.85 想救返上半漸變色，實測**反而讀錯**（`727/108/…`、`727/188/…`）兼真值跌到 6/8。驗證工具：`tools/replay-dumps.js`（重播失敗幀，**唔可以只用成功圖驗證**）|
| 27 | ⭐⭐ **以為「揀擷取來源」係小事，同埋「自己個窗標題唔會撞到遊戲關鍵字」** | ⛔ **最貴嘅一個 bug（用戶 2026-09-19 實機報「擷取咗設定視窗而唔係賽馬娘個 app」）**。舊寫法係 `sources.find((s) => GAME_TITLE_HINTS.some((h) => s.name.includes(h)))`，而**本程式自己嘅設定窗標題**係「賽馬娘即時評價分 — HUD 設定」→ **含「賽馬娘」**。`getSources()` 係 **z-order／前景優先** → 用戶一撳設定窗（它一定喺前景，因為啱啱先撳過）就揀咗佢。⚠️ **完全唔會報錯**（個窗真係存在），但症狀離奇：① 三個窗都有 `setContentProtection(true)`（＝`WDA_EXCLUDEFROMCAPTURE`）→ 擷取到嘅係**全黑** → 五維永遠讀唔到（只 log「唔見面板條」，屬正常）；② `capture.html` 報返嘅 `fullWidth/fullHeight` 變咗**設定窗大細**（實測 560×780）→ `placeHud()` 攞住錯嘅「遊戲內容區」（560×315）→ HUD 縮到 188×146、**可拖範圍** x∈[0, 932]（＝1920 螢幕嘅左半邊）→ 用戶見到嘅係「HUD 淨係可以喺左半邊拖嚟拖去，右半邊唔得」＋ 存檔 `offset.dx` 飽和成 **1**。**指紋**：`offset.dy = -0.8235294117647058`（＝要個窗擺喺內容區上方 0.8235×高，用真內容區（1080）根本做唔到，最多 −size.h；用 315 就啱啱好）。**正解**：①「**排除自己嘅窗**」係**必要條件**（HWND 硬排除 ＋ 標題第二重，見 `src/capture/source.js`，有 10 個測試）；② 標題三級相符（完全相符 3／開頭 2／包含 1）令瀏覽器攻略頁（只「包含」）唔會贏遊戲本體；③ 自己嘅窗標題**唔准**含遊戲關鍵字（`settings.html` 嘅 `<title>` 會蓋過 BrowserWindow 嘅 `title` → 兩邊都要改）；④ `warnIfSourceTooSmall()`：「擷取到嘅畫面比工作區細好多」即刻大聲警告（呢句就係可見防線）；⑤ ⚠️ **關鍵字清單要包含「完全相符」嘅真標題** —— 實機遊戲窗係「**賽馬娘Pretty Derby**」（`娘` 同 `Pretty` 之間冇空格），只寫「賽馬娘」嘅話遊戲本體**只係 2 分（開頭相符）**，同瀏覽器攻略頁**同分** → 同分就跟 z-order 亂咁揀（實測 log：`揀咗：賽馬娘Pretty Derby（分數 2）`）。加咗完整標題之後遊戲係 **3 分**，永遠贏（回歸：`test/capture-source.test.js`「實機見到嘅遊戲標題要係完全相符」）。驗法：開住設定窗跑 `npm start`，睇 `[來源] 見到嘅視窗` 清單同 `[HUD] 對位：遊戲 W×H` 係唔係遊戲大細 |
| 28 | ⭐⭐ **以為「拖位只改 `offset`」同「slider `max=1`」冇問題** | ⛔ 用戶實機報「拉到某個位就唔再跟」、「拉咗之後自己彈返」、「HUD 淨係可以喺左半邊拖」。根因兩個，都係**上下限唔對應模型**：① `layoutFromBounds()` 舊設計只改 `offset`，而 `offset` 有 **±1** 上限（`config.js` 契約）→ 拖到某個位就**飽和**（實測用戶存檔 `offset.dx` 寫死成 **1**）；② 設定窗 `x0`／`y0` 嘅 slider `max` 寫死成 **1**，但模型係 `x0 + w ≤ 1`（用戶 w = 0.335 → 真正上限 0.665）→ 拉到 0.8 會被夾返，而 reply 又**無條件 `writeForm()`**（連用戶正拖緊嗰個 slider 都改）→ thumb 彈返原位。**正解**：① 拖位**位置直接寫 `x[0]`／`y[0]`**（冇 ±1 上限）＋ `clampLayout()` **夾入內容區**（`x0 ∈ [0, 1−size.w]`）→ HUD **永遠唔會走失**、`offset` 歸零（佢係 env 微調旋鈕，唔應該同拖位疊加）；② 設定窗上下限由純函數 `fieldBounds()` 計（x0 最多 = 1 − w、w 最多 = 1 − x0…）＋**貼 slider 格仔**（`stepFloor6/stepCeil6`，同 `LAYOUT_EPSILON` 相容 → 唔會假警報）；③ 用戶**互動中唔准**改佢手上嗰個控制（pointerdown／input／focus ＋ 400ms watchdog，放手 250ms 後對帳）。⚠️ **唔准**把「拖位只改 offset」改返（會即刻令 ① 復發）；⚠️ **唔准**把 slider `max` 寫死成 1。回歸：`test/hud-drag.test.js`（⭐「拖出界一定要夾返入內容區」、⭐「舊檔嘅飽和 offset 唔會再令拖位卡死」）＋ `test/hud-settings-html.test.js`（⭐「x0 上限唔可以再寫死成 1」、⭐「冇死區」，**真係由 HTML 抽** `fieldBounds()` 出嚟執行）|
| 29 | ⭐ **以為「拖完 HUD 就完」—— 唔記得通知設定窗** | ⛔ 用戶 2026-09-18 實機報：「拖完之後去設定窗撳『儲存』，HUD 彈返滑條嗰個舊位」。根因係一條**唔存在嘅線**：`applyHudConfig()` 只推 HUD（`placeHud()`／`pushHud()`），**從來冇通知設定窗** → 設定窗手上永遠係「上次 `hud-config` reply 嗰份」→ 用戶一撳「儲存」就 `readForm()` 送出舊值 → 覆寫拖完嘅位置（而且**照樣寫入 `hud-position.json`**）。⚠️ 症狀好易誤診成「拖位冇效」（拖位其實完全正常，係之後嗰下儲存拆返轉頭）。**正解**：`notifySettingsWindow()`（推 `remote: true`）喺 `applyHudConfig(config, { fromUi: false })` 嗰陣叫；設定窗收到 `remote` **一定**要 `writeForm()`（**蓋過** `interacting`，唔可以只更新「實際位置」嗰行）；三條由設定窗送落嚟嘅路（preview／save／reset）全部標明 `fromUi: true`（佢哋已經有 `replyHudConfig()` 回覆）。回歸：`test/hud-config-sync.test.js` —— **接線閘**（兩個檔一個係 IPC 主程序、一個係 classic script ＋ DOM，**都入唔到 `node --test`**，所以退而求其次由原始碼抽關鍵接線斷言）。⚠️ **唔准**拆走「拖完通知設定窗」嗰句 |
| 30 | ⭐⭐ **以為「只有面板條先砌得出 5 個等距數字」** | ⛔ 用戶 2026-09-18 實機 dump 揭出嘅**假陽性**（B5）：有一幀 `kind: ok` 讀到 `27/27/25/25/25`（信心 0.71），但當時真實數值係 700+。真身係**支援卡列表** —— 5 張卡嘅 `Lv27／Lv27／Lv25／Lv25／Lv25` 徽章**啱啱好**砌得出「5 個等距數字」，而「上限行」其實只係一條**卡片邊線**（4px 高、**24 粒墨**）。⚠️ 好彩嗰次只係 1 幀（投票冇出到），但**停留喺嗰個畫面 3/5 幀就會鎖定一個錯分**。**根因（兩個閘都太鬆，實測）**：字元高 ÷ 預期字高 真值 **0.85–0.96** vs 假陽性 **0.64**，舊門檻 **0.6** 啱啱好放佢過關；上限行**絕對**墨量 真值 **164–1599** vs 假陽性 **24**，而舊版**根本冇呢個檢查**。**正解**：`minGlyphHeightRatio` **0.8** ＋ 新增 `minLimitsInk` **60**（冇上限行嗰陣唔用 —— 有真值圖因為俾對話框遮住而冇上限行）。⚠️ **唔可以用「上限行墨量 ÷ 大數值行墨量」嘅比值**：真值 0.10–0.62 同假陽性 0.03 太近，會殺錯良民。**負樣本庫**：`shots/negatives/*.png` = 資料夾本身就係宣告「全部唔准出數」→ `npm.cmd test`／`diag-statbar --read`／`build-glyph-templates --verify`／`replay-dumps` **四個閘**都食（`replay-dumps` 用像素 hash 認得返「呢幀係已入庫負樣本」→ 計「修正假陽性」而唔係退步）|


---

## 6. 影像辨識設計原則

### 6.1 零校準（**唔准加手動框選**）

> 用戶明確要求：**即時偵測**，唔係「開程式 → 拉框 → 確認」。

**現行做法（2026-09-18 起有兩條路）**：

**路 1（主力）畫面 A 育成主畫面 —— 相對 ROI 面板條**（`src/vision/statbar.js`）

```
contentBox()          由圖闊推 16:9 內容框（扣 Windows 標題列）
locateStatBar()       相對 ROI（x 0.15–0.44、y 0.645–0.735）
                      → ROI 內切帶：大數值行（最高）／上限行（喺大數值行之後）
collectStatBarGlyphs() 遮罩喺**整個 ROI** 做（唔可以剪貼邊條帶，否則 6/8/9 會碎裂）
                      像素門檻按字高比例縮放（切字群 3px、砌數字 10px、窗口半徑 6）
pickFiveBySpacing()   只按**右邊界**間距揀 5 個（數值右對齊；唔用闊度，見地雷 #23）
extractGlyphs()       每個字元 → 16×24 網格（尺度不變）
readNumberTrimmed()   由右邊貪心收 → 數字；信心 < minConfidence 就唔出數
```

實測：`shots/live/` **9/9 全中**（5 張 1356→2560 全圖 ＋ 4 張實機失敗／金色幀做回歸，信心 0.52–0.89）。

⚠️ 實機數字係**漸變色**（上淺下深）＋ 數字框右邊可能有細碎片 →
`minAccept` 用 **0.40** ＋ `dropNonDigits()`；另外用 `expectedGlyphHeight()` 判
「唔似面板條」（`notBar`）→ log 同 dump 分開處理（見地雷 #25）。

實機跑（1920 窗）嘅實測分佈：47 幀 dump 入面，**35 幀係「唔喺面板畫面」**（正常）、
10 幀讀到而且數值一致、2 幀真問題（已修）。→ 唔喺面板畫面係**常態**，
HUD 要顯示上一個穩定值，唔好空白或者閃走。
⚠️ **用戶 2026-09-19 再確認一次**：log 見到 `[讀唔到] … ROI 內只搵到 1 條帶`（判 `notBar`）
係因為佢當時喺**其他介面**（唔係育成主畫面）—— 即係 `notBar` 判斷**冇誤報**，唔係讀唔清。

⚠️ **但係「唔喺面板畫面」唔等於「唔會出數」**（B5，2026-09-19）：實機 dump 揭出
**支援卡列表**嘅 5 個 `Lv27` 徽章砌得出「5 個等距數字」→ 舊版讀成 `27/27/25/25/25`
（真值 700+）＝ **靜默報錯數**。已加兩條閘（見地雷 #30）：字高比 **≥0.8**、
上限行墨量 **≥60**（兩個門檻都係量出嚟嘅：真值 0.85–0.96／164–1599、
假陽性 0.64／24）。**負樣本庫 `shots/negatives/`**：資料夾入面每一幀都係「其他畫面」
→ 全部唔准出數，四個閘（`npm test`／`diag-statbar --read`／`build-glyph-templates --verify`／
`replay-dumps`）都會自動覆核 —— **加檔就自動入閘**，唔使改 code。

⚠️ **金色格**（屬性 > 1200 之後**長期**金色，用戶確認）：**唔可以唔出數** ——
千二點之後會永遠冇數。判準係該格墨點色相 p90 ≥ 33°（正常幀 27–28°）→
**只喺嗰格**用放寬嘅 `lightFraction` 0.3 重做遮罩（`goldLightFraction`）
→ 讀返真值（實測 1489，唔再變 1483），同時回 `highlighted: true` 畀 HUD 標示。
所以「唔出數」而家只有三種：`notBar`（換咗畫面）、真失敗、信心不足。

**路 2（後備）ステータス面板排法 —— 全畫面結構搜尋**（`src/vision/digitrow.js`）

```
buildInkMask()      顏色（橙棕 hue 15–50°、偏暗）＋ 結構（深色字喺淺色底上面）→ 墨點遮罩
                    ↑ 呢一步刪走插畫，係整個管線嘅關鍵（地雷 #12）
                    ↑ 門檻而家係可調（`DEFAULT_INK_OPTIONS`），安全範圍見地雷 #20/#21
findTextLines()     連續有足夠墨點嘅行 → 文字行
denseBands()        行內再切「密集帶」（避免兩行黏埋）
tightenBand()       收窄到真正字身範圍（削走稀疏雜訊行，地雷 #18）
columnsToGroups()   欄投影 → 字群
groupsToNumbers()   用固定 10px 門檻砌返「數字」（地雷 #14）
pickBestFive()      由候選揀最似五維嘅 5 個（寬度相近、等距）
scoreNumberRow()    結構評分；再用 coverage（5 個數字要佔盡該行墨量）淘汰文字段落
extractGlyphs()     每個數字 → 切字元 → 縮去 16×24 網格（尺度不變）
readNumberTrimmed() 由右邊貪心收（自動剔走徽章／雜訊）→ 數字
```

字形模板**尺度歸一化**（切字 → resize 去固定網格 → NCC），所以一組模板通用所有解析度。
幀間再做**多數投票**（`StatTracker`，視窗 5、過半數 3）＋ 單調性檢查，
讀唔到就唔出數（`HUD` 要老實顯示，唔好亂估）。

### 6.2 三個畫面（唔可以撈亂）

| 畫面 | 內容 | 用途 |
|---|---|---|
| **A** 育成主畫面 | 五維數字 | 即時計五維分 |
| **B** 賽馬娘詳情 → 技能 | **已學技能列表** | ⭐ 主力讀取目標 |
| **C** 點技能 | Pt 價格、「已獲得」 | Phase 3 what-if |

技能未讀到嗰陣，HUD 要老實顯示 `技能分 ？／總分 ≥ X` 並**提示玩家開 B 畫面**。

### 6.3 架構決定：CV 邏輯放 Node 主程序

renderer 由 `file://` 載入，**ESM import 會被 Chromium CORS 擋**。
所以 renderer 只做「擷取 → **1:1 剪面板 ROI**（相對範圍由主程序經 IPC 傳落嚟，
兩邊共用 `statbar.js` 嘅常數）→ 傳 raw RGBA」，所有影像辨識喺 `electron/main.js`（Node）度跑。
冇 ROI（舊格式／未收到）就退回「縮圖全畫面」嘅舊行為。

好處：**可以用 `node --test` 直接測試**，唔需要開 Electron；
而 `tools/diag-statbar.js --cropped` 就係模擬 renderer 嗰個剪法，
所以「執行時路徑」同「診斷路徑」永遠一致。

### 6.4 HUD overlay（透明置頂、穿透點擊）

```
src/hud/layout.js   anchorHud()   相對位置 + 大細 + 偏移（全部 ÷ 內容區；見下面）
                    contentRect() 由視窗範圍推內容區（扣 Windows 標題列，同 contentBox() 一樣）
                    hudState()    四態：ok／stale（讀唔到但保留上一個值）／none／edit（對位模式）
                                  同時組好顯示行：評價点、五維逐格、五維分、技能分
                    layoutFromEnv() 讀 UMAPYOI_HUD_* 環境變數（唔合法會 throw，唔會靜默當 0）
electron/hud.html   透明無邊框頁面，只畫主程序推落嚟嘅 view（顯示邏輯唔喺 renderer 重複寫）
```

用戶指定：先做醜版 → 再擴充到**五維逐格 + 技能分 `？／總分 ≥ X`**；
位置由用戶自己實機調（見下面）。

**預設位置**：x 0.598–0.810、y 0.030–0.285（大細 0.212 × 0.255）。
⭐ 呢個係**用戶 2026-09-18 自己調出嚟嘅**：原本基準 x 0.008–0.220、y 0.700–0.955，
用戶用 `UMAPYOI_HUD_DX=0.59`、`UMAPYOI_HUD_DY=-0.67` 調到想要嘅位就話「OK」，
所以直接寫成預設（附錄：唔使每次開程式打環境變數）。

⚠️ **唔好見到位置數值「古怪」就當係 bug 去「修」（我犯過）**：
用戶係**特登**要 HUD 擺嗰度（唔係擺錯位要補償）。要改位置只有兩個正路：
`UMAPYOI_HUD_EDIT=1` 睇即時數值再調、或者直接改 `DEFAULT_HUD_LAYOUT`。

⚠️ **唔啱位唔使改 code**（三個方法，全部唔使改 code）：
1. **開設定窗**（`npm start` 會一齊開，見下面「獨立設定窗」）—— 拉 slider 即時生效
2. **`UMAPYOI_HUD_EDIT=1 npm start`** 開對位模式 → **直接用滑鼠拖 HUD**（放手即寫入 `hud-position.json`）
3. 環境變數 `UMAPYOI_HUD_X`／`_Y`／`_DX`／`_DY`／`_W`／`_H`（**優先過**設定檔）

#### 獨立設定窗（`electron/settings.html`）

```
npm.cmd start                      # 一齊開（HUD + 設定窗）
UMAPYOI_NO_SETTINGS=1 npm.cmd start  # 只唔開設定窗（HUD 照開）
UMAPYOI_NO_HUD=1 npm.cmd start       # ⭐ 兩個窗都唔開（淨係要 console log 嗰陣用）
```

- 一個**普通視窗**（`frame:true`／`resizable:true`／`focusable:true`／唔透明）——
  ⚠️ **唔可以塞入 HUD 裏面**：HUD 一開滑鼠事件就會擋住用戶點遊戲（本專案底線）。
- 8 個數值（`x0`／`x1`／`y0`／`y1`／`dx`／`dy`／`w`／`h`）：slider ＋ 輸入框雙向；
  7 個顯示選項 checkbox（`total`／`stats`／`statScore`／`skillScore`／`goldMark`／`note`／`edit`）。
- 改任何值 → **即時**經 IPC 推落 HUD（未存檔）；「儲存」→ 寫 `hud-position.json`；
  「還原預設」→ 即時套用純出廠預設（**刻意唔寫檔**，要寫就再按「儲存」）。
- ⚠️ **閂咗設定窗就要重開程式先開得返**（冇選單／快捷鍵，因為 `focusable:false` 嗰種限制
  喺設定窗唔存在但唔想加額外 UI）—— 同對位模式一樣係「開程式時決定」嘅設定。
- ⚠️ 不變式：`x1 = x0 + w`、`y1 = y0 + h`（設定窗同拖位共用同一個模型）。
  ⚠️ **2026-09-19 起嘅確切語意**：`x[1]`／`y[1]` 係**由 `size` 推導出嚟嘅**（`x[1] = x[0] + size.w`）——
  `anchorHud()` 只用 `x[0]` 定位、用 `size` 決定大細，所以 `x[1]` **唔影響渲染**。
  設定窗送嘅值如果「範圍末端」同「起點 + 大細」唔一致 → **以 `size` 為準 ＋ 大聲警告**
  （`main.js` `configFromUi()` 經 `onWarn` → `[設定] ⚠️ …`），**唔會** throw。
  真正 throw 只有「推導出嚟嘅範圍唔合法」（右邊界 > 1／`size <= 0`／`x[0] < 0`／offset 超出 ±1）。
  `clampLayout()` 係**唯一**做夾嘅地方（用戶拉爆 slider／拖出界一律夾返合法，唔會出現「拉咗但冇反應」）。
- ⚠️ `offset`（`dx`／`dy`）只夾到 **±1**（同 `config.js` 契約一致），
  **唔會**夾到「一定喺螢幕內」→ 極端 offset 會令 HUD 走出畫面。所以（2026-09-19 實機之後）：
  - 設定窗顯示**實際螢幕像素範圍**（主程序經 `hud-config` 報 `bounds`／`content`）——
    HUD 有 `setContentProtection`（截圖影唔到）→ 呢幾個數就係「HUD 到底擺咗喺邊」嘅唯一可見證據
    ＋ 講明**邊幾邊**走出內容區（唔再係一句籠統警告）
  - `main.js` `warnIfHudOffContent()`：走出內容區就照實 log（連「完全睇唔到／只有一部分睇得到」），
    並指去「還原預設」。⚠️ **只出警告，唔會自動改用戶設定檔**（見上面「唔好見到位置古怪就當 bug 修」）
  - ⚠️ `x0`／`y0` 嘅 slider 上限係**動態**（純函數 `fieldBounds()`：x0 最多 ＝ 1 − w、
    w 最多 ＝ 1 − x0…）＋貼 slider 格仔 → 唔會再有「拉得到但一定被夾返」嘅死區（地雷 #28）
  - ⚠️ 用戶**互動中**（拖 slider／打字）唔准改佢手上嗰個控制，放手 250ms 後同主程序對帳
    （舊 bug：reply 無條件 `writeForm()` → thumb 彈返原位、數值跳）
  - ⚠️ **主程序自己改設定（＝拖 HUD）一定要通知設定窗**（`main.js` `notifySettingsWindow()`
    → `remote: true`）：唔通知嘅話設定窗手上係舊值 → 用戶一撳「儲存」就用舊值**覆寫拖完嘅位**
    （用戶 2026-09-18 實機報「拖完撳儲存，HUD 就彈返滑條嗰個位」）。設定窗收到 `remote`
    一定要 `writeForm(config, { keepFocused: false })`（**蓋過** `interacting`）。
    ⚠️ 呢條線橫跨 `electron/main.js`（IPC）同 `electron/settings.html`（DOM）→ 兩個都入唔到
    `node --test`，所以有 `test/hud-config-sync.test.js` 做**接線閘**（見地雷 #29）。
  - ⚠️ 真係要夾嘅時候，橫額一定要**逐個欄位**講（`describeClamp()`：
    `x0：0.9 → 0.665（x0 + w 唔可以大過 1）`）—— 唔准再出一句籠統「有數值超出合法範圍」
    （用戶實機原話：「佢去到某個數值就話會令 hud 跑出遊戲內容區，但係其實根本就冇」）

#### 對位模式拖位（`UMAPYOI_HUD_EDIT=1`）

- **正常模式（冇 `UMAPYOI_HUD_EDIT`）一定係 `setIgnoreMouseEvents(true)` 穿透** ——
  呢個係底線：一旦漏咗還原，用戶就**點唔到遊戲**。
  ✅ **已由獨立審計靜態證實**（讀 `main.js` 全檔，2026-09-19）：正常模式之下建立視窗硬寫
  `setIgnoreMouseEvents(true)` ＋ `setFocusable(false)` **永遠**成立；令 `ignore=false`
  只有 `setHudInteractive()`（funnel）**一條**路，而佢一定要 `UMAPYOI_HUD_EDIT` 開咗先得。
  「四重保險」**全部真存在**：① funnel 係唯一入口；② `finishDrag()` 嘅 `try-catch-finally`；
  ③ 拖位 watchdog（1200ms）；④ 每 500ms `assertHudPassthrough()` 再確認。
  ⚠️ 呢個結構**唔准改**（任何「順手重構」都要當成動到本專案最嚴重嘅後果嚟做）。
- ⚠️⚠️ **對位模式之下 HUD 係「全程」食滑鼠事件嘅（唔止拖緊嗰陣）** —— 用戶一定會撞到，
  所以講清楚：
  - `finally` 還原到嘅係**「對位模式嘅互動狀態」**，**唔係穿透**：`setHudInteractive(HUD_EDIT)`
    而 `HUD_EDIT = true` → 放手之後**仍然唔穿透**。（舊版文件寫「三重保險…所有離開拖曳嘅
    路徑都行 `finally` 叫 `setHudInteractive()`」，讀落好似「放手即還原穿透」—— 嗰個寫法係**錯**。）
    放手只係結束拖曳（反推 ＋ 存檔），刻意唔會令 HUD 變返穿透：要拖就一定要收得到滑鼠事件，
    兩者物理上互斥。
  - 所以 `UMAPYOI_HUD_EDIT=1` 之下：**HUD 覆蓋範圍內點唔到遊戲**（連冇拖嗰陣都係）；
    而且因為同時 `setFocusable(true)`，**點／拖 HUD 會攞走遊戲嘅 focus**
    （遊戲可能變背景、鍵盤輸入去咗 HUD）。
  - ⚠️ **要返正常模式（穿透）＝ 一定要重開程式**：對位模式係「開程式時用環境變數決定」，
    冇選單／快捷鍵可以中途切走（HUD renderer 喺 `focusable:false` 之下收唔到鍵盤）。
  - → 當佢係**一次性調位工具**：調完 → 存檔 → `Ctrl+C` 收工 → **唔帶環境變數**再開嚟用。
- ⚠️ **一定要經 `setHudInteractive()` 呢個 funnel**：`electron.d.ts` **冇**
  `isIgnoreMouseEvents()` getter → 讀唔返而家嘅狀態 → 要自己用 flag（`hudInteractive`）記住。
  ⚠️ **同上面「四重保險」係同一個清單**（2026-09-19 統一標籤）：
  ① funnel 係唯一入口；② 所有離開拖曳嘅路徑都行 `finally` 叫 `setHudInteractive()`
  （⚠️ 佢還原到嘅係**對位模式嘅互動狀態**，唔係穿透 —— 見上面警告）；
  ③ 拖位 watchdog（1200ms 冇新消息 = `pointerup` 唔見咗 → 收手）；
  ④ 每 500ms interval 喺正常模式**再確認**一次 `setIgnoreMouseEvents(true)`。
  ⚠️ 呢四重保險嘅用途係「**正常模式**唔會因為漏還原而擋住遊戲」——
  **唔係**「放手就回復穿透」（對位模式本身設計上就唔穿透）。
- 拖法：renderer `pointerdown` → `setPointerCapture` → `pointermove`／`up` ＋
  **`screenX/screenY`**（⚠️ **唔准** `clientX/clientY`：相對視窗，`setBounds()` 一移窗就
  自我回饋 → 抖／暴走），傳「相對按下嗰刻嘅總位移」。
  ⚠️ **唔用 `-webkit-app-region: drag`**：同 `setIgnoreMouseEvents(true)` 物理上互斥，
  而且透明窗 + `focusable:false` 之下行為未文檔化。
- ⚠️ **`placeHud()` 會蓋走拖完嘅位**（首幀、`display-metrics-changed`、設定窗改動都會再叫佢）
  → 放手之後**一定**要寫入 `hudConfig.layout` 再經 `placeHud()`，唔可以只 `setBounds()`。
- **反推**用 `layoutFromBounds(hudContent, bounds, layout)`：位置寫入 `x[0]`／`y[0]`
  （**2026-09-19 改**，舊版係「只改 `offset`」）＋ **夾入內容區** ＋ `offset` **歸零**，
  **唔改 `size`**。
  - 為何唔再用 offset：`offset` 有 **±1** 上限（`config.js` 契約）→ 拖到某個位就**飽和**
    （實測用戶存檔 `offset.dx` 寫死成 **1**），用戶見到嘅係「淨係可以喺左半邊拖嚟拖去」。
    位置本來就係 `x[0]`／`y[0]` 嘅意思，而佢哋冇 ±1 上限；`offset` 留返做「env／微調旋鈕」
    （拖位結果唔應該同佢疊加）。⚠️ **唔准改返做 offset 版本**（見地雷 #28）。
  - 為何**唔准改 `size`**：`anchorHud()` 有大細下限（`max(80,…)`／`max(40,…)`），被夾過嘅
    `bounds.width ÷ content.width` **唔等於** `size.w` → 攞佢寫 `size` 就係「拖一拖，大細自己變咗」；
    而且整數 round 會令 `size` 慢慢漂。
  - 夾入內容區（`clampLayout()`：`x0 ∈ [0, 1−size.w]`）係為咗「**HUD 永遠唔會走失**」——
    拖出界只會貼住邊，而且 `finishDrag()` 會 log 警告（唔准靜默改用戶拖到嘅位）。
  ⚠️ `hudContent` **一定**要係 `placeHud()` 計出嚟嗰個物件（單一來源）——
  唔准喺反推路徑再叫 `getPrimaryDisplay()` 或者用擷取幀嘅 `fullWidth/fullHeight` 另計一次。
- 拖完會**自動存檔**（`hud-position.json`，原子寫：`.tmp` ＋ `rename`）。
  ⚠️ 有 set 環境變數嗰陣，存咗都會俾 env 蓋過（優先次序係咁設計）→ 一定會 log 警告。

#### 設定檔（`hud-position.json`）

- 優先次序 **環境變數 > 設定檔 > 預設**（`resolveHudConfig()`）。
- 路徑：開發模式 = `<專案根>/hud-position.json`；已打包（或者 `ROOT` 落喺 `.asar`）= `app.getPath('userData')`
  （見 `src/hud/config-path.js`）。⚠️ **實際用邊條路徑一定 log**（`[設定] 檔案：…`），唔准靜默 fallback。
- ⚠️ **行為改動（刻意）**：合併之後會**再 validate 一次**，而且**兩類問題分開處理**：
  - **唔合法 → throw**：`UMAPYOI_HUD_X=0.9,0.5`（前後倒轉）、`x[0] + size.w > 1`（右邊界走出畫面）、
    `size <= 0`（`UMAPYOI_HUD_W=0`）、超出 0–1、`offset` 超出 ±1 —— main.js 會 catch 佢、
    大聲講、然後 `app.exit(1)`（唔留低冇窗嘅僵屍程序）。
  - **冗餘欄位矛盾 → 警告（唔 throw）**：同一個軸上面範圍同大細**兩樣都寫死而唔一致** →
    **以 `size` 為準 ＋ `[設定] ⚠️ …` 警告**。理由見 §2：`x[1]` 唔影響渲染，
    而 AGENTS §2 列出嘅六行環境變數一齊用曾經因為呢個 throw 而**完全開唔到程式**（實測）。
  - ⚠️ **警告係單一鏈路**（2026-09-19：`config.js` 兩處 ＋ `main.js` 一處都修正之後**先真正成立**）：
    去處由呼叫者嘅 `onWarn` 決定，而**三條會出警告嘅路**（`validateConfig()` 直接驗、
    `loadConfig()` 讀檔案、`resolveHudConfig()` 合併完再驗**同埋**驗 `fileConfig`）
    **全部**會將 `onWarn` 傳落去 → `main.js` 嘅 `warnHudConfig()` 加 `[設定] ⚠️` 前綴，
    設定窗／console 都收得到。三個入口（2026-09-19 逐一核對過）：
    ① `main.js` `configFromUi()` → `validateConfig(…, { onWarn: warnHudConfig })`；
    ② `main.js` `loadHudConfig()` → `loadConfig({ filePath, onWarn: warnHudConfig })`（L286）；
    ③ 同一個函數 → `resolveHudConfig(env, fileConfig, { onWarn: warnHudConfig })`。
    ⚠️ **雙重驗證係刻意嘅，但同一條矛盾唔會因此警告兩次**（2026-09-19 實測）：
    設定檔內容確實會被驗**兩次**（`loadConfig()` 內部一次 ＋ `resolveHudConfig()` 驗
    `fileConfig` 再一次），但 `loadConfig()` 交返嚟嘅係**已正規化**嘅結果
    （`x[1]` 已經被 `x[0] + size.w` 覆蓋、`size` 亦已收斂到 6 位小數）→
    第二次驗唔會再撞到同一個矛盾。**實測**：一個「`x[1]` 寫死 `0.5` 但 `size.w = 0.2`」嘅
    `hud-position.json` → 整條 `main.js` 鏈路 `onWarn` 收 **1** 條（帶 `[設定] ⚠️` 前綴）、
    裸 `console.warn` 收 **0** 條。
    ⚠️ **同一輪出多過一條警告係另一個情況（唔係重複驗造成，亦唔係 bug）**：
    同一個檔 x ＋ y **兩軸**都矛盾 → **2** 條；壞檔案 ＋ env 又寫死範圍同大細（§2 六行）
    → **2** 條（一條講檔案嘅、一條講 env 嘅）。兩條係**唔同**嘅矛盾，各自都帶
    `[設定] ⚠️` 前綴 —— 用戶見到重複措辭唔好以為出錯，照訊息講嘅值改就得。
    ⚠️ **修正前嘅實際缺口**（獨立審計實測）：`loadConfig()` 嗌 `validateConfig(raw)`
    **冇傳 `onWarn`**、`resolveHudConfig()` 嗌 `validateConfig(fileConfig)` **冇轉發**
    → **由設定檔引起**嘅警告會繞過 caller 直接落**裸 `console.warn`**（冇 `[設定] ⚠️` 前綴）。
    實測：`resolveHudConfig({}, {layout:{x:[0.1,0.5],size:{w:0.2}}}, {onWarn})`
    → caller 收 **0** 個、裸 `console.warn` 收 **1** 個。⚠️ 唔算靜默（訊息照出），
    但同「單一鏈路」唔一致而且零測試覆蓋 → 已修 `config.js` 嗰兩處 ＋ 加測試
    （`test/hud-config.test.js`：caller 要收 1 個、裸 `console.warn` 要收 0 個、
    兩條路徑嘅措辭要一致）。
    ⚠️ **第三個入口唔喺測試覆蓋範圍**：`main.js` 自己嗌 `loadConfig()` 嗰句
    （`electron/main.js` 零測試覆蓋，見 §9 第 5 條）—— 2026-09-19 補傳
    `onWarn: warnHudConfig` 之前，**由設定檔引起**嘅警告一樣落裸 `console.warn`
    （實測：`onWarn` 收 0 條／裸 `console.warn` 收 1 條；補傳之後 1／0）。
    ⚠️ 對照（唔准變靜音）：兩邊都唔傳 `onWarn` 嘅舊寫法一樣出 **1** 條裸 `console.warn`。
    ⚠️ `onWarn` **冇傳／唔係函數時一定仍然係 `console.warn`**（唔准因為加轉發而變靜音）。
- ⚠️ **設定檔壞咗（JSON 壞／欄位唔合法）＝唔同處理**：log 大聲 ＋ 用預設 ＋
  **唔覆寫你個檔**（設定窗顯示紅色橫額）。理由：檔案壞咗唔應該阻止擷取，但**一定唔可以靜默**。
- ⚠️ **唔可以寫額外欄位入 JSON**（例如 `savedAt`／`contentRef`）：
  `validateConfig()` 唔准唔認識嘅 key（打錯字要即刻出聲）→ 改為 log 出嚟。
- ⚠️ `hud-position.json` **唔入 git**（runtime 用戶狀態，人人唔同）。

⚠️ **一定要 `setContentProtection(true)`**：我哋用 `desktopCapturer` 擷取自己個螢幕，
冇呢個設定 HUD **會入到自己嘅擷取畫面**（等於自己讀自己嘅字）。
驗法：`UMAPYOI_DUMP_FRAMES=5 npm start` → `node tools/raw-to-png.js shots/live-debug`
→ 睇 dump 出嚟嘅幀有冇 HUD 嘅字。
✅ **2026-09-19 用戶實機驗過（B2）：dump 幀冇 HUD 自己嘅字 → `setContentProtection` 生效。**
（⚠️ 呢個係**安全關鍵**：一旦失效，程式就會讀到自己嘅字＝錯數。所以呢句一定要留住，唔准因為「已經驗過」而拆走驗法。）

⚠️ 讀唔到嗰陣**保留上一個穩定值**（`stale` 態，變黃色提示），唔會閃走或者顯示空白 ——
「唔見面板條」係常態（47 幀 dump 入面 35 幀都係），閃走會令 HUD 冇用。
五維逐格都要一齊留住（唔止總分）。

⚠️ **技能分未讀到唔可以出 0**：一定係 `技能分 ？／總分 ≥ 五維分`。
呢個係本專案底線（見 §8）——估一個數比起唔顯示更差。

⚠️ **HUD renderer reload／crash 之後一定要重推 view**（2026-09-19 修）：`pushHud()` 靠
`lastHudKey` dedupe（key 冇變就唔 send），但 renderer 一由零開始（對位模式之下 HUD 有
focus，**Ctrl+R 就踩得到**）就唔會再收到 view → 只要狀態唔變，HUD **永遠空白**。
而家 `main.js` 喺 `did-finish-load`（首次／reload 都行）／`render-process-gone`
（意外死亡會自動重載，上限 5 次）／`unresponsive`（只清 dedupe，唔強制重載）三條路都叫
`resetHudView()`：清 dedupe ＋ 經 `placeHud()` 重新對位 ＋ 即刻 `pushHud()`。
⚠️ 呢條路**唔准**改動滑鼠穿透狀態（穿透係**視窗**層屬性，renderer 生生死死唔影響）。

⚠️ **已知限制（用戶 2026-09-18 實機發現）**：遊戲視窗**移動**之後 HUD 唔會跟住 ——
因為我哋冇 Win32 API 讀遊戲視窗嘅螢幕座標（`desktopCapturer` 只俾 id／標題／大細），
而家用嘅係「前景顯示器工作區」做近似。**已完成嘅補救**：開 HUD 之後遊戲通常唔會再移，
而且可以用對位模式即時調。⭐ **用戶 2026-09-19 決定：唔做跟窗**（理由：「既然用家都可以
拖動個 hud 去擺喺自己想擺嘅位，跟窗就冇存在必要」；見 §9 ①）。
⚠️ **實際後果（要知，唔係 bug）**：位置係「**工作區左上角 ＋ 擷取到嘅遊戲大細**」嘅相對值
→ 只要遊戲位置／大細唔變，重開之後一模一樣；但**換咗遊戲大細**（或者將遊戲搬去第二個位／
第二個螢幕）就會按比例移位，嗰陣用對位模式再拖一次（或者設定窗撳「還原預設」）就係。

### 6.5 技能畫面（畫面 B，Phase 2）

```
src/vision/skillscreen.js
  rowInkProfile()   逐列墨量（用背景受控遮罩）
  findSkillRows()   切「技能列」（連續夠墨嘅列段；太高就切開）
  columnSpans()     一列入面分左右欄
```

⚠️ **墨點遮罩參數唔可以照抄面板條**（實測）：窗半徑 3／6 ＋ 淺色比例 0.4 →
墨點只有 0.13%／0.58%（收唔到技能名，行偵測 **0 列**）；**11 ＋ 0.2 → 1.92%** →
7 條技能列清清楚楚。原因：技能名係棕色字喺**中淺色漸變底**（唔係面板條嘅近白底），
窗太細就會被「窗口要夠多淺色底」呢個結構條件篩走。

⚠️ **唔可以寫死技能列嘅底色**（藍／青／粉／紫漸變、跟技能類型）—— 同地雷 #10 一樣道理。

實測版面（8 張 1140×950 全部一致）：列高 0.026×圖高、行距 0.130×圖高、
左欄名 x 0.070–0.328、右欄 0.434–0.828。
詳細量測同**識字嘅硬限制**睇 `docs/skill-screen.md`。

**名稱框抽取 + 影像比對（2026-09-18，見 `docs/skill-screen.md` §5）**：

- ✅ `nameBoxesInRow()` 由每列切出左右兩個名框 → **8 圖 × 7 列 × 2 欄 = 112 個全部抽得到**。
  ⚠️ 名框闊度係**跟隨該頁最長名**（左對齊、右邊留白）→ **唔可以假設框闊 = 名長**。
- ⚠️ **特徵一定要「絕對尺度」**（1 像素 = 1 格、上下居中，**480×40** 網格）。
  兩個做錯過嘅做法：① 拉伸到固定闊度 → 唔同名都有 **1.000** 相似度
  （「短名＋空白」被拉成同「長名」一樣）；② 去 tight box 後按自己高度縮放
  → 一樣撞 1.000（所有名框高度一樣 → 任何框都撐滿 24 格）。
- 實測（`node tools/diag-namematch.js`）：互相最佳配對 34 對、
  **中位數 0.986**、最差 0.727；唔同招撞分上限 **0.604** → **形狀夠分辨**（安全線 0.65）。
  但 **63/112 格「最佳同次佳」差距 ≤0.05**（8 張圖只覆蓋幾十招、每招得 2–7 個樣本）
  → **最大瓶頸係「唔唯一」，唔係比對本身**。
- ⚠️ **名框入面唔止有名**：左邊會有 `Lv5 ★★★` 徽章（實測徽章同名之間空 **111px**），
  而且**徽章唔一定喺右邊** → 舊做法「由右邊掃空洞」剔唔到。正解：切**墨跡段**
  （空隙 ≥ 10px），剔走「貼住框最左邊、闊 ≤ 0.22×框闊」嘅前綴段。
  ⚠️ 特徵網格要夠闊（**480**）：實測最闊框 **446px**，用 240／384 會剪走右邊嘅字。
- ⚠️ **唔可以承諾全自動讀名**：一定要有候選名單（見 §9）。
- ⚠️ `data/skill-name-labels.json`（我第一次人手標註）**已知有錯位**，
  唔要當真值用；要真值就用上面「唔需要真值」嘅檢定。

**技能名影像庫（`data/skill-name-lib/`）**：`node tools/build-skill-library.js`
由逐頁技能畫面建庫 —— 每頁 14 個名框 → 跨頁去重（相似度 ≥ 0.95 當同一招）
→ 實測 8 張真值圖 **112 個名框 → 79 個項目**。⭐ **去重可以自己驗證**：
uma1-p1 → uma1-p2 啱啱好併 **2** 行（＝兩頁重疊 2 行）、uma3 併 7、uma4 併 6，
冇併錯／漏併嘅迹象。⚠️ 門檻兩邊都貼（併入最低 **0.952**、未併最高 **0.949**）
→ 一定要人手覆核（`node tools/skill-lib-sheet.js --sort=merge`）。個名**未配**。

---

## 7. 開發環境（Windows，實測）

| 事項 | 實情 |
|---|---|
| Node | v24（**冇 Python、冇 .NET SDK**）|
| npm cache | 必須指入 workspace（`.npmrc` 已設），否則沙盒會擋 `%LOCALAPPDATA%` |
| Electron 下載 | 要同時設 `ELECTRON_CACHE` **同** `LOCALAPPDATA` 指入 workspace（`.cache-local/`）|
| **Smart App Control** | 必須**關閉**，否則 `electron.exe` 會被擋（`spawn UNKNOWN`／`An Application Control policy has blocked this file`）。呢個係機器政策，唔係程式問題 |
| 最終打包 | Electron → portable 單檔 exe，約 **200MB**（electron.exe 本身就 235MB）|

---

## 8. 改動後必做

1. `npm.cmd test`（或 `node --test --test-isolation=none test/*.test.js`）— **202 個測試必須全過**
   ⭐ **驗收閘一定要可以由乾淨 checkout 重現**：測試**唔准**依賴 repo 根嘅 runtime 檔
   （`hud-position.json` 唔入 git）或者其他未追蹤檔（`shots/skill-dump/`、`shots/live-debug/`、
   `.cache-local/` 之類）。驗法：`git archive HEAD` 抽出乾淨樹跑一次 → 要同工作樹一樣全過
   （實測 2026-09-19：修好之前乾淨樹 **179 pass／1 fail**（`hud-config.test.js` 要求 repo 根
   有 `hud-position.json`），修好之後兩邊都 **181／0**）。
   ⚠️ **唔准**用 `skip`／`if (!existsSync(...)) return;` 迴避 —— 咁樣只係把「驗唔到」
   變成「靜默通過」。要用嘅話就**自己控制環境**（例如 `os.tmpdir()` ＋ `process.chdir()`）。
   ⚠️ 涉及 cwd 嘅測試一定要**同步** ＋ `finally` 還原（`--test-isolation=none` 之下
   所有測試共用一個 process，`chdir` 係全域狀態）。
2. `node tools/fit-score.js` — 必須 `完全命中 4/4　總絕對誤差 0`
3. 如果改咗五維／技能／ランク相關嘅嘢，`node tools/breakdown.js` 逐招核對一次
4. **如果改咗影像相關嘅嘢**：
   - `node tools/build-glyph-templates.js --exclude=uma2 --verify` → **30/30（面板截圖）＋ 9/9（實機面板條）**
   - `node tools/read-stats.js shots/gt/uma1-p1.png --gt=data/ground-truth/01-小栗帽-星光躍動-UD3.json` → 5/5
   - 上唔到 30/30 就**唔好**寫模板檔（工具自己會擋，唔好繞過）
   - 動到墨點／色相／亮度門檻：`node tools/diag-hue.js --assert` 要通過
     ＋ `node tools/tune-detect.js --hue` 睇下有冇踩到安全邊界（見 §6.1）
   - 動到實機面板條（`statbar.js`／`capture.html`）：
     `node tools/diag-statbar.js --read` → **9/9**
     ＋ `node tools/replay-dumps.js` → **退步 0**（有 `shots/live-debug/` 幀嘅話）
4b. **如果改咗 `electron/*.html`（renderer inline script）或者 `electron/main.js`**：
   `node tools/check-renderer-syntax.js` → 全部 `✓`。
   ⚠️ 為何要（唔係多餘）：三個 HTML 係 classic script（`require('electron')` ＋ DOM）
   → **入唔到 `node --test`**，打錯一個字（少個括號、`await` 喺非 async）嘅後果係
   **renderer 一開頭 throw → 之後所有 IPC listener 都註冊唔到 → HUD／設定窗靜默唔郁**。
   呢個閘只驗語法（唔執行、唔需要 DOM／Electron），邏輯錯要靠 `test/*.test.js` 嗰類
   「由 HTML 抽嘢出嚟比對」嘅測試。
5. 更新 `docs/formula.md`（公式）或者 `docs/vision-design.md`（影像）
6. **`git commit`**（見 §0：每次改動都要 commit，驗收唔過唔准 commit）

> **唔准為咗「跑得快」而犧牲精度**。呢個專案嘅核心價值就係「顯示嘅數同遊戲一模一樣」，
> 而唔係「估得接近」。誤差 0 係花咗好多輪先達到，唔好退返去。

---

## 9. 已知待辦（交接）

> ⭐ **想搵嘢做就睇 §10「總 Backlog」**（A/B/C/D 四大類，標明使唔使開遊戲同大細）。
> 呢一節只列**最緊要**嘅幾條。

| 優先 | 事項 |
|---|---|
| ⏸️ **唔做** | **HUD 跟住遊戲視窗 ＋ 用家自己拖位**（用戶 2026-09-18 提出，明講「呢個係後話，你可以 mark 低咗先」）：<br>① **完全固定喺賽馬娘視窗**：而家 HUD 位置係用「前景顯示器工作區」推算（見 §6.4 已知限制），遊戲視窗一移 HUD 就唔跟。<br>　 ⚠️ 難點：`desktopCapturer` **只俾** id／標題／大細，**冇螢幕座標** → 要另找來源。<br>　 ✅ **已實測可行**（2026-09-18）：PowerShell + `Add-Type` 叫 Win32 `EnumWindows` + `GetWindowRect`，列舉全部可見視窗只用 **~365ms**（`powershell.exe -NoProfile -Command`，唔可以寫 `.ps1`，執行原則會擋）。實測讀到遊戲視窗係 **-34,141 1943×1123**。<br>　 ⚠️ 認遊戲視窗**唔可以用「比例 ≈ 16:9」**：實測同一部機有 4 個窗口都接近 16:9（遊戲、cmd、Windows 輸入體驗、Program Manager）→ 要用**標題**（`desktopCapturer` 嘅 source name 同 Win32 標題一樣）或者**大細**配對。<br>　 ⚠️ 沙盒注意：唔可以用 `spawn`／`execFileSync` **擷取子程序輸出**（具名管道 EPERM）→ 叫 PowerShell 自己寫落檔案再讀。<br>② **用家自己拖 HUD 定位置**：HUD 而家 `setIgnoreMouseEvents(true)`（穿透）→ 冇得拖。<br>　 ⚠️ 難點：一開返滑鼠事件就會擋住遊戲點擊。<br>　 ✅ 可行做法：**對位模式（`UMAPYOI_HUD_EDIT=1`）之下才**開滑鼠事件 + 顯示虛線框，拖完寫落 config 檔（`hud-position.json`），正常模式照穿透；或者用鍵盤微調（`Ctrl+Alt+方向鍵`）避免搶滑鼠。<br>　 ✅ **已做（見 §6.4「對位模式拖位」）**：對位模式之下開滑鼠事件 ＋ 藍虛線框 ＋ 直接拖；放手即反推並寫入 `hud-position.json`。正常模式**一定**穿透（funnel ＋ watchdog ＋ 500ms 再確認）。⚠️ 對位模式**要喺啟動時用環境變數決定**（renderer 喺 `focusable:false` 之下收唔到鍵盤，所以冇得中途切換）。<br>① ⏸️ **用戶 2026-09-19 決定唔做**：原話「既然用家都可以拖動個 hud 去擺喺自己想擺嘅位，咁呢個都冇存在嘅必要」—— ②（用家自己拖位）已經做好而且實機驗過（見 §10 A1），所以唔值得為咗「跟窗」引入 Win32 呼叫（`EnumWindows`／`GetWindowRect`）同額外嘅每幀成本。⚠️ **保留**下面嘅量測數據（如果將來情況變咗：要支援多螢幕／經常搬窗／想要全自動，先再考慮）。|
| ✅ **完成** | **HUD 收尾**：① 驗「HUD 有冇被自己擷取到」→ ✅ **2026-09-19 用戶實機驗過：dump 幀冇 HUD 自己嘅字**（`setContentProtection` 生效，安全關鍵通過）；② 設定面板**已做＋已實機驗**（A2） |
| ⏸️ **唔做** | ~~**確認 uma2 截圖同 JSON 邊個啱**（地雷 #19）~~ —— ⏸️ **用戶 2026-09-19 決定唔理**（原話：「呢個已經唔重要」）。⚠️ 但 `build-glyph-templates.js --exclude=uma2` 呢個閘**唔准拆**（30/30 驗收靠佢）|
| 中 | **模板覆蓋**：實機樣本仍然偏少（每個數字十幾個）。再收幾張實機圖（唔同培育進度／唔同馬／唔同主題色）可以令相似度同信心再升 |
| 中 | **其他畫面／其他狀態嘅面板條**：現時只驗證咗育成主畫面（畫面 A）。仲未試：ステータス面板、比賽前後、訓練動畫期間 |
| 中 | **實機效能**：5fps 之下嘅延遲、CPU、記憶體未正式量過（dump 機制本身只喺失敗時寫檔，唔影響）|
| ⏸️ 暫停 | **Phase 2（技能識別）—— 用戶 2026-09-19 指示：暫時唔處理呢一 part**。<br>**已完成（可以隨時接返，唔需要重做）**：<br>　 ① `skillscreen.js`：技能畫面欄／行／名框偵測（8 張真值圖全部 7 列 × 2 欄 = **112 個名框全部抽到**）；<br>　 ② `skillname.js`：名框影像特徵（**絕對尺度** 480×40、上下居中）＋ 比對；<br>　 ③ **可行性已量化**：互相最佳配對中位數 **0.986**、唔同招撞分上限 **0.604**（安全線 0.65）—— 即係「影像比對認名」呢條路行得通；<br>　 ④ `tools/build-skill-library.js`：逐頁建技能名影像庫 ＋ 跨頁去重（8 張真值圖 112 → 79 項；uma1-p1→p2 啱啱好併 2 行＝去重自己驗證到）；<br>　 ⑤ 連拍模式 `UMAPYOI_SKILL_DUMP=1`（1:1、逐頁存 PNG、同一頁自動略過、可再剪細）；<br>　 ⑥ **尺度問題已修**（用戶提醒「唔係固定解析度」）：所有像素門檻由「兩趟量返嚟嘅文字大細」推（×0.4 到 ×3 都係 7 列）。<br>**接返嘅第一步（未做）**：收一批「彈窗完整落喺框內」嘅實拍（見 `docs/skill-screen.md` §5.8.5）→ 跑 `tools/build-skill-library.js` → 人手覆核 `tools/skill-lib-sheet.js --sort=merge` → **配名**（清單順序 ↔ 技能庫條目嘅對應未確認，遊戲清單可能按稀有度／類型排）。<br>**未解決**：用戶 2 批實拍都用唔到（第 1 批：成個桌面、彈窗會伸縮；第 2 批：彈窗被框邊界切斷，左欄唔完整 → 117 頁只有 6 頁抽到 ≥10 名框）。|
| 低 | **舊 Phase 2 待辦（已細化為上面一條）**：技能 icon 識別 |

### 9.1 已知限制／技術債（**未修**；獨立審計 2026-09-19 發現 —— 唔准當已修）

1. **Electron frameless ＋ `resizable:false` 嘅 `getBounds()` 可能有偏差**
   （`electron#51679`／`#51876`，**未確認 44.4.1 修咗未**）→ 一定要**實機量**：
   `getBounds()` vs `getContentBounds()` vs 肉眼（對位模式已經 log `[HUD/位]` 三組數，
   `setBounds()` 之後唔一致會 warn）。⚠️ 因為 `setContentProtection(true)`，
   HUD **唔會出現喺任何截圖** → 位置**唔可以用截圖核對**，只可以靠 log ＋ 肉眼。
2. **`placeHud()` 既有單位 bug（未修）**：`Math.min(workArea.width /* DIP */,
   game.width /* 擷取幀物理像素 */)` 混用兩種單位 → 遊戲最大化時兩者啱啱好一樣所以無事，
   **遊戲視窗化 ＋ 150% 縮放**之下會攞物理像素當 DIP → HUD 擺錯位。
   修法要分清 DIP／物理像素（`screen.dipToScreenRect()` 一類）＋ 實機驗，唔可以純推理。
3. **金色格 `highlighted` 只係 row-level**（整條數值行嘅墨點色相 p90 ≥ 33°），**唔係逐格** →
   app 只講得出「有金格」，講唔出「係邊一格」。⚠️ 而 `src/vision/statbar.js` 自己嘅註釋
   反而寫「一定要逐格判斷…唔可以用整條面板條嘅平均」→ **兩者矛盾，係既有取捨（未修）**。
   升級要 `statbar.js` 額外回傳每格判斷（逐個數字格各自量色相 p90）。
4. **`pushHud()` 嘅 dedupe key 冇永久自動閘**：要驗「renderer 讀嘅欄位 ⊆ key」就要測
   `main.js`，但 `electron/main.js` **入唔到 `node --test`**（main process 要 Electron runtime）
   → 呢個不變式而家只靠註釋同人手記住。建議將來抽成 `src/hud/layout.js` 純函數
   （例如 `hudViewKey(view)`）＋ 加返個測試。
5. **`electron/main.js`／`hud.html` 零測試覆蓋**（IPC handler 嘅 try/catch、拖曳狀態機）——
   ⚠️ 呢條係**已知缺口**，唔係「已驗證」。
   ✅ **2026-09-19 部分收窄（唔係全修）**：① 設定窗表單 ↔ `config.js` 欄位一致性而家有閘
   （`test/hud-settings-html.test.js`，**真係由 HTML 抽** `DISPLAY_FIELDS`／`NUM_FIELDS`）；
   ② `envFlag()` 搬去 `src/hud/env-flag.js` ＋ 21 個值嘅測試（`test/hud-env-flag.test.js`）；
   ③ `applyHudConfig()` 嘅 display 防呆抽成純函數 `assertFullDisplay()`（有測試）。
   ⚠️ 剩返**真係零覆蓋**嘅：IPC handler 本體、拖曳狀態機、`placeHud()`／`pushHud()`。
   ✅ **2026-09-19 第二輪收窄（實機 bug 之後）**：④ 擷取來源挑選抽去
   `src/capture/source.js` ＋ `test/capture-source.test.js`（10 條，含「唔准揀到自己個窗」回歸）
   —— 但 `main.js` 嘅 `ownWindowIds()`（handle／標題收集）同 `warnIfSourceTooSmall()` 本身仍然零覆蓋；
   ⑤ 設定窗 slider 上下限抽成純函數 `fieldBounds()`（`test/hud-settings-html.test.js` 3 條，
   **真係由 HTML 抽出嚟執行**）—— 但「互動中唔搶控制」嗰段（`interacting`／watchdog／
   `describeClamp()`／`renderEffective()`，全部要 DOM）**仍然零覆蓋**，只可以手動驗。⑥ 拖位 ↔ 設定窗嘅同步線抽成**接線閘** `test/hud-config-sync.test.js`（由 `main.js`／`settings.html` **原始碼抽關鍵接線**斷言）—— ⚠️ 佢只擋「條線被拆走」，**唔算**功能已驗證：行為仍然要實機拖一次再撳「儲存」（見地雷 #29）。
6. **原子寫冇 `fsync`**（`saveHudConfigFile()` = 寫 `.tmp` ＋ `renameSync`）：停電／硬斷電
   可能留低半截 JSON。可接受嘅理由：`loadConfig()` 會**大聲 throw**，而且**唔會覆寫**壞檔
   （改用預設 ＋ 設定窗出紅色橫額）—— 但唔係「零風險」。
7. **同一類 truthiness 問題仲有 `UMAPYOI_SKILL_DUMP`（未修，唔喺今次範圍）**：
   `SKILL_DUMP = Boolean(process.env.UMAPYOI_SKILL_DUMP)` → `UMAPYOI_SKILL_DUMP=0`
   一樣會**開咗**連拍模式。要修就照 `envFlag()` 嗰套（`main.js`；函數而家喺
   `src/hud/env-flag.js`，改一行就得）。數字型旗標
   （`UMAPYOI_DUMP_FRAMES`／`_SKILL_MAX`）用 `Number(...)`，唔屬呢類。
   （`UMAPYOI_NO_HUD`／`UMAPYOI_NO_SETTINGS`／`UMAPYOI_HUD_EDIT` **已修** → `envFlag()`，
   見 §2。）
8. ✅ **已修（2026-09-19）—— 唔可以再當「技術債」**：`validateConfig()` 嘅不變式檢查
   （「`x[1]` 一定要等於 `x[0] + size.w`，唔係就 throw」）令 **AGENTS §2 列出嘅六行環境變數
   一齊用會 throw → `main.js` catch → `app.exit(1)` → 完全開唔到程式**（獨立審計實跑證實）。
   已改成「**`size` 為準**、`x[1]` 由推導得出；寫死嘅 `x[1]` 唔一致 → 大聲警告」，
   而**推導出嚟嘅範圍唔合法**（右邊界 > 1／`size <= 0`／`x[0] < 0`）照樣 throw
   → 原本要防嘅「HUD 靜默走出畫面」仍然捉得到。回歸測試：`test/hud-config.test.js`
   「⭐ 回歸：AGENTS §2 嗰六行環境變數一齊用**唔准 throw**」。詳見 §2／§6.4。


---

## 10. 總 Backlog（**未做**，純列出；用戶 2026-09-19 要求記錄）

> 呢份係「有咩可以做」嘅完整清單。**唔係承諾**，亦未動手。
> 分類：**A** 唔使開遊戲就做得到／**B** 要開遊戲配合／**C** 新功能／**D** 我提議嘅。
> 大細：細 ≈ 一兩個鐘內；中 ≈ 半日至一日；大 ≈ 幾日。

### A. 即刻做得（唔使開遊戲）

| # | 項目 | 內容 | 大細 |
|---|---|---|---|
| A1 | ~~**HUD 用家拖位**~~ ✅ **已做** | 對位模式下開滑鼠事件，拖完寫落 `hud-position.json`；正常模式照穿透（見 §6.4「對位模式拖位」）。✅ **2026-09-19 已實機驗** → 搵到兩個 bug（拖位 offset 飽和 ＋ 揀錯擷取來源令可拖範圍縮到半個螢幕），已修（見地雷 #27/#28；`7c80758`／`439ada7`）。✅ **2026-09-19 用戶實機確認「而家 hud 冇問題」**（拖位 → 設定窗跟住更新 → 儲存唔會彈返）。⚠️ 仍未驗：多螢幕／唔同 DPI 縮放 | 中 |
| A2 | ~~**HUD 設定面板**~~ ✅ **已做** | 獨立設定窗（`electron/settings.html`）：8 個數值 slider ＋ 7 個顯示選項，改動即時生效（見 §6.4「獨立設定窗」）。✅ **2026-09-19 已實機驗外觀同拖動** → 搵到死區／thumb 彈返／警告同現實唔對應，已修（見地雷 #28；`1781182`）。✅ **2026-09-19 用戶實機確認冇問題**。⚠️ 仍未驗：打字入數值嘅手感 | 中 |
| A3 | ~~**HUD 顯示選項**~~ ✅ **已做** | 7 個 `display` 開關（含金色格提示）。⚠️ 金色格嘅**真實粒度係一個整體 boolean**（`highlighted` 唔係逐格）→ HUD 只可以標「有金色格」 | 細 |
| A4 | ~~**`hud-position.json` 設定檔**~~ ✅ **已做** | 位置／大細／顯示選項寫入檔案（env > 檔案 > 預設；原子寫）。✅ **2026-09-19 已實機驗**（用戶個檔真係有寫入）—— ⚠️ 但驗到「存落去嘅 offset 可以令 HUD 完全走出畫面」（`dx=1`／`dy=−0.82`），所以加咗 `warnIfHudOffContent()` ＋ 拖位夾入內容區（見地雷 #28；`1781182`）。✅ **2026-09-19 用戶實機確認冇問題**（拖完自動寫檔）。⚠️ 仍未驗：重開之後讀返嘅一致度（要開遊戲） | 細 |
| A5 | **`npm start` 前置檢查** | 開唔到遊戲視窗／模板缺失／Smart App Control 擋咗 → 出清楚指引（見 §7 已知坑） | 細 |
| A6 | **日誌整理** | 分 `--verbose`／靜音；log 寫檔（方便用戶回報問題） | 細 |
| A7 | **測試覆蓋** | `evaluate.js` 邊界（1200／2000 上限、負分進化技能）、更多合成圖 | 中 |
| A8 | **清理舊碼** | `anchor.js`／`panel.js`（已棄用）＋ 相關舊測試，減低混亂 | 細 |
| A9 | **打包** | Electron → portable 單檔 exe（約 200MB，見 §7） | 中 |
| A10 | **`shots/` 大掃除 ＋ 說明** | 分類、寫清每個目錄係咩、邊啲要 commit（`shots/` 要 commit，見 §0） | 細 |

### B. 需要開遊戲配合

| # | 項目 | 內容 | 大細 |
|---|---|---|---|
| B1 | ~~**HUD 跟住遊戲視窗移動**~~ ⏸️ **唔做（用戶 2026-09-19 決定）** | 理由：「可以用拖位擺去自己想擺嘅位，跟窗冇必要」（見 §9 ①）。量測數據保留（將來要返先睇）：PowerShell ＋ Win32 `EnumWindows`／`GetWindowRect` **已實測可行**（~365ms、讀到 -34,141 1943×1123） | 中 |
| B2 | ~~**驗 HUD 防擷取**~~ ✅ **已做（2026-09-19 用戶實機驗）：dump 幀冇 HUD 自己嘅字 → 通過** | `UMAPYOI_DUMP_FRAMES=5 npm start` → `node tools/raw-to-png.js shots/live-debug` → 睇 dump 幀有冇 HUD 自己嘅字（見 §6.4）。⚠️ 驗法要留住（將來改 HUD 窗嘅 flag／`setContentProtection` 就要重驗） | 細 |
| B3 | ~~**確認 uma2 真值**~~ ⏸️ **唔做（用戶 2026-09-19 決定唔理）** | 截圖讀到 `1937/993/1077/848/1198` 但 JSON 係舊一輪（地雷 #19）。⚠️ 保留 `--exclude=uma2`（見地雷 #19） | 細 |
| B4 | **收多啲數字樣本** 🔄 **做緊** | ① ✅ 由**現有** `shots/live-debug/` dump 收咗 **4 個新狀態**（264／387／220／1133）→ 實機面板條樣本 9 → **13**；⚠️ **每一格都用眼核實**（唔可以信舊 dump 嘅 `stats`：舊 build 嘅 `ok` 有假陽性，例如 `27/27/25/25/25`）。<br>② ⏳ **要更多就要新實拍**（唔使改 code）：放一張**整個遊戲視窗**截圖（或者已剪 ROI）入 `shots/live/` ＋ 話我知五個數值 → 我用眼核實 → 入 `data/live-truth.json`（`shots` ＋ `perShot`）→ `node tools/build-glyph-templates.js --exclude=uma2`（驗證唔過**唔會**寫檔）。<br>③ 最弱兩格：數字「3」「8」樣本最少 | 中 |
| B5 | **其他畫面／狀態嘅面板條** 🔄 **做緊（閘已建）** | ① ✅ **搵到一個真 bug**：支援卡列表嘅 5 個 `Lv27` 徽章砌得出「5 個等距數字」→ 讀成 `27/27/25/25/25`（真值 700+）＝ **靜默報錯數** → 已修（兩條閘）＋ 入庫負樣本（見地雷 #30）。<br>② ✅ **負樣本閘**：`shots/negatives/`（資料夾就係宣告）—— `npm test`／`diag-statbar --read`／`build-glyph-templates --verify`／`replay-dumps` 四個閘都食。<br>③ ⏳ 未覆蓋：ステータス面板／比賽前後／訓練動畫／轉場 —— 有實拍就放入 `shots/negatives/`（唔准出數）或者 `shots/live/` ＋ 真值（要出數），即刻入閘 | 中 |
| B6 | **實機效能** | 5fps 下嘅延遲、CPU、記憶體（未正式量過） | 細 |

### C. 新功能（Phase 3 打後）

| # | 項目 | 內容 | 大細 |
|---|---|---|---|
| C1 | **what-if 模擬**（Phase 3 主菜） | 「加呢招會加幾多分／要幾多 Pt」—— 揀技能即時試算 | 中大 |
| C2 | **Pt／技能點畫面（畫面 C）** | 讀點技能畫面嘅 Pt 價格同「已獲得」 | 中 |
| C3 | **成長曲線** | 記錄每次五維變化 → 畫圖（HUD 歷史） | 中 |
| C4 | **訓練建議** | 邊個訓練加最多分（用 fans／屬性成長率） | 大 |
| C5 | **ランク目標** | 「仲差幾多分到 UG」 | 細 |
| C6 | **多語介面** | 繁中／日文／英文（技能庫已有簡體名欄位） | 中 |
| C7 | **事件選項助手**（Phase 4，已 mark 暫緩） | 認事件 → 建議揀邊個選項（見 `docs/vision-design.md` §5.5） | 大 |

### D. Agent 提議（未必必要）

| # | 項目 | 為何 | 大細 |
|---|---|---|---|
| D1 | **獨立「讀圖」CLI** | 唔開 Electron 就讀任何截圖 → 方便用戶交圖畀 agent 查 | 細 |
| D2 | **一鍵診斷包** | 收集環境／log／dump 幀 → 方便回報問題 | 細 |
| D3 | **HUD 主題／樣式** | 跟遊戲風格、半透明度、避免遮住重要 UI | 細 |
| D4 | **`AGENTS.md` 精簡** | 而家好長（地雷 26 條），可以做索引／分章 | 細 |
| D5 | **技能分「區間」顯示** | 技能讀唔到時除咗 `？／≥X`，加「已讀到 N 招」進度提示 | 細 |

### 建議次序（如果要揀）

1. **B2** 驗 HUD 防擷取（安全關鍵、最快）
2. **A1 ＋ A2 ＋ A4** HUD 拖位／設定面板／存檔（用戶明講想要；一半唔使開遊戲）
3. **B1** HUD 跟遊戲視窗（同 A1 一套做最順）
4. **C1** what-if 模擬（Phase 3 主菜）
