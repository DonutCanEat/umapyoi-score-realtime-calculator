/**
 * `src/hud/write-root.js` 嘅單元測試（**A9 打包**）。
 *
 * 為何要：打包之後 `ROOT` ＝ `…/resources/app.asar`（唯讀），
 * 但 `main.js` 仲會寫 dump 幀（讀唔清嗰陣）同連拍 PNG ——
 * 用 `ROOT` 就會 `ENOTDIR`／`EROFS`，而且係喺「已經有問題嗰陣」才爆（最差嘅時機）。
 * 呢個決策抽成純函數守，唔可以靠開 Electron 才驗得到。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import { WRITE_ROOT_WHERE, underWriteRoot, writeRootFor } from '../src/hud/write-root.js';

const ROOT = 'C:\\proj';
const USER_DATA = 'C:\\Users\\me\\AppData\\Roaming\\UmapyoiScoreRealtimeCalculator';

test('write-root：開發模式 → 專案根（同以前一樣，dump 睇得到）', () => {
  const r = writeRootFor({ isPackaged: false, rootDir: ROOT, userDataDir: USER_DATA });
  assert.equal(r.root, ROOT);
  assert.equal(r.where, WRITE_ROOT_WHERE.devRoot);
  assert.match(r.why, /開發模式/);
});

test('write-root：打包模式 → userData（asar 唯讀，寫唔入）', () => {
  const r = writeRootFor({ isPackaged: true, rootDir: join(ROOT, 'resources', 'app.asar'), userDataDir: USER_DATA });
  assert.equal(r.root, USER_DATA);
  assert.equal(r.where, WRITE_ROOT_WHERE.packagedUserData);
  assert.match(r.why, /userData/);
});

test('write-root：`ROOT` 落喺 .asar 就算 isPackaged=false 都要用 userData（同 config-path 一致）', () => {
  for (const rootDir of ['C:\\proj\\resources\\app.asar', 'C:\\proj\\resources\\app.asar\\']) {
    const r = writeRootFor({ isPackaged: false, rootDir, userDataDir: USER_DATA });
    assert.equal(r.root, USER_DATA, `rootDir=${rootDir}`);
    assert.equal(r.where, WRITE_ROOT_WHERE.packagedUserData);
    assert.match(r.why, /asar/);
  }
});

test('write-root：唔准靜默 fallback（缺 rootDir／userDataDir 要 throw）', () => {
  assert.throws(() => writeRootFor({ isPackaged: false }), /rootDir/);
  assert.throws(() => writeRootFor({ isPackaged: true, rootDir: ROOT }), /userDataDir/);
  assert.throws(
    () => writeRootFor({ isPackaged: true, rootDir: join(ROOT, 'app.asar') }),
    /userDataDir/,
  );
});

test('write-root：underWriteRoot 砌得出兩個真實目錄，而且空 root 要 throw', () => {
  const { root } = writeRootFor({ isPackaged: true, rootDir: ROOT, userDataDir: USER_DATA });
  assert.equal(underWriteRoot(root, 'shots', 'live-debug'), join(USER_DATA, 'shots', 'live-debug'));
  assert.equal(underWriteRoot(root, 'shots', 'skill-dump'), join(USER_DATA, 'shots', 'skill-dump'));
  assert.throws(() => underWriteRoot('', 'shots'), /非空字串/);
  assert.throws(() => underWriteRoot(undefined, 'shots'), /非空字串/);
});
