import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { remainingSearchQuota, planRun, isRetryableError, withRetry, clampCap } from '../src/quota.mjs';

test('clampCap：0 就是 0（關閉搜尋，不是回落成 500）；負數/非數字才回落', () => {
  assert.equal(clampCap(0), 0, 'cap=0 應為 0，不能被 || 翻成 500');
  assert.equal(clampCap(100), 100);
  assert.equal(clampCap(9999), 500); // 夾到硬上限
  assert.equal(clampCap(-5), 500);   // 負數回落預設
  assert.equal(clampCap('abc'), 500);
  assert.equal(clampCap(undefined), 500);
});

test('remainingSearchQuota：用量/剩餘/硬上限夾擠', () => {
  const s = createStore(':memory:');
  const now = '2026-07-30T12:00:00.000Z';
  s.logSearch('a', now);
  s.logSearch('b', now);
  const q = remainingSearchQuota({ store: s, cap: 100, nowIso: now });
  assert.equal(q.used, 2);
  assert.equal(q.cap, 100);
  assert.equal(q.remaining, 98);
  // cap 超過官方硬上限 500 時被夾到 500
  assert.equal(remainingSearchQuota({ store: s, cap: 99999, nowIso: now }).cap, 500);
  s.close();
});

test('planRun：額度充裕時按輪次平均分配，且不超過 tag 數', () => {
  const p = planRun({ remaining: 500, tagCount: 42, runsPer7d: 28, reserveRatio: 0.1 });
  // usable = 450 → 每輪 16
  assert.equal(p.usable, 450);
  assert.equal(p.perRunBudget, 16);
  assert.equal(p.tags, 16);
  assert.equal(p.skip, false);
  // tag 數比預算少 → 以 tag 數為準
  assert.equal(planRun({ remaining: 500, tagCount: 5, runsPer7d: 28 }).tags, 5);
});

test('planRun：額度用得快 → 自動降頻（tags 變少）', () => {
  const many = planRun({ remaining: 400, tagCount: 42, runsPer7d: 28, reserveRatio: 0.1 });
  const few = planRun({ remaining: 100, tagCount: 42, runsPer7d: 28, reserveRatio: 0.1 });
  assert.ok(few.tags < many.tags, `剩額度少應該搜更少（${few.tags} < ${many.tags}）`);
});

test('planRun：額度快用完 → skip=true，這輪不搜', () => {
  const p = planRun({ remaining: 5, tagCount: 42, runsPer7d: 28, reserveRatio: 0.1 });
  assert.equal(p.tags, 0);
  assert.equal(p.skip, true);
  // 完全沒額度
  assert.equal(planRun({ remaining: 0, tagCount: 42 }).skip, true);
});

test('isRetryableError：429/5xx/網路錯誤才重試，4xx 不重試', () => {
  assert.equal(isRetryableError({ status: 429 }), true);
  assert.equal(isRetryableError({ status: 500 }), true);
  assert.equal(isRetryableError({ status: 503 }), true);
  assert.equal(isRetryableError({ code: 'ETIMEDOUT' }), true);
  assert.equal(isRetryableError({ status: 400 }), false);
  assert.equal(isRetryableError({ status: 403 }), false);
  assert.equal(isRetryableError(new Error('random')), false);
});

test('withRetry：429 退避後成功，延遲為指數成長', async () => {
  const waits = [];
  let calls = 0;
  const res = await withRetry(
    async () => {
      calls += 1;
      if (calls < 3) { const e = new Error('限流'); e.status = 429; throw e; }
      return 'ok';
    },
    { retries: 3, baseMs: 100, sleepImpl: async (ms) => { waits.push(ms); } },
  );
  assert.equal(res, 'ok');
  assert.equal(calls, 3);
  assert.deepEqual(waits, [100, 200]); // 指數退避
});

test('withRetry：非重試錯誤立即拋，不等待', async () => {
  const waits = [];
  let calls = 0;
  await assert.rejects(
    () => withRetry(
      async () => { calls += 1; const e = new Error('壞參數'); e.status = 400; throw e; },
      { retries: 3, sleepImpl: async (ms) => { waits.push(ms); } },
    ),
    /壞參數/,
  );
  assert.equal(calls, 1);
  assert.equal(waits.length, 0);
});

test('withRetry：重試用盡後拋出最後的錯誤', async () => {
  let calls = 0;
  await assert.rejects(
    () => withRetry(
      async () => { calls += 1; const e = new Error('一直 500'); e.status = 500; throw e; },
      { retries: 2, baseMs: 1, sleepImpl: async () => {} },
    ),
    /一直 500/,
  );
  assert.equal(calls, 3); // 1 次 + 2 次重試
});
