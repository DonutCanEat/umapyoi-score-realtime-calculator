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

test('hud anchorHud：喺遊戲內容區嘅左邊（用戶指定：拍攝掣下面）', () => {
  const content = { x: 0, y: 0, width: 1920, height: 1080 };
  const rect = anchorHud(content);
  // 左邊：x 由 0.008 開始（唔貼死邊）
  assert.equal(rect.x, Math.round(1920 * DEFAULT_HUD_LAYOUT.x[0]));
  // 垂直：同面板條（y 0.691–0.703）**同水平**或者更低 → 一定唔會壓住數字
  assert.ok(rect.y >= 1080 * 0.69, `應該喺面板條水平或更低，實得 y=${rect.y}`);
  // 橫向仍然喺左邊（唔會頂住畫面中間嘅訓練掣）
  assert.ok(rect.x + rect.width <= 1920 * 0.25, `要留喺左邊，實得右邊 ${rect.x + rect.width}`);
  // 唔可以走出內容區
  assert.ok(rect.y + rect.height <= 1080, '唔可以走出畫面底');
  // ⭐ 最關鍵：HUD 嘅 y 範圍同面板條嘅 y 範圍**唔重疊** → 幾闊都唔會壓住數字
  const hudTop = rect.y;
  assert.ok(hudTop >= 1080 * 0.69, 'HUD 頂部要喺面板條之下（唯一真正嘅安全條件）');
});

test('hud anchorHud：視窗大細／位置變都跟得住（等比縮放，見地雷 #24）', () => {
  const small = anchorHud({ x: 0, y: 0, width: 1280, height: 720 });
  const big = anchorHud({ x: 300, y: 120, width: 2560, height: 1440 });
  // HUD 係「內容區原點 + 大細×比例」→ 比例偏移會按視窗大細放大。
  // 所以唔可以要求位移等於視窗位移，而係要**跟住內容區原點**（水平喺左邊、垂直喺下面）。
  assert.ok(big.x >= 300 && big.x <= 300 + 2560 * 0.25, `要跟住內容區原點，實得 x=${big.x}`);
  assert.ok(big.y >= 120 && big.y <= 120 + 1440 * 0.9, `垂直都要跟，實得 y=${big.y}`);
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

test('hud hudState：有新鮮分數 → 顯示評價点、ランク、五維逐格', () => {
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
  assert.match(s.edit, /x 0\.008–0\.220/);
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
