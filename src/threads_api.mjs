import { createHmac } from 'node:crypto';

const DEFAULT_BASE = 'https://graph.threads.net';
const API_VERSION = 'v1.0';

// appsecret_proof = HMAC-SHA256(access_token, app_secret) 的 hex 值。
// App 若開啟「Require app secret」則為必要；有 app secret 時預設帶上。
export function appsecretProof(accessToken, appSecret) {
  return createHmac('sha256', appSecret).update(accessToken).digest('hex');
}

function buildQuery(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) q.set(k, String(v));
  }
  return q;
}

// 統一送出並解析 Meta 回應；非 2xx 或含 error 欄位就丟成含訊息的 Error。
async function request(fetchImpl, method, url, body) {
  const init = { method };
  if (body) init.body = body; // URLSearchParams → 自動帶 x-www-form-urlencoded
  const res = await fetchImpl(url, init);
  const txt = await res.text();
  let data;
  try {
    data = txt ? JSON.parse(txt) : {};
  } catch {
    data = { raw: txt };
  }
  if (res.ok === false || data.error) {
    const e = data.error || {};
    const err = new Error(
      `Threads API 錯誤（HTTP ${res.status ?? '?'}）：${e.message || txt || '未知錯誤'}`
    );
    err.status = res.status;
    err.apiCode = e.code;
    err.apiError = e;
    throw err;
  }
  return data;
}

// 建立一個綁定 base / appSecret / fetch 的 client。所有函式皆可注入 fetchImpl 以利測試。
export function createApi({ fetchImpl = fetch, base = DEFAULT_BASE, appSecret } = {}) {
  const graph = `${base}/${API_VERSION}`;

  // 為需 access_token 的一般呼叫補上 appsecret_proof（若設定了 appSecret）。
  function authed(accessToken, params) {
    const out = { ...params, access_token: accessToken };
    if (appSecret) out.appsecret_proof = appsecretProof(accessToken, appSecret);
    return out;
  }

  return {
    // ── 唯讀 ────────────────────────────────────────────────
    async getProfile({
      accessToken,
      userId,
      fields = 'id,username,name,threads_profile_picture_url,threads_biography',
    }) {
      const q = buildQuery(authed(accessToken, { fields }));
      return request(fetchImpl, 'GET', `${graph}/${userId}?${q}`);
    },

    async listOwnPosts({
      accessToken,
      userId,
      limit = 10,
      fields = 'id,media_type,text,permalink,timestamp,username',
    }) {
      const q = buildQuery(authed(accessToken, { fields, limit }));
      return request(fetchImpl, 'GET', `${graph}/${userId}/threads?${q}`);
    },

    // 單則自己貼文的成效（瀏覽/按讚/留言/轉發…）。需 threads_manage_insights 權限；
    // token 沒這個權限時會回 API 錯誤，由上層 fail-open 處理（不擋產稿）。
    async getMediaInsights({
      accessToken,
      mediaId,
      metrics = 'views,likes,replies,reposts,quotes,shares',
    }) {
      const q = buildQuery(authed(accessToken, { metric: metrics }));
      return request(fetchImpl, 'GET', `${graph}/${mediaId}/insights?${q}`);
    },

    // 站內關鍵字搜尋（供「趨勢素材」用，非用於回覆別人）。
    async keywordSearch({
      accessToken,
      q,
      searchType = 'TOP',
      limit = 10,
      fields = 'id,text,permalink,username,timestamp',
    }) {
      const query = buildQuery(authed(accessToken, { q, search_type: searchType, fields, limit }));
      return request(fetchImpl, 'GET', `${graph}/keyword_search?${query}`);
    },

    // ── 發文（兩步：建立容器 → 發布）───────────────────────────
    async createTextContainer({ accessToken, userId, text, topicTag }) {
      const params = { media_type: 'TEXT', text };
      if (topicTag) params.topic_tag = topicTag;
      const body = buildQuery(authed(accessToken, params));
      return request(fetchImpl, 'POST', `${graph}/${userId}/threads`, body);
    },

    async publishContainer({ accessToken, userId, creationId }) {
      const body = buildQuery(authed(accessToken, { creation_id: creationId }));
      return request(fetchImpl, 'POST', `${graph}/${userId}/threads_publish`, body);
    },

    // 建立「回覆別人貼文」的容器：帶 reply_to_id（對方貼文 id）。發布仍走 publishContainer。
    async createReplyContainer({ accessToken, userId, text, replyToId }) {
      const body = buildQuery(authed(accessToken, { media_type: 'TEXT', text, reply_to_id: replyToId }));
      return request(fetchImpl, 'POST', `${graph}/${userId}/threads`, body);
    },

    // ── Token 端點（不帶版本；用 client_secret / 長期 token 自身認證）──
    async exchangeLongLivedToken({ shortLivedToken, appSecret: secret = appSecret }) {
      const q = buildQuery({
        grant_type: 'th_exchange_token',
        client_secret: secret,
        access_token: shortLivedToken,
      });
      return request(fetchImpl, 'GET', `${base}/access_token?${q}`);
    },

    async refreshLongLivedToken({ accessToken }) {
      const q = buildQuery({ grant_type: 'th_refresh_token', access_token: accessToken });
      return request(fetchImpl, 'GET', `${base}/refresh_access_token?${q}`);
    },
  };
}
