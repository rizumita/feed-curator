import { describe, expect, test, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { db } from "./db";
import { DEFAULT_OLLAMA_MODEL } from "./ai-backend";
import { addFeed, listFeeds } from "./feed";
import { addArticle, listArticles, updateArticleCuration, getArticleById, saveBriefing } from "./article";
import { startServer } from "./server";

describe("server endpoints", () => {
  let baseUrl: string;
  let server: Server;
  let articleIds: number[];

  beforeAll(async () => {
    db.exec("DELETE FROM articles");
    db.exec("DELETE FROM feeds");
    db.exec("DELETE FROM briefings");
    db.exec("DELETE FROM settings");

    addFeed("https://srv-test.com/feed.xml", "Srv Feed", "Tech");
    const feedId = listFeeds()[0].id;

    addArticle("https://srv-test.com/a1", "Article 1", "content1", feedId, "2024-03-01");
    addArticle("https://srv-test.com/a2", "Article 2", "content2", feedId, "2024-03-02");
    addArticle("https://srv-test.com/a3", "Article 3", "content3", feedId, "2024-03-03");

    const articles = listArticles();
    const a1 = articles.find((a) => a.url === "https://srv-test.com/a1")!;
    const a2 = articles.find((a) => a.url === "https://srv-test.com/a2")!;
    const a3 = articles.find((a) => a.url === "https://srv-test.com/a3")!;
    updateArticleCuration(a1.id, 0.9, "Great article", "ai");
    updateArticleCuration(a2.id, 0.7, "Good article", "security");
    updateArticleCuration(a3.id, 0.5, "OK article", "web");
    articleIds = [a1.id, a2.id, a3.id];

    server = startServer(0);
    await new Promise<void>((resolve) => {
      server.once("listening", resolve);
    });
    const addr = server.address() as { port: number };
    baseUrl = `http://localhost:${addr.port}`;
  });

  afterAll(() => {
    server?.close();
  });

  // ─── POST /api/dismiss/:id ───

  describe("POST /api/dismiss/:id", () => {
    test("dismisses an article", async () => {
      const id = articleIds[0];
      db.prepare("UPDATE articles SET dismissed_at = NULL WHERE id = ?").run(id);

      const res = await fetch(`${baseUrl}/api/dismiss/${id}`, { method: "POST" });
      expect(res.status).toBe(200);
      expect(getArticleById(id)!.dismissed_at).not.toBeNull();
    });

    test("is idempotent", async () => {
      const id = articleIds[0];
      const before = getArticleById(id)!.dismissed_at;
      await fetch(`${baseUrl}/api/dismiss/${id}`, { method: "POST" });
      expect(getArticleById(id)!.dismissed_at).toBe(before);
    });

    test("returns ok for non-existent ID", async () => {
      const res = await fetch(`${baseUrl}/api/dismiss/99999`, { method: "POST" });
      expect(res.status).toBe(200);
    });

    afterAll(() => {
      for (const id of articleIds) {
        db.prepare("UPDATE articles SET dismissed_at = NULL WHERE id = ?").run(id);
      }
    });
  });

  // ─── POST /api/dismiss-batch ───

  describe("POST /api/dismiss-batch", () => {
    beforeAll(() => {
      for (const id of articleIds) {
        db.prepare("UPDATE articles SET dismissed_at = NULL WHERE id = ?").run(id);
      }
    });

    test("dismisses multiple articles", async () => {
      const ids = [articleIds[0], articleIds[1]];
      const res = await fetch(`${baseUrl}/api/dismiss-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = (await res.json()) as any;
      expect(data.ok).toBe(true);
      expect(data.count).toBe(2);
      for (const id of ids) {
        expect(getArticleById(id)!.dismissed_at).not.toBeNull();
      }
    });

    test("handles empty array", async () => {
      const res = await fetch(`${baseUrl}/api/dismiss-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [] }),
      });
      const data = (await res.json()) as any;
      expect(data.ok).toBe(true);
      expect(data.count).toBe(0);
    });

    test("rejects invalid JSON", async () => {
      const res = await fetch(`${baseUrl}/api/dismiss-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      expect(res.status).toBe(400);
    });

    test("rejects when ids is not an array", async () => {
      const res = await fetch(`${baseUrl}/api/dismiss-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: "not-an-array" }),
      });
      expect(res.status).toBe(400);
    });

    afterAll(() => {
      for (const id of articleIds) {
        db.prepare("UPDATE articles SET dismissed_at = NULL WHERE id = ?").run(id);
      }
    });
  });

  // ─── GET /api/briefing ───

  describe("GET /api/briefing", () => {
    test("returns null when no briefing exists", async () => {
      db.exec("DELETE FROM briefings");
      const res = await fetch(`${baseUrl}/api/briefing`);
      expect(await res.json()).toBeNull();
    });

    test("returns briefing for specific date", async () => {
      const clusters = [{ topic: "AI", summary: "Latest", article_ids: [articleIds[0]] }];
      saveBriefing("2024-06-15", clusters);
      const res = await fetch(`${baseUrl}/api/briefing?date=2024-06-15`);
      const data = (await res.json()) as any;
      expect(data.date).toBe("2024-06-15");
    });

    test("returns today's briefing when no date param", async () => {
      const today = new Date().toISOString().slice(0, 10);
      saveBriefing(today, [{ topic: "Today", summary: "News", article_ids: [articleIds[1]] }]);
      const res = await fetch(`${baseUrl}/api/briefing`);
      const data = (await res.json()) as any;
      expect(data.date).toBe(today);
    });

    afterAll(() => {
      db.exec("DELETE FROM briefings");
    });
  });

  // ─── GET/POST /api/config/ai-backend ───

  describe("AI backend config", () => {
    test("returns default AI backend config when nothing is saved", async () => {
      db.exec("DELETE FROM settings");

      const res = await fetch(`${baseUrl}/api/config/ai-backend`);
      const data = (await res.json()) as any;

      expect(res.status).toBe(200);
      expect(data).toEqual({ backend: "claude", model: DEFAULT_OLLAMA_MODEL });
    });

    test("updates AI backend config", async () => {
      const res = await fetch(`${baseUrl}/api/config/ai-backend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backend: "ollama", model: "llama3.2:latest" }),
      });
      const data = (await res.json()) as any;

      expect(res.status).toBe(200);
      expect(data).toEqual({ ok: true, backend: "ollama", model: "llama3.2:latest" });

      const verifyRes = await fetch(`${baseUrl}/api/config/ai-backend`);
      const verifyData = (await verifyRes.json()) as any;
      expect(verifyData).toEqual({ backend: "ollama", model: "llama3.2:latest" });
    });

    test("rejects unsupported AI backend values", async () => {
      const res = await fetch(`${baseUrl}/api/config/ai-backend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backend: "unknown" }),
      });

      expect(res.status).toBe(400);
      expect((await res.json()) as any).toEqual({ error: "backend must be one of: claude, ollama" });
    });
  });

  // ─── GET / ───

  describe("GET /", () => {
    test("returns HTML with correct content-type and security headers", async () => {
      const res = await fetch(`${baseUrl}/`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      const body = await res.text();
      expect(body).toContain("<!DOCTYPE html>");
    });
  });

  // ─── Static files ───

  describe("static files", () => {
    test("GET /styles.css returns CSS", async () => {
      const res = await fetch(`${baseUrl}/styles.css`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/css");
    });

    test("GET /scripts.js returns JS", async () => {
      const res = await fetch(`${baseUrl}/scripts.js`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/javascript");
    });
  });

  // ─── 404 ───

  describe("404 handling", () => {
    test("returns 404 for unknown paths", async () => {
      expect((await fetch(`${baseUrl}/nonexistent`)).status).toBe(404);
      expect((await fetch(`${baseUrl}/api/nonexistent`)).status).toBe(404);
    });
  });
});
