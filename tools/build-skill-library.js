/**
 * 由「技能畫面連拍」嘅一頁頁 PNG，建立**技能名影像庫**（Phase 2 識字用）。
 *
 * ## 流程
 *
 * 1. 逐頁讀 `shots/skill-dump/page-NNNN.png`（用 `UMAPYOI_SKILL_DUMP=1 npm start` 收返嚟）
 * 2. 每頁抽「逐列逐欄」名框（7 列 × 2 欄 = 14 個；`skillscreen.js` 做偵測，
 *    `skillname.js` 做特徵）
 * 3. **跨頁去重分類**：同一招喺相鄰頁會重複出現（清單係順序滾動，兩頁有重疊）→
 *    用相似度 ≥ `--match`（預設 0.95）併成同一個「項目」
 * 4. 每個項目存一個小 PNG（去 tight box 之後嘅原圖像素）＋ `index.json`
 *
 * ## 為何「去重」先係關鍵
 *
 * 我哋唔知道遊戲清單嘅排序，亦冇 1300 招嘅標註樣本。
 * 但清單係**順序滾動**嘅 → 相鄰兩頁一定有重疊 → 用「去重之後嘅項目數」
 * 同「每頁新項目數」就可以**檢查」用戶有冇翻漏頁（例如某頁新項目突然變 14 = 中間跳咗一大段）。
 *
 * ⚠️ 個名仍然要配 —— 呢個工具**只負責建影像庫**（唔會估名）。
 * 配名要另外決定「候選名單邊度嚟」（見 AGENTS §9 待辦）。
 *
 * 用法：
 *   node tools/build-skill-library.js                      # 讀 shots/skill-dump/
 *   node tools/build-skill-library.js --in=shots/skill-dump --out=data/skill-name-lib
 *   node tools/build-skill-library.js --match=0.97 --page=shots/gt/uma1-p1-skills.png
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from '../src/vision/png.js';
import { encodePng } from '../src/vision/pngwrite.js';
import { rowInkProfile, findSkillRows, nameBoxesInRow } from '../src/vision/skillscreen.js';
import { nameBoxesOfPage, nameSimilarity, SKILLNAME_MATCH } from '../src/vision/skillname.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const arg = (name, dflt) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const inDir = join(ROOT, arg('in', 'shots/skill-dump'));
const outDir = join(ROOT, arg('out', 'data/skill-name-lib'));
const MATCH = Number(arg('match', String(SKILLNAME_MATCH)));
// 太細嘅墨跡係雜訊（實測見過 2×8 px）→ 唔入庫
const MIN_INK_W = Number(arg('min-w', '4'));
const MIN_INK_H = Number(arg('min-h', '8'));
// 存檔用嘅圖最闊幾多（太闊就縮；唔影響比對，比對用特徵向量唔用呢張圖）
const MAX_CROP_W = Number(arg('max-w', '260'));
const extraPages = process.argv.slice(2)
  .filter((a) => a.startsWith('--page='))
  .map((a) => join(ROOT, a.slice(7)));

/** 收集要處理嘅圖：目錄入面全部 page-*.png（排序），加任何 --page= 指定嘅圖。 */
function collectPages() {
  const pages = [];
  if (existsSync(inDir)) {
    for (const f of readdirSync(inDir).filter((f) => /^page-\d+\.png$/i.test(f)).sort()) {
      pages.push(join(inDir, f));
    }
  }
  for (const p of extraPages) if (existsSync(p)) pages.push(p);
  return pages;
}

const pages = collectPages();
if (!pages.length) {
  console.error(`⚠️ 冇圖。${inDir} 入面冇 page-NNNN.png。`);
  console.error('   先跑：UMAPYOI_SKILL_DUMP=1 npm.cmd start（然後喺遊戲逐頁翻技能清單）');
  process.exit(1);
}
console.log(`讀 ${pages.length} 頁圖`);

const ops = { findSkillRows, nameBoxesInRow };

/** 已建立嘅項目：{vec, image(細圖), bw, bh, first: {page,row,col}, count, pages:{...}} */
const items = [];
let totalBoxes = 0;
const perPage = [];

for (const path of pages) {
  const img = decodePng(readFileSync(path));
  const image = { data: img.data, width: img.width, height: img.height };
  const profile = rowInkProfile(image);
  const { rows, names } = nameBoxesOfPage(image, profile, ops);
  totalBoxes += names.length;

  let fresh = 0;
  let seen = 0;
  let dropped = 0;
  for (const n of names) {
    // ⚠️ 太細嘅「墨跡」係雜訊（實測見過 2×8 px）→ 唔應該入庫（會污染比對）
    if (n.bw < MIN_INK_W || n.bh < MIN_INK_H) { dropped += 1; continue; }
    let best = null;
    for (const it of items) {
      const s = nameSimilarity(n.vec, it.vec);
      if (!best || s > best.s) best = { s, it };
    }
    if (best && best.s >= MATCH) {
      best.it.count += 1;
      best.it.pages[basename(path)] = true;
      best.it.scores.push(Number(best.s.toFixed(3)));
      // 用「第一個見到嘅樣本」做主模板（同一招跨圖相似度中位數 0.981，唔需要平均）
      seen += 1;
      continue;
    }
    // 新項目：存細圖（tight box，保留原圖色）。
    // ⚠️ 太闊嘅（實測最闊 447px？見下）要縮到 ≤ MAX_CROP_W，否則拼圖／檢視工具會爆格。
    const scaleDown = Math.max(1, Math.ceil(n.bw / MAX_CROP_W));
    const bw = Math.ceil(n.bw / scaleDown);
    const bh = Math.ceil(n.bh / scaleDown);
    const crop = {
      data: new Uint8ClampedArray(bw * bh * 4),
      width: bw,
      height: bh,
    };
    for (let y = 0; y < bh; y += 1) {
      for (let x = 0; x < bw; x += 1) {
        const sx = n.box.x0 + n.inkL + Math.min(n.bw - 1, x * scaleDown);
        const sy = n.y0 + n.inkT + Math.min(n.bh - 1, y * scaleDown);
        const sp = (sy * image.width + sx) * 4;
        const dp = (y * bw + x) * 4;
        crop.data[dp] = image.data[sp];
        crop.data[dp + 1] = image.data[sp + 1];
        crop.data[dp + 2] = image.data[sp + 2];
        crop.data[dp + 3] = 255;
      }
    }
    const id = `n${String(items.length).padStart(4, '0')}`;
    items.push({
      id,
      vec: n.vec,
      crop,
      bw,
      bh,
      first: { page: basename(path), row: n.row, col: n.col },
      count: 1,
      pages: { [basename(path)]: true },
      // 同**已有項目**嘅最高分（未過門檻所以開新項目）。接近門檻嘅要人手覆核。
      nearMiss: best ? Number(best.s.toFixed(3)) : null,
      nearMissId: best ? best.it.id : null,
      scores: [],
    });
    fresh += 1;
  }
  perPage.push({
    page: basename(path),
    size: `${image.width}×${image.height}`,
    rows: rows.length,
    boxes: names.length,
    fresh,
    seen,
    dropped,
  });
  console.log(
    `  ${basename(path)}　${image.width}×${image.height}　${rows.length} 列　` +
    `${names.length} 個名框　新項目 ${fresh}　重複 ${seen}` +
    (dropped ? `　（剔走 ${dropped} 個太細嘅雜訊）` : ''),
  );
}

// ── 存檔 ──
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const imgDir = join(outDir, 'img');
if (!existsSync(imgDir)) mkdirSync(imgDir, { recursive: true });
for (const it of items) {
  writeFileSync(join(imgDir, `${it.id}.png`), encodePng(it.crop));
}

const index = {
  note:
    '技能名影像庫：每項 = 一個技能名嘅影像（tight box、原圖色）。' +
    '⚠️ 未配名（配名要另外決定候選名單邊度嚟，見 AGENTS §9）。' +
    `相似度門檻 ${MATCH}（≥ 就當同一招，實測同名 p25 = 0.936、唔同招上限 0.439）。`,
  matchThreshold: MATCH,
  pages: perPage,
  count: items.length,
  items: items.map((it) => ({
    id: it.id,
    image: `img/${it.id}.png`,
    inkWidth: it.bw,
    inkHeight: it.bh,
    firstSeen: it.first,
    occurrences: it.count,
    pages: Object.keys(it.pages).length,
    // 併入時嘅分數（≥ 門檻先會併）—— 最低嗰幾個要人手覆核
    mergeScores: it.scores.length ? it.scores : null,
    // 開新項目時同最近似已有項目嘅分數（未過門檻）—— 愈近門檻愈要人手覆核
    nearMiss: it.nearMiss ?? null,
    nearMissId: it.nearMissId ?? null,
  })),
};
writeFileSync(join(outDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);

console.log('');
console.log(`共 ${totalBoxes} 個名框 → 去重後 **${items.length} 個項目**`);
const multi = items.filter((it) => it.count > 1).length;
console.log(`其中出現 ≥2 次嘅項目：${multi}　（重疊頁面愈多，呢個數應該愈大）`);

// ── 檢查：有冇翻漏頁 ──
// 相鄰兩頁有重疊 → 每頁「新項目」應該遠少於 14（除非第一頁）。
const suspicious = perPage.slice(1).filter((p) => p.fresh >= p.boxes - 1);
if (suspicious.length) {
  console.log('');
  console.log('⚠️ 以下頁面「新項目」≈ 全部名框 → 可能中間跳咗一段（翻太快／漏頁）：');
  for (const p of suspicious) console.log(`   ${p.page}：${p.fresh}/${p.boxes}`);
} else {
  console.log('✅ 未見「整頁都係新項目」嘅頁 → 睇落冇跳頁');
}

// ── 覆核提示：併入分數最低／新項目最近似門檻嘅，最易係誤併／誤分 ──
const merged = items.filter((it) => it.scores.length)
  .map((it) => ({ id: it.id, s: Math.min(...it.scores), w: it.bw }))
  .sort((a, b) => a.s - b.s);
if (merged.length) {
  console.log('');
  console.log(`併入次數 ≥1 嘅項目：${merged.length}　最低併入分數：`);
  for (const m of merged.slice(0, 8)) console.log(`   ${m.s}　${m.id}（墨跡闊 ${m.w}）`);
}
const near = items.filter((it) => it.nearMiss !== null)
  .sort((a, b) => b.nearMiss - a.nearMiss);
console.log('');
console.log('新項目之中「最接近門檻」嘅（最可能其實係同一招但冇併到）：');
for (const it of near.slice(0, 6)) {
  console.log(`   ${it.nearMiss}　${it.id} ↔ ${it.nearMissId}（墨跡 ${it.bw}×${it.bh}）`);
}
console.log('');
console.log('👉 人手覆核：node tools/skill-lib-sheet.js（拼成一張大圖，睇下同一招有冇重複項目）');
console.log(`寫咗 ${outDir.replace(`${ROOT}\\`, '')}\\index.json ＋ img/${items.length} 個 PNG`);
