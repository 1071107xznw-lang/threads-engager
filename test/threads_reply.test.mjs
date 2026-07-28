import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { pickSendable, postReply, sendApprovedReplies, SAME_AUTHOR_WINDOW_HOURS } from '../src/threads_reply.mjs';

const settings = { userId: '1', appSecret: 's', apiBase: 'https://graph.threads.net', dryRun: false };

function fakeApi() {
  const calls = [];
  return {
    calls,
    async createReplyContainer(a) { calls.push(['create', a]); return { id: 'cont_' + a.replyToId }; },
    async publishContainer(a) { calls.push(['publish', a]); return { id: 'posted_' + a.creationId }; },
  };
}

// ── pickSendable（自舊 sender.test 搬入）──
test('pickSendable 受 dailyCap 限制', () => {
  const approved = [{ author: 'a' }, { author: 'b' }, { author: 'c' }];
  const out = pickSendable({ approved, sentToday: 1, dailyCap: 3, recentAuthors: [] });
  assert.equal(out.length, 2);
});

test('pickSendable 過濾窗口內已回作者與同批重複作者', () => {
  const approved = [{ author: 'a' }, { author: 'a' }, { author: 'b' }];
  const out = pickSendable({ approved, sentToday: 0, dailyCap: 10, recentAuthors: ['b'] });
  assert.deepEqual(out.map((r) => r.author), ['a']);
});

test('SAME_AUTHOR_WINDOW_HOURS 為 168', () => {
  assert.equal(SAME_AUTHOR_WINDOW_HOURS, 168);
});

// ── postReply ──
test('postReply DRY_RUN 不呼叫 API', async () => {
  const api = fakeApi();
  const res = await postReply({ settings, accessToken: 't', text: '嗨', replyToId: 'X', api, dryRun: true, log: () => {} });
  assert.equal(res.dryRun, true);
  assert.equal(api.calls.length, 0);
});

test('postReply create→wait→publish 依序，帶 reply_to_id', async () => {
  const api = fakeApi();
  const seq = [];
  const res = await postReply({
    settings, accessToken: 't', text: '嗨', replyToId: 'X', api,
    dryRun: false, waitMs: 1, sleepImpl: async () => seq.push('wait'), log: () => {},
  });
  assert.deepEqual(api.calls.map((c) => c[0]), ['create', 'publish']);
  assert.equal(api.calls[0][1].replyToId, 'X');
  assert.deepEqual(seq, ['wait']);
  assert.equal(res.id, 'posted_cont_X');
});

test('postReply 空字串 / 缺 replyToId 擋下', async () => {
  await assert.rejects(() => postReply({ settings, accessToken: 't', text: '  ', replyToId: 'X', dryRun: false }), /不可為空/);
  await assert.rejects(() => postReply({ settings, accessToken: 't', text: '嗨', replyToId: '', dryRun: false }), /reply_to_id/);
});

// ── sendApprovedReplies ──
function seedApproved(store, rows) {
  for (const r of rows) {
    const { id } = store.upsertPost({ account: 'argo', threadUrl: 'u' + r.targetId, author: r.author, content: 'c', targetId: r.targetId });
    store.saveDraft(id, r.draft || 'reply');
    store.setStatus(id, 'approved');
  }
}

test('sendApprovedReplies 只送 approved、DRY_RUN 不打 API、不 markSent', async () => {
  const store = createStore(':memory:');
  seedApproved(store, [{ author: 'a', targetId: 'T1' }]);
  const { id } = store.upsertPost({ account: 'argo', threadUrl: 'ud', author: 'z', content: 'c', targetId: 'TD' });
  store.saveDraft(id, 'x'); // status=drafted，未核准
  const api = fakeApi();
  const res = await sendApprovedReplies({
    settings: { ...settings, dryRun: true }, store, accessToken: 't', account: 'argo', api,
    dailyCap: 10, waitMs: 0, sleepImpl: async () => {}, log: () => {},
  });
  assert.equal(res.attempted, 1); // 只有 approved 那則
  assert.equal(api.calls.length, 0); // dry run 不送
  assert.equal(store.listByStatus('argo', 'approved').length, 1); // 仍 approved
  store.close();
});

test('sendApprovedReplies 正常送出：呼叫官方回覆並 markSent', async () => {
  const store = createStore(':memory:');
  seedApproved(store, [{ author: 'a', targetId: 'T1' }, { author: 'b', targetId: 'T2' }]);
  const api = fakeApi();
  const res = await sendApprovedReplies({
    settings, store, accessToken: 't', account: 'argo', api, dailyCap: 10,
    waitMs: 0, sleepImpl: async () => {}, log: () => {},
  });
  assert.equal(res.sent, 2);
  const createIds = api.calls.filter((c) => c[0] === 'create').map((c) => c[1].replyToId).sort();
  assert.deepEqual(createIds, ['T1', 'T2']);
  assert.equal(store.listByStatus('argo', 'sent').length, 2);
  store.close();
});

test('sendApprovedReplies 受 dailyCap 限制', async () => {
  const store = createStore(':memory:');
  seedApproved(store, [{ author: 'a', targetId: 'T1' }, { author: 'b', targetId: 'T2' }, { author: 'c', targetId: 'T3' }]);
  const api = fakeApi();
  const res = await sendApprovedReplies({
    settings, store, accessToken: 't', account: 'argo', api, dailyCap: 2,
    waitMs: 0, sleepImpl: async () => {}, log: () => {},
  });
  assert.equal(res.sent, 2);
  store.close();
});
