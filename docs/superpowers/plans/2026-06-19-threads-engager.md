# Threads Engager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打造一個多帳號、人工把關的 Threads 互動工具：抓 tag 貼文 → AI 評分＋產回覆草稿 → 本機 dashboard 審核 → Playwright 限流送出。

**Architecture:** Node.js + Playwright（每帳號一個 persistent profile）負責抓取與送出；`claude -p` headless CLI 負責相關性評分與草稿生成；SQLite 當唯一狀態來源；Express + 原生 HTML/JS 提供本機審核 dashboard。所有外部依賴（瀏覽器、claude 子行程、時間、隨機）皆以可注入介面包裝，讓核心邏輯能單元測試，瀏覽器互動則以 dry-run + 人工驗證。

**Tech Stack:** Node.js 18+（ESM `.mjs`）、Playwright（chromium）、better-sqlite3、Express、node 內建測試器 `node:test`、supertest（API 測試）。

## Global Constraints

- 執行環境：Node.js 18 以上，全部用 ESM（`.mjs`），測試用 `node --test`（`node:test` + `node:assert/strict`）。
- 每個帳號一個獨立 Playwright persistent context（profile 路徑來自 config），session 隔離。
- **人工審核 gate 為強制機制**：草稿一律先進審核佇列，使用者核准後才可送出。
- **限流為強制機制**：每帳號每日回覆數不得超過 `dailyCap`；送出之間插入隨機擬人延遲。
- **同作者窗口**：同一帳號對同一作者 168 小時（7 天）內最多回一次。
- 所有瀏覽器互動與 `claude -p` 子行程都必須支援 `dryRun` 與可注入 fake，核心邏輯零外部依賴可測。
- UI 與訊息用繁體中文（台灣）。
- 風險聲明：多帳號自動回文有 Meta 封號/限流風險，為已知取捨。

---

### Task 1: 專案骨架與設定載入

**Files:**
- Create: `package.json`
- Create: `config/accounts.example.json`
- Create: `src/config.mjs`
- Create: `.gitignore`
- Test: `test/config.test.mjs`

**Interfaces:**
- Consumes: 無
- Produces:
  - `loadConfig(path: string) => Account[]`
  - `Account = { name: string, profilePath: string, tags: string[], persona: string, filters: { recencyHours: number, minLikes: number }, relevanceThreshold: number, dailyCap: number, enabled: boolean }`
  - `validateAccount(raw: object) => Account`（缺欄位或型別錯誤時 throw `Error`）

- [ ] **Step 1: 建立 package.json**

```json
{
  "name": "threads-engager",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test",
    "setup": "npm install && npx playwright install chromium",
    "dashboard": "node src/server.mjs"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "express": "^4.19.0",
    "playwright": "^1.45.0"
  },
  "devDependencies": {
    "supertest": "^7.0.0"
  }
}
```

- [ ] **Step 2: 建立 .gitignore**

```gitignore
node_modules/
profiles/
data.db
config/accounts.json
```

- [ ] **Step 3: 建立 config/accounts.example.json**

```json
[
  {
    "name": "brand_main",
    "profilePath": "./profiles/brand_main",
    "tags": ["#音樂製作", "#編曲"],
    "persona": "你是一個熱愛電子音樂製作的創作者，語氣親切、專業、不推銷。回覆要針對貼文內容，加入有價值的觀點或鼓勵，限 80 字內，自然口語，不要 hashtag、不要連結。",
    "filters": { "recencyHours": 48, "minLikes": 5 },
    "relevanceThreshold": 0.6,
    "dailyCap": 12,
    "enabled": true
  }
]
```

- [ ] **Step 4: 寫失敗測試 test/config.test.mjs**

```javascript
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
```

- [ ] **Step 5: 跑測試確認失敗**

Run: `node --test test/config.test.mjs`
Expected: FAIL，`Cannot find module '../src/config.mjs'`

- [ ] **Step 6: 實作 src/config.mjs**

```javascript
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
```

- [ ] **Step 7: 跑測試確認通過**

Run: `node --test test/config.test.mjs`
Expected: PASS（4 tests）

- [ ] **Step 8: Commit**

```bash
git add package.json .gitignore config/accounts.example.json src/config.mjs test/config.test.mjs
git commit -m "feat: 專案骨架與帳號設定載入"
```

---

### Task 2: SQLite 狀態儲存層

**Files:**
- Create: `src/store.mjs`
- Test: `test/store.test.mjs`

**Interfaces:**
- Consumes: 無
- Produces:
  - `createStore(dbPath: string) => Store`（`':memory:'` 可用於測試）
  - `Store.upsertPost({account, threadUrl, author, content, likes, postedAt}) => { id: number, inserted: boolean }`（以 `(account, threadUrl)` 去重；既存則回傳原 id、`inserted:false`）
  - `Store.setRelevance(id: number, score: number) => void`
  - `Store.saveDraft(id: number, draftText: string) => void`（同時設 status='drafted'）
  - `Store.editDraft(id: number, editedText: string) => void`
  - `Store.setStatus(id: number, status: string) => void`
  - `Store.markSent(id: number, nowIso: string) => void`（status='sent', sentAt=nowIso）
  - `Store.markFailed(id: number, error: string) => void`（status='failed'）
  - `Store.listByStatus(account: string, status: string) => Row[]`（Row 含 draft 文字，見下）
  - `Store.countSentToday(account: string, nowIso: string) => number`
  - `Store.recentAuthors(account: string, sinceIso: string) => Set<string>`（該時間後已送出回覆的作者集合）
  - `Store.close() => void`
  - `Row = { id, account, threadUrl, author, content, likes, postedAt, relevanceScore, status, discoveredAt, sentAt, error, draftText, editedText }`

- [ ] **Step 1: 寫失敗測試 test/store.test.mjs**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';

const samplePost = {
  account: 'a', threadUrl: 'https://threads.net/t/1',
  author: 'bob', content: 'hi', likes: 10, postedAt: '2026-06-19T00:00:00.000Z',
};

test('upsertPost 新增並去重', () => {
  const s = createStore(':memory:');
  const first = s.upsertPost(samplePost);
  assert.equal(first.inserted, true);
  const again = s.upsertPost(samplePost);
  assert.equal(again.inserted, false);
  assert.equal(again.id, first.id);
  s.close();
});

test('草稿流程: setRelevance → saveDraft → listByStatus', () => {
  const s = createStore(':memory:');
  const { id } = s.upsertPost(samplePost);
  s.setRelevance(id, 0.8);
  s.saveDraft(id, '很棒的分享！');
  const drafted = s.listByStatus('a', 'drafted');
  assert.equal(drafted.length, 1);
  assert.equal(drafted[0].draftText, '很棒的分享！');
  assert.equal(drafted[0].relevanceScore, 0.8);
  s.close();
});

test('countSentToday 只算當天送出', () => {
  const s = createStore(':memory:');
  const { id } = s.upsertPost(samplePost);
  s.markSent(id, '2026-06-19T10:00:00.000Z');
  assert.equal(s.countSentToday('a', '2026-06-19T23:00:00.000Z'), 1);
  assert.equal(s.countSentToday('a', '2026-06-20T01:00:00.000Z'), 0);
  s.close();
});

test('recentAuthors 回傳窗口內已回覆作者', () => {
  const s = createStore(':memory:');
  const { id } = s.upsertPost(samplePost);
  s.markSent(id, '2026-06-19T10:00:00.000Z');
  const authors = s.recentAuthors('a', '2026-06-18T00:00:00.000Z');
  assert.ok(authors.has('bob'));
  s.close();
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node --test test/store.test.mjs`
Expected: FAIL，`Cannot find module '../src/store.mjs'`

- [ ] **Step 3: 實作 src/store.mjs**

```javascript
import Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account TEXT NOT NULL,
  threadUrl TEXT NOT NULL,
  author TEXT,
  content TEXT,
  likes INTEGER DEFAULT 0,
  postedAt TEXT,
  relevanceScore REAL,
  status TEXT NOT NULL DEFAULT 'new',
  discoveredAt TEXT NOT NULL,
  sentAt TEXT,
  error TEXT,
  UNIQUE(account, threadUrl)
);
CREATE TABLE IF NOT EXISTS drafts (
  postId INTEGER PRIMARY KEY,
  draftText TEXT,
  editedText TEXT,
  updatedAt TEXT
);`;

export function createStore(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);

  return {
    upsertPost(p) {
      const existing = db.prepare(
        'SELECT id FROM posts WHERE account=? AND threadUrl=?'
      ).get(p.account, p.threadUrl);
      if (existing) return { id: existing.id, inserted: false };
      const info = db.prepare(`
        INSERT INTO posts (account, threadUrl, author, content, likes, postedAt, discoveredAt)
        VALUES (@account, @threadUrl, @author, @content, @likes, @postedAt, @discoveredAt)
      `).run({ ...p, discoveredAt: new Date().toISOString() });
      return { id: info.lastInsertRowid, inserted: true };
    },
    setRelevance(id, score) {
      db.prepare('UPDATE posts SET relevanceScore=? WHERE id=?').run(score, id);
    },
    saveDraft(id, draftText) {
      db.prepare(`
        INSERT INTO drafts (postId, draftText, updatedAt) VALUES (?, ?, ?)
        ON CONFLICT(postId) DO UPDATE SET draftText=excluded.draftText, updatedAt=excluded.updatedAt
      `).run(id, draftText, new Date().toISOString());
      db.prepare('UPDATE posts SET status=? WHERE id=?').run('drafted', id);
    },
    editDraft(id, editedText) {
      db.prepare('UPDATE drafts SET editedText=?, updatedAt=? WHERE postId=?')
        .run(editedText, new Date().toISOString(), id);
    },
    setStatus(id, status) {
      db.prepare('UPDATE posts SET status=? WHERE id=?').run(status, id);
    },
    markSent(id, nowIso) {
      db.prepare('UPDATE posts SET status=?, sentAt=? WHERE id=?').run('sent', nowIso, id);
    },
    markFailed(id, error) {
      db.prepare('UPDATE posts SET status=?, error=? WHERE id=?').run('failed', error, id);
    },
    listByStatus(account, status) {
      return db.prepare(`
        SELECT p.*, d.draftText, d.editedText
        FROM posts p LEFT JOIN drafts d ON d.postId = p.id
        WHERE p.account=? AND p.status=?
        ORDER BY p.relevanceScore DESC, p.discoveredAt DESC
      `).all(account, status);
    },
    countSentToday(account, nowIso) {
      const day = nowIso.slice(0, 10);
      return db.prepare(`
        SELECT COUNT(*) AS n FROM posts
        WHERE account=? AND status='sent' AND substr(sentAt,1,10)=?
      `).get(account, day).n;
    },
    recentAuthors(account, sinceIso) {
      const rows = db.prepare(`
        SELECT DISTINCT author FROM posts
        WHERE account=? AND status='sent' AND sentAt >= ?
      `).all(account, sinceIso);
      return new Set(rows.map((r) => r.author));
    },
    close() { db.close(); },
  };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `node --test test/store.test.mjs`
Expected: PASS（4 tests）

- [ ] **Step 5: Commit**

```bash
git add src/store.mjs test/store.test.mjs
git commit -m "feat: SQLite 狀態儲存層"
```

---

### Task 3: AI 層（claude -p 評分與草稿）

**Files:**
- Create: `src/ai.mjs`
- Test: `test/ai.test.mjs`

**Interfaces:**
- Consumes: `Account.persona`, `Account.relevanceThreshold`，貼文 `{author, content, likes}`
- Produces:
  - `buildPrompt(post, persona) => string`
  - `parseResult(raw: string) => { score: number, draft: string }`（容忍 ```json 圍欄與前後雜訊；解析失敗時 throw）
  - `scoreAndDraft({ post, persona, threshold, runner }) => Promise<{ score: number, draft: string | null }>`（`score < threshold` 時 `draft:null`；`runner(prompt) => Promise<string>` 可注入，預設為 `defaultRunner`）
  - `defaultRunner(prompt: string) => Promise<string>`（spawn `claude -p <prompt>`，回傳 stdout）

- [ ] **Step 1: 寫失敗測試 test/ai.test.mjs**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, parseResult, scoreAndDraft } from '../src/ai.mjs';

const post = { author: 'bob', content: '剛發了一首新歌', likes: 12 };

test('buildPrompt 含人設與貼文內容', () => {
  const p = buildPrompt(post, '親切的音樂人');
  assert.match(p, /親切的音樂人/);
  assert.match(p, /剛發了一首新歌/);
  assert.match(p, /JSON/);
});

test('parseResult 解析帶圍欄的 JSON', () => {
  const raw = '好的：\n```json\n{"score": 0.8, "draft": "讚！"}\n```\n';
  assert.deepEqual(parseResult(raw), { score: 0.8, draft: '讚！' });
});

test('parseResult 解析純 JSON', () => {
  assert.deepEqual(parseResult('{"score":0.3,"draft":"嗯"}'), { score: 0.3, draft: '嗯' });
});

test('scoreAndDraft 過門檻回傳草稿', async () => {
  const runner = async () => '{"score":0.9,"draft":"很棒的歌！"}';
  const r = await scoreAndDraft({ post, persona: 'x', threshold: 0.6, runner });
  assert.equal(r.score, 0.9);
  assert.equal(r.draft, '很棒的歌！');
});

test('scoreAndDraft 未過門檻草稿為 null', async () => {
  const runner = async () => '{"score":0.3,"draft":"嗯"}';
  const r = await scoreAndDraft({ post, persona: 'x', threshold: 0.6, runner });
  assert.equal(r.score, 0.3);
  assert.equal(r.draft, null);
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node --test test/ai.test.mjs`
Expected: FAIL，`Cannot find module '../src/ai.mjs'`

- [ ] **Step 3: 實作 src/ai.mjs**

```javascript
import { execFile } from 'node:child_process';

export function buildPrompt(post, persona) {
  return [
    `人設：${persona}`,
    '',
    '以下是一則 Threads 貼文，請你：',
    '1. 評估這則貼文與上述人設/主題的相關性，給 0 到 1 的分數（score）。',
    '2. 以人設的口吻寫一則繁體中文回覆草稿（draft），針對貼文內容、自然、有價值、不推銷。',
    '',
    `貼文作者：${post.author}`,
    `貼文讚數：${post.likes}`,
    `貼文內容：${post.content}`,
    '',
    '只輸出一個 JSON 物件，格式：{"score": 數字, "draft": "字串"}，不要其他文字。',
  ].join('\n');
}

export function parseResult(raw) {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('AI 輸出找不到 JSON');
  const obj = JSON.parse(raw.slice(start, end + 1));
  if (typeof obj.score !== 'number' || typeof obj.draft !== 'string') {
    throw new Error('AI 輸出 JSON 缺 score 或 draft');
  }
  return { score: obj.score, draft: obj.draft };
}

export function defaultRunner(prompt) {
  return new Promise((resolve, reject) => {
    execFile('claude', ['-p', prompt], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

export async function scoreAndDraft({ post, persona, threshold, runner = defaultRunner }) {
  const raw = await runner(buildPrompt(post, persona));
  const { score, draft } = parseResult(raw);
  return { score, draft: score >= threshold ? draft : null };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `node --test test/ai.test.mjs`
Expected: PASS（5 tests）

- [ ] **Step 5: Commit**

```bash
git add src/ai.mjs test/ai.test.mjs
git commit -m "feat: AI 評分與草稿層（claude -p）"
```

---

### Task 4: 抓取層（篩選邏輯 + Playwright 抓取）

**Files:**
- Create: `src/scraper.mjs`
- Test: `test/scraper.test.mjs`

**Interfaces:**
- Consumes: `Account`, `Store.upsertPost`
- Produces:
  - `filterPosts(posts, { recencyHours, minLikes, nowMs }) => posts[]`（保留 `likes >= minLikes` 且 `postedAt` 在 `recencyHours` 內者）
  - `scrapeAccount(account, { store, openContext, extractPosts, dryRun }) => Promise<{ found, kept, inserted }>`
    - `openContext(profilePath) => Promise<{ context, page }>`（預設用 chromium.launchPersistentContext）
    - `extractPosts(page, tag) => Promise<RawPost[]>`（預設做 DOM 抓取；可注入 fake）
    - `RawPost = { threadUrl, author, content, likes, postedAt }`
  - `RawPost` 經 `filterPosts` 後逐筆 `store.upsertPost`，回傳統計

- [ ] **Step 1: 寫失敗測試 test/scraper.test.mjs**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterPosts, scrapeAccount } from '../src/scraper.mjs';
import { createStore } from '../src/store.mjs';

const nowMs = Date.parse('2026-06-19T12:00:00.000Z');
const posts = [
  { threadUrl: 'u1', author: 'a', content: 'x', likes: 10, postedAt: '2026-06-19T11:00:00.000Z' },
  { threadUrl: 'u2', author: 'b', content: 'y', likes: 1, postedAt: '2026-06-19T11:00:00.000Z' },
  { threadUrl: 'u3', author: 'c', content: 'z', likes: 99, postedAt: '2026-06-10T00:00:00.000Z' },
];

test('filterPosts 過濾讚數與時效', () => {
  const kept = filterPosts(posts, { recencyHours: 48, minLikes: 5, nowMs });
  assert.deepEqual(kept.map((p) => p.threadUrl), ['u1']);
});

test('scrapeAccount 套篩選並寫入 store', async () => {
  const store = createStore(':memory:');
  const account = {
    name: 'a', profilePath: './p', tags: ['#t'],
    filters: { recencyHours: 48, minLikes: 5 },
  };
  const fakeContext = { close: async () => {} };
  const openContext = async () => ({ context: fakeContext, page: {} });
  const extractPosts = async () => posts;
  const r = await scrapeAccount(account, { store, openContext, extractPosts, dryRun: false, nowMs });
  assert.equal(r.found, 3);
  assert.equal(r.kept, 1);
  assert.equal(r.inserted, 1);
  store.close();
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node --test test/scraper.test.mjs`
Expected: FAIL，`Cannot find module '../src/scraper.mjs'`

- [ ] **Step 3: 實作 src/scraper.mjs**

> Playwright 的 `defaultOpenContext` / `defaultExtractPosts` 內的 Threads 選擇器為**最佳猜測**，必須在執行階段以 dry-run + 人工驗證後修正（見 Task 7 後的驗證步驟）。選擇器全部集中在此檔，便於日後 UI 改版時修改。

```javascript
import { chromium } from 'playwright';

export function filterPosts(posts, { recencyHours, minLikes, nowMs }) {
  const cutoff = nowMs - recencyHours * 3600 * 1000;
  return posts.filter(
    (p) => p.likes >= minLikes && Date.parse(p.postedAt) >= cutoff
  );
}

export async function defaultOpenContext(profilePath) {
  const context = await chromium.launchPersistentContext(profilePath, { headless: false });
  const page = context.pages()[0] || (await context.newPage());
  return { context, page };
}

// 最佳猜測選擇器 — 執行階段需人工驗證/修正
export async function defaultExtractPosts(page, tag) {
  const q = encodeURIComponent(tag.replace(/^#/, ''));
  await page.goto(`https://www.threads.net/search?q=${q}&serp_type=tags`, {
    waitUntil: 'networkidle',
  });
  return page.$$eval('[data-pressable-container] a[href*="/post/"]', (anchors) => {
    const seen = new Set();
    const out = [];
    for (const a of anchors) {
      const url = a.href;
      if (seen.has(url)) continue;
      seen.add(url);
      const container = a.closest('[data-pressable-container]');
      out.push({
        threadUrl: url,
        author: container?.querySelector('a[href^="/@"]')?.textContent?.trim() || '',
        content: container?.innerText?.trim() || '',
        likes: 0,
        postedAt: container?.querySelector('time')?.getAttribute('datetime') || new Date().toISOString(),
      });
    }
    return out;
  });
}

export async function scrapeAccount(
  account,
  { store, openContext = defaultOpenContext, extractPosts = defaultExtractPosts, dryRun = false, nowMs = Date.now() }
) {
  const { context, page } = await openContext(account.profilePath);
  let found = 0;
  let kept = 0;
  let inserted = 0;
  try {
    for (const tag of account.tags) {
      const raw = await extractPosts(page, tag);
      found += raw.length;
      const filtered = filterPosts(raw, { ...account.filters, nowMs });
      kept += filtered.length;
      if (!dryRun) {
        for (const p of filtered) {
          if (store.upsertPost({ account: account.name, ...p }).inserted) inserted += 1;
        }
      }
    }
  } finally {
    await context.close();
  }
  return { found, kept, inserted };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `node --test test/scraper.test.mjs`
Expected: PASS（2 tests）

- [ ] **Step 5: Commit**

```bash
git add src/scraper.mjs test/scraper.test.mjs
git commit -m "feat: 抓取層（篩選 + Playwright）"
```

---

### Task 5: 送出層（限流/節奏 + Playwright 送出）

**Files:**
- Create: `src/sender.mjs`
- Test: `test/sender.test.mjs`

**Interfaces:**
- Consumes: `Account`, `Store.listByStatus`, `Store.countSentToday`, `Store.recentAuthors`, `Store.markSent`, `Store.markFailed`
- Produces:
  - `SAME_AUTHOR_WINDOW_HOURS = 168`（常數匯出）
  - `pickSendable({ approved, sentToday, dailyCap, recentAuthors }) => Row[]`（扣除已達上限的額度；過濾窗口內已回過的作者；同批同作者只留一筆）
  - `humanDelay(minMs, maxMs, rng) => number`
  - `sendReplies(account, { store, openContext, postReply, dryRun, rng, sleep, nowIso }) => Promise<{ attempted, sent, skipped, failed }>`
    - `postReply(page, threadUrl, text) => Promise<void>`（預設做 Playwright UI 回覆；可注入）

- [ ] **Step 1: 寫失敗測試 test/sender.test.mjs**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickSendable, humanDelay, sendReplies } from '../src/sender.mjs';
import { createStore } from '../src/store.mjs';

test('pickSendable 受 dailyCap 限制', () => {
  const approved = [{ id: 1, author: 'a' }, { id: 2, author: 'b' }, { id: 3, author: 'c' }];
  const r = pickSendable({ approved, sentToday: 1, dailyCap: 2, recentAuthors: new Set() });
  assert.equal(r.length, 1);
  assert.equal(r[0].id, 1);
});

test('pickSendable 過濾窗口內已回作者與同批重複作者', () => {
  const approved = [{ id: 1, author: 'a' }, { id: 2, author: 'a' }, { id: 3, author: 'b' }];
  const r = pickSendable({ approved, sentToday: 0, dailyCap: 10, recentAuthors: new Set(['b']) });
  assert.deepEqual(r.map((x) => x.id), [1]);
});

test('humanDelay 落在區間內', () => {
  assert.equal(humanDelay(1000, 2000, () => 0.5), 1500);
});

test('sendReplies dryRun 不呼叫 postReply 但回報', async () => {
  const store = createStore(':memory:');
  const { id } = store.upsertPost({ account: 'a', threadUrl: 'u1', author: 'x', content: 'c', likes: 9, postedAt: '2026-06-19T11:00:00.000Z' });
  store.saveDraft(id, '草稿');
  store.setStatus(id, 'approved');
  let called = 0;
  const r = await sendReplies(
    { name: 'a', profilePath: './p', dailyCap: 5 },
    {
      store,
      openContext: async () => ({ context: { close: async () => {} }, page: {} }),
      postReply: async () => { called += 1; },
      dryRun: true,
      rng: () => 0.5,
      sleep: async () => {},
      nowIso: '2026-06-19T12:00:00.000Z',
    }
  );
  assert.equal(called, 0);
  assert.equal(r.attempted, 1);
  store.close();
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node --test test/sender.test.mjs`
Expected: FAIL，`Cannot find module '../src/sender.mjs'`

- [ ] **Step 3: 實作 src/sender.mjs**

> `defaultPostReply` 的 Threads 回覆選擇器為**最佳猜測**，執行階段需 dry-run + 人工驗證後修正。

```javascript
import { chromium } from 'playwright';

export const SAME_AUTHOR_WINDOW_HOURS = 168;

export function pickSendable({ approved, sentToday, dailyCap, recentAuthors }) {
  const budget = Math.max(0, dailyCap - sentToday);
  const seen = new Set(recentAuthors);
  const out = [];
  for (const row of approved) {
    if (out.length >= budget) break;
    if (seen.has(row.author)) continue;
    seen.add(row.author);
    out.push(row);
  }
  return out;
}

export function humanDelay(minMs, maxMs, rng = Math.random) {
  return Math.round(minMs + (maxMs - minMs) * rng());
}

export async function defaultOpenContext(profilePath) {
  const context = await chromium.launchPersistentContext(profilePath, { headless: false });
  const page = context.pages()[0] || (await context.newPage());
  return { context, page };
}

// 最佳猜測選擇器 — 執行階段需人工驗證/修正
export async function defaultPostReply(page, threadUrl, text) {
  await page.goto(threadUrl, { waitUntil: 'networkidle' });
  await page.click('svg[aria-label="回覆"], svg[aria-label="Reply"]');
  await page.fill('textarea, [contenteditable="true"]', text);
  await page.click('div[role="button"]:has-text("發布"), div[role="button"]:has-text("Post")');
  await page.waitForTimeout(2000);
}

export async function sendReplies(
  account,
  {
    store,
    openContext = defaultOpenContext,
    postReply = defaultPostReply,
    dryRun = false,
    rng = Math.random,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    nowIso = new Date().toISOString(),
  }
) {
  const approved = store.listByStatus(account.name, 'approved');
  const sentToday = store.countSentToday(account.name, nowIso);
  const sinceIso = new Date(Date.parse(nowIso) - SAME_AUTHOR_WINDOW_HOURS * 3600 * 1000).toISOString();
  const recentAuthors = store.recentAuthors(account.name, sinceIso);
  const sendable = pickSendable({ approved, sentToday, dailyCap: account.dailyCap, recentAuthors });

  let sent = 0;
  let failed = 0;
  if (sendable.length === 0) return { attempted: 0, sent: 0, skipped: approved.length, failed: 0 };

  const { context, page } = await openContext(account.profilePath);
  try {
    for (const row of sendable) {
      const text = row.editedText || row.draftText;
      try {
        if (!dryRun) {
          await postReply(page, row.threadUrl, text);
          store.markSent(row.id, new Date().toISOString());
        }
        sent += 1;
      } catch (e) {
        store.markFailed(row.id, String(e.message || e));
        failed += 1;
      }
      await sleep(humanDelay(30000, 120000, rng));
    }
  } finally {
    await context.close();
  }
  return { attempted: sendable.length, sent, skipped: approved.length - sendable.length, failed };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `node --test test/sender.test.mjs`
Expected: PASS（4 tests）

- [ ] **Step 5: Commit**

```bash
git add src/sender.mjs test/sender.test.mjs
git commit -m "feat: 送出層（限流/節奏 + Playwright）"
```

---

### Task 6: Express dashboard 後端 API

**Files:**
- Create: `src/server.mjs`
- Test: `test/server.test.mjs`

**Interfaces:**
- Consumes: `Store`, 注入的 `runScrape(accountName) => Promise<object>`、`runSend(accountName) => Promise<object>`、`accounts: Account[]`
- Produces:
  - `createServer({ store, accounts, runScrape, runSend }) => express.Application`
  - 路由：
    - `GET /api/accounts` → `[{ name }]`
    - `GET /api/posts?account=&status=` → `Row[]`
    - `POST /api/scrape` body `{ account }` → 抓取統計
    - `POST /api/send` body `{ account }` → 送出統計
    - `POST /api/posts/:id/draft` body `{ editedText }` → `{ ok: true }`
    - `POST /api/posts/:id/approve` → `{ ok: true }`
    - `POST /api/posts/:id/skip` → `{ ok: true }`
    - 靜態檔：`/` 提供 `public/`

- [ ] **Step 1: 寫失敗測試 test/server.test.mjs**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createServer } from '../src/server.mjs';
import { createStore } from '../src/store.mjs';

function setup() {
  const store = createStore(':memory:');
  const { id } = store.upsertPost({ account: 'a', threadUrl: 'u1', author: 'x', content: 'c', likes: 9, postedAt: '2026-06-19T11:00:00.000Z' });
  store.setRelevance(id, 0.8);
  store.saveDraft(id, '草稿');
  const app = createServer({
    store,
    accounts: [{ name: 'a' }],
    runScrape: async () => ({ found: 1, kept: 1, inserted: 1 }),
    runSend: async () => ({ attempted: 1, sent: 1, skipped: 0, failed: 0 }),
  });
  return { store, app, id };
}

test('GET /api/accounts 回傳帳號', async () => {
  const { app, store } = setup();
  const res = await request(app).get('/api/accounts');
  assert.equal(res.status, 200);
  assert.equal(res.body[0].name, 'a');
  store.close();
});

test('GET /api/posts 依 status 過濾', async () => {
  const { app, store } = setup();
  const res = await request(app).get('/api/posts?account=a&status=drafted');
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].draftText, '草稿');
  store.close();
});

test('POST approve 改變狀態', async () => {
  const { app, store, id } = setup();
  await request(app).post(`/api/posts/${id}/approve`).send();
  assert.equal(store.listByStatus('a', 'approved').length, 1);
  store.close();
});

test('POST /api/scrape 呼叫 runScrape', async () => {
  const { app, store } = setup();
  const res = await request(app).post('/api/scrape').send({ account: 'a' });
  assert.equal(res.body.inserted, 1);
  store.close();
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node --test test/server.test.mjs`
Expected: FAIL，`Cannot find module '../src/server.mjs'`

- [ ] **Step 3: 實作 src/server.mjs**

```javascript
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfig } from './config.mjs';
import { createStore } from './store.mjs';
import { scrapeAccount } from './scraper.mjs';
import { sendReplies } from './sender.mjs';
import { scoreAndDraft } from './ai.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createServer({ store, accounts, runScrape, runSend }) {
  const app = express();
  app.use(express.json());
  app.use(express.static(join(__dirname, '..', 'public')));

  app.get('/api/accounts', (req, res) => res.json(accounts.map((a) => ({ name: a.name }))));

  app.get('/api/posts', (req, res) => {
    const { account, status = 'drafted' } = req.query;
    res.json(store.listByStatus(account, status));
  });

  app.post('/api/scrape', async (req, res) => {
    try { res.json(await runScrape(req.body.account)); }
    catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.post('/api/send', async (req, res) => {
    try { res.json(await runSend(req.body.account)); }
    catch (e) { res.status(500).json({ error: String(e.message || e) }); }
  });

  app.post('/api/posts/:id/draft', (req, res) => {
    store.editDraft(Number(req.params.id), req.body.editedText);
    res.json({ ok: true });
  });
  app.post('/api/posts/:id/approve', (req, res) => {
    store.setStatus(Number(req.params.id), 'approved');
    res.json({ ok: true });
  });
  app.post('/api/posts/:id/skip', (req, res) => {
    store.setStatus(Number(req.params.id), 'skipped');
    res.json({ ok: true });
  });

  return app;
}

// 直接啟動時：組裝真實依賴並監聽
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const accounts = loadConfig(join(__dirname, '..', 'config', 'accounts.json'));
  const store = createStore(join(__dirname, '..', 'data.db'));
  const byName = (name) => accounts.find((a) => a.name === name);

  const runScrape = async (name) => {
    const account = byName(name);
    const result = await scrapeAccount(account, { store });
    // 對新抓進來的貼文做 AI 評分與草稿
    for (const row of store.listByStatus(name, 'new')) {
      const r = await scoreAndDraft({
        post: { author: row.author, content: row.content, likes: row.likes },
        persona: account.persona,
        threshold: account.relevanceThreshold,
      });
      store.setRelevance(row.id, r.score);
      if (r.draft) store.saveDraft(row.id, r.draft);
      else store.setStatus(row.id, 'skipped');
    }
    return result;
  };
  const runSend = async (name) => sendReplies(byName(name), { store });

  const app = createServer({ store, accounts, runScrape, runSend });
  app.listen(4321, () => console.log('Dashboard: http://localhost:4321'));
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `node --test test/server.test.mjs`
Expected: PASS（4 tests）

- [ ] **Step 5: Commit**

```bash
git add src/server.mjs test/server.test.mjs
git commit -m "feat: Express dashboard 後端 API"
```

---

### Task 7: Dashboard 前端 UI

**Files:**
- Create: `public/index.html`
- Create: `public/app.js`

**Interfaces:**
- Consumes: Task 6 的所有 `/api/*` 路由
- Produces: 單頁 dashboard（無單元測試，以下方驗證步驟人工驗證）

- [ ] **Step 1: 建立 public/index.html**

```html
<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Threads Engager</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 760px; margin: 24px auto; padding: 0 16px; color: #1c1c1e; }
    header { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    select, button { font-size: 15px; padding: 6px 12px; border-radius: 8px; border: 1px solid #ccc; cursor: pointer; }
    button.primary { background: #1c1c1e; color: #fff; border-color: #1c1c1e; }
    .card { border: 1px solid #e0e0e0; border-radius: 12px; padding: 16px; margin: 16px 0; }
    .meta { font-size: 13px; color: #666; margin-bottom: 8px; }
    .meta a { color: #0a66c2; }
    .score { float: right; font-weight: 600; }
    .content { white-space: pre-wrap; background: #f6f6f6; padding: 10px; border-radius: 8px; font-size: 14px; }
    textarea { width: 100%; min-height: 70px; margin-top: 10px; font-size: 15px; padding: 8px; border-radius: 8px; border: 1px solid #ccc; box-sizing: border-box; }
    .actions { margin-top: 10px; display: flex; gap: 8px; }
    #status { color: #666; font-size: 14px; margin-left: auto; }
  </style>
</head>
<body>
  <header>
    <h2 style="margin:0">Threads Engager</h2>
    <select id="account"></select>
    <button id="scrape">開始抓取</button>
    <button id="send" class="primary">送出已核准</button>
    <span id="status"></span>
  </header>
  <div id="queue"></div>
  <script src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: 建立 public/app.js**

```javascript
const $ = (s) => document.querySelector(s);
const status = (t) => { $('#status').textContent = t; };

async function api(path, opts) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  return res.json();
}

async function loadAccounts() {
  const accounts = await api('/api/accounts');
  $('#account').innerHTML = accounts.map((a) => `<option>${a.name}</option>`).join('');
}

async function loadQueue() {
  const account = $('#account').value;
  const posts = await api(`/api/posts?account=${encodeURIComponent(account)}&status=drafted`);
  $('#queue').innerHTML = posts.map((p) => `
    <div class="card" data-id="${p.id}">
      <div class="meta">
        <span class="score">相關性 ${Number(p.relevanceScore).toFixed(2)}</span>
        作者 ${p.author} ・ <a href="${p.threadUrl}" target="_blank">看原貼文 ↗</a>
      </div>
      <div class="content">${p.content}</div>
      <textarea>${p.editedText || p.draftText || ''}</textarea>
      <div class="actions">
        <button class="primary approve">核准</button>
        <button class="skip">跳過</button>
      </div>
    </div>`).join('') || '<p>目前沒有待審草稿。按「開始抓取」。</p>';
}

$('#queue').addEventListener('click', async (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const id = card.dataset.id;
  const text = card.querySelector('textarea').value;
  if (e.target.classList.contains('approve')) {
    await api(`/api/posts/${id}/draft`, { method: 'POST', body: JSON.stringify({ editedText: text }) });
    await api(`/api/posts/${id}/approve`, { method: 'POST' });
    card.remove();
  } else if (e.target.classList.contains('skip')) {
    await api(`/api/posts/${id}/skip`, { method: 'POST' });
    card.remove();
  }
});

$('#scrape').addEventListener('click', async () => {
  status('抓取中…（會開瀏覽器）');
  const r = await api('/api/scrape', { method: 'POST', body: JSON.stringify({ account: $('#account').value }) });
  status(`抓到 ${r.found}、保留 ${r.kept}、新增 ${r.inserted}`);
  await loadQueue();
});

$('#send').addEventListener('click', async () => {
  status('送出中…（限流節奏，請稍候）');
  const r = await api('/api/send', { method: 'POST', body: JSON.stringify({ account: $('#account').value }) });
  status(`送出 ${r.sent}、略過 ${r.skipped}、失敗 ${r.failed}`);
});

$('#account').addEventListener('change', loadQueue);
(async () => { await loadAccounts(); await loadQueue(); })();
```

- [ ] **Step 3: 端到端 dry-run 驗證（人工）**

```bash
# 1. 安裝依賴與瀏覽器
npm run setup
# 2. 從範例建立實際設定，填入你的帳號 tag/persona
cp config/accounts.example.json config/accounts.json
# 3. 啟動 dashboard
npm run dashboard
```

人工驗證清單：
- 開 `http://localhost:4321`，帳號下拉選單顯示你的帳號
- 按「開始抓取」→ 跳出 headed Chromium；**首次需在該視窗手動登入 Threads**（session 存進 profile）
- 確認 `src/scraper.mjs` 的選擇器能抓到貼文；抓不到就在該檔調整 `defaultExtractPosts` 的選擇器後重試
- 草稿卡片出現在佇列，可編輯、核准、跳過
- 按「送出已核准」→ 確認 `src/sender.mjs` 的回覆選擇器能正確貼文；先用少量、確認無誤
- 確認每日上限與送出間隔（30–120 秒）有生效

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/app.js
git commit -m "feat: dashboard 前端 UI"
```

---

## 驗證後備註

- Threads 的 DOM 選擇器（`scraper.mjs` 的 `defaultExtractPosts`、`sender.mjs` 的 `defaultPostReply`）為設計階段最佳猜測，**必須在 Task 7 Step 3 以真實頁面驗證並修正**。這是本計畫唯一需要 live 環境校準的部分；核心邏輯（設定、儲存、AI 解析、篩選、限流）皆已用單元測試覆蓋。
- 若 Threads 反機器人偵測在抓取/送出時觸發（驗證碼、限流），停止並回報，不要重試硬闖（呼應風險聲明）。
```