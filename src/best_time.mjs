// 最佳發文時段：從**自己的**歷史數據算，不是抄網路上那種「通用最佳發文時間表」。
//
// 為什麼不用通用表：那些表是把所有產業所有受眾平均起來的結果。
// 一間台北餐酒吧的受眾在晚上活動，跟 B2B SaaS 的受眾完全不是同一批人，
// 用平均值等於用一個不存在的人的作息來排程。
//
// 資料不足時（新帳號、剛接上 insights）會回落到預設的活躍時段，
// 但**一定會標示 fallback: true**——UI 要講明「這是預設值不是實測」，
// 不要讓人以為系統算過了。

// 預設活躍時段（小時，24 制）。權重偏晚間——夜間營業的受眾在晚上滑手機。
// 25 = 隔日 01:00：activeHours 用 >24 表示跨日，才不必到處處理午夜換日。
export const DEFAULT_ACTIVE_HOURS = { start: 9, end: 25 };

// 沒有實測資料時的時段偏好順序（好→差）。晚上優先，其次傍晚下班，最後白天。
export const DEFAULT_HOUR_PREFERENCE = [21, 22, 20, 23, 19, 0, 18, 12, 17, 13, 11, 16, 10, 14, 15, 9];

// 依「小時」把貼文的瀏覽數分桶。用本機時區——這台機器就在使用者的時區。
// 回 Map: hour(0–23) → { hour, total, n }
export function bucketByHour(posts = []) {
  const buckets = new Map();
  for (const p of posts) {
    const ts = p?.timestamp;
    if (!ts) continue;
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) continue;
    const views = Number(p?.metrics?.views);
    if (!Number.isFinite(views)) continue;
    const hour = d.getHours();
    const cur = buckets.get(hour) || { hour, total: 0, n: 0 };
    cur.total += views;
    cur.n += 1;
    buckets.set(hour, cur);
  }
  return buckets;
}

// 小時的偏好排序（好→差）。
//
// 回 { hours: number[], fallback: boolean, samples: number }
// - fallback=true 代表「樣本不夠，這是預設值不是實測」——UI 必須照實說。
// - hours 只含 activeHours 窗內的小時；窗內沒被實測涵蓋到的小時會補在後面
//   （依預設偏好排），這樣排程永遠有足夠的候選時段可用。
export function bestHours({
  posts = [],
  minSamples = 10,          // 少於這個則數就不信實測值
  activeHours = DEFAULT_ACTIVE_HOURS,
  preference = DEFAULT_HOUR_PREFERENCE,
} = {}) {
  const inWindow = hoursInWindow(activeHours);
  const inWindowSet = new Set(inWindow);
  // 預設偏好順序，濾成只剩窗內的；窗內但偏好表沒列到的補在最後
  const fallbackOrder = [
    ...preference.filter((h) => inWindowSet.has(h)),
    ...inWindow.filter((h) => !preference.includes(h)),
  ];

  const buckets = bucketByHour(posts);
  const samples = [...buckets.values()].reduce((s, b) => s + b.n, 0);
  if (samples < minSamples) {
    return { hours: fallbackOrder, fallback: true, samples };
  }

  const measured = [...buckets.values()]
    .filter((b) => inWindowSet.has(b.hour))
    .map((b) => ({ hour: b.hour, avgViews: b.total / b.n, n: b.n }))
    .sort((a, b) => b.avgViews - a.avgViews || a.hour - b.hour)
    .map((b) => b.hour);

  // 實測排前面，沒實測到的小時依預設偏好補在後面——排程需要填滿一天，
  // 只給實測到的幾個小時會不夠用。
  const measuredSet = new Set(measured);
  return {
    hours: [...measured, ...fallbackOrder.filter((h) => !measuredSet.has(h))],
    fallback: false,
    samples,
  };
}

// activeHours { start, end } → 窗內的小時陣列。end > 24 代表跨日（25 = 隔日 01:00）。
export function hoursInWindow({ start = 9, end = 25 } = {}) {
  const out = [];
  for (let h = start; h < end; h += 1) out.push(((h % 24) + 24) % 24);
  return [...new Set(out)];
}
