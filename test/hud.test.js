/**
 * HUD overlay 嘅單元測試（位置計算 + 顯示狀態）。
 *
 * 為何要測：Electron 視窗嘅 code 冇得用 `node --test` 測，
 * 而「擺錯位」同「顯示咗過期數仲當係即時」呢兩樣都係實機先發現得嘅痛。
 * 所以幾何同狀態一律抽去 `src/hud/layout.js` 用測試守住。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  anchorHud,
  contentRect,
  gameWindowRect,
  hudState,
  layoutFromEnv,
  DEFAULT_HUD_LAYOUT,
  DEFAULT_HUD_SIZE,
  DEFAULT_HUD_OFFSET,
  CONTENT_ASPECT,
  STAT_LABELS_ZH,
  STALE_MS,
} from '../src/hud/layout.js';

test('hud contentRect：圖比 16:9 高 → 多出嘅部分係頂部標題列', () => {
  assert.deepEqual(contentRect({ x: 0, y: 0, width: 1600, height: 900 }), {
    x: 0, y: 0, width: 1600, height: 900,
  });
  // 1920×1080 + 31px 標題列
  const withChrome = contentRect({ x: 100, y: 200, width: 1920, height: 1111 });
  assert.equal(withChrome.height, 1080);
  assert.equal(withChrome.y, 200 + 31, '標題列喺頂 → 內容區向下移');
  assert.equal(withChrome.x, 100);
});

test('hud anchorHud：位置係用戶實機調好嘅（2026-09-18 DX 0.59 / DY −0.67 已寫成預設）', () => {
  const content = { x: 0, y: 0, width: 1920, height: 1080 };
  const rect = anchorHud(content);
  assert.equal(rect.x, Math.round(1920 * DEFAULT_HUD_LAYOUT.x[0]));
  assert.equal(rect.y, Math.round(1080 * DEFAULT_HUD_LAYOUT.y[0]));
  // 大細：預設 size（唔係 x1−x0；offset／自訂位置移動咗但大細唔變）
  assert.equal(rect.width, Math.max(80, Math.round(1920 * DEFAULT_HUD_SIZE.w)));
  assert.equal(rect.height, Math.max(40, Math.round(1080 * DEFAULT_HUD_SIZE.h)));
  // 唔可以走出內容區（安全網）
  assert.ok(rect.x >= 0 && rect.y >= 0, '唔可以走出左上角');
  assert.ok(rect.x + rect.width <= 1920, '唔可以走出右邊');
  assert.ok(rect.y + rect.height <= 1080, '唔可以走出底部');
});

test('hud anchorHud：視窗大細／位置變都跟得住（等比縮放，見地雷 #24）', () => {
  const small = anchorHud({ x: 0, y: 0, width: 1280, height: 720 });
  const big = anchorHud({ x: 300, y: 120, width: 2560, height: 1440 });
  // HUD 係「內容區原點 + 大細×比例」→ 比例偏移會按視窗大細放大。
  // 所以唔可以要求位移等於視窗位移，而係要**跟住內容區原點**。
  assert.ok(big.x >= 300, `要跟住內容區原點，實得 x=${big.x}`);
  assert.ok(big.y >= 120, `垂直都要跟，實得 y=${big.y}`);
  // 兩者都要喺自己嘅內容區入面
  assert.ok(big.x + big.width <= 300 + 2560 && big.y + big.height <= 120 + 1440, '唔可以走出內容區');
  assert.ok(big.width > small.width, '大視窗 HUD 要大啲（等比）');
  assert.ok(Math.abs(big.width / small.width - 2) < 0.05, '闊度應該大約 ×2');
});

test('hud anchorHud：offset 同 size 要生效（對位模式靠呢兩個）', () => {
  const content = { x: 0, y: 0, width: 1920, height: 1080 };
  const base = anchorHud(content, { ...DEFAULT_HUD_LAYOUT, size: DEFAULT_HUD_SIZE, offset: DEFAULT_HUD_OFFSET });
  const moved = anchorHud(content, {
    ...DEFAULT_HUD_LAYOUT,
    size: DEFAULT_HUD_SIZE,
    offset: { dx: 0.02, dy: -0.03 },
  });
  // 允許 ±2px：x = round(原點 + 闊×(x0 + dx))，兩個 round 出嚟會有少少差
  assert.ok(Math.abs(moved.x - base.x - 1920 * 0.02) <= 2, `dx 要推橫向，實得 ${moved.x - base.x}`);
  assert.ok(Math.abs(moved.y - base.y + 1080 * 0.03) <= 2, `dy 要推垂直，實得 ${moved.y - base.y}`);
  const bigger = anchorHud(content, {
    ...DEFAULT_HUD_LAYOUT,
    size: { w: DEFAULT_HUD_SIZE.w * 2, h: DEFAULT_HUD_SIZE.h },
    offset: DEFAULT_HUD_OFFSET,
  });
  assert.ok(Math.abs(bigger.width - base.width * 2) <= 2, 'size.w 要改闊度');
  assert.equal(bigger.height, base.height);
});

test('hud layoutFromEnv：環境變數可以覆寫位置／大細（唔使改 code）', () => {
  const d = layoutFromEnv({});
  assert.deepEqual(d.x, DEFAULT_HUD_LAYOUT.x);
  assert.deepEqual(d.y, DEFAULT_HUD_LAYOUT.y);

  const custom = layoutFromEnv({
    UMAPYOI_HUD_X: '0.02, 0.18',
    UMAPYOI_HUD_Y: '0.72,0.9',
    UMAPYOI_HUD_DX: '-0.005',
    UMAPYOI_HUD_W: '0.3',
  });
  assert.deepEqual(custom.x, [0.02, 0.18]);
  assert.deepEqual(custom.y, [0.72, 0.9]);
  assert.equal(custom.offset.dx, -0.005);
  assert.equal(custom.offset.dy, 0);
  assert.equal(custom.size.w, 0.3);

  // ⚠️ 唔合法要出聲，唔可以靜默當 0（靜默用錯位置比起跑唔到更難查）
  assert.throws(() => layoutFromEnv({ UMAPYOI_HUD_X: 'abc' }), /UMAPYOI_HUD_X/);
  assert.throws(() => layoutFromEnv({ UMAPYOI_HUD_Y: '0.7' }), /UMAPYOI_HUD_Y/);
});

test('hud hudState：冇分數 → 老實講「等待面板條」', () => {
  const s = hudState({ score: null, updatedAt: 0, now: 1000 });
  assert.equal(s.state, 'none');
  assert.equal(s.total, null);
  assert.match(s.note, /等待面板條/);
});

test('hud hudState：有新鮮分數 → 顯示評價點、ランク、五維逐格', () => {
  const stats = [1489, 543, 655, 624, 628];
  const s = hudState({
    score: { total: 32334, rank: 'UE2', statScore: 30000 },
    stats,
    updatedAt: 1000,
    now: 1200,
  });
  assert.equal(s.state, 'ok');
  assert.equal(s.lines[0].value, '32334');
  // 五維逐格（順序：速度／持久／力量／毅力／智力）
  const statLines = s.lines.filter((l) => l.key.startsWith('stat'));
  assert.equal(statLines.length, 5);
  assert.deepEqual(statLines.map((l) => l.label), [...STAT_LABELS_ZH]);
  assert.deepEqual(statLines.map((l) => l.value), stats.map(String));
  assert.match(s.note, /ランク UE2/);
});

test('hud hudState：技能分未讀到 → 出「？／總分 ≥ 五維分」，唔可以假設 0', () => {
  const s = hudState({
    score: { total: 32334, rank: 'UE2', statScore: 30000, skillScore: null },
    stats: [1489, 543, 655, 624, 628],
  });
  const skill = s.summary.find((x) => x.key === 'skill');
  const stat = s.summary.find((x) => x.key === 'stat');
  assert.equal(stat.value, '30000');
  assert.equal(skill.value, '？／總分 ≥ 32334', '⭐ 未讀到技能就要老實講下限，唔可以出 0 或者估');
  // 顯示嘅總分仍然係五維分（下限），唔會當成真總分
  assert.equal(s.total, 32334);
});

test('hud hudState：技能分讀到之後就出實數', () => {
  const s = hudState({
    score: { total: 32334, rank: 'UE2', statScore: 30000, skillScore: 2334 },
    stats: [1489, 543, 655, 624, 628],
  });
  assert.equal(s.summary.find((x) => x.key === 'skill').value, '2334');
});

test('hud hudState：五維唔齊（唔夠 5 個）就唔顯示半截資料', () => {
  const s = hudState({
    score: { total: 32334, rank: 'UE2', statScore: 30000 },
    stats: [1489, 543],
  });
  assert.equal(s.lines.filter((l) => l.key.startsWith('stat')).length, 0, '寧願唔出，都唔好出半截');
});

test('hud hudState：對位模式 → state 變 edit 而且帶範圍／偏移', () => {
  const layout = layoutFromEnv({});
  const s = hudState({
    score: { total: 32334, rank: 'UE2', statScore: 30000 },
    stats: [1489, 543, 655, 624, 628],
    edit: true,
    layout,
  });
  assert.equal(s.state, 'edit');
  assert.match(s.edit, new RegExp(`x ${DEFAULT_HUD_LAYOUT.x[0].toFixed(3)}–${DEFAULT_HUD_LAYOUT.x[1].toFixed(3)}`));
  assert.match(s.edit, /大細/);
});

test('hud hudState：讀唔到（過期）→ 保留上一個穩定值，唔可以清空', () => {
  const stats = [1489, 543, 655, 624, 628];
  const s = hudState({
    score: { total: 32334, rank: 'UE2', statScore: 30000 },
    stats,
    updatedAt: 0,
    now: STALE_MS + 1,
  });
  assert.equal(s.state, 'stale');
  assert.equal(s.total, 32334, '⭐ 唔可以因為一時讀唔到就清走個數（唔好閃走）');
  assert.equal(s.rank, 'UE2');
  // 五維都要留住（唔止總分）
  assert.deepEqual(
    s.lines.filter((l) => l.key.startsWith('stat')).map((l) => l.value),
    stats.map(String),
  );
  assert.match(s.note, /上一個穩定值/);
});

// ─────────────── gameWindowRect：DIP vs 物理像素（技術債 §9.1-2，2026-09-23）───────────────
//
// 為何要：`placeHud()` 以前寫 `Math.min(workArea.width /* DIP */, game.width /* 物理像素 */)`
// —— 兩種單位撈埋。遊戲最大化（擷取幀大細 == 工作區）時兩者一樣所以睇唔出，
// 但「視窗化 ＋ 150% 縮放」之下會攞物理像素當 DIP → HUD 擺錯位（而且係靜默錯位）。

test('gameWindowRect：縮放 100% → 物理像素同 DIP 一樣（唔可以改變現有行為）', () => {
  const display = { workArea: { x: 0, y: 0, width: 2560, height: 1440 }, scaleFactor: 1 };
  assert.deepEqual(gameWindowRect({ width: 2560, height: 1440 }, display), { x: 0, y: 0, width: 2560, height: 1440 });
  assert.deepEqual(gameWindowRect({ width: 1930, height: 1116 }, display), { x: 0, y: 0, width: 1930, height: 1116 });
});

test('gameWindowRect：⭐ 150% 縮放 ＋ 視窗化遊戲 → 一定要 ÷scaleFactor（唔可以攞物理像素當 DIP）', () => {
  // 實機例子（用戶部機）：工作區 1707×960 DIP、遊戲視窗 2560×1440 物理像素
  const display = { workArea: { x: 0, y: 0, width: 1707, height: 960 }, scaleFactor: 1.5 };
  const rect = gameWindowRect({ width: 2560, height: 1440 }, display);
  assert.equal(rect.width, 1707, '2560 ÷ 1.5 = 1707（唔係攞 2560 去 min）');
  assert.equal(rect.height, 960);
  // 舊寫法（混用單位）嘅結果：min(1707, 2560) = 1707 —— 啱啱好一樣，所以下面呢個 case 才係真陷阱：
  const windowed = gameWindowRect({ width: 1930, height: 1116 }, display);
  assert.equal(windowed.width, 1287, '1930 ÷ 1.5 ≈ 1287');
  assert.equal(windowed.height, 744, '1116 ÷ 1.5 = 744');
  assert.notEqual(windowed.width, 1930, '⛔ 直接攞物理像素 ＝ HUD 會擺錯位');
});

test('gameWindowRect：工作區左上角做基準、大過工作區就夾返（唔准走出螢幕）', () => {
  const display = { workArea: { x: 100, y: 50, width: 1707, height: 960 }, scaleFactor: 1.5 };
  const rect = gameWindowRect({ width: 6000, height: 4000 }, display);
  assert.deepEqual(rect, { x: 100, y: 50, width: 1707, height: 960 });
});

test('gameWindowRect：冇量到遊戲大細／scaleFactor 唔合法 → 用工作區（唔准出 NaN）', () => {
  const display = { workArea: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 0 };
  for (const game of [undefined, {}, { width: 0, height: 0 }, { width: NaN, height: 'x' }]) {
    const rect = gameWindowRect(game, display);
    assert.deepEqual(rect, { x: 0, y: 0, width: 1920, height: 1080 }, `實得 ${JSON.stringify(game)}`);
  }
  // display 完全缺失（例如測試／極端情況）都要有合理預設，唔可以 throw
  assert.deepEqual(gameWindowRect({ width: 1280, height: 720 }, undefined), { x: 0, y: 0, width: 1280, height: 720 });
});
