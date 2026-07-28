import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';

const samplePost = {
  account: 'a', threadUrl: 'https://threads.net/t/1',
  author: 'bob', content: 'hi', likes: 10, postedAt: '2026-06-19T00:00:00.000Z',
};

test('upsertPost 新增並去重', () => {
  const s = createStore(':memory:');
  const first = s.upsertPost(samplePost);
  assert.equal(first.inserted, true);
  const again = s.upsertPost(samplePost);
  assert.equal(again.inserted, false);
  assert.equal(again.id, first.id);
  s.close();
});

test('草稿流程: setRelevance → saveDraft → listByStatus', () => {
  const s = createStore(':memory:');
  const { id } = s.upsertPost(samplePost);
  s.setRelevance(id, 0.8);
  s.saveDraft(id, '很棒的分享！');
  const drafted = s.listByStatus('a', 'drafted');
  assert.equal(drafted.length, 1);
  assert.equal(drafted[0].draftText, '很棒的分享！');
  assert.equal(drafted[0].relevanceScore, 0.8);
  s.close();
});

test('countSentToday 只算當天送出', () => {
  const s = createStore(':memory:');
  const { id } = s.upsertPost(samplePost);
  s.markSent(id, '2026-06-19T10:00:00.000Z');
  assert.equal(s.countSentToday('a', '2026-06-19T23:00:00.000Z'), 1);
  assert.equal(s.countSentToday('a', '2026-06-20T01:00:00.000Z'), 0);
  s.close();
});

test('recentAuthors 回傳窗口內已回覆作者', () => {
  const s = createStore(':memory:');
  const { id } = s.upsertPost(samplePost);
  s.markSent(id, '2026-06-19T10:00:00.000Z');
  const authors = s.recentAuthors('a', '2026-06-18T00:00:00.000Z');
  assert.ok(authors.has('bob'));
  s.close();
});

test('native_drafts 狀態機: 建立→編輯→核准→發布', () => {
  const s = createStore(':memory:');
  const id = s.insertNativeDraft({ draftText: '稿', angle: 'x', sourceSummary: 's' });
  assert.equal(s.listNativeByStatus('drafted').length, 1);
  s.editNativeDraft(id, '改稿');
  s.setNativeStatus(id, 'approved');
  assert.equal(s.listNativeByStatus('drafted').length, 0);
  assert.equal(s.listNativeByStatus('approved')[0].editedText, '改稿');
  s.markNativePublished(id, 'post123');
  const pub = s.getNativeDraft(id);
  assert.equal(pub.status, 'published');
  assert.equal(pub.publishedPostId, 'post123');
  s.close();
});

test('upsertPost 存 targetId（reply_to_id 用）', () => {
  const s = createStore(':memory:');
  const { id } = s.upsertPost({ account: 'argo', threadUrl: 'u1', author: 'x', content: 'c', targetId: 'M99' });
  const row = s.listByStatus('argo', 'new').find((r) => r.id === id);
  assert.equal(row.targetId, 'M99');
  s.close();
});

test('search_log 只算 7 天窗內', () => {
  const s = createStore(':memory:');
  const now = Date.now();
  s.logSearch('a', new Date(now - 1000).toISOString());
  s.logSearch('b', new Date(now - 8 * 24 * 3600 * 1000).toISOString());
  assert.equal(s.countSearches7d(new Date(now).toISOString()), 1);
  s.close();
});
