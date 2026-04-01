import { db } from "./db";
import type { Feed } from "./types";

export function addFeed(url: string, title?: string, category?: string): void {
  const result = db.run(
    "INSERT OR IGNORE INTO feeds (url, title, category) VALUES (?, ?, ?)",
    [url, title ?? null, category ?? null]
  );
  if (result.changes > 0) {
    console.log(`Added feed: ${url}`);
  } else {
    console.log(`Feed already exists: ${url}`);
  }
}

export function listFeeds(): Feed[] {
  return db.query("SELECT * FROM feeds ORDER BY created_at DESC").all() as Feed[];
}

export function getAllFeeds(): Feed[] {
  return db.query("SELECT * FROM feeds").all() as Feed[];
}

export function updateFeedFetchedAt(feedId: number): void {
  db.run("UPDATE feeds SET last_fetched_at = datetime('now') WHERE id = ?", [feedId]);
}

export function updateFeedTitle(feedId: number, title: string): void {
  db.run("UPDATE feeds SET title = ? WHERE id = ? AND title IS NULL", [title, feedId]);
}

export function updateFeedCategory(feedId: number, category: string): void {
  db.run("UPDATE feeds SET category = ? WHERE id = ?", [category, feedId]);
}
