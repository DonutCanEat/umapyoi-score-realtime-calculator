/**
 * 「擷取來源」挑選邏輯嘅單元測試。
 *
 * 為何要（用戶 2026-09-19 實機報嘅 bug）：舊做法係
 * `sources.find((s) => hints.some((h) => s.name.includes(h)))`，而本程式設定窗標題
 * 「賽馬娘即時評價分 — HUD 設定」一樣含「賽馬娘」→ **擷取咗自己個設定窗**。
 * 症狀離奇（全黑畫面、`fullWidth/fullHeight` 變咗設定窗大細、HUD 拖位範圍縮到
 * 半個螢幕），但**完全唔會報錯** → 所以一定要有閘。
 *
 * ⚠️ 呢個檔嘅頭號測試係「回歸：設定窗標題含遊戲關鍵字，都唔准揀佢」——
 * 唔准因為「而家已經排除咗」而刪走。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GAME_TITLE_HINTS,
  matchScore,
  pickGameSource,
  windowHandleOf,
} from '../src/capture/source.js';

/** 砌一個 `desktopCapturer` 風格嘅來源。 */
const src = (name, hwnd) => ({ id: `window:${hwnd}:0`, name });

test('windowHandleOf：解析 `window:<hwnd>:0`，唔合法一律 null（唔 throw）', () => {
  assert.equal(windowHandleOf('window:123456:0'), 123456);
  assert.equal(windowHandleOf(' window:42:0 '), 42);
  assert.equal(windowHandleOf('screen:0:0'), null);
  assert.equal(windowHandleOf('window:abc:0'), null);
  assert.equal(windowHandleOf('window:123456'), null);
  assert.equal(windowHandleOf(''), null);
  assert.equal(windowHandleOf(undefined), null);
  assert.equal(windowHandleOf(null), null);
  assert.equal(windowHandleOf({}), null);
});

test('matchScore：完全相符 > 開頭 > 包含 > 唔中', () => {
  assert.equal(matchScore('umamusume'), 3);
  assert.equal(matchScore('  UMAMUSUME  '), 3);
  assert.equal(matchScore('プリティーダービー 攻略', ['プリティーダービー']), 2);
  assert.equal(matchScore('賽馬娘 攻略 - Google Chrome', ['賽馬娘']), 2); // 開頭相符
  assert.equal(matchScore('攻略wiki 賽馬娘 - Google Chrome', ['賽馬娘']), 1); // 只係包含
  assert.equal(matchScore('記事本', GAME_TITLE_HINTS), 0);
  assert.equal(matchScore('', GAME_TITLE_HINTS), 0);
  assert.equal(matchScore(undefined, GAME_TITLE_HINTS), 0);
  // 空關鍵字唔可以令任何標題「中」（否則 `''` 會變萬能 match）
  assert.equal(matchScore('記事本', ['', '   ']), 0);
});

test('⭐ 回歸：設定窗標題含「賽馬娘」而且排第一，都一定要揀遊戲', () => {
  const sources = [
    src('賽馬娘即時評價分 — HUD 設定', 111), // 本程式自己，z-order 喺最前
    src('Umapyoi HUD', 222),
    src('Umapyoi 擷取', 333),
    src('umamusume', 444), // 遊戲本體
  ];
  const { hit, rejected } = pickGameSource(sources, {
    ownIds: ['window:111:0', 222, 333],
    ownTitles: ['賽馬娘即時評價分 — HUD 設定', 'Umapyoi HUD', 'Umapyoi 擷取'],
  });
  assert.equal(hit.name, 'umamusume', '唔可以揀自己個設定窗');
  assert.equal(hit.id, 'window:444:0');
  // 自己嘅窗要明確記錄「點解排除」，唔准靜默掉走
  const why = Object.fromEntries(rejected.map((r) => [r.name, r.why]));
  assert.equal(why['賽馬娘即時評價分 — HUD 設定'], 'own-window-title');
  // ⚠️ 兩重排除嘅**次序**係刻意嘅：標題行先（唔靠任何 handle 格式），handle 做後盾。
  //    所以呢度只要求「兩個自己嘅窗都有明確原因」，唔鎖死係邊一重
  //    （handle 路徑由下面「排除條件①」專門守住）。
  assert.ok(
    ['own-window-title', 'own-window-handle'].includes(why['Umapyoi HUD']),
    `自己嘅 HUD 窗一定要有排除原因，實得 ${why['Umapyoi HUD']}`,
  );
  assert.ok(['own-window-title', 'own-window-handle'].includes(why['Umapyoi 擷取']));
  assert.equal(rejected.length, 3, '三個自己嘅窗都要出現喺「排除」清單');
});

test('排除條件①：靠 HWND（唔靠標題）—— 標題改咗都照樣排除', () => {
  const sources = [src('賽馬娘 攻略', 111), src('ウマ娘 プリティーダービー', 999)];
  // 刻意唔傳 ownTitles：模擬「標題比對失效」
  const { hit, rejected } = pickGameSource(sources, { ownIds: [111] });
  assert.equal(hit.id, 'window:999:0');
  assert.deepEqual(rejected, [{ id: 'window:111:0', name: '賽馬娘 攻略', why: 'own-window-handle' }]);
});

test('排除條件②：靠標題 —— handle 解析唔到都唔會揀到自己', () => {
  const sources = [
    { id: '(唔係 window 格式)', name: 'Umapyoi HUD' },
    { id: '(唔係 window 格式)', name: 'umamusume' },
  ];
  // `ownIds` 全部解析唔到 → 唯一防線就係 ownTitles
  const { hit } = pickGameSource(sources, { ownIds: ['(唔係 window 格式)'], ownTitles: ['Umapyoi HUD'] });
  assert.equal(hit.name, 'umamusume');
});

test('瀏覽器攻略頁（只係「包含」）唔可以贏遊戲本體（「完全相符」）', () => {
  const sources = [
    // ⚠️ 刻意令關鍵字**唔喺開頭**：開頭會變「開頭相符」（2 分），唔係呢條測試想驗嘅「包含」（1 分）
    src('攻略wiki 賽馬娘 - Google Chrome', 111),
    src('umamusume', 222),
  ];
  const { hit, candidates } = pickGameSource(sources);
  assert.equal(hit.name, 'umamusume');
  assert.deepEqual(candidates.map((c) => c.score), [3, 1]);
});

test('⭐ 回歸：實機見到嘅遊戲標題要係「完全相符」，唔可以同攻略頁同分', () => {
  // 用戶 2026-09-18 實機 log：`[來源] 揀咗：賽馬娘Pretty Derby（分數 2）`
  // → 2 分 = 同「賽馬娘 攻略…」嘅瀏覽器窗**同分**，同分就跟 z-order 亂咁揀。
  assert.equal(matchScore('賽馬娘Pretty Derby', GAME_TITLE_HINTS), 3,
    '實機遊戲標題一定要係「完全相符」（3 分）');
  assert.equal(matchScore('ウマ娘 プリティーダービー', GAME_TITLE_HINTS), 2);
  assert.ok(matchScore('賽馬娘 攻略wiki - Google Chrome', GAME_TITLE_HINTS) < 3,
    '瀏覽器攻略頁一定要低過遊戲本體');
  // 實機情況：遊戲同攻略頁同一個 z-order 清單入面，攻略頁排前面都唔可以贏
  const { hit } = pickGameSource([
    src('賽馬娘 攻略wiki - Google Chrome', 111),
    src('賽馬娘Pretty Derby', 222),
  ]);
  assert.equal(hit.name, '賽馬娘Pretty Derby');
});

test('同分保留 `getSources()` 原本次序（穩定排序，唔准「有時 A 有時 B」）', () => {
  const sources = [
    src('賽馬娘 A', 111),
    src('賽馬娘 B', 222),
    src('賽馬娘 C', 333),
  ];
  assert.equal(pickGameSource(sources).hit.name, '賽馬娘 A');
  assert.equal(pickGameSource([...sources].reverse()).hit.name, '賽馬娘 C');
});

test('一個都唔中 → hit 係 null，而且每個候選都有記錄（唔准靜默）', () => {
  const sources = [src('記事本', 111), src('小畫家', 222)];
  const { hit, candidates, rejected } = pickGameSource(sources);
  assert.equal(hit, null);
  assert.deepEqual(candidates, []);
  assert.deepEqual(rejected.map((r) => r.why), ['no-hint', 'no-hint']);
  assert.equal(rejected.length, sources.length, '每個來源都要交代去咗邊');
});

test('輸入唔完整（空清單／null／缺欄位）一律唔 throw', () => {
  for (const input of [[], null, undefined, [{}], [{ id: 'window:1:0' }], [{ name: 'umamusume' }]]) {
    const out = pickGameSource(input);
    assert.ok(out && 'hit' in out && Array.isArray(out.candidates) && Array.isArray(out.rejected));
  }
  // `id` 缺咗但標題中關鍵字 → 一樣要揀得到（id 係空字串）
  assert.equal(pickGameSource([{ name: 'umamusume' }]).hit.name, 'umamusume');
});

test('排除清單唔可以反過來排除遊戲本體（清單本身要保持乾淨）', () => {
  // 「遊戲標題就係關鍵字」→ 唔准有「標題含關鍵字就排除」呢種寫法
  const { hit } = pickGameSource([src('ウマ娘 プリティーダービー', 111)], { ownIds: [222] });
  assert.equal(hit.id, 'window:111:0');
});
