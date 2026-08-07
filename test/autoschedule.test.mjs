import test from 'node:test';
import assert from 'node:assert/strict';
import { planSchedule, localDateKey } from '../src/autoschedule.mjs';
import { bestHours, bucketByHour, hoursInWindow, DEFAULT_ACTIVE_HOURS } from '../src/best_time.mjs';

// 固定一個「本地時間」的基準點，避免測試依賴跑測試當下的時鐘。
// 用本地建構子（不是 ISO 字串）——排程全程走本地時區。
const NOON = new Date(2026, 7, 10, 12, 0, 0); // 2026-08-10 12:00 本地
const hoursOf = (isos) => isos.map((s) => new Date(s).getHours());

// ── best_time ─────────────────────────────────────────
test('bucketByHour：依本地小時分桶，沒有數據/時間的略過', () => {
  const b = bucketByHour([
    { timestamp: new Date(2026, 7, 1, 21, 0).toISOString(), metrics: { views: 1000 } },
    { timestamp: new Date(2026, 7, 2, 21, 30).toISOString(), metrics: { views: 3000 } },
    { timestamp: new Date(2026, 7, 3, 10, 0).toISOString(), metrics: { views: 100 } },
    { timestamp: null, metrics: { views: 999 } },
    { timestamp: new Date(2026, 7, 4, 10, 0).toISOString(), metrics: {} },
  ]);
  assert.deepEqual(b.get(21), { hour: 21, total: 4000, n: 2 });
  assert.deepEqual(b.get(10), { hour: 10, total: 100, n: 1 });
  assert.equal(b.size, 2);
});

test('bestHours：樣本不足要回落，而且一定要說是回落', () => {
  // 資料不足時假裝算過了，比不算還糟——人會照著一個不存在的實測值排程。
  const r = bestHours({ posts: [{ timestamp: NOON.toISOString(), metrics: { views: 100 } }] });
  assert.equal(r.fallback, true);
  assert.equal(r.samples, 1);
  assert.ok(r.hours.length > 0, '回落時也要給得出時段');
  assert.equal(r.hours[0], 21, '預設偏好是晚上優先');
});

test('bestHours：樣本夠就用實測，表現好的小時排前面', () => {
  const posts = [];
  for (let i = 0; i < 6; i += 1) posts.push({ timestamp: new Date(2026, 7, i + 1, 14, 0).toISOString(), metrics: { views: 9000 } });
  for (let i = 0; i < 6; i += 1) posts.push({ timestamp: new Date(2026, 7, i + 1, 21, 0).toISOString(), metrics: { views: 100 } });
  const r = bestHours({ posts });
  assert.equal(r.fallback, false);
  assert.equal(r.samples, 12);
  assert.equal(r.hours[0], 14, '實測 14 點表現好，要排在預設偏好的 21 點前面');
});

test('bestHours：實測沒涵蓋到的小時要補上（排程需要填滿一天）', () => {
  const posts = Array.from({ length: 12 }, (_, i) => ({
    timestamp: new Date(2026, 7, i + 1, 14, 0).toISOString(), metrics: { views: 500 },
  }));
  const r = bestHours({ posts });
  assert.equal(r.hours[0], 14);
  assert.ok(r.hours.length >= 16, '只給一個小時的話，一天排不下 15 則');
});

test('hoursInWindow：end>24 表示跨日', () => {
  assert.deepEqual(hoursInWindow({ start: 22, end: 26 }), [22, 23, 0, 1]);
  assert.equal(hoursInWindow(DEFAULT_ACTIVE_HOURS).length, 16); // 09:00–01:00
});

// ── planSchedule ──────────────────────────────────────
test('planSchedule：排出要求的則數，且時間遞增', () => {
  const out = planSchedule({ count: 15, bestHours: [], now: NOON });
  assert.equal(out.length, 15);
  const ms = out.map((s) => new Date(s).getTime());
  assert.deepEqual(ms, [...ms].sort((a, b) => a - b));
});

test('planSchedule：不排進過去，第一則至少隔一個間隔', () => {
  const out = planSchedule({ count: 3, minGapMinutes: 55, now: NOON });
  const first = new Date(out[0]).getTime();
  assert.ok(first >= NOON.getTime() + 55 * 60_000, `第一則太早：${out[0]}`);
});

test('planSchedule：兩則之間一定隔滿 minGap', () => {
  const out = planSchedule({ count: 15, minGapMinutes: 55, now: NOON });
  for (let i = 1; i < out.length; i += 1) {
    const gap = new Date(out[i]) - new Date(out[i - 1]);
    assert.ok(gap >= 55 * 60_000, `第 ${i} 與 ${i - 1} 則只隔 ${gap / 60_000} 分鐘`);
  }
});

test('planSchedule：同一個本地日不超過 dailyCap', () => {
  const out = planSchedule({ count: 20, dailyCap: 3, now: NOON });
  const perDay = new Map();
  for (const iso of out) {
    const k = localDateKey(new Date(iso));
    perDay.set(k, (perDay.get(k) || 0) + 1);
  }
  for (const [day, n] of perDay) assert.ok(n <= 3, `${day} 排了 ${n} 則，超過上限 3`);
  assert.ok(perDay.size >= 7, '20 則 ÷ 每天 3 則，應該要跨到第 7 天以後');
});

test('planSchedule：已佔用的要算進當天額度', () => {
  // 今天已經有 2 則佔位、上限 3 → 今天只能再排 1 則
  const existing = [
    new Date(2026, 7, 10, 19, 0).toISOString(),
    new Date(2026, 7, 10, 20, 0).toISOString(),
  ];
  const out = planSchedule({ count: 5, dailyCap: 3, existing, now: NOON });
  const today = out.filter((iso) => localDateKey(new Date(iso)) === '2026-08-10');
  assert.equal(today.length, 1);
});

test('planSchedule：不會排在已佔用時段的一個間隔內', () => {
  const taken = new Date(2026, 7, 10, 19, 0);
  const out = planSchedule({
    count: 10, minGapMinutes: 55, existing: [taken.toISOString()], now: NOON,
  });
  for (const iso of out) {
    const diff = Math.abs(new Date(iso) - taken);
    assert.ok(diff >= 55 * 60_000, `${iso} 離已佔用的 19:00 太近`);
  }
});

test('planSchedule：好時段先用（則數少於可用時段時）', () => {
  // 只排 2 則、明說 14 與 15 點最好 → 應該挑得到這兩個小時
  const out = planSchedule({
    count: 2, bestHours: [14, 15], dailyCap: 15, now: new Date(2026, 7, 10, 8, 0),
  });
  assert.deepEqual(hoursOf(out).sort((a, b) => a - b), [14, 15]);
});

test('planSchedule：只排在活躍時段窗內', () => {
  const out = planSchedule({
    count: 30, activeHours: { start: 19, end: 23 }, dailyCap: 4, minGapMinutes: 55, now: NOON,
  });
  for (const h of hoursOf(out)) {
    assert.ok(h >= 19 && h <= 23, `排到窗外的 ${h} 點`);
  }
});

test('planSchedule：count 為 0/負數回空陣列', () => {
  assert.deepEqual(planSchedule({ count: 0, now: NOON }), []);
  assert.deepEqual(planSchedule({ count: -3, now: NOON }), []);
  assert.deepEqual(planSchedule({ now: NOON }), []);
});

test('planSchedule：existing 有壞值不能炸', () => {
  const out = planSchedule({ count: 2, existing: ['亂打的', null, undefined], now: NOON });
  assert.equal(out.length, 2);
});

test('planSchedule：horizonDays 到頂就少排，不會無限往後', () => {
  const out = planSchedule({ count: 100, dailyCap: 1, horizonDays: 3, now: NOON });
  assert.ok(out.length <= 3, `排了 ${out.length} 則，超過 3 天的上限`);
});

// ── 🔥 蹭熱度的要搶最早的時段 ──
// 蹭熱搜的稿排到今晚 22 點的「黃金時段」也救不回來——熱搜幾小時就過期了。
// 所以急件挑「最早」，其餘才挑「成效最好」。
test('planSchedule：急件拿最早的時段，不是最好的時段', () => {
  // 明說 22 點最好；早上 9 點在偏好裡很後面
  const out = planSchedule({
    count: 3, urgentCount: 1, bestHours: [22, 21, 20],
    dailyCap: 15, now: new Date(2026, 7, 10, 8, 0),
  });
  const hrs = hoursOf(out);
  assert.equal(hrs[0], 9, `急件應該排在最早可用的 9 點，實際 ${hrs[0]} 點`);
  // 其餘兩則挑成效好的時段
  assert.deepEqual(hrs.slice(1).sort((a, b) => a - b), [21, 22]);
});

test('planSchedule：urgentCount=0 時全部照最佳時段挑（維持原行為）', () => {
  const out = planSchedule({
    count: 2, bestHours: [22, 21], dailyCap: 15, now: new Date(2026, 7, 10, 8, 0),
  });
  assert.deepEqual(hoursOf(out).sort((a, b) => a - b), [21, 22]);
});

test('planSchedule：全部都是急件時，就是一路照時間往後排', () => {
  const out = planSchedule({
    count: 4, urgentCount: 4, bestHours: [22], minGapMinutes: 55,
    now: new Date(2026, 7, 10, 8, 0),
  });
  // 要驗的是「由早往後連續排」，不是跳到偏好裡最好的 22 點
  const hrs = hoursOf(out);
  assert.equal(out.length, 4);
  assert.ok(hrs[0] <= 10, `第一則應該接近現在，實際排在 ${hrs[0]} 點`);
  assert.ok(hrs.every((h) => h < 14), `全急件不該有人被丟到晚上：${hrs.join(',')}`);
});

test('planSchedule：urgentCount 超過 count 不會多排', () => {
  const out = planSchedule({ count: 2, urgentCount: 99, now: NOON });
  assert.equal(out.length, 2);
});

test('planSchedule：急件也要守每日上限與間隔', () => {
  const out = planSchedule({
    count: 6, urgentCount: 6, dailyCap: 2, minGapMinutes: 55, now: NOON,
  });
  const perDay = new Map();
  for (const iso of out) {
    const k = localDateKey(new Date(iso));
    perDay.set(k, (perDay.get(k) || 0) + 1);
  }
  for (const [d, n] of perDay) assert.ok(n <= 2, `${d} 排了 ${n} 則`);
  for (let i = 1; i < out.length; i += 1) {
    assert.ok(new Date(out[i]) - new Date(out[i - 1]) >= 55 * 60_000);
  }
});
