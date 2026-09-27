# 設計審查報告（全專案）——2026-09-28

> **審查對象**：`Umapyoi Score Realtime Calculator` 工作樹，基準 HEAD = `1e5a4b6`（工作樹乾淨，只有一個未追蹤 cache `data/bwiki-skill-pages.json`）。
> **審查範圍**：`electron/**`（4 JS ＋ 4 HTML）、`src/**`（47 JS）、`tools/**`（54 JS）、`test/**`（53 檔 529 條）、`data/skill-db-tw.json` schema、`.github/workflows/release.yml`、根目錄文件／設定。
> **方法**：4 個獨立子審（electron／hud+capture／vision／umascore+tools+test）＋ 主審自己實跑；**每一條結論都要有 `檔案:行號` 或實跑輸出做證據**；每條都做過**反證**（先假設成立，再盡力搵推翻佢嘅證據），推翻得成就唔寫入（見 §4）。
> ⚠️ 本報告**只陳述定位結果同影響**，唔包含修改步驟（依診斷流程約束）；最後一節只列「如果將來要修，有咩極難發現嘅連帶風險」。

---

## 0. 審查結果一句話

**設計上係「有問題，但唔係爛」**：核心計分邏輯乾淨（`src/umascore` 18 檔零 I/O、真值 5/5 誤差 0）、純函數層測試覆蓋好（437／529 條）；但**三個真·嚴重問題**（適性認唔到靜默 ×1.0、信心閘係死碼、生產路徑冇數值範圍閘）＋**一個結構問題**（2231 行上帝模組）＋**一個驗收制度問題**（最硬嘅閘唔喺 CI、普通 commit 零自動驗證）。

---

## 1. 現況證據（我自己實跑，唔係引用文件）

| 閘 / 檢查 | 指令 | 結果 |
|---|---|---|
| 單元測試 | `npm.cmd test` / `node --test --test-isolation=none test/*.test.js` | **529 pass / 0 fail**，exit 0 |
| 乾淨 checkout 重現 | `git archive HEAD` → 抽出 → 跑同一句 | **529 / 0**（連 5 個 CJK 檔名 ground-truth 抽唔到都照過）|
| 語法閘 | `node tools/check-renderer-syntax.js` | ✓ electron 4／src 47／tools 54，exit 0 |
| 計分真值 | `node tools/fit-score.js` | 5/5、總絕對誤差 0；⭐ **自報「段覆蓋率 15/40」** |
| 實機面板條 | `node tools/diag-statbar.js --read` | 完全命中 **15/15** ＋ 負樣本 **5/5 唔出數**，exit 0 |
| 培育結束確認 | `node tools/read-result.js --all` | 正面全中 ＋ 負樣本 5/5，exit 0 |
| 五維（gt 圖） | `node tools/read-stats.js shots/gt/uma1-p1.png --gt=…UD3.json` | 5/5，exit 0 |
| 實機 dump 重播 | `node tools/replay-dumps.js`（973 幀） | 修好 9／修正假陽性 3／**退步 0**，exit 0 |
| 真 Electron 閘 | `node_modules\.bin\electron.cmd tools\verify-renderer-load.js` | ⛔ **跑唔到**（見 §3 M11） |

測試成分（我自己逐檔數 `^test(`，合計 529 = `node --test` 報嘅數）：

| 類別 | 檔數 | 測試數 |
|---|---|---|
| 純函數／邏輯 | 44 | **437**（83%）|
| 真圖／真資料 | 2 | 37 |
| 接線／原始碼原文閘（`readFileSync`＋regex＋`stripComments`）| 9 | **55**（10%）|

---

## 2. 已定位嘅問題

### 【嚴重】S1 · 適性條件認唔到 → **靜默當「通用」×1.0**（211／1589 招，13.3%）

- **位置**：`src/umascore/aptitude.js:31-34`（詞表只有 9 個關鍵字 ＋ 一條別名 `大逃→領頭`）／`:79-98`（`aptitudesFor()` 零命中就回 `[]`）／`src/umascore/skills.js:55-70`（`[]` → 乘 1.0，**無 throw、無 warning**）。
- **證據（我自己寫 probe 重數）**：`data/skill-db-tw.json` 1589 條之中，**402 條明確「通用」**、**89 條係場地**（`沙地`73／`泥地`12／`草地`4 —— 依設計唔應該乘，**冇問題**）、**211 條有距離／腳質條件但零命中**。零命中嘅字串全部係**簡體／日文寫法**，而且同庫內繁中寫法**並存**：`中距离`14、`先行`35、`差行`17、`短距离`12、`英里`8、`逃马`7、`追马`4、`差马`1…（我另外驗到庫內同時有 `中距離` 同 `中距离`）。
- **實機可見症狀（我實跑）**：`node tools/whatif.js --stats=1200,600,600,600,600 --skill=替え玉一丁、承ります♪ --grades=距離:S`
  → 同一段輸出**自相矛盾**：`條件 中距离` ＋ `適性 通用（冇適性條件）→ ×1.0　倍率 ×1.00　→ 加 +633 分`（正解應該 ×1.1 ＝ 696，少 63 分）。
- **影響範圍**：`src/umascore/whatif.js`（C1 窗 ＋ CLI）、`src/umascore/advice.js`（C4 升級建議）、`tools/fill-ground-truth.js:123`（**產生 ground truth 嘅工具** —— 會為呢啲招寫 `aptitudes: []`）。⚠️ 實時五維分**唔受影響**（實時計分只讀五維，技能分未接 UI）。
- **為何閘捉唔到**：`tools/verify-skill-bases.js` 只核 `base`／`skillPt`；`fit-score 5/5` 嗰 5 條樣本冇呢批招；`bwiki-coverage` 只按名對帳。
- **反證**：試過「×1.0 係刻意設計」→ 推翻：`aptitude.js:18` 明文寫「通用（冇條件）技能 = ×1.0」，而呢 211 條**有條件**；試過「資料本身就係咁」→ 推翻：同一庫內兩種寫法並存，行為唔一致。

### 【嚴重】S2 · `statbar` 嘅「信心閘」係**死碼**（文件講嘅「三種唔出數」實際只有兩種）

- **位置**：`src/vision/statbar.js:530` `if (o.minConfidence !== undefined && …)`；但 `DEFAULT_STATBAR_OPTIONS`（`:60-145`）**完全冇 `minConfidence`**，而生產呼叫點 `electron/main.js:1803-1805` 只傳 `{ whole: true }`。
- **證據**：`readNumberBoxes`／`readNumberTrimmed` 嘅信心 ＝ 已收錄字元分數嘅 **min**（`src/vision/glyphs.js:205-214`），逐個字元要 ≥ `minAccept` 才收；`DEFAULT_STATBAR_OPTIONS.minAccept = 0.40`（`statbar.js:79`）→ **信心數學下界就係 0.40**，任何合理嘅 `minConfidence` 都唔會 fire。
- **旁證**：唯一令呢個閘「復活」嘅係測試自己傳 `0.999`（`test/statbar.test.js:242-245`）；診斷工具傳 `minConfidence: 0`（`tools/diag-statbar.js:175`）。`AGENTS.md` §6／docs 講嘅「唔出數只有三種：notBar／真失敗／信心不足」→ **第三種喺面板條路徑唔存在**。（對照：`resultpanel.js:96` **有** `minConfidence: 0.5`，所以培育結束確認條路係有閘嘅。）
- **反證**：試過「可能其他呼叫點會傳」→ 全庫 `readStatBar(` 13 個呼叫點逐個睇，生產只有 `main.js:1804` 一個，冇傳。

### 【嚴重】S3 · 兩條**生產** reader 都冇數值範圍閘（可以靜默出 `9999`）

- **位置**：`src/vision/statbar.js:529` `const stats = texts.map(Number);`（之後直接 return）、`src/vision/resultpanel.js:268` 同樣；**只有** `src/vision/reader.js:15-17,64-69` 有 `MIN_STAT 0／MAX_STAT 2600`。
- **證據**：`readNumberTrimmed` 嘅 `maxDigits = 4`（`glyphs.js:195`）→ 純技術上可以讀出 4 位數如 `9999`；而生產路徑（`cropped=true`）**一定**走 `readStatBar`／`readResultPanel`（`main.js:1803`、`:1912`），唔會經 `reader.js` 嗰個範圍檢查。
- **影響**：靜默出一個唔可能嘅屬性值 → 總分／ランク／升級差距一齊錯。目前靠「字元要 ≥0.40 相似度」＋`StatTracker` 多數投票（`reader.js:80-129`）遮住，冇獨立範圍閘。
- **反證**：試過「`StatTracker` 有單調性檢查可以擋」→ 部分成立（下跌多數當讀錯），但**上升方向嘅誤讀**（例如 1689→9989）唔會被擋，反而當成「升屬性」接受。

### 【嚴重】S4 · `electron/main.js` 係上帝模組（2231 行；45 個可變全域；17 條 IPC handler）

- **實測**：2231 行／78.3 KB；46 個 top-level `function`；45 個 module-level `let`；122 個 `console.*`；混住至少 19 個可清楚劃出嘅關注點（寫入根目錄 77-97／log 檔＋patch console 109-127／模板載入 142-151／狀態 166-262／計分 274-322／HUD 窗 328-428／watchdog 430-474／設定檔 491-711／穿透＋拖曳 713-853／`placeHud` 900-932／窗建立 933-1029／`pushHud` 1030-1095／dump 政策 1096-1264／擷取控制 1265-1300／診斷快照 1311-1446／來源揀選 1487-1570／`whenReady` 1571-1642／hot path 1760-1890／result 條 1909-1961）。
- **結構性後果**：`main.js` **由構造上 import 唔到**（top-level `import 'electron'`、`:127` import 期間就 `initLogFile()` 改寫全域 `console`、16 條 handler 喺 module scope 註冊）→ 所有驗證退化成「掃原始碼文字」，而**原始碼反過來要為閘維持特定寫法**：`main.js:294-296` 明文寫「參數名一定要叫 `score`／`stats`／`at`」＋「呢一句唔准照抄落註釋」。
- **代價已經量到**：`docs/known-issues.md:55-67` 自認 `main.js` 零測試覆蓋；去重 M3 簇要改 3 條閘；H1／M8 兩簇都係呢個成因。
- **反證**：試過「其實已經抽走」→ 只抽走一部分（`panel-window.js` 72 行、`web-preferences.js` 39 行、`source.js`、`layout.js`、`config.js`、`stamp.js`、`util.js`），主體仍然一個檔 → 推翻唔到。

### 【嚴重】S5 · 最硬嘅驗收閘**唔喺 CI**；而且普通 commit 零自動驗證

- **證據**：`.github/workflows/` 只有 `release.yml` 一個 workflow，`on: push: tags: ['v*']`（`:12-14`）→ 推 `main` **完全冇 CI**。Release 先跑 3 個閘：`npm test`／`node tools/check-renderer-syntax.js`／`node tools/fit-score.js`（`:47-55`）。
- **`AGENTS.md` §8 要求嘅影像閘（30/30、15/15、負樣本 5/5、`read-result --all`）一條都冇入 CI**，但我實測佢哋**純 Node、唔需要 Electron、< 1 秒**：`diag-statbar --read` **0.5s**、`read-result --all` **0.3s**（語法閘 2.9s 做對照）。
- **時序風險**：7 簇去重重構（M1–M8）全部落 `main` 而冇 CI 驗證，靠人手跑 §8；而需要真 Electron 嘅閘（實載閘／HUD／穿透）喺 agent shell 跑唔到（§3 M11）、`replay-dumps` 靠唔入 git 嘅 dump（`shots/live-debug/`，973 幀）。
- **反證**：去 `docs/github.md` 搵「刻意唔跑」嘅理由 → **冇**；亦冇依賴／時間／成本上嘅阻礙。

### 【中等】M1 · `highlighted` 一個欄位混住兩種語意 → 診斷分類錯、唔 dump 幀

- **位置**：`src/vision/statbar.js:521-527`（**失敗**返回都帶 `highlighted: Boolean(highlighted)`）vs `:539`（成功返回同一個欄位）。
- **誤用**：`electron/main.js:1812` 用 `read.highlighted ? 'skip（金色格跳過）' : 'fail（讀唔清）'` 分類、`:1824` 沉默時間 5s→10s、`:1834` 只有 else 分支才 `dumpFrame()`。
- **影響**：一行真失敗（hue p90 ≥ 33° 嘅金行）會被寫成「金色格跳過」，**唔 dump 幀**、log 更靜 → 正好係最需要證據嗰陣冇證據。
- **反證**：試過「金色格係長期狀態，唔應該出現失敗」→ `main.js:1819-1823` 自己都寫「如果真係出現，通常係格框切得唔準」，即係承認會出現 → 唔推翻。

### 【中等】M2 · 環境變數**兩個入口、政策相反**，空白值會靜默或者令程式開唔到

- **實測（我自己跑 module）**：
  - `UMAPYOI_HUD_X=" "` → **throw**（`要係「a,b」兩個數字`）→ `main.js` catch → `app.exit(1)` → **完全開唔到程式**
  - `UMAPYOI_HUD_W=" "`／`_H=" "`／`_DX=" "` → **靜默用預設，警告 0 條**（`resolveHudConfig` 同 `layoutFromEnv` 兩邊都 0）
  - `UMAPYOI_HUD_W="0x10"` → `resolveHudConfig` 當 16 → **throw**（`要大過 0 而且唔超過 1`），但 `test/hud-env-flag.test.js:244` 明文認可 `'0x10'` = 16 合法
- **位置**：`src/hud/layout.js:297-313`（`layoutFromEnv`，throw）vs `src/hud/env-flag.js`（warn + fallback 契約），另加第 5 個入口 `main.js:1162`（`UMAPYOI_DUMP_CROP` 直接讀 `process.env`＋module 頂層 `throw`）。
- **反證**：試過「X 有 throw 係刻意（範圍一定要兩個數字）」→ 成立；但**同一組**旗標（`_W`／`_H`／`_DX`）同樣係「唔認識嘅值」卻零警告，同 `AGENTS.md` §2「唔認識嘅值唔准靜默」矛盾 → 無法同時成立。

### 【中等】M3 · `warnIfSourceTooSmall()` 單位混用（物理像素 vs DIP）

- **位置**：`electron/main.js:1555-1558`：`width`／`height` 係**擷取幀嘅物理像素**，`screen.getPrimaryDisplay().workArea` 係 **DIP**，直接乘 0.6 比較。
- **影響**：高 DPI（125%／150%／200%）之下門檻相對變闊 → 「揀錯來源」呢道**唯一可見防線**系統性唔出聲（最壞情況：揀到一個細窗而完全冇警告）。
- **旁證**：**同一個 bug 類別**喺 `placeHud()` 已經修好（`src/hud/layout.js` `gameWindowRect()`，`docs/known-issues.md:30-38`），呢條路徑冇跟。100% 縮放之下行為不變。
- **反證**：試過「capture 報嘅可能已經係 DIP」→ 推翻：`capture.html` 用 `video.videoWidth`（原生像素）＋ `fullWidth/fullHeight` 直接傳，`main.js:1786-1787` 亦當佢係遊戲視窗實際大細。

### 【中等】M4 · 診斷快照對「培育結束確認」條路**完全盲**

- **證據**：`lastResultSummary`（`main.js:1905` 宣告、`:1913` 賦值）**冇任何讀者**（全庫只有呢兩處）；result 幀喺 `:1768-1771` 就 `return`，**唔會**寫入 `lastFrame`；`writeDiagnosticSnapshot()` 亦冇任何 result 相關分支／`dumpFrame()`。
- **影響**：呢條路讀錯數嗰陣，用戶撳「寫入診斷 log」攞到嘅現場同佢無關 → 唯一嘅現場證據消失（同 A6「打包版出事之後乜痕跡都冇」同一類問題，只係換咗條路徑）。
- **反證**：冇（grep 只有 2 處、冇條件分支）。

### 【中等】M5 · 文件嘅數字／清單冇閘 → `README.md` **第二次**漂移

- **實測對照**（`README.md` vs 實況）：
  | 位置 | README 寫 | 實際 |
  |---|---|---|
  | `:18`／`:143`／`:196` | 測試 **363** 個 | **529** |
  | `:35`／`:197` | 技能庫 **1323** 招 | **1589** |
  | `:195` | tools **34** 個 CLI | **52** |
  | `:215` | 地雷 **32** 條 | **33** |
  | `:41` | Phase 2「⏸️ 暫停中」 | 2026-09-27：「⛔ 實測唔夠安全、唔准接 UI」|
- **時序證據**：`324b8a4`（2026-09-24）commit message 就係「docs: 重寫 README（**之前嚴重過時，全部數字同實況對唔上**）」→ **3 日後又漂**。
- **`docs/file-map.md`**（自稱「完整版」、`AGENTS.md` §3 叫佢「逐檔完整說明」）：我逐檔核對，**13 個 `src/` 檔 ＋ 21 個 `tools/` 檔完全冇提**（`grep content-box|nameseg|skill-db-merge|similarity|projection|skillread|pack-win|tools/lib|check-labels` → **0 命中**）。
- **反證**：試過「可能有測試捉數字」→ `test/` 冇任何 README／file-map 斷言；`AGENTS.md` §8 只係叫「記得同步更新」（`docs/dedup-next-steps.md` §0.4 自認上一輪就係咁漂）。

### 【中等】M6 · 啟動資源三套錯誤政策（其中一套係「靜默僵屍」）

- **位置**：`main.js:144-151`（模板**唔見** → 一句 `console.error` 之後照開，之後每幀喺 `:1779` `if (!templatesReady()) return;` **靜默早退** → HUD 永遠「等待面板條」）／`:145` 同一個 `JSON.parse` 如果**內容壞** → module scope throw（import 期爆）／`:1575-1582` 設定唔合法 → catch ＋ 清楚訊息 ＋ `app.exit(1)`。
- **影響**：同一類「啟動資源唔妥」有三種完全唔同嘅下場；「靜默僵屍」最難查（用戶見到程式開到但永遠唔出數）。
- **反證**：試過「打包版一定搵得到模板（asar 白名單有）」→ 成立，所以主要影響開發／半壞環境；但三個窗口行為唔一致仍然係設計不一致。

### 【中等】M7 · 成長曲線：x 軸係**樣本序號**但文字講「N 分鐘」；而且冇場次邊界

- **位置**：`src/hud/history.js:85` `const step = SPARK_WIDTH / (values.length - 1);`（**完全唔用 `sample.at`**，`:86-90`）vs `historySummary()`（`:104-119`）用真時間算 `spanMs` → HUD 出「成長 −10000（60 分鐘）」；`hud.html` 顯示嗰句。
- **狀態設計**：`statHistory` 唯一初始化 `main.js:254`、唯一寫入 `:313`，**冇任何 reset**；面板條（`:1873`）同培育結束確認（`:1955`，`source='result'` 係**下限值**）餵**同一條**陣列。
- **影響**：換窗／「強制更新」／由培育中轉去培育結束確認之後，曲線同文字都係跨場次混算 → 出一個冇意義嘅「成長」數。
- **反證**：試過「`pushSample` 去重會救命」→ `history.js:64-65` 只擋「完全相同嘅樣本」，唔擋**來源／場次改變**。

### 【中等】M8 · 同一個「ROI→像素」規則有 **3 份**，而閘測嘅係**副本**唔係生產碼

- **3 份**：`electron/capture.html:231-264`（`regionFor()`，真正生產）、`tools/diag-statbar.js:84-92`（`cropLikeRenderer()`，**手抄**，註釋自己寫「同 renderer 嗰段邏輯要一致」）、`src/vision/content-box.js` ＋ `statbar.js:254-263` 嘅相對幾何。
- **證據**：`cropLikeRenderer()` 冇 `regionFor()` 嗰啲 clamp（`Math.max(x0 + 8, …)`、`x1 >= 1 ? vw`、`y1 >= 1 ? contentTop + contentH`）；而 `tools/diag-statbar.js --read --cropped` 就係 `AGENTS.md` §8 指定嘅**驗收閘** → 佢驗嘅係副本。
- **我自己數值核對（反證用）**：用 `capture.html` 真碼抽出 `regionFor()`，同 `resultpanel.resultStripRect()` 比 6 個解析度（1920×1120／1930×1116／1600×900／1356×800／2560×1440／1280×720）→ **6/6 逐個像素一樣** ⇒ 現時**未**分歧，係結構性風險（今日冇症狀）。

### 【中等】M9 · 驗證覆蓋落差（自報）

- `fit-score` 自己印「段覆蓋率（每 50 點一段）：已覆蓋 **15/40** 段」→ 五維係數表有 25 段**冇任何樣本驗證**。
- ランク表靠 5 條樣本反查（`AGENTS.md` §4.2）；實機效能（5fps 延遲／CPU／記憶體）未量（`docs/known-issues.md` §9）。
- **反證**：5/5、誤差 0 係**實測真值**唔係估 → 呢條係「驗證廣度」風險，唔係「已知錯誤」。

### 【中等】M10 · `whatif.html` 用 `innerHTML` 插未轉義輸入（+ 冇 CSP + `nodeIntegration: true`）

- **位置**：`electron/whatif.html:366` `` td1.innerHTML = `<span class="delta neg">${e.query}</span>` ``（`e.query` ＝ 用戶自己貼嘅嗰行原文）；對照 `electron/settings.html:530-534` **有** `escapeHtml()` 而且統一使用。
- **環境**：`electron/web-preferences.js:25-27` `nodeIntegration: true` ＋ `contextIsolation: false`；4 個 HTML **冇** `Content-Security-Policy`（grep 0 命中）；全 repo 冇 preload。
- **實際可利用性（誠實界定）**：攻擊者＝用戶自己貼落去嘅文字（**self-XSS**，唔係遠端注入 —— 技能名等 DB 內容冇行呢條 `innerHTML`）→ 風險係「貼一段嘢就本機執行任意程式碼」，屬安全衛生問題，唔係對外攻擊面。

### 【中等】M11 · `AGENTS.md` §2 寫嘅 Electron 起步「修法」喺呢個環境**唔生效**（實測）

- **我實跑**：`node_modules\.bin\electron.cmd tools\verify-renderer-load.js` → **跑成 Node 模式**，爆
  `TypeError: Cannot read properties of undefined (reading 'setPath')`（`app` undefined）。**先** `Remove-Item Env:\ELECTRON_RUN_AS_NODE` 一樣。
- **根因（實查）**：PATH 上嘅 `node` ＝ DSH harness shim `…\harness\.desktop-bin\node.cmd`，內容第一句就係 `@set ELECTRON_RUN_AS_NODE=1` → ① pwsh 自己 `$env:` 係空；② 每個 `node` 子程序見到 `"1"`（實測）；③ `electron.cmd` → `node cli.js` → `electron.exe` 繼承 `=1` → Node 模式。喺 pwsh 入面刪**刪唔到**（shim 每次 set 返）。
- **繞過方法（我實測）**：直接叫 `node_modules\electron\dist\electron.exe <script>` → **真 Electron**（`process.versions.electron = 44.4.1`、`app` 有值、`whenReady` 行到），但**即刻 FATAL**：`mojo\public\cpp\platform\platform_channel.cc:108 Check failed: 存取被拒 (0x5)`。
- **結論（同 `docs/dedup-next-steps.md` 一致）**：真 Electron 嘅閘（實載閘／`npm start`／HUD 穿透／拖位）**只可以由用戶喺自己終端跑**；文件寫嘅第一步修法係錯／唔完整 → 下次 agent 撞到嘅係一個睇落似程式 bug 嘅 `TypeError`。

### 【輕微】

| # | 一句 | 位置 / 證據 |
|---|---|---|
| L1 | `fromSource.w/h` 零讀取點（死碼）＋**註釋自相矛盾**：`:262` 寫「已刪走」，`:773-775` 仍寫「話畀 assertAxis() 聽大細係寫死嘅」 | `src/hud/config.js:262` vs `:773-775` vs `:811-812`（`validateLayout` 只讀 `.x/.y/.midSpan`）|
| L2 | log 輪替**只喺 open 一次**，`write()` 唔查 size → 單一長 session 會超過 2 MB（同 `:14-17` 自己寫嘅理由矛盾） | `src/hud/log-file.js:72`（唯一 `shouldRotate` 呼叫）vs `:83-89` |
| L3 | `settings.html` 嘅 `MIN_SIZE=0.01`／`DECIMALS=6` 同 `layout.js` 常數**冇閘綁住**（測試用字面 0.01 斷言） | `electron/settings.html:125-128`；`test/hud-settings-html.test.js:187` 硬編 `0.01` |
| L4 | 倍率規則**第三份**（同一檔兩條計分路徑） | `tools/breakdown.js:42` 自己 `1 + APTITUDE_COEFFICIENT…`，`:52` 又用 `normalSkillPoints()` |
| L5 | 8 條測試用 `{ skip: !hasDb }`（違反 `AGENTS.md` §8.1「唔准用 skip 迴避」嘅精神） | `test/whatif-skilllist.test.js:144,160,166,181,198,208,220,228` |
| L6 | `fetch-skill-db.js` **直接覆寫**主資料庫，冇備份／冇 diff 守門（DB 有入 git，所以仍可回溯） | `tools/fetch-skill-db.js:141-152` |
| L7 | 公開 repo **冇 LICENSE** | `git ls-files` 0 命中；`README.md:254` 自認「預設保留所有權利」|
| L8 | 未追蹤 cache 冇入 `.gitignore`（每次 `git status` 出 noise，`git add -A` 會誤入庫） | `?? data/bwiki-skill-pages.json`（27.4 KB）；`git check-ignore` exit 1 |
| L9 | `dropNonDigits()` 由 `statbar.js` 借去 `resultpanel.js`，但兩邊預設唔同（`0.55` vs statbar 嘅 `0.8`） | `src/vision/statbar.js:359-361`；`resultpanel.js:33,250`（呼叫點全部唔傳 options）|
| L10 | 自寫 PNG 解碼器對截斷／CRC 冇防護（`raw` 短 → `undefined & 0xff` ＝ 0 靜默黑，唔 throw） | `src/vision/png.js:33-99`；⚠️ runtime 只用 `encodePng`，影響限於 tools／test |
| L11 | `AGENTS.md` 用咗 **58,724 / 65,536 bytes ≈ 89.6%** 指令預算（已經因為超預算拆過一次章） | `AGENTS.md` 自己嘅 §5 引言 ＋ 實測 byte 數 |

---

## 3. 已撤回（反證成功，**唔算**問題）

| 原本懷疑 | 推翻證據 |
|---|---|
| 子審 S4：`resultpanel` **隱形繼承** `statbar` 嘅 `minGlyphHeightRatio = 0.8` | `DEFAULT_RESULT_OPTIONS`（`resultpanel.js:42-97`）**冇**呢個欄位；4 個呼叫點全部唔傳 options（`main.js:1912`、`tools/read-result.js:41,88`、測試）→ `dropNonDigits` 走 `?? 0.55`。真身只係 L9（輕微）|
| 子審 S5：閘同生產剪出嚟 **161 vs 160 px** | 我自己抽 `capture.html` 真碼比 6 個解析度 → **6/6 完全一樣**（例：1920×1120 → 686–846／348–523）|
| `tools/replay-dumps.js` 冇 dump 會「靜默通過」 | 冇資料夾／冇 `.raw` 會**大聲 exit 1**（`:35-38`、`:83-86`）|
| `skills.js` 同 `aptitude.js` 兩份倍率表 = 兩份真相 | `test/whatif.test.js:82-84` 逐個值釘住相等 → 有閘 |
| `whatif.js` 同 `evaluate.js` 重複計分（會算出唔同答案） | `whatif.js:341,377-378` 一律經 `aptitudesFor()`＋`normalSkillPoints()`，`after` 用 `evaluate()` 全量重算 |
| `src/umascore/**` 抓取邏輯污染零 I/O 核心 | 18 檔 `grep node:fs|fetch(` ＝ 0 |
| `tools/**` 冇共用 args parser | 45／52 個工具用 `tools/lib/args.js` |
| `layout.js` 唔純（偷讀 env／檔案） | 純函數，env 由呼叫方传入 |
| 測試靠 cwd／全域殘留（`--test-isolation=none`） | 我實跑 21 個相關檔 171/171；`chdir` 有 `finally` 還原 |
| `statPoints()` 近 2000 會 NaN | 0–2000 全部 finite（子審逐點跑過）|

---

## 4. 風險修改點（**如果將來要修，呢啲係極難發現嘅連帶風險**）

1. **S1（適性）**：加別名／正規化會改 `aptitudes` → 直接影響 `tools/fill-ground-truth.js` 填出嚟嘅 ground truth ⇒ **可能整爆現時 5/5 誤差 0**。加 throw 會令 `fill-ground-truth` 喺 211 條招上面直接爆；必須先決定「認唔到要 throw 定要 warn」＋同步所有資料。
2. **S2／S3（閘）**：令信心閘「真係會 fire」等於**提高靈敏度** → 可能令本來讀得到嘅實機幀變成「唔出數」（用戶最介意嘅退化）。加數值範圍閘前要確認 `MAX_STAT 2600` 對「屬性上限再開放」仍然安全（現時上限 2000）。
3. **M1（`highlighted`）**：拆語意會同時改 `layout.hudState()`／`hud.html` 嘅金色標示 ＋ `main.js` 三處分支；`docs/known-issues.md:39-42` 已經記錄「只係 row-level、講唔出係邊一格」——呢個係**已知取捨**，唔係新增。
4. **M2（env）**：如果只把 `layoutFromEnv` 嘅 throw 改成警告（令 `_X=" "` 唔再令程式開唔到），就會放生「範圍唔合法」嘅情況 → HUD 可以靜默走出畫面（`validateConfig()` 就是為此而 throw）。反過來若把 `_W=" "` 改成 throw，就會令「`0x10` 當 16」呢類既有測試認可嘅行為變矛盾。
5. **M3（單位）**：如果改用 `gameWindowRect()`（已經 `Math.min` 夾過工作區）做比較，警告會**永遠唔出**（夾完一定 ≤ 工作區）→ 要另立純函數，唔可以順手換。
6. **M4（result 條盲）**：加 `dumpFrame()` 會令每秒多寫一張 PNG（`shots/live-debug/` 已有 973 幀）→ 要同 dump 上限（`MAX_DUMPS 40`）一齊設計。
7. **M6（模板缺）**：如果改成 throw／`app.exit(1)`，就會同打包版行為（模板一定在）脫節；亦要小心 `:145` 嗰個 `JSON.parse` 已經係 import 期爆，唔可以「順手」改成警告。
8. **M8（三份剪裁）**：`capture.html` 係 classic script，**唔可以** import ESM → 唯一可行方向係「用 `capture-region.test.js` 嗰招抽真碼做等價斷言」；直接刪 `diag-statbar` 嗰份會令 `--cropped` 閘失去模擬 renderer 嘅能力。⚠️ 改 `regionFor()` 嘅 clamp 會令連拍模式剪出界外 → 一堆全黑 PNG，而 `samePage()` 會當同一頁全部略過（靜默收唔到圖）。
9. **M10（innerHTML）**：如果改成全部 `textContent`，會失去 `<b>`／`<span class="delta">` 樣式（視覺變化）→ 要用 DOM API 砌，唔可以純字串替換。
10. **L5（skip）**：改成硬失敗會令「DB 檔唔見」由『靜默 skip』變『紅』——但依 `AGENTS.md` §8.1 呢個正是想要嘅行為；要留意 CI 同本機都要有 `data/skill-db-tw.json`（現時有入 git）。

---

## 5. 疑似但未證實（唔可以當結論）

1. S1 嗰 211 條招係「邊一步併庫引入」（子審指向 `bwiki-calc-page(name=jp)` 路徑）—— 我只證實**結果**（簡體／日文條件同繁中並存），**未**追源。
2. `data/ground-truth/*.json` 入面有冇任何一條樣本嘅 `aptitudes` 曾被 S1 嗰條路徑污染（影響「誤差 0」嘅獨立性）—— 未逐條核。
3. `electron/main.js:127` module 頂層就問 `app.getPath('userData')`（經 `writeRoot()`），同 `:74-76` 註解聲稱「lazy、等 Electron 準備好」有冇實際影響 —— 未在真 Electron 驗（沙盒起唔到）。
4. 5fps 之下 CV ＋ `deflateSync` ＋同步 `JSON.parse`（622 KB）嘅實際 CPU／延遲 —— **未量**（`docs/known-issues.md` §9 自認）。
5. `whatif.html` 之外，其餘 3 個 HTML 有冇同類未轉義插值 —— 只抽查咗 `settings.html`（有 `escapeHtml`）。

---

## 6. 附錄：審查過程走過嘅節點（可回溯）

1. 鎖定對象（工作樹 ＋ HEAD `1e5a4b6`）→ 實跑 8 個閘取現況基線 → 2. 全檔規模／依賴方向量測（`main.js` 2231 行、45 全域、17 handler；`src/**` 零 `electron` import；`src/**` 冇零引用檔）→ 3. 分 4 個子審（electron／hud+capture／vision／umascore+tools+test）→ 4. 主審自己實跑：乾淨 checkout 重現、`npm test` 529/0、影像三閘、`replay-dumps` 973 幀、字型／環境／Electron 三個獨立 probe → 5. 逐條反證（推翻子審 2 條嚴重結論、1 條自家假設）→ 6. 交叉核對文件 vs 實況（README／file-map／AGENTS byte 預算）→ 7. 彙整成本報告。

> 過程檔案（4 份子審報告 ＋ 5 個 probe script）全部係臨時檔，**已清理**（`.review-tmp/` 已刪）；本報告係唯一產出。
