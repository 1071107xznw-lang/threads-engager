import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStore } from '../src/store.mjs';
import { connectAccount, saveBrand, setupStatus, disconnectAccount } from '../src/setup.mjs';

function fakeApi() {
  return {
    async exchangeLongLivedToken({ shortLivedToken, appSecret }) {
      assert.equal(shortLivedToken, 'short');
      assert.equal(appSecret, 'sec');
      return { access_token: 'LONG', expires_in: 60 * 24 * 3600 };
    },
    async getProfile({ accessToken }) {
      assert.equal(accessToken, 'LONG');
      return { id: '123', username: 'someone', name: 'Some One' };
    },
  };
}

test('connectAccount：換長期 token、抓帳號、寫入 store', async () => {
  const store = createStore(':memory:');
  const res = await connectAccount({ store, appSecret: 'sec', shortToken: 'short', api: fakeApi(), now: 0 });
  assert.equal(res.username, 'someone');
  assert.equal(res.userId, '123');
  assert.equal(store.getSetting('appSecret'), 'sec');
  assert.equal(store.getSetting('userId'), '123');
  assert.equal(store.getSetting('username'), 'someone');
  assert.equal(store.getToken().accessToken, 'LONG');
  store.close();
});

test('connectAccount 缺欄位 → 400', async () => {
  const store = createStore(':memory:');
  await assert.rejects(
    () => connectAccount({ store, appSecret: '', shortToken: 'x', api: fakeApi() }),
    (e) => { assert.equal(e.status, 400); return true; }
  );
  store.close();
});

test('saveBrand：寫檔、只留白名單欄位、標記完成', () => {
  const store = createStore(':memory:');
  const p = join(tmpdir(), `brand-test-${process.pid}.json`);
  saveBrand({ store, configPath: p, brand: { brandName: '測試店', persona: 'x', tags: ['a'], evil: 'DROP', replyDailyCap: 5 } });
  const written = JSON.parse(readFileSync(p, 'utf8'));
  assert.equal(written.brandName, '測試店');
  assert.equal(written.replyDailyCap, 5);
  assert.equal(written.evil, undefined); // 白名單外欄位不寫入
  assert.equal(store.getSetting('setupComplete'), '1');
  rmSync(p, { force: true });
  store.close();
});

test('saveBrand 缺品牌名 → 400', () => {
  const store = createStore(':memory:');
  assert.throws(
    () => saveBrand({ store, configPath: join(tmpdir(), 'x.json'), brand: {} }),
    (e) => { assert.equal(e.status, 400); return true; }
  );
  store.close();
});

// 讓不同帳號各自記住風格：A→B→A 切回來還原 A 的設定
function fakeApiFor(id, username) {
  return {
    async exchangeLongLivedToken() { return { access_token: 'LONG_' + id, expires_in: 60 * 24 * 3600 }; },
    async getProfile() { return { id, username, name: username }; },
  };
}

test('每帳號記住自己的風格：切走快照、切回自動還原', async () => {
  const store = createStore(':memory:');
  const p = join(tmpdir(), `brand-multi-${process.pid}.json`);

  // 連 A、設定 A 的風格
  await connectAccount({ store, appSecret: 'sec', shortToken: 'short', api: fakeApiFor('A1', 'alpha'), configPath: p });
  saveBrand({ store, configPath: p, brand: { brandName: 'Alpha 店', tags: ['調酒'], persona: 'A 的口吻' } });
  assert.equal(JSON.parse(readFileSync(p, 'utf8')).brandName, 'Alpha 店');

  // 切走（快照 A）→ 連 B、設定 B 的風格
  disconnectAccount({ store, configPath: p });
  await connectAccount({ store, appSecret: 'sec2', shortToken: 'short', api: fakeApiFor('B2', 'beta'), configPath: p });
  saveBrand({ store, configPath: p, brand: { brandName: 'Beta 咖啡', tags: ['咖啡'], persona: 'B 的口吻' } });
  assert.equal(JSON.parse(readFileSync(p, 'utf8')).brandName, 'Beta 咖啡');

  // 切走（快照 B）→ 切回 A：應自動還原 A 的風格、且不必再走品牌步驟
  disconnectAccount({ store, configPath: p });
  const back = await connectAccount({ store, appSecret: 'sec', shortToken: 'short', api: fakeApiFor('A1', 'alpha'), configPath: p });
  assert.equal(back.brandExists, true, '切回 A 應偵測到既有風格');
  assert.equal(store.getSetting('setupComplete'), '1', '有既有風格 → 直接完成，跳過品牌步驟');
  const restored = JSON.parse(readFileSync(p, 'utf8'));
  assert.equal(restored.brandName, 'Alpha 店', '切回 A 應還原 A 的品牌名');
  assert.deepEqual(restored.tags, ['調酒']);

  rmSync(p, { force: true });
  store.close();
});

test('新帳號沒有既有風格 → brandExists=false，走品牌步驟', async () => {
  const store = createStore(':memory:');
  const p = join(tmpdir(), `brand-new-${process.pid}.json`);
  const r = await connectAccount({ store, appSecret: 'sec', shortToken: 'short', api: fakeApiFor('NEW', 'newbie'), configPath: p });
  assert.equal(r.brandExists, false);
  assert.notEqual(store.getSetting('setupComplete'), '1'); // 尚未設定品牌
  rmSync(p, { force: true });
  store.close();
});

test('setupStatus 反映連接與品牌完成狀態', () => {
  const store = createStore(':memory:');
  assert.deepEqual(setupStatus({ store, env: {} }), { connected: false, brandDone: false });
  store.setSetting('appSecret', 's');
  store.setToken('t', null);
  store.setSetting('setupComplete', '1');
  assert.deepEqual(setupStatus({ store, env: {} }), { connected: true, brandDone: true });
  store.close();
});
