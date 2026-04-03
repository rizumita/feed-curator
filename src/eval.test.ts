import { describe, expect, test, beforeEach, vi } from "vitest";
import { db } from "./db";
import { addFeed, getAllFeeds } from "./feed";
import { addArticle, updateArticleCuration, markAsRead } from "./article";
import { dismissArticle } from "./article";
import { sampleArticles, computeBehavioralMetrics, judgeArticles, runEvaluation, compareReports } from "./eval";
import type { EvalArticle, EvalReport } from "./eval";

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

vi.mock("child_process", () => {
  const EventEmitter = require("events");
  const { Readable } = require("stream");

  function createMockProc(stdout: string, exitCode: number) {
    const proc = new EventEmitter();
    const readable = new Readable({ read() {} });
    readable.push(stdout);
    readable.push(null);
    proc.stdout = readable;
    proc.kill = vi.fn();
    setTimeout(() => proc.emit("close", exitCode), 5);
    return proc;
  }

  return {
    spawn: vi.fn((_cmd: string, _args: string[]) => {
      const response = JSON.stringify({
        result: JSON.stringify([
          { article_id: 1, score_accuracy: 4, summary_quality: 3, tag_relevance: 5, reasoning: "Good" },
        ]),
      });
      return createMockProc(response, 0);
    }),
  };
});

function makeEvalArticle(id: number): EvalArticle {
  return {
    id,
    title: `Article ${id}`,
    url: `https://example.com/${id}`,
    content_head: `Content for ${id}`,
    score: 0.75,
    summary: `Summary ${id}`,
    tags: "test",
    read_at: null,
    dismissed_at: null,
  };
}

describe("judgeArticles", () => {
  test("returns empty for empty input", async () => {
    expect(await judgeArticles([])).toEqual([]);
  });

  test("parses judge response correctly", async () => {
    const results = await judgeArticles([makeEvalArticle(1)]);
    expect(results).toHaveLength(1);
    expect(results[0].article_id).toBe(1);
    expect(results[0].score_accuracy).toBe(4);
    expect(results[0].summary_quality).toBe(3);
    expect(results[0].tag_relevance).toBe(5);
  });

  test("calls progress callback", async () => {
    const msgs: string[] = [];
    await judgeArticles([makeEvalArticle(1)], (m) => msgs.push(m));
    expect(msgs.some(m => m.includes("Judging batch"))).toBe(true);
  });

  test("handles spawn failure gracefully", async () => {
    const { spawn } = await import("child_process");
    const spawnMock = vi.mocked(spawn);
    const EventEmitter = require("events");
    const { Readable } = require("stream");
    const orig = spawnMock.getMockImplementation();

    spawnMock.mockImplementationOnce((() => {
      const proc = new EventEmitter();
      proc.stdout = new Readable({ read() {} });
      proc.stdout.push(null);
      proc.kill = vi.fn();
      setTimeout(() => proc.emit("close", 1), 5);
      return proc;
    }) as any);

    const results = await judgeArticles([makeEvalArticle(1)]);
    expect(results).toEqual([]);

    if (orig) spawnMock.mockImplementation(orig);
  });
});

describe("runEvaluation", () => {
  beforeEach(clearAll);

  test("returns complete report structure with elapsed_ms", async () => {
    seedArticles(5);
    const report = await runEvaluation(5);

    expect(report.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(report.sample_size).toBe(5);
    expect(report.elapsed_ms).toBeGreaterThanOrEqual(0);
    expect(report.behavioral.total_curated).toBe(5);
    expect(report.judge_summary).toHaveProperty("avg_score_accuracy");
    expect(report.judge_summary).toHaveProperty("avg_summary_quality");
    expect(report.judge_summary).toHaveProperty("avg_tag_relevance");
    expect(report.judge_summary).toHaveProperty("avg_overall");
  });

  test("returns empty judge results when no articles", async () => {
    const report = await runEvaluation(10);
    expect(report.sample_size).toBe(0);
    expect(report.judge_results).toEqual([]);
    expect(report.judge_summary.avg_overall).toBe(0);
  });
});

describe("compareReports", () => {
  function makeReport(overrides: Partial<EvalReport> = {}): EvalReport {
    return {
      date: "2026-04-01",
      sample_size: 30,
      elapsed_ms: 5000,
      behavioral: {
        total_curated: 100,
        total_read: 30,
        total_dismissed: 10,
        read_rate: 0.3,
        score_bands: [],
      },
      judge_results: [],
      judge_summary: {
        avg_score_accuracy: 3.5,
        avg_summary_quality: 3.0,
        avg_tag_relevance: 4.0,
        avg_overall: 3.5,
      },
      ...overrides,
    };
  }

  test("computes positive deltas when current improves", () => {
    const baseline = makeReport();
    const current = makeReport({
      date: "2026-04-03",
      elapsed_ms: 3000,
      behavioral: { ...makeReport().behavioral, read_rate: 0.5 },
      judge_summary: {
        avg_score_accuracy: 4.0,
        avg_summary_quality: 3.5,
        avg_tag_relevance: 4.5,
        avg_overall: 4.0,
      },
    });

    const cmp = compareReports(baseline, current);
    expect(cmp.baseline_date).toBe("2026-04-01");
    expect(cmp.current_date).toBe("2026-04-03");

    const overall = cmp.judge.find(j => j.metric === "Overall")!;
    expect(overall.delta).toBeCloseTo(0.5);

    const readRate = cmp.behavioral.find(b => b.metric === "Read rate")!;
    expect(readRate.delta).toBeCloseTo(0.2);

    expect(cmp.timing.delta_ms).toBe(-2000);
  });

  test("computes negative deltas when current regresses", () => {
    const baseline = makeReport({
      judge_summary: {
        avg_score_accuracy: 4.0,
        avg_summary_quality: 4.0,
        avg_tag_relevance: 4.0,
        avg_overall: 4.0,
      },
    });
    const current = makeReport({
      date: "2026-04-03",
      judge_summary: {
        avg_score_accuracy: 3.0,
        avg_summary_quality: 3.0,
        avg_tag_relevance: 3.0,
        avg_overall: 3.0,
      },
    });

    const cmp = compareReports(baseline, current);
    for (const j of cmp.judge) {
      expect(j.delta).toBe(-1.0);
    }
  });

  test("handles missing elapsed_ms in baseline gracefully", () => {
    const baseline = makeReport();
    delete (baseline as any).elapsed_ms;
    const current = makeReport({ date: "2026-04-03", elapsed_ms: 4000 });

    const cmp = compareReports(baseline, current);
    expect(cmp.timing.baseline_ms).toBe(0);
    expect(cmp.timing.current_ms).toBe(4000);
  });
});
