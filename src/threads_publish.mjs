import { createApi } from './threads_api.mjs';

// 官方上限為 500 字元（以 Unicode code point 計；中文一字算一字）。
// 此為客戶端保護，最終仍以伺服器回應為準。
export const MAX_TEXT_LEN = 500;

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function validateText(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('貼文內容不可為空');
  }
  const len = [...text].length;
  if (len > MAX_TEXT_LEN) {
    throw new Error(`貼文超過 ${MAX_TEXT_LEN} 字上限（目前 ${len} 字）`);
  }
  return text;
}

// Threads 主題(topic_tag)：1–50 字、不可含句點或 & 符號。空值回 null（不帶主題）。
export function validateTopic(topic) {
  if (topic == null) return null;
  const t = String(topic).trim();
  if (!t) return null;
  if ([...t].length > 50) throw new Error('主題不可超過 50 字');
  if (/[.&]/.test(t)) throw new Error('主題不可包含句點(.)或 & 符號');
  return t;
}

// 寬鬆整理 AI 建議的主題：去掉不合規字元/引號/#、截到 50 字，整不出來回 null。
// 用途：主題「建議」是給人參考的，寧可清乾淨也不要整段拒絕（送出前仍走 validateTopic 把關）。
export function sanitizeTopic(raw) {
  if (raw == null) return null;
  let t = String(raw)
    .replace(/[.&#"'`]/g, '') // 去句點、&、井號、引號
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return null;
  t = [...t].slice(0, 50).join(''); // 以字元計截斷
  return t || null;
}

// 官方發布額度：滾動 24 小時內 250 則。
export const PUBLISH_QUOTA_TOTAL = 250;

// 解析 threads_publishing_limit 的回應 → { used, total, remaining }。
// 欄位缺漏或格式不如預期時回 null（代表「查不到」），由呼叫端決定要不要放行。
export function parsePublishingLimit(json) {
  const row = Array.isArray(json?.data) ? json.data[0] : null;
  if (!row) return null;
  const used = Number(row.quota_usage);
  if (!Number.isFinite(used)) return null;
  const total = Number(row.config?.quota_total);
  const cap = Number.isFinite(total) && total > 0 ? total : PUBLISH_QUOTA_TOTAL;
  return { used, total: cap, remaining: Math.max(0, cap - used) };
}

// 查目前的發布額度用量。查不到就回 null——**額度查詢失敗不擋發布**：
// 這是個保護機制，不是必要條件，掛掉不該讓使用者連貼文都發不出去。
export async function checkPublishingQuota({ settings, accessToken, api, log = () => {} }) {
  try {
    const json = await api.getPublishingLimit({ accessToken, userId: settings.userId });
    return parsePublishingLimit(json);
  } catch (e) {
    log(`⚠️ 查不到發布額度用量（略過檢查）：${e.message || e}`);
    return null;
  }
}

// 發布 Argo 自己的一則原生 TEXT 貼文：建立容器 →（等待處理）→ 發布。
// DRY_RUN 開啟時不打任何寫入 API，只記 log 並回傳可預期結果。
export async function publishText({
  settings,
  accessToken,
  text,
  topic,
  api = createApi({ appSecret: settings.appSecret, base: settings.apiBase }),
  dryRun = settings.dryRun,
  waitMs = 30000, // 官方建議發布前約等 30 秒讓伺服器處理
  sleepImpl = defaultSleep,
  checkQuota = true, // 發之前先問官方還剩多少額度
  log = console.log,
}) {
  validateText(text);
  const topicTag = validateTopic(topic);
  const { userId } = settings;

  if (dryRun) {
    log(`[DRY_RUN] 不實際發文${topicTag ? `（主題：${topicTag}）` : ''}。預定發布內容：${text}`);
    return { dryRun: true, id: null, text, topic: topicTag };
  }

  // 額度用完就先擋下來，不要建了容器才失敗——那會留下一個無主的 container。
  if (checkQuota && api.getPublishingLimit) {
    const quota = await checkPublishingQuota({ settings, accessToken, api, log });
    if (quota && quota.remaining <= 0) {
      throw new Error(
        `官方發布額度已用完（24 小時內 ${quota.used}/${quota.total} 則），請稍後再發`
      );
    }
    if (quota && quota.remaining <= 10) {
      log(`⚠️ 發布額度快用完了：24 小時內已用 ${quota.used}/${quota.total}，剩 ${quota.remaining} 則`);
    }
  }

  const container = await api.createTextContainer({ accessToken, userId, text, topicTag });
  await sleepImpl(waitMs);
  const published = await api.publishContainer({
    accessToken,
    userId,
    creationId: container.id,
  });
  return { dryRun: false, creationId: container.id, id: published.id, text, topic: topicTag };
}
