import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { resolveSettings } from '../src/env.mjs';
import { disconnectAccount, setupStatus } from '../src/setup.mjs';

const ENV = {
  THREADS_APP_SECRET: 'envsecret',
  THREADS_USER_ID: 'envuser',
  THREADS_ACCESS_TOKEN: 'envtoken',
};

test('clearAccount 清掉帳號憑證、設定完成標記，並把 dryRun 重設為乾跑', () => {
  const s = createStore(':memory:');
  s.setSetting('appSecret', 'sec');
  s.setSetting('userId', 'u1');
  s.setSetting('username', 'argotaipei');
  s.setSetting('setupComplete', '1');
  s.setSetting('dryRun', '0'); // 正式模式
  s.setToken('tok', '2026-09-01T00:00:00.000Z');

  s.clearAccount();

  assert.equal(s.getSetting('appSecret'), null);
  assert.equal(s.getSetting('userId'), null);
  assert.equal(s.getSetting('username'), null);
  assert.equal(s.getSetting('setupComplete'), null);
  assert.equal(s.getToken(), null);
  assert.equal(s.getSetting('dryRun'), '1', '換帳號後應回到乾跑，避免對新帳號誤發');
  assert.equal(s.getSetting('ignoreEnvCreds'), '1');
  s.close();
});

test('切換帳號後不會被 .env 舊憑證復活（setupComplete=false）', () => {
  const s = createStore(':memory:');
  // 一開始 .env 有完整憑證 → setupComplete
  assert.equal(resolveSettings({ store: s, env: ENV }).setupComplete, true);

  s.clearAccount();

  const after = resolveSettings({ store: s, env: ENV });
  assert.equal(after.setupComplete, false, '清帳號後應進設定模式，不可沿用 .env 舊帳號');
  assert.equal(after.appSecret, null);
  assert.equal(after.userId, null);
  assert.equal(after.accessToken, null);
  s.close();
});

test('連接新帳號後解除旗標，.env 回落恢復', () => {
  const s = createStore(':memory:');
  s.clearAccount();
  assert.equal(resolveSettings({ store: s, env: ENV }).setupComplete, false);

  // 模擬 connectAccount 寫入新帳號並清旗標
  s.setSetting('appSecret', 'newsec');
  s.setSetting('userId', 'newuser');
  s.setToken('newtok', null);
  s.deleteSetting('ignoreEnvCreds');

  const after = resolveSettings({ store: s, env: ENV });
  assert.equal(after.setupComplete, true);
  assert.equal(after.appSecret, 'newsec', '應使用新帳號的憑證');
  assert.equal(after.userId, 'newuser');
  s.close();
});

test('disconnectAccount 回報被登出的帳號名', () => {
  const s = createStore(':memory:');
  s.setSetting('username', 'argotaipei');
  s.setToken('tok', null);
  const r = disconnectAccount({ store: s });
  assert.equal(r.ok, true);
  assert.equal(r.disconnected, 'argotaipei');
  assert.equal(s.getToken(), null);
  s.close();
});

test('setupStatus：切換帳號後 connected=false（不看 .env）', () => {
  const s = createStore(':memory:');
  s.clearAccount();
  assert.equal(setupStatus({ store: s, env: ENV }).connected, false);
  s.close();
});

test('切換帳號後草稿與紀錄仍留在本機（只清憑證）', () => {
  const s = createStore(':memory:');
  const nid = s.insertNativeDraft({ draftText: '稿' });
  const { id } = s.upsertPost({ account: 'me', threadUrl: 'u1', author: 'x', content: 'c' });
  s.clearAccount();
  assert.equal(s.getNativeDraft(nid).draftText, '稿');
  assert.equal(s.listByStatus('me', 'new').some((r) => r.id === id), true);
  s.close();
});
