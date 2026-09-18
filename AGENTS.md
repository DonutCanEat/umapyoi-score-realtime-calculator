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
| Phase 1 | **五維數字辨識（零校準，圖上直接讀）** | ✅ **3 條紀錄 30/30 格完全命中** |
| Phase 1 | HUD overlay ＋ 設定面板 | ⏳ 下一步 |
| Phase 2 | 技能 icon 識別（自動知學咗邊啲技能）| 未開始 |
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

---

## 2. 指令

> ⚠️ 呢部機嘅 PowerShell 執行原則擋咗 `npm.ps1`（`因為這個系統上已停用指令碼執行`）。
> 喺 pwsh 入面要跑 **`npm.cmd`**，或者直接用 `node`：
> `node --test --test-isolation=none test/*.test.js`

```bash
npm.cmd start             # 開 Electron（需要遊戲開住）
npm.cmd test              # 單元測試（69 個，必須全過）

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
node tools/build-glyph-templates.js        # 由 ground truth 建字形模板（**有驗證閘**）
node tools/build-glyph-templates.js --verify
node tools/tune-detect.js --quick          # 參數掃描（用真值做評分）
node tools/tune-detect.js --hue            # ⭐ 色相窗口／亮度門檻單軸掃描（量安全邊界）
node tools/diag-hue.js                     # ⭐ 量數字墨／ランク徽章真實色相分佈
node tools/diag-hue.js --assert            # ⭐ 色相回歸閘（數字墨要全喺窗口內、徽章唔可以整塊入遮罩）
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
```

**驗收標準**（全部都要）：
1. `npm.cmd test` 全過（現時 **69 個**）
2. `node tools/fit-score.js` 顯示 `可以計誤差 4/4　完全命中 4/4　總絕對誤差 0`
3. 動到影像嘅話：`node tools/build-glyph-templates.js --exclude=uma2 --verify` 要 **30/30**
4. 動到墨點／色相／亮度門檻嘅話：`node tools/diag-hue.js --assert` 要通過

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
  glyphs.js       # 切字元 → 尺度歸一化 → 模板比對（NCC）＋ 由右邊貪心收剔徽章
  reader.js       # ⭐ 影像 → 五維 → 評價分；幀間多數投票（StatTracker）
  png.js          # 零依賴 PNG 解碼器（讀實機截圖用）
  anchor.js       # ⚠️ 已棄用（靠粉紅色揾面板 → 見地雷 #10/#11），保留只為舊測試
  panel.js        # ⚠️ 同上（粉紅比例版），未接入主流程

src/cli.js        # 手動試算

electron/
  main.js         # 主程序：視窗列舉 → reader.readStats() → evaluate() → IPC
  capture.html    # 擷取 renderer：getUserMedia → 縮圖 → 傳 raw pixels

tools/
  fetch-skill-db.js      # bwiki 技能庫抓取
  fill-ground-truth.js   # 技能名 → base／條件／適性；override 機制
  fit-score.js           # 對答案報表
  breakdown.js           # 逐招明細表
  read-stats.js          # ⭐ 截圖 → 五維（可 --gt 對答案、--trace 睇字元分數）
  build-glyph-templates.js  # ⭐ 建字形模板（有「驗證唔過就唔寫檔」嘅閘）
  tune-detect.js         # 參數掃描（用 ground truth 做客觀評分；--hue = 色相窗口單軸掃描）
  diag-row.js            # ⭐ 純文字環境睇圖（--gray/--map/--lines/--profile/--templates）
  diag-hue.js            # ⭐ 量數字墨／徽章色相分佈（--assert = 色相回歸閘）
  diag-scale.js          # ⭐ 縮圖尺度診斷（--scale／--tune／--probe；見地雷 #22）
  diag-shots.js          # 列出所有截圖尺寸

data/
  skill-db-tw.json       # 1323 招技能（繁中）
  skill-overrides.json   # 主 DB 冇收錄嘅技能（繼承技）
  glyph-templates.json   # ⭐ 10 個數字字形模板（16×24，NCC 用）
  calc-page-tw.html      # bwiki 頁面 cache
  ground-truth/*.json    # 4 條培育完成紀錄（誤差 0 嘅證據）

docs/
  formula.md             # 公式推導、驗證、來源
  vision-design.md       # 影像辨識設計（座標模型、畫面清單、邊界情況）
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
| 22 | ⭐ **以為「縮圖 640px 冇問題，只係未試」** | ⛔ 實測（`node tools/diag-scale.js`）：整條管線**只喺原生尺度行得通**（1.0 → 30/40 全對；0.9 → 25/40；0.8 → 20/40；0.6 → 0/40；**0.336 = 實機 640px → 偵測 0/8、讀中 0/40**）。死因**唔係**色相窗口（探針顯示細尺度仲收到 14–22% 墨），而係下游寫死嘅像素門檻假設字高 ≈17px：`scoreNumberRow()` `minHeight 8`、`minGap 3`、`groupsToNumbers()` 固定 10px、`buildInkMask()` `windowRadius 6`。而且調參救唔返（`--tune=0.336` 45 個組合全部 0/8）。→ 動擷取端之前一定跑 `diag-scale.js`；見 `docs/vision-design.md` §2.2.2 |

---

## 6. 影像辨識設計原則

### 6.1 零校準（**唔准加手動框選**）

> 用戶明確要求：**即時偵測**，唔係「開程式 → 拉框 → 確認」。

**現行做法（2026-09 起）：完全唔靠面板顏色、唔靠預先量度 ROI，直接喺圖上捉「五個數字」。**

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
所以 renderer 只做「擷取 → 縮圖（640px, 5fps）→ 傳 raw RGBA」，
錨點偵測同之後嘅數字辨識全部喺 `electron/main.js`（Node）度跑。

好處：**可以用 `node --test` 直接測試**，唔需要開 Electron。

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

1. `npm.cmd test`（或 `node --test --test-isolation=none test/*.test.js`）— **69 個測試必須全過**
2. `node tools/fit-score.js` — 必須 `完全命中 4/4　總絕對誤差 0`
3. 如果改咗五維／技能／ランク相關嘅嘢，`node tools/breakdown.js` 逐招核對一次
4. **如果改咗影像相關嘅嘢**：
   - `node tools/build-glyph-templates.js --exclude=uma2 --verify` → 必須 **30/30**
   - `node tools/read-stats.js shots/gt/uma1-p1.png --gt=data/ground-truth/01-小栗帽-星光躍動-UD3.json` → 5/5
   - 上唔到 30/30 就**唔好**寫模板檔（工具自己會擋，唔好繞過）
   - 動到墨點／色相／亮度門檻：`node tools/diag-hue.js --assert` 要通過
     ＋ `node tools/tune-detect.js --hue` 睇下有冇踩到安全邊界（見 §6.1）
5. 更新 `docs/formula.md`（公式）或者 `docs/vision-design.md`（影像）
6. **`git commit`**（見 §0：每次改動都要 commit，驗收唔過唔准 commit）

> **唔准為咗「跑得快」而犧牲精度**。呢個專案嘅核心價值就係「顯示嘅數同遊戲一模一樣」，
> 而唔係「估得接近」。誤差 0 係花咗好多輪先達到，唔好退返去。

---

## 9. 已知待辦（交接）

| 優先 | 事項 |
|---|---|
| ⭐ 高 | **HUD overlay ＋ 設定面板**：`reader.readStats()` 已經讀到五維並算好評價分，但仲只係 `console.log`。下一步要開透明置頂穿透視窗顯示，技能未讀到就老實顯示 `技能分 ？／總分 ≥ X` |
| ⭐ 高 | **確認 uma2 截圖同 JSON 邊個啱**（地雷 #19）：要麼補返對應 1937/993/1077/848/1198 嘅截圖，要麼確認 JSON 值然後重拍截圖 |
| 中 | **模板覆蓋**：現時 10 個數字齊全，但每個數字樣本少（1–4 個）。再收幾張實機圖可以令信心由 0.78 升上去（uma2 最後一個位「5 vs 8」就差 0.03）|
| ⭐ 高 | **擷取尺度（新發現，地雷 #22）**：`capture.html` 縮到 640px → 數字得 5.7px 高 → 實測偵測 **0/8**。要揀：(a) 提高 `THUMB_WIDTH` 到 1600＋／唔縮（原生 30/40 全對，代價 IPC 頻寬）；(b) 做尺度自適應門檻（`windowRadius`／`minHeight`／分組門檻隨字高縮放，但細尺度字形資訊已流失，要重新校準）|
| 中 | **實機測試**：所有驗證都係用 `shots/` 嘅截圖做，未試過 `npm.cmd start` 嘅實時管線。⚠️ 前提係先解決上面「擷取尺度」（`node tools/diag-scale.js`）|
| 低 | Phase 2：技能 icon 識別（由截圖自動知學咗邊啲技能）|
