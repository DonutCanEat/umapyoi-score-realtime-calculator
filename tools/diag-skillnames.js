/**
 * 驗證：技能名嘅**影像**喺唔同截圖之間一唔一致（Phase 2 成敗關口）。
 *
 * ## 背景
 *
 * 我哋冇遊戲字型檔、冇 1300 招標註樣本 → 做唔到通用 OCR。
 * 但如果「同一個技能名抽出嚟嘅影像」跨圖一致（相似度明顯高），
 * 就可以行「名稱影像比對候選名單」呢條路。
 *
 * ## 做法
 *
 * 用**人手標註**嘅 (圖, 列, 欄) → 技能名（`data/skill-name-labels.json`），
 * 計「同名對」同「唔同名對」嘅相似度分佈，睇兩者有冇明顯分界。
 *
 * ⚠️ 標註係由截圖**肉眼讀**出嚟（我睇圖 + JSON 對照），所以有可能錯；
 *    但因為只係用嚟驗證「同一串字嘅影像係唔係穩定」，錯一兩個唔影響結論。
 *
 * 用法：
 *   node tools/diag-skillnames.js            # 跑驗證
 *   node tools/diag-skillnames.js --boxes    # 順便印所有抽出嘅框
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from '../src/vision/png.js';
import { cosineSimilarity, standardize } from '../src/vision/similarity.js';
import { rowInkProfile, findSkillRows, nameBoxesInRow } from '../src/vision/skillscreen.js';
import { hasFlag, toolArgs } from './lib/args.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// ⚠️ 參數讀法住喺 `tools/lib/args.js`（審計 M6）
const args = toolArgs();
const showBoxes = hasFlag(args, 'boxes');
const showWidths = hasFlag(args, 'widths');
// 名框 → 特徵網格。
// ⚠️ 唔可以「拉伸到固定闊度」：名框係**左對齊**，右邊留白長度跟頁面最長名 →
//    拉伸會令「短名 + 好多空白」同「長名」變成一樣 → 實測唔同名都有 1.000 相似度。
// 正解：① 先去墨跡邊界（tight box）；② 按**高度**等比縮放、左對齊放入網格
//      （闊度留白自然編碼「名有幾長」）。
const GH = 24;
const GW = 240; // 夠放入 8 個中文字（每字 ≈ GH 闊）
const NAME_LEVEL_GAP = 10; // 名同右邊 Lv 之間嘅空位（像素）；≥ 就切

const LABELS = JSON.parse(readFileSync(join(ROOT, 'data', 'skill-name-labels.json'), 'utf8'));

/** 由一張圖抽出「每個技能列、左右兩欄」嘅名框（連遮罩，畀 normalize 用）。 */
function extractNames(rel) {
  const img = decodePng(readFileSync(join(ROOT, rel)));
  const image = { data: img.data, width: img.width, height: img.height };
  const { counts, mask, scale } = rowInkProfile(image);
  const rows = findSkillRows(counts, img.width, img.height, { unit: scale.unit });
  const out = [];
  for (const [ri, row] of rows.entries()) {
    const cols = new Int32Array(img.width);
    for (let y = row.y0; y <= row.y1; y += 1) {
      const base = y * img.width;
      for (let x = 0; x < img.width; x += 1) cols[x] += mask[base + x];
    }
    for (const [ci, box] of nameBoxesInRow(cols, img.width).entries()) {
      if (!box) continue;
      const feat = normalize(image, box, row.y0, row.y1, mask);
      if (!feat) continue;
      out.push({
        row: ri,
        col: ci,
        box,
        rawWidth: box.x1 - box.x0 + 1,
        width: feat.width,
        height: feat.height,
        ratio: feat.ratio,
        vec: feat.vec,
      });
    }
  }
  return { names: out, size: `${img.width}×${img.height}` };
}

/**
 * 名框 → 特徵。
 *
 * 步驟：① 框內揾「墨跡有幾闊」（唔理框嘅右邊留白）；② 如果右邊有一大段空位
 * （≥ `NAME_LEVEL_GAP`），當佢係 `Lv4`／`★3` 之類 → 切走（唔係名嘅一部分）；
 * ③ 再去 tight box；④ 按**高度**等比縮放、左對齊放入 GH×GW 網格。
 *
 * ⚠️ 墨跡 = 「暗」像素（技能名係棕色暗字喺中淺色漸變底）。**唔理顏色**，
 *    因為底色跟技能類型變（見 AGENTS 地雷 #10 同 §6.5）。
 */
function normalize(image, box, y0, y1, mask) {
  const { x0, x1 } = box;
  const h = y1 - y0 + 1;
  const cols = new Int32Array(x1 - x0 + 1);
  for (let y = y0; y <= y1; y += 1) {
    const base = y * image.width;
    for (let x = x0; x <= x1; x += 1) cols[x - x0] += mask[base + x];
  }
  // 右邊 Lv／★ 段：由右邊掃，揾最右邊一個「闊 ≥ NAME_LEVEL_GAP 嘅空洞」→ 切
  let rightEnd = cols.length - 1;
  let gap = 0;
  for (let i = cols.length - 1; i >= 0; i -= 1) {
    if (cols[i] === 0) { gap += 1; continue; }
    if (gap >= NAME_LEVEL_GAP && i < cols.length - 1) { rightEnd = i; break; }
    gap = 0;
  }
  // tight box（左右墨跡邊界、上下墨跡邊界）
  let inkL = -1;
  let inkR = -1;
  for (let i = 0; i <= rightEnd; i += 1) if (cols[i] > 0) { inkL = i; break; }
  for (let i = rightEnd; i >= 0; i -= 1) if (cols[i] > 0) { inkR = i; break; }
  if (inkL < 0) return null;
  let inkT = -1;
  let inkB = -1;
  const rowInk = new Int32Array(h);
  for (let y = y0; y <= y1; y += 1) {
    const base = y * image.width;
    let n = 0;
    for (let x = x0 + inkL; x <= x0 + inkR; x += 1) n += mask[base + x];
    rowInk[y - y0] = n;
    if (n > 0) { if (inkT < 0) inkT = y - y0; inkB = y - y0; }
  }
  if (inkT < 0) return null;
  const bw = inkR - inkL + 1;
  const bh = inkB - inkT + 1;
  const out = new Float32Array(GW * GH);
  // 等比：scale = GH / bh，左對齊（唔拉伸）
  const scale = GH / bh;
  for (let gy = 0; gy < GH; gy += 1) {
    const sy = y0 + inkT + Math.min(bh - 1, Math.floor(gy / scale));
    for (let gx = 0; gx < GW; gx += 1) {
      const sx = x0 + inkL + Math.floor(gx / scale);
      if (sx > x0 + inkR) break;
      out[gy * GW + gx] = mask[sy * image.width + sx] ? 1 : 0;
    }
  }
  // 輕微模糊（抗一像素位移）：同一串字唔會每次落喺完全相同嘅整數格
  const blur = new Float32Array(GW * GH);
  for (let gy = 0; gy < GH; gy += 1) {
    for (let gx = 0; gx < GW; gx += 1) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const yy = gy + dy;
        if (yy < 0 || yy >= GH) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const xx = gx + dx;
          if (xx < 0 || xx >= GW) continue;
          s += out[yy * GW + xx] * (dy === 0 && dx === 0 ? 4 : dy === 0 || dx === 0 ? 2 : 1);
        }
      }
      blur[gy * GW + gx] = s;
    }
  }
  return { vec: blur, width: bw, height: bh, ratio: bw / bh, tight: { inkL, inkR, inkT, inkB } };
}

// ⚠️ `standardize()` 同相似度以前喺呢個檔自己寫一套（同 `src/vision/similarity.js`
//    逐字一樣）→ 已改用共用實作（獨立審計 M8）。`sim` 係檔內短名，保留做別名，
//    下面幾十處唔使改。
const sim = cosineSimilarity;

// ── 逐張圖抽名框，再按標註配上去 ──
const shots = [...new Set(LABELS.labels.map((l) => l.shot))];
const extracted = new Map();
for (const shot of shots) {
  const rel = `shots/gt/${shot}`;
  if (!existsSync(join(ROOT, rel))) {
    console.error(`⚠️ 冇 ${rel}`);
    continue;
  }
  extracted.set(shot, extractNames(rel));
}

const entries = [];
for (const label of LABELS.labels) {
  const got = extracted.get(label.shot);
  if (!got) continue;
  const hit = got.names.find((n) => n.row === label.row && n.col === label.col);
  if (!hit) {
    console.error(`⚠️ ${label.shot} 列${label.row}欄${label.col} 抽唔到名框（${label.name}）`);
    continue;
  }
  entries.push({
    ...label,
    ...hit,
    vec: standardize(hit.vec),
  });
  if (showBoxes) {
    console.log(
      `  ${label.shot} 列${label.row}欄${label.col}　名框 x ${hit.box.x0}..${hit.box.x1}` +
      `　墨跡闊 ${hit.width}×${hit.height}（高闊比 ${hit.ratio.toFixed(2)}）　${label.name}`,
    );
  }
}

if (showWidths) {
  const byRatio = [...entries].sort((a, b) => a.ratio - b.ratio);
  console.log('\n=== 墨跡高闊比（＝名有幾長；細 = 短名）===');
  for (const e of byRatio) {
    console.log(`  ${e.ratio.toFixed(2)}　${e.width}×${e.height}　${e.name}　（${e.shot.slice(0, 8)} 列${e.row}欄${e.col}）`);
  }
}

console.log(`\n抽出 ${entries.length} 個標註名框（${shots.length} 張圖，每張 ${LABELS.labels.length / shots.length} 個）`);
console.log(`圖大細：${[...extracted.entries()].map(([s, g]) => `${s}=${g.size}`).join('　')}`);

const same = [];
const diff = [];
for (let i = 0; i < entries.length; i += 1) {
  for (let j = i + 1; j < entries.length; j += 1) {
    if (entries[i].shot === entries[j].shot) continue; // 同圖唔算（要跨圖）
    const s = sim(entries[i].vec, entries[j].vec);
    if (entries[i].name === entries[j].name) same.push({ s, a: entries[i], b: entries[j] });
    else diff.push({ s, a: entries[i], b: entries[j] });
  }
}
same.sort((x, y) => y.s - x.s);
diff.sort((x, y) => y.s - x.s);

const stat = (arr) => {
  if (!arr.length) return '（冇）';
  const v = arr.map((x) => x.s).sort((a, b) => a - b);
  return `n=${v.length}　min ${v[0].toFixed(3)}　p25 ${v[Math.floor(v.length * 0.25)].toFixed(3)}　` +
    `p50 ${v[Math.floor(v.length * 0.5)].toFixed(3)}　p75 ${v[Math.floor(v.length * 0.75)].toFixed(3)}　max ${v[v.length - 1].toFixed(3)}`;
};

console.log('\n=== 同名（跨圖）相似度 ===');
console.log(stat(same));
console.log('\n=== 唔同名（跨圖）相似度 ===');
console.log(stat(diff));

console.log('\n=== 同名配對明細（最高 12 個）===');
for (const x of same.slice(0, 12)) {
  console.log(
    `  ${x.s.toFixed(3)}　${x.a.name.padEnd(12)}　${x.a.shot} 列${x.a.row}欄${x.a.col} ↔ ${x.b.shot} 列${x.b.row}欄${x.b.col}`,
  );
}
console.log('\n=== 唔同名但有啲似（最高 12 個，睇下有冇撞）===');
for (const x of diff.slice(0, 12)) {
  console.log(
    `  ${x.s.toFixed(3)}　「${x.a.name}」↔「${x.b.name}」　${x.a.shot}列${x.a.row}欄${x.a.col} ↔ ${x.b.shot}列${x.b.row}欄${x.b.col}`,
  );
}

// 結論：有冇一個門檻可以分開兩邊
const sameMin = same.length ? same[same.length - 1].s : NaN;
const diffMax = diff.length ? diff[0].s : NaN;
console.log('\n=== 分界 ===');
console.log(`同名最差 ${sameMin.toFixed(3)}　唔同名最好 ${diffMax.toFixed(3)}`);
console.log(
  sameMin > diffMax
    ? `✅ 完全分得開（安全邊界 ${(sameMin - diffMax).toFixed(3)}）→ 「名稱影像比對」可行`
    : `⚠️ 有重疊 → 要加強特徵（例如按字數分組、切字元後比對）`,
);
