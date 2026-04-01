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
  summary: string
): void {
  db.run(
    "UPDATE articles SET score = ?, summary = ?, curated_at = datetime('now') WHERE id = ?",
    [score, summary, id]
  );
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
