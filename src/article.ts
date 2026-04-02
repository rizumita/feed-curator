import { db } from "./db";
import type { Article } from "./types";

export function addArticle(
  url: string,
  title?: string,
  content?: string,
  feedId?: number,
  publishedAt?: string
): boolean {
  const result = db.run(
    "INSERT OR IGNORE INTO articles (feed_id, url, title, content, published_at) VALUES (?, ?, ?, ?, ?)",
    [feedId ?? null, url, title ?? null, content ?? null, publishedAt ?? null]
  );
  return result.changes > 0;
}

export function listArticles(uncuratedOnly: boolean = false): Article[] {
  const where = uncuratedOnly ? "WHERE curated_at IS NULL" : "";
  return db
    .query(`SELECT * FROM articles ${where} ORDER BY fetched_at DESC`)
    .all() as Article[];
}

export function updateArticleCuration(
  id: number,
  score: number,
  summary: string,
  tags?: string
): void {
  if (tags !== undefined) {
    db.run(
      "UPDATE articles SET score = ?, summary = ?, tags = ?, curated_at = datetime('now') WHERE id = ?",
      [score, summary, tags, id]
    );
  } else {
    db.run(
      "UPDATE articles SET score = ?, summary = ?, curated_at = datetime('now') WHERE id = ?",
      [score, summary, id]
    );
  }
}

export function updateArticleTags(id: number, tags: string): void {
  db.run("UPDATE articles SET tags = ? WHERE id = ?", [tags, id]);
}

export function getArticleById(id: number): Article | null {
  return (
    (db.query("SELECT * FROM articles WHERE id = ?").get(id) as Article) ?? null
  );
}

export function markAsRead(id: number): void {
  db.run("UPDATE articles SET read_at = datetime('now') WHERE id = ?", [id]);
}

export function markAsUnread(id: number): void {
  db.run("UPDATE articles SET read_at = NULL WHERE id = ?", [id]);
}

export function dismissArticle(id: number): void {
  db.run("UPDATE articles SET dismissed_at = datetime('now') WHERE id = ? AND dismissed_at IS NULL", [id]);
}

export function dismissArticles(ids: number[]): void {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(",");
  db.run(
    `UPDATE articles SET dismissed_at = datetime('now') WHERE id IN (${placeholders}) AND dismissed_at IS NULL`,
    ids
  );
}

export function undismissArticle(id: number): void {
  db.run("UPDATE articles SET dismissed_at = NULL WHERE id = ?", [id]);
}

export function getAutoArchiveDays(): number {
  const row = db.query("SELECT value FROM settings WHERE key = 'auto_archive_days'").get() as { value: string } | null;
  return row ? parseInt(row.value, 10) : 7;
}

export function runAutoArchive(days: number): number {
  const result = db.run(
    `UPDATE articles
     SET archived_at = datetime('now')
     WHERE curated_at IS NOT NULL
       AND read_at IS NULL
       AND dismissed_at IS NULL
       AND archived_at IS NULL
       AND datetime(COALESCE(published_at, fetched_at), '+' || ? || ' days') < datetime('now')`,
    [days]
  );
  return result.changes;
}
