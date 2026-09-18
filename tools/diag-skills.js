/**
 * 技能畫面（畫面 B）結構偵察。
 *
 * ## 目標（Phase 2）
 *
 * 由「賽馬娘詳情 → 技能」截圖自動讀出**已學技能清單**，咁 HUD 就可以出真實總分
 * （而家係 `技能分 ？／總分 ≥ X`）。
 *
 * ## 為何要獨立一支工具
 *
 * 技能畫面嘅結構同育成主畫面面板條**完全唔同**（唔係 5 個數字，而係一列列
 * 「icon ＋ 技能名 ＋ Lv／◯◎」）。所以第一步係量清楚：
 *   - 固定比例（闊高、行高、行距、左邊界）—— 遊戲只有固定 16:9（見 AGENTS 地雷 #24）
 *   - 每行嘅結構（icon 喺邊、字喺邊、右邊有咩）
 *   - 有冇捲軸／一頁幾行
 *
 * 用法：
 *   node tools/diag-skills.js <png>             # 尺寸 + 行結構 + 文字行
 *   node tools/diag-skills.js <png> --lines     # 逐行墨點 profile
 *   node tools/diag-skills.js <png> --gray=y0,y1[,x0,x1]   # 文字版灰度圖
 *   node tools/diag-skills.js <png> --all       # 全部技能截圖一齊比較
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from '../src/vision/png.js';
import { buildInkMask } from '../src/vision/inkmask.js';
import { findSkillRows, rowInkProfile, columnSpans } from '../src/vision/skillscreen.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith('--'));

if (args.includes('--all')) {
  for (const f of readdirSync(join(ROOT, 'shots', 'gt')).filter((n) => n.includes('-skills'))) {
    files.push(join('shots', 'gt', f));
  }
}
if (!files.length) {
  console.error('用法：node tools/diag-skills.js <png...> [--lines] [--gray=y0,y1[,x0,x1]]');
  process.exit(1);
}

/**
 * 逐行墨點數（用 `skillscreen.js` 嘅參數，同偵測器完全同一條路）。
 */
function rowProfile(image, options = {}) {
  return rowInkProfile(image, options);
}

const grayArg = args.find((a) => a.startsWith('--gray='));
const showLines = args.includes('--lines');

for (const rel of files) {
  let img;
  try {
    img = decodePng(readFileSync(join(ROOT, rel)));
  } catch (error) {
    console.log(`${basename(rel)}　❌ 讀唔到：${error.message}`);
    continue;
  }
  const image = { data: img.data, width: img.width, height: img.height };
  console.log(`\n=== ${basename(rel)}　${img.width}×${img.height}　比例 ${(img.height / img.width).toFixed(4)}　(16:9 = 0.5625) ===`);

  if (grayArg) {
    const parts = grayArg.slice('--gray='.length).split(',');
    const y0 = +parts[0];
    const y1 = +parts[1];
    const x0 = parts[2] !== undefined ? +parts[2] : 0;
    const x1 = parts[3] !== undefined ? +parts[3] : img.width - 1;
    // 太闊就每 n 個 pixel 取一個（純文字輸出限制）
    const step = Math.max(1, Math.ceil((x1 - x0 + 1) / 150));
    const ramp = ' .:-=+*#%@';
    console.log(`灰度圖 y ${y0}..${y1}　x ${x0}..${x1}（每 ${step}px 取樣，@ = 最暗）`);
    for (let y = y0; y <= Math.min(y1, img.height - 1); y += 1) {
      let s = '';
      for (let x = x0; x <= Math.min(x1, img.width - 1); x += step) {
        const p = (y * img.width + x) * 4;
        const lum = (0.299 * img.data[p] + 0.587 * img.data[p + 1] + 0.114 * img.data[p + 2]) / 255;
        s += ramp[Math.min(ramp.length - 1, Math.floor(lum * ramp.length))];
      }
      console.log(String(y).padStart(4) + ' ' + s);
    }
    continue;
  }

  const { counts, mask } = rowProfile(image);
  const lines = findSkillRows(counts, img.width, img.height, { unit: scale.unit });
  console.log(`技能列 ${lines.length} 條（相對版面）：`);
  for (const l of lines) {
    const spans = columnSpans(mask, img.width, l.y0, l.y1);
    const detail = spans
      .map((s) => `x${s.x0}-${s.x1}(${(s.x0 / img.width).toFixed(3)}-${(s.x1 / img.width).toFixed(3)})`)
      .join('　');
    console.log(
      `   y ${String(l.y0).padStart(4)}..${String(l.y1).padStart(4)}` +
      `（${(l.y0 / img.height).toFixed(4)}..${(l.y1 / img.height).toFixed(4)}）` +
      `　墨 ${String(l.ink).padStart(6)}　${spans.length} 欄：${detail}`,
    );
  }

  if (showLines) {
    console.log('逐行墨點（每行都印，最多 400 行）：');
    for (let y = 0; y < Math.min(img.height, 400); y += 1) {
      if (!counts[y]) continue;
      console.log(`${String(y).padStart(4)} ${String(counts[y]).padStart(5)} ${'#'.repeat(Math.min(80, Math.ceil(counts[y] / 12)))}`);
    }
  }
}
