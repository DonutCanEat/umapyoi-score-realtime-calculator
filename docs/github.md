# 擺上 GitHub ＋ 發佈流程（用戶 2026-09-19 要求）

> 用戶要求兩件事：**① 專案擺上 GitHub；② 每次改動都 commit；③ `.exe` 擺喺 Release（唔入 repo）**。
> 呢份寫明**一次設定**同**之後每次發版**要做咩。

---

## 1. 鐵律：exe 唔入 repo

| 嘢 | 去邊 | 為何 |
|---|---|---|
| 原始碼、測試、`shots/` 證據、`docs/` | **git repo**（commit） | 要追蹤、要能重現驗收 |
| `dist/**`（含 exe） | **GitHub Release 資產** | 95.7 MB 二進位；每次改動都會產生新檔 → 入 repo 會令倉庫爆漲同 diff 變垃圾 |
| `node_modules/`、`.cache-local/`、`dist/`、`*.log` | `.gitignore`（唔入 git） | 可重建 |
| `shots/live-debug/`、`shots/skill-dump/`、`snapshots/`、`diagnostics/` | `.gitignore` | runtime 中間產物 |
| `hud-position.json` | `.gitignore` | 用戶自己嘅 runtime 狀態（人人唔同） |

✅ 檢查：`git check-ignore -v dist/x.exe` 應該有輸出（＝擋到）。

---

## 2. 一次性設定（要你出手，因為要 GitHub 授權）

### 2.1 喺 GitHub 開一個空倉庫

- 去 <https://github.com/new>
- 名：`umapyoi-score-realtime-calculator`（或者你喜歡嘅名）
- **唔好**勾「Add README／.gitignore／licence」（我哋本地已經有）
- 公開（public）定私人（private）：⭐ **2026-09-23 用戶決定要 public**（見 §5）

### 2.2 授權（三揀一）

| 方法 | 要做咩 | 好處／壞處 |
|---|---|---|
| **A. HTTPS ＋ Personal Access Token**（最簡單） | GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained token**，權限只勾 **Contents: Read and write**（同 **Metadata: Read**）| ✅ 唔使裝嘢；⚠️ token 等於密碼，**唔好貼落 chat／唔好 commit**。首次 push 會彈視窗，打 token 做密碼（Windows 憑證管理員會記住） |
| **B. SSH key** | 我幫你 `ssh-keygen`（唔會外洩私鑰）→ 你貼公開鑰去 GitHub → Settings → SSH keys | ✅ 之後唔使再打任何嘢；⚠️ 要貼一條公開鑰（`ssh-ed25519 AAAA…`，貼出嚟係安全嘅） |
| **C. 裝 GitHub CLI（`gh`）** | 裝 `gh` → `gh auth login`（開瀏覽器授權）→ 之後 `gh repo create` 同 `gh release create` 一條龍 | ✅ 之後發版最順；⚠️ 要裝多一件工具（本機而家冇） |

> ⚠️ **GitHub 2021 年起唔收帳號密碼做 git 認證** → 一定要 A／B／C 其中一種。

### 2.3 加 remote 並推第一次

```powershell
git remote add origin https://github.com/<你嘅帳號>/umapyoi-score-realtime-calculator.git
git push -u origin main
```

（用 SSH 就係 `git@github.com:<帳號>/<repo>.git`。）

⚠️ 順手建議：`git config user.email` 而家係 `hangh@localhost`（假 email）。
GitHub 會用 email 對應 commit 同你嘅帳號；想 commit 顯示係你，改成你 GitHub 用嘅 email
（或者用 GitHub 提供嘅 `…@users.noreply.github.com`）。

---

## 3. 之後每次發版（兩種做法）

### 做法甲：手動（最直接，唔使設定）

```powershell
npm.cmd run pack:win                       # → dist/UmapyoiScoreRealtimeCalculator-<版>-portable.exe
git tag -a v0.1.0 -m "v0.1.0"              # 版本 tag
git push origin main --tags
# 去 GitHub → Releases → Draft a new release → 揀啱個 tag → 上傳 exe
```

### 做法乙：自動（GitHub Actions，`.github/workflows/release.yml`）

推一個 `v*` tag 就會**自動**：`npm ci` → 跑測試 → `pack:win` → 把 exe 掛上 Release。

```powershell
# 改完 package.json 嘅 version 之後：
git add package.json && git commit -m "chore: 版號 0.1.0 → 0.1.1"
git tag -a v0.1.1 -m "v0.1.1"
git push origin main --tags          # ⭐ 就係呢一步觸發自動打包發佈
```

⚠️ **Workflow 會跑測試做閘**（`npm test`）—— 測試唔過就**唔會發佈**（唔會出一個壞嘅 exe 畀人下載）。
⚠️ 第一次跑 GitHub Actions 可能要用幾分鐘裝 Electron（有 cache 之後快好多）。
⚠️ 出咗 release 之後仲想改？**唔好改資產**（會令已下載嘅人對唔上）→ 出一個新版本號。

---

## 3.1 ⚠️ 第一次發佈失敗紀錄（2026-09-19）—— 一定要睇

推咗 `v0.1.0` 之後，workflow **跑咗但失敗**，所以 Release **冇出過**（只有 tag）。
根因**唔係**我哋程式，係 **CI 嘅 Node 版本唔啱**：

```
node: bad option: --test-isolation=none
```

- `npm test` 用咗 `node --test --test-isolation=none` —— 呢個 flag 係 **Node 24** 先有
- workflow 原本寫 `node-version: 22` → 一開頭就爆，後面所有 step **skipped**
- ⚠️ 而 `--test-isolation=none` **唔可以拔**：本機實測（v24.9.0）冇咗呢個 flag，
  **每個測試檔都會爆**（各檔共用一個 process 有衝突，例如 `process.chdir`)
- ✅ 修法：workflow `node-version: 24`（同本機 v24.9.0 一致）

**教訓**：CI 嘅 Node 版本要**同本機一致**，唔可以「是但揀個 LTS」。
呢個失敗模式好陰險 —— 本地全過（346/346），CI 一開頭就死，而且**只出 tag 唔出 release**，
睇落好似「workflow 冇跑」。

**點查（唔使開瀏覽器）**：
```powershell
# 由 Windows 憑證管理員攞 GitHub token（classic PAT，40 字元）
$cred = "protocol=https`nhost=github.com`n`n" | git credential-manager get
$tok = ($cred | Where-Object { $_ -like 'password=*' }) -replace '^password=',''
$H = @{ Authorization = "Bearer $tok"; Accept = 'application/vnd.github+json'; 'User-Agent'='x' }
$repo = "DonutCanEat/umapyoi-score-realtime-calculator"
(Invoke-RestMethod "https://api.github.com/repos/$repo/actions/runs?per_page=1" -Headers $H).workflow_runs[0] |
  Select-Object run_number, status, conclusion
(Invoke-RestMethod "https://api.github.com/repos/$repo/releases" -Headers $H) |
  ForEach-Object { "$($_.tag_name)  assets=$($_.assets.Count)" }
```
⚠️ 喺 agent shell 入面要 `danger-full-access`（沙盒攞唔到憑證）。

⭐ **已修好並驗證（2026-09-19，run #3）**：

| 步驟 | 結果 |
|---|---|
| 跑單元測試（346 條） | ✅ success |
| 語法閘 | ✅ success |
| 對答案（計分核心必須誤差 0） | ✅ success |
| 打包 portable exe | ✅ success |
| 上傳做 Release 資產 | ✅ success |

→ Release：<https://github.com/DonutCanEat/umapyoi-score-realtime-calculator/releases/tag/v0.1.1>
→ 資產：`UmapyoiScoreRealtimeCalculator-0.1.1-portable.exe` **95.7 MB**（同本機打包一模一樣大細）

⚠️ 過程中總共修**兩個** CI-only 問題（本地全部正常）：
1. **Node 版本**：workflow 用 22，但 `npm test` 要 Node 24 嘅 `--test-isolation=none`（run #1）
2. **`electronDist` 寫死**：本機沙盒專用嘅 `node_modules/electron/dist`，CI 上面唔存在（run #2）
   → 詳情 `docs/packaging.md` §3.3

**教訓**：CI 同本機嘅差異（Node 版本、快取路徑）唔會喺本地測試暴露 —— 一定要睇實際 run 嘅日誌。

**重跑方法**：失敗嘅 tag **唔會**自動重試（workflow 已經有 run 紀錄，而且 tag 已存在）
→ 最乾淨係**升版號出一個新 tag**（`0.1.0` → `0.1.1` → tag `v0.1.1`）。

---

## 4. 每次改動都要 commit（用戶要求，同 `AGENTS.md` §0 一致）

```powershell
git add <今次改動嘅檔案>        # ⚠️ 唔好 git add -A 亂加
git commit -m "<type>(<scope>): <繁中一句話>"
```

- `<type>`：`feat`／`fix`／`docs`／`test`／`chore`／`refactor`／`perf`
- `<scope>`：`vision`／`score`／`skills`／`electron`／`tools`／`docs`
- **內容要寫為何 ＋ 實測數據**（例：`30/30`、`誤差 0`），唔好只寫「更新檔案」
- **驗收唔過唔准 commit**（`AGENTS.md` §8）
- 一個 commit 一件事

---

⭐ **用戶 2026-09-23 決定：保持 public**（實測 API `"private": false` —— 倉庫已經係公開，
任何人有 link 就睇得到 source、`shots/` 證據圖、Release exe）。下面幾項係當時列出嘅風險，
**用戶知悉並接受**（未有 `LICENSE`，所以預設「保留所有權利」）：

| 項目 | 情況 |
|---|---|
| **敏感資料** | ✅ 已掃過：追蹤檔冇 token／密碼／真實個人路徑（測試入面 `C:\Users\x` 係假嘅） |
| **`data/skill-db-tw.json`（1323 招技能名）** | ⚠️ 由 bwiki 抓返嚟嘅**遊戲資料**（Cygames 版權）—— 已知悉，**照公開** |
| **`shots/gt/*.png`（遊戲截圖）** | ⚠️ 同上：遊戲畫面截圖 —— 已知悉，**照公開** |
| **冇 licence** | ⚠️ 冇 `LICENSE` 檔 ＝ 預設「保留所有權利」（人哋唔可以合法重用）—— 現狀 |
| **`AGENTS.md`／`docs/`** | 內容係開發紀錄，公開冇問題（反而係賣點） |

⚠️ 想轉返 private：GitHub → Settings → 最底 Danger Zone → Change repository visibility
（agent 唔會幫你改呢樣）。

---

## 6. 檢查清單

**第一次推之前**
- [ ] GitHub 開咗空倉庫（冇 README）
- [ ] 揀咗授權方法（A／B／C）並完成
- [ ] `git remote add origin …` 設好
- [ ] `git config user.email` 改成 GitHub 用嘅 email
- [ ] `git status` 乾淨、`npm.cmd test` 全過

**每次發版之前**
- [ ] 測試全過（`npm.cmd test`）＋ 相關驗收閘（`AGENTS.md` §8）
- [ ] `package.json` 嘅 `version` 改咗
- [ ] commit 咗（唔好漏 `package.json`）
- [ ] tag 同 version 一致（`v0.1.1` ↔ `0.1.1`）
- [ ] Release 資產只有 exe（唔好連 `win-unpacked/` 成個資料夾上傳）
