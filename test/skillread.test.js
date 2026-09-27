/**
 * 技能名候選庫比對（`src/vision/skillread.js`）嘅單元測試。
 *
 * 為何要呢個檔：呢條係「讀技能」嘅**最後一關** —— 認錯一招就靜默錯分，
 * 而專案核心價值係「顯示嘅數同遊戲一模一樣」。三條底線：
 *   ① 分數唔夠（< 0.95）→ **唔准出數**；
 *   ② 最佳／次佳差距太細（< 0.05）→ **唔准出數**（實測 63/112 格係咁）；
 *   ③ 庫項未配名 → 唔准用 id 當名。
 *
 * ⚠️ 呢個檔用**合成特徵**（唔開圖）：真圖嘅驗收係 `node tools/read-skills.js --gate`。
 * ⚠️ 合成向量一定要同真特徵**同長度**（`GW × GRID_H`，見 `skillname.js`）——
 *    長度唔同 `cosineSimilarity()` 會讀到 `undefined` → 出 `NaN`（實測踩過，
 *    症狀係「分數係 null／NaN 但唔 throw」）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { GW, GRID_H } from '../src/vision/skillname.js';
import {
  LIB_WIDTH_TOL,
  MIN_INK_WIDTH,
  READ_AMBIGUOUS_MARGIN,
  READ_MATCH,
  buildSkillNameIndex,
  matchSkillName,
  readSkillNames,
} from '../src/vision/skillread.js';

const LEN = GW * GRID_H;

/**
 * 砌一個「已去均值 ＋ 單位化」嘅向量，令 `cosine(結果, vec(1)) === cos`：
 * `out[0] = cos`、`out[1] = sin`（同一個 anchor）→ 呢兩個向量同 `vec(1)` 嘅點積就係 `cos`。
 * 其餘格全 0 → 加咗常數之後完全冇影響點積。
 */
function vec(cos) {
  const out = new Float32Array(LEN);
  out[0] = cos;
  out[1] = Math.sqrt(Math.max(0, 1 - cos * cos)) || 1e-9;
  out[LEN - 1] = 1e-9; // 保證 norm ≠ 0
  return out;
}

const item = (id, name, v, bw = 120, bh = 26) => ({ id, name, bw, bh, vec: v });

test('合成向量長度 === 真特徵長度（唔係就會出 NaN）', () => {
  assert.equal(vec(1).length, GW * GRID_H);
});

// ─────────────────────── 門檻常數 ───────────────────────

test('門檻：認到係 0.95、唔唯一差距係 0.05（同 docs 實測一致）', () => {
  assert.equal(READ_MATCH, 0.95);
  assert.equal(READ_AMBIGUOUS_MARGIN, 0.05);
  assert.equal(LIB_WIDTH_TOL, 6);
  assert.ok(MIN_INK_WIDTH >= 1);
});

// ─────────────────────── 認得到 ───────────────────────

test('唯一高分 → 出 name（有分數、有 margin）', () => {
  const probe = vec(1);
  const index = [item('n0000', '弧線的教授', probe), item('n0001', '直線加速', vec(0.3))];
  const hit = matchSkillName({ vec: probe, bw: 120, bh: 26 }, index);
  assert.equal(hit.name, '弧線的教授');
  assert.equal(hit.uncertain, false);
  assert.equal(hit.reason, null);
  assert.ok(Math.abs(hit.bestScore - 1) < 1e-6, `bestScore 應該係 1，實得 ${hit.bestScore}`);
  assert.ok(hit.margin >= READ_AMBIGUOUS_MARGIN);
});

test('分數唔夠（best < 0.95）→ 唔准出數', () => {
  // ⚠️ 一定要令「庫項同 probe 嘅點積」＜ 0.95：`vec(c)` 係**單位向量**，
  //    所以 `vec(1)` 撞 `vec(1)` 永遠係 1.0（同 c 冇關）—— 呢個位實測踩過。
  const probe = vec(0.8);
  const index = [item('n0000', '弧線的教授', vec(1)), item('n0001', '直線加速', vec(0.2))];
  const hit = matchSkillName({ vec: probe, bw: 120, bh: 26 }, index);
  assert.equal(hit.name, null, '分數唔夠就係唔夠，唔准硬出一個名');
  assert.equal(hit.uncertain, true);
  assert.match(hit.reason, /分數不足/);
});

test('⭐ 最佳／次佳差距 < 0.05 → 唔准出數（呢個係最易靜默錯分嘅位）', () => {
  const probe = vec(1);
  const index = [item('n0000', '弧線的教授', probe), item('n0001', '中距離直線◎', vec(0.98))];
  const hit = matchSkillName({ vec: probe, bw: 120, bh: 26 }, index);
  assert.equal(hit.name, null);
  assert.equal(hit.uncertain, true);
  assert.match(hit.reason, /唔唯一/);
  assert.equal(hit.candidates.length, 2, '要列出候選畀人核');
});

test('庫項未配名（name 為 null）→ 唔准用 id 當名', () => {
  const probe = vec(1);
  const index = [item('n0000', null, probe), item('n0001', '直線加速', vec(0.3))];
  const hit = matchSkillName({ vec: probe, bw: 120, bh: 26 }, index);
  assert.equal(hit.name, null);
  assert.equal(hit.uncertain, true);
  assert.match(hit.reason, /未配名/);
  assert.equal(hit.best.id, 'n0000', '但係要講得出係邊個庫項');
});

// ─────────────────────── 粗篩同防呆 ───────────────────────

test('粗篩：墨跡闊度差 > 6px 嘅庫項唔會入候選（唔同字數）', () => {
  const probe = vec(1);
  const index = [item('n0000', '短名', probe, 40), item('n0001', '命中嗰個', probe, 120)];
  const hit = matchSkillName({ vec: probe, bw: 120, bh: 26 }, index);
  assert.equal(hit.best.id, 'n0001');
  assert.equal(hit.candidates.length, 1, '闊度差太遠嘅唔應該出現喺候選');
});

test('粗篩：全部候選都闊度差太遠 → 當冇候選（唔係亂揀一個）', () => {
  const probe = vec(1);
  const hit = matchSkillName({ vec: probe, bw: 120, bh: 26 }, [item('n0000', '短名', probe, 40)]);
  assert.equal(hit.name, null);
  assert.match(hit.reason, /冇候選/);
});

test('防呆：冇特徵／墨跡太窄／空索引 都要安全回報（唔可以 throw）', () => {
  assert.match(matchSkillName(null, []).reason, /冇特徵/);
  assert.match(matchSkillName({ vec: vec(1), bw: 2, bh: 26 }, [item('a', 'x', vec(1))]).reason, /太窄/);
  assert.match(matchSkillName({ vec: vec(1), bw: 120, bh: 26 }, []).reason, /冇候選/);
});

// ─────────────────────── 砌索引 ───────────────────────

test('砌索引：名框抽唔到（框空／冇 firstSeen）要入 skipped，唔准靜默掉', () => {
  const image = { data: new Uint8ClampedArray(4 * 20 * 20), width: 20, height: 20 };
  const mask = new Uint8Array(20 * 20);
  const { items, skipped } = buildSkillNameIndex(
    [
      { id: 'nobox', name: '乙', firstSeen: { y0: 4, y1: 12 } },
      { id: 'alsobad', name: '丙', firstSeen: { box: { x0: 2, x1: 10 }, y0: 4, y1: 12 } },
    ],
    () => ({ image, mask, unit: 25 }),
  );
  assert.deepEqual(skipped.map((s) => s.id), ['nobox', 'alsobad'], '全黑遮罩抽唔到墨跡 → 兩項都要報');
  assert.equal(items.length, 0);
});

test('砌索引：頁面讀唔到 → skipped 講明（唔准當「冇問題」）', () => {
  const { items, skipped } = buildSkillNameIndex(
    [{ id: 'a', name: '甲', firstSeen: { box: { x0: 1, x1: 5 }, y0: 1, y1: 5 } }],
    () => null,
  );
  assert.equal(items.length, 0);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /讀唔到/);
});

test('砌索引：有墨跡 → 入庫，特徵長度同頁面一致', () => {
  const width = 60;
  const height = 30;
  const image = { data: new Uint8ClampedArray(width * height * 4), width, height };
  const mask = new Uint8Array(width * height);
  for (let y = 10; y < 20; y += 1) for (let x = 5; x < 25; x += 1) mask[y * width + x] = 1;
  const { items } = buildSkillNameIndex(
    [{ id: 'a', name: '甲', firstSeen: { page: 'x.png', box: { x0: 3, x1: 30 }, y0: 8, y1: 22 } }],
    () => ({ image, mask, unit: 25 }),
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].vec.length, LEN);
  assert.equal(items[0].bw, 20);
});

// ─────────────────────── readSkillNames 接線 ───────────────────────

test('readSkillNames：逐格都帶分數／唔確定旗標（空框唔出格）', () => {
  const width = 60;
  const height = 30;
  const image = { data: new Uint8ClampedArray(width * height * 4), width, height };
  const mask = new Uint8Array(width * height);
  for (let y = 10; y < 20; y += 1) for (let x = 5; x < 25; x += 1) mask[y * width + x] = 1;

  const profile = { counts: new Int32Array(width), mask, scale: { unit: 25 } };
  const ops = {
    findSkillRows: () => [{ y0: 8, y1: 22 }],
    nameBoxesInRow: () => [{ x0: 3, x1: 30 }, { x0: 33, x1: 55 }],
  };
  // 用真特徵做庫項（唔可以用合成向量：真特徵嘅 bw=20）
  const { items: index } = buildSkillNameIndex(
    [{ id: 'n0000', name: '弧線的教授', firstSeen: { box: { x0: 3, x1: 30 }, y0: 8, y1: 22 } }],
    () => ({ image, mask, unit: 25 }),
  );
  const { rows, names } = readSkillNames(image, profile, ops, index);

  assert.equal(rows.length, 1);
  assert.equal(names.length, 1, '右邊嗰個框全空 → `nameBoxFeature()` 回 null → 唔應該出格');
  assert.equal(names[0].col, 0);
  assert.equal(names[0].name, '弧線的教授');
  assert.equal(names[0].uncertain, false);
  assert.deepEqual(Object.keys(names[0]).sort(), [
    'bh', 'box', 'bw', 'candidates', 'col', 'margin', 'name',
    'reason', 'row', 'score', 'secondScore', 'uncertain',
  ]);
});

test('readSkillNames：庫項未配名 → 出格但 name 係 null、uncertain', () => {
  const width = 60;
  const height = 30;
  const image = { data: new Uint8ClampedArray(width * height * 4), width, height };
  const mask = new Uint8Array(width * height);
  for (let y = 10; y < 20; y += 1) for (let x = 5; x < 25; x += 1) mask[y * width + x] = 1;
  const profile = { counts: new Int32Array(width), mask, scale: { unit: 25 } };
  const ops = { findSkillRows: () => [{ y0: 8, y1: 22 }], nameBoxesInRow: () => [{ x0: 3, x1: 30 }] };
  const { items: index } = buildSkillNameIndex(
    [{ id: 'n0000', name: null, firstSeen: { box: { x0: 3, x1: 30 }, y0: 8, y1: 22 } }],
    () => ({ image, mask, unit: 25 }),
  );
  const { names } = readSkillNames(image, profile, ops, index);
  assert.equal(names[0].name, null);
  assert.equal(names[0].uncertain, true);
  assert.match(names[0].reason, /未配名/);
});
