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
  targetId TEXT,
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
);
CREATE TABLE IF NOT EXISTS auth_token (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  accessToken TEXT NOT NULL,
  expiresAt TEXT,
  updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS native_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draftText TEXT NOT NULL,
  editedText TEXT,
  angle TEXT,
  sourceSummary TEXT,
  status TEXT NOT NULL DEFAULT 'drafted',
  createdAt TEXT NOT NULL,
  publishedAt TEXT,
  publishedPostId TEXT,
  topic TEXT,
  scheduledAt TEXT,
  error TEXT
);
CREATE TABLE IF NOT EXISTS search_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  q TEXT NOT NULL,
  calledAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);`;

export function createStore(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  // 既有 DB 相容：缺欄位則補上
  try { db.exec('ALTER TABLE posts ADD COLUMN targetId TEXT'); } catch { /* 已存在 */ }
  try { db.exec('ALTER TABLE native_drafts ADD COLUMN topic TEXT'); } catch { /* 已存在 */ }
  try { db.exec('ALTER TABLE native_drafts ADD COLUMN scheduledAt TEXT'); } catch { /* 已存在 */ }

  return {
    upsertPost(p) {
      const existing = db.prepare(
        'SELECT id FROM posts WHERE account=? AND threadUrl=?'
      ).get(p.account, p.threadUrl);
      if (existing) return { id: existing.id, inserted: false };
      const info = db.prepare(`
        INSERT INTO posts (account, threadUrl, author, content, likes, postedAt, targetId, discoveredAt)
        VALUES (@account, @threadUrl, @author, @content, @likes, @postedAt, @targetId, @discoveredAt)
      `).run({
        author: null, content: null, likes: 0, postedAt: null, targetId: null,
        ...p,
        discoveredAt: new Date().toISOString(),
      });
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
    // ── Threads 長期 token 持久化（單一帳號，固定 id=1）──
    getToken() {
      return db
        .prepare('SELECT accessToken, expiresAt, updatedAt FROM auth_token WHERE id=1')
        .get() || null;
    },
    setToken(accessToken, expiresAt = null, updatedAt = new Date().toISOString()) {
      db.prepare(`
        INSERT INTO auth_token (id, accessToken, expiresAt, updatedAt)
        VALUES (1, @accessToken, @expiresAt, @updatedAt)
        ON CONFLICT(id) DO UPDATE SET
          accessToken=excluded.accessToken,
          expiresAt=excluded.expiresAt,
          updatedAt=excluded.updatedAt
      `).run({ accessToken, expiresAt, updatedAt });
    },

    // ── 原生貼文草稿佇列 ──
    insertNativeDraft({ draftText, angle = null, sourceSummary = null }) {
      const info = db.prepare(`
        INSERT INTO native_drafts (draftText, angle, sourceSummary, createdAt)
        VALUES (?, ?, ?, ?)
      `).run(draftText, angle, sourceSummary, new Date().toISOString());
      return info.lastInsertRowid;
    },
    listNativeByStatus(status) {
      return db.prepare(
        'SELECT * FROM native_drafts WHERE status=? ORDER BY createdAt DESC, id DESC'
      ).all(status);
    },
    getNativeDraft(id) {
      return db.prepare('SELECT * FROM native_drafts WHERE id=?').get(id) || null;
    },
    editNativeDraft(id, editedText) {
      db.prepare('UPDATE native_drafts SET editedText=? WHERE id=?').run(editedText, id);
    },
    setNativeStatus(id, status) {
      db.prepare('UPDATE native_drafts SET status=? WHERE id=?').run(status, id);
    },
    // 核准 + 排程一次到位：設 topic/scheduledAt，狀態改 approved
    setNativeSchedule(id, scheduledAt, topic = null) {
      db.prepare(
        "UPDATE native_drafts SET status='approved', scheduledAt=?, topic=? WHERE id=?"
      ).run(scheduledAt, topic, id);
    },
    setNativeTopic(id, topic) {
      db.prepare('UPDATE native_drafts SET topic=? WHERE id=?').run(topic, id);
    },
    // 到期、已核准、有排程時間的原生貼文（供排程器發布）
    listDueScheduled(nowIso = new Date().toISOString()) {
      return db.prepare(
        "SELECT * FROM native_drafts WHERE status='approved' AND scheduledAt IS NOT NULL AND scheduledAt <= ? ORDER BY scheduledAt ASC"
      ).all(nowIso);
    },
    markNativePublished(id, postId, nowIso = new Date().toISOString()) {
      db.prepare(
        "UPDATE native_drafts SET status='published', publishedPostId=?, publishedAt=?, error=NULL WHERE id=?"
      ).run(postId, nowIso, id);
    },
    markNativeFailed(id, error) {
      db.prepare('UPDATE native_drafts SET error=? WHERE id=?').run(String(error), id);
    },

    // ── keyword_search 額度紀錄（滾動 7 天）──
    logSearch(q, calledAt = new Date().toISOString()) {
      db.prepare('INSERT INTO search_log (q, calledAt) VALUES (?, ?)').run(q, calledAt);
    },
    countSearches7d(nowIso = new Date().toISOString()) {
      const since = new Date(Date.parse(nowIso) - 7 * 24 * 3600 * 1000).toISOString();
      return db.prepare('SELECT COUNT(*) AS n FROM search_log WHERE calledAt >= ?').get(since).n;
    },

    // ── 應用設定 KV（appSecret / userId / dryRun / setupComplete 等）──
    getSetting(key) {
      const row = db.prepare('SELECT value FROM app_settings WHERE key=?').get(key);
      return row ? row.value : null;
    },
    setSetting(key, value) {
      db.prepare(`
        INSERT INTO app_settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value
      `).run(key, value == null ? null : String(value));
    },

    close() { db.close(); },
  };
}
