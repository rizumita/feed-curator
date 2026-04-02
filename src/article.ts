import { db } from "./db";
import { canonicalizeUrl } from "./dedupe";
import type { Article } from "./types";

// Re-exports for backward compatibility
export { getConfig, setConfig, getAutoArchiveDays, runAutoArchive } from "./config";
export { saveBriefing, getBriefing, getTodayBriefing } from "./briefing-data";
export { getPreferenceMemo, savePreferenceMemo, isPreferenceMemoStale, getRecentActions } from "./preferences";
export type { RecentAction } from "./preferences";

export type ArticleWithFeed = Article & { feed_title: string | null; category: string | null };

export function getCuratedArticles(sort: "newest" | "score" = "newest", view: "active" | "archive" = "active"): ArticleWithFeed[] {
  const order = sort === "score" ? "a.score DESC" : "a.published_at DESC, a.fetched_at DESC";
  const whereClause = view === "archive"
    ? "WHERE a.curated_at IS NOT NULL AND a.duplicate_of IS NULL AND (a.dismissed_at IS NOT NULL OR a.archived_at IS NOT NULL)"
    : "WHERE a.curated_at IS NOT NULL AND a.duplicate_of IS NULL AND a.dismissed_at IS NULL AND a.archived_at IS NULL";
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
       WHERE a.duplicate_of IS NULL AND a.dismissed_at IS NULL AND a.archived_at IS NULL
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
  const canonical = canonicalizeUrl(url);

  // Check if a canonical duplicate already exists (different URL, same canonical)
  const existing = db.prepare(
    "SELECT id FROM articles WHERE canonical_url = ? AND url != ?"
  ).get(canonical, url) as { id: number } | null;

  const result = db.prepare(
    "INSERT OR IGNORE INTO articles (feed_id, url, title, content, published_at, canonical_url, duplicate_of) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(feedId ?? null, url, title ?? null, content ?? null, publishedAt ?? null, canonical, existing?.id ?? null);
  return result.changes > 0;
}

export function listArticles(uncuratedOnly: boolean = false, limit?: number): Article[] {
  const conditions = ["duplicate_of IS NULL"];
  if (uncuratedOnly) conditions.push("curated_at IS NULL");
  const where = `WHERE ${conditions.join(" AND ")}`;
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
