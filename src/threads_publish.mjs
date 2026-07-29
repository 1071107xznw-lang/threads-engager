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

// 發布 Argo 自己的一則原生 TEXT 貼文：建立容器 →（等待處理）→ 發布。
// DRY_RUN 開啟時不打任何寫入 API，只記 log 並回傳可預期結果。
export async function publishText({
  settings,
  accessToken,
  text,
  api = createApi({ appSecret: settings.appSecret, base: settings.apiBase }),
  dryRun = settings.dryRun,
  waitMs = 30000, // 官方建議發布前約等 30 秒讓伺服器處理
  sleepImpl = defaultSleep,
  log = console.log,
}) {
  validateText(text);
  const { userId } = settings;

  if (dryRun) {
    log(`[DRY_RUN] 不實際發文。預定發布內容：${text}`);
    return { dryRun: true, id: null, text };
  }

  const container = await api.createTextContainer({ accessToken, userId, text });
  await sleepImpl(waitMs);
  const published = await api.publishContainer({
    accessToken,
    userId,
    creationId: container.id,
  });
  return { dryRun: false, creationId: container.id, id: published.id, text };
}
