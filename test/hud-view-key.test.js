/**
 * 技術債 §9.1-4：`pushHud()` 嘅 dedupe key 以前**冇任何自動閘**。
 *
 * 為何要（真死法）：`pushHud()` 用一個 JSON key 做 dedupe（key 冇變就唔 send）——
 *   加咗新顯示項目但**冇加落 key** ＝ 嗰個欄位永遠唔會更新（HUD 靜默唔郁）。
 *   以前個 key 係寫死喺 `electron/main.js` 入面一個陣列，而 `main.js` 係主程序
 *   （要 Electron runtime）→ **入唔到 `node --test`** → 呢個不變式只靠註釋同人手記住。
 *
 * 正解：欄位清單搬去 `src/hud/layout.js`（純函數，唯一來源），呢個檔由兩邊夾住：
 *   ① 每個欄位一變 → key 一定要變（純函數測試）；
 *   ② `electron/hud.html` 讀嘅**每一個** `view.X` 都要喺清單入面（接線閘）。
 *   兩條加埋 = 「key ⊇ renderer 讀嘅欄位」。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HUD_VIEW_KEY_FIELDS, hudViewKey, hudState } from '../src/hud/layout.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const hudHtml = readFileSync(join(ROOT, 'electron', 'hud.html'), 'utf8');
const mainJs = readFileSync(join(ROOT, 'electron', 'main.js'), 'utf8');

/** 一個「乜都顯示」嘅 view（每個欄位都係非空值，方便逐個改）。 */
function fullView() {
  return {
    state: 'ok',
    total: 26390,
    rank: 'UF5',
    ageMs: 0,
    lines: [{ key: 'total', label: '評價点', value: '26390' }],
    summary: [{ label: '技能分', value: '？' }],
    note: 'ランク UF5',
    edit: '',
    gold: false,
    history: { width: 100, height: 22, points: [{ x: 0, y: 0 }], count: 2, delta: 10, spanMs: 60000, capped: false },
  };
}

test('hudViewKey：每個會顯示嘅欄位一變，key 就要變', () => {
  const base = fullView();
  const baseKey = hudViewKey(base);
  assert.deepEqual(
    [...HUD_VIEW_KEY_FIELDS].sort(),
    ['edit', 'gold', 'history', 'lines', 'note', 'state', 'summary'],
    '欄位清單要同 renderer 真係讀嗰啲對得上',
  );

  const changed = {
    state: 'stale',
    lines: [{ key: 'total', label: '評價点', value: '99' }],
    summary: [{ label: '技能分', value: '123' }],
    note: '唔見面板條',
    edit: '對位模式',
    gold: true,
    history: { ...base.history, delta: 20 },
  };
  for (const [field, value] of Object.entries(changed)) {
    assert.notEqual(
      hudViewKey({ ...base, [field]: value }),
      baseKey,
      `⛔ ${field} 變咗但 key 冇變 → 嗰個欄位永遠唔會更新（就係「HUD 唔郁」嘅死法）`,
    );
  }
  // 反方向：唔喺清單入面嘅欄位（例如只有主程序自己用嘅 total／rank／ageMs）唔應該影響 key
  assert.equal(hudViewKey({ ...base, total: 1, rank: 'G', ageMs: 12345 }), baseKey);
});

test('hudViewKey：真 hudState() 出嘅 view 都守得住（唔係淨係靠手砌假 view）', () => {
  const args = {
    stats: [1846, 1074, 1179, 965, 1390],
    updatedAt: 1000,
    now: 1200,
    edit: false,
    layout: null,
    display: null,
    gold: false,
    skillRead: null,
    history: [],
  };
  const score = { total: 26390, rank: 'UF5', statScore: 26390, skillScore: null, source: 'result' };
  const ok = hudState({ ...args, score });
  assert.equal(hudViewKey(ok), hudViewKey({ ...ok }), '同一個 view 兩次 key 要一樣（真 dedupe 靠佢）');
  // 每個欄位真係存在（打錯字／漏傳會即刻喺度現形）
  for (const field of HUD_VIEW_KEY_FIELDS) {
    assert.ok(field in ok, `hudState() 冇出 \`${field}\` —— key 清單同 view 唔一致`);
  }
  // 停滯（stale）＋ 有歷史 → key 一定要同上面唔同（唔係嘅話 HUD 唔會轉狀態／唔會畫線）
  const stale = hudState({ ...args, score, now: 999999, history: [{ at: 1000, total: 1, stats: args.stats }, { at: 2000, total: 2, stats: args.stats }] });
  assert.notEqual(hudViewKey(stale), hudViewKey(ok));
});

test('接線閘：`electron/hud.html` 讀嘅每一個 `view.X` 都要喺 dedupe key 入面', () => {
  const used = new Set();
  const re = /\bview\.([A-Za-z_$][\w$]*)/g;
  for (const m of hudHtml.matchAll(re)) used.add(m[1]);
  assert.ok(used.size >= 5, `由 hud.html 抽唔到 view 欄位（抽到 ${used.size} 個）—— 個閘壞咗`);
  for (const field of used) {
    assert.ok(
      HUD_VIEW_KEY_FIELDS.includes(field),
      `⛔ hud.html 讀 \`view.${field}\` 但 dedupe key 冇佢 → 佢永遠唔會更新`,
    );
  }
});

test('接線閘：`main.js` 一定要用 hudViewKey()，唔准自己再砌一條欄位陣列', () => {
  assert.match(mainJs, /hudViewKey\(view\)/, 'pushHud() 應該經 `hudViewKey(view)` 砌 key');
  assert.doesNotMatch(
    mainJs,
    /JSON\.stringify\(\[\s*view\./,
    '⛔ main.js 又再自己砌 key 陣列 → 兩條清單會靜默分叉（呢個閘就係要擋呢件事）',
  );
});
