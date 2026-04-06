import { describe, expect, test, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { db } from "./db";
import { addFeed, listFeeds } from "./feed";
import {
  addArticle,
  listArticles,
  getArticleById,
  updateArticleCuration,
  markAsRead,
  dismissArticle,
  dismissArticles,
  undismissArticle,
  getAutoArchiveDays,
  runAutoArchive,
  getCuratedArticles,
  getStats,
  toggleRead,
  saveBriefing,
  getBriefing,
  getTodayBriefing,
  getConfig,
  setConfig,
  getPreferenceMemo,
  savePreferenceMemo,
  isPreferenceMemoStale,
  getRecentActions,
} from "./article";
import type { BriefingCluster } from "./types";
import { getLocalDateKey, getUtcDateKey } from "./date";

// ─── Setup ───

beforeAll(() => {
  db.exec("DELETE FROM briefings");
  db.exec("DELETE FROM articles");
  db.exec("DELETE FROM feeds");
  db.exec("DELETE FROM settings");

  addFeed("https://feed-a.example.com/rss", "Feed A", "Tech");
  addFeed("https://feed-b.example.com/rss", "Feed B", "Science");
});

// ─── Dismiss / Undismiss ───

describe("dismissArticle", () => {
  let articleId: number;

  beforeEach(() => {
    db.exec("DELETE FROM articles");
    const feedId = listFeeds()[0].id;
    addArticle("https://dismiss-test.com/a1", "Dismiss Test", "content", feedId);
    articleId = listArticles()[0].id;
  });

  test("sets dismissed_at on a non-dismissed article", () => {
    expect(getArticleById(articleId)!.dismissed_at).toBeNull();
    dismissArticle(articleId);
    expect(getArticleById(articleId)!.dismissed_at).not.toBeNull();
  });

  test("does not update dismissed_at if already dismissed", () => {
    dismissArticle(articleId);
    const first = getArticleById(articleId)!;
    dismissArticle(articleId);
    const second = getArticleById(articleId)!;
    expect(second.dismissed_at).toBe(first.dismissed_at);
  });

  test("does nothing for a non-existent article id", () => {
    expect(() => dismissArticle(99999)).not.toThrow();
  });
});

describe("dismissArticles (batch)", () => {
  beforeEach(() => {
    db.exec("DELETE FROM articles");
    const feedId = listFeeds()[0].id;
    addArticle("https://batch-dismiss.com/a1", "A1", "c", feedId);
    addArticle("https://batch-dismiss.com/a2", "A2", "c", feedId);
    addArticle("https://batch-dismiss.com/a3", "A3", "c", feedId);
  });

  test("dismisses multiple articles at once", () => {
    const ids = listArticles().map((a) => a.id);
    dismissArticles(ids);
    for (const id of ids) {
      expect(getArticleById(id)!.dismissed_at).not.toBeNull();
    }
  });

  test("handles empty array without error", () => {
    expect(() => dismissArticles([])).not.toThrow();
    for (const a of listArticles()) {
      expect(a.dismissed_at).toBeNull();
    }
  });

  test("skips already-dismissed articles in batch", () => {
    const articles = listArticles();
    dismissArticle(articles[0].id);
    const firstDismissedAt = getArticleById(articles[0].id)!.dismissed_at;

    dismissArticles([articles[0].id, articles[1].id]);

    expect(getArticleById(articles[0].id)!.dismissed_at).toBe(firstDismissedAt);
    expect(getArticleById(articles[1].id)!.dismissed_at).not.toBeNull();
  });
});

describe("undismissArticle", () => {
  let articleId: number;

  beforeEach(() => {
    db.exec("DELETE FROM articles");
    const feedId = listFeeds()[0].id;
    addArticle("https://undismiss-test.com/a1", "Undismiss Test", "content", feedId);
    articleId = listArticles()[0].id;
  });

  test("clears dismissed_at on a dismissed article", () => {
    dismissArticle(articleId);
    expect(getArticleById(articleId)!.dismissed_at).not.toBeNull();
    undismissArticle(articleId);
    expect(getArticleById(articleId)!.dismissed_at).toBeNull();
  });

  test("is a no-op on an already undismissed article", () => {
    expect(() => undismissArticle(articleId)).not.toThrow();
    expect(getArticleById(articleId)!.dismissed_at).toBeNull();
  });
});

// ─── Auto-archive ───

describe("getAutoArchiveDays", () => {
  beforeEach(() => {
    db.exec("DELETE FROM settings");
  });

  test("returns 7 as default when no setting exists", () => {
    expect(getAutoArchiveDays()).toBe(7);
  });

  test("returns configured value from settings", () => {
    setConfig("auto_archive_days", "14");
    expect(getAutoArchiveDays()).toBe(14);
  });
});

describe("runAutoArchive", () => {
  beforeEach(() => {
    db.exec("DELETE FROM articles");
  });

  test("archives old curated unread articles", () => {
    const feedId = listFeeds()[0].id;
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    addArticle("https://archive-test.com/old", "Old Article", "content", feedId, oldDate);
    const article = listArticles().find((a) => a.url === "https://archive-test.com/old")!;
    updateArticleCuration(article.id, 0.5, "Old curated article");

    expect(runAutoArchive(7)).toBe(1);
    expect(getArticleById(article.id)!.archived_at).not.toBeNull();
  });

  test("does not archive recently curated articles", () => {
    const feedId = listFeeds()[0].id;
    addArticle("https://archive-test.com/recent", "Recent", "content", feedId);
    const article = listArticles().find((a) => a.url === "https://archive-test.com/recent")!;
    updateArticleCuration(article.id, 0.8, "Just curated");

    expect(runAutoArchive(7)).toBe(0);
    expect(getArticleById(article.id)!.archived_at).toBeNull();
  });

  test("does not archive uncurated, read, dismissed, or already-archived articles", () => {
    const feedId = listFeeds()[0].id;
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // uncurated
    addArticle("https://archive-test.com/uncurated", "Uncurated Old", "c", feedId, oldDate);
    // read
    addArticle("https://archive-test.com/read", "Read Old", "c", feedId, oldDate);
    const readArt = listArticles().find((a) => a.url === "https://archive-test.com/read")!;
    updateArticleCuration(readArt.id, 0.5, "Old");
    markAsRead(readArt.id);
    // dismissed
    addArticle("https://archive-test.com/dismissed", "Dismissed Old", "c", feedId, oldDate);
    const dismissedArt = listArticles().find((a) => a.url === "https://archive-test.com/dismissed")!;
    updateArticleCuration(dismissedArt.id, 0.5, "Old");
    dismissArticle(dismissedArt.id);

    expect(runAutoArchive(7)).toBe(0);
  });

  test("returns 0 when no articles match", () => {
    expect(runAutoArchive(7)).toBe(0);
  });
});

// ─── getCuratedArticles ───

describe("getCuratedArticles", () => {
  beforeEach(() => {
    db.exec("DELETE FROM articles");
    const feeds = listFeeds();
    const feedA = feeds.find((f) => f.url === "https://feed-a.example.com/rss")!;
    const feedB = feeds.find((f) => f.url === "https://feed-b.example.com/rss")!;

    addArticle("https://curated-test.com/a1", "Active High", "c", feedA.id, "2024-06-01");
    addArticle("https://curated-test.com/a2", "Active Low", "c", feedB.id, "2024-05-01");
    addArticle("https://curated-test.com/a3", "Dismissed", "c", feedA.id, "2024-04-01");
    addArticle("https://curated-test.com/a4", "Uncurated", "c", feedA.id);

    const articles = listArticles();
    updateArticleCuration(articles.find((a) => a.url === "https://curated-test.com/a1")!.id, 0.9, "High score", "ai");
    updateArticleCuration(articles.find((a) => a.url === "https://curated-test.com/a2")!.id, 0.3, "Low score", "bio");
    updateArticleCuration(articles.find((a) => a.url === "https://curated-test.com/a3")!.id, 0.6, "Dismissed one", "old");
    dismissArticle(articles.find((a) => a.url === "https://curated-test.com/a3")!.id);
  });

  test("active view returns only non-dismissed, non-archived curated articles", () => {
    const results = getCuratedArticles("newest", "active");
    expect(results.length).toBe(2);
    expect(results.every((a) => a.dismissed_at === null && a.archived_at === null)).toBe(true);
  });

  test("archive view returns dismissed/archived curated articles", () => {
    const results = getCuratedArticles("newest", "archive");
    expect(results.length).toBe(1);
    expect(results[0].feed_title).toBe("Feed A");
  });

  test("excludes uncurated articles from both views", () => {
    const active = getCuratedArticles("newest", "active");
    const archive = getCuratedArticles("newest", "archive");
    const allUrls = [...active, ...archive].map((a) => a.url);
    expect(allUrls).not.toContain("https://curated-test.com/a4");
  });

  test("sort by score orders highest first", () => {
    const results = getCuratedArticles("score", "active");
    expect((results[0] as any).score).toBeGreaterThan((results[1] as any).score);
  });

  test("includes feed_title and category from joined feed", () => {
    const results = getCuratedArticles("newest", "active");
    const a2 = results.find((a) => a.url === "https://curated-test.com/a2")!;
    expect(a2.feed_title).toBe("Feed B");
    expect(a2.category).toBe("Science");
  });

  test("returns empty array when no curated articles exist", () => {
    db.exec("DELETE FROM articles");
    expect(getCuratedArticles("newest", "active")).toEqual([]);
  });
});

// ─── getStats ───

describe("getStats", () => {
  beforeEach(() => {
    db.exec("DELETE FROM articles");
  });

  test("returns zeros when no articles exist", () => {
    const stats = getStats();
    expect(stats.total).toBe(0);
    expect(stats.curated).toBe(0);
    expect(stats.unread).toBe(0);
    expect(stats.archived).toBe(0);
    expect(stats.feeds).toBe(2);
  });

  test("counts articles correctly across states", () => {
    const feedId = listFeeds()[0].id;

    addArticle("https://stats.com/uncurated", "Uncurated", "c", feedId);

    addArticle("https://stats.com/curated-unread", "Curated Unread", "c", feedId);
    const a2 = listArticles().find((a) => a.url === "https://stats.com/curated-unread")!;
    updateArticleCuration(a2.id, 0.8, "Good");

    addArticle("https://stats.com/curated-read", "Curated Read", "c", feedId);
    const a3 = listArticles().find((a) => a.url === "https://stats.com/curated-read")!;
    updateArticleCuration(a3.id, 0.5, "OK");
    markAsRead(a3.id);

    addArticle("https://stats.com/dismissed", "Dismissed", "c", feedId);
    const a4 = listArticles().find((a) => a.url === "https://stats.com/dismissed")!;
    updateArticleCuration(a4.id, 0.3, "Meh");
    dismissArticle(a4.id);

    const stats = getStats();
    expect(stats.total).toBe(4);
    expect(stats.curated).toBe(3);
    expect(stats.unread).toBe(1);
    expect(stats.archived).toBe(1);
  });
});

// ─── toggleRead ───

describe("toggleRead", () => {
  let articleId: number;

  beforeEach(() => {
    db.exec("DELETE FROM articles");
    const feedId = listFeeds()[0].id;
    addArticle("https://toggle-test.com/a1", "Toggle Test", "content", feedId);
    articleId = listArticles()[0].id;
  });

  test("marks unread article as read", () => {
    expect(toggleRead(articleId)).toBe(true);
    expect(getArticleById(articleId)!.read_at).not.toBeNull();
  });

  test("marks read article as unread", () => {
    markAsRead(articleId);
    expect(toggleRead(articleId)).toBe(true);
    expect(getArticleById(articleId)!.read_at).toBeNull();
  });

  test("returns false for non-existent article", () => {
    expect(toggleRead(99999)).toBe(false);
  });
});

// ─── Briefings ───

describe("saveBriefing / getBriefing", () => {
  beforeEach(() => {
    db.exec("DELETE FROM briefings");
  });

  const sampleClusters: BriefingCluster[] = [
    { topic: "AI Safety", summary: "New developments", article_ids: [1, 2] },
    { topic: "Web Dev", summary: "Frontend updates", article_ids: [3] },
  ];

  test("saves and retrieves a briefing", () => {
    saveBriefing("2024-06-15", sampleClusters);
    const briefing = getBriefing("2024-06-15");
    expect(briefing).not.toBeNull();
    expect(briefing!.date).toBe("2024-06-15");
    expect(JSON.parse(briefing!.clusters)).toEqual(sampleClusters);
  });

  test("upserts on same date", () => {
    saveBriefing("2024-06-15", sampleClusters);
    saveBriefing("2024-06-15", [{ topic: "Updated", summary: "New", article_ids: [10] }]);
    const parsed = JSON.parse(getBriefing("2024-06-15")!.clusters);
    expect(parsed.length).toBe(1);
    expect(parsed[0].topic).toBe("Updated");
  });

  test("returns null for non-existent date", () => {
    expect(getBriefing("1999-01-01")).toBeNull();
  });

  test("handles empty clusters array", () => {
    saveBriefing("2024-06-20", []);
    expect(JSON.parse(getBriefing("2024-06-20")!.clusters)).toEqual([]);
  });
});

describe("getTodayBriefing", () => {
  beforeEach(() => {
    db.exec("DELETE FROM briefings");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("returns null when no briefing exists for today", () => {
    expect(getTodayBriefing()).toBeNull();
  });

  test("returns today's briefing when it exists", () => {
    const today = getLocalDateKey();
    saveBriefing(today, [{ topic: "Today", summary: "News", article_ids: [1] }]);
    const briefing = getTodayBriefing();
    expect(briefing).not.toBeNull();
    expect(briefing!.date).toBe(today);
  });

  test("does not return an older briefing when today has no matching entry", () => {
    const olderDate = new Date();
    olderDate.setDate(olderDate.getDate() - 2);
    const older = getLocalDateKey(olderDate);
    saveBriefing(older, [{ topic: "Older", summary: "Old", article_ids: [] }]);
    expect(getTodayBriefing()).toBeNull();
  });

  test("falls back to legacy UTC date keys for existing briefings", () => {
    vi.useFakeTimers();
    const now = new Date("2026-04-07T00:30:00+09:00");
    vi.setSystemTime(now);

    const legacyUtcDate = getUtcDateKey(now);
    saveBriefing(legacyUtcDate, [{ topic: "Legacy", summary: "Saved before timezone fix", article_ids: [1] }]);

    const briefing = getTodayBriefing();
    expect(briefing).not.toBeNull();
    expect(briefing!.date).toBe(legacyUtcDate);
  });
});

// ─── Config ───

describe("getConfig / setConfig", () => {
  beforeEach(() => {
    db.exec("DELETE FROM settings");
  });

  test("getConfig returns null for non-existent key", () => {
    expect(getConfig("nonexistent")).toBeNull();
  });

  test("setConfig creates and getConfig retrieves", () => {
    setConfig("language", "ja");
    expect(getConfig("language")).toBe("ja");
  });

  test("setConfig overwrites existing value", () => {
    setConfig("language", "en");
    setConfig("language", "ja");
    expect(getConfig("language")).toBe("ja");
  });

  test("multiple keys are independent", () => {
    setConfig("language", "en");
    setConfig("theme", "dark");
    expect(getConfig("language")).toBe("en");
    expect(getConfig("theme")).toBe("dark");
  });
});

// ─── Preference Memo ───

describe("getPreferenceMemo / savePreferenceMemo", () => {
  beforeEach(() => {
    db.exec("DELETE FROM settings");
  });

  test("getPreferenceMemo returns null when no memo exists", () => {
    expect(getPreferenceMemo()).toBeNull();
  });

  test("savePreferenceMemo stores memo and timestamp", () => {
    savePreferenceMemo("- Prefers: hands-on tutorials");
    expect(getPreferenceMemo()).toBe("- Prefers: hands-on tutorials");
    expect(getConfig("preference_memo_updated_at")).not.toBeNull();
  });

  test("savePreferenceMemo overwrites previous memo", () => {
    savePreferenceMemo("first memo");
    savePreferenceMemo("second memo");
    expect(getPreferenceMemo()).toBe("second memo");
  });
});

describe("isPreferenceMemoStale", () => {
  beforeEach(() => {
    db.exec("DELETE FROM settings");
    db.exec("DELETE FROM articles");
  });

  test("returns true when no memo exists", () => {
    expect(isPreferenceMemoStale()).toBe(true);
  });

  test("returns false when memo is less than 24h old", () => {
    savePreferenceMemo("fresh memo");
    expect(isPreferenceMemoStale()).toBe(false);
  });

  test("returns false when memo is old but fewer than 20 new actions", () => {
    // Set memo timestamp to 2 days ago
    setConfig("preference_memo", "old memo");
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    setConfig("preference_memo_updated_at", twoDaysAgo);

    // Add only 5 read articles (< 20 threshold)
    const feedId = listFeeds()[0]?.id ?? null;
    for (let i = 0; i < 5; i++) {
      addArticle(`https://example.com/stale-test-${i}`, `Article ${i}`, "content", feedId ?? undefined);
    }
    const articles = listArticles();
    for (const a of articles) {
      updateArticleCuration(a.id, 0.8, "summary");
      markAsRead(a.id);
    }

    expect(isPreferenceMemoStale()).toBe(false);
  });

  test("returns true when memo is old and 20+ new actions exist", () => {
    setConfig("preference_memo", "old memo");
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    setConfig("preference_memo_updated_at", twoDaysAgo);

    const feedId = listFeeds()[0]?.id ?? null;
    for (let i = 0; i < 20; i++) {
      addArticle(`https://example.com/stale-bulk-${i}`, `Bulk ${i}`, "content", feedId ?? undefined);
    }
    const articles = listArticles();
    for (const a of articles) {
      updateArticleCuration(a.id, 0.7, "summary");
      markAsRead(a.id);
    }

    expect(isPreferenceMemoStale()).toBe(true);
  });
});

describe("getRecentActions", () => {
  beforeEach(() => {
    db.exec("DELETE FROM articles");
  });

  test("returns empty array when no actions", () => {
    expect(getRecentActions(90, 100)).toEqual([]);
  });

  test("returns read articles with action 'read'", () => {
    const feedId = listFeeds()[0]?.id ?? null;
    addArticle("https://example.com/recent-read", "Read Article", "content", feedId ?? undefined);
    const articles = listArticles();
    updateArticleCuration(articles[0].id, 0.9, "great article", "ai,tools");
    markAsRead(articles[0].id);

    const actions = getRecentActions(90, 100);
    expect(actions.length).toBe(1);
    expect(actions[0].action).toBe("read");
    expect(actions[0].title).toBe("Read Article");
    expect(actions[0].score).toBe(0.9);
    expect(actions[0].tags).toBe("ai,tools");
  });

  test("returns dismissed articles with action 'dismissed'", () => {
    const feedId = listFeeds()[0]?.id ?? null;
    addArticle("https://example.com/recent-dismiss", "Dismissed Article", "content", feedId ?? undefined);
    const articles = listArticles();
    updateArticleCuration(articles[0].id, 0.3, "not interesting");
    dismissArticle(articles[0].id);

    const actions = getRecentActions(90, 100);
    expect(actions.length).toBe(1);
    expect(actions[0].action).toBe("dismissed");
  });

  test("respects limit parameter", () => {
    const feedId = listFeeds()[0]?.id ?? null;
    for (let i = 0; i < 5; i++) {
      addArticle(`https://example.com/limit-${i}`, `Limit ${i}`, "content", feedId ?? undefined);
    }
    const articles = listArticles();
    for (const a of articles) {
      updateArticleCuration(a.id, 0.5, "summary");
      markAsRead(a.id);
    }

    const actions = getRecentActions(90, 3);
    expect(actions.length).toBe(3);
  });

  test("excludes articles outside the day range", () => {
    const feedId = listFeeds()[0]?.id ?? null;
    addArticle("https://example.com/old-action", "Old Article", "content", feedId ?? undefined);
    const articles = listArticles();
    updateArticleCuration(articles[0].id, 0.5, "summary");
    // Set read_at to 100 days ago (outside 90-day window)
    const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare("UPDATE articles SET read_at = ? WHERE id = ?").run(oldDate, articles[0].id);

    const actions = getRecentActions(90, 100);
    expect(actions.length).toBe(0);
  });
});
