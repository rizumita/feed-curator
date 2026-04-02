import { db } from "./db";
import type { Feed } from "./types";

export function addFeed(url: string, title?: string, category?: string): void {
  const result = db.prepare(
    "INSERT OR IGNORE INTO feeds (url, title, category) VALUES (?, ?, ?)"
  ).run(url, title ?? null, category ?? null);
  if (result.changes > 0) {
    console.log(`Added feed: ${url}`);
  } else {
    console.log(`Feed already exists: ${url}`);
  }
}

export function listFeeds(): Feed[] {
  return db.prepare("SELECT * FROM feeds ORDER BY created_at DESC").all() as Feed[];
}

export function getAllFeeds(): Feed[] {
  return db.prepare("SELECT * FROM feeds").all() as Feed[];
}

export function updateFeedFetchedAt(feedId: number): void {
  db.prepare("UPDATE feeds SET last_fetched_at = datetime('now') WHERE id = ?").run(feedId);
}

export function updateFeedTitle(feedId: number, title: string): void {
  db.prepare("UPDATE feeds SET title = ? WHERE id = ? AND title IS NULL").run(title, feedId);
}

export function updateFeedCategory(feedId: number, category: string): void {
  db.prepare("UPDATE feeds SET category = ? WHERE id = ?").run(category, feedId);
}
