import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { fetchTargetPost, draftReplyForTarget } from '../src/target_draft.mjs';

const okRunner = async () => '{"score":0.9,"draft":"這則我有共鳴"}';

// ── 取得目標貼文的內文 ──
test('fetchTargetPost：使用者自己貼的內容優先於 API', async () => {
  const api = { getMedia: async () => ({ text: 'API 讀到的' }) };
  const p = await fetchTargetPost({ api, accessToken: 't', targetId: '1', postText: '  我貼的  ' });
  assert.equal(p.text, '我貼的');
  assert.equal(p.source, 'manual');
});

test('fetchTargetPost：沒貼就讀 API，帶回作者與連結', async () => {
  const api = {
    getMedia: async () => ({ text: '別人的貼文', username: 'someone', permalink: 'https://x/y' }),
  };
  const p = await fetchTargetPost({ api, accessToken: 't', targetId: '1' });
  assert.equal(p.text, '別人的貼文');
  assert.equal(p.author, 'someone');
  assert.equal(p.permalink, 'https://x/y');
  assert.equal(p.source, 'api');
});

test('fetchTargetPost：API 讀不到不能爆，回 source=error', async () => {
  const api = { getMedia: async () => { throw new Error('沒權限'); } };
  const p = await fetchTargetPost({ api, accessToken: 't', targetId: '1', log: () => {} });
  assert.equal(p.text, '');
  assert.equal(p.source, 'error');
  assert.match(p.error, /沒權限/);
});

test('fetchTargetPost：純圖片貼文（讀得到但沒文字）要分辨得出來', async () => {
  const api = { getMedia: async () => ({ text: '', username: 'someone' }) };
  const p = await fetchTargetPost({ api, accessToken: 't', targetId: '1' });
  assert.equal(p.source, 'api-empty');
});

// ── 產草稿 → 進佇列 ──
test('產草稿：寫進佇列且狀態是待審核（不是已核准）', async () => {
  const store = createStore(':memory:');
  const api = { getMedia: async () => ({ text: '有人在問調酒', username: 'asker' }) };
  const r = await draftReplyForTarget({
    api, accessToken: 't', store, account: 'me',
    targetId: '17912345678901234', persona: 'x', runner: okRunner,
  });
  assert.equal(r.draft, '這則我有共鳴');
  const row = store.getPost(r.id);
  assert.equal(row.status, 'drafted', '🔴 產草稿不可以順便核准');
  assert.equal(row.targetId, '17912345678901234');
  assert.equal(row.author, 'asker');
  assert.equal(row.content, '有人在問調酒', '貼文內文要存下來，重新生成時才有脈絡');
  assert.equal(row.draftText, '這則我有共鳴');
  store.close();
});

test('產草稿：拿不到內文要明講怎麼繼續，不准憑空亂寫', async () => {
  const store = createStore(':memory:');
  const api = { getMedia: async () => { throw new Error('沒權限'); } };
  let called = false;
  await assert.rejects(
    () => draftReplyForTarget({
      api, accessToken: 't', store, account: 'me', targetId: '1', persona: 'x',
      runner: async () => { called = true; return okRunner(); }, log: () => {},
    }),
    (e) => {
      assert.equal(e.status, 422);
      assert.match(e.message, /請把貼文內容複製貼到/);
      return true;
    }
  );
  assert.equal(called, false, '沒有內文就不該去問 AI——那只會產出憑空想像的回覆');
  assert.equal(store.listByStatus('me', 'drafted').length, 0, '失敗不該留下半筆資料');
  store.close();
});

test('產草稿：純圖片貼文的錯誤訊息要說得出原因', async () => {
  const store = createStore(':memory:');
  const api = { getMedia: async () => ({ text: '', username: 'a' }) };
  await assert.rejects(
    () => draftReplyForTarget({
      api, accessToken: 't', store, account: 'me', targetId: '1', persona: 'x', runner: okRunner,
    }),
    /沒有文字內容/
  );
  store.close();
});

test('產草稿：API 讀不到但使用者貼了內文 → 照樣產得出來', async () => {
  const store = createStore(':memory:');
  const api = { getMedia: async () => { throw new Error('沒權限'); } };
  const r = await draftReplyForTarget({
    api, accessToken: 't', store, account: 'me', targetId: '1',
    postText: '我自己貼的貼文內容', persona: 'x', runner: okRunner, log: () => {},
  });
  assert.equal(r.source, 'manual');
  assert.equal(store.getPost(r.id).content, '我自己貼的貼文內容');
  store.close();
});

test('產草稿：分數低於門檻時不寫進佇列', async () => {
  const store = createStore(':memory:');
  const api = { getMedia: async () => ({ text: '完全無關的貼文' }) };
  await assert.rejects(
    () => draftReplyForTarget({
      api, accessToken: 't', store, account: 'me', targetId: '1', persona: 'x',
      threshold: 0.8, runner: async () => '{"score":0.2,"draft":"硬回的"}',
    }),
    /低於門檻/
  );
  assert.equal(store.listByStatus('me', 'drafted').length, 0);
  store.close();
});

test('產草稿：預設門檻 0——手動指定代表人已經挑過了', async () => {
  const store = createStore(':memory:');
  const api = { getMedia: async () => ({ text: '一則貼文' }) };
  const r = await draftReplyForTarget({
    api, accessToken: 't', store, account: 'me', targetId: '1', persona: 'x',
    runner: async () => '{"score":0.1,"draft":"還是回了"}',
  });
  assert.equal(r.draft, '還是回了');
  store.close();
});

test('產草稿：同一則貼文再產一次不會排成兩列', async () => {
  const store = createStore(':memory:');
  const api = { getMedia: async () => ({ text: '一則貼文' }) };
  const args = {
    api, accessToken: 't', store, account: 'me', targetId: '999', persona: 'x', runner: okRunner,
  };
  const a = await draftReplyForTarget(args);
  const b = await draftReplyForTarget(args);
  assert.equal(a.id, b.id);
  assert.equal(store.listByStatus('me', 'drafted').length, 1);
  store.close();
});
