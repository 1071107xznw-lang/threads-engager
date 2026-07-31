import test from 'node:test';
import assert from 'node:assert/strict';
import { publishText, validateText, validateTopic, sanitizeTopic } from '../src/threads_publish.mjs';

test('sanitizeTopic：整理建議主題（去符號/#/引號、截 50、空回 null）', () => {
  assert.equal(sanitizeTopic('調酒.吧&夜'), '調酒吧夜');
  assert.equal(sanitizeTopic('#微醺'), '微醺');
  assert.equal(sanitizeTopic('  "派對"  '), '派對');
  assert.equal([...sanitizeTopic('字'.repeat(80))].length, 50);
  assert.equal(sanitizeTopic('  '), null);
  assert.equal(sanitizeTopic(null), null);
});

const settings = {
  userId: '123',
  appSecret: 'sec',
  apiBase: 'https://graph.threads.net',
  dryRun: false,
};

test('空字串被擋', () => {
  assert.throws(() => validateText('   '), /不可為空/);
});

test('validateTopic：空回 null、>50字/句點/&被擋', () => {
  assert.equal(validateTopic(''), null);
  assert.equal(validateTopic(null), null);
  assert.equal(validateTopic(' 調酒 '), '調酒');
  assert.throws(() => validateTopic('字'.repeat(51)), /50/);
  assert.throws(() => validateTopic('a.b'), /句點/);
  assert.throws(() => validateTopic('a&b'), /&/);
});

test('publishText 帶 topic → container 收到 topicTag', async () => {
  let got = null;
  const api = {
    createTextContainer: async (a) => { got = a; return { id: 'c' }; },
    publishContainer: async () => ({ id: 'p' }),
  };
  const res = await publishText({
    settings, accessToken: 't', text: '嗨', topic: '調酒', api,
    dryRun: false, waitMs: 0, sleepImpl: async () => {}, log: () => {},
  });
  assert.equal(got.topicTag, '調酒');
  assert.equal(res.topic, '調酒');
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
