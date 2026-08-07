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

test('insertNativeDraft 存 AI 建議的主題', () => {
  const s = createStore(':memory:');
  const id = s.insertNativeDraft({ draftText: '稿', topic: '派對' });
  assert.equal(s.getNativeDraft(id).topic, '派對');
  const id2 = s.insertNativeDraft({ draftText: '稿2' }); // 沒帶 topic → null
  assert.equal(s.getNativeDraft(id2).topic, null);
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

test('setNativeSchedule 設排程+主題並轉 approved；listDueScheduled 依到期回', () => {
  const s = createStore(':memory:');
  const id = s.insertNativeDraft({ draftText: '稿' });
  s.setNativeSchedule(id, '2026-07-29T10:00:00.000Z', '調酒');
  const d = s.getNativeDraft(id);
  assert.equal(d.status, 'approved');
  assert.equal(d.scheduledAt, '2026-07-29T10:00:00.000Z');
  assert.equal(d.topic, '調酒');
  assert.equal(s.listDueScheduled('2026-07-29T09:00:00.000Z').length, 0); // 還沒到
  assert.equal(s.listDueScheduled('2026-07-29T11:00:00.000Z').length, 1); // 到期
  s.close();
});

test('app_settings get/set（缺鍵回 null）', () => {
  const s = createStore(':memory:');
  assert.equal(s.getSetting('nope'), null);
  s.setSetting('appSecret', 'abc');
  assert.equal(s.getSetting('appSecret'), 'abc');
  s.setSetting('appSecret', 'xyz'); // 覆寫
  assert.equal(s.getSetting('appSecret'), 'xyz');
  s.close();
});

test('upsertPost 存 targetId（reply_to_id 用）', () => {
  const s = createStore(':memory:');
  const { id } = s.upsertPost({ account: 'argo', threadUrl: 'u1', author: 'x', content: 'c', targetId: 'M99' });
  const row = s.listByStatus('argo', 'new').find((r) => r.id === id);
  assert.equal(row.targetId, 'M99');
  s.close();
});

test('upsertPost 以 targetId 去重：同一則貼文不同 URL 也視為同一列', () => {
  const s = createStore(':memory:');
  const a = s.upsertPost({ account: 'argo', threadUrl: 'https://x/@bob/post/ABC', author: 'bob', content: 'c', targetId: 'M1' });
  assert.equal(a.inserted, true);
  // 手動端點會用不同格式的 URL，但 targetId 相同 → 不應排成第二列
  const b = s.upsertPost({ account: 'argo', threadUrl: 'https://www.threads.com/t/M1', targetId: 'M1' });
  assert.equal(b.inserted, false);
  assert.equal(b.id, a.id);
  s.close();
});

test('saveDraft 覆寫時清掉舊的 editedText（避免送出過期人工編輯）', () => {
  const s = createStore(':memory:');
  const { id } = s.upsertPost({ account: 'a', threadUrl: 'u1', author: 'x', content: 'c' });
  s.saveDraft(id, '第一版');
  s.editDraft(id, '人工編輯第一版');
  s.saveDraft(id, '第二版'); // 重新產草稿
  const row = s.listByStatus('a', 'drafted').find((r) => r.id === id);
  assert.equal(row.draftText, '第二版');
  assert.equal(row.editedText, null, '舊的人工編輯應被清掉，不然送出會取回過期內容');
  s.close();
});

test('findByTargetId 找得到既有 post', () => {
  const s = createStore(':memory:');
  const { id } = s.upsertPost({ account: 'a', threadUrl: 'u1', targetId: 'M7' });
  assert.equal(s.findByTargetId('a', 'M7').id, id);
  assert.equal(s.findByTargetId('a', 'nope'), null);
  s.close();
});

test('clearAccount 把已核准/已排程內容退回草稿（不讓新帳號自動發舊內容）', () => {
  const s = createStore(':memory:');
  // A 帳號：一則已核准回覆 + 一則已排程原生貼文
  const { id: pid } = s.upsertPost({ account: 'me', threadUrl: 'u1', targetId: 'M1' });
  s.saveDraft(pid, '回覆稿'); s.setStatus(pid, 'approved');
  const nid = s.insertNativeDraft({ draftText: '原生稿' });
  s.setNativeSchedule(nid, '2026-07-29T10:00:00.000Z', null); // status=approved + scheduledAt

  s.clearAccount();

  assert.equal(s.listByStatus('me', 'approved').length, 0, '已核准回覆應退回草稿');
  assert.equal(s.getNativeDraft(nid).status, 'drafted', '已排程原生貼文應退回草稿');
  assert.equal(s.getNativeDraft(nid).scheduledAt, null, '排程時間應清掉，避免重連後立即發');
  assert.equal(s.listDueScheduled('2026-08-01T00:00:00.000Z').length, 0);
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

test('insertNativeDraft 存下分工 goal，listNativeByStatus 帶得出來', () => {
  const store = createStore(':memory:');
  const id = store.insertNativeDraft({ draftText: '衝觸及那則', goal: 'reach' });
  const row = store.listNativeByStatus('drafted').find((r) => r.id === id);
  assert.equal(row.goal, 'reach');
  // 沒指定分工 → null，不影響舊流程（手動撰寫的貼文就是這種）
  const id2 = store.insertNativeDraft({ draftText: '手寫' });
  assert.equal(store.getNativeDraft(id2).goal, null);
});

test('countSentToday / recentAuthors 分得清 inbox 與 outreach', () => {
  const store = createStore(':memory:');
  const now = '2026-08-03T12:00:00.000Z';
  const mk = (targetId, author, kind) => {
    const { id } = store.upsertPost({
      account: 'me', threadUrl: `https://x/${targetId}`, author, targetId, kind,
    });
    store.markSent(id, now);
    return id;
  };
  mk('t1', 'alice', 'inbox');
  mk('t2', 'bob', null); // 舊資料沒有 kind → 算 outreach

  assert.equal(store.countSentToday('me', now), 2);
  assert.equal(store.countSentToday('me', now, 'inbox'), 1);
  assert.equal(store.countSentToday('me', now, 'outreach'), 1);

  // 同作者去重只看 outreach：回過 alice 的留言，不該封鎖之後回她本人的貼文
  const authors = store.recentAuthors('me', '2026-08-01T00:00:00.000Z');
  assert.equal(authors.has('bob'), true);
  assert.equal(authors.has('alice'), false);
});

// ── 刪除原生草稿 ─────────────────────────────────────────
test('deleteNativeDraft：待審／已核准／已略過都可以刪', () => {
  const store = createStore(':memory:');
  for (const st of ['drafted', 'approved', 'skipped']) {
    const id = store.insertNativeDraft({ draftText: '稿' });
    store.setNativeStatus(id, st);
    assert.deepEqual(store.deleteNativeDraft(id), { deleted: true }, st);
    assert.equal(store.getNativeDraft(id), null);
  }
  store.close();
});

test('deleteNativeDraft：已發布的不給刪（那是紀錄，不是待辦）', () => {
  const store = createStore(':memory:');
  const id = store.insertNativeDraft({ draftText: '稿' });
  store.markNativePublished(id, 'post_1');
  assert.deepEqual(store.deleteNativeDraft(id), { deleted: false, reason: 'published' });
  assert.ok(store.getNativeDraft(id), '不可以真的被刪掉');
  store.close();
});

test('deleteNativeDraft：發布中的不給刪（會留下無主 container）', () => {
  const store = createStore(':memory:');
  const id = store.insertNativeDraft({ draftText: '稿' });
  store.setNativeStatus(id, 'publishing');
  assert.deepEqual(store.deleteNativeDraft(id), { deleted: false, reason: 'publishing' });
  store.close();
});

test('deleteNativeDraft：不存在的回 not_found', () => {
  const store = createStore(':memory:');
  assert.deepEqual(store.deleteNativeDraft(9999), { deleted: false, reason: 'not_found' });
  store.close();
});

test('countNativeDrafts：供 goalMix 跨批次輪替用', () => {
  const store = createStore(':memory:');
  assert.equal(store.countNativeDrafts(), 0);
  store.insertNativeDraft({ draftText: 'a' });
  store.insertNativeDraft({ draftText: 'b' });
  assert.equal(store.countNativeDrafts(), 2);
  store.close();
});

test('replaceNativeDraftText：換內容並清掉手改的 editedText', () => {
  const s = createStore(':memory:');
  const id = s.insertNativeDraft({ draftText: '舊的', angle: '舊角度', topic: '舊主題', goal: 'story' });
  s.editNativeDraft(id, '手改過的');
  s.replaceNativeDraftText(id, { draftText: '新的', angle: '新角度', topic: '新主題', reviewNote: '改了X' });
  const row = s.getNativeDraft(id);
  assert.equal(row.draftText, '新的');
  assert.equal(row.editedText, null, 'editedText 必須清掉，否則舊內容會蓋住新稿');
  assert.equal(row.angle, '新角度');
  assert.equal(row.topic, '新主題');
  assert.equal(row.reviewNote, '改了X');
  assert.equal(row.goal, 'story', '分工不能被換掉');
  assert.equal(row.status, 'drafted');
  s.close();
});

test('listPublishedNativeTopics：只回已發布且有主題的', () => {
  const s = createStore(':memory:');
  const a = s.insertNativeDraft({ draftText: 'a', topic: '調酒' });
  s.setNativeStatus(a, 'approved');
  s.claimNativeForPublish(a);
  s.markNativePublished(a, 'post_a');
  const b = s.insertNativeDraft({ draftText: 'b', topic: '電競' }); // 還沒發布
  assert.ok(b);
  const c = s.insertNativeDraft({ draftText: 'c' });                // 已發布但沒主題
  s.setNativeStatus(c, 'approved');
  s.claimNativeForPublish(c);
  s.markNativePublished(c, 'post_c');
  assert.deepEqual(s.listPublishedNativeTopics(), [{ publishedPostId: 'post_a', topic: '調酒' }]);
  s.close();
});

test('listRecentNativeTexts：不分狀態都要撈（略過的才是重複的大宗）', () => {
  const s = createStore(':memory:');
  const a = s.insertNativeDraft({ draftText: '紅酒那則一' });
  s.setNativeStatus(a, 'skipped');            // 被看出重複而略過的
  const b = s.insertNativeDraft({ draftText: '紅酒那則二' });   // 還在待審
  const c = s.insertNativeDraft({ draftText: '已發布的' });
  s.setNativeStatus(c, 'approved');
  s.claimNativeForPublish(c);
  s.markNativePublished(c, 'p1');
  const out = s.listRecentNativeTexts(10);
  assert.equal(out.length, 3, '只看已發布的話，就看不到自己在複讀什麼');
  assert.ok(out.includes('紅酒那則一'));
  assert.ok(out.includes('紅酒那則二'));
  assert.ok(b && out.includes('已發布的'));
  s.close();
});

test('listRecentNativeTexts：以手改後的內容為準，並吃 limit', () => {
  const s = createStore(':memory:');
  const id = s.insertNativeDraft({ draftText: '原稿' });
  s.editNativeDraft(id, '我改過的');
  for (let i = 0; i < 5; i += 1) s.insertNativeDraft({ draftText: `其他${i}` });
  assert.equal(s.listRecentNativeTexts(3).length, 3);
  assert.ok(s.listRecentNativeTexts(99).includes('我改過的'));
  s.close();
});
