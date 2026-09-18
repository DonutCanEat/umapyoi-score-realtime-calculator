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
| Phase 1 | **五維數字辨識（零校準）** | ✅ 兩條路都通：**畫面 A 面板條**（`statbar.js`）**9/9 全中**（1356→2560 五個解析度 ＋ 4 個實機失敗／金色格回歸）；ステータス面板排法 **30/30**。✅ 已實機跑過（`npm start`，1920 窗），修好間歇性「讀唔清」（地雷 #25）同**金色格靜默讀錯**（地雷 #26）|
| Phase 1 | HUD overlay ＋ 設定面板 | 🚧 **HUD 可用**（透明置頂穿透；顯示評價点 + 五維逐格 + 技能分 `？／總分 ≥ X`；對位模式可即時調位）。⏳ 未做：跟住遊戲視窗移動、用家拖位、設定面板 |
| Phase 2 | 技能 icon 識別（自動知學咗邊啲技能）| 🚧 **兩步做好**：① 技能畫面欄／行偵測器（`skillscreen.js`，8 張實機圖全部搵到 7 行）；② **名稱框抽取**（112 個全部抽到）＋ **影像比對可行性已量化**（互相最佳配對中位數 0.981、撞分上限 0.439 —— 見 `docs/skill-screen.md` §5）。⏳ 未做：接上**候選名單**（見 §9）|
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
npm.cmd start             # 開 Electron（需要遊戲開住）＋ HUD overlay
npm.cmd test              # 單元測試（102 個，必須全過）

# HUD 相關開關（環境變數）
#   UMAPYOI_NO_HUD=1            唔開 HUD（淨係要 console log 嗰陣用）
#   UMAPYOI_HUD_EDIT=1          ⭐ 對位模式：HUD 顯示自己嘅範圍／偏移（唔使改 code 就調得）
#   UMAPYOI_HUD_X=0.01,0.20     HUD 左／右邊界（÷ 內容區闊度）
#   UMAPYOI_HUD_Y=0.70,0.95     HUD 上／下邊界
#   UMAPYOI_HUD_DX=-0.005       額外橫向偏移（同 _DY 一樣係相對值，可以負）
#   UMAPYOI_HUD_W=0.30 / _H=0.24  大細（唔俾就用預設 size）
#   UMAPYOI_DUMP_FRAMES=5       頭 5 幀每幀都 dump（⭐ 驗「HUD 有冇被自己擷取到」用）

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
node tools/diag-statbar.js --read          # ⭐ 自動對 `data/live-truth.json` 真值（應該 9/9）
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
```

**驗收標準**（全部都要）：
1. `npm.cmd test` 全過（現時 **102 個**）
2. `node tools/fit-score.js` 顯示 `可以計誤差 4/4　完全命中 4/4　總絕對誤差 0`
3. 動到影像嘅話：`node tools/build-glyph-templates.js --exclude=uma2 --verify`
   → **面板截圖 30/30**（雙閘：**實機面板條 9/9**），兩個都要中
4. 動到墨點／色相／亮度門檻嘅話：`node tools/diag-hue.js --assert` 要通過
5. 動到實機面板條（`statbar.js`／`capture.html`）嘅話：
   `node tools/diag-statbar.js --read` → **9/9**（自動對 `data/live-truth.json`）
   ＋ `node tools/replay-dumps.js` → **退步 0**（有 dump 幀嘅話）

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
  anchor.js       # ⚠️ 已棄用（靠粉紅色揾面板 → 見地雷 #10/#11），保留只為舊測試
  panel.js        # ⚠️ 同上（粉紅比例版），未接入主流程

src/cli.js        # 手動試算

src/hud/
  layout.js       # ⭐ HUD overlay 嘅**幾何 + 顯示狀態**（純函數，可 node --test）：
                  #    相對位置（左下角空白位）、內容框推算、三態（ok／stale／none）

electron/
  main.js         # 主程序：視窗列舉 → statbar.readStatBar()（cropped）／reader.readStats()
                  #    → evaluate() → console log ＋ **推落 HUD**（見 §6.4）
  capture.html    # 擷取 renderer：getUserMedia → **1:1 剪面板 ROI**（冇 ROI 就退回 640px 縮圖）
  hud.html        # HUD overlay renderer：透明無邊框，只畫主程序推落嚟嘅 view

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
  crop-png.js            # 剪一個區域出 PNG（--scale=N 放大，睇字形用）
  replay-dumps.js        # ⭐ 重播 `shots/live-debug/*.raw`（驗證「讀唔清」修正，見地雷 #25）
  raw-to-png.js          # dump 幀（.raw ＋ .json）轉 PNG，畀上面兩個工具讀
  diag-shots.js          # 列出所有截圖尺寸

data/
  skill-db-tw.json       # 1323 招技能（繁中）
  skill-overrides.json   # 主 DB 冇收錄嘅技能（繼承技）
  glyph-templates.json   # ⭐ 10 個數字字形模板（16×24，NCC 用）
  live-truth.json        # ⭐ 實機面板條真值（values ＋ 每張圖 perShot 例外；`roi-*` = 已剪 ROI）
  calc-page-tw.html      # bwiki 頁面 cache
  ground-truth/*.json    # 4 條培育完成紀錄（誤差 0 嘅證據）

shots/
  gt/*.png               # ステータス面板排法（30/30 嘅證據）
  live/live-*.png        # ⭐ 實機育成主畫面 1356→2560 五個解析度
  live/roi-regress-*.png # ⭐ **實機失敗幀**（已剪 ROI）—— 永久回歸案例（地雷 #25/#26）
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
| 19 | 假設 `shots/gt/uma2-*.png` 同 `02-西野花…UE2.json` 對應 | ⛔ **對唔應**。同一套模板喺 uma1/uma3/uma4 係 30/30 全中，但 uma2 兩張圖一致讀出 **1937/993/1077/848/1198**（相似度 0.78~0.99、次選分數明顯低 → 唔係讀錯），即五維分 24626、ランク UF1。JSON 嘅 note 自己寫「取代舊嘅 UE6 紀錄」，所以**截圖應該係舊一輪**。→ 建模板要 `--exclude=uma2`；長遠要補返對應嘅截圖或者更正 JSON |
| 20 | **以為可以用色相視窗剔走ランク徽章** | ⛔ **徽章色相同數字墨重疊**（實測 8 張圖：徽章 hue **17–44°**、數字墨 hue **25–26°**；uma4 徽章 17–27° 幾乎一樣）。金／銅徽章色相落喺窗口內，亮度（0.34–0.60）都低過 0.62 → **色相＋亮度都剔唔走**。真正剔走徽章嘅係**結構條件**（徽章坐喺主題色漸變底 → 窗口淺色比例唔夠），成品殘墨只有 16~84 粒。→ 唔好靠色相做徽章判準；任何「徽章色相」推論（例如當讀數防錯）要用**位置／形狀**，唔好用色相。閘：`node tools/diag-hue.js --assert` |
| 21 | 色相窗口「隨手調闊／調窄」當係無害微調 | ⛔ 色相窗口係**行偵測**嘅命脈，唔止係清潔度：實測色相／亮度**全開**（0–360°、唔限亮度）→ 偵測由 8/8 張跌到 **2/8 張**（暖色插畫淹沒）。反過來 `hueMin` 一過 25° 就 **0/8 張**（真數字墨就係 25–26°）。安全範圍：`hueMin` 0–25、`hueMax` 35–90、`lumMax` 0.50–0.70、`deltaMin` 0–60。→ 改之前跑 `node tools/tune-detect.js --hue` |
| 22 | ⭐ **以為「縮圖 640px 冇問題，只係未試」** | ⛔ 實測（`node tools/diag-scale.js`）：整條管線**只喺原生尺度行得通**（1.0 → 30/40 全對；0.9 → 25/40；0.8 → 20/40；0.6 → 0/40；**0.336 = 實機 640px → 偵測 0/8、讀中 0/40**）。死因**唔係**色相窗口（探針顯示細尺度仲收到 14–22% 墨），而係下游寫死嘅像素門檻假設字高 ≈17px：`scoreNumberRow()` `minHeight 8`、`minGap 3`、`groupsToNumbers()` 固定 10px、`buildInkMask()` `windowRadius 6`。而且調參救唔返（`--tune=0.336` 45 個組合全部 0/8）。→ 動擷取端之前一定跑 `diag-scale.js`；見 `docs/vision-design.md` §2.2.2。 ✅ **2026-09-18 已修**：唔再縮全畫面，改為 renderer **1:1 剪面板 ROI**（原生像素，~0.5MB/幀），`main.js` 用 `readStatBar({ whole: true })` |
| 23 | ⭐⭐ **以為「gt 30/30 = 實機行得通」** | ⛔ **最嚴重嘅一個**。gt 截圖係**另一種排法**（5 個同位數、闊度相近嘅 4 位數字一行，格距 110px、字高 17px）。實機**育成主畫面**每個屬性格係「**大數值（上面）＋ `/上限`（下面細字）**」→ 現行「揀 5 個闊度最相近嘅等距數字」判準**一定揀到『上限』欄**（上限全部 4 位、闊度一致；數值 2–3 位、闊度唔一致）。實測 5 個解析度（1356→2560）**5/5 都讀錯欄**：讀出 `1946/1600/1600/1500/1450`（＝上限）而真值係 `226/54/139/85/102`，信心仲有 0.55–0.70 → **靜默報錯數**。而且 band 會把「大數值行＋細上限行」**合併**，砌數字時混行 → 連上限都讀唔準。→ 實機要**先切行（大數值 / 細上限）再砌數字**，唔可以靠「闊度相近」呢個判準。 ✅ **2026-09-18 已修**：`src/vision/statbar.js`（相對 ROI → 切行 → 只按右邊界間距揀 5 個 → 信心閘），實機 5/5；另加 10 個合成測試（`test/statbar.test.js`）守住 |
| 24 | **假設遊戲 UI 係固定像素大細** | ⛔ 賽馬娘桌面版**冇固定解析度，只有固定 16:9**（用戶確認）。實測 5 個解析度：cell pitch ÷ 圖闊 = **0.0494–0.0498（恆定）**、面板列 normalized y = **0.691–0.703（恆定）** → **UI 完全等比縮放、面板相對位置穩定**。即係：① 唔可以用固定 `THUMB_WIDTH`（1280 窗同 4K 窗行為完全唔同）；② **相對 ROI 係可行而且穩定**（同地雷 #10 嘅「寫死色相」唔同：寫死**相對座標**喺固定比例之下係安全嘅）；③ 字高 ∝ 圖闊（實機量到：數值 ≈ 0.0098×闊、上限 ≈ 0.0064×闊）→ 要「正規化字高」而唔係「固定解析度」 |
| 25 | ⭐ **以為「相似度 0.55 門檻好安全」，同埋「數字框入面一定只有數字」** | ⛔ 實機（1920 窗）會出現「第 5 個數值讀唔清」，三個根因都係違反呢啲假設：① 數字**右邊多咗一舊 3×4 像素碎片**（格線／高亮邊緣，0.28 分）→ `readNumberTrimmed()` 由右邊貪心收，一撞到低分就**即刻停** → 成格報「?」，連左邊正確數字都讀唔到；② 真數字「8」最佳匹配**仍然係 8**，但得 **0.41** —— 實機數字係**漸變色**（上淺下深），墨點遮罩削走較淺嘅上半 → 相似度天然偏低；③ 其他畫面（選單／列表）嘅**細字**都會被當成面板條 → 報「讀唔清」（假警報）。**正解**：`dropNonDigits()`（同字數字元一定同高）＋ `minAccept` **0.40**（實測掃描：0.45 讀到 9 幀、0.40 讀到 10 幀、再低冇用，而且全部同已知值一致）＋ `expectedGlyphHeight()` 判斷（UI 等比 → 字高 ≈ 0.0098×圖闊，遠細過就判 **`notBar`**，log 同 dump 都分開處理）。⚠️ **試過但否決**：放寬 `lumMax` 0.62 → 0.85 想救返上半漸變色，實測**反而讀錯**（`727/108/…`、`727/188/…`）兼真值跌到 6/8。驗證工具：`tools/replay-dumps.js`（重播失敗幀，**唔可以只用成功圖驗證**）|
| 26 | ⭐⭐ **以為「所有狀態嘅數字都係橙棕色」，同埋「金色 → 唔出數就得」** | ⛔ **最危險嘅一類：靜默讀錯數**（用戶實機報 1489→**1483**、1613→**1513**）。屬性升咗之後遊戲把該格數字畫成**金色**：深金邊 ＋ **極淺金高光**（實測 `rgb(255,255,214)`、色相 60°、**亮度 0.98**）。⭐ **用戶 2026-09-18 確認嘅兩件事**：① **逐格獨立**（只有過 1200 嗰格金，其餘照舊橙棕 —— 實測 1489 金、543/655/624/628 橙棕）；② **一達到 1200 就即刻變金**（唔係等訓練完、唔係短暫高亮）→ 所以判準一定要**逐格**做。**先踩嘅第一個坑**：一度改成「偵測到金色就唔出數」，但既然係長期狀態，唔出數等於千二點之後**永遠冇數**，唔可行。**真正根因（唔止顏色窗口）**：墨點遮罩嘅「深色字喺淺色底上面」**結構條件**（窗口淺色比例 ≥ `lightFraction` 0.4）被淺金高光**推爆** → 反而削走筆劃（同一格墨量 137/176/188 → **119/89/137**）→「9」同「3」打和（0.54 vs 0.60）→ 靜默讀錯。⚠️ **試過但否決**：加「淺金窗口」（8 讀成 5）、單純放寬 `lumMax`（`727/108/…`）、全局放寬 `lightFraction`（dump 重播 FAIL 由 10 幀升到 20 幀）。**正解**：逐格量墨點**色相 p90**（正常幀 27–28°、金幀 37–44° → 門檻 **33**）→ **只喺確認係金色嘅格**用放寬嘅 `lightFraction` 0.3 重做遮罩（`goldLightFraction`）→ 實測 9 張真值圖由 8/9 變 **9/9**、3 個原本讀成 1483 嘅實機幀**讀返 1489**（信心 0.72）。`highlighted: true` 仍然照標（HUD 可以顯示「呢格屬性已過 1200」）。永久回歸：`shots/live/roi-regress-gold.png` ＋ `data/live-truth.json` 嘅 `expectHighlighted`（判準＝「要讀到真值 **而且** 要標 highlighted」）＋ 合成測試「逐格獨立混色」。⚠️ **唔好**把金色字形混入模板訓練（空心輪廓 vs 棕色實心，會拉歪平均值）|

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

⚠️ **唔啱位唔使改 code**：`UMAPYOI_HUD_EDIT=1 npm start` 開對位模式
（HUD 會顯示自己嘅 x／y 範圍、偏移、大細），或者直接用 `UMAPYOI_HUD_X`／`_Y`／`_DX`／`_DY`／`_W`／`_H`。

⚠️ **一定要 `setContentProtection(true)`**：我哋用 `desktopCapturer` 擷取自己個螢幕，
冇呢個設定 HUD **會入到自己嘅擷取畫面**（等於自己讀自己嘅字）。
驗法：`UMAPYOI_DUMP_FRAMES=5 npm start` → `node tools/raw-to-png.js shots/live-debug`
→ 睇 dump 出嚟嘅幀有冇 HUD 嘅字。

⚠️ 讀唔到嗰陣**保留上一個穩定值**（`stale` 態，變黃色提示），唔會閃走或者顯示空白 ——
「唔見面板條」係常態（47 幀 dump 入面 35 幀都係），閃走會令 HUD 冇用。
五維逐格都要一齊留住（唔止總分）。

⚠️ **技能分未讀到唔可以出 0**：一定係 `技能分 ？／總分 ≥ 五維分`。
呢個係本專案底線（見 §8）——估一個數比起唔顯示更差。

⚠️ **已知限制（用戶 2026-09-18 實機發現）**：遊戲視窗**移動**之後 HUD 唔會跟住 ——
因為我哋冇 Win32 API 讀遊戲視窗嘅螢幕座標（`desktopCapturer` 只俾 id／標題／大細），
而家用嘅係「前景顯示器工作區」做近似。**已完成嘅補救**：開 HUD 之後遊戲通常唔會再移，
而且可以用對位模式即時調；**未做**：見 §9 待辦「HUD 跟住遊戲視窗 + 用家自己拖位」。

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
- ⚠️ **特徵一定要「絕對尺度」**（1 像素 = 1 格、上下居中，240×40 網格）。
  兩個做錯過嘅做法：① 拉伸到固定闊度 → 唔同名都有 **1.000** 相似度
  （「短名＋空白」被拉成同「長名」一樣）；② 去 tight box 後按自己高度縮放
  → 一樣撞 1.000（所有名框高度一樣 → 任何框都撐滿 24 格）。
- 實測（`node tools/diag-namematch.js`）：互相最佳配對 35 對、
  **中位數 0.981**、最差 0.718；跨組撞分上限 **0.439** → **形狀夠分辨**。
  但同一招跨圖嘅保守下限可以低到 0.47，而且 **60/112 格「最佳同次佳」差距 ≤0.05**
  （只覆蓋幾十招、每招只得 2–7 個樣本）→ **最大瓶頸係「唔唯一」，唔係比對本身**。
- ⚠️ **唔可以承諾全自動讀名**：一定要有候選名單（見 §9）。
- ⚠️ `data/skill-name-labels.json`（我第一次人手標註）**已知有錯位**，
  唔要當真值用；要真值就用上面「唔需要真值」嘅檢定。

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

1. `npm.cmd test`（或 `node --test --test-isolation=none test/*.test.js`）— **102 個測試必須全過**
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
5. 更新 `docs/formula.md`（公式）或者 `docs/vision-design.md`（影像）
6. **`git commit`**（見 §0：每次改動都要 commit，驗收唔過唔准 commit）

> **唔准為咗「跑得快」而犧牲精度**。呢個專案嘅核心價值就係「顯示嘅數同遊戲一模一樣」，
> 而唔係「估得接近」。誤差 0 係花咗好多輪先達到，唔好退返去。

---

## 9. 已知待辦（交接）

| 優先 | 事項 |
|---|---|
| ⭐ 高 | **HUD 跟住遊戲視窗 ＋ 用家自己拖位**（用戶 2026-09-18 提出，明講「呢個係後話，你可以 mark 低咗先」）：<br>① **完全固定喺賽馬娘視窗**：而家 HUD 位置係用「前景顯示器工作區」推算（見 §6.4 已知限制），遊戲視窗一移 HUD 就唔跟。<br>　 ⚠️ 難點：`desktopCapturer` **只俾** id／標題／大細，**冇螢幕座標** → 要另找來源。<br>　 ✅ **已實測可行**（2026-09-18）：PowerShell + `Add-Type` 叫 Win32 `EnumWindows` + `GetWindowRect`，列舉全部可見視窗只用 **~365ms**（`powershell.exe -NoProfile -Command`，唔可以寫 `.ps1`，執行原則會擋）。實測讀到遊戲視窗係 **-34,141 1943×1123**。<br>　 ⚠️ 認遊戲視窗**唔可以用「比例 ≈ 16:9」**：實測同一部機有 4 個窗口都接近 16:9（遊戲、cmd、Windows 輸入體驗、Program Manager）→ 要用**標題**（`desktopCapturer` 嘅 source name 同 Win32 標題一樣）或者**大細**配對。<br>　 ⚠️ 沙盒注意：唔可以用 `spawn`／`execFileSync` **擷取子程序輸出**（具名管道 EPERM）→ 叫 PowerShell 自己寫落檔案再讀。<br>② **用家自己拖 HUD 定位置**：HUD 而家 `setIgnoreMouseEvents(true)`（穿透）→ 冇得拖。<br>　 ⚠️ 難點：一開返滑鼠事件就會擋住遊戲點擊。<br>　 ✅ 可行做法：**對位模式（`UMAPYOI_HUD_EDIT=1`）之下才**開滑鼠事件 + 顯示虛線框，拖完寫落 config 檔（`hud-position.json`），正常模式照穿透；或者用鍵盤微調（`Ctrl+Alt+方向鍵`）避免搶滑鼠。<br>（而家做得到嘅替代：`UMAPYOI_HUD_EDIT=1` ＋ `UMAPYOI_HUD_DX/_DY` 環境變數，見 §6.4）|
| ⭐ 高 | **HUD 收尾**：① 驗「HUD 有冇被自己擷取到」（`UMAPYOI_DUMP_FRAMES=5 npm start` → `node tools/raw-to-png.js shots/live-debug`）；② 再定要唔要**設定面板** |
| ⭐ 高 | **確認 uma2 截圖同 JSON 邊個啱**（地雷 #19）：要麼補返對應 1937/993/1077/848/1198 嘅截圖，要麼確認 JSON 值然後重拍截圖 |
| 中 | **模板覆蓋**：實機樣本仍然偏少（每個數字十幾個）。再收幾張實機圖（唔同培育進度／唔同馬／唔同主題色）可以令相似度同信心再升 |
| 中 | **其他畫面／其他狀態嘅面板條**：現時只驗證咗育成主畫面（畫面 A）。仲未試：ステータス面板、比賽前後、訓練動畫期間 |
| 中 | **實機效能**：5fps 之下嘅延遲、CPU、記憶體未正式量過（dump 機制本身只喺失敗時寫檔，唔影響）|
| 中 | **Phase 2 下一步：接「候選名單」**（`skillscreen.js` 已做到：7 行／左右兩欄 → **112 個名框全部抽到**；影像比對已量到可行 —— 互相最佳配對中位數 **0.981**、撞分上限 **0.439**，見 `docs/skill-screen.md` §5）：<br>⏳ **卡喺一個問題：候選名單邊度嚟？** 冇遊戲字型檔、冇 1300 招標註樣本 → 唔可以通用 OCR；可行路線係「用影像比對**已知**名單」。三個可能來源：<br>　 ① **用家自己提供**（貼佢學咗嗰 20–40 招名 → 由技能庫拎名，但**冇名嘅影像**，所以仲要一次性建「名 → 影像」模板庫：開一頁技能畫面 dump 一次就夠）；<br>　 ② **由技能庫按適性篩**（例如只考慮草地／中距離 → 候選由 1323 跌到幾十）；<br>　 ③ **先做「唔靠名」嘅近似**：淨係靠**技能列數 + icon 顏色**估技能分範圍。<br>⚠️ 另一個已量到嘅難點：**一半格「最佳同次佳」差距 ≤0.05**（8 張圖只覆蓋幾十招、每招得 2–7 個樣本）→ 樣本一少就唔唯一，所以建模板庫嗰步唔可以慳。<br>⚠️ 用戶未拍板之前**唔好**開工做「全自動讀名」。|
| 低 | **舊 Phase 2 待辦（已細化為上面一條）**：技能 icon 識別 |
