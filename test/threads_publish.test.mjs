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

// ── 官方發布額度（滾動 24h 250 則）──
test('parsePublishingLimit：解析官方回應', async () => {
  const { parsePublishingLimit } = await import('../src/threads_publish.mjs');
  assert.deepEqual(
    parsePublishingLimit({ data: [{ quota_usage: 30, config: { quota_total: 250, quota_duration: 86400 } }] }),
    { used: 30, total: 250, remaining: 220 }
  );
});

test('parsePublishingLimit：缺 config 就用官方預設 250', async () => {
  const { parsePublishingLimit } = await import('../src/threads_publish.mjs');
  assert.deepEqual(parsePublishingLimit({ data: [{ quota_usage: 5 }] }), { used: 5, total: 250, remaining: 245 });
});

test('parsePublishingLimit：格式不對回 null（代表查不到，不是 0）', async () => {
  const { parsePublishingLimit } = await import('../src/threads_publish.mjs');
  assert.equal(parsePublishingLimit({}), null);
  assert.equal(parsePublishingLimit({ data: [] }), null);
  assert.equal(parsePublishingLimit({ data: [{ quota_usage: '?' }] }), null);
});

test('publishText：額度用完要在建容器之前就擋下來', async () => {
  const { publishText } = await import('../src/threads_publish.mjs');
  const calls = [];
  const api = {
    getPublishingLimit: async () => ({ data: [{ quota_usage: 250, config: { quota_total: 250 } }] }),
    createTextContainer: async () => { calls.push('container'); return { id: 'c1' }; },
    publishContainer: async () => ({ id: 'p1' }),
  };
  await assert.rejects(
    () => publishText({ settings: { userId: 'u' }, accessToken: 't', text: '內容', api, dryRun: false, sleepImpl: async () => {}, log: () => {} }),
    /額度已用完/
  );
  // 建了容器才失敗的話會留下無主的 container
  assert.deepEqual(calls, [], '不可以先建容器');
});

test('publishText：額度查不到不擋發布（保護機制不是前提）', async () => {
  const { publishText } = await import('../src/threads_publish.mjs');
  const api = {
    getPublishingLimit: async () => { throw new Error('沒權限'); },
    createTextContainer: async () => ({ id: 'c1' }),
    publishContainer: async () => ({ id: 'p1' }),
  };
  const r = await publishText({
    settings: { userId: 'u' }, accessToken: 't', text: '內容', api,
    dryRun: false, sleepImpl: async () => {}, log: () => {},
  });
  assert.equal(r.id, 'p1');
});

test('publishText：還有額度就照發', async () => {
  const { publishText } = await import('../src/threads_publish.mjs');
  const api = {
    getPublishingLimit: async () => ({ data: [{ quota_usage: 3, config: { quota_total: 250 } }] }),
    createTextContainer: async () => ({ id: 'c1' }),
    publishContainer: async () => ({ id: 'p1' }),
  };
  const r = await publishText({
    settings: { userId: 'u' }, accessToken: 't', text: '內容', api,
    dryRun: false, sleepImpl: async () => {}, log: () => {},
  });
  assert.equal(r.id, 'p1');
});
