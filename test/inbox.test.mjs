import test from 'node:test';
import assert from 'node:assert/strict';
import { pickUnanswered, buildInboxPrompt, draftInboxReply, scanInbox } from '../src/inbox.mjs';
import { createStore } from '../src/store.mjs';

const ME = 'argotaipei';

// ── 挑出「別人留的、我還沒回的」 ──
test('pickUnanswered：排除自己的留言、排除已回過的', () => {
  const rows = [
    { id: 'r1', username: 'alice', text: '紅酒我喜歡冰一點' },
    { id: 'r2', username: 'bob', text: '台灣常溫太熱吧' },
    { id: 'm1', username: ME, text: '同意！', replied_to: { id: 'r1' } }, // 已回 r1
    { id: 'r3', username: 'carol', text: '哪天有 DJ？' },
  ];
  const out = pickUnanswered({ rows, me: ME });
  assert.deepEqual(out.map((r) => r.id), ['r2', 'r3']);
});

test('pickUnanswered：空白留言與缺欄位的都不算', () => {
  const rows = [
    { id: 'r1', username: 'alice', text: '   ' },
    { id: 'r2', username: 'bob' },
    { username: 'carol', text: '沒有 id' },
    null,
    { id: 'r4', username: 'dave', text: '有效' },
  ];
  assert.deepEqual(pickUnanswered({ rows, me: ME }).map((r) => r.id), ['r4']);
});

test('pickUnanswered：同一人留兩則、我只回其中一則 → 另一則仍要回', () => {
  const rows = [
    { id: 'r1', username: 'alice', text: '第一則' },
    { id: 'r2', username: 'alice', text: '第二則' },
    { id: 'm1', username: ME, text: '回了', replied_to: { id: 'r1' } },
  ];
  assert.deepEqual(pickUnanswered({ rows, me: ME }).map((r) => r.id), ['r2']);
});

// ── 主人視角的回覆 prompt ──
test('buildInboxPrompt：帶原貼文脈絡、明講是自己的貼文、禁罐頭回覆', () => {
  const p = buildInboxPrompt({
    rootPostText: '紅酒也能冰著喝',
    reply: { username: 'bob', text: '台灣常溫太熱吧' },
    persona: '小編',
  });
  assert.match(p, /這是你自己的貼文/);
  assert.match(p, /紅酒也能冰著喝/);
  assert.match(p, /@bob/);
  assert.match(p, /台灣常溫太熱吧/);
  assert.match(p, /罐頭回覆/);
  assert.match(p, /不要道歉式退讓/); // 被糾正時不能軟掉
  assert.match(p, /120 字/);
});

test('buildInboxPrompt：有知識庫時要求只用它做肯定陳述', () => {
  const p = buildInboxPrompt({
    reply: { username: 'x', text: 'y' },
    knowledge: '- 我們先冰 20 分鐘',
  });
  assert.match(p, /我們先冰 20 分鐘/);
  assert.match(p, /不准當權威事實斷言|改成「我們的做法是/);
});

test('draftInboxReply：去掉包住整句的引號', async () => {
  const runner = async () => '「這溫度我們也試過，夏天確實冰一下比較好喝」';
  const t = await draftInboxReply({ reply: { username: 'a', text: 'b' }, runner });
  assert.equal(t, '這溫度我們也試過，夏天確實冰一下比較好喝');
});

test('draftInboxReply：AI 掛掉回 null，不擋整輪', async () => {
  const runner = async () => { throw new Error('claude 掛了'); };
  assert.equal(await draftInboxReply({ reply: { username: 'a', text: 'b' }, runner }), null);
});

// ── 生產線 ──
function fakeApi({ posts, conversations }) {
  return {
    async getProfile() { return { id: '1', username: ME }; },
    async listOwnPosts() { return { data: posts }; },
    async getConversation({ mediaId }) { return { data: conversations[mediaId] || [] }; },
  };
}

test('scanInbox：未回留言進佇列並產出草稿（status=drafted，不送出）', async () => {
  const store = createStore(':memory:');
  const api = fakeApi({
    posts: [{ id: 'p1', text: '紅酒也能冰著喝' }],
    conversations: {
      p1: [
        { id: 'r1', username: 'alice', text: '我也這樣喝', permalink: 'https://x/1' },
        { id: 'r2', username: 'bob', text: '常溫才對吧', permalink: 'https://x/2' },
        { id: 'm1', username: ME, text: '哈哈', replied_to: { id: 'r1' } },
      ],
    },
  });
  const r = await scanInbox({
    api, accessToken: 't', userId: '1', store, account: 'me',
    brand: { replyPersona: '小編' }, runner: async () => '謝了，我們夏天也會先冰一下',
    log: () => {},
  });
  assert.equal(r.found, 1);      // 只有 r2 沒回
  assert.equal(r.inserted, 1);
  assert.equal(r.drafted, 1);

  const queue = store.listByStatus('me', 'drafted');
  assert.equal(queue.length, 1);
  assert.equal(queue[0].targetId, 'r2');   // 送出時當 reply_to_id
  assert.equal(queue[0].kind, 'inbox');
  assert.equal(queue[0].author, 'bob');
  assert.match(queue[0].draftText, /先冰/);
  // ⚠️ 全自動只到 drafted：沒有任何 approved/sent
  assert.equal(store.listByStatus('me', 'approved').length, 0);
});

test('scanInbox：重複掃不會排成兩列（targetId 去重）', async () => {
  const store = createStore(':memory:');
  const api = fakeApi({
    posts: [{ id: 'p1', text: '貼文' }],
    conversations: { p1: [{ id: 'r1', username: 'alice', text: '留言', permalink: 'https://x/1' }] },
  });
  const args = {
    api, accessToken: 't', userId: '1', store, account: 'me',
    brand: {}, runner: async () => '回覆', log: () => {},
  };
  await scanInbox(args);
  const second = await scanInbox(args);
  assert.equal(second.inserted, 0);
  assert.equal(store.listByStatus('me', 'drafted').length, 1);
});

test('scanInbox：某則貼文的對話讀不到 → 跳過該則，其餘照跑', async () => {
  const store = createStore(':memory:');
  const api = {
    async getProfile() { return { username: ME }; },
    async listOwnPosts() { return { data: [{ id: 'bad' }, { id: 'p2', text: '好的' }] }; },
    async getConversation({ mediaId }) {
      if (mediaId === 'bad') throw new Error('boom');
      return { data: [{ id: 'r9', username: 'zoe', text: '留言', permalink: 'https://x/9' }] };
    },
  };
  const r = await scanInbox({
    api, accessToken: 't', userId: '1', store, account: 'me',
    brand: {}, runner: async () => '回覆', log: () => {},
  });
  assert.equal(r.found, 1);
  assert.equal(r.drafted, 1);
});

test('scanInbox：拿不到自己 username → 不猜，直接收手（避免回錯人）', async () => {
  const store = createStore(':memory:');
  const api = {
    async getProfile() { throw new Error('no'); },
    async listOwnPosts() { throw new Error('不該被呼叫'); },
  };
  const r = await scanInbox({
    api, accessToken: 't', userId: '1', store, account: 'me', brand: {}, log: () => {},
  });
  assert.equal(r.found, 0);
  assert.match(r.reason, /username/);
});

test('scanInbox：AI 產稿失敗的留言仍留在佇列（可自己手寫）', async () => {
  const store = createStore(':memory:');
  const api = fakeApi({
    posts: [{ id: 'p1', text: '貼文' }],
    conversations: { p1: [{ id: 'r1', username: 'alice', text: '留言', permalink: 'https://x/1' }] },
  });
  const r = await scanInbox({
    api, accessToken: 't', userId: '1', store, account: 'me',
    brand: {}, runner: async () => { throw new Error('掛了'); }, log: () => {},
  });
  assert.equal(r.drafted, 0);
  assert.equal(r.failed, 1);
  assert.equal(store.listByStatus('me', 'new').length, 1); // 還在，等你手寫
});

// ── 沒內容的留言：只回一句，不准掰營業資訊 ──
test('isLowContentReply：表情、單字、推推算沒內容；有實質內容的不算', async () => {
  const { isLowContentReply } = await import('../src/inbox.mjs');
  assert.equal(isLowContentReply('🤤'), true);
  assert.equal(isLowContentReply('好🤟🏿'), true);
  assert.equal(isLowContentReply('推推🤟🏿'), true);
  assert.equal(isLowContentReply('   '), true);
  assert.equal(isLowContentReply('紅酒我喜歡冰一點'), false);
  assert.equal(isLowContentReply('台灣常溫太熱吧🤔'), false);
});

test('buildInboxPrompt：沒內容的留言 → 明文禁止補營業資訊、只回一句', () => {
  const p = buildInboxPrompt({ reply: { username: 'a', text: '推推🤟🏿' }, persona: '小編' });
  assert.match(p, /幾乎沒有內容/);
  assert.match(p, /只回一句/);
  assert.match(p, /只能用上面那則原貼文裡真的寫到的/);
  assert.match(p, /寧可短到只有一行/);
});

test('buildInboxPrompt：有實質內容的留言不出現「只回一句」那段', () => {
  const p = buildInboxPrompt({ reply: { username: 'a', text: '紅酒我覺得該冰一下比較好喝' } });
  assert.doesNotMatch(p, /幾乎沒有內容/);
});

test('buildInboxPrompt：一律禁止編營業細節與做不到的承諾', () => {
  const p = buildInboxPrompt({ reply: { username: 'a', text: '你們幾點開？' } });
  assert.match(p, /編造營業細節/);
  assert.match(p, /DJ 或工作人員名字/);
  assert.match(p, /承諾原貼文沒答應過的事/);
  assert.match(p, /私訊或現場問/);
  // ⚠️ 關鍵：原貼文/知識庫真的寫到的細節「可以用」——那是自己公告過的，
  //    先前把這種情況誤判成編造，差點讓使用者刪掉正確的回覆。
  assert.match(p, /原貼文或知識庫\*\*真的寫到\*\*的可以用/);
});
