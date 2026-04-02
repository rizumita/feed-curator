import { describe, expect, test, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "http";
import { db } from "./db";
import { addFeed, listFeeds, getAllFeeds, updateFeedFetchedAt, updateFeedTitle, updateFeedCategory } from "./feed";
import { addArticle, listArticles, updateArticleCuration, updateArticleTags, getArticleById, markAsRead, markAsUnread } from "./article";

// Clean up any leftover test data (test DB is set via DB_PATH env in package.json)
beforeAll(() => {
  db.exec("DELETE FROM articles");
  db.exec("DELETE FROM feeds");
  db.exec("DELETE FROM settings");
});

// ─── Database Schema ───

describe("database schema", () => {
  test("feeds table exists with correct columns", () => {
    const cols = db.prepare("PRAGMA table_info(feeds)").all() as any[];
    const names = cols.map((c) => c.name);
    expect(names).toContain("id");
    expect(names).toContain("url");
    expect(names).toContain("title");
    expect(names).toContain("category");
    expect(names).toContain("last_fetched_at");
    expect(names).toContain("created_at");
  });

  test("articles table exists with correct columns", () => {
    const cols = db.prepare("PRAGMA table_info(articles)").all() as any[];
    const names = cols.map((c) => c.name);
    expect(names).toContain("id");
    expect(names).toContain("feed_id");
    expect(names).toContain("url");
    expect(names).toContain("score");
    expect(names).toContain("summary");
    expect(names).toContain("read_at");
    expect(names).toContain("tags");
  });

  test("settings table exists", () => {
    const cols = db.prepare("PRAGMA table_info(settings)").all() as any[];
    const names = cols.map((c) => c.name);
    expect(names).toContain("key");
    expect(names).toContain("value");
  });

  test("indexes exist on articles", () => {
    const indexes = db.prepare("PRAGMA index_list(articles)").all() as any[];
    const names = indexes.map((i) => i.name);
    expect(names).toContain("idx_articles_feed_id");
    expect(names).toContain("idx_articles_curated_at");
    expect(names).toContain("idx_articles_published_at");
    expect(names).toContain("idx_articles_score");
  });

  test("WAL mode is enabled", () => {
    const result = db.prepare("PRAGMA journal_mode").get() as any;
    expect(result.journal_mode).toBe("wal");
  });

  test("foreign keys are enabled", () => {
    const result = db.prepare("PRAGMA foreign_keys").get() as any;
    expect(result.foreign_keys).toBe(1);
  });
});

// ─── Feed CRUD ───

describe("feed management", () => {
  test("addFeed inserts a new feed", () => {
    addFeed("https://test1.com/feed.xml", "Test Feed 1", "Tech");
    const feeds = listFeeds();
    const feed = feeds.find((f) => f.url === "https://test1.com/feed.xml");
    expect(feed).toBeDefined();
    expect(feed!.title).toBe("Test Feed 1");
    expect(feed!.category).toBe("Tech");
  });

  test("addFeed ignores duplicate URL", () => {
    const before = listFeeds().length;
    addFeed("https://test1.com/feed.xml", "Duplicate");
    const after = listFeeds().length;
    expect(after).toBe(before);
  });

  test("addFeed works without optional params", () => {
    addFeed("https://test2.com/feed.xml");
    const feed = listFeeds().find((f) => f.url === "https://test2.com/feed.xml");
    expect(feed).toBeDefined();
    expect(feed!.title).toBeNull();
    expect(feed!.category).toBeNull();
  });

  test("listFeeds returns all feeds", () => {
    const feeds = listFeeds();
    expect(feeds.length).toBe(2);
  });

  test("getAllFeeds returns all feeds", () => {
    const feeds = getAllFeeds();
    expect(feeds.length).toBe(2);
  });

  test("updateFeedTitle only updates when title is NULL", () => {
    const feed = listFeeds().find((f) => f.url === "https://test2.com/feed.xml")!;
    updateFeedTitle(feed.id, "New Title");
    const updated = listFeeds().find((f) => f.id === feed.id)!;
    expect(updated.title).toBe("New Title");

    // Try to update again - should not change since title is no longer NULL
    updateFeedTitle(feed.id, "Should Not Update");
    const unchanged = listFeeds().find((f) => f.id === feed.id)!;
    expect(unchanged.title).toBe("New Title");
  });

  test("updateFeedCategory always updates", () => {
    const feed = listFeeds().find((f) => f.url === "https://test1.com/feed.xml")!;
    updateFeedCategory(feed.id, "AI");
    const updated = listFeeds().find((f) => f.id === feed.id)!;
    expect(updated.category).toBe("AI");
  });

  test("updateFeedFetchedAt sets timestamp", () => {
    const feed = listFeeds().find((f) => f.url === "https://test1.com/feed.xml")!;
    expect(feed.last_fetched_at).toBeNull();
    updateFeedFetchedAt(feed.id);
    const updated = listFeeds().find((f) => f.id === feed.id)!;
    expect(updated.last_fetched_at).not.toBeNull();
  });
});

// ─── Article CRUD ───

describe("article management", () => {
  let feedId: number;

  beforeAll(() => {
    feedId = listFeeds().find((f) => f.url === "https://test1.com/feed.xml")!.id;
  });

  test("addArticle returns true on insert", () => {
    const ok = addArticle("https://example.com/post1", "Post 1", "Content 1", feedId, "2024-01-01");
    expect(ok).toBe(true);
  });

  test("addArticle returns false on duplicate URL", () => {
    const ok = addArticle("https://example.com/post1", "Duplicate");
    expect(ok).toBe(false);
  });

  test("addArticle works without optional params", () => {
    const ok = addArticle("https://example.com/post2");
    expect(ok).toBe(true);
    const article = listArticles().find((a) => a.url === "https://example.com/post2")!;
    expect(article.title).toBeNull();
    expect(article.content).toBeNull();
    expect(article.feed_id).toBeNull();
  });

  test("listArticles returns all articles", () => {
    const articles = listArticles();
    expect(articles.length).toBe(2);
  });

  test("listArticles with uncuratedOnly filters correctly", () => {
    // All articles are uncurated at this point
    const uncurated = listArticles(true);
    const all = listArticles(false);
    expect(uncurated.length).toBe(all.length);
  });

  test("getArticleById returns article", () => {
    const articles = listArticles();
    const article = getArticleById(articles[0].id);
    expect(article).not.toBeNull();
    expect(article!.id).toBe(articles[0].id);
  });

  test("getArticleById returns null for non-existent", () => {
    expect(getArticleById(99999)).toBeNull();
  });

  test("updateArticleCuration sets score, summary, curated_at", () => {
    const article = listArticles().find((a) => a.url === "https://example.com/post1")!;
    updateArticleCuration(article.id, 0.85, "Great article", "ai,tools");

    const updated = getArticleById(article.id)!;
    expect(updated.score).toBe(0.85);
    expect(updated.summary).toBe("Great article");
    expect(updated.tags).toBe("ai,tools");
    expect(updated.curated_at).not.toBeNull();
  });

  test("updateArticleCuration without tags", () => {
    const article = listArticles().find((a) => a.url === "https://example.com/post2")!;
    updateArticleCuration(article.id, 0.5, "OK article");

    const updated = getArticleById(article.id)!;
    expect(updated.score).toBe(0.5);
    expect(updated.summary).toBe("OK article");
    expect(updated.tags).toBeNull();
  });

  test("listArticles uncuratedOnly excludes curated", () => {
    const uncurated = listArticles(true);
    expect(uncurated.length).toBe(0);
  });

  test("updateArticleTags updates tags only", () => {
    const article = listArticles().find((a) => a.url === "https://example.com/post1")!;
    updateArticleTags(article.id, "security,llm");
    const updated = getArticleById(article.id)!;
    expect(updated.tags).toBe("security,llm");
    expect(updated.score).toBe(0.85);
  });

  test("markAsRead sets read_at", () => {
    const article = listArticles().find((a) => a.url === "https://example.com/post1")!;
    expect(article.read_at).toBeNull();
    markAsRead(article.id);
    const updated = getArticleById(article.id)!;
    expect(updated.read_at).not.toBeNull();
  });

  test("markAsUnread clears read_at", () => {
    const article = listArticles().find((a) => a.url === "https://example.com/post1")!;
    markAsUnread(article.id);
    const updated = getArticleById(article.id)!;
    expect(updated.read_at).toBeNull();
  });
});

// ─── Unique Constraints ───

describe("unique constraints", () => {
  test("feed URL uniqueness enforced", () => {
    addFeed("https://unique-test.com/feed.xml");
    const before = listFeeds().length;
    addFeed("https://unique-test.com/feed.xml");
    expect(listFeeds().length).toBe(before);
  });

  test("article URL uniqueness enforced across feeds", () => {
    const feeds = listFeeds();
    const ok1 = addArticle("https://cross-feed-unique.com", "A", undefined, feeds[0].id);
    const ok2 = addArticle("https://cross-feed-unique.com", "B", undefined, feeds[1].id);
    expect(ok1).toBe(true);
    expect(ok2).toBe(false);
  });
});

// ─── Server API ───

describe("server API", () => {
  let baseUrl: string;
  let server: Server;

  beforeAll(async () => {
    // Seed server test data
    db.exec("DELETE FROM articles");
    db.exec("DELETE FROM feeds");

    addFeed("https://server-test.com/feed.xml", "Server Feed", "Tech");
    const feed = listFeeds()[0];
    addArticle("https://server-test.com/p1", "Curated 1", "c1", feed.id, "2024-01-15");
    addArticle("https://server-test.com/p2", "Curated 2", "c2", feed.id, "2024-01-14");
    addArticle("https://server-test.com/p3", "Uncurated", "c3", feed.id);

    const articles = listArticles();
    const a1 = articles.find((a) => a.url === "https://server-test.com/p1")!;
    const a2 = articles.find((a) => a.url === "https://server-test.com/p2")!;
    updateArticleCuration(a1.id, 0.9, "Great", "ai");
    updateArticleCuration(a2.id, 0.6, "OK", "security");

    await new Promise<void>((resolve) => {
      server = createServer(async (req, res) => {
        const url = new URL(req.url!, `http://localhost`);

        if (url.pathname === "/api/articles") {
          const rows = db.prepare(
            `SELECT a.*, f.title as feed_title, f.category
             FROM articles a LEFT JOIN feeds f ON a.feed_id = f.id
             WHERE a.curated_at IS NOT NULL
             ORDER BY a.published_at DESC, a.fetched_at DESC`
          ).all();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(rows));
          return;
        }

        if (url.pathname === "/api/feeds") {
          const rows = db.prepare("SELECT * FROM feeds ORDER BY created_at DESC").all();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(rows));
          return;
        }

        const readMatch = url.pathname.match(/^\/api\/read\/(\d+)$/);
        if (readMatch && req.method === "POST") {
          const id = Number(readMatch[1]);
          const article = db.prepare("SELECT read_at FROM articles WHERE id = ?").get(id) as any;
          if (!article) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false }));
            return;
          }
          if (article.read_at) {
            db.prepare("UPDATE articles SET read_at = NULL WHERE id = ?").run(id);
          } else {
            db.prepare("UPDATE articles SET read_at = datetime('now') WHERE id = ?").run(id);
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        if (url.pathname === "/api/read-batch" && req.method === "POST") {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const { ids } = JSON.parse(Buffer.concat(chunks).toString()) as { ids: number[] };
          for (const id of ids) {
            db.prepare("UPDATE articles SET read_at = datetime('now') WHERE id = ? AND read_at IS NULL").run(id);
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, count: ids.length }));
          return;
        }

        res.writeHead(404);
        res.end("Not Found");
      });

      server.listen(0, () => {
        const addr = server.address() as { port: number };
        baseUrl = `http://localhost:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(() => {
    server?.close();
  });

  test("GET /api/articles returns curated articles only", async () => {
    const res = await fetch(`${baseUrl}/api/articles`);
    expect(res.status).toBe(200);
    const data = await res.json() as any[];
    expect(data.length).toBe(2);
    expect(data.every((a: any) => a.curated_at !== null)).toBe(true);
  });

  test("GET /api/articles includes feed_title and category", async () => {
    const res = await fetch(`${baseUrl}/api/articles`);
    const data = await res.json() as any[];
    expect(data[0].feed_title).toBe("Server Feed");
    expect(data[0].category).toBe("Tech");
  });

  test("GET /api/feeds returns feeds", async () => {
    const res = await fetch(`${baseUrl}/api/feeds`);
    expect(res.status).toBe(200);
    const data = await res.json() as any[];
    expect(data.length).toBe(1);
    expect(data[0].url).toBe("https://server-test.com/feed.xml");
  });

  test("POST /api/read/:id toggles read status", async () => {
    const articles = db.prepare("SELECT id FROM articles WHERE curated_at IS NOT NULL ORDER BY id").all() as any[];
    const id = articles[0].id;

    // Mark read
    await fetch(`${baseUrl}/api/read/${id}`, { method: "POST" });
    let a = db.prepare("SELECT read_at FROM articles WHERE id = ?").get(id) as any;
    expect(a.read_at).not.toBeNull();

    // Toggle back to unread
    await fetch(`${baseUrl}/api/read/${id}`, { method: "POST" });
    a = db.prepare("SELECT read_at FROM articles WHERE id = ?").get(id) as any;
    expect(a.read_at).toBeNull();
  });

  test("POST /api/read/:id returns 404 for non-existent", async () => {
    const res = await fetch(`${baseUrl}/api/read/99999`, { method: "POST" });
    expect(res.status).toBe(404);
  });

  test("POST /api/read-batch marks multiple as read", async () => {
    const articles = db.prepare("SELECT id FROM articles WHERE curated_at IS NOT NULL").all() as any[];
    db.exec("UPDATE articles SET read_at = NULL"); // reset

    const ids = articles.map((a: any) => a.id);
    const res = await fetch(`${baseUrl}/api/read-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    const data = await res.json() as any;
    expect(data.ok).toBe(true);
    expect(data.count).toBe(ids.length);

    for (const id of ids) {
      const a = db.prepare("SELECT read_at FROM articles WHERE id = ?").get(id) as any;
      expect(a.read_at).not.toBeNull();
    }
  });

  test("unknown route returns 404", async () => {
    const res = await fetch(`${baseUrl}/unknown`);
    expect(res.status).toBe(404);
  });
});
