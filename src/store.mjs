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
  try { db.exec('ALTER TABLE native_drafts ADD COLUMN reviewNote TEXT'); } catch { /* 已存在 */ }
  // 以 targetId 去重的部分唯一索引：徹底封死並發下同一則貼文排成兩列（各回一次）。
  // 允許多個 NULL（並非每則 post 都有 targetId）。既有資料若已有重複則建索引會失敗 → 忽略，仍有應用層去重。
  try {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_account_target ON posts(account, targetId) WHERE targetId IS NOT NULL');
  } catch { /* 既有重複資料 → 略過，靠 upsertPost 應用層去重 */ }

  return {
    upsertPost(p) {
      // 去重：優先以 targetId（對方貼文 media id）判定同一則貼文，
      // 否則回落 threadUrl。這樣「手動指定」與「搜尋來的」同一則貼文不會排成兩列各回一次。
      let existing = null;
      if (p.targetId) {
        existing = db.prepare('SELECT id FROM posts WHERE account=? AND targetId=?')
          .get(p.account, p.targetId);
      }
      if (!existing) {
        existing = db.prepare('SELECT id FROM posts WHERE account=? AND threadUrl=?')
          .get(p.account, p.threadUrl);
      }
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
      // 存新草稿時清掉舊的 editedText，避免送出時 (editedText || draftText) 取回過期的人工編輯。
      db.prepare(`
        INSERT INTO drafts (postId, draftText, editedText, updatedAt) VALUES (?, ?, NULL, ?)
        ON CONFLICT(postId) DO UPDATE SET draftText=excluded.draftText, editedText=NULL, updatedAt=excluded.updatedAt
      `).run(id, draftText, new Date().toISOString());
      db.prepare('UPDATE posts SET status=? WHERE id=?').run('drafted', id);
    },
    // 依 targetId 找既有 post（供手動回覆去重／擋重複回覆）。
    findByTargetId(account, targetId) {
      return db.prepare(`
        SELECT p.*, d.draftText, d.editedText
        FROM posts p LEFT JOIN drafts d ON d.postId = p.id
        WHERE p.account=? AND p.targetId=?
      `).get(account, targetId) || null;
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
    insertNativeDraft({ draftText, angle = null, sourceSummary = null, topic = null, reviewNote = null }) {
      const info = db.prepare(`
        INSERT INTO native_drafts (draftText, angle, sourceSummary, topic, reviewNote, createdAt)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(draftText, angle, sourceSummary, topic || null, reviewNote || null, new Date().toISOString());
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
    // 原子性「認領」一則已核准的原生貼文以供發布：把 approved→publishing，回傳是否認領成功。
    // SQLite 序列化寫入，因此排程器、cron、手動「立即發布」三者同時搶同一則時，
    // 只有一方的 UPDATE 會生效（changes>0），其餘 changes=0 → 跳過，避免同一則被發布兩次。
    claimNativeForPublish(id) {
      const info = db.prepare(
        "UPDATE native_drafts SET status='publishing' WHERE id=? AND status='approved'"
      ).run(id);
      return info.changes > 0;
    },
    // 回收孤兒 publishing 列：程序在認領後、標記結果前崩潰／重啟，會留下卡住的 'publishing'。
    // 啟動時把它們標為 failed（不自動重發，避免逾時誤判重複發送）；使用者可在 dashboard 判斷。
    recoverStalePublishing() {
      const info = db.prepare(
        "UPDATE native_drafts SET status='failed', error='發布中斷（程序重啟）；請確認貼文是否已發出，再決定是否重發' WHERE status='publishing'"
      ).run();
      return info.changes;
    },
    markNativePublished(id, postId, nowIso = new Date().toISOString()) {
      db.prepare(
        "UPDATE native_drafts SET status='published', publishedPostId=?, publishedAt=?, error=NULL WHERE id=?"
      ).run(postId, nowIso, id);
    },
    // 發布失敗 → 轉 'failed' 並記 error（不留在 approved，否則每分鐘無限重試、失敗後可能重複發送）。
    markNativeFailed(id, error) {
      db.prepare("UPDATE native_drafts SET status='failed', error=? WHERE id=?").run(String(error), id);
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
    deleteSetting(key) {
      db.prepare('DELETE FROM app_settings WHERE key=?').run(key);
    },

    // ── 切換帳號：清掉目前連接的帳號憑證，回到設定精靈 ──
    // 一實例一帳號（CLAUDE.md 規則 3）：這是「登出 A 再連 B」，不是同時多帳號。
    // ignoreEnvCreds：避免清了 DB 之後又被 .env 裡的舊憑證復活。
    // dryRun 重設為 1：換帳號後預設乾跑，防止對新帳號誤發。
    clearAccount() {
      db.prepare('DELETE FROM auth_token WHERE id=1').run();
      for (const k of ['appSecret', 'userId', 'username', 'setupComplete']) {
        db.prepare('DELETE FROM app_settings WHERE key=?').run(k);
      }
      db.prepare(`
        INSERT INTO app_settings (key, value) VALUES ('dryRun', '1')
        ON CONFLICT(key) DO UPDATE SET value='1'
      `).run();
      db.prepare(`
        INSERT INTO app_settings (key, value) VALUES ('ignoreEnvCreds', '1')
        ON CONFLICT(key) DO UPDATE SET value='1'
      `).run();
      // 取消上一個帳號「已核准/已排程」的待送內容，退回草稿。
      // 否則切到新帳號後，這些內容會用新帳號的身分自動送出（違反規則 2：只發自己核准的）。
      db.prepare("UPDATE native_drafts SET status='drafted', scheduledAt=NULL WHERE status IN ('approved','publishing')").run();
      db.prepare("UPDATE posts SET status='drafted' WHERE status='approved'").run();
    },
    // 清除 .env 回落抑制旗標（.env 重新設定路徑會用到）。
    clearIgnoreEnvCreds() {
      db.prepare("DELETE FROM app_settings WHERE key='ignoreEnvCreds'").run();
    },

    close() { db.close(); },
  };
}
