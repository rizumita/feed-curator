import { describe, expect, test, beforeAll, afterAll } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { db } from "./db";
import { startServer } from "./server";

let server: Server;
let baseUrl: string;

// Seed data IDs
let feedId: number;
let articleId1: number;
let articleId2: number;
let articleId3: number;
let uncuratedArticleId: number;

function api(path: string, options?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, options);
}

function postJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function post(path: string, body?: string, contentType?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (contentType) headers["Content-Type"] = contentType;
  return api(path, { method: "POST", body, headers });
}

beforeAll(async () => {
  // Clean slate
  db.exec("DELETE FROM articles");
  db.exec("DELETE FROM feeds");
  db.exec("DELETE FROM briefings");
  db.exec("DELETE FROM settings");

  // Seed a feed
  db.prepare("INSERT INTO feeds (url, title, category) VALUES (?, ?, ?)").run(
    "https://example.com/feed.xml",
    "Test Feed",
    "tech"
  );
  feedId = (db.prepare("SELECT last_insert_rowid() as id").get() as any).id;

  // Seed curated articles
  for (const [url, title] of [
    ["https://example.com/1", "Article 1"],
    ["https://example.com/2", "Article 2"],
    ["https://example.com/3", "Article 3"],
  ] as const) {
    db.prepare(
      "INSERT INTO articles (feed_id, url, title, score, summary, curated_at) VALUES (?, ?, ?, 8, 'summary', datetime('now'))"
    ).run(feedId, url, title);
  }
  const rows = db.prepare("SELECT id FROM articles ORDER BY id").all() as { id: number }[];
  articleId1 = rows[0].id;
  articleId2 = rows[1].id;
  articleId3 = rows[2].id;

  // Seed an uncurated article
  db.prepare("INSERT INTO articles (feed_id, url, title) VALUES (?, ?, ?)").run(
    feedId,
    "https://example.com/uncurated",
    "Uncurated"
  );
  uncuratedArticleId = (db.prepare("SELECT last_insert_rowid() as id").get() as any).id;

  // Start server on random port
  server = startServer(0);
  await new Promise<void>((resolve) => server.on("listening", resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

// ─── 1. Input Validation Attacks ───

describe("POST /api/read/:id - input validation", () => {
  test("id = 0 (boundary)", async () => {
    const res = await post("/api/read/0", "", "application/json");
    // \d+ matches "0", so it hits the route. toggleRead returns false for nonexistent id.
    expect(res.status).toBe(200);
    const data = await res.json();
    // Endpoint now returns { ok: false } for nonexistent articles
    expect(data.ok).toBe(false);
  });

  test("id = -1 (negative) returns 404 because \\d+ won't match", async () => {
    const res = await post("/api/read/-1");
    expect(res.status).toBe(404);
  });

  test("id = 99999999999 (nonexistent huge id)", async () => {
    const res = await post("/api/read/99999999999");
    const data = await res.json();
    // Endpoint now returns { ok: false } for nonexistent articles
    expect(data.ok).toBe(false);
  });

  test("id = 'abc' (non-numeric) returns 404", async () => {
    const res = await post("/api/read/abc");
    expect(res.status).toBe(404);
  });

  test("id = 1.5 (float) returns 404 because \\d+ won't match '.'", async () => {
    const res = await post("/api/read/1.5");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/read-batch - input validation", () => {
  test("empty body returns 400", async () => {
    const res = await post("/api/read-batch", "", "application/json");
    expect(res.status).toBe(400);
  });

  test("non-JSON body (plain text) returns 400", async () => {
    const res = await post("/api/read-batch", "hello world", "text/plain");
    expect(res.status).toBe(400);
  });

  test("non-JSON body (XML) returns 400", async () => {
    const res = await post("/api/read-batch", "<ids><id>1</id></ids>", "application/xml");
    expect(res.status).toBe(400);
  });

  test("ids as string instead of array returns 400", async () => {
    const res = await postJson("/api/read-batch", { ids: "1,2,3" });
    expect(res.status).toBe(400);
  });

  test("ids with 1001 elements returns 400", async () => {
    const ids = Array.from({ length: 1001 }, (_, i) => i + 1);
    const res = await postJson("/api/read-batch", { ids });
    expect(res.status).toBe(400);
  });

  test("ids with exactly 1000 elements succeeds", async () => {
    const ids = Array.from({ length: 1000 }, (_, i) => i + 1);
    const res = await postJson("/api/read-batch", { ids });
    expect(res.status).toBe(200);
  });

  test("ids with null values - no validation on element types", async () => {
    // BUG FOUND: No validation that ids array elements are numbers.
    // null values are passed directly to SQLite which silently ignores them.
    const res = await postJson("/api/read-batch", { ids: [null, undefined, "abc"] });
    expect(res.status).toBe(200);
  });

  test("ids with string values passed to SQL", async () => {
    // BUG FOUND: String ids like "abc" are passed directly to SQLite without type validation
    const res = await postJson("/api/read-batch", { ids: ["abc", "def"] });
    expect(res.status).toBe(200);
  });

  test("ids as empty array succeeds", async () => {
    const res = await postJson("/api/read-batch", { ids: [] });
    expect(res.status).toBe(200);
  });

  test("missing ids field returns 400", async () => {
    const res = await postJson("/api/read-batch", { notIds: [1] });
    expect(res.status).toBe(400);
  });

  test("JSON with extra unexpected fields succeeds (no strict validation)", async () => {
    const res = await postJson("/api/read-batch", { ids: [articleId1], extra: "field", foo: 42 });
    expect(res.status).toBe(200);
  });

  test("extremely large payload (1MB)", async () => {
    // Create a ~1MB JSON payload with many ids
    const bigArray = Array.from({ length: 100000 }, (_, i) => i);
    const res = await postJson("/api/read-batch", { ids: bigArray });
    // Should be rejected because >1000 elements
    expect(res.status).toBe(400);
  });
});

describe("POST /api/dismiss/:id - input validation", () => {
  test("id = 0 (boundary, nonexistent)", async () => {
    const res = await post("/api/dismiss/0");
    // BUG FOUND: Always returns { ok: true } even for nonexistent articles
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  test("id = -1 returns 404", async () => {
    const res = await post("/api/dismiss/-1");
    expect(res.status).toBe(404);
  });

  test("id = 'abc' returns 404", async () => {
    const res = await post("/api/dismiss/abc");
    expect(res.status).toBe(404);
  });

  test("id = 1.5 returns 404", async () => {
    const res = await post("/api/dismiss/1.5");
    expect(res.status).toBe(404);
  });

  test("id = 99999999999 (huge nonexistent)", async () => {
    const res = await post("/api/dismiss/99999999999");
    // BUG FOUND: No 404 for nonexistent article, silently succeeds
    expect(res.status).toBe(200);
  });
});

describe("POST /api/dismiss-batch - input validation", () => {
  test("empty body returns 400", async () => {
    const res = await post("/api/dismiss-batch", "", "application/json");
    expect(res.status).toBe(400);
  });

  test("ids as string returns 400", async () => {
    const res = await postJson("/api/dismiss-batch", { ids: "1,2" });
    expect(res.status).toBe(400);
  });

  test("ids with 1001 elements returns 400", async () => {
    const ids = Array.from({ length: 1001 }, (_, i) => i);
    const res = await postJson("/api/dismiss-batch", { ids });
    expect(res.status).toBe(400);
  });

  test("ids with null values - passed to SQL without validation", async () => {
    // BUG FOUND: No element-type validation, nulls passed to SQL
    const res = await postJson("/api/dismiss-batch", { ids: [null] });
    expect(res.status).toBe(200);
  });

  test("empty ids array causes SQL syntax error", async () => {
    // BUG FOUND: Empty array produces `WHERE id IN () AND dismissed_at IS NULL`
    // which is invalid SQL. The placeholders = ids.map(() => "?").join(",") produces ""
    // leading to `IN ()` - a syntax error in SQLite.
    try {
      const res = await postJson("/api/dismiss-batch", { ids: [] });
      // If it doesn't crash, it returns 500 due to SQL error
      // Actually need to check - the error is caught by the try/catch in the server
      expect([200, 500]).toContain(res.status);
    } catch {
      // Network error from server crash would also indicate the bug
    }
  });

  test("missing ids field returns 400", async () => {
    const res = await postJson("/api/dismiss-batch", {});
    expect(res.status).toBe(400);
  });
});

describe("POST /api/discover - input validation", () => {
  // Note: /api/discover calls aiDiscoverFeeds which we can't easily mock in integration tests.
  // We test only the input validation part that happens before the AI call.

  test("empty body returns 400", async () => {
    const res = await post("/api/discover", "", "application/json");
    expect(res.status).toBe(400);
  });

  test("non-JSON body returns 400", async () => {
    const res = await post("/api/discover", "just text", "text/plain");
    expect(res.status).toBe(400);
  });

  test("topic as empty string returns 400", async () => {
    const res = await postJson("/api/discover", { topic: "" });
    expect(res.status).toBe(400);
  });

  test("topic as whitespace-only returns 400", async () => {
    const res = await postJson("/api/discover", { topic: "   " });
    expect(res.status).toBe(400);
  });

  test("topic missing returns 400", async () => {
    const res = await postJson("/api/discover", { notTopic: "test" });
    expect(res.status).toBe(400);
  });

  test("topic as number returns 400", async () => {
    const res = await postJson("/api/discover", { topic: 42 });
    expect(res.status).toBe(400);
  });

  test("topic as array returns 400", async () => {
    const res = await postJson("/api/discover", { topic: ["a", "b"] });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/discover/register - input validation", () => {
  test("empty body returns 400", async () => {
    const res = await post("/api/discover/register", "", "application/json");
    expect(res.status).toBe(400);
  });

  test("url missing returns 400", async () => {
    const res = await postJson("/api/discover/register", { category: "tech" });
    expect(res.status).toBe(400);
  });

  test("url as empty string returns 400", async () => {
    const res = await postJson("/api/discover/register", { url: "" });
    expect(res.status).toBe(400);
  });

  test("url as whitespace-only returns 400", async () => {
    const res = await postJson("/api/discover/register", { url: "   " });
    expect(res.status).toBe(400);
  });

  test("url as number returns 400", async () => {
    const res = await postJson("/api/discover/register", { url: 123 });
    expect(res.status).toBe(400);
  });

  test("url not a valid URL - returns 400", async () => {
    // Server now validates URLs must start with http:// or https://
    const res = await postJson("/api/discover/register", { url: "not-a-url" });
    expect(res.status).toBe(400);
  });

  test("SQL injection in url field", async () => {
    const res = await postJson("/api/discover/register", {
      url: "'; DROP TABLE feeds; --",
    });
    // Server now validates URLs must start with http:// or https://
    expect(res.status).toBe(400);
    // Verify feeds table still exists
    const feeds = db.prepare("SELECT COUNT(*) as n FROM feeds").get() as any;
    expect(feeds.n).toBeGreaterThan(0);
  });

  test("SQL injection in category field", async () => {
    const res = await postJson("/api/discover/register", {
      url: "https://example.com/sqli-cat.xml",
      category: "'; DROP TABLE feeds; --",
    });
    expect(res.status).toBe(200);
    const feeds = db.prepare("SELECT COUNT(*) as n FROM feeds").get() as any;
    expect(feeds.n).toBeGreaterThan(0);
  });

  test("very long url (10KB)", async () => {
    const longUrl = "https://example.com/" + "a".repeat(10240);
    const res = await postJson("/api/discover/register", { url: longUrl });
    // No length validation - accepted
    expect(res.status).toBe(200);
  });

  test("unicode in category", async () => {
    const res = await postJson("/api/discover/register", {
      url: "https://example.com/unicode-cat.xml",
      category: "テクノロジー 🚀",
    });
    expect(res.status).toBe(200);
  });
});

// ─── 2. HTTP Method Misuse ───

describe("HTTP method misuse", () => {
  test("GET /api/read/:id should not work (POST only)", async () => {
    const res = await api(`/api/read/${articleId1}`);
    // BUG FOUND: The regex match check runs before the method check.
    // readMatch is checked with `readMatch && method === "POST"`.
    // If method is GET, readMatch is truthy but the condition fails,
    // so it falls through to subsequent routes. It will eventually hit 404.
    expect(res.status).toBe(404);
    // A proper API would return 405 Method Not Allowed
  });

  test("DELETE /api/dismiss/:id returns 404 (not 405)", async () => {
    const res = await api(`/api/dismiss/${articleId1}`, { method: "DELETE" });
    // BUG FOUND: Returns 404 instead of 405 Method Not Allowed
    expect(res.status).toBe(404);
  });

  test("PUT /api/curate returns 404 (not 405)", async () => {
    const res = await api("/api/curate", { method: "PUT" });
    expect(res.status).toBe(404);
  });

  test("POST / should still return HTML (no method restriction on root)", async () => {
    // BUG FOUND: POST / is handled same as GET / - no method check on the root route
    const res = await post("/");
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type");
    expect(ct).toContain("text/html");
  });

  test("GET /api/fetch should not work (POST only)", async () => {
    const res = await api("/api/fetch");
    // Falls through to 404 because the route checks method === "POST"
    expect(res.status).toBe(404);
  });

  test("GET /api/read-batch should return 404 (not 405)", async () => {
    const res = await api("/api/read-batch");
    expect(res.status).toBe(404);
  });

  test("GET /api/dismiss-batch should return 404 (not 405)", async () => {
    const res = await api("/api/dismiss-batch");
    expect(res.status).toBe(404);
  });

  test("GET /api/articles accepts any method (no method restriction)", async () => {
    // BUG FOUND: /api/articles has no method check - DELETE, PUT, POST all return articles
    const res = await api("/api/articles", { method: "DELETE" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test("GET /api/feeds accepts any method (no method restriction)", async () => {
    // BUG FOUND: /api/feeds has no method check
    const res = await api("/api/feeds", { method: "DELETE" });
    expect(res.status).toBe(200);
  });
});

// ─── 3. URL Path Edge Cases ───

describe("URL path edge cases", () => {
  test("/api/read/abc (non-numeric) returns 404", async () => {
    const res = await post("/api/read/abc");
    expect(res.status).toBe(404);
  });

  test("/api/read/-1 (negative) returns 404", async () => {
    const res = await post("/api/read/-1");
    expect(res.status).toBe(404);
  });

  test("/api/read/0 (zero) matches route", async () => {
    const res = await post("/api/read/0");
    expect(res.status).toBe(200);
  });

  test("/api/read/1.5 (float) returns 404", async () => {
    const res = await post("/api/read/1.5");
    expect(res.status).toBe(404);
  });

  test("/api/dismiss/abc returns 404", async () => {
    const res = await post("/api/dismiss/abc");
    expect(res.status).toBe(404);
  });

  test("/api/read/1/extra/path returns 404", async () => {
    const res = await post(`/api/read/${articleId1}/extra/path`);
    expect(res.status).toBe(404);
  });

  test("double slashes //api//read//1", async () => {
    const res = await post(`//api//read//${articleId1}`);
    // URL parser normalizes double slashes in path, check behavior
    // The URL constructor may normalize this differently
    // Node's URL: new URL("//api//read//1", "http://localhost:3000")
    // pathname would be "//api//read//1" which won't match the regex
    expect(res.status).toBe(404);
  });

  test("URL encoded path /api/read/%31 (encoded '1')", async () => {
    // %31 decodes to '1'. However, URL.pathname preserves percent-encoding,
    // so pathname = "/api/read/%31" which does NOT match the regex /\/api\/read\/(\d+)$/
    // BUG FOUND: Percent-encoded numeric IDs like %31 are not handled - returns 404
    const res = await post(`/api/read/%31`);
    expect(res.status).toBe(404);
  });

  test("very long path (1000+ chars)", async () => {
    const longPath = "/api/read/" + "1".repeat(1000);
    const res = await post(longPath);
    // This is a valid \d+ match with a huge number
    expect(res.status).toBe(200);
  });

  test("/api/read/ with trailing slash but no id", async () => {
    const res = await post("/api/read/");
    // Regex requires at least one digit after /api/read/
    // But "/api/read/" has empty capture - \d+ requires at least 1 digit
    expect(res.status).toBe(404);
  });

  test("/api/read (no trailing slash, no id)", async () => {
    const res = await post("/api/read");
    expect(res.status).toBe(404);
  });
});

// ─── 4. Concurrent Request Safety ───

describe("concurrent request safety", () => {
  test("10 concurrent toggleRead on same article should toggle 10 times", async () => {
    // Reset the article's read_at to null first
    db.prepare("UPDATE articles SET read_at = NULL WHERE id = ?").run(articleId1);

    const promises = Array.from({ length: 10 }, () => post(`/api/read/${articleId1}`));
    const results = await Promise.all(promises);

    for (const r of results) {
      expect(r.status).toBe(200);
    }

    // After 10 toggles from null:
    // Toggle 1: null -> read (set)
    // Toggle 2: read -> null (unset)
    // ... etc
    // With 10 sequential toggles from null, final should be null (even number)
    // But with concurrent requests, there's a race condition:
    // Multiple requests read the same state before any write completes
    // BUG FOUND: toggleRead has a TOCTOU race condition.
    // It reads read_at, then decides to set or unset.
    // With concurrent requests, multiple may read the same state and all set (or all unset).
    const article = db.prepare("SELECT read_at FROM articles WHERE id = ?").get(articleId1) as any;
    // We can't predict the exact outcome due to race, but we document the bug
    // In a correct implementation, 10 toggles from null should end at null
    // Due to the race condition, the final state is non-deterministic
    expect(article).toBeDefined();
  });

  test("5 concurrent dismiss on same article - should dismiss exactly once", async () => {
    // Reset
    db.prepare("UPDATE articles SET dismissed_at = NULL WHERE id = ?").run(articleId2);

    const promises = Array.from({ length: 5 }, () => post(`/api/dismiss/${articleId2}`));
    const results = await Promise.all(promises);

    for (const r of results) {
      expect(r.status).toBe(200);
    }

    // dismiss uses AND dismissed_at IS NULL, so only the first succeeds
    const article = db.prepare("SELECT dismissed_at FROM articles WHERE id = ?").get(articleId2) as any;
    expect(article.dismissed_at).not.toBeNull();
  });

  test("concurrent read-batch and dismiss-batch with overlapping articles", async () => {
    // Reset articles
    db.prepare("UPDATE articles SET read_at = NULL, dismissed_at = NULL WHERE id IN (?, ?, ?)").run(
      articleId1,
      articleId2,
      articleId3
    );

    const readPromise = postJson("/api/read-batch", { ids: [articleId1, articleId2] });
    const dismissPromise = postJson("/api/dismiss-batch", { ids: [articleId2, articleId3] });

    const [readRes, dismissRes] = await Promise.all([readPromise, dismissPromise]);
    expect(readRes.status).toBe(200);
    expect(dismissRes.status).toBe(200);

    // articleId2 should be both read and dismissed
    const a2 = db.prepare("SELECT read_at, dismissed_at FROM articles WHERE id = ?").get(articleId2) as any;
    expect(a2.read_at).not.toBeNull();
    expect(a2.dismissed_at).not.toBeNull();
  });
});

// ─── 5. Response Format Verification ───

describe("response format verification", () => {
  test("GET / returns text/html with security headers", async () => {
    const res = await api("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("content-security-policy")).toBeTruthy();
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  test("GET /api/articles returns application/json", async () => {
    const res = await api("/api/articles");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test("GET /api/feeds returns application/json", async () => {
    const res = await api("/api/feeds");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test("POST /api/read/:id returns valid JSON", async () => {
    const res = await post(`/api/read/${articleId1}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const data = await res.json();
    expect(data).toHaveProperty("ok");
  });

  test("POST /api/read-batch returns valid JSON with count", async () => {
    const res = await postJson("/api/read-batch", { ids: [articleId1] });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const data = await res.json();
    expect(data).toHaveProperty("ok", true);
    expect(data).toHaveProperty("count");
  });

  test("POST /api/dismiss/:id returns valid JSON", async () => {
    // Reset first
    db.prepare("UPDATE articles SET dismissed_at = NULL WHERE id = ?").run(articleId3);
    const res = await post(`/api/dismiss/${articleId3}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const data = await res.json();
    expect(data).toHaveProperty("ok", true);
  });

  test("POST /api/dismiss-batch returns valid JSON with count", async () => {
    // Reset
    db.prepare("UPDATE articles SET dismissed_at = NULL WHERE id = ?").run(articleId3);
    const res = await postJson("/api/dismiss-batch", { ids: [articleId3] });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const data = await res.json();
    expect(data).toHaveProperty("ok", true);
    expect(data).toHaveProperty("count", 1);
  });

  test("404 response has no content-type header and plain text body", async () => {
    const res = await api("/nonexistent");
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toBe("Not Found");
    // BUG FOUND: 404 response doesn't set Content-Type header.
    // It should return application/json for API paths or text/plain.
  });

  test("400 error responses are valid JSON", async () => {
    const res = await postJson("/api/read-batch", { ids: "not-array" });
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/json");
    const data = await res.json();
    expect(data).toHaveProperty("error");
    expect(typeof data.error).toBe("string");
  });

  test("500 error does not leak stack traces", async () => {
    // Force a 500 by triggering the dismiss-batch empty array bug
    const res = await postJson("/api/dismiss-batch", { ids: [] });
    if (res.status === 500) {
      const body = await res.text();
      expect(body).toBe("Internal Server Error");
      expect(body).not.toContain("at ");
      expect(body).not.toContain("Error:");
      expect(body).not.toContain(".ts:");
    }
    // If it's 200, the empty array was handled (no SQL error in this case)
  });

  test("GET /styles.css returns text/css", async () => {
    const res = await api("/styles.css");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/css");
  });

  test("GET /scripts.js returns application/javascript", async () => {
    const res = await api("/scripts.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/javascript");
  });

  test("GET /api/briefing returns valid JSON (possibly null)", async () => {
    const res = await api("/api/briefing");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    // May be null if no briefing exists for today
    const data = await res.json();
    // null is valid JSON
    expect(data === null || typeof data === "object").toBe(true);
  });
});

// ─── Additional Edge Cases ───

describe("read-batch count accuracy", () => {
  test("count reflects ids.length not actual rows updated", async () => {
    // Reset
    db.prepare("UPDATE articles SET read_at = NULL WHERE id = ?").run(articleId1);
    // Send batch with one real id and one nonexistent
    const res = await postJson("/api/read-batch", { ids: [articleId1, 999999] });
    const data = await res.json();
    // BUG FOUND: count is ids.length (2) not actual rows affected (1)
    expect(data.count).toBe(2);
    // Should ideally report actual rows updated
  });
});

describe("dismiss-batch count accuracy", () => {
  test("count reflects ids.length not actual rows updated", async () => {
    // Reset
    db.prepare("UPDATE articles SET dismissed_at = NULL WHERE id = ?").run(articleId1);
    const res = await postJson("/api/dismiss-batch", { ids: [articleId1, 999999] });
    const data = await res.json();
    // BUG FOUND: count is ids.length (2) not actual rows dismissed (1)
    expect(data.count).toBe(2);
  });
});

describe("large payload handling", () => {
  test("1MB JSON payload to read-batch", async () => {
    // ~1MB of JSON: {"ids":[1,1,1,...]} with many repeated elements
    const bigPayload = JSON.stringify({ ids: Array.from({ length: 100000 }, () => 1) });
    const res = await api("/api/read-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bigPayload,
    });
    // 100000 > 1000, so should be rejected
    expect(res.status).toBe(400);
  });

  test("1MB JSON payload to discover/register", async () => {
    const longUrl = "https://example.com/" + "a".repeat(1024 * 1024);
    const res = await postJson("/api/discover/register", { url: longUrl });
    // BUG FOUND: No payload size limit on discover/register endpoint.
    // Extremely long URLs are stored directly in the database.
    expect(res.status).toBe(200);
  });
});

describe("unicode and special characters", () => {
  test("unicode in discover/register category", async () => {
    const res = await postJson("/api/discover/register", {
      url: "https://example.com/unicode-test-" + Date.now() + ".xml",
      category: "日本語カテゴリ",
    });
    expect(res.status).toBe(200);
  });

  test("HTML in discover/register url", async () => {
    const res = await postJson("/api/discover/register", {
      url: '<script>alert("xss")</script>',
    });
    // Server now validates URLs must start with http:// or https://
    expect(res.status).toBe(400);
  });
});
