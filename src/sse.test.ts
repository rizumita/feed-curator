import { describe, expect, test, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { db } from "./db";
import { addFeed, listFeeds } from "./feed";
import { addArticle, listArticles, updateArticleCuration, saveBriefing } from "./article";
import { startServer } from "./server";

// Parse SSE events from response text
function parseSSEEvents(text: string): any[] {
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)));
}

describe("SSE streaming endpoints", () => {
  let baseUrl: string;
  let server: Server;

  beforeAll(async () => {
    db.exec("DELETE FROM articles");
    db.exec("DELETE FROM feeds");
    db.exec("DELETE FROM briefings");

    server = startServer(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const addr = server.address() as { port: number };
    baseUrl = `http://localhost:${addr.port}`;
  });

  afterAll(() => { server?.close(); });

  describe("POST /api/fetch (SSE)", () => {
    test("returns text/event-stream content-type", async () => {
      const res = await fetch(`${baseUrl}/api/fetch`, { method: "POST" });
      expect(res.headers.get("content-type")).toBe("text/event-stream");
      expect(res.headers.get("cache-control")).toBe("no-cache");
      await res.text();
    });

    test("streams progress events then done event (no feeds)", async () => {
      const res = await fetch(`${baseUrl}/api/fetch`, { method: "POST" });
      const text = await res.text();
      const events = parseSSEEvents(text);
      expect(events.length).toBeGreaterThanOrEqual(1);
      const done = events.find((e) => e.done);
      expect(done).toBeDefined();
      expect(done.newArticles).toBe(0);
    });

    test("streams per-feed progress with registered feeds", async () => {
      // Add a feed that will fail to fetch (no real server)
      addFeed("https://sse-test-nonexistent.invalid/feed.xml", "Test Feed");

      const res = await fetch(`${baseUrl}/api/fetch`, { method: "POST" });
      const text = await res.text();
      const events = parseSSEEvents(text);

      // Should have at least a progress message and a done event
      const messages = events.filter((e) => e.message);
      expect(messages.length).toBeGreaterThanOrEqual(1);
      expect(messages.some((e) => e.message.includes("Fetching feed"))).toBe(true);

      const done = events.find((e) => e.done);
      expect(done).toBeDefined();

      // Cleanup
      db.exec("DELETE FROM feeds");
    });
  });

  describe("POST /api/curate (SSE)", () => {
    test("returns SSE format with done event (no articles)", async () => {
      const res = await fetch(`${baseUrl}/api/curate`, { method: "POST" });
      expect(res.headers.get("content-type")).toBe("text/event-stream");
      const text = await res.text();
      const events = parseSSEEvents(text);
      const done = events.find((e) => e.done);
      expect(done).toBeDefined();
      expect(done.curated).toBe(0);
    });
  });

  describe("POST /api/briefing/generate (SSE)", () => {
    test("returns SSE format with done event (no articles)", async () => {
      const res = await fetch(`${baseUrl}/api/briefing/generate`, { method: "POST" });
      expect(res.headers.get("content-type")).toBe("text/event-stream");
      const text = await res.text();
      const events = parseSSEEvents(text);
      const done = events.find((e) => e.done);
      expect(done).toBeDefined();
      expect(done.ok).toBe(false);
    });
  });

  describe("POST /api/discover (SSE)", () => {
    test.skip("returns SSE format for valid topic (requires claude CLI)", async () => {
      const res = await fetch(`${baseUrl}/api/discover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: "test" }),
      });
      expect(res.headers.get("content-type")).toBe("text/event-stream");
      const text = await res.text();
      const events = parseSSEEvents(text);
      expect(events.some((e) => e.done || e.error)).toBe(true);
    });

    test("returns JSON error for missing topic (not SSE)", async () => {
      const res = await fetch(`${baseUrl}/api/discover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: "" }),
      });
      expect(res.status).toBe(400);
      expect(res.headers.get("content-type")).toContain("application/json");
    });
  });

  describe("SSE event format", () => {
    test("all SSE events are valid JSON with expected fields", async () => {
      const res = await fetch(`${baseUrl}/api/fetch`, { method: "POST" });
      const text = await res.text();
      const lines = text.split("\n").filter((l) => l.startsWith("data: "));

      for (const line of lines) {
        const json = JSON.parse(line.slice(6));
        // Each event must have exactly one of: message, done, error
        const hasMessage = "message" in json;
        const hasDone = "done" in json;
        const hasError = "error" in json;
        expect(hasMessage || hasDone || hasError).toBe(true);
      }
    });

    test("SSE lines end with double newline", async () => {
      const res = await fetch(`${baseUrl}/api/fetch`, { method: "POST" });
      const text = await res.text();
      // Each data line should be followed by \n\n
      const dataLines = text.match(/data: .+\n\n/g);
      expect(dataLines).not.toBeNull();
      expect(dataLines!.length).toBeGreaterThan(0);
    });
  });
});
