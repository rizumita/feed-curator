/**
 * Aggressive PBT (L3-L5): Attack new and refactored modules
 * Goal: Find bugs through adversarial inputs
 */
import { describe, expect, test, beforeEach } from "vitest";
import fc from "fast-check";
import { db } from "./db";
import { canonicalizeUrl } from "./dedupe";
import { addArticle, listArticles, getCuratedArticles, updateArticleCuration } from "./article";
import { generateDigestMarkdown } from "./digest";
import { getConfig, setConfig, getAutoArchiveDays, runAutoArchive } from "./config";
import { saveBriefing, getBriefing } from "./briefing-data";
import { savePreferenceMemo, getPreferenceMemo, isPreferenceMemoStale, getRecentActions } from "./preferences";
import { addFeed, getAllFeeds } from "./feed";
import { generateProfile, profileForPrompt, formatProfile } from "./profile";

function clearAll(): void {
  db.prepare("DELETE FROM briefings").run();
  db.prepare("DELETE FROM articles").run();
  db.prepare("DELETE FROM feeds").run();
  db.prepare("DELETE FROM settings").run();
}

// ═══ canonicalizeUrl: L3-L4 Adversarial URLs ═══

describe("canonicalizeUrl L3: adversarial URLs", () => {
  test("idempotent: canonicalize(canonicalize(x)) === canonicalize(x)", () => {
    fc.assert(
      fc.property(fc.webUrl(), (url) => {
        const once = canonicalizeUrl(url);
        const twice = canonicalizeUrl(once);
        expect(twice).toBe(once);
      }),
      { numRuns: 500 },
    );
  });

  test("never throws on arbitrary strings", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 2000 }), (s) => {
        const result = canonicalizeUrl(s);
        expect(typeof result).toBe("string");
        // Empty string input returns empty string (pass-through for invalid URLs)
        expect(result.length).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 500 },
    );
  });

  test("output never contains tracking params", () => {
    const trackingParams = ["utm_source", "utm_medium", "utm_campaign", "fbclid", "gclid", "ref"];
    fc.assert(
      fc.property(
        fc.webUrl(),
        fc.subarray(trackingParams, { minLength: 1 }),
        fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 5 }),
        (baseUrl, params, values) => {
          const url = new URL(baseUrl);
          params.forEach((p, i) => url.searchParams.set(p, values[i % values.length]));
          const canonical = canonicalizeUrl(url.toString());
          for (const param of params) {
            expect(canonical).not.toContain(`${param}=`);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  test("preserves path for valid URLs (modulo slash normalization)", () => {
    fc.assert(
      fc.property(fc.webUrl(), (url) => {
        const canonical = canonicalizeUrl(url);
        const canonicalParsed = new URL(canonical);
        // After canonicalization, path should have no consecutive slashes
        expect(canonicalParsed.pathname).not.toMatch(/\/{2,}/);
      }),
      { numRuns: 300 },
    );
  });

  test("L4: pathological URLs with many params", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 100 }),
        (paramCount) => {
          let url = "https://example.com/path?";
          for (let i = 0; i < paramCount; i++) {
            url += `param${i}=val${i}&`;
          }
          url += "utm_source=test";
          const result = canonicalizeUrl(url);
          expect(result).not.toContain("utm_source=");
          expect(typeof result).toBe("string");
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ═══ addArticle + dedup: L3-L5 State Machine ═══

describe("addArticle dedup L3: state machine", () => {
  beforeEach(clearAll);

  test("duplicate_of always points to an existing article", () => {
    addFeed("https://feed.test/rss", "Test Feed");
    const feedId = getAllFeeds()[0].id;

    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            path: fc.stringMatching(/^\/[a-z]{1,10}$/),
            tracking: fc.constantFrom("?ref=a", "?ref=b", "?utm_source=x", ""),
          }),
          { minLength: 1, maxLength: 30 },
        ),
        (entries) => {
          clearAll();
          addFeed("https://feed.test/rss", "Test Feed");
          const fid = getAllFeeds()[0].id;

          for (const e of entries) {
            addArticle(`https://example.com${e.path}${e.tracking}`, "Title", "content", fid);
          }

          const articles = db.prepare("SELECT id, duplicate_of FROM articles").all() as Array<{ id: number; duplicate_of: number | null }>;
          const ids = new Set(articles.map(a => a.id));

          for (const a of articles) {
            if (a.duplicate_of !== null) {
              expect(ids.has(a.duplicate_of)).toBe(true);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  test("listArticles never returns duplicate articles", () => {
    addFeed("https://feed.test/rss", "Test Feed");
    const feedId = getAllFeeds()[0].id;

    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^https:\/\/example\.com\/[a-z]{1,5}\?ref=[a-z]$/), { minLength: 1, maxLength: 20 }),
        (urls) => {
          clearAll();
          addFeed("https://feed.test/rss", "Test Feed");
          const fid = getAllFeeds()[0].id;
          for (const url of urls) addArticle(url, "Title", "content", fid);

          const listed = listArticles(true);
          for (const a of listed) {
            expect(a.duplicate_of).toBeNull();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ═══ config: L3 Roundtrip ═══

describe("config L3: roundtrip", () => {
  beforeEach(clearAll);

  test("setConfig → getConfig roundtrip for arbitrary strings", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.string({ minLength: 0, maxLength: 5000 }),
        (key, value) => {
          setConfig(key, value);
          expect(getConfig(key)).toBe(value);
        },
      ),
      { numRuns: 200 },
    );
  });

  test("getAutoArchiveDays returns positive finite number for any setting", () => {
    const adversarial = fc.oneof(
      fc.string(),
      fc.constantFrom("0", "-1", "NaN", "Infinity", "-Infinity", "", "abc", "1.5", "999999999999"),
      fc.integer().map(String),
    );

    fc.assert(
      fc.property(adversarial, (val) => {
        setConfig("auto_archive_days", val);
        const result = getAutoArchiveDays();
        expect(Number.isFinite(result)).toBe(true);
        expect(result).toBeGreaterThan(0);
      }),
      { numRuns: 200 },
    );
  });
});

// ═══ digest: L3-L4 Adversarial content ═══

describe("digest L3: adversarial content", () => {
  beforeEach(clearAll);

  test("generateDigestMarkdown never produces broken Markdown links", () => {
    addFeed("https://feed.test/rss", "Test");
    const feedId = getAllFeeds()[0].id;

    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            title: fc.oneof(
              fc.string({ minLength: 0, maxLength: 200 }),
              fc.constantFrom(
                "Normal title",
                "Title [with] brackets",
                "Title](http://evil.com) injection",
                "Title\nwith\nnewlines",
                "Title with `code` and *markdown*",
                "",
              ),
            ),
            url: fc.webUrl(),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        (articles) => {
          clearAll();
          addFeed("https://feed.test/rss", "Test");
          const fid = getAllFeeds()[0].id;

          const articleIds: number[] = [];
          for (const a of articles) {
            addArticle(a.url, a.title || undefined, "content", fid);
          }

          // Get the IDs that were actually inserted
          const dbArticles = db.prepare("SELECT id FROM articles").all() as Array<{ id: number }>;
          for (const a of dbArticles) {
            updateArticleCuration(a.id, 0.8, "Summary", "test");
            articleIds.push(a.id);
          }

          if (articleIds.length === 0) return;

          saveBriefing("2026-01-01", [
            { topic: "Test Topic", summary: "Test summary", article_ids: articleIds },
          ]);

          const md = generateDigestMarkdown("2026-01-01");
          if (md === null) return;

          // Markdown links should be well-formed: no unescaped ] inside link text
          const linkPattern = /\[([^\]]*)\]\(([^)]*)\)/g;
          let match;
          while ((match = linkPattern.exec(md)) !== null) {
            const linkText = match[1];
            // Link text should not contain unescaped brackets
            expect(linkText).not.toMatch(/(?<!\\)\[/);
          }

          // Should always end with credit
          expect(md).toContain("Generated by [Feed Curator]");
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ═══ preferences: L3 Adversarial memo content ═══

describe("preferences L3: adversarial memo", () => {
  beforeEach(clearAll);

  test("savePreferenceMemo → getPreferenceMemo roundtrip", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 10000 }),
        (memo) => {
          savePreferenceMemo(memo);
          expect(getPreferenceMemo()).toBe(memo);
        },
      ),
      { numRuns: 200 },
    );
  });

  test("isPreferenceMemoStale handles adversarial timestamps", () => {
    const adversarialDates = fc.oneof(
      fc.constantFrom("", "not-a-date", "NaN", "2099-99-99", "0000-00-00"),
      fc.date().map(d => d.toISOString()),
    );

    fc.assert(
      fc.property(adversarialDates, (dateStr) => {
        setConfig("preference_memo", "test memo");
        setConfig("preference_memo_updated_at", dateStr);
        const result = isPreferenceMemoStale();
        expect(typeof result).toBe("boolean");
      }),
      { numRuns: 100 },
    );
  });

  test("getRecentActions with adversarial days/limit never throws", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.integer({ min: -1000, max: 1000 }), fc.constantFrom(0, -1, NaN, Infinity)),
        fc.oneof(fc.integer({ min: -100, max: 1000 }), fc.constantFrom(0, -1, NaN, Infinity)),
        (days, limit) => {
          // Should not throw
          const result = getRecentActions(days, limit);
          expect(Array.isArray(result)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ═══ profile: L4 Adversarial data ═══

describe("profile L4: adversarial article data", () => {
  beforeEach(clearAll);

  test("profileForPrompt never contains NaN/undefined/null literals", () => {
    addFeed("https://feed.test/rss", "Test");
    const feedId = getAllFeeds()[0].id;

    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            score: fc.oneof(
              fc.double({ min: 0, max: 1, noNaN: true }),
              fc.constantFrom(0, 0.5, 1),
            ),
            read: fc.boolean(),
            dismissed: fc.boolean(),
            tags: fc.oneof(
              fc.constantFrom("ai", "coding", "security", "llm,mcp", ""),
              fc.string({ minLength: 0, maxLength: 50 }),
            ),
          }),
          { minLength: 0, maxLength: 30 },
        ),
        (articleSpecs) => {
          clearAll();
          addFeed("https://feed.test/rss", "Test");
          const fid = getAllFeeds()[0].id;

          for (let i = 0; i < articleSpecs.length; i++) {
            const spec = articleSpecs[i];
            addArticle(`https://example.com/art-${i}`, `Article ${i}`, "content", fid);
            const articles = db.prepare("SELECT id FROM articles WHERE url = ?").get(`https://example.com/art-${i}`) as { id: number } | null;
            if (!articles) continue;
            updateArticleCuration(articles.id, spec.score, `Summary ${i}`, spec.tags || undefined);
            if (spec.read) {
              db.prepare("UPDATE articles SET read_at = datetime('now') WHERE id = ?").run(articles.id);
            }
            if (spec.dismissed) {
              db.prepare("UPDATE articles SET dismissed_at = datetime('now') WHERE id = ?").run(articles.id);
            }
          }

          const profile = generateProfile();
          const prompt = profileForPrompt(profile);
          const formatted = formatProfile(profile);

          expect(prompt).not.toContain("NaN");
          expect(prompt).not.toContain("undefined");
          expect(formatted).not.toContain("NaN");
          expect(formatted).not.toContain("undefined");
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ═══ runAutoArchive: L3 Adversarial days ═══

describe("runAutoArchive L3: adversarial inputs", () => {
  beforeEach(clearAll);

  test("never archives with invalid days parameter", () => {
    addFeed("https://feed.test/rss", "Test");
    const feedId = getAllFeeds()[0].id;
    addArticle("https://example.com/old", "Old", "content", feedId, "2020-01-01");
    updateArticleCuration(
      (db.prepare("SELECT id FROM articles LIMIT 1").get() as { id: number }).id,
      0.5, "Summary", "test",
    );

    fc.assert(
      fc.property(
        fc.oneof(
          fc.constantFrom(0, -1, -100, NaN, Infinity, -Infinity),
          fc.double({ min: -1000, max: 0 }),
        ),
        (days) => {
          const result = runAutoArchive(days);
          expect(result).toBe(0);
        },
      ),
      { numRuns: 50 },
    );
  });
});
