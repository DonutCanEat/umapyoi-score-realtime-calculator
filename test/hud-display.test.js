/**
 * HUD **顯示選項**（`display`）同**金色格**（`gold`）嘅單元測試。
 *
 * 為何要另外一個檔（而唔係塞入 `hud.test.js`）：A3 係「加顯示選項」呢一件事，
 * 而呢件事最大嘅風險唔係邏輯複雜，而係**預設行為走樣** ——
 * 一開程式就少咗一格、或者閂一格連隔籬都消失。所以呢個檔重點測：
 *
 *   ① 唔傳 `display` → 同加設定之前**完全一樣**（唔可以少咗嘢）
 *   ② 逐個 key 閂 → **只**影響自己嗰項（唔會連鎖）
 *   ③ `display` 只寫一部分 key → 冇寫嘅照開（「冇寫」唔等於「閂」）
 *   ④ `state` 唔受 `display` 影響（`edit` 蓋 `stale`／`none` 嘅規則照舊）
 *   ⑤ `gold`（金色格）嘅**真實粒度** ＝ 一個整體 boolean，唔係逐格
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { hudState, HUD_DISPLAY_KEY_NAMES } from '../src/hud/layout.js';
import { HUD_DISPLAY_KEYS, DEFAULT_HUD_DISPLAY } from '../src/hud/config.js';

const SCORE = { total: 32334, rank: 'UE2', statScore: 30000 };
const STATS = [1489, 543, 655, 624, 628];

function allOff(overrides = {}) {
  return { ...Object.fromEntries(HUD_DISPLAY_KEY_NAMES.map((k) => [k, true])), ...overrides };
}

test('顯示選項：唔傳 display → 同加設定之前一模一樣（唔可以一開就少咗嘢）', () => {
  const s = hudState({ score: SCORE, stats: STATS, updatedAt: 1000, now: 1200 });
  assert.equal(s.lines.length, 6, '評價点 + 五維 5 格');
  assert.equal(s.lines[0].key, 'total');
  assert.deepEqual(s.summary.map((x) => x.key), ['stat', 'skill']);
  assert.equal(s.note, 'ランク UE2');
  assert.equal(s.edit, null);
  assert.equal(s.gold, false, '冇傳 gold → 一律 false（唔可以自己估金色）');

  // 傳 null 同傳 undefined 一樣要當「全部開」
  const viaNull = hudState({ score: SCORE, stats: STATS, display: null });
  assert.deepEqual(viaNull.lines, s.lines);

  // 傳一個「全部 true」嘅 object（＝ config 預設）都要同唔傳一樣
  const viaAllTrue = hudState({ score: SCORE, stats: STATS, display: allOff() });
  assert.deepEqual(viaAllTrue.lines, s.lines);
  assert.deepEqual(viaAllTrue.summary, s.summary);
  assert.equal(viaAllTrue.note, s.note);
});

test('顯示選項：逐個 key 閂 → 只影響自己嗰項（冇連鎖）', () => {
  const base = { score: SCORE, stats: STATS, updatedAt: 1000, now: 1200 };

  const noTotal = hudState({ ...base, display: allOff({ total: false }) });
  assert.equal(noTotal.lines.find((l) => l.key === 'total'), undefined);
  assert.equal(noTotal.lines.filter((l) => l.key.startsWith('stat')).length, 5, '五維唔可以受牽連');
  assert.deepEqual(noTotal.summary.map((x) => x.key), ['stat', 'skill']);
  assert.equal(noTotal.total, 32334, '閂顯示唔等於冇分數（`total` 欄位照留，畀其他用途）');

  const noStats = hudState({ ...base, display: allOff({ stats: false }) });
  assert.equal(noStats.lines.filter((l) => l.key.startsWith('stat')).length, 0);
  assert.equal(noStats.lines.find((l) => l.key === 'total').value, '32334', '評價点要留住');

  const noStatScore = hudState({ ...base, display: allOff({ statScore: false }) });
  assert.deepEqual(noStatScore.summary.map((x) => x.key), ['skill'], '只閂五維分');

  const noSkillScore = hudState({ ...base, display: allOff({ skillScore: false }) });
  assert.deepEqual(noSkillScore.summary.map((x) => x.key), ['stat'], '只閂技能分');

  const noNote = hudState({ ...base, display: allOff({ note: false }) });
  assert.equal(noNote.note, '', '閂 note → 空字串（renderer 見到空就唔畫個框）');
  assert.equal(noNote.lines.length, 6, '閂 note 唔可以連累數值');
});

test('顯示選項：`display` 只寫一部分 key → 冇寫嘅照開（≠ 閂）', () => {
  const s = hudState({
    score: SCORE,
    stats: STATS,
    updatedAt: 1000,
    now: 1200,
    display: { total: false }, // 淨係想閂評價点
  });
  assert.equal(s.lines.find((l) => l.key === 'total'), undefined);
  assert.equal(s.lines.filter((l) => l.key.startsWith('stat')).length, 5, '冇寫 stats 就唔可以當閂');
  assert.deepEqual(s.summary.map((x) => x.key), ['stat', 'skill'], '冇寫嘅 summary 都要照出');
  assert.equal(s.note, 'ランク UE2');
});

test('顯示選項：edit 行要跟 display.edit，但 state 仍然係 edit（對位模式要有虛線框）', () => {
  const layout = {
    x: [0.598, 0.81], y: [0.03, 0.285], offset: { dx: 0, dy: 0 }, size: { w: 0.212, h: 0.255 },
  };
  const on = hudState({ score: SCORE, stats: STATS, edit: true, layout });
  assert.equal(on.state, 'edit');
  assert.match(on.edit, /大細/);

  const off = hudState({ score: SCORE, stats: STATS, edit: true, layout, display: allOff({ edit: false }) });
  assert.equal(off.edit, null, '閂 edit 行 → 唔出範圍／偏移');
  assert.equal(off.state, 'edit', '⚠️ state 唔可以跟住閂（閂咗就睇唔出可以拖）');
});

test('顯示選項：未讀到分數（none 態）一樣受 display 管', () => {
  const plain = hudState({ score: null, now: 1000 });
  assert.equal(plain.state, 'none');
  assert.equal(plain.lines.length, 1);
  assert.match(plain.note, /等待面板條/);

  const hidden = hudState({ score: null, now: 1000, display: allOff({ total: false, note: false }) });
  assert.deepEqual(hidden.lines, [], '閂咗就唔出佔位符（renderer 靠空陣列／空字串收埋個框）');
  assert.equal(hidden.note, '');
  assert.equal(hidden.state, 'none', 'state 唔受 display 影響');
});

test('顯示選項：edit 蓋過 none／stale 嘅規則唔受 display 影響（四態照舊）', () => {
  const layout = {
    x: [0.598, 0.81], y: [0.03, 0.285], offset: { dx: 0, dy: 0 }, size: { w: 0.212, h: 0.255 },
  };
  const display = allOff({ total: false, stats: false, note: false, edit: false });
  assert.equal(hudState({ score: null, edit: true, layout, display }).state, 'edit');
  const stale = hudState({
    score: SCORE, stats: STATS, updatedAt: 0, now: 99999, display,
  });
  assert.equal(stale.state, 'stale');
  assert.equal(hudState({
    score: SCORE, stats: STATS, updatedAt: 0, now: 99999, edit: true, layout, display,
  }).state, 'edit');
});

test('金色格：真實粒度係「一個整體 boolean」—— gold 照傳，唔准假裝逐格', () => {
  const s = hudState({ score: SCORE, stats: STATS, gold: true });
  assert.equal(s.gold, true);
  // ⚠️ 呢個就係限制：`gold` 係**整條數值列**嘅旗標，冇「邊一格」嘅資訊
  //    → 五維各行唔可以有任何金色標記（唔可以自己揀一格嚟標）。
  for (const line of s.lines.filter((l) => l.key.startsWith('stat'))) {
    assert.equal(line.gold, undefined, `唔可以喺 ${line.key} 上面假造逐格金色標記`);
  }

  // 閂 goldMark → 就算真有金色都唔出
  assert.equal(hudState({ score: SCORE, stats: STATS, gold: true, display: allOff({ goldMark: false }) }).gold, false);
  // 冇金色 → 唔會無中生有
  assert.equal(hudState({ score: SCORE, stats: STATS, gold: false }).gold, false);
  assert.equal(hudState({ score: SCORE, stats: STATS }).gold, false);
});

// ───────────────── C5：ランク目標（`nextRank`）─────────────────
//
// ⚠️ 三個輸入狀態要分清楚（呢個就係最容易走樣嘅位）：
//    `nextRank` = 物件 → 「升級 UG 差 7800」
//    `nextRank` = null → 已經最高ランク → 「UA 已到頂」（**唔係**唔顯示）
//    `nextRank` = undefined（舊呼叫）→ **一行都唔加**（加功能唔可以改變舊行為）

const SCORE_NEXT = {
  total: 32334,
  rank: 'UE2',
  statScore: 30000,
  nextRank: { rank: 'UE3', gap: 66, threshold: 32400 },
};

test('ランク目標：有 nextRank 就出「升級 X 差 N」，數值同 nextRank 一致', () => {
  const s = hudState({ score: SCORE_NEXT, stats: STATS, updatedAt: 1000, now: 1200 });
  assert.deepEqual(s.summary.map((x) => x.key), ['stat', 'skill', 'nextRank']);
  const item = s.summary.find((x) => x.key === 'nextRank');
  assert.equal(item.value, 'UE3 差 66');
  assert.match(item.label, /升級/);
});

test('ランク目標：已經最高ランク（nextRank = null）要老實講「已到頂」，唔係靜默唔出', () => {
  const s = hudState({
    score: { total: 55200, rank: 'UA', statScore: 55200, nextRank: null },
    stats: STATS,
  });
  const item = s.summary.find((x) => x.key === 'nextRank');
  assert.ok(item, 'nextRank = null 係「冇下一個ランク」嘅意思，唔可以當「冇資料」');
  assert.equal(item.value, 'UA 已到頂');
});

test('ランク目標：舊呼叫冇 nextRank 欄位 → 一行都唔加（同加呢個功能之前一模一樣）', () => {
  const s = hudState({ score: SCORE, stats: STATS, updatedAt: 1000, now: 1200 });
  assert.equal(s.summary.find((x) => x.key === 'nextRank'), undefined);
  assert.deepEqual(s.summary.map((x) => x.key), ['stat', 'skill']);

  // 冇分數（none 態）一樣唔會有
  const none = hudState({ score: null });
  assert.equal(none.summary.find((x) => x.key === 'nextRank'), undefined);
});

test('ランク目標：閂 rankTarget → 只少呢一行，其他 summary 照舊', () => {
  const off = hudState({
    score: SCORE_NEXT, stats: STATS, display: allOff({ rankTarget: false }),
  });
  assert.deepEqual(off.summary.map((x) => x.key), ['stat', 'skill']);
  assert.equal(off.total, 32334, '閂顯示唔等於冇分數');
});

test('顯示選項 key 清單要同 config.js 嘅 HUD_DISPLAY_KEYS 對齊（兩邊走樣 = 設定窗閂錯嘢）', () => {
  assert.deepEqual([...HUD_DISPLAY_KEY_NAMES], [...HUD_DISPLAY_KEYS]);
  assert.deepEqual(Object.keys(DEFAULT_HUD_DISPLAY).sort(), [...HUD_DISPLAY_KEY_NAMES].sort());
  // ⚠️ 呢個數字係故意寫死嘅：加／減顯示選項一定要**同時**改設定窗（`DISPLAY_FIELDS`）
  //    同 `HUD_DISPLAY_KEYS`，測試會即刻提你（9 = C5 加咗 `rankTarget`、C3 加咗 `history`）。
  assert.equal(HUD_DISPLAY_KEY_NAMES.length, 9);
  assert.equal(DEFAULT_HUD_DISPLAY.rankTarget, true, '新選項預設要開（＝同今日 HUD 一樣）');
  assert.equal(DEFAULT_HUD_DISPLAY.history, true, '成長曲線預設要開（C3）');
});

test('⭐ C3 成長曲線：閂 `history` → 唔會出 view；開返就有（其餘欄位唔受影響）', () => {
  const history = [
    { at: 0, total: 1000, stats: STATS },
    { at: 60000, total: 1200, stats: STATS },
  ];
  const on = hudState({ score: SCORE, stats: STATS, history });
  assert.ok(on.history, '有兩筆樣本 → 一定要出 view');
  assert.equal(on.history.delta, 200);
  assert.ok(on.history.points.length >= 2);

  const off = hudState({ score: SCORE, stats: STATS, history, display: allOff({ history: false }) });
  assert.equal(off.history, null, '閂咗就唔出（renderer 見到 null 就唔畫）');
  assert.deepEqual(off.summary, on.summary, '閂曲線唔可以連累其他嘢');
  assert.deepEqual(off.lines, on.lines);

  // 冇樣本（未育成／啱啱開程式）→ null，唔可以出半截 view
  assert.equal(hudState({ score: SCORE, stats: STATS, history: [] }).history, null);
  assert.equal(hudState({ score: SCORE, stats: STATS }).history, null, '舊呼叫唔傳 → null（行為不變）');
});
