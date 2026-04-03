import { describe, expect, test, beforeEach } from "vitest";
import { db } from "./db";
import { addFeed, getAllFeeds } from "./feed";
import { addArticle, updateArticleCuration, markAsRead } from "./article";
import { dismissArticle } from "./article";
import { sampleArticles, computeBehavioralMetrics } from "./eval";

function clearAll(): void {
  db.prepare("DELETE FROM briefings").run();
  db.prepare("DELETE FROM articles").run();
  db.prepare("DELETE FROM feeds").run();
  db.prepare("DELETE FROM settings").run();
}

function seedArticles(count: number): number {
  addFeed("https://feed.test/rss", "Test Feed");
  const feedId = getAllFeeds()[0].id;
  for (let i = 0; i < count; i++) {
    addArticle(`https://example.com/art-${i}`, `Article ${i}`, `Content for article ${i}`, feedId);
  }
  const articles = db.prepare("SELECT id FROM articles ORDER BY id").all() as Array<{ id: number }>;
  for (const a of articles) {
    updateArticleCuration(a.id, Math.random() * 0.8 + 0.1, `Summary for ${a.id}`, "test");
  }
  return feedId;
}

describe("sampleArticles", () => {
  beforeEach(clearAll);

  test("returns empty array when no curated articles", () => {
    expect(sampleArticles(10)).toEqual([]);
  });

  test("returns up to limit articles", () => {
    seedArticles(20);
    const sample = sampleArticles(5);
    expect(sample).toHaveLength(5);
  });

  test("returns all articles if fewer than limit", () => {
    seedArticles(3);
    const sample = sampleArticles(10);
    expect(sample).toHaveLength(3);
  });

  test("each article has required fields", () => {
    seedArticles(5);
    const sample = sampleArticles(5);
    for (const a of sample) {
      expect(a.id).toBeGreaterThan(0);
      expect(typeof a.url).toBe("string");
      expect(typeof a.score).toBe("number");
      expect(typeof a.summary).toBe("string");
      expect(typeof a.content_head).toBe("string");
      expect(a.content_head.length).toBeLessThanOrEqual(500);
    }
  });
});

describe("computeBehavioralMetrics", () => {
  beforeEach(clearAll);

  test("returns zeros when no articles", () => {
    const metrics = computeBehavioralMetrics();
    expect(metrics.total_curated).toBe(0);
    expect(metrics.total_read).toBe(0);
    expect(metrics.read_rate).toBe(0);
  });

  test("computes correct read rate", () => {
    seedArticles(10);
    const articles = db.prepare("SELECT id FROM articles ORDER BY id").all() as Array<{ id: number }>;
    // Read 3 articles
    markAsRead(articles[0].id);
    markAsRead(articles[1].id);
    markAsRead(articles[2].id);

    const metrics = computeBehavioralMetrics();
    expect(metrics.total_curated).toBe(10);
    expect(metrics.total_read).toBe(3);
    expect(metrics.read_rate).toBeCloseTo(0.3, 1);
  });

  test("computes score bands correctly", () => {
    addFeed("https://feed.test/rss", "Test Feed");
    const feedId = getAllFeeds()[0].id;
    // Create articles with specific scores
    addArticle("https://example.com/high", "High", "c", feedId);
    addArticle("https://example.com/mid", "Mid", "c", feedId);
    addArticle("https://example.com/low", "Low", "c", feedId);

    const articles = db.prepare("SELECT id, url FROM articles ORDER BY id").all() as Array<{ id: number; url: string }>;
    updateArticleCuration(articles[0].id, 0.90, "High score", "ai");
    updateArticleCuration(articles[1].id, 0.60, "Mid score", "dev");
    updateArticleCuration(articles[2].id, 0.20, "Low score", "misc");

    const metrics = computeBehavioralMetrics();
    expect(metrics.score_bands.find(b => b.band.includes("Must Read"))?.total).toBe(1);
    expect(metrics.score_bands.find(b => b.band.includes("Worth a Look"))?.total).toBe(1);
    expect(metrics.score_bands.find(b => b.band.includes("Low Priority"))?.total).toBe(1);
  });

  test("counts dismissed articles", () => {
    seedArticles(5);
    const articles = db.prepare("SELECT id FROM articles ORDER BY id").all() as Array<{ id: number }>;
    dismissArticle(articles[0].id);
    dismissArticle(articles[1].id);

    const metrics = computeBehavioralMetrics();
    expect(metrics.total_dismissed).toBe(2);
  });
});
