/**
 * 啟動期資源嘅**讀取 ＋ 錯誤政策**（純函數；設計審查 2026-09-28 M6）。
 *
 * ## 為何要呢個檔
 *
 * 同一類「啟動資源唔妥」以前有**三種完全唔同嘅下場**（實查 `electron/main.js`）：
 *
 * | 情況 | 舊行為 | 後果 |
 * |---|---|---|
 * | 字形模板**唔見** | `console.error` 一句之後**照開**，每幀 `if (!templatesReady()) return;` 靜默早退 | ⭐ **靜默僵屍**：用戶見到程式開到，但 HUD 永遠「等待面板條」——最難查 |
 * | 模板 JSON **壞** | module scope `JSON.parse` throw | import 期爆；打包版係 GUI，連 stack 都睇唔到 |
 * | HUD 設定唔合法 | catch ＋ 清楚訊息 ＋ `app.exit(1)` | ✅ 呢個先係正確政策 |
 *
 * 政策統一為：**讀資源唔會 throw**（回一個 `error` 物件）→ 由 `main.js` 嘅
 * `fatalStartup()` 大聲 log（會入 log 檔）＋ 出系統錯誤對話（打包版用戶真係睇得到）
 * ＋ `app.exit(1)`（唔留低冇窗嘅僵屍程序）。
 *
 * ⚠️ 呢度**只做純邏輯**（I/O 由呼叫方用 `exists`／`readText` 注入）→ 可以 `node --test`
 *    驗到「唔見／讀唔到／壞 JSON／結構唔對」四種失敗同埋「部分缺字要警告而唔係當冇事」。
 *
 * ## 反證（為何唔可以「唔見就當冇事繼續開」）
 *
 * 有人會話「模板唔見都可以開，只係讀唔到數」→ 但實測 `templatesReady()` 係所有 reader
 * （`statbar.js`／`reader.js`／`resultpanel.js`）嘅**共同前置條件**：冇模板 = 一個數都讀唔到，
 * 而畫面只會顯示「等待面板條」→ 用戶完全查唔到係模板問題。**唯一好嘅失敗係大聲嘅失敗**。
 */

/** 啟動期致命錯誤嘅 exit code（同 `main.js` 舊有嘅設定錯誤路徑一致）。 */
export const STARTUP_EXIT_CODE = 1;

/** 字形模板要有嘅字元（實測 `data/glyph-templates.json` 嘅 `templates` 有齊 10 個）。 */
export const GLYPH_DIGITS = '0123456789';

/**
 * 讀一個**啟動一定要有**嘅 JSON 檔 —— **唔會 throw**（設計審查 M6）。
 *
 * @param {object} options
 * @param {string} options.path 檔案絕對路徑（訊息會照印，方便用戶直接去搵）
 * @param {string} options.hint 出事嗰陣叫用戶做咩（例：`跑 node tools/build-glyph-templates.js`）
 * @param {(p:string)=>boolean} options.exists
 * @param {(p:string)=>string} options.readText
 * @param {(t:string)=>any} [options.parse] 預設 `JSON.parse`
 * @returns {{ok:true, value:any}|{ok:false, error:{code:string,path:string,message:string,hint:string}}}
 */
export function loadRequiredJson({ path, hint, exists, readText, parse = JSON.parse }) {
  let present;
  try {
    present = exists(path);
  } catch (error) {
    // ⚠️ 連「檢查存在」都爆（權限／壞 symlink／UNC 路徑）都要當資源問題處理 ——
    //    呢個模組嘅契約係**唔會 throw**：一個用嚟報告錯誤嘅函數自己爆，
    //    就等於返去舊行為（GUI 版連 stack 都睇唔到）。
    return failure('unreadable', path, `檢查唔到 ${path} 存唔存在：${error?.message ?? error}`, hint);
  }
  if (!present) {
    return failure('missing', path, `搵唔到 ${path}`, hint);
  }
  let text;
  try {
    text = readText(path);
  } catch (error) {
    return failure('unreadable', path, `讀唔到 ${path}：${error?.message ?? error}`, hint);
  }
  try {
    return { ok: true, value: parse(text) };
  } catch (error) {
    return failure(
      'invalid',
      path,
      `${path} 唔係合法 JSON（${error?.message ?? error}）—— 檔案壞咗，唔可以當冇事繼續開`,
      hint,
    );
  }
}

/**
 * 檢查字形模板 JSON 嘅**結構**（唔會 throw）。
 *
 * 判定（全部有實測根據）：
 * - 冇 `templates` 物件／空 → **致命**（呢個檔根本唔似模板；繼續開 = 靜默僵屍）。
 * - 有模板但**缺字元** → **唔致命，但一定要警告**（實測正式檔有齊 `0`–`9`：
 *   缺字元只會令含嗰個字元嘅數值讀唔到，唔會讀錯 —— 所以唔應該為咗「唔完美」而唔開程式；
 *   但亦**唔准靜默**，因為用戶會見到「有時讀到有時讀唔到」而查唔到原因）。
 *
 * @param {any} json `data/glyph-templates.json` 嘅內容
 * @param {{path?:string, digits?:string}} [options]
 * @returns {{ok:true, value:object, warning?:string}|{ok:false, error:{code:string,path:string,message:string,hint:string}}}
 */
export function checkGlyphTemplates(json, { path = 'data/glyph-templates.json', digits = GLYPH_DIGITS } = {}) {
  const hint = '跑 `node tools/build-glyph-templates.js` 重新產生字形模板';
  const raw = json?.templates;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return failure('no-templates', path, `${path} 裏面冇 \`templates\` 物件 → 呢個檔唔似字形模板`, hint);
  }
  const keys = Object.keys(raw);
  if (keys.length === 0) {
    return failure('empty-templates', path, `${path} 嘅 \`templates\` 係空嘅（0 個字形）`, hint);
  }
  const missing = [...digits].filter((d) => !keys.includes(d));
  if (missing.length) {
    return {
      ok: true,
      value: raw,
      warning:
        `⚠️ 字形模板缺少 ${missing.join('')}（得 ${keys.sort().join('')}）` +
        ' → 含嗰啲字元嘅數值會**讀唔到**（唔會讀錯）。' +
        '如非刻意，請跑 `node tools/build-glyph-templates.js` 重建。',
    };
  }
  return { ok: true, value: raw };
}

/**
 * 砌「啟動失敗」要畀用戶睇嘅文字（對話框 ＋ log 用**同一份**，唔會兩邊講唔同嘅嘢）。
 *
 * @param {{error:{message:string,hint:string}, logPath?:string|null}} options
 * @returns {{title:string, detail:string}}
 */
export function startupFailureReport({ error, logPath = null }) {
  const lines = [error.message, '', `→ ${error.hint}`, '', `log 檔：${logPath ?? '（今次未開到 log 檔）'}`];
  return { title: 'Umapyoi 開唔到', detail: lines.join('\n') };
}

/** 砌一個失敗結果（內部用；`code` 只係分類，訊息一定含實際路徑）。 */
function failure(code, path, message, hint) {
  return { ok: false, error: { code, path, message, hint } };
}
