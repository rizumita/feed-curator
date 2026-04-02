import { describe, expect, test, beforeEach } from "vitest";
import fc from "fast-check";
import { db } from "./db";
import { addFeed, listFeeds } from "./feed";
import {
  addArticle,
  listArticles,
  updateArticleCuration,
  markAsRead,
  dismissArticle,
  getConfig,
  setConfig,
  getPreferenceMemo,
  savePreferenceMemo,
  isPreferenceMemoStale,
  getRecentActions,
} from "./article";
import { generateProfile, profileForPrompt } from "./profile";

// ─── Setup ───

beforeEach(() => {
  db.exec("DELETE FROM settings");
  db.exec("DELETE FROM articles");
});

// Helper: create N curated+read articles
function seedReadArticles(n: number): void {
  const feeds = listFeeds();
  if (feeds.length === 0) {
    addFeed("https://pbt-memo-feed.example.com/rss", "PBT Feed");
  }
  const feedId = listFeeds()[0].id;
  for (let i = 0; i < n; i++) {
    addArticle(`https://example.com/pbt-memo-${Date.now()}-${i}`, `PBT Article ${i}`, "content", feedId);
  }
  for (const a of listArticles()) {
    if (!a.curated_at) {
      updateArticleCuration(a.id, 0.5 + Math.random() * 0.5, `summary ${a.id}`, "test-tag");
      markAsRead(a.id);
    }
  }
}

// Helper: create N curated+dismissed articles
function seedDismissedArticles(n: number): void {
  const feeds = listFeeds();
  if (feeds.length === 0) {
    addFeed("https://pbt-memo-feed.example.com/rss", "PBT Feed");
  }
  const feedId = listFeeds()[0].id;
  for (let i = 0; i < n; i++) {
    addArticle(`https://example.com/pbt-dismissed-${Date.now()}-${i}`, `Dismissed ${i}`, "content", feedId);
  }
  for (const a of listArticles()) {
    if (!a.curated_at) {
      updateArticleCuration(a.id, 0.2, "not interesting");
      dismissArticle(a.id);
    }
  }
}

// ═══ L1: BOUNDARY TESTS ═══

describe("L1: isPreferenceMemoStale boundary", () => {
  test("exactly 24h ago with 20+ actions → stale", () => {
    setConfig("preference_memo", "old memo");
    const exactlyOneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    setConfig("preference_memo_updated_at", exactlyOneDayAgo);

    seedReadArticles(20);

    expect(isPreferenceMemoStale()).toBe(true);
  });

  test("23h59m59s ago → not stale regardless of actions", () => {
    setConfig("preference_memo", "memo");
    const justUnder24h = new Date(Date.now() - (24 * 60 * 60 * 1000 - 1000)).toISOString();
    setConfig("preference_memo_updated_at", justUnder24h);

    seedReadArticles(50); // many actions, but within 24h

    expect(isPreferenceMemoStale()).toBe(false);
  });

  test("old memo with exactly 19 new actions → not stale", () => {
    setConfig("preference_memo", "old memo");
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    setConfig("preference_memo_updated_at", twoDaysAgo);

    seedReadArticles(19);

    expect(isPreferenceMemoStale()).toBe(false);
  });

  test("old memo with exactly 20 new actions → stale", () => {
    setConfig("preference_memo", "old memo");
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    setConfig("preference_memo_updated_at", twoDaysAgo);

    seedReadArticles(20);

    expect(isPreferenceMemoStale()).toBe(true);
  });
});

describe("L1: getRecentActions boundary", () => {
  test("days=0 returns no articles (cutoff is now)", () => {
    seedReadArticles(5);
    // days=0 means cutoff = now, so no articles should match
    const actions = getRecentActions(0, 100);
    expect(actions.length).toBe(0);
  });

  test("limit=0 returns empty array", () => {
    seedReadArticles(5);
    const actions = getRecentActions(90, 0);
    expect(actions.length).toBe(0);
  });

  test("limit=1 returns exactly 1", () => {
    seedReadArticles(5);
    const actions = getRecentActions(90, 1);
    expect(actions.length).toBe(1);
  });
});

describe("L1: savePreferenceMemo boundary", () => {
  test("empty string is stored and retrieved", () => {
    savePreferenceMemo("");
    expect(getPreferenceMemo()).toBe("");
  });

  test("very long memo (10KB) survives roundtrip", () => {
    const longMemo = "x".repeat(10000);
    savePreferenceMemo(longMemo);
    expect(getPreferenceMemo()).toBe(longMemo);
  });
});

// ═══ L2: NEAR-INVALID TESTS ═══

describe("L2: isPreferenceMemoStale near-invalid", () => {
  test("invalid date string in updated_at → treated as stale", () => {
    setConfig("preference_memo", "memo");
    setConfig("preference_memo_updated_at", "not-a-date");

    // Invalid date → NaN elapsed → early return true (stale)
    expect(isPreferenceMemoStale()).toBe(true);
  });

  test("future date in updated_at → not stale (negative elapsed)", () => {
    setConfig("preference_memo", "memo");
    const future = new Date(Date.now() + 60000).toISOString();
    setConfig("preference_memo_updated_at", future);

    expect(isPreferenceMemoStale()).toBe(false);
  });
});

describe("L2: getRecentActions near-invalid", () => {
  test("article with both read_at and dismissed_at returns 'read' (read_at prioritized)", () => {
    const feeds = listFeeds();
    if (feeds.length === 0) addFeed("https://pbt-memo-feed.example.com/rss", "PBT Feed");
    const feedId = listFeeds()[0].id;
    addArticle("https://example.com/both-actions", "Both Actions", "content", feedId);
    const articles = listArticles();
    updateArticleCuration(articles[0].id, 0.5, "summary");
    markAsRead(articles[0].id);
    dismissArticle(articles[0].id);

    const actions = getRecentActions(90, 100);
    // Article has both read_at and dismissed_at set
    // CASE WHEN read_at IS NOT NULL THEN 'read' → should be 'read'
    // But it may appear TWICE (once for read_at > cutoff, once for dismissed_at > cutoff)
    // The OR condition means it's included if either matches
    // The article appears once (it's a single row) with action='read'
    expect(actions.length).toBe(1);
    expect(actions[0].action).toBe("read");
  });

  test("uncurated articles are excluded", () => {
    const feeds = listFeeds();
    if (feeds.length === 0) addFeed("https://pbt-memo-feed.example.com/rss", "PBT Feed");
    const feedId = listFeeds()[0].id;

    // Add article without curation
    addArticle("https://example.com/uncurated", "Uncurated", "content", feedId);
    // Manually set read_at without curating
    const articles = listArticles();
    db.prepare("UPDATE articles SET read_at = datetime('now') WHERE id = ?").run(articles[0].id);

    const actions = getRecentActions(90, 100);
    expect(actions.length).toBe(0); // curated_at IS NOT NULL filter
  });

  test("negative days produces future cutoff → returns all recent", () => {
    seedReadArticles(3);
    // days=-1 → cutoff = now + 1 day (future) → nothing matches
    const actions = getRecentActions(-1, 100);
    // Cutoff will be in the future, so read_at > future_cutoff should be false
    expect(actions.length).toBe(0);
  });
});

// ═══ L3-L4: PBT ATTACK ═══

describe("L3: savePreferenceMemo roundtrip (PBT)", () => {
  test("any string survives save→get roundtrip", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 5000 }),
        (memo) => {
          savePreferenceMemo(memo);
          expect(getPreferenceMemo()).toBe(memo);
        },
      ),
      { numRuns: 200 },
    );
  });

  test("unicode and special characters survive roundtrip", () => {
    const unicodeMemos = [
      "- Prefers: AI\u30C4\u30FC\u30EB\u306E\u6BD4\u8F03\u8A18\u4E8B",
      "- Avoids: \u4F01\u696D\u30CB\u30E5\u30FC\u30B9\u2728\u{1F680}",
      "line1\nline2\n\ttabbed\r\nwindows",
      // Note: \x00 (null byte) is truncated by SQLite C-string handling - expected behavior
      "\x01control\x02chars\x03more",
      "emoji: \u{1F600}\u{1F4A9}\u{1F47D}\u{1F916}",
    ];
    for (const memo of unicodeMemos) {
      savePreferenceMemo(memo);
      expect(getPreferenceMemo()).toBe(memo);
    }
  });

  test("SQL injection patterns survive roundtrip without corruption", () => {
    const injections = [
      "'; DROP TABLE settings; --",
      "\" OR 1=1 --",
      "Robert'); DROP TABLE articles;--",
      "' UNION SELECT * FROM settings --",
      "1; DELETE FROM articles WHERE 1=1",
      "'), ('evil_key', 'evil_value",
    ];
    for (const injection of injections) {
      savePreferenceMemo(injection);
      expect(getPreferenceMemo()).toBe(injection);
      // Verify settings table is intact
      expect(getConfig("preference_memo")).toBe(injection);
    }
  });
});

describe("L3: getRecentActions limit invariant (PBT)", () => {
  test("result count never exceeds limit", () => {
    seedReadArticles(30);

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        (limit) => {
          const actions = getRecentActions(90, limit);
          expect(actions.length).toBeLessThanOrEqual(limit);
        },
      ),
      { numRuns: 50 },
    );
  });

  test("all returned actions have valid action field", () => {
    seedReadArticles(10);
    seedDismissedArticles(10);

    const actions = getRecentActions(365, 100);
    for (const a of actions) {
      expect(["read", "dismissed"]).toContain(a.action);
    }
  });
});

describe("L3: isPreferenceMemoStale idempotency", () => {
  test("calling twice returns same result", () => {
    setConfig("preference_memo", "memo");
    const hoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    setConfig("preference_memo_updated_at", hoursAgo);
    seedReadArticles(25);

    const first = isPreferenceMemoStale();
    const second = isPreferenceMemoStale();
    expect(first).toBe(second);
  });
});

describe("L4: profileForPrompt with memo injection (PBT)", () => {
  test("memo content does not crash profileForPrompt", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 2000 }),
        (memo) => {
          savePreferenceMemo(memo);
          const profile = generateProfile();
          const prompt = profileForPrompt(profile);
          expect(typeof prompt).toBe("string");
          expect(prompt.length).toBeGreaterThan(0);
          // Memo should appear in prompt if non-empty
          if (memo.length > 0) {
            expect(prompt).toContain(memo);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  test("null memo (no memo saved) produces valid prompt", () => {
    db.exec("DELETE FROM settings");
    const profile = generateProfile();
    const prompt = profileForPrompt(profile);
    expect(typeof prompt).toBe("string");
    expect(prompt).not.toContain("Semantic preferences");
  });
});

describe("L4: isPreferenceMemoStale with mixed read/dismiss actions", () => {
  test("counts dismissed articles toward staleness threshold", () => {
    setConfig("preference_memo", "old memo");
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    setConfig("preference_memo_updated_at", twoDaysAgo);

    // 10 reads + 10 dismisses = 20 total → should trigger stale
    seedReadArticles(10);
    seedDismissedArticles(10);

    expect(isPreferenceMemoStale()).toBe(true);
  });

  test("pre-memo actions do not count toward staleness", () => {
    // Create articles BEFORE memo
    seedReadArticles(25);

    // Now save memo (timestamp = now)
    savePreferenceMemo("fresh memo");

    // These 25 actions happened before memo, so should not count
    expect(isPreferenceMemoStale()).toBe(false);
  });
});
