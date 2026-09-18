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
 * 同埋**唔認識嘅 key**（打錯字要出聲）。
 *
 * @param {unknown} obj 由 JSON 讀返嚟或者呼叫者砌出嚟嘅設定
 * @returns {{layout:{x:number[],y:number[],offset:{dx:number,dy:number},size:{w:number,h:number}},
 *            display:Record<string,boolean>}}
 */
export function validateConfig(obj) {
  if (!isPlainObject(obj)) throw new Error(`HUD 設定要係一個物件，實得 ${describe(obj)}`);
  onlyKeys('HUD 設定', obj, ['layout', 'display']);
  return {
    layout: obj.layout === undefined ? defaultHudConfig().layout : validateLayout(obj.layout),
    display: obj.display === undefined ? { ...DEFAULT_HUD_DISPLAY } : validateDisplay(obj.display),
  };
}

function validateLayout(raw) {
  if (!isPlainObject(raw)) throw new Error(`HUD 設定 layout 要係物件，實得 ${describe(raw)}`);
  onlyKeys('HUD 設定 layout', raw, ['x', 'y', 'offset', 'size']);
  const base = defaultHudConfig().layout;
  return {
    x: raw.x === undefined ? base.x : validateSpan('layout.x', raw.x),
    y: raw.y === undefined ? base.y : validateSpan('layout.y', raw.y),
    offset: raw.offset === undefined ? base.offset : validateOffset(raw.offset),
    size: raw.size === undefined ? base.size : validateSize(raw.size),
  };
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
 * @param {Record<string,string|undefined>} [env]
 * @param {object|null} [fileConfig] `loadConfig()` 嘅結果（null／undefined = 冇檔案）
 * @returns {{layout:{x:number[],y:number[],offset:{dx:number,dy:number},size:{w:number,h:number}},
 *            display:Record<string,boolean>}}
 */
export function resolveHudConfig(env = {}, fileConfig = null) {
  const e = env ?? {};
  const base = fileConfig == null ? defaultHudConfig() : validateConfig(fileConfig);
  const fromEnv = layoutFromEnv(e);

  const layout = {
    x: [...base.layout.x],
    y: [...base.layout.y],
    offset: { ...base.layout.offset },
    size: { ...base.layout.size },
  };
  const set = (name) => {
    const raw = e[name];
    return raw !== undefined && raw !== null && String(raw) !== '';
  };

  if (set(HUD_ENV_KEYS.x)) layout.x = [...fromEnv.x];
  if (set(HUD_ENV_KEYS.y)) layout.y = [...fromEnv.y];
  if (set(HUD_ENV_KEYS.dx)) layout.offset.dx = fromEnv.offset.dx;
  if (set(HUD_ENV_KEYS.dy)) layout.offset.dy = fromEnv.offset.dy;
  if (set(HUD_ENV_KEYS.w)) layout.size.w = fromEnv.size.w;
  if (set(HUD_ENV_KEYS.h)) layout.size.h = fromEnv.size.h;

  return validateConfig({ layout, display: base.display });
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
