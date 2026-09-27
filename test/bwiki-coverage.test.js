/**
 * `src/umascore/bwiki-coverage.js` 嘅測試（純函數，**唔上網**）。
 *
 * ⚠️ fixture 全部由真 cache（`data/bwiki-pages/`）抄落嚟，唔准想像格式。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageKeys, reconcile, mergeable, looksLikeNonSkillPage, describeCoverage } from '../src/umascore/bwiki-coverage.js';

/** 真頁（`繁/`）形狀。 */
const canon = (name, extra = {}) => ({
  pageTitle: `繁/${name}`, nameTw: name, nameCn: null, rarity: '传说', kind: 'normal',
  base: 508, skillPt: 360, desc: '某效果', ...extra,
});
/** 真頁（`继承技/`）形狀。 */
const inh = (name) => ({
  pageTitle: `继承技/${name}`, nameTw: name, nameCn: null, rarity: '普通', kind: 'inherited',
  base: 180, skillPt: 200, desc: '某效果',
});

test('pageKeys：繁簡兩個名都做 key，空白要 trim', () => {
  // ⚠️ `normalizeSkillName()` 會去掉標點（`...`／`.`）→ key 係 `foundyou`／`抓到你了`；
  //    呢個係好事：要同 `data/skill-db-tw.json` 用同一套正規化先對得上。
  assert.deepEqual(pageKeys({ nameTw: '...found you. ', nameCn: ' ...抓到你了. ' }), ['foundyou', '抓到你了']);
  assert.deepEqual(pageKeys({ nameTw: null, nameCn: null }), []);
});

test('reconcile：`繁/` 同名嘅 `继承技/` 唔算歧義（兩個命名空間係兩招唔同嘅嘢）', () => {
  const pages = [canon('...found you.', { nameTw: '...found you.', base: 340, kind: 'unique' }), inh('...found you.')];
  const r = reconcile({ pages });
  assert.equal(r.ambiguous.length, 0, '同名跨命名空間唔係歧義');
  assert.equal(r.canonical, 1);
  assert.equal(r.inherited, 1);
  assert.equal(r.newPages.length, 1, '本庫冇 → `繁/` 嗰頁係新招');
  assert.equal(r.newPages[0].page.base, 340, '新招係 base 340 嗰頁，唔係 180 嗰頁');
});

test('reconcile：同一個命名空間裡面同名兩頁 → 算歧義，兩邊都唔當命中', () => {
  const r = reconcile({ pages: [canon('甲'), canon('甲', { base: 999 })] });
  assert.equal(r.ambiguous.length, 1);
  assert.equal(r.canonical, 0, '歧義唔准入結果');
  assert.equal(r.newPages.length, 0);
});

test('reconcile：本庫用繁體名或簡體名命中都得', () => {
  const pages = [canon('弧線的教授', { nameCn: '弧线的教授' }), canon('新招招', { nameCn: '新招招' })];
  const r = reconcile({ pages, localSkills: [{ name: '弧線的教授', simplifiedName: '弧线的教授' }] });
  assert.equal(r.known, 2, '兩頁都命中（繁簡各一個 key）');
  assert.equal(r.newPages.length, 1);
  assert.equal(r.newPages[0].page.nameTw, '新招招');
  assert.equal(r.newPages[0].matchedKey, null);
});

test('reconcile：本庫只有簡體名都要命中', () => {
  // ⚠️ 呢頁**只有簡體名**（繁體名抽唔到）→ 得一個 key，正好驗「靠簡體名命中」
  const page = { pageTitle: '繁/弧線的教授', nameTw: null, nameCn: '弧线的教授', rarity: '传说', kind: 'normal', base: 508, desc: 'x' };
  const r = reconcile({ pages: [page], localSkills: [{ name: '别的名', simplifiedName: '弧线的教授' }] });
  assert.equal(r.canonical, 1);
  assert.equal(r.known, 1, '簡體名要搵到');
  assert.equal(r.newPages.length, 0);
});

test('reconcile：GameTora 用英文名都可以互相印證', () => {
  const r = reconcile({
    pages: [canon('新招招', { nameCn: null })],
    gametoraSkills: [{ name: 'Brand New Skill', nameEn: '新招招' }],
  });
  assert.equal(r.newPages[0].inGametora, true);
});

test('reconcile：比賽頁（冇名／冇稀有度／冇描述）要剔出統計但列得出嚟', () => {
  const race = { pageTitle: '繁/JBC經典賽(川崎)', nameTw: null, nameCn: null, rarity: null, kind: 'unknown', base: null, desc: null };
  const r = reconcile({ pages: [race, canon('真技能')] });
  assert.equal(r.nonSkillPages.length, 1);
  assert.equal(r.canonical, 1, '比賽頁唔計入技能頁');
  assert.deepEqual(r.nonSkillPages, ['繁/JBC經典賽(川崎)']);
});

test('looksLikeNonSkillPage：唔准用「名以賞／賽／杯結尾」做判準', () => {
  // 有稀有度／有名／有描述就係技能頁，就算個名似比賽
  assert.equal(looksLikeNonSkillPage(canon('有馬紀念賽')), false);
});

test('reconcile：唔認識嘅命名空間要報，唔准靜默當技能', () => {
  const r = reconcile({ pages: [{ pageTitle: '某/嘢', nameTw: '嘢', rarity: '传说', kind: 'normal', base: 1 }] });
  assert.equal(r.other, 1);
  assert.deepEqual(r.unknownNamespace, ['某/嘢']);
  assert.equal(r.canonical, 0);
});

test('mergeable：一般／進化／繼承入得庫，固有唔入得', () => {
  assert.equal(mergeable(canon('一般', { kind: 'normal' })).ok, true);
  assert.equal(mergeable(canon('進化', { kind: 'evolution' })).ok, true);
  assert.equal(mergeable(inh('繼承')).ok, true);
  const u = mergeable(canon('固有', { kind: 'unique', base: 340 }));
  assert.equal(u.ok, false);
  assert.match(u.reason, /★ × Lv/, '要講明為何唔入得');
});

test('mergeable：劇情／活動技能入得庫（base 可以係 0 或者負數）', () => {
  // 實測：`繁/浮上心頭的擔憂` 剧情 base=0、`繁/超愛玩之心` 活动 base=−500
  assert.equal(mergeable(canon('劇情技', { kind: 'story', base: 0 })).ok, true);
  const ev = mergeable(canon('活動技', { kind: 'event', base: -500 }));
  assert.equal(ev.ok, true);
  assert.match(ev.reason, /負/);
});

test('mergeable：冇 base 一律唔入得（唔准填 0，地雷 #4）', () => {
  const m = mergeable(canon('無分', { base: null }));
  assert.equal(m.ok, false);
  assert.match(m.reason, /地雷 #4/);
  assert.equal(mergeable(null).ok, false);
});

test('describeCoverage：摘要要有分母同百分比', () => {
  const r = reconcile({ pages: [canon('甲'), canon('乙')], localSkills: [{ name: '甲' }] });
  const lines = describeCoverage(r);
  assert.ok(lines.some((l) => l.includes('技能頁 2 個')), `要有分母：${lines.join(' | ')}`);
  assert.ok(lines.some((l) => l.includes('50.0%')));
});
