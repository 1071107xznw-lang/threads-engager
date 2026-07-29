import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createApi, appsecretProof } from '../src/threads_api.mjs';

// 假 fetch：記錄呼叫並回傳指定內容。responder 回 { ok?, status?, body }。
function fakeFetch(responder) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init });
    const r = responder(url, init) || {};
    return {
      ok: r.ok !== false,
      status: r.status || 200,
      text: async () => JSON.stringify(r.body ?? {}),
    };
  };
  fn.calls = calls;
  return fn;
}

test('appsecretProof = HMAC-SHA256(token, secret)', () => {
  const expected = createHmac('sha256', 'secret').update('tok').digest('hex');
  assert.equal(appsecretProof('tok', 'secret'), expected);
});

test('getProfile 組出正確 URL 並帶 appsecret_proof', async () => {
  const fetchImpl = fakeFetch(() => ({ body: { id: '1', username: 'argo' } }));
  const api = createApi({ fetchImpl, appSecret: 'sec' });
  const res = await api.getProfile({ accessToken: 'tok', userId: '123' });
  assert.equal(res.username, 'argo');

  const { url, init } = fetchImpl.calls[0];
  assert.equal(init.method, 'GET');
  assert.match(url, /\/v1\.0\/123\?/);
  const q = new URL(url).searchParams;
  assert.equal(q.get('access_token'), 'tok');
  assert.equal(q.get('appsecret_proof'), appsecretProof('tok', 'sec'));
  assert.ok(q.get('fields').includes('username'));
});

test('createTextContainer 以 POST 帶 body', async () => {
  const fetchImpl = fakeFetch(() => ({ body: { id: 'cont_1' } }));
  const api = createApi({ fetchImpl, appSecret: 'sec' });
  const res = await api.createTextContainer({ accessToken: 'tok', userId: '123', text: 'hi' });
  assert.equal(res.id, 'cont_1');

  const { url, init } = fetchImpl.calls[0];
  assert.equal(init.method, 'POST');
  assert.match(url, /\/v1\.0\/123\/threads$/);
  const body = new URLSearchParams(init.body.toString());
  assert.equal(body.get('media_type'), 'TEXT');
  assert.equal(body.get('text'), 'hi');
  assert.equal(body.get('access_token'), 'tok');
});

test('createTextContainer 帶 topicTag → body 有 topic_tag', async () => {
  const fetchImpl = fakeFetch(() => ({ body: { id: 'c1' } }));
  const api = createApi({ fetchImpl });
  await api.createTextContainer({ accessToken: 'tok', userId: '1', text: 'hi', topicTag: '調酒' });
  const body = new URLSearchParams(fetchImpl.calls[0].init.body.toString());
  assert.equal(body.get('topic_tag'), '調酒');
});

test('createTextContainer 無 topicTag → 不帶 topic_tag', async () => {
  const fetchImpl = fakeFetch(() => ({ body: { id: 'c1' } }));
  const api = createApi({ fetchImpl });
  await api.createTextContainer({ accessToken: 'tok', userId: '1', text: 'hi' });
  const body = new URLSearchParams(fetchImpl.calls[0].init.body.toString());
  assert.equal(body.get('topic_tag'), null);
});

test('publishContainer 打 threads_publish 並帶 creation_id', async () => {
  const fetchImpl = fakeFetch(() => ({ body: { id: 'post_1' } }));
  const api = createApi({ fetchImpl });
  const res = await api.publishContainer({ accessToken: 'tok', userId: '123', creationId: 'cont_1' });
  assert.equal(res.id, 'post_1');

  const { url, init } = fetchImpl.calls[0];
  assert.match(url, /\/threads_publish$/);
  const body = new URLSearchParams(init.body.toString());
  assert.equal(body.get('creation_id'), 'cont_1');
});

test('Meta 錯誤格式轉成含訊息的 Error', async () => {
  const fetchImpl = fakeFetch(() => ({ ok: false, status: 400, body: { error: { message: '壞了', code: 190 } } }));
  const api = createApi({ fetchImpl });
  await assert.rejects(
    () => api.getProfile({ accessToken: 't', userId: '1' }),
    (e) => {
      assert.match(e.message, /壞了/);
      assert.equal(e.apiCode, 190);
      assert.equal(e.status, 400);
      return true;
    }
  );
});

test('refreshLongLivedToken 帶正確 grant_type，且不帶 appsecret_proof', async () => {
  const fetchImpl = fakeFetch(() => ({ body: { access_token: 'newtok', token_type: 'bearer', expires_in: 5184000 } }));
  const api = createApi({ fetchImpl, appSecret: 'sec' });
  const res = await api.refreshLongLivedToken({ accessToken: 'oldtok' });
  assert.equal(res.access_token, 'newtok');

  const q = new URL(fetchImpl.calls[0].url).searchParams;
  assert.equal(q.get('grant_type'), 'th_refresh_token');
  assert.equal(q.get('access_token'), 'oldtok');
  assert.equal(q.get('appsecret_proof'), null);
});

test('exchangeLongLivedToken 帶 client_secret', async () => {
  const fetchImpl = fakeFetch(() => ({ body: { access_token: 'longtok', expires_in: 5184000 } }));
  const api = createApi({ fetchImpl, appSecret: 'sec' });
  const res = await api.exchangeLongLivedToken({ shortLivedToken: 'shorttok' });
  assert.equal(res.access_token, 'longtok');

  const q = new URL(fetchImpl.calls[0].url).searchParams;
  assert.equal(q.get('grant_type'), 'th_exchange_token');
  assert.equal(q.get('client_secret'), 'sec');
  assert.equal(q.get('access_token'), 'shorttok');
});
