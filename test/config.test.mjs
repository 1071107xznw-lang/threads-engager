import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAccount } from '../src/config.mjs';

const valid = {
  name: 'a', profilePath: './profiles/a', tags: ['#x'],
  persona: 'p', filters: { recencyHours: 24, minLikes: 1 },
  relevanceThreshold: 0.5, dailyCap: 10, enabled: true,
};

test('validateAccount 接受合法設定', () => {
  assert.deepEqual(validateAccount(valid), valid);
});

test('validateAccount 缺 name 時拋錯', () => {
  const bad = { ...valid };
  delete bad.name;
  assert.throws(() => validateAccount(bad), /name/);
});

test('validateAccount tags 非陣列時拋錯', () => {
  assert.throws(() => validateAccount({ ...valid, tags: '#x' }), /tags/);
});

test('validateAccount dailyCap 非數字時拋錯', () => {
  assert.throws(() => validateAccount({ ...valid, dailyCap: 'ten' }), /dailyCap/);
});
