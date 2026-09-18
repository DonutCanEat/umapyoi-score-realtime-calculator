import test from 'node:test';
import assert from 'node:assert/strict';

import { detectStatPanel, roiFromPanel, longestPinkRun } from '../src/vision/anchor.js';

/** 砌一張假圖：中間有一條粉紅標題列 + 白色格，其餘係綠色背景。 */
function makeImage({ width = 400, height = 300, left = 50, right = 349, headerTop = 100, headerHeight = 20, bodyHeight = 40 } = {}) {
  const data = new Uint8ClampedArray(width * height * 4);
  const put = (x, y, r, g, b) => {
    const i = (y * width + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let color = [90, 170, 80]; // 背景綠
      if (x >= left && x <= right) {
        if (y >= headerTop && y < headerTop + headerHeight) color = [233, 92, 130]; // 粉紅
        else if (y >= headerTop + headerHeight && y < headerTop + headerHeight + bodyHeight) color = [250, 250, 250]; // 白格
      }
      put(x, y, color[0], color[1], color[2]);
    }
  }
  return { data, width, height };
}

test('longestPinkRun：揾到最長嘅粉紅連續段', () => {
  const img = makeImage();
  const run = longestPinkRun(img.data, img.width, 105, 0, img.width - 1, 50);
  assert.equal(run.start, 50);
  assert.equal(run.length, 300);
});

test('longestPinkRun：唔夠長就當揾唔到', () => {
  const img = makeImage();
  const run = longestPinkRun(img.data, img.width, 105, 0, img.width - 1, 500);
  assert.equal(run.start, -1);
});

test('detectStatPanel：揾到面板 bounding box 同標題列高度', () => {
  const img = makeImage();
  const panel = detectStatPanel(img);
  assert.ok(panel, '應該偵測到面板');
  assert.equal(panel.x, 50);
  assert.equal(panel.y, 100);
  assert.equal(panel.width, 300);
  assert.deepEqual([panel.headerHeight, panel.height], [20, 60]);
  assert.ok(panel.confidence > 0.5);
});

test('detectStatPanel：冇粉紅帶就回 null', () => {
  const img = makeImage();
  // 將標題列全部改成背景色
  for (let y = 100; y < 120; y += 1) {
    for (let x = 50; x <= 349; x += 1) {
      const i = (y * img.width + x) * 4;
      img.data[i] = 90; img.data[i + 1] = 170; img.data[i + 2] = 80;
    }
  }
  assert.equal(detectStatPanel(img), null);
});

test('detectStatPanel：唔同大細（等比縮放）都要偵測到', () => {
  for (const scale of [0.5, 1, 1.8]) {
    const img = makeImage({
      width: Math.round(400 * scale),
      height: Math.round(300 * scale),
      left: Math.round(50 * scale),
      right: Math.round(350 * scale) - 1,
      headerTop: Math.round(100 * scale),
      headerHeight: Math.max(2, Math.round(20 * scale)),
      bodyHeight: Math.max(3, Math.round(40 * scale)),
    });
    const panel = detectStatPanel(img);
    assert.ok(panel, `scale ${scale} 應該偵測到`);
    assert.ok(Math.abs(panel.x - 50 * scale) <= 2, `scale ${scale} 左邊界`);
  }
});

test('roiFromPanel：相對比例換算成像素', () => {
  const panel = { x: 100, y: 200, width: 400, height: 80 };
  assert.deepEqual(roiFromPanel(panel, { x: 0.25, y: 0.5, width: 0.1, height: 0.25 }), {
    x: 200,
    y: 240,
    width: 40,
    height: 20,
  });
});
