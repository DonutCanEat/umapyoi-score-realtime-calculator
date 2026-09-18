/**
 * HUD 設定檔路徑決策嘅單元測試。
 *
 * 為何要測：呢個決定「用戶按咗儲存之後，下次開程式讀唔讀得返」——
 * 喺 Electron 入面係開 GUI 先發現得嘅錯（而且係靜默錯）。所以抽成純函數嚟測。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import { configPathFor, CONFIG_PATH_WHERE } from '../src/hud/config-path.js';
import { HUD_CONFIG_FILENAME } from '../src/hud/config.js';

test('設定檔路徑：開發模式（未打包）→ 專案根目錄', () => {
  const r = configPathFor({ isPackaged: false, rootDir: 'D:\\proj', userDataDir: 'C:\\Users\\x\\AppData' });
  assert.equal(r.path, join('D:\\proj', HUD_CONFIG_FILENAME));
  assert.equal(r.path, 'D:\\proj\\hud-position.json');
  assert.equal(r.where, CONFIG_PATH_WHERE.devRoot);
  assert.match(r.why, /開發模式/, 'why 要講得出「點解係呢條路徑」（log 用）');
  assert.match(r.why, /app\.isPackaged=false/);
});

test('設定檔路徑：已打包 → userData（專案目錄可能唯讀）', () => {
  const r = configPathFor({
    isPackaged: true,
    rootDir: 'C:\\Program Files\\app\\resources\\app.asar',
    userDataDir: 'C:\\Users\\x\\AppData\\Roaming\\umapyoi',
  });
  assert.equal(r.path, join('C:\\Users\\x\\AppData\\Roaming\\umapyoi', HUD_CONFIG_FILENAME));
  assert.equal(r.where, CONFIG_PATH_WHERE.packagedUserData);
  assert.match(r.why, /userData/);
});

test('設定檔路徑：未打包但專案目錄喺 .asar 入面 → 一樣去 userData（asar 係唯讀）', () => {
  const r = configPathFor({
    isPackaged: false,
    rootDir: 'C:\\x\\resources\\app.asar',
    userDataDir: 'C:\\Users\\x\\AppData\\Roaming\\umapyoi',
  });
  assert.equal(r.where, CONFIG_PATH_WHERE.packagedUserData);
  assert.match(r.why, /asar/);
  assert.ok(!r.path.includes('asar'), '唔可以寫入 asar 入面（一定失敗）');
});

test('設定檔路徑：唔夠資料就 throw，唔准靜默揀第二個位', () => {
  assert.throws(() => configPathFor({ isPackaged: false }), /rootDir/);
  assert.throws(() => configPathFor({ isPackaged: true, rootDir: 'D:\\proj' }), /userDataDir/);
  assert.throws(() => configPathFor({ isPackaged: false, rootDir: '' }), /rootDir/);
});

test('設定檔路徑：檔名可以被覆寫，但唔准帶路徑分隔符', () => {
  const r = configPathFor({ isPackaged: false, rootDir: 'D:\\proj', filename: 'hud-pos.json' });
  assert.equal(r.path, join('D:\\proj', 'hud-pos.json'));
  assert.throws(() => configPathFor({ isPackaged: false, rootDir: 'D:\\proj', filename: 'sub/x.json' }), /分隔符/);
  assert.throws(() => configPathFor({ isPackaged: false, rootDir: 'D:\\proj', filename: 'a\\b.json' }), /分隔符/);
  assert.throws(() => configPathFor({ isPackaged: false, rootDir: 'D:\\proj', filename: '' }), /非空字串/);
});

test('設定檔路徑：預設檔名同 config.js 嘅 HUD_CONFIG_FILENAME 一致（兩邊唔可以走樣）', () => {
  assert.equal(HUD_CONFIG_FILENAME, 'hud-position.json');
  const r = configPathFor({ isPackaged: false, rootDir: 'D:\\proj' });
  assert.ok(r.path.endsWith(HUD_CONFIG_FILENAME));
});
