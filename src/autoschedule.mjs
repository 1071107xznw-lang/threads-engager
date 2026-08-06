import { hoursInWindow, DEFAULT_ACTIVE_HOURS } from './best_time.mjs';

// 自動排程：幫每則新草稿算一個建議發文時間。
//
// 🔴 這裡**只算時間、不核准**。狀態一律維持 drafted，人還是要在 dashboard 按核准
// 才會進發布佇列（CLAUDE.md 規則 2）。publishDue 只撈 status='approved'，
// 所以就算這裡填了一個已經過去的時間，也不會有任何東西被自動送出去。
//
// 為什麼需要間隔而不只是「每日上限」：
// 一天發 15 則本身不會撞到 API 硬限制（官方是 250 則/24h），真正的代價是
// 同帳號連續刷版時自己的貼文互相稀釋推薦池。防線是**時間分散**，不是則數。

export const DEFAULT_MIN_GAP_MINUTES = 55;

// 某個 Date 的「本地日期」字串，用來按天分組。不能用 toISOString（那是 UTC，會跨日錯位）。
export function localDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 產生某一天在活躍時段窗內、間隔 >= minGap 的所有候選時間點。
// dayOffset=0 是今天。跨日的窗（end>24）會延伸到隔天凌晨。
function slotsForDay({ now, dayOffset, activeHours, minGapMinutes }) {
  const base = new Date(now);
  base.setDate(base.getDate() + dayOffset);
  base.setHours(activeHours.start ?? 9, 0, 0, 0);

  const totalMinutes = ((activeHours.end ?? 25) - (activeHours.start ?? 9)) * 60;
  const out = [];
  for (let m = 0; m <= totalMinutes; m += minGapMinutes) {
    out.push(new Date(base.getTime() + m * 60_000));
  }
  return out;
}

// 為 count 則草稿排出建議時間。
//
// 參數：
//   bestHours   —— 小時偏好順序（好→差），best_time.bestHours().hours
//   dailyCap    —— 每個「本地日」最多幾則（含已經佔用的）
//   existing    —— 已佔用的時間（ISO 字串陣列）：已排程的、已發布的都算
//   now         —— 現在（可注入，測試用）
//   horizonDays —— 最多往後排幾天，避免設定錯誤時排到天荒地老
//
// 回傳 count 個 ISO 字串，已依時間排序。排不完就回比較少的（不硬塞）。
export function planSchedule({
  count,
  bestHours = [],
  dailyCap = 15,
  minGapMinutes = DEFAULT_MIN_GAP_MINUTES,
  activeHours = DEFAULT_ACTIVE_HOURS,
  existing = [],
  now = new Date(),
  horizonDays = 30,
} = {}) {
  const need = Math.max(0, Math.trunc(count) || 0);
  if (!need) return [];

  const gap = Math.max(1, Math.trunc(minGapMinutes) || DEFAULT_MIN_GAP_MINUTES);
  const cap = Math.max(1, Math.trunc(dailyCap) || 1);
  const nowMs = new Date(now).getTime();
  // 第一則至少要在一個間隔之後——不要產完稿下一秒就到期
  const earliest = nowMs + gap * 60_000;

  // 已佔用：按本地日計數，並記下確切時間好避開太近的
  const usedPerDay = new Map();
  const takenMs = [];
  for (const iso of existing) {
    const t = new Date(iso);
    if (Number.isNaN(t.getTime())) continue;
    const key = localDateKey(t);
    usedPerDay.set(key, (usedPerDay.get(key) || 0) + 1);
    takenMs.push(t.getTime());
  }

  // 小時越前面越好；沒列到的排最後
  const windowHours = hoursInWindow(activeHours);
  const rankOf = new Map(windowHours.map((h) => [h, Number.MAX_SAFE_INTEGER]));
  bestHours.forEach((h, i) => { if (rankOf.has(h)) rankOf.set(h, i); });

  const picked = [];
  for (let dayOffset = 0; dayOffset < horizonDays && picked.length < need; dayOffset += 1) {
    const dayStart = new Date(nowMs);
    dayStart.setDate(dayStart.getDate() + dayOffset);
    const key = localDateKey(dayStart);
    let room = cap - (usedPerDay.get(key) || 0);
    if (room <= 0) continue;

    const candidates = slotsForDay({ now, dayOffset, activeHours, minGapMinutes: gap })
      .filter((d) => d.getTime() >= earliest)
      // 跟已佔用的、以及這次已挑的，都要拉開至少一個間隔
      .filter((d) => ![...takenMs, ...picked.map((p) => p.getTime())]
        .some((t) => Math.abs(t - d.getTime()) < gap * 60_000));

    // 好時段先挑；同分照時間先後
    candidates.sort((a, b) => {
      const ra = rankOf.get(a.getHours()) ?? Number.MAX_SAFE_INTEGER;
      const rb = rankOf.get(b.getHours()) ?? Number.MAX_SAFE_INTEGER;
      return ra - rb || a.getTime() - b.getTime();
    });

    for (const slot of candidates) {
      if (room <= 0 || picked.length >= need) break;
      // 挑一個就要重新確認間隔——同一輪內先挑的會擋掉後面相鄰的候選
      if (picked.some((p) => Math.abs(p.getTime() - slot.getTime()) < gap * 60_000)) continue;
      picked.push(slot);
      room -= 1;
    }
  }

  return picked
    .sort((a, b) => a.getTime() - b.getTime())
    .map((d) => d.toISOString());
}
