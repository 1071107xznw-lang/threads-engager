import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { publishDue } from '../src/scheduler.mjs';

const DAY = 24 * 3600 * 1000;

function seedScheduled(store, { text = '稿', topic = null, scheduledAt }) {
  const id = store.insertNativeDraft({ draftText: text });
  store.setNativeSchedule(id, scheduledAt, topic);
  return id;
}

test('publishDue：到期的才發，未到期跳過', async () => {
  const store = createStore(':memory:');
  const now = Date.parse('2026-07-29T12:00:00.000Z');
  const dueId = seedScheduled(store, { scheduledAt: new Date(now - DAY).toISOString() });
  const futureId = seedScheduled(store, { scheduledAt: new Date(now + DAY).toISOString() });

  const calls = [];
  const publish = async ({ text, topic }) => { calls.push({ text, topic }); return { id: 'p_' + text }; };
  const res = await publishDue({ store, publish, now, dryRun: false, log: () => {} });

  assert.equal(res.published, 1);
  assert.equal(calls.length, 1);
  assert.equal(store.getNativeDraft(dueId).status, 'published');
  assert.equal(store.getNativeDraft(futureId).status, 'approved'); // 未到期不動
  store.close();
});

test('publishDue：DRY_RUN 不發、不改狀態', async () => {
  const store = createStore(':memory:');
  const now = Date.parse('2026-07-29T12:00:00.000Z');
  const id = seedScheduled(store, { scheduledAt: new Date(now - DAY).toISOString() });
  let called = false;
  const publish = async () => { called = true; return { id: 'x' }; };
  const res = await publishDue({ store, publish, now, dryRun: true, log: () => {} });
  assert.equal(called, false);
  assert.equal(res.skipped, 1);
  assert.equal(store.getNativeDraft(id).status, 'approved');
  store.close();
});

test('publishDue：帶 topic、失敗時 markFailed', async () => {
  const store = createStore(':memory:');
  const now = Date.parse('2026-07-29T12:00:00.000Z');
  const okId = seedScheduled(store, { topic: '調酒', scheduledAt: new Date(now - 1000).toISOString() });
  const badId = seedScheduled(store, { scheduledAt: new Date(now - 1000).toISOString() });
  const publish = async ({ topic }) => {
    if (topic === '調酒') return { id: 'good' };
    throw new Error('boom');
  };
  const res = await publishDue({ store, publish, now, dryRun: false, log: () => {} });
  assert.equal(res.published, 1);
  assert.equal(res.failed, 1);
  assert.equal(store.getNativeDraft(okId).status, 'published');
  assert.equal(store.getNativeDraft(badId).status, 'failed'); // 失敗轉 failed（不留在 approved 無限重試）
  assert.match(store.getNativeDraft(badId).error, /boom/);
  store.close();
});

test('claimDueScheduled：只有第一個認領者成功（防 cron+in-process 重複發布）', () => {
  const store = createStore(':memory:');
  const id = seedScheduled(store, { scheduledAt: '2026-07-29T11:00:00.000Z' });
  assert.equal(store.claimDueScheduled(id), true);  // 第一次認領成功
  assert.equal(store.claimDueScheduled(id), false); // 第二個讀取者搶不到（已非 approved）
  assert.equal(store.getNativeDraft(id).status, 'publishing');
  store.close();
});

test('publishDue：兩個排程器同時跑，同一則只發一次', async () => {
  const store = createStore(':memory:');
  const now = Date.parse('2026-07-29T12:00:00.000Z');
  seedScheduled(store, { scheduledAt: new Date(now - DAY).toISOString() });
  let sent = 0;
  const publish = async () => { sent += 1; return { id: 'p' + sent }; };
  // 模擬 cron 與 in-process 幾乎同時觸發（共用同一個 store，如同共用 data.db）
  const [a, b] = await Promise.all([
    publishDue({ store, publish, now, dryRun: false, log: () => {} }),
    publishDue({ store, publish, now, dryRun: false, log: () => {} }),
  ]);
  assert.equal(sent, 1, '同一則排程貼文只能被發布一次');
  assert.equal(a.published + b.published, 1);
  store.close();
});

test('listDueScheduled 只回 approved+有排程+到期', () => {
  const store = createStore(':memory:');
  const now = '2026-07-29T12:00:00.000Z';
  // approved 但沒排程 → 不算
  const noSched = store.insertNativeDraft({ draftText: 'a' });
  store.setNativeStatus(noSched, 'approved');
  // 到期
  seedScheduled(store, { scheduledAt: '2026-07-29T11:00:00.000Z' });
  const due = store.listDueScheduled(now);
  assert.equal(due.length, 1);
  store.close();
});
