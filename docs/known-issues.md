# 已知待辦／技術債（交接用）

> 由 `AGENTS.md` §9（含 §9.1「已知限制／技術債」）搬過嚟（D4，2026-09-19）。**內容一個字都冇改**。
> ⚠️ §9.1 嗰啲係「**未修**」嘅嘢（獨立審計發現）—— 唔准當已修。

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
2. ✅ **已修（2026-09-23，技術債 §9.1-2）—— 但實機驗未完**：`placeHud()` 嘅單位混用
   （`Math.min(workArea.width /* DIP */, game.width /* 擷取幀物理像素 */)`）已抽出純函數
   `src/hud/layout.js` 嘅 `gameWindowRect(game, display)`：**物理像素 ÷ `scaleFactor` → DIP**
   之後才同 `workArea` 比（`scaleFactor` 唔合法／冇量到遊戲大細 → 用工作區，唔會出 NaN）。
   回歸：`test/hud.test.js` 4 條（100% 縮放行為**唔變**、150% ＋ 視窗化要 ÷1.5、
   大過工作區要夾返、冇量到要安全）。
   ⚠️ **仍未做**：窗口化遊戲嘅**螢幕位置**照舊假設喺工作區左上角（冇 Win32 API 讀遊戲窗座標）；
   而且上面係**純推理 ＋ 單元測試**，**未經實機 150% 縮放驗證** —— 要驗就要用
   `UMAPYOI_HUD_EDIT=1` 睇 `[HUD/位]` log（或在 150% 縮放之下拖一次對位）。
3. **金色格 `highlighted` 只係 row-level**（整條數值行嘅墨點色相 p90 ≥ 33°），**唔係逐格** →
   app 只講得出「有金格」，講唔出「係邊一格」。⚠️ 而 `src/vision/statbar.js` 自己嘅註釋
   反而寫「一定要逐格判斷…唔可以用整條面板條嘅平均」→ **兩者矛盾，係既有取捨（未修）**。
   升級要 `statbar.js` 額外回傳每格判斷（逐個數字格各自量色相 p90）。
4. ✅ **已修（2026-09-23，技術債）—— 唔可以再當「技術債」**：`pushHud()` 嘅 dedupe key
   終於有永久自動閘。做法同當初建議一樣：欄位清單搬去 `src/hud/layout.js` 純函數
   `HUD_VIEW_KEY_FIELDS` ＋ `hudViewKey(view)`（`main.js` 只負責叫佢），
   再用 `test/hud-view-key.test.js`（4 條）由**兩邊**夾住呢個不變式：
   ① 每個欄位一變 → key 一定要變（純函數測試；連「唔喺清單入面嘅 `total`／`rank` 唔應該影響 key」都反證埋）；
   ② 由 `electron/hud.html` **原始碼抽所有 `view.<欄位>`** → 每一個都要喺清單入面
   （呢條就係「加咗新顯示項目但唔加落 key ＝ HUD 靜默唔郁」嘅閘）；
   ③ `main.js` 唔准自己再砌 `JSON.stringify([view.…])`（兩條清單分叉就係原本嘅病）。
   ⚠️ 順手要改兩處先做得到：`hud.html` 嘅 `renderHistory(view)` 參數改名做 `history`
   （唔係嘅話佢啲 `points`／`width` 會被當成**頂層**欄位）；`test/hud-history-wiring.test.js`
   兩條 C3 閘由「抽 `main.js` 嗰條陣列」改為「檢查 `HUD_VIEW_KEY_FIELDS` ＋ `main.js` 真係用
   `hudViewKey()`」。測試 354 → **358**。
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
6. ✅ **已修（2026-09-23，技術債 §9.1-6）—— 唔可以再當「技術債」**：原子寫原本冇 `fsync`
   （`saveConfig()` = `writeFileSync(.tmp)` ＋ `renameSync`）→ `writeFileSync` 只係寫入
   OS page cache，**停電／硬斷電**之下 `rename()` 完成咗但內容仲喺 cache，開機之後見到嘅
   可以係**空檔或者半截 JSON**；而用戶完全睇唔出（`loadConfig()` 只會大聲 throw ＋ 改用預設，
   即係「啲設定無啦啦冇咗」）。已改成：`openSync` → `writeSync` → **`fsyncSync`** → `closeSync`
   → `renameSync`；失敗路徑照舊清走 `.tmp`。
   ⚠️ **停電喺測試入面製造唔到** → 回歸閘用**原始碼次序**斷言（`test/hud-config.test.js`
   「⭐ fsync 一定要喺 rename 之前」）：① `fsyncSync` 一定要存在；② 要喺 `writeSync` 之後、
   `renameSync` **之前**；③ 唔准用返 `writeFileSync(tmp, …)`（冇 fd 就 fsync 唔到）。
7. ✅ **已修（2026-09-19，獨立審計 M1）—— 唔可以再當「技術債」**：
   同一類 truthiness 問題嘅最後一個 —— `UMAPYOI_SKILL_DUMP`。
   舊寫法 `SKILL_DUMP = Boolean(process.env.UMAPYOI_SKILL_DUMP)` → `UMAPYOI_SKILL_DUMP=0`
   一樣會**開咗**連拍模式（`'0'` 係非空字串 = truthy）。
   而家同其他旗標一樣經 `envFlag('UMAPYOI_SKILL_DUMP')`（`src/hud/env-flag.js`）：
   只認 `1`／`true`（大小寫唔敏感、前後空白忽略），`0`／`false`／空字串／冇 set = 閂，
   其他值 = 閂 **＋ 警告**。
   ⚠️ **行為改動（刻意）**：`UMAPYOI_SKILL_DUMP=0` 由「開」變「閂」—— 同 AGENTS §2 寫嘅語意一致。
   數字型旗標（`UMAPYOI_DUMP_FRAMES`／`_SKILL_MAX`／`_CAPTURE_FPS`）用 `envNumber()`
   （唔合法 → 警告 ＋ 用預設；`positive: true` 令 `=0` 一樣當唔合法 → 同舊 `||` 行為等價），
   唔屬呢一類。
8. ✅ **已修（2026-09-19）—— 唔可以再當「技術債」**：`validateConfig()` 嘅不變式檢查
   （「`x[1]` 一定要等於 `x[0] + size.w`，唔係就 throw」）令 **AGENTS §2 列出嘅六行環境變數
   一齊用會 throw → `main.js` catch → `app.exit(1)` → 完全開唔到程式**（獨立審計實跑證實）。
   已改成「**`size` 為準**、`x[1]` 由推導得出；寫死嘅 `x[1]` 唔一致 → 大聲警告」，
   而**推導出嚟嘅範圍唔合法**（右邊界 > 1／`size <= 0`／`x[0] < 0`）照樣 throw
   → 原本要防嘅「HUD 靜默走出畫面」仍然捉得到。回歸測試：`test/hud-config.test.js`
   「⭐ 回歸：AGENTS §2 嗰六行環境變數一齊用**唔准 throw**」。詳見 §2／§6.4。


---
