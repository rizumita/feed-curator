import { describe, expect, test, beforeEach } from "vitest";
import { db } from "./db";
import { addFeed, listFeeds, getAllFeeds, updateFeedFetchedAt, updateFeedTitle, updateFeedCategory } from "./feed";

function clearFeeds(): void {
  db.prepare("DELETE FROM articles").run();
  db.prepare("DELETE FROM feeds").run();
}

// ─── addFeed ───

describe("addFeed", () => {
  beforeEach(clearFeeds);

  test("returns true when inserting a new feed", () => {
    expect(addFeed("https://blog.example.com/rss")).toBe(true);
    expect(getAllFeeds().some((f) => f.url === "https://blog.example.com/rss")).toBe(true);
  });

  test("returns false when feed URL already exists", () => {
    addFeed("https://blog.example.com/rss");
    expect(addFeed("https://blog.example.com/rss")).toBe(false);
    expect(getAllFeeds().filter((f) => f.url === "https://blog.example.com/rss")).toHaveLength(1);
  });

  test("stores title and category", () => {
    addFeed("https://blog.example.com/rss", "My Blog", "Tech");
    const feed = getAllFeeds().find((f) => f.url === "https://blog.example.com/rss")!;
    expect(feed.title).toBe("My Blog");
    expect(feed.category).toBe("Tech");
  });

  test("stores category without title", () => {
    addFeed("https://example.com/feed.xml", undefined, "Tech");
    const feed = getAllFeeds().find((f) => f.url === "https://example.com/feed.xml");
    expect(feed!.category).toBe("Tech");
  });

  test("stores null category when not provided", () => {
    addFeed("https://example.com/feed.xml");
    const feed = getAllFeeds().find((f) => f.url === "https://example.com/feed.xml");
    expect(feed!.category).toBeNull();
  });

  test("does not overwrite existing feed on duplicate URL", () => {
    addFeed("https://example.com/feed.xml", undefined, "Original");
    addFeed("https://example.com/feed.xml", undefined, "Updated");
    const feed = getAllFeeds().find((f) => f.url === "https://example.com/feed.xml");
    expect(feed!.category).toBe("Original");
  });
});

// ─── listFeeds ───

describe("listFeeds", () => {
  beforeEach(clearFeeds);

  test("returns empty array when no feeds", () => {
    expect(listFeeds()).toEqual([]);
  });

  test("returns all registered feeds", () => {
    addFeed("https://first.com/rss", "First");
    addFeed("https://second.com/rss", "Second");
    const feeds = listFeeds();
    expect(feeds).toHaveLength(2);
  });
});

// ─── updateFeedTitle ───

describe("updateFeedTitle", () => {
  beforeEach(clearFeeds);

  test("sets title when currently null", () => {
    addFeed("https://example.com/rss");
    const feed = getAllFeeds()[0];
    updateFeedTitle(feed.id, "New Title");
    expect(getAllFeeds().find((f) => f.id === feed.id)!.title).toBe("New Title");
  });

  test("does not overwrite existing title", () => {
    addFeed("https://example.com/rss", "Original");
    const feed = getAllFeeds()[0];
    updateFeedTitle(feed.id, "New Title");
    expect(getAllFeeds().find((f) => f.id === feed.id)!.title).toBe("Original");
  });
});

// ─── updateFeedCategory ───

describe("updateFeedCategory", () => {
  beforeEach(clearFeeds);

  test("sets and overwrites category", () => {
    addFeed("https://example.com/rss", undefined, "Tech");
    const feed = getAllFeeds()[0];
    updateFeedCategory(feed.id, "Science");
    expect(getAllFeeds().find((f) => f.id === feed.id)!.category).toBe("Science");
  });
});
