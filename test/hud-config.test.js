/**
 * HUD 設定存檔層（`src/hud/config.js`）嘅單元測試。
 *
 * 為何要測：位置存錯／數值被靜默當 0，係「用戶自己調好嘅位」一夜之間走樣嘅成因，
 * 而且實機睇唔出係邊一步寫壞 → 全部規則（預設重用、throw、優先次序、round-trip）用測試守住。
 *
 * ⚠️ 測試一律用 `os.tmpdir()` 嘅臨時目錄，唔會寫到專案目錄（唔會整污糟 repo）。
 */

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_HUD_CONFIG,
  DEFAULT_HUD_DISPLAY,
  HUD_CONFIG_FILENAME,
  HUD_DISPLAY_KEYS,
  defaultConfigPath,
  defaultHudConfig,
  loadConfig,
  resolveHudConfig,
  saveConfig,
  validateConfig,
} from '../src/hud/config.js';
import {
  DEFAULT_HUD_LAYOUT,
  DEFAULT_HUD_OFFSET,
  DEFAULT_HUD_SIZE,
  anchorHud,
  layoutFromEnv,
} from '../src/hud/layout.js';

const root = mkdtempSync(join(tmpdir(), 'umapyoi-hud-config-'));
after(() => rmSync(root, { recursive: true, force: true }));

/** 每次攞一個未用過嘅檔案路徑（避免測試互相影響）。 */
let seq = 0;
const freshPath = (name) => join(root, `${++seq}-${name}`);
const writeRaw = (path, text) => writeFileSync(path, text, 'utf8');

/**
 * 行一次會出警告嘅呼叫，**收集**警告（唔靠 intercept `console`）。
 *
 * 為何要（唔可以只用「唔 throw」斷言）：`size` 為準之後，「寫死嘅 `x[1]` 同推導值唔一致」
 * 係**警告**而唔係錯誤 —— 如果冇呢個收集器，測試只證明到「唔死」，證明唔到
 * 「用戶真係會見到警告」（警告鏈路：`validateConfig(onWarn)` → `resolveHudConfig(onWarn)`
 * → `main.js` `console.warn('[設定] ⚠️ …')`）。
 *
 * 用法：`collectWarnings((opts) => validateConfig(body, opts))`
 * 或者 `collectWarnings((opts) => resolveHudConfig(env, file, opts))`。
 */
function collectWarnings(fn) {
  const warnings = [];
  const opts = { onWarn: (message) => warnings.push(message) };
  const out = fn(opts);
  return { warnings, out };
}

// ───────────────────────── 預設 ─────────────────────────

test('hud-config 預設：位置／大細全部重用 layout.js 嘅預設（唔可以自己打一次數字）', () => {
  assert.deepEqual(DEFAULT_HUD_CONFIG.layout.x, [...DEFAULT_HUD_LAYOUT.x]);
  assert.deepEqual(DEFAULT_HUD_CONFIG.layout.y, [...DEFAULT_HUD_LAYOUT.y]);
  assert.deepEqual(DEFAULT_HUD_CONFIG.layout.offset, { ...DEFAULT_HUD_OFFSET });
  assert.deepEqual(DEFAULT_HUD_CONFIG.layout.size, { ...DEFAULT_HUD_SIZE });
  // 同 layoutFromEnv({}) 完全同形 → 可以直接餵 anchorHud／hudState
  assert.deepEqual(DEFAULT_HUD_CONFIG.layout, layoutFromEnv({}));
});

test('hud-config 預設顯示選項：涵蓋 HUD 現有每一項（總分／逐格／五維分／技能分／金色格／note／edit）', () => {
  for (const key of ['total', 'stats', 'statScore', 'skillScore', 'goldMark', 'note', 'edit']) {
    assert.equal(DEFAULT_HUD_CONFIG.display[key], true, `${key} 要預設開（＝同今日 HUD 一樣）`);
  }
  // 唔可以有多／少 key（形狀要同 HUD 顯示項目一致）
  assert.deepEqual(Object.keys(DEFAULT_HUD_CONFIG.display).sort(), [...HUD_DISPLAY_KEYS].sort());
  assert.deepEqual(DEFAULT_HUD_CONFIG.display, { ...DEFAULT_HUD_DISPLAY });
});

test('hud-config 預設：改 defaultHudConfig() 出嚟嘅副本唔會污染常數', () => {
  const a = defaultHudConfig();
  a.layout.x[0] = 0.999;
  a.layout.size.w = 0.999;
  a.display.total = false;
  assert.deepEqual(DEFAULT_HUD_CONFIG.layout.x, [...DEFAULT_HUD_LAYOUT.x], '常數唔可以俾人改到');
  assert.equal(DEFAULT_HUD_CONFIG.display.total, true);
  assert.equal(defaultConfigPath('D').endsWith(HUD_CONFIG_FILENAME), true);
  assert.equal(HUD_CONFIG_FILENAME, 'hud-position.json');
});

// ───────────────────────── loadConfig ─────────────────────────

test('hud-config loadConfig：檔案唔存在 → 回預設（未存過檔係正常狀態）', () => {
  const path = freshPath('nope.json');
  assert.equal(existsSync(path), false);
  assert.deepEqual(loadConfig({ filePath: path }), defaultHudConfig());
});

test('hud-config loadConfig：壞 JSON → throw（唔准靜默回預設）', () => {
  const broken = freshPath('broken.json');
  writeRaw(broken, '{ "layout": { "x": [0.1, 0.2] '); // 少咗結尾
  assert.throws(() => loadConfig({ filePath: broken }), /唔係合法 JSON/);

  const empty = freshPath('empty.json');
  writeRaw(empty, '');
  assert.throws(() => loadConfig({ filePath: empty }), /唔係合法 JSON/);
});

test('hud-config loadConfig：欄位唔合法 → throw（唔准當 0、唔准回預設）', () => {
  const cases = [
    ['x 前後倒轉', { layout: { x: [0.9, 0.1] } }, /layout\.x/],
    ['y 前後一樣', { layout: { y: [0.5, 0.5] } }, /layout\.y/],
    ['x 超出 0–1', { layout: { x: [-0.1, 0.2] } }, /0–1/],
    ['x 唔夠兩個', { layout: { x: [0.1] } }, /兩個數字/],
    ['x 係字串（唔准靜默 coerce）', { layout: { x: ['0.1', 0.2] } }, /有限數字/],
    ['x 係 NaN', { layout: { x: [null, 0.2] } }, /有限數字/],
    ['size 0', { layout: { size: { w: 0, h: 0.2 } } }, /layout\.size\.w/],
    ['offset 太離譜', { layout: { offset: { dx: 5 } } }, /layout\.offset\.dx/],
    ['頂層打錯字（dispaly）', { dispaly: { total: false } }, /唔認識「dispaly」/],
    ['layout 打錯字（siz）', { layout: { siz: { w: 0.2, h: 0.2 } } }, /唔認識「siz」/],
    ['display 值唔係 boolean', { display: { total: 'yes' } }, /display\.total/],
    ['display 打錯字', { display: { skillScores: true } }, /唔認識「skillScores」/],
    ['layout 唔係物件', { layout: [0.1, 0.2] }, /layout 要係物件/],
    ['頂層係陣列', [1, 2], /要係一個物件/],
    ['頂層係 null', null, /要係一個物件/],
  ];
  for (const [name, body, re] of cases) {
    const path = freshPath('bad.json');
    writeRaw(path, JSON.stringify(body));
    assert.throws(() => loadConfig({ filePath: path }), re, `應該 throw：${name}`);
  }
});

test('hud-config loadConfig：分節／欄位可以只寫一部分，其餘補預設（唔算唔合法）', () => {
  const path = freshPath('partial.json');
  writeRaw(path, JSON.stringify({ layout: { x: [0.1, 0.2] }, display: { total: false } }));
  const cfg = loadConfig({ filePath: path });
  assert.deepEqual(cfg.layout.x, [0.1, 0.2]);
  // ⚠️ 冇寫嘅欄位補預設範圍嘅**起點**（`y[0] = 0.03`），末端由預設大細推 →
  //    `0.03 + 0.255 = 0.28500000000000003`（IEEE754）。所以唔可以用 `deepEqual`，
  //    要逐個數字喺 1e-9 之內（同 `assertSameLayout` 一條規則）。
  assert.equal(cfg.layout.y[0], DEFAULT_HUD_LAYOUT.y[0], '冇寫嘅軸起點補預設');
  assert.ok(Math.abs(cfg.layout.y[1] - (DEFAULT_HUD_LAYOUT.y[0] + DEFAULT_HUD_SIZE.h)) <= 1e-9,
    `冇寫嘅軸末端 ＝ 起點 + 預設大細，實得 ${cfg.layout.y[1]}`);
  // ⚠️ 淨係寫咗 `x` → 大細由範圍推（見 validateConfig 規則表：用戶冇寫 `size` 就唔算意圖，
  //    唔可以攞預設 0.212 去砌出 x[1] = 0.312）。y 冇寫 → 用預設大細。
  assert.deepEqual(cfg.layout.size, { w: 0.1, h: DEFAULT_HUD_SIZE.h }, '只寫範圍 → 大細由範圍推');
  assert.equal(cfg.display.total, false);
  assert.equal(cfg.display.skillScore, true, '冇寫嘅顯示項照預設開');
  assert.deepEqual(Object.keys(cfg.layout).sort(), ['offset', 'size', 'x', 'y'], '回嘅係完整形狀');
});

// ───────────────────────── validateConfig ─────────────────────────

test('hud-config validateConfig：回正規化新 object，唔會改到入嗰個', () => {
  const input = { layout: { x: [0.2, 0.4], offset: { dx: -0.01 } }, display: { stats: false } };
  const out = validateConfig(input);
  assert.deepEqual(out.layout.x, [0.2, 0.4]);
  assert.equal(out.layout.offset.dx, -0.01);
  assert.equal(out.layout.offset.dy, 0, '冇寫嘅補預設');
  assert.equal(out.display.stats, false);
  assert.equal(out.display.total, true);
  input.layout.x[0] = 0.9;
  input.display.stats = true;
  assert.deepEqual(out.layout.x, [0.2, 0.4], '回嘅係新 object（唔係 alias）');
  assert.equal(out.display.stats, false);
  // 空 object（＝乜都冇寫）一樣合法 → 等於預設
  assert.deepEqual(validateConfig({}), defaultHudConfig());
});

// ───────── 不變式 x[1] = x[0] + size.w（⚠️ 呢條係「HUD 靜默走出畫面」嘅閘）─────────
//
// 為何要喺 validateConfig 呢一層測：設定窗／拖位路徑有 `clampLayout()` 夾住呢條不變式，
// 但**手寫 `hud-position.json` 唔會經 clampLayout()**。實測（獨立審計）：
// `validateConfig({ layout: { x: [0.9, 1.0], size: { w: 0.5, h: 0.2 } } })` 以前照過
// → `anchorHud()` 用 `size.w` 做實際大細 → 右邊界 0.9 + 0.5 = 1.4 × 1920 = 2688 > 1920
// → **HUD 靜默走出畫面**（唔會有任何錯誤訊息）。

test('hud-config 不變式：一致嘅佈局一定過（預設／檔案範例／浮點邊界都要照過）', () => {
  const consistent = [
    ['預設（0.598 + 0.212 = 0.81）', { layout: defaultHudConfig().layout }],
    ['檔案範例（0.598 + 0.212、0.03 + 0.255）', {
      layout: { x: [0.598, 0.81], y: [0.03, 0.285], offset: { dx: 0, dy: 0 }, size: { w: 0.212, h: 0.255 } },
    }],
    ['整數（0.125 + 0.375 = 0.5）', { layout: { x: [0.125, 0.5], y: [0.25, 1], size: { w: 0.375, h: 0.75 } } }],
    ['貼邊（0 + 1 = 1）', { layout: { x: [0, 1], y: [0, 1], size: { w: 1, h: 1 } } }],
  ];
  for (const [name, body] of consistent) {
    const out = validateConfig(body);
    // ⚠️ 唔可以用 `assert.equal`：0.598 + 0.212 喺 IEEE754 之下係 0.8099999999999999，
    //    而檔案寫嘅係 0.81 —— 呢個 1.1e-16 嘅差就係「容差」存在嘅唯一理由。
    assert.ok(
      Math.abs(out.layout.x[1] - (out.layout.x[0] + out.layout.size.w)) <= 1e-9,
      `${name}：x[1] 要等於 x[0] + size.w`,
    );
    assert.ok(
      Math.abs(out.layout.y[1] - (out.layout.y[0] + out.layout.size.h)) <= 1e-9,
      `${name}：y[1] 要等於 y[0] + size.h`,
    );
  }
});

test('hud-config 不變式：真嘅唔合法（推導出嚟嘅右邊界 > 1）就 throw，訊息要提「右邊界」同兩個數', () => {
  // ⭐ 呢個就係審計實測嗰個個案：以前照過 → HUD 靜默走出畫面（0.9 + 0.5 = 1.4 × 1920 = 2688）
  //    ⚠️ 而家嘅語意係「**size 為準**、x[1] 由 x[0] + size.w 推」→ 所以唔可以再 throw 講
  //    「x[1] 同 size.w 唔一致」；throw 嘅理由係**推導出嚟嘅右邊界** 0.9 + 0.5 = 1.4 > 1。
  //    即係：原本要捉嘅缺陷照樣捉到，但原因講得更準（用戶照住改得到）。
  assert.throws(
    () => validateConfig({ layout: { x: [0.9, 1.0], size: { w: 0.5, h: 0.2 } } }),
    /右邊界/,
  );
  const err = (() => {
    try {
      validateConfig({ layout: { x: [0.9, 1.0], size: { w: 0.5, h: 0.2 } } });
      return null;
    } catch (e) { return e; }
  })();
  for (const piece of ['右邊界', '0.9', '0.5', '1.4', 'layout.size.w']) {
    assert.ok(err.message.includes(piece), `訊息要包住「${piece}」：${err.message}`);
  }

  // x[1] 太大（0.4 + 0.5 = 0.9 ≤ 1 → 合法，唔應該 throw）／x[1] 太小（0.1 + 0.5 = 0.6 ≤ 1 → 合法）
  // ⚠️ 呢兩條以前係「throw」，而家係「警告 ＋ 以 size 為準」—— 下面單獨測試守住警告。
  for (const [span, w] of [[[0.4, 0.9], 0.1], [[0.1, 0.2], 0.5]]) {
    const { warnings, out } = collectWarnings((opts) => validateConfig({
      layout: { x: span, size: { w, h: 0.2 } },
    }, opts));
    assert.equal(warnings.length, 1, `唔一致就要有警告：${JSON.stringify(span)} ＋ w=${w}`);
    assert.equal(out.layout.x[1], out.layout.x[0] + out.layout.size.w, 'x[1] 一定要由 size 推');
  }
  // y 一樣要守（x 用預設：0.598 + 0.212 ≈ 0.81 ✓ 自己一致 → throw 一定係講 y）
  assert.throws(
    () => validateConfig({ layout: { y: [0.6, 0.95], size: { w: 0.212, h: 0.5 } } }),
    /右邊界 layout\.y\[0\] \+ layout\.size\.h/,
  );
  // 連檔案都要擋得住（`loadConfig` 係使用者真係會行到嘅路徑）
  const path = freshPath('illegal-range.json');
  writeRaw(path, JSON.stringify({ layout: { x: [0.9, 1.0], size: { w: 0.5, h: 0.2 } } }));
  assert.throws(() => loadConfig({ filePath: path }), /欄位唔合法.*右邊界/s);
  // 同 `resolveHudConfig` 一樣唔准靜默（main.js 會 catch 佢、大聲講、然後 app.exit(1)）
  assert.throws(
    () => resolveHudConfig({}, { layout: { x: [0.9, 1.0], size: { w: 0.5, h: 0.2 } } }),
    /右邊界/,
  );
});

test('hud-config ⭐ 回歸：AGENTS §2 嗰六行環境變數一齊用**唔准 throw**（以前 app.exit(1) 開唔到程式）', () => {
  // ⭐⭐ 呢條係本次最重要嘅回歸測試（獨立審計實測嘅個案）。
  //    守住：**照抄 AGENTS.md §2 嘅環境變數就會完全開唔到程式**（`_X=0.01,0.20` ＋ `_W=0.30`
  //    → 0.01 + 0.30 = 0.31 ≠ 寫死嘅 0.20 → 舊版當「矛盾」→ throw → main.js catch → app.exit(1)）。
  //
  //    新語意（用戶決定）：**`size` 為準**，`x[1] = x[0] + size.w` 由推導得出；
  //    寫死嘅 `x[1]` 同推導值唔一致 → **大聲警告**（唔 throw）。理由：`anchorHud()`
  //    只用 `x[0]` 定位、用 `size` 決定大細，`x[1]` **根本唔影響渲染**。
  const env = {
    UMAPYOI_HUD_X: '0.01,0.20',
    UMAPYOI_HUD_Y: '0.70,0.95',
    UMAPYOI_HUD_W: '0.30',
    UMAPYOI_HUD_H: '0.24',
    UMAPYOI_HUD_DX: '-0.005',
    UMAPYOI_HUD_DY: '-0.67',
  };
  const { warnings, out: cfg } = collectWarnings((opts) => resolveHudConfig(env, null, opts));

  // ① 唔 throw（上面行得到就係證明）＋ 實測值
  assert.deepEqual(cfg.layout.x, [0.01, 0.31], 'x ＝ 左邊界 0.01 ＋ 大細 0.30（以 size 為準）');
  assert.deepEqual(cfg.layout.y, [0.70, 0.94], 'y ＝ 上邊界 0.70 ＋ 大細 0.24');
  assert.deepEqual(cfg.layout.size, { w: 0.30, h: 0.24 });
  assert.equal(cfg.layout.offset.dx, -0.005);
  assert.equal(cfg.layout.offset.dy, -0.67);

  // ② 大聲警告（唔准靜默）＋ 警告要講得出兩個值（寫死嘅 vs 推導出嚟嘅）
  assert.equal(warnings.length, 2, `兩個軸各一個警告，實得 ${warnings.length} 個：${warnings.join('｜')}`);
  const wx = warnings.find((w) => w.includes('layout.x[1]'));
  const wy = warnings.find((w) => w.includes('layout.y[1]'));
  assert.ok(wx, `x 軸警告要講 layout.x[1]：${warnings.join('｜')}`);
  assert.ok(wy, `y 軸警告要講 layout.y[1]：${warnings.join('｜')}`);
  for (const piece of ['0.2', '0.01', '0.3', '0.31']) {
    assert.ok(wx.includes(piece), `x 警告要包住「${piece}」：${wx}`);
  }
  for (const piece of ['0.95', '0.7', '0.24', '0.94']) {
    assert.ok(wy.includes(piece), `y 警告要包住「${piece}」：${wy}`);
  }

  // ③ 幾何綁得住：HUD 唔會走出內容區（＝真正要防嗰樣）
  const content = { x: 0, y: 0, width: 1920, height: 1080 };
  const box = anchorHud(content, cfg.layout);
  assert.ok(box.x + box.width <= 1920, `右邊界要喺內容區內：${box.x} + ${box.width}`);
  assert.ok(box.y + box.height <= 1080, `下邊界要喺內容區內：${box.y} + ${box.height}`);
});

test('hud-config 不變式：env 寫死矛盾嘅組合 → **警告**（唔 throw）；但推導出嚟嘅範圍唔合法 → 一定 throw', () => {
  const content = { x: 0, y: 0, width: 1920, height: 1080 };

  // ① env 只改範圍 → 大細跟範圍推（唔會攞檔案／預設嘅大細砌出矛盾）
  const onlyX = resolveHudConfig({ UMAPYOI_HUD_X: '0.1,0.3' }, null);
  assert.deepEqual(onlyX.layout.x, [0.1, 0.3]);
  assert.ok(Math.abs(onlyX.layout.size.w - 0.2) <= 1e-9, `env 只講範圍 → 大細由範圍推：${onlyX.layout.size.w}`);
  assert.ok(
    anchorHud(content, onlyX.layout).x + anchorHud(content, onlyX.layout).width <= 1920,
    '右邊界唔可以走出內容區',
  );

  // ② env 只改大細 → 範圍由 x0 ＋ 新大細推（x0 本身跟檔案／預設）→ 唔會砌出矛盾
  const onlyW = resolveHudConfig({ UMAPYOI_HUD_W: '0.1' }, null);
  // ⚠️ `size.w` 係寫死嘅 0.1，而 `x[1] − x[0]` 喺 IEEE754 之下係 0.09999999999999998
  //    —— 差 1.4e-17（同 `0.81 − 0.598` 一樣係「同一個數嘅兩種寫法」），所以用容差。
  assert.ok(Math.abs(onlyW.layout.size.w - 0.1) <= 1e-9, `大細跟 env：${onlyW.layout.size.w}`);
  assert.equal(onlyW.layout.x[0], DEFAULT_HUD_LAYOUT.x[0], 'x0 唔受 _W 影響');
  assert.equal(onlyW.layout.x[1], 0.698, 'x1 ＝ x0 + 0.1（0.598 + 0.1，嚴格相等）');

  // ③ env 同時講範圍（0.1–0.5）同大細（0.2）→ 兩者唔一致（0.1 + 0.2 = 0.3 ≠ 0.5）
  //    → **警告**（唔 throw）＋ **以 size 為準**（x[1] 當作 0.3）
  const { warnings, out: fixed } = collectWarnings(
    (opts) => resolveHudConfig({ UMAPYOI_HUD_X: '0.1,0.5', UMAPYOI_HUD_W: '0.2' }, null, opts),
  );
  assert.deepEqual(fixed.layout.x, [0.1, 0.3], 'x[1] 要由 size 推（唔可以留住寫死嘅 0.5）');
  assert.equal(fixed.layout.size.w, 0.2, 'size 係 source of truth');
  assert.equal(warnings.length, 1, `要有一個警告：${warnings.join('｜')}`);
  for (const piece of ['0.5', '0.1', '0.2', '0.3']) {
    assert.ok(warnings[0].includes(piece), `警告要包住「${piece}」：${warnings[0]}`);
  }

  // ④ env 只寫大細、檔案只寫範圍 → 大細跟 env，範圍末端跟返新大細（x0 唔變）→ **唔算矛盾（冇警告）**
  const { warnings: noWarn, out: fileSpanEnvW } = collectWarnings(
    (opts) => resolveHudConfig({ UMAPYOI_HUD_W: '0.2' }, { layout: { x: [0.1, 0.4] } }, opts),
  );
  assert.deepEqual(noWarn, [], `env 大細 vs 檔案範圍唔算矛盾（唔應該嘈）：${noWarn.join('｜')}`);
  assert.ok(Math.abs(fileSpanEnvW.layout.size.w - 0.2) <= 1e-9, `大細跟 env：${fileSpanEnvW.layout.size.w}`);
  assert.equal(fileSpanEnvW.layout.x[1], 0.3, 'x1 ＝ x0 + 0.2（0.1 + 0.2 ≈ 0.3，唔可以留住舊範圍嘅 0.4）');
  assert.equal(fileSpanEnvW.layout.x[0], 0.1, 'x0（位置）唔變');
  // ⑤ 冇 env、檔案只寫範圍 → 照舊收（大細由範圍推），行為同 validateConfig 一致
  const legacy = resolveHudConfig({}, { layout: { x: [0.1, 0.3] } });
  assert.deepEqual(legacy.layout.x, [0.1, 0.3]);
  assert.ok(Math.abs(legacy.layout.size.w - 0.2) <= 1e-9, `大細由範圍推：${legacy.layout.size.w}`);

  // ⑥ ⚠️ 「唔一致」同「唔合法」係兩件事：推導出嚟嘅範圍走出 0–1 → **throw**
  //    （`UMAPYOI_HUD_X=0.9,1.0` ＋ `_W=0.5` → 右邊界 1.4 > 1，同檔案／預設一樣要擋）
  assert.throws(
    () => resolveHudConfig({ UMAPYOI_HUD_X: '0.9,1.0', UMAPYOI_HUD_W: '0.5' }, null),
    /右邊界/,
  );
  // ⑦ 只有一邊寫死 → 另一邊由佢推，唔算矛盾（唔會有警告）
  const { warnings: none } = collectWarnings((opts) => resolveHudConfig({ UMAPYOI_HUD_X: '0.1,0.3' }, null, opts));
  assert.deepEqual(none, [], `單邊寫死唔應該有警告：${none.join('｜')}`);
});

test('hud-config 不變式：浮點誤差 1e-9 之內要放行，但真嘅數值錯誤一定要大聲講（唔准放寬到冇閘）', () => {
  // （前提）0.1 + 0.7 喺 IEEE754 之下係 0.7999999999999999（唔係 0.8）——
  // 呢種「同一個數嘅兩種寫法」唔可以當錯，否則正常檔案都開唔到。
  const expected = 0.1 + 0.7;
  assert.notEqual(expected, 0.8);
  assert.ok(Math.abs(expected - 0.8) < 1e-15, `差幾多：${Math.abs(expected - 0.8)}`);
  const okAx = validateConfig({ layout: { x: [0.1, 0.8], size: { w: 0.7, h: 0.2 } } }).layout;
  assert.deepEqual(okAx.x, [0.1, 0.8]);
  assert.equal(okAx.size.w, 0.7);
  // 1e-13（＝1920px 之下 1.9e-10 px，只係浮點雜訊）都要放行 —— 而且**唔准有警告**
  const tiny = collectWarnings((opts) => validateConfig({ layout: { x: [0.1, 0.8 + 1e-13], size: { w: 0.7, h: 0.2 } } }, opts));
  assert.deepEqual(tiny.warnings, [], `1e-13 只係浮點雜訊，唔應該嘈：${tiny.warnings.join('｜')}`);
  // 0.1 + 0.7 = 0.7999999999999999，但寫 0.8（同一個數嘅兩種寫法）→ 一定要過，
  // 否則正常檔案都開唔到。
  const bothWritten = validateConfig({ layout: { x: [0.1, 0.8], size: { w: 0.7, h: 0.2 } } }).layout;
  assert.equal(bothWritten.x[0], 0.1, 'x0 係寫死嘅');
  assert.ok(Math.abs(bothWritten.x[1] - 0.8) <= 1e-9, `x1 ＝ x0 + w：${bothWritten.x[1]}`);
  assert.equal(bothWritten.size.w, 0.7, 'size 為準 → 寫死嘅 0.7 原封不動');
  // ⚠️ 但 1e-4（＝1920px 之下 0.19px，來自「改咗大細唔記得改範圍」）一定要**大聲講** ——
  //    呢個就係「唔准為咗過測試而放寬檢查」嘅底線（而家係警告，唔係 throw：見 §2 六行個案）。
  const noisy = collectWarnings((opts) => validateConfig({ layout: { x: [0.598, 0.8101], size: { w: 0.212, h: 0.255 } } }, opts));
  assert.equal(noisy.warnings.length, 1, `1e-4 嘅真錯誤一定要嘈：${noisy.warnings.join('｜')}`);
  for (const piece of ['0.8101', '0.598', '0.212', '0.81']) {
    assert.ok(noisy.warnings[0].includes(piece), `警告要包住「${piece}」：${noisy.warnings[0]}`);
  }
});

test('hud-config 不變式：只寫一邊（範圍 或 大細）→ 由寫咗嗰邊推另一邊，唔會砌出矛盾', () => {
  // 只寫範圍（舊檔案格式）→ 大細由範圍推；唔可以攞預設 0.212 砌出 x[1] = 0.312（＝靜默改咗用戶寫嘅範圍）
  const onlySpan = validateConfig({ layout: { x: [0.1, 0.3], y: [0.2, 0.6] } });
  assert.deepEqual(onlySpan.layout.x, [0.1, 0.3]);
  assert.ok(Math.abs(onlySpan.layout.size.w - 0.2) <= 1e-9, `大細要由範圍推：${onlySpan.layout.size.w}`);
  assert.ok(Math.abs(onlySpan.layout.size.h - 0.4) <= 1e-9, `大細要由範圍推：${onlySpan.layout.size.h}`);
  assert.equal(onlySpan.layout.y[0], 0.2, 'y0 係寫死嘅');
  assert.ok(Math.abs(onlySpan.layout.y[1] - 0.6) <= 1e-9, `y1 要係範圍嘅末端：${onlySpan.layout.y[1]}`);

  // 只寫大細 → 範圍由「起點 + 大細」推（x0／y0 起點用預設，唔可以攞預設範圍末端）
  const onlySize = validateConfig({ layout: { size: { w: 0.1, h: 0.3 } } });
  assert.deepEqual(onlySize.layout.size, { w: 0.1, h: 0.3 });
  assert.equal(onlySize.layout.x[0], DEFAULT_HUD_LAYOUT.x[0], 'x0 起點跟預設');
  assert.equal(onlySize.layout.y[0], DEFAULT_HUD_LAYOUT.y[0], 'y0 起點跟預設');
  assert.ok(
    Math.abs(onlySize.layout.x[1] - (onlySize.layout.x[0] + 0.1)) <= 1e-9,
    `x1 = x0 + w（唔可以留住預設範圍嘅 0.81）：${onlySize.layout.x[1]}`,
  );
  assert.ok(
    Math.abs(onlySize.layout.y[1] - (onlySize.layout.y[0] + 0.3)) <= 1e-9,
    `y1 = y0 + h：${onlySize.layout.y[1]}`,
  );

  // 只寫「範圍 ＋ 大細」而兩者一致 → 過，而且**唔准有警告**
  const agree = collectWarnings((opts) => validateConfig({ layout: { x: [0.4, 0.5], size: { w: 0.1 } } }, opts));
  assert.deepEqual(agree.warnings, [], `一致就唔應該嘈：${agree.warnings.join('｜')}`);
  assert.equal(agree.out.layout.size.w, 0.1);
  assert.equal(agree.out.layout.size.h, DEFAULT_HUD_SIZE.h, '冇寫 h → 用預設');
  assert.equal(agree.out.layout.x[1], 0.5, 'x1 ＝ x0 + w（0.4 + 0.1）');

  // ⭐ anchorHud 嘅實際後果：只寫範圍唔會再走出畫面（以前會用預設大細 0.212 砌到 x[1] = 0.312）
  const content = { x: 0, y: 0, width: 1920, height: 1080 };
  const rhs = validateConfig({ layout: { x: [0.9, 1.0] } }).layout;
  const box = anchorHud(content, rhs);
  assert.ok(box.x + box.width <= 1920, `右邊界唔可以走出內容區：${box.x} + ${box.width}`);

  // ⚠️ 兩邊都有寫但矛盾（**寫死嘅末端同推導值唔一致**）→ **警告 ＋ 以 size 為準**（唔 throw）。
  //    呢度用一個「推導出嚟嘅範圍仍然合法」嘅例子（右邊界 0.9 ≤ 1）—— 「唔一致」同
  //    「唔合法」係兩件事：後者一定要 throw（見上面「真嘅唔合法」嗰條）。
  const conflict = collectWarnings((opts) => validateConfig({ layout: { x: [0.4, 0.45], size: { w: 0.5 } } }, opts));
  assert.equal(conflict.warnings.length, 1, `要有警告：${conflict.warnings.join('｜')}`);
  assert.equal(conflict.out.layout.size.w, 0.5, 'size 為準');
  assert.equal(conflict.out.layout.x[1], 0.9, 'x[1] 由 x[0] + size.w 推（0.4 + 0.5 = 0.9，寫死嘅 0.45 被取代）');
  //    警告要講得出兩個值（寫死嘅 vs 推導出嚟嘅）
  for (const piece of ['0.45', '0.5', '0.4', '0.9', 'layout.size.w']) {
    assert.ok(conflict.warnings[0].includes(piece), `警告要包住「${piece}」：${conflict.warnings[0]}`);
  }
});

test('hud-config 不變式：x 同 y 兩個軸要對稱（唔准只守 x 唔守 y）—— 連 loadConfig／resolveHudConfig 條路都要守', () => {
  // ⭐ 審計實測嗰個個案：以前 `validateConfig({ layout: { x: [0.9, 1.0], size: { w: 0.5, h: 0.2 } } })`
  //    照過 → `anchorHud()` 用 size.w 做實際大細 → 右邊界 0.9 + 0.5 = 1.4 × 1920 = 2688 > 1920
  //    → HUD 靜默走出畫面。而家兩個軸、三條路徑都要 throw（throw 嘅理由係**推導出嚟嘅範圍**
  //    唔合法，唔再係「兩個冗餘欄位唔一致」）。
  const axes = [
    // ⚠️ 「壞」嗰個嘅寫死範圍兩個值都喺 0–1（唔可以靠「超出範圍」嗰條檢查矇混過關），
    //    要 throw 一定係因為「推導出嚟嘅右邊界 > 1」。
    { axis: 'x', sizeKey: 'w', bad: { x: [0.9, 1.0], size: { w: 0.5, h: 0.2 } }, good: { x: [0.4, 0.9], size: { w: 0.5, h: 0.2 } } },
    { axis: 'y', sizeKey: 'h', bad: { y: [0.6, 0.95], size: { w: 0.212, h: 0.5 } }, good: { y: [0.4, 0.9], size: { w: 0.212, h: 0.5 } } },
  ];
  for (const { axis, bad, good } of axes) {
    const re = new RegExp(`右邊界 layout\\.${axis}\\[0\\]`);    assert.throws(() => validateConfig({ layout: bad }), re, `${axis}：validateConfig 要 throw`);
    // loadConfig（用戶手寫 hud-position.json 真係會行到嘅路）
    const path = freshPath(`invariant-${axis}.json`);
    writeRaw(path, JSON.stringify({ layout: bad }));
    assert.throws(() => loadConfig({ filePath: path }), re, `${axis}：loadConfig 要 throw`);
    // resolveHudConfig（main.js 啟動路徑）
    assert.throws(() => resolveHudConfig({}, { layout: bad }), re, `${axis}：resolveHudConfig 要 throw`);
    // 🔎 反證：一致嘅版本一定過（證明上面 throw 真係因為「範圍唔合法」，唔係因為閘亂咬）
    const { warnings, out: ok } = collectWarnings((opts) => validateConfig({ layout: good }, opts));
    assert.ok(ok, `${axis}：一致就要過`);
    assert.deepEqual(warnings, [], `${axis}：一致就唔應該有警告：${warnings.join('｜')}`);
    // 🔎 而且真嘅綁到 anchorHud：一致版本唔會走出內容區
    const box = anchorHud({ x: 0, y: 0, width: 1920, height: 1080 }, ok.layout);
    assert.ok(box.x + box.width <= 1920 && box.y + box.height <= 1080, `${axis}：右／下邊界要喺內容區內`);
  }
});

// ───────────────────────── 優先次序 ─────────────────────────

test('hud-config resolveHudConfig：環境變數 > config 檔 > 預設（逐欄位）', () => {
  // ⚠️ 檔案自己一定要成一致（x[1] = x[0] + size.w：0.1 + 0.3 = 0.4；y[1] = y[0] + size.h：0.3 + 0.2 = 0.5）——
  //    呢條不變式而家由 validateConfig() 守住，所以測試資料唔可以再自相矛盾。
  const fileConfig = {
    layout: { x: [0.1, 0.4], y: [0.3, 0.5], offset: { dx: 0.01, dy: 0.02 }, size: { w: 0.3, h: 0.2 } },
    display: { total: false, goldMark: true },
  };

  // 冇 env → 檔案值勝過預設
  const fromFile = resolveHudConfig({}, fileConfig);
  assert.deepEqual(fromFile.layout.x, [0.1, 0.4]);
  assert.deepEqual(fromFile.layout.y, [0.3, 0.5]);
  assert.equal(fromFile.layout.size.w, 0.3);
  assert.equal(fromFile.display.total, false, 'display 冇 env 呢回事 → 跟檔案');

  // env 逐欄位蓋過檔案，冇 set 嘅欄位保持檔案值
  // ⚠️ `_X` 同 `_W` **一齊** set 嗰陣，新語意係「**`size` 為準**」：x[1] 由
  //    `x[0] + _W` 推（0.5 + 0.2 = 0.7），寫死嘅 `x[1] = 0.7` 啱啱好一致 → **唔會有警告**。
  //    （若果寫死嘅範圍同 `_W` 唔一致，而家係「警告 ＋ 以 size 為準」，唔再 throw ——
  //      見 §2 六行環境變數嘅回歸測試。）
  const { warnings, out: mixed } = collectWarnings((opts) => resolveHudConfig(
    { UMAPYOI_HUD_X: '0.5,0.7', UMAPYOI_HUD_DX: '-0.05', UMAPYOI_HUD_W: '0.2' },
    fileConfig,
    opts,
  ));
  assert.deepEqual(warnings, [], `一致嘅組合唔應該有警告：${warnings.join('｜')}`);
  assert.deepEqual(mixed.layout.x, [0.5, 0.7], 'env 要蓋過檔案');
  assert.deepEqual(mixed.layout.y, [0.3, 0.5], '只 set 咗 X／DX／W → y 要跟檔案');
  assert.equal(mixed.layout.offset.dx, -0.05);
  assert.equal(mixed.layout.offset.dy, 0.02, 'dx／dy 各自獨立');
  assert.ok(Math.abs(mixed.layout.size.w - 0.2) <= 1e-9, `大細跟 env：${mixed.layout.size.w}`);
  assert.ok(Math.abs(mixed.layout.size.h - 0.2) <= 1e-9, `冇 set _H → 大細高跟檔案（唔係預設）：${mixed.layout.size.h}`);

  // 冇檔案 → 預設，env 照樣蓋過預設
  const noFile = resolveHudConfig({ UMAPYOI_HUD_Y: '0.8,0.9' }, null);
  assert.deepEqual(noFile.layout.y, [0.8, 0.9]);
  assert.deepEqual(noFile.layout.x, [...DEFAULT_HUD_LAYOUT.x]);
  assert.deepEqual(noFile.display, { ...DEFAULT_HUD_DISPLAY });
});

test('hud-config resolveHudConfig：env 打嘅值啱啱好等於預設都要蓋過檔案（唔准用「同預設比較」判斷有冇 set）', () => {
  // 檔案寫嘅範圍（闊 0.3）同 env 打嘅預設範圍（闊 0.212）**都係自成一致嘅寫法**，
  // 所以呢度測到嘅係純粹嘅「優先次序」，唔會被不變式檢查干擾。
  const fileConfig = validateConfig({
    layout: { x: [0.1, 0.4], size: { w: 0.3, h: 0.2 } },
    display: { goldMark: false },
  });
  const cfg = resolveHudConfig(
    { UMAPYOI_HUD_X: `${DEFAULT_HUD_LAYOUT.x[0]},${DEFAULT_HUD_LAYOUT.x[1]}` },
    fileConfig,
  );
  assert.deepEqual(cfg.layout.x, [...DEFAULT_HUD_LAYOUT.x], 'env 有 set 就算等於預設都要贏');
  assert.ok(
    Math.abs(cfg.layout.size.w - DEFAULT_HUD_SIZE.w) <= 1e-9,
    `大細要同 env 個範圍同源（唔可以留住檔案嘅 0.3）：${cfg.layout.size.w}`,
  );
  assert.equal(cfg.layout.size.h, 0.2, '冇 set _H → 跟檔案');
  assert.equal(cfg.display.goldMark, false, 'display 唔受 env 影響');
});

test('hud-config resolveHudConfig：env 唔合法／超範圍／檔案唔合法 → 一律 throw', () => {
  // 解析（重用 layoutFromEnv）本身已經會 throw
  assert.throws(() => resolveHudConfig({ UMAPYOI_HUD_X: 'abc' }, null), /UMAPYOI_HUD_X/);
  assert.throws(() => resolveHudConfig({ UMAPYOI_HUD_Y: '0.7' }, null), /UMAPYOI_HUD_Y/);
  // layoutFromEnv 只查「係唔係數字」，範圍由合併之後嘅 validate 守住
  assert.throws(() => resolveHudConfig({ UMAPYOI_HUD_X: '0.9,0.5' }, null), /前細後大/);
  assert.throws(() => resolveHudConfig({ UMAPYOI_HUD_X: '0.1,1.5' }, null), /0–1/);
  // ⚠️ `_W=0` 而家由「`size` 為準」嗰條檢查捉：`layout.size.w` 要大過 0
  //    （唔再錯講成「layout.x 要前細後大」—— `x` 範圍喺呢個情況根本冇寫過）。
  assert.throws(() => resolveHudConfig({ UMAPYOI_HUD_W: '0' }, null), /layout\.size\.w 要大過 0/);
  // 檔案唔合法都唔可以靜默當冇事
  assert.throws(() => resolveHudConfig({}, { layout: { x: [0.9, 0.1] } }), /前細後大/);
  // 回傳一定要係完整形狀
  assert.deepEqual(Object.keys(resolveHudConfig({}, null)).sort(), ['display', 'layout']);
});

// ───────────────────────── 存檔 round-trip ─────────────────────────

test('hud-config saveConfig → loadConfig：round-trip 一致（UTF-8 JSON、檔名 hud-position.json）', () => {
  const dir = freshPath('save-dir');
  const path = join(dir, HUD_CONFIG_FILENAME); // 連目錄都未存在 → saveConfig 要自己開
  // ⚠️ x[1] = x[0] + size.w、y[1] = y[0] + size.h（0.05 + 0.31 = 0.36、0.1 + 0.41 = 0.51）——
  //    呢條不變式而家由 validateConfig() 守住，所以測試資料一定要自成一對。
  const custom = {
    layout: { x: [0.05, 0.36], y: [0.1, 0.51], offset: { dx: -0.015, dy: 0.25 }, size: { w: 0.31, h: 0.41 } },
    display: { total: false, statScore: false },
  };

  const written = saveConfig(custom, { filePath: path });
  assert.equal(written, path, '要回實際寫入路徑');
  assert.equal(existsSync(path), true);

  const loaded = loadConfig({ filePath: path });
  assert.deepEqual(loaded, validateConfig(custom), '讀返嚟要同寫入嘅一模一樣');
  assert.deepEqual(loaded.layout.x, [0.05, 0.36]);
  // ⚠️ 唔可以用 `deepEqual` 比 `y`：`0.1 + 0.41 = 0.5100000000000001`（IEEE754），
  //    而 `assertSameLayout` 一條規則係「逐個數字喺 1e-9 之內」（同 `x[1] − x[0] ≈ size.w` 一樣道理）。
  assert.equal(loaded.layout.y[0], 0.1, 'y0 係寫死嘅');
  assert.ok(Math.abs(loaded.layout.y[1] - 0.51) <= 1e-9, `y1 ≈ y0 + h：${loaded.layout.y[1]}`);
  assert.deepEqual(loaded.layout.size, { w: 0.31, h: 0.41 }, 'round-trip 唔可以改到大細');
  assert.equal(loaded.display.total, false);
  assert.equal(loaded.display.goldMark, true, '冇寫嘅顯示項寫檔時會補預設');

  // 檔案要係人類睇得明嘅 UTF-8 JSON（有縮排＋尾隨換行）
  const text = readFileSync(path, 'utf8');
  assert.match(text, /\n {2}"layout": \{\n/);
  assert.match(text, /\n$/);

  // 寫檔再讀再寫 → 穩定（唔會愈寫愈走樣）
  saveConfig(loaded, { filePath: path });
  assert.deepEqual(loadConfig({ filePath: path }), loaded);
});

test('hud-config saveConfig：validate 唔過就 throw，而且**唔會**寫壞檔落去', () => {
  const path = freshPath('never-written.json');
  assert.throws(() => saveConfig({ layout: { x: [0.9, 0.1] } }, { filePath: path }), /前細後大/);
  assert.equal(existsSync(path), false, '⭐ 寧願寫唔到，都唔可以寫一個壞檔落去');

  // 已經有嘅檔唔可以被壞設定蓋爛
  saveConfig(defaultHudConfig(), { filePath: path });
  const good = readFileSync(path, 'utf8');
  assert.throws(() => saveConfig({ display: { nope: 1 } }, { filePath: path }), /唔認識「nope」/);
  assert.equal(readFileSync(path, 'utf8'), good, '舊檔要原封不動');
});
