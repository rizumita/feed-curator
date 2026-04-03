import { describe, expect, test, beforeEach, vi } from "vitest";
import { db } from "./db";
import { addFeed, getAllFeeds } from "./feed";
import { addArticle, listArticles } from "./article";
import type { Article } from "./types";

function clearAll(): void {
  db.prepare("DELETE FROM briefings").run();
  db.prepare("DELETE FROM articles").run();
  db.prepare("DELETE FROM feeds").run();
  db.prepare("DELETE FROM settings").run();
}

let spawnResponses: Array<{ stdout: string; exitCode: number }> = [];
let spawnCalls: Array<{ cmd: string; args: string[] }> = [];

vi.mock("child_process", () => {
  const EventEmitter = require("events");
  const { Readable } = require("stream");

  return {
    spawn: vi.fn((cmd: string, args: string[]) => {
      spawnCalls.push({ cmd, args });
      const response = spawnResponses.shift() ?? { stdout: "null", exitCode: 1 };
      const proc = new EventEmitter();
      const readable = new Readable({ read() {} });
      readable.push(response.stdout);
      readable.push(null);
      proc.stdout = readable;
      proc.stderr = new Readable({ read() {} });
      proc.stderr.push(null);
      proc.kill = vi.fn();
      setTimeout(() => proc.emit("close", response.exitCode), 5);
      return proc;
    }),
  };
});

function makeResponse(result: string): { stdout: string; exitCode: number } {
  return { stdout: JSON.stringify({ result }), exitCode: 0 };
}

function seedArticles(count: number, contentPrefix = "Content"): void {
  addFeed("https://feed.test/rss", "Test Feed");
  const feedId = getAllFeeds()[0].id;
  for (let i = 1; i <= count; i++) {
    addArticle(
      `https://example.com/art-${i}`,
      `Article ${i}`,
      `${contentPrefix} for article ${i}. ${"x".repeat(300)}`,
      feedId,
    );
  }
}

describe("aiCurateFast", () => {
  beforeEach(() => {
    clearAll();
    spawnResponses = [];
    spawnCalls = [];
  });

  test("returns empty for no articles", async () => {
    const { aiCurateFast } = await import("./ai");
    const result = await aiCurateFast([]);
    expect(result).toEqual([]);
  });

  test("returns preliminary scores from Claude response", async () => {
    seedArticles(3);
    const articles = listArticles(true);
    const ids = articles.map(a => a.id);

    spawnResponses.push(makeResponse(JSON.stringify(
      ids.map(id => ({ id, score: 0.5 }))
    )));

    const { aiCurateFast } = await import("./ai");
    const result = await aiCurateFast(articles);
    expect(result).toHaveLength(3);
    for (const r of result) {
      expect(r.prelimScore).toBe(0.5);
      expect(ids).toContain(r.id);
    }
  });

  test("prompt uses minimal context (no profile, 200 char preview)", async () => {
    seedArticles(1);
    const articles = listArticles(true);

    spawnResponses.push(makeResponse(JSON.stringify(
      [{ id: articles[0].id, score: 0.6 }]
    )));

    const { aiCurateFast } = await import("./ai");
    await aiCurateFast(articles);

    expect(spawnCalls).toHaveLength(1);
    const prompt = spawnCalls[0].args[spawnCalls[0].args.length - 1];
    expect(prompt).toContain("screener");
    expect(prompt).toContain("content_preview");
    expect(prompt).not.toContain("profileForPrompt");
    expect(prompt).not.toContain("Adjust scores using the user profile");
  });

  test("batches articles in groups of 20", async () => {
    seedArticles(25);
    const articles = listArticles(true);
    const ids = articles.map(a => a.id);

    // 2 batches: 20 + 5
    spawnResponses.push(makeResponse(JSON.stringify(
      ids.slice(0, 20).map(id => ({ id, score: 0.4 }))
    )));
    spawnResponses.push(makeResponse(JSON.stringify(
      ids.slice(20).map(id => ({ id, score: 0.6 }))
    )));

    const { aiCurateFast } = await import("./ai");
    const result = await aiCurateFast(articles);
    expect(result).toHaveLength(25);
    expect(spawnCalls).toHaveLength(2);
  });

  test("handles failed batch gracefully", async () => {
    seedArticles(3);
    const articles = listArticles(true);

    spawnResponses.push({ stdout: "", exitCode: 1 });

    const { aiCurateFast } = await import("./ai");
    const result = await aiCurateFast(articles);
    expect(result).toEqual([]);
  });
});

describe("aiRerankCandidates", () => {
  beforeEach(() => {
    clearAll();
    spawnResponses = [];
    spawnCalls = [];
  });

  test("returns empty for no articles", async () => {
    const { aiRerankCandidates } = await import("./ai");
    const result = await aiRerankCandidates([]);
    expect(result).toEqual([]);
  });

  test("returns score, summary, and tags", async () => {
    seedArticles(2);
    const articles = listArticles(true);

    spawnResponses.push(makeResponse(JSON.stringify(
      articles.map(a => ({ id: a.id, score: 0.8, summary: "Great article", tags: "llm, fine-tuning" }))
    )));

    const { aiRerankCandidates } = await import("./ai");
    const result = await aiRerankCandidates(articles);
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveProperty("score");
    expect(result[0]).toHaveProperty("summary");
    expect(result[0]).toHaveProperty("tags");
  });

  test("prompt includes profile", async () => {
    seedArticles(1);
    const articles = listArticles(true);

    spawnResponses.push(makeResponse(JSON.stringify(
      [{ id: articles[0].id, score: 0.7, summary: "Good", tags: "coding" }]
    )));

    const { aiRerankCandidates } = await import("./ai");
    await aiRerankCandidates(articles);

    const prompt = spawnCalls[0].args[spawnCalls[0].args.length - 1];
    expect(prompt).toContain("Adjust scores using the user profile");
    expect(prompt).toContain("content_head");
  });
});

describe("aiCurate (2-stage orchestration)", () => {
  beforeEach(() => {
    clearAll();
    spawnResponses = [];
    spawnCalls = [];
  });

  test("returns 0 for no uncurated articles", async () => {
    const { aiCurate } = await import("./ai");
    const result = await aiCurate();
    expect(result).toBe(0);
  });

  test("routes low-scoring articles to summarize, candidates to rerank", async () => {
    seedArticles(4);
    const articles = listArticles(true);
    const ids = articles.map(a => a.id);

    // Stage 1: 2 low (0.1), 2 candidates (0.6)
    spawnResponses.push(makeResponse(JSON.stringify([
      { id: ids[0], score: 0.1 },
      { id: ids[1], score: 0.1 },
      { id: ids[2], score: 0.6 },
      { id: ids[3], score: 0.6 },
    ])));

    // Stage 2 (rerank candidates)
    spawnResponses.push(makeResponse(JSON.stringify([
      { id: ids[2], score: 0.75, summary: "Candidate 1", tags: "llm" },
      { id: ids[3], score: 0.8, summary: "Candidate 2", tags: "coding" },
    ])));

    // Low-priority summaries
    spawnResponses.push(makeResponse(JSON.stringify([
      { id: ids[0], summary: "Low 1", tags: "misc" },
      { id: ids[1], summary: "Low 2", tags: "misc" },
    ])));

    const { aiCurate } = await import("./ai");
    const result = await aiCurate();
    expect(result).toBe(4);

    // Verify all articles were curated
    const curated = db.prepare("SELECT id, score, summary FROM articles WHERE curated_at IS NOT NULL ORDER BY id").all() as Array<{ id: number; score: number; summary: string }>;
    expect(curated).toHaveLength(4);

    // Low articles keep Stage 1 score
    const low = curated.filter(a => ids.slice(0, 2).includes(a.id));
    for (const a of low) {
      expect(a.score).toBeCloseTo(0.1, 1);
    }

    // Candidates get Stage 2 score
    const high = curated.filter(a => ids.slice(2).includes(a.id));
    for (const a of high) {
      expect(a.score).toBeGreaterThanOrEqual(0.75);
    }
  });

  test("articles missing from Stage 1 are treated as candidates", async () => {
    seedArticles(3);
    const articles = listArticles(true);
    const ids = articles.map(a => a.id);

    // Stage 1: only returns 2 of 3
    spawnResponses.push(makeResponse(JSON.stringify([
      { id: ids[0], score: 0.1 },
      { id: ids[1], score: 0.5 },
    ])));

    // Stage 2: gets ids[1] (candidate) + ids[2] (missing from stage 1)
    spawnResponses.push(makeResponse(JSON.stringify([
      { id: ids[1], score: 0.7, summary: "Candidate", tags: "llm" },
      { id: ids[2], score: 0.65, summary: "Missing from stage 1", tags: "coding" },
    ])));

    // Low-priority
    spawnResponses.push(makeResponse(JSON.stringify([
      { id: ids[0], summary: "Low article", tags: "misc" },
    ])));

    const { aiCurate } = await import("./ai");
    const result = await aiCurate();
    expect(result).toBe(3);
  });

  test("all articles low-scoring skips Stage 2", async () => {
    seedArticles(2);
    const articles = listArticles(true);
    const ids = articles.map(a => a.id);

    // Stage 1: all low
    spawnResponses.push(makeResponse(JSON.stringify([
      { id: ids[0], score: 0.1 },
      { id: ids[1], score: 0.2 },
    ])));

    // Low-priority summaries (no Stage 2 call)
    spawnResponses.push(makeResponse(JSON.stringify([
      { id: ids[0], summary: "Low 1", tags: "misc" },
      { id: ids[1], summary: "Low 2", tags: "misc" },
    ])));

    const { aiCurate } = await import("./ai");
    const result = await aiCurate();
    expect(result).toBe(2);
    // Stage 1 + low-priority = 2 calls (no Stage 2)
    expect(spawnCalls).toHaveLength(2);
  });

  test("all articles are candidates skips low-priority batch", async () => {
    seedArticles(2);
    const articles = listArticles(true);
    const ids = articles.map(a => a.id);

    // Stage 1: all above threshold
    spawnResponses.push(makeResponse(JSON.stringify([
      { id: ids[0], score: 0.7 },
      { id: ids[1], score: 0.8 },
    ])));

    // Stage 2 (no low-priority call)
    spawnResponses.push(makeResponse(JSON.stringify([
      { id: ids[0], score: 0.75, summary: "Good 1", tags: "llm" },
      { id: ids[1], score: 0.85, summary: "Good 2", tags: "coding" },
    ])));

    const { aiCurate } = await import("./ai");
    const result = await aiCurate();
    expect(result).toBe(2);
    // Stage 1 + Stage 2 = 2 calls (no low-priority)
    expect(spawnCalls).toHaveLength(2);
  });

  test("progress callback reports stage information", async () => {
    seedArticles(2);
    const articles = listArticles(true);
    const ids = articles.map(a => a.id);

    spawnResponses.push(makeResponse(JSON.stringify([
      { id: ids[0], score: 0.1 },
      { id: ids[1], score: 0.6 },
    ])));
    spawnResponses.push(makeResponse(JSON.stringify([
      { id: ids[1], score: 0.7, summary: "Good", tags: "llm" },
    ])));
    spawnResponses.push(makeResponse(JSON.stringify([
      { id: ids[0], summary: "Low", tags: "misc" },
    ])));

    const msgs: string[] = [];
    const { aiCurate } = await import("./ai");
    await aiCurate((m) => msgs.push(m));

    expect(msgs.some(m => m.includes("Stage 1"))).toBe(true);
    expect(msgs.some(m => m.includes("Stage 2"))).toBe(true);
    expect(msgs.some(m => m.includes("Triage"))).toBe(true);
  });
});
