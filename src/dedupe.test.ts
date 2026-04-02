import { describe, expect, test, beforeEach } from "vitest";
import { canonicalizeUrl } from "./dedupe";
import { db } from "./db";
import { addFeed, getAllFeeds } from "./feed";
import { addArticle, listArticles, getCuratedArticles, updateArticleCuration } from "./article";

// ─── canonicalizeUrl ───

describe("canonicalizeUrl", () => {
  test("strips UTM parameters", () => {
    expect(
      canonicalizeUrl("https://example.com/article?utm_source=rss&utm_medium=feed")
    ).toBe("https://example.com/article");
  });

  test("strips multiple tracking parameters", () => {
    expect(
      canonicalizeUrl("https://example.com/post?fbclid=abc&gclid=def&ref=twitter")
    ).toBe("https://example.com/post");
  });

  test("preserves non-tracking parameters", () => {
    expect(
      canonicalizeUrl("https://example.com/search?q=hello&utm_source=rss")
    ).toBe("https://example.com/search?q=hello");
  });

  test("removes www prefix", () => {
    expect(
      canonicalizeUrl("https://www.example.com/article")
    ).toBe("https://example.com/article");
  });

  test("lowercases hostname", () => {
    expect(
      canonicalizeUrl("https://Example.COM/Article")
    ).toBe("https://example.com/Article");
  });

  test("removes fragment", () => {
    expect(
      canonicalizeUrl("https://example.com/article#comments")
    ).toBe("https://example.com/article");
  });

  test("removes trailing slash", () => {
    expect(
      canonicalizeUrl("https://example.com/article/")
    ).toBe("https://example.com/article");
  });

  test("preserves trailing slash on root path", () => {
    expect(
      canonicalizeUrl("https://example.com/")
    ).toBe("https://example.com/");
  });

  test("sorts query parameters for consistency", () => {
    expect(
      canonicalizeUrl("https://example.com/search?z=1&a=2")
    ).toBe("https://example.com/search?a=2&z=1");
  });

  test("handles invalid URL gracefully", () => {
    expect(canonicalizeUrl("not-a-url")).toBe("not-a-url");
  });

  test("identifies same article with different tracking params", () => {
    const url1 = "https://blog.example.com/post-1?utm_source=rss";
    const url2 = "https://blog.example.com/post-1?utm_source=twitter&ref=homepage";
    expect(canonicalizeUrl(url1)).toBe(canonicalizeUrl(url2));
  });

  test("identifies same article with www vs non-www", () => {
    const url1 = "https://www.example.com/article";
    const url2 = "https://example.com/article";
    expect(canonicalizeUrl(url1)).toBe(canonicalizeUrl(url2));
  });

  test("does not conflate different articles", () => {
    const url1 = "https://example.com/article-1";
    const url2 = "https://example.com/article-2";
    expect(canonicalizeUrl(url1)).not.toBe(canonicalizeUrl(url2));
  });
});

// ─── Cross-feed dedup integration ───

function clearAll(): void {
  db.prepare("DELETE FROM briefings").run();
  db.prepare("DELETE FROM articles").run();
  db.prepare("DELETE FROM feeds").run();
}

describe("cross-feed duplicate detection", () => {
  beforeEach(clearAll);

  test("articles with same canonical URL are linked via duplicate_of", () => {
    addFeed("https://feed-a.com/rss", "Feed A");
    addFeed("https://feed-b.com/rss", "Feed B");
    const feeds = getAllFeeds();

    // First article inserted normally
    addArticle("https://example.com/post?utm_source=feedA", "Post", "content", feeds[0].id);
    // Second article with same canonical URL should be marked as duplicate
    addArticle("https://example.com/post?utm_source=feedB", "Post", "content", feeds[1].id);

    const articles = db.prepare("SELECT * FROM articles ORDER BY id").all() as any[];
    expect(articles).toHaveLength(2);
    expect(articles[0].duplicate_of).toBeNull();
    expect(articles[1].duplicate_of).toBe(articles[0].id);
  });

  test("duplicate articles are excluded from uncurated list", () => {
    addFeed("https://feed-a.com/rss", "Feed A");
    addFeed("https://feed-b.com/rss", "Feed B");
    const feeds = getAllFeeds();

    addArticle("https://example.com/post?ref=a", "Post", "content", feeds[0].id);
    addArticle("https://example.com/post?ref=b", "Post", "content", feeds[1].id);
    addArticle("https://example.com/unique", "Unique", "content", feeds[0].id);

    const uncurated = listArticles(true);
    // Only non-duplicate articles should appear
    expect(uncurated).toHaveLength(2);
    expect(uncurated.map(a => a.title)).toContain("Unique");
  });

  test("duplicate articles are excluded from curated articles list", () => {
    addFeed("https://feed-a.com/rss", "Feed A");
    addFeed("https://feed-b.com/rss", "Feed B");
    const feeds = getAllFeeds();

    addArticle("https://example.com/post?ref=a", "Post A", "content", feeds[0].id);
    addArticle("https://example.com/post?ref=b", "Post B", "content", feeds[1].id);

    // Curate both
    const articles = db.prepare("SELECT * FROM articles ORDER BY id").all() as any[];
    updateArticleCuration(articles[0].id, 0.8, "Summary", "ai");
    updateArticleCuration(articles[1].id, 0.7, "Summary", "ai");

    const curated = getCuratedArticles("score");
    // Only the primary (non-duplicate) should appear
    expect(curated).toHaveLength(1);
    expect(curated[0].score).toBe(0.8);
  });

  test("exact same URL is still handled by UNIQUE constraint", () => {
    addFeed("https://feed-a.com/rss", "Feed A");
    const feeds = getAllFeeds();

    const first = addArticle("https://example.com/post", "Post", "content", feeds[0].id);
    const second = addArticle("https://example.com/post", "Post", "content", feeds[0].id);

    expect(first).toBe(true);
    expect(second).toBe(false); // Rejected by UNIQUE

    const articles = db.prepare("SELECT * FROM articles").all() as any[];
    expect(articles).toHaveLength(1);
  });
});
