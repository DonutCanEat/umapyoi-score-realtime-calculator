/**
 * HUD 嘅**設定存檔層**（位置／大細／偏移 ＋ 顯示選項）→ `hud-position.json`。
 *
 * 為何要呢一層：AGENTS §6.4／§9 講明「唔啱位唔使改 code」而家只有環境變數一途 ——
 * 一閂程式就冇咗，用戶要每次打（`UMAPYOI_HUD_DX=0.59` 咁）。有咗檔案，
 * 調好一次就定案，環境變數留返做「臨時覆寫」。
 *
 * ## 設計規矩（本專案底線，唔可以讓）
 *
 * 1. **純函數、零 Electron**：`import` 呢個檔**唔會**做任何 I/O，
 *    所以 `node --test` 直接跑得（同 `layout.js` 一樣嘅理由：判錯位置係實機先痛）。
 * 2. **唔准自己再打一次數字**：預設位置／大細／偏移全部**重用** `layout.js` 嘅
 *    `DEFAULT_HUD_LAYOUT`／`DEFAULT_HUD_SIZE`／`DEFAULT_HUD_OFFSET`
 *    → 兩處走樣（改咗一邊唔記得另一邊）係實際踩過嘅坑。
 * 3. **唔准靜默**：JSON 壞／欄位唔合法一律 **throw**（唔准靜默當 0、唔准靜默回預設）。
 *    跟 `layoutFromEnv()` 現有做法 —— 靜默用錯位置比起跑唔到更難查。
 *    唯一回預設嘅情況係「檔案唔存在」（＝未存過檔，係正常狀態）。
 * 4. **優先次序：環境變數 > config 檔 > 預設** → `resolveHudConfig(env, fileConfig)`。
 *    env 嘅解析**重用** `layoutFromEnv()`（連變數名都由 `HUD_ENV_KEYS` 嚟），唔複製。
 *
 * ## 檔案格式（`hud-position.json`，UTF-8 JSON）
 *
 * ```json
 * {
 *   "layout": {
 *     "x": [0.598, 0.81],
 *     "y": [0.03, 0.285],
 *     "offset": { "dx": 0, "dy": 0 },
 *     "size": { "w": 0.212, "h": 0.255 }
 *   },
 *   "display": { "total": true, "stats": true, "statScore": true,
 *                "skillScore": true, "goldMark": true, "note": true, "edit": true }
 * }
 * ```
 *
 * 兩節都係**選填**（缺 → 用預設；分節之內缺欄位一樣補預設），
 * 但**有寫嘅欄位一定要合法**，而且**唔准有唔認識嘅 key**（打錯字要即刻出聲，
 * 唔可以靜默失效 —— 例如 `dispaly`）。
 *
 * ⚠️ **不變式**：`x[1] = x[0] + size.w`、`y[1] = y[0] + size.h`
 * （設定窗同拖位共用同一個模型，`clampLayout()` 係嗰邊唯一做夾嘅地方）。
 * `validateConfig()` 一樣要守住 —— 因為**手寫**呢個檔唔會經 `clampLayout()`：
 * `{"x":[0.9,1.0],"size":{"w":0.5}}` 以前照過，但 `anchorHud()` 用 `size.w` 做實際大細
 * → 右邊界 2688 > 1920 → HUD 靜默走出畫面。詳見 `validateLayout()` 嘅規則表。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  DEFAULT_HUD_LAYOUT,
  DEFAULT_HUD_OFFSET,
  DEFAULT_HUD_SIZE,
  HUD_ENV_KEYS,
  layoutFromEnv,
} from './layout.js';

/** 存檔名（用戶要求嘅檔名）。 */
export const HUD_CONFIG_FILENAME = 'hud-position.json';

/**
 * 顯示選項嘅 key（＝ HUD 而家真係畫嘅嘢，一個 key 對一樣）。
 *
 * ⚠️ 形狀要同 HUD 現有顯示項目**一致**，所以每個 key 都寫明佢對應
 * `layout.js` `hudState()` 回嘅邊一項 —— 將來接線唔使靠記：
 *
 * | config key   | hudState() 出處                      | 意思 |
 * |---|---|---|
 * | `total`      | `lines[].key === 'total'`            | 評價点總分 |
 * | `stats`      | `lines[].key === 'stat0'…'stat4'`    | 五維逐格（速度／持久／力量／毅力／智力）|
 * | `statScore`  | `summary[].key === 'stat'`           | 五維分 |
 * | `skillScore` | `summary[].key === 'skill'`          | 技能分（未讀到 = `？／總分 ≥ X`）|
 * | `goldMark`   | `statbar.readStatBar()` 回嘅 `highlighted` | 金色格標示（屬性 > 1200）|
 * | `note`       | `note`（ランク／過期提示）            | 狀態一行 |
 * | `edit`       | `edit`（對位模式 `UMAPYOI_HUD_EDIT=1`）| 範圍／偏移一行 |
 */
export const HUD_DISPLAY_KEYS = Object.freeze([
  'total',
  'stats',
  'statScore',
  'skillScore',
  'goldMark',
  'note',
  'edit',
]);

/** 顯示選項預設：全部開（＝同今日 HUD 見到嘅一樣，加設定唔可以改變現有外觀）。 */
export const DEFAULT_HUD_DISPLAY = Object.freeze(
  Object.fromEntries(HUD_DISPLAY_KEYS.map((k) => [k, true])),
);

/**
 * 預設設定（**新 object**，呼叫者可以自由改）。
 *
 * 位置／大細／偏移一律由 `layout.js` 借過嚟，呢度一個數字都冇自己打。
 *
 * @returns {{layout:{x:number[],y:number[],offset:{dx:number,dy:number},size:{w:number,h:number}},
 *            display:Record<string,boolean>}}
 */
export function defaultHudConfig() {
  return {
    layout: {
      x: [...DEFAULT_HUD_LAYOUT.x],
      y: [...DEFAULT_HUD_LAYOUT.y],
      offset: { ...DEFAULT_HUD_OFFSET },
      size: { ...DEFAULT_HUD_SIZE },
    },
    display: { ...DEFAULT_HUD_DISPLAY },
  };
}

/** 預設設定（**共用常數，深層凍結**；要改就 `defaultHudConfig()` 攞一份新嘅）。 */
export const DEFAULT_HUD_CONFIG = deepFreeze(defaultHudConfig());

/** 預設檔案路徑（`baseDir` 預設係「而家嘅工作目錄」；喺呼叫時才算，唔係 import 時）。 */
export function defaultConfigPath(baseDir = process.cwd()) {
  return join(baseDir, HUD_CONFIG_FILENAME);
}

// ─────────────────────────── validate ───────────────────────────

/**
 * 逐欄檢查 → 回**正規化後**嘅新 object；唔合法就 throw。
 *
 * 檢查嘅係：型別（數字要係真數字，唔准字串免得靜默 coerce）、範圍
 * （x／y 喺 0–1 而且 `x0<x1`／`y0<y1`、size 喺 (0,1]、offset 喺 [−1,1]）、
 * **不變式 `x[1] = x[0] + size.w`**（見 `validateLayout()`）、
 * 同埋**唔認識嘅 key**（打錯字要出聲）。
 *
 * @param {unknown} obj 由 JSON 讀返嚟或者呼叫者砌出嚟嘅設定
 * @param {{x?:boolean,y?:boolean,w?:boolean,h?:boolean}} [fromSource]
 *        進階（`resolveHudConfig()` 合併之後用）：講明 `layout` 邊幾欄係「寫死」而唔係補預設
 * @returns {{layout:{x:number[],y:number[],offset:{dx:number,dy:number},size:{w:number,h:number}},
 *            display:Record<string,boolean>}}
 */
export function validateConfig(obj, fromSource) {
  if (!isPlainObject(obj)) throw new Error(`HUD 設定要係一個物件，實得 ${describe(obj)}`);
  onlyKeys('HUD 設定', obj, ['layout', 'display']);
  return {
    layout: obj.layout === undefined
      ? defaultHudConfig().layout
      : validateLayout(obj.layout, fromSource),
    display: obj.display === undefined ? { ...DEFAULT_HUD_DISPLAY } : validateDisplay(obj.display),
  };
}

/**
 * **不變式對帳**用嘅容差：兩個端點之間容許嘅浮點誤差。
 *
 * ⚠️ **唔可以當做「鬆手」**：呢個唔係容許「明顯唔一致」，而係唔想見到
 * `x[1] = 0.8100000000000001` 呢類**同一個數字嘅兩種寫法**被當成錯誤。
 * 任何真實嘅數值錯誤（改大細唔記得改範圍、手寫錯數字）都遠大於 1e-9。
 */
export const LAYOUT_EPSILON = 1e-9;

/**
 * 逐欄檢查 + **維持不變式** `x[1] = x[0] + size.w`（`y` 同理）→ 回新 object；唔合法就 throw。
 *
 * ## 為何一定要喺呢度守住（唔可以只靠 `clampLayout()`）
 *
 * ⚠️ 實際踩過：`validateConfig({ layout: { x: [0.9, 1.0], size: { w: 0.5, h: 0.2 } } })`
 * 以前**照過**（`x[0] < x[1]`、兩個值都喺 0–1、`size.w > 0` 各自都合法），
 * 但 `anchorHud()` 係用 `x[0] + offset.dx` 做左邊界、`size.w` 做**大細**
 * → 右邊界 ＝ 0.9 + 0.5 = 1.4 × 1920 = 2688 > 1920 → **HUD 靜默走出畫面，乜都唔報**。
 *
 * `clampLayout()`（設定窗 slider／拖位反推）本身有夾呢個不變式，但**手寫
 * `hud-position.json` 唔會經 `clampLayout()`** → 所以讀檔路徑一定要自己守住。
 *
 * ## 規則（刻意分開「冇寫」同「寫錯」）
 *
 * | 情況 | 行為 | 為何 |
 * |---|---|---|
 * | 同一個軸上面，範圍同大細**兩樣都有寫** | 一定要 `x[1] ≈ x[0] + size.w`，唔係就 **throw** | 兩個都係寫死嘅值 → 矛盾就係打錯，唔可以靜默揀一個 |
 * | 只有一邊有寫 | 另一邊**由嗰邊推** | 用戶冇寫嗰個唔算意圖，唔可以攞預設去推翻佢寫咗嗰個 |
 *
 * 第二行係關鍵：`{ x: [0.1, 0.3] }`（只寫範圍，舊檔案格式）一定要照收，
 * 但**唔可以**攞預設 `size.w = 0.212` 去砌出 `x[1] = 0.312` —— 咁樣等於靜默改咗用戶寫嘅範圍。
 *
 * ## ⚠️ 點解要 `hasX`／`hasW` 參數（而唔係自己望 `raw`）
 *
 * 呢個函數亦係 `resolveHudConfig()` 合併之後嘅閘，而合併係**逐欄位**做嘅
 * （env > 檔案 > 預設）。合併之後 `raw` 一定有齊所有欄位 → 單憑 `raw` 分唔出
 * 「用戶寫咗 `size`」同「`size` 係啱啱補返嚟嘅預設」，於是就會攞一個**來源唔同**
 * 嘅預設去否定用戶寫嘅範圍（例如 `UMAPYOI_HUD_X=0.1,0.3` ＋ 預設
 * `W=0.212` → 明明兩者都冇矛盾都會 throw）。所以呼叫者要講明「呢個軸上面
 * 範圍／大細**係唔係來自一個寫死嘅來源**」。
 *
 * @param {unknown} raw 由 JSON 讀返嚟或者呼叫者砌出嚟嘅 layout
 * @param {{x?:boolean,y?:boolean,w?:boolean,h?:boolean}} [fromSource]
 *        `true` ＝ 呢一欄係由寫死嘅來源（檔案／env）嚟，唔係補出嚟嘅預設
 * @returns {{x:number[],y:number[],offset:{dx:number,dy:number},size:{w:number,h:number}}}
 */
function validateLayout(raw, fromSource = {}) {
  if (!isPlainObject(raw)) throw new Error(`HUD 設定 layout 要係物件，實得 ${describe(raw)}`);
  onlyKeys('HUD 設定 layout', raw, ['x', 'y', 'offset', 'size']);
  const base = defaultHudConfig().layout;

  // 逐欄查「呢一欄到底有冇被寫死」—— 唔可以攞個值同預設比較
  // （寫咗一個啱啱好等於預設嘅值都算寫咗）。
  const hasX = fromSource.x ?? raw.x !== undefined;
  const hasY = fromSource.y ?? raw.y !== undefined;
  const hasW = fromSource.w
    ?? (raw.size !== undefined && raw.size !== null && raw.size.w !== undefined);
  const hasH = fromSource.h
    ?? (raw.size !== undefined && raw.size !== null && raw.size.h !== undefined);

  const x = raw.x === undefined ? null : validateSpan('layout.x', raw.x);
  const y = raw.y === undefined ? null : validateSpan('layout.y', raw.y);
  const size = raw.size === undefined ? null : validateSize(raw.size);

  // 逐個軸砌，**唔准混來源**：用戶寫咗嘅一定要贏（唔可以當冇寫過），
  // 冇寫嗰半由寫咗嗰半推。所以「範圍定大細做 source of truth」係**逐個軸**決定：
  //   ① 範圍同大細兩樣都有寫 → 一定要一致（唔係就 throw，見下面對帳）
  //   ② 只有大細有寫 → 範圍末端由「起點 + 大細」推
  //      （唔可以攞預設範圍 —— 咁樣等於丟咗用戶寫嘅大細）
  //   ③ 只有範圍有寫 → 大細由範圍推
  //      （唔可以攞預設大細 —— 咁樣等於改咗用戶寫嘅範圍）
  //   ④ 兩樣都冇寫 → 兩樣都用預設（預設本身一定一致）
  // ⚠️ 預設大細喺 `base.size`（唔係 `base.w`／`base.h`）—— 攞錯會靜默變 `undefined`。
  const out = {
    x: x ?? [...base.x],
    y: y ?? [...base.y],
    offset: raw.offset === undefined ? { ...base.offset } : validateOffset(raw.offset),
    size: {
      w: hasW ? size.w : (x ? x[1] - x[0] : base.size.w),
      h: hasH ? size.h : (y ? y[1] - y[0] : base.size.h),
    },
  };
  if (!x && hasW) out.x = [base.x[0], base.x[0] + out.size.w];
  if (!y && hasH) out.y = [base.y[0], base.y[0] + out.size.h];

  if (hasX && hasW) assertSpanMatchesSize('x', out.x, out.size.w, 'w');
  if (hasY && hasH) assertSpanMatchesSize('y', out.y, out.size.h, 'h');
  return out;
}

/**
 * 不變式對帳：`span[1]` 一定要等於 `span[0] + size`（浮點誤差 `LAYOUT_EPSILON` 之內）。
 *
 * 訊息刻意寫到「用戶睇得明」：講清楚**應該係幾多**、**而家係幾多**、同**條式**，
 * 因為呢個 throw 會經 `loadConfig()` 變成「HUD 設定檔…欄位唔合法」再 `app.exit(1)`，
 * 用戶只有呢句嘢可以照跟。
 */
function assertSpanMatchesSize(axis, span, size, sizeKey) {
  const expected = span[0] + size;
  if (Math.abs(span[1] - expected) <= LAYOUT_EPSILON) return;
  throw new Error(
    `layout.${axis}[1] 應該等於 layout.${axis}[0] + layout.size.${sizeKey}` +
    `（${span[0]} + ${size} = ${expected}），但而家係 ${span[1]}` +
    ` —— 兩個都係寫死嘅值但對唔上，唔知邊個才算（HUD 會用 size 做實際大細 → 走出畫面）。` +
    ` 修法：刪走 layout.${axis}（由 size 推）或者改 ${span[1]} → ${expected}。`,
  );
}

/** 相對範圍 `[前, 後]`：兩個有限數字、喺 0–1、而且**前細後大**。 */
function validateSpan(where, raw) {
  if (!Array.isArray(raw) || raw.length !== 2) {
    throw new Error(`${where} 要係兩個數字嘅陣列（例如 [0.1, 0.3]），實得 ${describe(raw)}`);
  }
  const [a, b] = [numAt(`${where}[0]`, raw[0]), numAt(`${where}[1]`, raw[1])];
  if (a < 0 || a > 1 || b < 0 || b > 1) {
    throw new Error(`${where} 兩個值都要喺 0–1（相對內容區），實得 ${describe(raw)}`);
  }
  if (!(a < b)) {
    throw new Error(`${where} 要前細後大（${a} < ${b} 唔成立），實得 ${describe(raw)}`);
  }
  return [a, b];
}

function validateOffset(raw) {
  if (!isPlainObject(raw)) throw new Error(`HUD 設定 layout.offset 要係物件，實得 ${describe(raw)}`);
  onlyKeys('HUD 設定 layout.offset', raw, ['dx', 'dy']);
  const base = { ...DEFAULT_HUD_OFFSET };
  return {
    dx: raw.dx === undefined ? base.dx : validateDelta('layout.offset.dx', raw.dx),
    dy: raw.dy === undefined ? base.dy : validateDelta('layout.offset.dy', raw.dy),
  };
}

function validateDelta(where, raw) {
  const n = numAt(where, raw);
  if (n < -1 || n > 1) throw new Error(`${where} 要喺 −1 到 1（相對內容區比例），實得 ${describe(raw)}`);
  return n;
}

function validateSize(raw) {
  if (!isPlainObject(raw)) throw new Error(`HUD 設定 layout.size 要係物件，實得 ${describe(raw)}`);
  onlyKeys('HUD 設定 layout.size', raw, ['w', 'h']);
  const base = { ...DEFAULT_HUD_SIZE };
  return {
    w: raw.w === undefined ? base.w : validateFraction('layout.size.w', raw.w),
    h: raw.h === undefined ? base.h : validateFraction('layout.size.h', raw.h),
  };
}

function validateFraction(where, raw) {
  const n = numAt(where, raw);
  if (!(n > 0) || n > 1) throw new Error(`${where} 要大過 0 而且唔超過 1（內容區比例），實得 ${describe(raw)}`);
  return n;
}

function validateDisplay(raw) {
  if (!isPlainObject(raw)) throw new Error(`HUD 設定 display 要係物件，實得 ${describe(raw)}`);
  onlyKeys('HUD 設定 display', raw, HUD_DISPLAY_KEYS);
  const out = { ...DEFAULT_HUD_DISPLAY };
  for (const key of HUD_DISPLAY_KEYS) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== 'boolean') {
      throw new Error(`HUD 設定 display.${key} 要係 true／false，實得 ${describe(raw[key])}`);
    }
    out[key] = raw[key];
  }
  return out;
}

// ─────────────────────────── 讀／寫 ───────────────────────────

/**
 * 讀設定檔。
 *
 * - 檔案**唔存在** → 回預設（未存過檔係正常狀態）
 * - JSON 壞 → **throw**
 * - 欄位唔合法 → **throw**（唔准靜默當 0、唔准靜默回預設）
 * - 其他 I/O 錯誤（權限、目錄）→ **throw**（一樣唔可以當冇事）
 *
 * @param {{filePath?:string}} [options]
 * @returns {{layout:{x:number[],y:number[],offset:{dx:number,dy:number},size:{w:number,h:number}},
 *            display:Record<string,boolean>}}
 */
export function loadConfig({ filePath } = {}) {
  const path = filePath ?? defaultConfigPath();

  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return defaultHudConfig();
    throw new Error(`讀唔到 HUD 設定檔「${path}」：${err?.message ?? err}`);
  }

  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`HUD 設定檔「${path}」唔係合法 JSON：${err?.message ?? err}`);
  }

  try {
    return validateConfig(raw);
  } catch (err) {
    throw new Error(`HUD 設定檔「${path}」欄位唔合法：${err?.message ?? err}`);
  }
}

/**
 * 寫設定檔（UTF-8 JSON，2 空格縮排 ＋ 尾隨換行）。
 *
 * ⚠️ **寫之前一定 validate**：寧願寫唔到（throw），都唔可以寫一個壞檔落去 ——
 * 壞檔會令下次開程式**越讀越亂**，而且用戶睇唔出係邊一步寫壞。
 *
 * @param {unknown} config 想寫嘅設定（會被 validate ＋ 正規化）
 * @param {{filePath?:string}} [options]
 * @returns {string} 實際寫入嘅路徑（畀呼叫者 log 用）
 */
export function saveConfig(config, { filePath } = {}) {
  const path = filePath ?? defaultConfigPath();
  const normalized = validateConfig(config); // 先 validate，後寫檔（順序唔可以掉亂）
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return path;
}

// ─────────────────────────── 合併（env > 檔案 > 預設）───────────────────────────

/**
 * 合併三者：**環境變數 > config 檔 > 預設**。
 *
 * 純函數、唔做 I/O（`fileConfig` 係已經由 `loadConfig()` 讀好嘅 object；
 * 要一次過攞就用 `resolveHudConfig(process.env, loadConfig({ filePath }))`）。
 *
 * 實作上**重用** `layout.js`：
 *   - 解析：`layoutFromEnv(env)`（唔合法會 throw）
 *   - 變數名：`HUD_ENV_KEYS`（唔會同 `layout.js` 走樣）
 * 而「用戶有冇 set 呢個 env」係逐個欄位查（set 咗就算同預設一樣都要蓋過檔案 ——
 * 用「同預設比較」嘅做法會錯，因為 env 打嘅數啱啱好等於預設值嗰陣會當成冇 set）。
 *
 * ⚠️ 合併之後會再 `validateConfig()` 一次：`layoutFromEnv()` 只查「係唔係數字」，
 * 唔查範圍（歷史行為，唔改），但**交出去嘅設定一定要合法** ——
 * 所以 `UMAPYOI_HUD_X=0.9,0.5`（前後倒轉）或者 `_W=0` 會喺呢度 throw，
 * 而唔係靜默擺去一個唔可能嘅位置。
 *
 * ⚠️ **同一條規則亦適用於不變式**（刻意，見 `validateLayout()`）：
 * `UMAPYOI_HUD_X=0.1,0.5` 加 `UMAPYOI_HUD_W=0.2` 係一對矛盾嘅值
 * → 一樣 throw（訊息講明「應該係 0.1 + 0.2 = 0.3，而家係 0.5」）。
 * 呢個係好事：以前會靜默用 `W` 做實際大細（0.2 × 1920 = 384px）而 `x[1]` 講 0.5，
 * 用戶以為擺喺 0.1–0.5 但其實闊度得 0.2 —— 冇人睇得出。
 * 想調 x 範圍又唔想理大細：**只** set `X`（`x[1] − x[0]` 自動做大細），唔好同時 set `W`。
 *
 * @param {Record<string,string|undefined>} [env]
 * @param {object|null} [fileConfig] `loadConfig()` 嘅結果（null／undefined = 冇檔案）
 * @returns {{layout:{x:number[],y:number[],offset:{dx:number,dy:number},size:{w:number,h:number}},
 *            display:Record<string,boolean>}}
 */
export function resolveHudConfig(env = {}, fileConfig = null) {
  const e = env ?? {};
  const file = fileConfig == null ? null : validateConfig(fileConfig); // 檔案自己一定要合法
  const fromEnv = layoutFromEnv(e);

  const set = (name) => {
    const raw = e[name];
    return raw !== undefined && raw !== null && String(raw) !== '';
  };
  const envX = set(HUD_ENV_KEYS.x);
  const envY = set(HUD_ENV_KEYS.y);
  const envW = set(HUD_ENV_KEYS.w);
  const envH = set(HUD_ENV_KEYS.h);

  const base = file ?? defaultHudConfig();
  const defaults = defaultHudConfig().layout;

  /**
   * 逐個軸合成，**唔准混來源**。
   *
   * ⚠️ 為何要咁講究：`x[1]` 同 `size.w` 係同一個數（不變式），所以「範圍同大細
   * 嚟自唔同來源」係一個矛盾。舊做法係逐欄位套 env，於是
   * `UMAPYOI_HUD_X=0.9,1.0`（env 講範圍）＋ 檔案寫 `size.w = 0.212`
   * 就會砌出 `x[1] = 1.0` 但 `size.w = 0.212` —— 自相矛盾，而舊 `validateConfig()`
   * 唔守呢條不變式所以一直冇人發現（HUD 靜默擺錯大細）。
   *
   * 四種情況（逐個軸獨立判斷）：
   *   ① env 講咗範圍 → 範圍用 env；大細由範圍推（env 自己都講咗大細 → 留畀 validate 對帳）
   *   ② env 只講大細 → 起點跟檔案／預設（**位置唔變**），末端由 `起點 + env 大細` 推
   *   ③ env 兩樣都冇講 → 整個軸用檔案（檔案嘅範圍同大細係一對，唔可以拆開）
   *   ④ 連檔案都冇寫呢個軸 → 用預設（預設本身一定一致）
   */
  const resolveAxis = ({ baseSpan, baseSize, envSpan, envSize, defSpan, defSize }) => {
    if (envSpan) {
      const size = envSize ?? (envSpan[1] - envSpan[0]);
      return { span: [...envSpan], size };
    }
    if (envSize !== undefined) {
      const anchor = (baseSpan ?? defSpan)[0];
      return { span: [anchor, anchor + envSize], size: envSize };
    }
    if (baseSpan && baseSize !== undefined) return { span: [...baseSpan], size: baseSize };
    return { span: [...defSpan], size: defSize };
  };

  const ax = resolveAxis({
    baseSpan: file?.layout.x, baseSize: file?.layout.size.w,
    envSpan: envX ? fromEnv.x : null, envSize: envW ? fromEnv.size.w : undefined,
    defSpan: defaults.x, defSize: defaults.size.w,
  });
  const ay = resolveAxis({
    baseSpan: file?.layout.y, baseSize: file?.layout.size.h,
    envSpan: envY ? fromEnv.y : null, envSize: envH ? fromEnv.size.h : undefined,
    defSpan: defaults.y, defSize: defaults.size.h,
  });

  const layout = {
    x: ax.span,
    y: ay.span,
    offset: {
      dx: set(HUD_ENV_KEYS.dx) ? fromEnv.offset.dx : base.layout.offset.dx,
      dy: set(HUD_ENV_KEYS.dy) ? fromEnv.offset.dy : base.layout.offset.dy,
    },
    size: { w: ax.size, h: ay.size },
  };

  // ⚠️ 最後一定要經 validateLayout（連不變式一齊守）：如果同一個來源入面
  // 兩邊都寫死而又矛盾（例如 `UMAPYOI_HUD_X=0.1,0.5` 加 `_W=0.2`，
  // 或者手寫檔案寫 `x[1]` 同 `size.w` 打架）→ 喺呢度大聲 throw，唔會靜默揀一個。
  //
  // `fromSource` 逐欄講明「呢一欄係寫死嘅」而**唔係**「合併之後有值」：
  //   - env 有 set → 寫死
  //   - 檔案有**寫明呢一欄** → 寫死；檔案冇寫（用咗預設）而 env 又冇 set → 唔算
  //     （呢個 case 嘅值係預設，攞嚟對帳就會砌出假矛盾 —— 例如檔案只寫
  //      `x[1]` 而同一個檔嘅 `size.w` 對唔上：`validateConfig(fileConfig)` 早就 throw 咗，
  //      行到嚟呢度嘅檔案一定自成一對。所以「同源」嘅軸唔會誤報。）
  // `fromSource` 亦決定「邊個係寫死嘅 source of truth」：只有一邊寫死 →
  // 另一邊由寫死嗰邊推（見 `resolveAxis()` 同 `validateLayout()`）。
  return validateConfig({ layout, display: base.display }, {
    x: envX || Boolean(file?.layout.x),
    y: envY || Boolean(file?.layout.y),
    w: envW || Boolean(file?.layout.size.w),
    h: envH || Boolean(file?.layout.size.h),
  });
}

// ─────────────────────────── 小工具 ───────────────────────────

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function onlyKeys(where, obj, allowed) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      throw new Error(`${where} 唔認識「${key}」（只可以有 ${allowed.join('／')}）`);
    }
  }
}

/** 一定要係**有限數字**：字串（即使係 `"0.3"`）都唔收，免得靜默 coerce 出錯數。 */
function numAt(where, raw) {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new Error(`${where} 要係有限數字，實得 ${describe(raw)}`);
  }
  return raw;
}

function describe(v) {
  if (typeof v === 'string') return `「${v}」`;
  if (v === undefined) return 'undefined';
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function deepFreeze(obj) {
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') deepFreeze(v);
  }
  return Object.freeze(obj);
}
