/**
 * `src/hud/writable-root.js` 嘅單元測試（**獨立審計 M2**）。
 *
 * 為何要：呢個決策**冇第二次機會** —— 揀錯路徑嘅症狀係「用戶按咗儲存，下次開程式
 * 讀唔返」或者**打包版一寫檔就爆**（`ROOT` 喺唯讀 asar 入面 → `ENOTDIR`／`EROFS`），
 * 而兩者都係靜默嘅。呢度守住三件事：
 *   ① 兩邊（設定檔／dump）**真係**用同一個決策同同一組 enum；
 *   ② `why` 文案**由呼叫方提供**（兩個模組嘅文案刻意唔同，唔准喺模組度寫死）；
 *   ③ 「唔夠資料就 throw」（唔准靜默 fallback 去其他位置）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { WRITABLE_ROOT_WHERE, resolveWritableRoot } from '../src/hud/writable-root.js';
import { CONFIG_PATH_WHERE } from '../src/hud/config-path.js';
import { WRITE_ROOT_WHERE } from '../src/hud/write-root.js';

const WHY = { whyDev: 'DEV', whyPackaged: 'PKG', whyAsar: 'ASAR' };
const ROOT = 'C:\\proj';
const USER_DATA = 'C:\\Users\\me\\AppData\\Roaming\\umapyoi';

test('writable-root：兩邊嘅 enum 係**同一個** object（唔准各自一份走樣）', () => {
  assert.equal(CONFIG_PATH_WHERE, WRITABLE_ROOT_WHERE);
  assert.equal(WRITE_ROOT_WHERE, WRITABLE_ROOT_WHERE);
  assert.ok(Object.isFrozen(WRITABLE_ROOT_WHERE), '要 frozen：唔准有嘢喺 runtime 改佢');
  assert.deepEqual(Object.keys(WRITABLE_ROOT_WHERE), ['devRoot', 'packagedUserData']);
  assert.equal(WRITABLE_ROOT_WHERE.devRoot, 'dev-root');
  assert.equal(WRITABLE_ROOT_WHERE.packagedUserData, 'packaged-userData');
});

test('writable-root：開發模式 → 專案根；打包 → userData；未打包但喺 .asar → userData', () => {
  const dev = resolveWritableRoot({ isPackaged: false, rootDir: ROOT, userDataDir: USER_DATA, ...WHY });
  assert.deepEqual(dev, { root: ROOT, where: WRITABLE_ROOT_WHERE.devRoot, why: 'DEV' });

  const pkg = resolveWritableRoot({ isPackaged: true, rootDir: ROOT, userDataDir: USER_DATA, ...WHY });
  assert.deepEqual(pkg, { root: USER_DATA, where: WRITABLE_ROOT_WHERE.packagedUserData, why: 'PKG' });

  for (const rootDir of ['C:\\proj\\resources\\app.asar', 'C:\\proj\\resources\\app.asar\\']) {
    const asar = resolveWritableRoot({ isPackaged: false, rootDir, userDataDir: USER_DATA, ...WHY });
    assert.deepEqual(asar, { root: USER_DATA, where: WRITABLE_ROOT_WHERE.packagedUserData, why: 'ASAR' });
  }
});

test('writable-root：`why` 一定要嚟自呼叫方（兩個模組嘅文案刻意唔同）', () => {
  const a = resolveWritableRoot({ isPackaged: false, rootDir: ROOT, whyDev: '設定檔：唔入 git' });
  const b = resolveWritableRoot({ isPackaged: false, rootDir: ROOT, whyDev: 'dump：raw-to-png 直接用' });
  assert.equal(a.why, '設定檔：唔入 git');
  assert.equal(b.why, 'dump：raw-to-png 直接用');
  assert.notEqual(a.why, b.why);
});

test('writable-root：唔夠資料就 throw，唔准靜默揀第二個位', () => {
  assert.throws(() => resolveWritableRoot({ isPackaged: false, ...WHY }), /rootDir/);
  assert.throws(() => resolveWritableRoot({ isPackaged: false, rootDir: '', ...WHY }), /rootDir/);
  assert.throws(() => resolveWritableRoot({ isPackaged: true, rootDir: ROOT, ...WHY }), /userDataDir/);
  assert.throws(() => resolveWritableRoot({ isPackaged: false, rootDir: 'x/app.asar', ...WHY }), /userDataDir/);
});
