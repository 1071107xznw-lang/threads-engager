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
