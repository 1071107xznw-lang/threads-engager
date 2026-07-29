import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStore } from '../src/store.mjs';
import { connectAccount, saveBrand, setupStatus } from '../src/setup.mjs';

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

test('setupStatus 反映連接與品牌完成狀態', () => {
  const store = createStore(':memory:');
  assert.deepEqual(setupStatus({ store, env: {} }), { connected: false, brandDone: false });
  store.setSetting('appSecret', 's');
  store.setToken('t', null);
  store.setSetting('setupComplete', '1');
  assert.deepEqual(setupStatus({ store, env: {} }), { connected: true, brandDone: true });
  store.close();
});
