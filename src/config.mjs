import { readFileSync } from 'node:fs';

const REQUIRED = {
  name: 'string',
  profilePath: 'string',
  tags: 'array',
  persona: 'string',
  relevanceThreshold: 'number',
  dailyCap: 'number',
  enabled: 'boolean',
};

function typeOf(v) {
  return Array.isArray(v) ? 'array' : typeof v;
}

export function validateAccount(raw) {
  for (const [key, type] of Object.entries(REQUIRED)) {
    if (!(key in raw)) throw new Error(`帳號設定缺少欄位: ${key}`);
    if (typeOf(raw[key]) !== type) {
      throw new Error(`帳號設定欄位 ${key} 型別錯誤，應為 ${type}`);
    }
  }
  if (typeOf(raw.filters) !== 'object') throw new Error('帳號設定缺少 filters 物件');
  if (typeOf(raw.filters.recencyHours) !== 'number') throw new Error('filters.recencyHours 型別錯誤');
  if (typeOf(raw.filters.minLikes) !== 'number') throw new Error('filters.minLikes 型別錯誤');
  return raw;
}

export function loadConfig(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('accounts.json 應為陣列');
  return raw.map(validateAccount);
}
