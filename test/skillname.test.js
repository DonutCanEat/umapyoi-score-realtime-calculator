/**
 * 技能名「影像特徵」嘅單元測試。
 *
 * 呢個模組嘅核心價值係：**同名嘅影像要似、唔同名要唔似**。
 * 而呢件事有兩個實測撞過嘅陷阱（見 AGENTS §6.5）：
 *  ① 把名框**拉伸**到固定闊度 → 短名＋空白被拉成同長名一樣（唔同名撞 1.000）；
 *  ② 去 tight box 後**按自己高度縮放** → 所有名框高度一樣 → 任何框都撐滿網格（一樣撞 1.000）。
 * 所以測試重點唔係「某個數字」，而係**呢三個不變量**：
 *  A. 同一串字（唔同框闊、唔同位置）→ 特徵一樣（相似度 1.000）
 *  B. 唔同長度／唔同字 → 明顯唔似
 *  C. 左邊嘅 `Lv4`／`★` 徽章要被剔走，唔可以影響特徵
 *
 * 用合成圖（畫實心方塊當「字」），唔靠實機截圖。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { solidImage } from './helpers/image.js';

import {
  nameBoxFeature,
  nameSimilarity,
  trimNameSegments,
  GRID_H,
  GW,
} from '../src/vision/skillname.js';

const BG = [233, 229, 245];
const TEXT = [128, 74, 20];

// ⚠️ 砌底色 buffer 呢一步住喺 `test/helpers/image.js`（審計 L2）
const makeImage = (width, height) => solidImage(width, height, BG);

function paint(image, x0, y0, w, h, color = TEXT) {
  for (let y = y0; y < y0 + h; y += 1) {
    if (y < 0 || y >= image.height) continue;
    for (let x = x0; x < x0 + w; x += 1) {
      if (x < 0 || x >= image.width) continue;
      const p = (y * image.width + x) * 4;
      image.data[p] = color[0]; image.data[p + 1] = color[1]; image.data[p + 2] = color[2];
    }
  }
}

/** 由原圖砌一個「墨 = 暗像素」嘅遮罩（同 `inkmask.js` 嘅成品形狀一樣）。 */
function maskOf(image) {
  const mask = new Uint8Array(image.width * image.height);
  for (let i = 0; i < mask.length; i += 1) {
    const p = i * 4;
    const lum = (0.299 * image.data[p] + 0.587 * image.data[p + 1] + 0.114 * image.data[p + 2]) / 255;
    mask[i] = lum < 0.7 ? 1 : 0;
  }
  return mask;
}

/**
 * 畫一行「技能列」：可選左邊畫一個徽章（模擬 `Lv4` + ★）。
 * 每個「字」係一塊 charW × charH 嘅實心方塊，字距 2px（同實機一樣窄）。
 */
function makeRow({
  chars = 4, charW = 24, charH = 22, badge = null, badgeGap = 12, width = 600, boxPad = 6,
} = {}) {
  const image = makeImage(width, 60);
  const top = 20;
  let x = 20;
  if (badge) {
    // 徽章 = 兩塊窄方塊（模擬「Lv」+ 數字），闊度細過一個字
    const bw = Math.round(charW * 0.55);
    paint(image, x, top, bw, charH);
    paint(image, x + bw + 2, top, Math.round(bw * 0.7), charH);
    x += bw + 2 + Math.round(bw * 0.7) + badgeGap;
  }
  const nameX = x;
  for (let c = 0; c < chars; c += 1) {
    paint(image, x, top, charW, charH);
    x += charW + 2;
  }
  const nameW = x - 2 - nameX;
  const mask = maskOf(image);
  // 名框（模擬 `nameBoxesInRow()` 嘅輸出：左對齊、右邊留白）
  const box = { x0: 20 - boxPad, x1: 20 - boxPad + (badge ? nameW + (nameX - 20) : nameW) + boxPad };
  return { image, mask, box, y0: top - 4, y1: top + charH + 4, nameW, nameX };
}

const feat = (row) => nameBoxFeature(row.image, row.mask, row.box, row.y0, row.y1);

test('skillname：同一串字（唔同框闊、唔同起點）→ 特徵完全一樣', () => {
  const a = feat(makeRow({ chars: 4, boxPad: 6 }));
  const b = feat(makeRow({ chars: 4, boxPad: 40 })); // 右邊留白多好多（同一頁最長名唔同）
  assert.ok(a && b, '兩個都應該抽到特徵');
  assert.equal(a.bw, b.bw, '墨跡闊度應該一樣（唔受框闊影響）');
  assert.ok(nameSimilarity(a.vec, b.vec) > 0.999, `同一串字應該幾乎一樣（實得 ${nameSimilarity(a.vec, b.vec).toFixed(4)}）`);
});

test('skillname：⚠️ 唔同字數唔可以撞分（」拉伸到固定闊度」嘅陷阱）', () => {
  const four = feat(makeRow({ chars: 4 }));
  const two = feat(makeRow({ chars: 2 }));
  const s = nameSimilarity(four.vec, two.vec);
  assert.ok(s < 0.9, `2 字同 4 字唔應該似（實得 ${s.toFixed(3)}；拉伸做法會變 1.000）`);
  assert.ok(four.bw > two.bw * 1.5, `4 字墨跡要明顯闊過 2 字（${four.bw} vs ${two.bw}）`);
});

test('skillname：⚠️ 同字數但唔同字唔可以撞分', () => {
  // 「字」唔同 → 畫成唔同闊度／位置嘅方塊
  const a = feat(makeRow({ chars: 4, charW: 24 }));
  const b = feat(makeRow({ chars: 4, charW: 15 }));
  const s = nameSimilarity(a.vec, b.vec);
  assert.ok(s < 0.95, `同字數唔同字唔應該當同一招（實得 ${s.toFixed(3)}）`);
});

test('skillname：左邊嘅 Lv／★ 徽章會被剔走（唔影響特徵）', () => {
  const plain = feat(makeRow({ chars: 4 }));
  const withBadge = feat(makeRow({ chars: 4, badge: true }));
  assert.ok(withBadge, '有徽章都要抽到特徵');
  // 徽章係另一段（空隙 ≥ 12px）→ 應該被剔走，墨跡闊度同冇徽章一樣
  assert.equal(withBadge.bw, plain.bw, `徽章唔應該計入名（${withBadge.bw} vs ${plain.bw}）`);
  const s = nameSimilarity(plain.vec, withBadge.vec);
  assert.ok(s > 0.99, `剔走徽章之後應該同「冇徽章」一樣（實得 ${s.toFixed(4)}）`);
});

test('skillname：trimNameSegments 剔徽章／揀最闊嗰段／食埋右邊 Lv', () => {
  // 手砌欄投影：徽章(0..20) 空 15px 名(36..120) 空 12px Lv(133..150)
  const cols = new Int32Array(160);
  for (let i = 0; i <= 20; i += 1) cols[i] = 5;
  for (let i = 36; i <= 120; i += 1) cols[i] = 9;
  for (let i = 133; i <= 150; i += 1) cols[i] = 3;
  const span = trimNameSegments(cols, 160);
  // 左邊嘅窄前綴（徽章）剔走；名 = 最闊嗰段；右邊短段（Lv）被食埋
  assert.deepEqual(span, { from: 36, to: 150 }, `實得 ${JSON.stringify(span)}`);
});

test('skillname：冇墨 → null（唔可以亂認）', () => {
  const empty = new Int32Array(100);
  assert.equal(trimNameSegments(empty, 100), null);
  const blank = makeImage(200, 60);
  const mask = maskOf(blank);
  assert.equal(nameBoxFeature(blank, mask, { x0: 10, x1: 150 }, 10, 50), null);
});

test('skillname：網格夠闊放最長嘅名（實測最闊框 446px）', () => {
  assert.ok(GW >= 460, `網格闊度 ${GW} 要夠放實測最闊嘅框（446px + 餘裕）`);
  assert.ok(GRID_H >= 30, `網格高度 ${GRID_H} 要夠放字身（實測 22–27px）`);
});
