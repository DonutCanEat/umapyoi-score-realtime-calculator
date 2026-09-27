/**
 * 「外部技能名單 → 比對技能庫」嘅單元測試（`src/umascore/skilllist-diff.js`）。
 *
 * 為何要測：呢個係「補技能庫」嘅**唯一**判斷步驟 —— 過濾規則太鬆會夾到效果句／UI 字詞
 * （當成「新技能」），太緊會漏真技能（永遠唔會補）。兩個方向都會靜默出錯，所以要有測試釘住。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeSkillName } from '../src/umascore/whatif.js';
import { classifyPaste, diffAgainstDb, MAX_NAME_LEN } from '../src/umascore/skilllist-diff.js';

const DB = [
  { name: '弧線的教授', simplifiedName: '弧线的教授' },
  { name: '順時針◎', simplifiedName: '顺时针◎' },
  { name: '1000萬%輸出！！', simplifiedName: '1000万%输出！！' },
];

test('分類：真技能名 → candidates；「…的固有技能」→ prerequisites；「…的進化技能」→ evolution', () => {
  const r = classifyPaste([
    '弧線的教授',
    '1000萬%輸出！！',
    '魯道夫象徵 (慶典) 的固有技能',
    '風霜高潔',
    '魯道夫象徵 (慶典) 的進化技能',
  ]);
  assert.deepEqual(r.candidates, ['弧線的教授', '1000萬%輸出！！', '風霜高潔']);
  assert.deepEqual(r.prerequisites, ['魯道夫象徵 (慶典) 的固有技能']);
  assert.deepEqual(r.evolution, ['魯道夫象徵 (慶典) 的進化技能']);
});

test('分類：UI 字詞／側欄名（支援卡）唔准當技能', () => {
  const r = classifyPaste(['1. 技能目錄', 'Discord', '無聲鈴鹿', '機伶金花', '賽馬娘@GameTora']);
  assert.deepEqual(r.candidates, []);
  assert.equal(r.dropped.length, 5);
});

test('分類：效果句各行各款都要剔走', () => {
  const r = classifyPaste([
    '變得擅長順時針賽道',
    '若力量十分強大時速度上升若力量鍛鍊到十二分充足時速度大幅上升＜沙地＞',
    '在支持度第4以下的競賽中會容易發揮能力',
    '因為感覺自己朝日本第一的賽馬娘更進一步而稍微變得容易發揮能力',
    '面對不能輸的競賽感到焦慮速度、持久力和智力極大幅下降',
  ]);
  assert.deepEqual(r.candidates, [], `全部都要當效果句，實得 ${JSON.stringify(r.candidates)}`);
});

test('分類：⭐ 數字開頭嘅真技能名唔准被剔（第一版用 /^\\d/ 會誤殺 `1000萬%輸出！！`）', () => {
  const r = classifyPaste(['1000萬%輸出！！', '1000％輸出！', '113跌倒114爬起', '777']);
  assert.deepEqual(r.candidates, ['1000萬%輸出！！', '1000％輸出！', '113跌倒114爬起', '777']);
});

test('分類：日期（10月1日）要剔，但「最長技能名」（9 字）要留', () => {
  const r = classifyPaste(['10月1日', '競賽的精髓・體能', 'A'.repeat(MAX_NAME_LEN + 1)]);
  assert.deepEqual(r.candidates, ['競賽的精髓・體能']);
  assert.equal(r.dropped.length, 2);
});

test('比對：已喺技能庫（含簡體名）→ inDb；未記錄 → missing', () => {
  const r = diffAgainstDb(['弧線的教授', '顺时针◎', '新技能甲'], DB, normalizeSkillName, []);
  assert.deepEqual(r.inDb.sort(), ['弧線的教授', '顺时针◎'].sort());
  assert.deepEqual(r.missing, ['新技能甲']);
  assert.deepEqual(r.inGaps, []);
});

test('比對：已記錄喺缺口檔 → inGaps（唔會當「新發現」重複報）', () => {
  const r = diffAgainstDb(['新技能甲'], DB, normalizeSkillName, [{ name: '新技能甲' }]);
  assert.deepEqual(r.inGaps, ['新技能甲']);
  assert.deepEqual(r.missing, []);
});

test('比對：空名單 → 全部空（唔可以 throw）', () => {
  const r = diffAgainstDb([], DB, normalizeSkillName, []);
  assert.deepEqual(r.candidates, []);
  assert.deepEqual(r.missing, []);
});
