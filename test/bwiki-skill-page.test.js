/**
 * `src/umascore/bwiki-skill-page.js` 嘅測試（純函數，**唔上網**）。
 *
 * ⚠️ 全部 fixture 都係由**真頁面**抄落嚟嘅文字（2026-09-27 實測），
 *    唔准「想像一個格式」—— 之前就係因為想像格式而漏咗「斜線前後冇空格」嗰種頁。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRarity, pageToText, parseSkillPage } from '../src/umascore/bwiki-skill-page.js';

/** 把純文字包成 bwiki `action=parse` 出嘅 HTML 形狀。 */
const html = (text) => `<div class="mw-parser-output"><p>${text}</p></div>`;

test('parseRarity：獨特／進化／繼承／傳說 各有正確 kind', () => {
  assert.deepEqual(parseRarity('独特'), { rarity: '独特', kind: 'unique' });
  assert.deepEqual(parseRarity('进化'), { rarity: '进化', kind: 'evolution' });
  assert.deepEqual(parseRarity('传说'), { rarity: '传说', kind: 'normal' });
  assert.deepEqual(parseRarity('普通·继承'), { rarity: '普通', kind: 'inherited' });
  assert.deepEqual(parseRarity('固有'), { rarity: '独特', kind: 'unique' });
});

test('parseRarity：只睇第一個詞（⚠️ take:2 會變「传说 条件限制」）', () => {
  // 真頁面係 `稀有度 传说 条件限制 通用` → 如果餵兩個詞就會爆
  assert.deepEqual(parseRarity('传说 条件限制'), { rarity: '传说', kind: 'normal' });
  assert.deepEqual(parseRarity('进化 条件限制'), { rarity: '进化', kind: 'evolution' });
  // 2026-09-27 實測嘅壞值（弧線的教授）—— 修完就唔會再出現
  assert.notEqual(parseRarity('传说 条').rarity, '传说 条');
});

test('parseRarity：唔認識嘅值唔准假裝認識', () => {
  assert.deepEqual(parseRarity('神秘'), { rarity: '神秘', kind: 'unknown' });
  assert.deepEqual(parseRarity(''), { rarity: null, kind: 'unknown' });
  assert.deepEqual(parseRarity(null), { rarity: null, kind: 'unknown' });
});

test('parseRarity：「普通·继承」同「普通」要分開', () => {
  // 「普通·继承」＝普通稀有度嘅**繼承版本**（繼承技 命名空間，base 180、PT 200）
  // → kind = `inherited`；而單純「普通」係圖鑑上一招正常技能 → kind = `normal`。
  assert.equal(parseRarity('普通·继承').kind, 'inherited');
  assert.equal(parseRarity('普通·继承').rarity, '普通');
  assert.equal(parseRarity('普通').kind, 'normal');
  assert.equal(parseRarity('普通').rarity, '普通');
});

test('pageToText：剝 script／style／標籤、還原實體', () => {
  const t = pageToText('<div>a<script>var x=1</script><style>.a{}</style><br>打call&amp;回應&#039;s &lt;b&gt;</div>');
  assert.equal(t, "a 打call&回應's <b>");
});

test('parseSkillPage：進化技（風霜高潔）base／PT／前置／可進化', () => {
  const p = parseSkillPage(html(
    '首页 > 技能图鉴 服务器切换 日服 繁中服 简中服 風霜高潔 / 风霜高洁 稀有度 进化 条件限制 通用 '
    + '图标颜色 绿色 技能描述 變得擅長秋季的競賽 速度和力量大幅上升 触发代码 season==3 触发条件 秋天 '
    + '技能消耗PT 共需技能PT 330 评价分 508 PT评价比 1.54',
  ), { title: '繁/風霜高潔' });
  assert.equal(p.nameTw, '風霜高潔');
  assert.equal(p.nameCn, '风霜高洁');
  assert.equal(p.rarity, '进化');
  assert.equal(p.kind, 'evolution');
  assert.equal(p.base, 508);
  assert.equal(p.skillPt, 330);
  assert.equal(p.ptPerPoint, 1.54);
  assert.equal(p.condition, '通用');
  assert.equal(p.title, '繁/風霜高潔');
});

test('parseSkillPage：技能消耗PT 冇值時要攞「共需技能PT」（唔准攞 null 當 0）', () => {
  const p = parseSkillPage(html('稀有度 传说 技能消耗PT 共需技能PT 360 评价分 508'));
  assert.equal(p.skillPt, 360, '要攞共需技能PT');
  assert.equal(p.base, 508);
});

test('parseSkillPage：冇「评价分」→ base = null（唔准當 0、唔准當 180）', () => {
  const p = parseSkillPage(html('稀有度 传说 技能描述 某嘢 技能消耗PT 共需技能PT 200'));
  assert.equal(p.base, null, '地雷 #4：冇資料就 null，唔准亂填');
  assert.equal(p.skillPt, 200);
});

test('parseSkillPage：固有技（絕對是我）—— 兩個「稀有度」並存時取表格嗰個', () => {
  const p = parseSkillPage(html(
    '服务器切换 日服 繁中服 简中服 絕對是我 / 绝对是我 稀有度 独特 条件限制 通用 '
    + '技能消耗PT 共需技能PT 评价分 340 PT评价比 '
    + '继承技 絕對是我 絕對是我 稀有度 ： 普通·继承 条件限制 ： 通用 评价分 180',
  ));
  assert.equal(p.nameTw, '絕對是我');
  assert.equal(p.kind, 'unique', '表格嘅「独特」先係嗰招本身');
  assert.equal(p.base, 340);
});

test('parseSkillPage：继承技 命名空間 —— 斜線前後冇空格＋名有空格（實測 4/6 頁）', () => {
  const cases = [
    ['继承技/...found you.', '...found you.', '...抓到你了.'],
    ['继承技/Adventure of 564', 'Adventure of 564', '黄金船的奇妙冒险'],
    ['继承技/113転び114起き', '113転び114起き', '跌倒113次爬起114次'],
  ];
  for (const [title, tw, cn] of cases) {
    const p = parseSkillPage(html(
      `编 刷 历 首页 > 技能图鉴 > ${title} 如果是第一次来 服务器切换 日服 繁中服 简中服 `
      + `${tw}/${cn} 稀有度 普通·继承 条件限制 通用 技能消耗PT 共需技能PT 200 评价分 180`,
    ), { title });
    assert.equal(p.nameTw, tw, `${title} 嘅繁體名`);
    assert.equal(p.nameCn, cn, `${title} 嘅簡體名`);
    assert.equal(p.kind, 'inherited', '「普通·继承」→ inherited');
    assert.equal(p.rarity, '普通');
    assert.equal(p.base, 180);
  }
});

test('parseSkillPage：繁體名有空格時唔准截斷（Adventure of 564）', () => {
  const p = parseSkillPage(html('服务器切换 日服 繁中服 简中服 Best day ever/Best day ever 稀有度 传说'));
  assert.equal(p.nameTw, 'Best day ever');
});

test('parseSkillPage：抽唔到名就 null（唔准編一個出嚟）', () => {
  const p = parseSkillPage(html('完全冇關係嘅內容'));
  assert.equal(p.nameTw, null);
  assert.equal(p.nameCn, null);
  assert.equal(p.kind, 'unknown');
  assert.equal(p.base, null);
  assert.equal(p.skillPt, null);
});
