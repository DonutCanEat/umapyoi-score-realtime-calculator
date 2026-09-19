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
- 公開（public）定私人（private）由你決定 —— ⚠️ 公開之前留意下面 §5「法律／禮貌」

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

## 5. 公開之前要諗嘅事

| 項目 | 情況 |
|---|---|
| **敏感資料** | ✅ 已掃過：追蹤檔冇 token／密碼／真實個人路徑（測試入面 `C:\Users\x` 係假嘅） |
| **`data/skill-db-tw.json`（1323 招技能名）** | ⚠️ 由 bwiki 抓返嚟嘅**遊戲資料**。技能名／數值係遊戲內容（Cygames 版權）。技術上係事實資料、社群 wiki 亦一直公開，但**公開 repo 等於再分發**。想保守：改為 `.gitignore` 佢，附一個 `tools/fetch-skill-db.js` 令用家自己抓（本專案已經有呢個工具 ✅） |
| **`shots/gt/*.png`（遊戲截圖）** | ⚠️ 同上：遊戲畫面截圖。做測試證據好有用，但係遊戲內容 |
| **冇 licence** | ⚠️ 冇 `LICENSE` 檔 ＝ 預設「保留所有權利」（人哋唔可以合法重用）。想開放就要加（MIT／Apache-2.0…）。想「睇得唔改得」就唔加，但要喺 README 寫明 |
| **`AGENTS.md`／`docs/`** | 內容係開發紀錄，公開冇問題（反而係賣點） |

⭐ 建議：**先開 private 倉庫**，確認一切正常再決定要唔要轉 public（轉嘅時候可以順手處理上面兩項）。

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
