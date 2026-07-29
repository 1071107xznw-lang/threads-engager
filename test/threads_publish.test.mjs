import test from 'node:test';
import assert from 'node:assert/strict';
import { publishText, validateText } from '../src/threads_publish.mjs';

const settings = {
  userId: '123',
  appSecret: 'sec',
  apiBase: 'https://graph.threads.net',
  dryRun: false,
};

test('空字串被擋', () => {
  assert.throws(() => validateText('   '), /不可為空/);
});

test('超過 500 字被擋', () => {
  assert.throws(() => validateText('字'.repeat(501)), /500/);
});

test('剛好 500 中文字通過（以字元計，非 byte）', () => {
  assert.equal([...validateText('字'.repeat(500))].length, 500);
});

test('DRY_RUN 不呼叫任何寫入 API', async () => {
  let called = 0;
  const api = {
    createTextContainer: async () => { called++; return { id: 'x' }; },
    publishContainer: async () => { called++; return { id: 'y' }; },
  };
  const res = await publishText({ settings, accessToken: 't', text: '哈囉', api, dryRun: true, log: () => {} });
  assert.equal(res.dryRun, true);
  assert.equal(res.id, null);
  assert.equal(called, 0);
});

test('正常流程 create→wait→publish 依序執行', async () => {
  const seq = [];
  const api = {
    createTextContainer: async ({ text }) => { seq.push('create:' + text); return { id: 'cont' }; },
    publishContainer: async ({ creationId }) => { seq.push('publish:' + creationId); return { id: 'post' }; },
  };
  const res = await publishText({
    settings,
    accessToken: 't',
    text: '嗨',
    api,
    dryRun: false,
    waitMs: 5,
    sleepImpl: async () => { seq.push('wait'); },
    log: () => {},
  });
  assert.deepEqual(seq, ['create:嗨', 'wait', 'publish:cont']);
  assert.equal(res.id, 'post');
  assert.equal(res.creationId, 'cont');
});
