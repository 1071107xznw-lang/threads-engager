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
  log = console.log,
}) {
  validateText(text);
  const topicTag = validateTopic(topic);
  const { userId } = settings;

  if (dryRun) {
    log(`[DRY_RUN] 不實際發文${topicTag ? `（主題：${topicTag}）` : ''}。預定發布內容：${text}`);
    return { dryRun: true, id: null, text, topic: topicTag };
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
