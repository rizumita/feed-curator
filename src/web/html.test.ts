import { describe, expect, test } from "bun:test";
import { getTier, escapeHtml, formatDate, getAllCategories, getAllTags, renderPage } from "./html";
import type { Article } from "../types";

type ArticleWithFeed = Article & { feed_title: string | null; category: string | null };

function makeArticle(overrides: Partial<ArticleWithFeed> = {}): ArticleWithFeed {
  return {
    id: 1,
    feed_id: 1,
    url: "https://example.com",
    title: "Test Article",
    content: "content",
    published_at: "2024-01-15T00:00:00Z",
    fetched_at: "2024-01-15T00:00:00Z",
    score: 0.8,
    summary: "A summary",
    curated_at: "2024-01-15T00:00:00Z",
    read_at: null,
    tags: "ai,tools",
    dismissed_at: null,
    archived_at: null,
    feed_title: "Test Feed",
    category: "Tech",
    ...overrides,
  };
}

// ─── getTier ───

describe("getTier", () => {
  test("score >= 0.85 is must-read", () => {
    expect(getTier(0.85).id).toBe("must-read");
    expect(getTier(1.0).id).toBe("must-read");
    expect(getTier(0.95).id).toBe("must-read");
  });

  test("score 0.70-0.84 is recommended", () => {
    expect(getTier(0.7).id).toBe("recommended");
    expect(getTier(0.84).id).toBe("recommended");
  });

  test("score 0.50-0.69 is worth-a-look", () => {
    expect(getTier(0.5).id).toBe("worth-a-look");
    expect(getTier(0.69).id).toBe("worth-a-look");
  });

  test("score < 0.50 is low-priority", () => {
    expect(getTier(0.49).id).toBe("low-priority");
    expect(getTier(0.0).id).toBe("low-priority");
  });

  // Boundary tests
  test("exact boundary 0.85", () => {
    expect(getTier(0.85).id).toBe("must-read");
  });

  test("just below boundary 0.8499", () => {
    expect(getTier(0.8499).id).toBe("recommended");
  });

  test("exact boundary 0.70", () => {
    expect(getTier(0.7).id).toBe("recommended");
  });

  test("exact boundary 0.50", () => {
    expect(getTier(0.5).id).toBe("worth-a-look");
  });
});

// ─── escapeHtml ───

describe("escapeHtml", () => {
  test("escapes ampersand", () => {
    expect(escapeHtml("A & B")).toBe("A &amp; B");
  });

  test("escapes angle brackets", () => {
    expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
  });

  test("escapes double quotes", () => {
    expect(escapeHtml('"hello"')).toBe("&quot;hello&quot;");
  });

  test("escapes all together (XSS prevention)", () => {
    expect(escapeHtml('<img onerror="alert(1)">')).toBe(
      "&lt;img onerror=&quot;alert(1)&quot;&gt;"
    );
  });

  test("escapes single quotes", () => {
    expect(escapeHtml("O'Reilly")).toBe("O&#x27;Reilly");
  });

  test("passes through safe strings", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });

  test("handles empty string", () => {
    expect(escapeHtml("")).toBe("");
  });
});

// ─── formatDate ───

describe("formatDate", () => {
  test("formats ISO date", () => {
    const result = formatDate("2024-01-15T00:00:00Z");
    expect(result).toBe("Jan 15");
  });

  test("returns empty for null", () => {
    expect(formatDate(null)).toBe("");
  });

  test("handles RFC 2822 date", () => {
    const result = formatDate("Mon, 15 Jan 2024 00:00:00 GMT");
    expect(result).toBe("Jan 15");
  });
});

// ─── getAllCategories ───

describe("getAllCategories", () => {
  test("extracts unique categories sorted", () => {
    const articles = [
      makeArticle({ category: "AI" }),
      makeArticle({ category: "Web" }),
      makeArticle({ category: "AI" }),
    ];
    expect(getAllCategories(articles)).toEqual(["AI", "Web"]);
  });

  test("excludes null categories", () => {
    const articles = [
      makeArticle({ category: null }),
      makeArticle({ category: "Tech" }),
    ];
    expect(getAllCategories(articles)).toEqual(["Tech"]);
  });

  test("returns empty for no categories", () => {
    expect(getAllCategories([])).toEqual([]);
  });
});

// ─── getAllTags ───

describe("getAllTags", () => {
  test("extracts unique tags sorted", () => {
    const articles = [
      makeArticle({ tags: "ai,tools" }),
      makeArticle({ tags: "ai,security" }),
    ];
    expect(getAllTags(articles)).toEqual(["ai", "security", "tools"]);
  });

  test("trims whitespace in tags", () => {
    const articles = [makeArticle({ tags: " ai , tools " })];
    expect(getAllTags(articles)).toEqual(["ai", "tools"]);
  });

  test("excludes empty tag segments", () => {
    const articles = [makeArticle({ tags: "ai,,tools," })];
    expect(getAllTags(articles)).toEqual(["ai", "tools"]);
  });

  test("handles null tags", () => {
    const articles = [makeArticle({ tags: null })];
    expect(getAllTags(articles)).toEqual([]);
  });

  test("returns empty for no articles", () => {
    expect(getAllTags([])).toEqual([]);
  });
});

// ─── renderPage ───

describe("renderPage", () => {
  const stats = { total: 10, curated: 5, unread: 3, feeds: 2, archived: 0 };

  test("renders empty state message when no articles", () => {
    const html = renderPage([], stats);
    expect(html).toContain("No curated articles yet");
  });

  test("renders articles grouped by tier", () => {
    const articles = [
      makeArticle({ id: 1, score: 0.9, title: "Must Read Article" }),
      makeArticle({ id: 2, score: 0.6, title: "Worth a Look Article" }),
    ];
    const html = renderPage(articles, stats);
    expect(html).toContain("Must Read");
    expect(html).toContain("Worth a Look");
    expect(html).toContain("Must Read Article");
    expect(html).toContain("Worth a Look Article");
  });

  test("escapes article title in rendered HTML", () => {
    const articles = [
      makeArticle({ title: '<script>alert("xss")</script>', score: 0.9 }),
    ];
    const html = renderPage(articles, stats);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("includes stats in sidebar", () => {
    const html = renderPage([], { total: 100, curated: 50, unread: 20, feeds: 5, archived: 0 });
    expect(html).toContain("20");  // unread
    expect(html).toContain("50");  // curated
  });

  test("skips empty tiers", () => {
    const articles = [makeArticle({ score: 0.9 })];
    const html = renderPage(articles, stats);
    expect(html).toContain("Must Read");
    expect(html).not.toContain('"low-priority"');
  });
});
