import { createApi } from './threads_api.mjs';

const DAY_MS = 24 * 3600 * 1000;
const MIN_AGE_MS = 24 * 3600 * 1000; // Meta：token 需 ≥24 小時才可 refresh
const DEFAULT_THRESHOLD_DAYS = 10; // 剩餘天數低於此值才換發

// 取得目前有效 token：DB 有就用 DB，否則以 .env 初始 token 建立 DB 記錄。
// 回傳 { accessToken, expiresAt, updatedAt }。
export function getActiveToken({ store, settings }) {
  const row = store.getToken();
  if (row && row.accessToken) return row;
  store.setToken(settings.accessToken, null); // 到期日未知，先留空
  return store.getToken();
}

// 依需要 refresh 長期 token。近到期（剩餘 < thresholdDays）且 ≥24h 才換；
// 到期日未知時，token 已 ≥24h 就換發一次以建立可追蹤到期日。
// DRY_RUN 下不實際換發，只回報。
export async function refreshIfNeeded({
  store,
  settings,
  api = createApi({ appSecret: settings.appSecret, base: settings.apiBase }),
  now = Date.now(),
  thresholdDays = DEFAULT_THRESHOLD_DAYS,
  dryRun = settings.dryRun,
  log = console.log,
}) {
  const row = getActiveToken({ store, settings });
  const ageMs = now - Date.parse(row.updatedAt);
  const ageOk = ageMs >= MIN_AGE_MS;

  let needRefresh;
  let remainingDays = null;
  if (row.expiresAt) {
    const remainingMs = Date.parse(row.expiresAt) - now;
    remainingDays = remainingMs / DAY_MS;
    needRefresh = remainingMs < thresholdDays * DAY_MS;
  } else {
    // 到期日未知：一旦 token 已 ≥24h，換發一次以取得明確 expires_in。
    needRefresh = ageOk;
  }

  if (!needRefresh) {
    return { refreshed: false, reason: 'fresh', remainingDays, expiresAt: row.expiresAt };
  }
  if (!ageOk) {
    return {
      refreshed: false,
      reason: 'too_young',
      ageHours: ageMs / 3600000,
      expiresAt: row.expiresAt,
    };
  }
  if (dryRun) {
    log('[DRY_RUN] 需要 refresh，但 DRY_RUN 開啟，略過實際換發');
    return { refreshed: false, reason: 'dry_run', remainingDays, expiresAt: row.expiresAt };
  }

  const res = await api.refreshLongLivedToken({ accessToken: row.accessToken });
  const newExpiresAt = res.expires_in
    ? new Date(now + Number(res.expires_in) * 1000).toISOString()
    : null;
  store.setToken(res.access_token, newExpiresAt);
  log(`Token 已 refresh，新到期：${newExpiresAt || '未知'}`);
  return { refreshed: true, expiresAt: newExpiresAt, expiresIn: res.expires_in };
}

// 若 .env 給的是短期 token，交換成長期 token 並寫入 DB。DRY_RUN 下略過。
export async function bootstrapLongLived({
  store,
  settings,
  api = createApi({ appSecret: settings.appSecret, base: settings.apiBase }),
  now = Date.now(),
  dryRun = settings.dryRun,
  log = console.log,
}) {
  if (dryRun) {
    log('[DRY_RUN] 略過短期→長期 token 交換');
    return { exchanged: false, reason: 'dry_run' };
  }
  const res = await api.exchangeLongLivedToken({
    shortLivedToken: settings.accessToken,
    appSecret: settings.appSecret,
  });
  const expiresAt = res.expires_in
    ? new Date(now + Number(res.expires_in) * 1000).toISOString()
    : null;
  store.setToken(res.access_token, expiresAt);
  log(`已換得長期 token，到期：${expiresAt || '未知'}`);
  return { exchanged: true, expiresAt, expiresIn: res.expires_in };
}
