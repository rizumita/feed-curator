import { db } from "./db";
import type { Article, Briefing, BriefingCluster } from "./types";

export type ArticleWithFeed = Article & { feed_title: string | null; category: string | null };

export function getCuratedArticles(sort: "newest" | "score" = "newest", view: "active" | "archive" = "active"): ArticleWithFeed[] {
  const order = sort === "score" ? "a.score DESC" : "a.published_at DESC, a.fetched_at DESC";
  const whereClause = view === "archive"
    ? "WHERE a.curated_at IS NOT NULL AND (a.dismissed_at IS NOT NULL OR a.archived_at IS NOT NULL)"
    : "WHERE a.curated_at IS NOT NULL AND a.dismissed_at IS NULL AND a.archived_at IS NULL";
  return db
    .prepare(
      `SELECT a.*, f.title as feed_title, f.category
       FROM articles a
       LEFT JOIN feeds f ON a.feed_id = f.id
       ${whereClause}
       ORDER BY ${order}`
    )
    .all() as ArticleWithFeed[];
}

export function getActiveArticles(sort: "newest" | "score" = "newest"): ArticleWithFeed[] {
  const order = sort === "score" ? "a.score DESC, a.published_at DESC" : "a.published_at DESC, a.fetched_at DESC";
  return db
    .prepare(
      `SELECT a.*, f.title as feed_title, f.category
       FROM articles a
       LEFT JOIN feeds f ON a.feed_id = f.id
       WHERE a.dismissed_at IS NULL AND a.archived_at IS NULL
       ORDER BY ${order}`
    )
    .all() as ArticleWithFeed[];
}

export function getStats(): { total: number; curated: number; unread: number; feeds: number; archived: number } {
  const row = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM articles) as total,
      (SELECT COUNT(*) FROM articles WHERE curated_at IS NOT NULL) as curated,
      (SELECT COUNT(*) FROM articles WHERE curated_at IS NOT NULL AND read_at IS NULL AND dismissed_at IS NULL AND archived_at IS NULL) as unread,
      (SELECT COUNT(*) FROM feeds) as feeds,
      (SELECT COUNT(*) FROM articles WHERE curated_at IS NOT NULL AND (dismissed_at IS NOT NULL OR archived_at IS NOT NULL)) as archived
  `).get() as any;
  return { total: row.total, curated: row.curated, unread: row.unread, feeds: row.feeds, archived: row.archived };
}

export function toggleRead(id: number): boolean {
  const article = db.prepare("SELECT read_at FROM articles WHERE id = ?").get(id) as { read_at: string | null } | null;
  if (!article) return false;
  if (article.read_at) {
    db.prepare("UPDATE articles SET read_at = NULL WHERE id = ?").run(id);
  } else {
    db.prepare("UPDATE articles SET read_at = datetime('now') WHERE id = ?").run(id);
  }
  return true;
}

export function addArticle(
  url: string,
  title?: string,
  content?: string,
  feedId?: number,
  publishedAt?: string
): boolean {
  const result = db.prepare(
    "INSERT OR IGNORE INTO articles (feed_id, url, title, content, published_at) VALUES (?, ?, ?, ?, ?)"
  ).run(feedId ?? null, url, title ?? null, content ?? null, publishedAt ?? null);
  return result.changes > 0;
}

export function listArticles(uncuratedOnly: boolean = false, limit?: number): Article[] {
  const where = uncuratedOnly ? "WHERE curated_at IS NULL" : "";
  const limitClause = limit ? `LIMIT ${limit}` : "";
  return db
    .prepare(`SELECT * FROM articles ${where} ORDER BY fetched_at DESC ${limitClause}`)
    .all() as Article[];
}

export function updateArticleCuration(
  id: number,
  score: number,
  summary: string,
  tags?: string
): void {
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new RangeError(`score must be between 0 and 1, got ${score}`);
  }
  if (tags !== undefined) {
    db.prepare(
      "UPDATE articles SET score = ?, summary = ?, tags = ?, curated_at = datetime('now') WHERE id = ?"
    ).run(score, summary, tags, id);
  } else {
    db.prepare(
      "UPDATE articles SET score = ?, summary = ?, curated_at = datetime('now') WHERE id = ?"
    ).run(score, summary, id);
  }
}

export function updateArticleTags(id: number, tags: string): void {
  db.prepare("UPDATE articles SET tags = ? WHERE id = ?").run(tags, id);
}

export function getArticleById(id: number): Article | null {
  return (
    (db.prepare("SELECT * FROM articles WHERE id = ?").get(id) as Article) ?? null
  );
}

export function markAsRead(id: number): void {
  db.prepare("UPDATE articles SET read_at = datetime('now') WHERE id = ?").run(id);
}

export function markAsUnread(id: number): void {
  db.prepare("UPDATE articles SET read_at = NULL WHERE id = ?").run(id);
}

export function dismissArticle(id: number): void {
  db.prepare("UPDATE articles SET dismissed_at = datetime('now') WHERE id = ? AND dismissed_at IS NULL").run(id);
}

export function dismissArticles(ids: number[]): void {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(",");
  db.prepare(
    `UPDATE articles SET dismissed_at = datetime('now') WHERE id IN (${placeholders}) AND dismissed_at IS NULL`
  ).run(...ids);
}

export function undismissArticle(id: number): void {
  db.prepare("UPDATE articles SET dismissed_at = NULL WHERE id = ?").run(id);
}

export function getAutoArchiveDays(): number {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'auto_archive_days'").get() as { value: string } | null;
  if (!row) return 7;
  const days = parseInt(row.value, 10);
  return Number.isFinite(days) && days > 0 ? days : 7;
}

export function runAutoArchive(days: number): number {
  if (!Number.isFinite(days) || days <= 0) return 0;
  const result = db.prepare(
    `UPDATE articles
     SET archived_at = datetime('now')
     WHERE curated_at IS NOT NULL
       AND read_at IS NULL
       AND dismissed_at IS NULL
       AND archived_at IS NULL
       AND COALESCE(
         datetime(COALESCE(published_at, fetched_at), '+' || ? || ' days'),
         datetime(fetched_at, '+' || ? || ' days')
       ) < datetime('now')`
  ).run(days, days);
  return result.changes;
}

export function saveBriefing(date: string, clusters: BriefingCluster[]): void {
  db.prepare(
    "INSERT OR REPLACE INTO briefings (date, clusters) VALUES (?, ?)"
  ).run(date, JSON.stringify(clusters));
}

export function getBriefing(date: string): Briefing | null {
  return (
    (db.prepare("SELECT * FROM briefings WHERE date = ?").get(date) as Briefing) ?? null
  );
}

export function getTodayBriefing(): Briefing | null {
  const today = new Date().toISOString().slice(0, 10);
  return getBriefing(today);
}

export function getConfig(key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | null;
  return row?.value ?? null;
}

export function setConfig(key: string, value: string): void {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
}

// --- Preference memo helpers ---

export function getPreferenceMemo(): string | null {
  return getConfig("preference_memo");
}

export function savePreferenceMemo(memo: string): void {
  setConfig("preference_memo", memo);
  setConfig("preference_memo_updated_at", new Date().toISOString());
}

export function isPreferenceMemoStale(): boolean {
  const updatedAt = getConfig("preference_memo_updated_at");
  if (!updatedAt) return true; // never generated

  const elapsed = Date.now() - new Date(updatedAt).getTime();
  const oneDayMs = 24 * 60 * 60 * 1000;
  if (elapsed < oneDayMs) return false;

  // Check if enough new actions since last memo update
  const newActions = db.prepare(
    `SELECT COUNT(*) as cnt FROM articles
     WHERE (read_at > ? OR dismissed_at > ?)
       AND curated_at IS NOT NULL`
  ).get(updatedAt, updatedAt) as { cnt: number };
  return newActions.cnt >= 20;
}

export interface RecentAction {
  title: string | null;
  summary: string | null;
  tags: string | null;
  score: number | null;
  action: "read" | "dismissed";
}

export function getRecentActions(days: number, limit: number): RecentAction[] {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  return db.prepare(
    `SELECT title, summary, tags, score,
            CASE WHEN read_at IS NOT NULL THEN 'read' ELSE 'dismissed' END as action
     FROM articles
     WHERE curated_at IS NOT NULL
       AND (read_at > ? OR dismissed_at > ?)
     ORDER BY COALESCE(read_at, dismissed_at) DESC
     LIMIT ?`
  ).all(cutoff, cutoff, limit) as RecentAction[];
}
