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

test('claimNativeForPublish：只有第一個認領者成功（防排程器/cron/手動重複發布）', () => {
  const store = createStore(':memory:');
  const id = seedScheduled(store, { scheduledAt: '2026-07-29T11:00:00.000Z' });
  assert.equal(store.claimNativeForPublish(id), true);  // 第一次認領成功
  assert.equal(store.claimNativeForPublish(id), false); // 第二個搶不到（已非 approved）
  assert.equal(store.getNativeDraft(id).status, 'publishing');
  store.close();
});

test('recoverStalePublishing：把孤兒 publishing 列轉 failed', () => {
  const store = createStore(':memory:');
  const id = seedScheduled(store, { scheduledAt: '2026-07-29T11:00:00.000Z' });
  store.claimNativeForPublish(id); // 模擬認領後崩潰，卡在 publishing
  assert.equal(store.recoverStalePublishing(), 1);
  assert.equal(store.getNativeDraft(id).status, 'failed');
  assert.match(store.getNativeDraft(id).error, /中斷/);
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

// ── 🔴 規則 2 的實際保障 ──
// 自動排程會幫「待審核」的草稿填建議時間。那個時間到期時，
// **絕對不可以**被發出去——人還沒按核准。這條守不住，整個工具就不合規了。
test('🔴 publishDue 不發出「待審核但有排程時間」的貼文', async () => {
  const store = createStore(':memory:');
  const past = new Date(Date.now() - 60_000).toISOString();

  // 待審核 + 建議時間已過期
  const pending = store.insertNativeDraft({ draftText: '還沒核准的' });
  store.setNativeSuggestedTime(pending, past);

  // 已核准 + 同樣過期 → 這則才該發
  const approved = store.insertNativeDraft({ draftText: '已核准的' });
  store.setNativeSchedule(approved, past);

  const sent = [];
  const r = await publishDue({
    store,
    publish: async ({ text }) => { sent.push(text); return { id: 'p1' }; },
    log: () => {},
  });

  assert.deepEqual(sent, ['已核准的'], '待審核的絕對不可以被送出');
  assert.equal(r.published, 1);
  assert.equal(store.getNativeDraft(pending).status, 'drafted', '待審核的狀態不該被動到');
  store.close();
});

test('setNativeSuggestedTime：只寫時間，不動 status', () => {
  const store = createStore(':memory:');
  const id = store.insertNativeDraft({ draftText: 'x' });
  store.setNativeSuggestedTime(id, '2026-08-10T21:00:00.000Z');
  const row = store.getNativeDraft(id);
  assert.equal(row.scheduledAt, '2026-08-10T21:00:00.000Z');
  assert.equal(row.status, 'drafted', '自動排程不可以順便替人按核准');
  store.close();
});

test('listOccupiedSlots：已排程的與已發布的都算佔用，略過的不算', () => {
  const store = createStore(':memory:');
  const a = store.insertNativeDraft({ draftText: 'a' });
  store.setNativeSuggestedTime(a, '2026-08-10T13:00:00.000Z');

  const b = store.insertNativeDraft({ draftText: 'b' });
  store.setNativeSchedule(b, '2026-08-10T14:00:00.000Z');

  const c = store.insertNativeDraft({ draftText: 'c' });
  store.setNativeStatus(c, 'approved');
  store.claimNativeForPublish(c);
  store.markNativePublished(c, 'post_c', '2026-08-10T15:00:00.000Z');

  const d = store.insertNativeDraft({ draftText: 'd' });
  store.setNativeSuggestedTime(d, '2026-08-10T16:00:00.000Z');
  store.setNativeStatus(d, 'skipped'); // 略過的不佔位

  assert.deepEqual(store.listOccupiedSlots().sort(), [
    '2026-08-10T13:00:00.000Z', '2026-08-10T14:00:00.000Z', '2026-08-10T15:00:00.000Z',
  ]);
  store.close();
});

// ── 🔴 積壓的排程不可以一次全倒出去 ──
// 實際踩過：排程時間是「產稿當下」算的，核准卻是人晚上才按的。
// 白天那些時間點全部變成已到期，一個 tick 就發了 6 則、間隔 0～1 分鐘。
// 間隔只做在「排時間」那一層不夠，執行這一層也要守。
function seedApprovedPast(store, n, minutesAgo = 60) {
  const ids = [];
  for (let i = 0; i < n; i += 1) {
    const id = store.insertNativeDraft({ draftText: `稿${i}` });
    store.setNativeSchedule(id, new Date(Date.now() - minutesAgo * 60_000).toISOString());
    ids.push(id);
  }
  return ids;
}

test('🔴 積壓 6 則同時到期：一個 tick 只發 1 則，其餘遞延', async () => {
  const store = createStore(':memory:');
  seedApprovedPast(store, 6);
  const sent = [];
  const r = await publishDue({
    store, publish: async ({ text }) => { sent.push(text); return { id: 'p' }; },
    minGapMinutes: 55, log: () => {},
  });
  assert.equal(r.published, 1, '一個 tick 只能發 1 則');
  assert.equal(r.deferred, 5);
  assert.equal(sent.length, 1);
  store.close();
});

test('🔴 距上一則發布不足間隔：整個 tick 跳過，一則都不發', async () => {
  const store = createStore(':memory:');
  // 先製造一則「10 分鐘前剛發過」的紀錄
  const done = store.insertNativeDraft({ draftText: '剛發過的' });
  store.setNativeStatus(done, 'approved');
  store.claimNativeForPublish(done);
  store.markNativePublished(done, 'p0', new Date(Date.now() - 10 * 60_000).toISOString());

  seedApprovedPast(store, 3);
  const sent = [];
  const r = await publishDue({
    store, publish: async ({ text }) => { sent.push(text); return { id: 'p' }; },
    minGapMinutes: 55, log: () => {},
  });
  assert.equal(r.published, 0);
  assert.equal(r.deferred, 3);
  assert.deepEqual(sent, [], '間隔沒到就一則都不能送出去');
  store.close();
});

test('距上一則發布已超過間隔：可以發，但仍然一次只發一則', async () => {
  const store = createStore(':memory:');
  const done = store.insertNativeDraft({ draftText: '很久以前發的' });
  store.setNativeStatus(done, 'approved');
  store.claimNativeForPublish(done);
  store.markNativePublished(done, 'p0', new Date(Date.now() - 120 * 60_000).toISOString());

  seedApprovedPast(store, 4);
  const r = await publishDue({
    store, publish: async () => ({ id: 'p' }), minGapMinutes: 55, log: () => {},
  });
  assert.equal(r.published, 1);
  assert.equal(r.deferred, 3);
  store.close();
});

test('minGapMinutes=0 維持舊行為（整批一次發完）', async () => {
  const store = createStore(':memory:');
  seedApprovedPast(store, 4);
  const r = await publishDue({
    store, publish: async () => ({ id: 'p' }), minGapMinutes: 0, log: () => {},
  });
  assert.equal(r.published, 4);
  assert.equal(r.deferred, 0);
  store.close();
});

test('間隔守門不影響 DRY_RUN（照樣不送、不改狀態）', async () => {
  const store = createStore(':memory:');
  seedApprovedPast(store, 3);
  const sent = [];
  const r = await publishDue({
    store, publish: async () => { sent.push(1); return { id: 'p' }; },
    dryRun: true, minGapMinutes: 55, log: () => {},
  });
  assert.equal(r.published, 0);
  assert.equal(r.skipped, 3);
  assert.deepEqual(sent, []);
  store.close();
});

test('lastPublishedAt：回最後一次真的發出去的時間，沒發過回 null', () => {
  const store = createStore(':memory:');
  assert.equal(store.lastPublishedAt(), null);
  const a = store.insertNativeDraft({ draftText: 'a' });
  store.setNativeStatus(a, 'approved');
  store.claimNativeForPublish(a);
  store.markNativePublished(a, 'p1', '2026-08-07T09:00:00.000Z');
  const b = store.insertNativeDraft({ draftText: 'b' });
  store.setNativeStatus(b, 'approved');
  store.claimNativeForPublish(b);
  store.markNativePublished(b, 'p2', '2026-08-07T11:00:00.000Z');
  assert.equal(store.lastPublishedAt(), '2026-08-07T11:00:00.000Z');
  store.close();
});
