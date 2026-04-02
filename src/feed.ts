import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./db";
import type { Feed } from "./types";
import { addArticle } from "./article";
import { parseFeed } from "./rss";

export function addFeed(url: string, title?: string, category?: string): boolean {
  const result = db.prepare(
    "INSERT OR IGNORE INTO feeds (url, title, category) VALUES (?, ?, ?)"
  ).run(url, title ?? null, category ?? null);
  return result.changes > 0;
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

export function removeFeed(feedId: number): void {
  db.prepare("DELETE FROM articles WHERE feed_id = ?").run(feedId);
  db.prepare("DELETE FROM feeds WHERE id = ?").run(feedId);
}

export function loadStarterFeeds(customPath?: string): number {
  let filePath: string;
  if (customPath) {
    filePath = resolve(customPath);
  } else {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    filePath = resolve(__dirname, "../examples/starter-feeds.json");
  }

  const json = JSON.parse(readFileSync(filePath, "utf-8"));
  const feeds: Array<{ url: string; category?: string }> = json.feeds;
  let count = 0;
  for (const f of feeds) {
    if (addFeed(f.url, undefined, f.category)) count++;
  }
  return count;
}

export async function fetchAllFeeds(opts?: { verbose?: boolean; onProgress?: (msg: string) => void }): Promise<number> {
  const verbose = opts?.verbose ?? false;
  const notify = (msg: string) => { if (verbose) console.log(msg); opts?.onProgress?.(msg); };
  const feeds = getAllFeeds();
  if (feeds.length === 0) {
    notify("No feeds registered.");
    return 0;
  }

  let totalNew = 0;
  for (let i = 0; i < feeds.length; i++) {
    const feed = feeds[i];
    notify(`Fetching feed ${i + 1}/${feeds.length}: ${feed.title ?? feed.url}...`);
    try {
      const response = await fetch(feed.url);
      if (!response.ok) {
        notify(`Failed to fetch ${feed.url}: ${response.status}`);
        continue;
      }
      const contentLength = Number(response.headers.get("content-length") || 0);
      if (contentLength > 10 * 1024 * 1024) {
        notify(`Skipping ${feed.url}: response too large`);
        continue;
      }
      const xml = await response.text();
      const { title, items } = parseFeed(xml);

      if (title) updateFeedTitle(feed.id, title);

      let newCount = 0;
      for (const item of items) {
        if (!item.url) continue;
        const added = addArticle(
          item.url,
          item.title,
          item.content,
          feed.id,
          item.publishedAt ?? undefined
        );
        if (added) newCount++;
      }

      updateFeedFetchedAt(feed.id);
      notify(`${feed.title ?? feed.url}: ${newCount} new articles (${items.length} total)`);
      totalNew += newCount;
    } catch (err) {
      notify(`Error fetching ${feed.url}`);
    }
  }
  notify(`Total: ${totalNew} new articles added.`);
  return totalNew;
}
