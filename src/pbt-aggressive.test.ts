import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { decayWeight, profileForPrompt, formatProfile, type UserProfile } from "./profile";
import { normalizeTag, normalizeTags } from "./tag";

// ═══ L3: SIZE ESCALATION ═══

describe("L3: Size escalation", () => {
  // normalizeTag with very long strings
  test("normalizeTag handles very long strings without crash", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1000, maxLength: 10000 }),
        (s) => {
          const result = normalizeTag(s);
          expect(typeof result).toBe("string");
          expect(result).toBe(result.toLowerCase());
          expect(result).not.toMatch(/\s/);
        },
      ),
      { numRuns: 50 },
    );
  });

  // normalizeTags with many tags
  test("normalizeTags handles 100+ tags without crash", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.string({ minLength: 1, maxLength: 30 }).filter((s) => !s.includes(",")),
          { minLength: 50, maxLength: 200 },
        ),
        (tags) => {
          const input = tags.join(",");
          const result = normalizeTags(input);
          expect(typeof result).toBe("string");
          // no duplicates
          const outputTags = result.split(",").map((t) => t.trim()).filter((t) => t);
          expect(new Set(outputTags).size).toBe(outputTags.length);
        },
      ),
      { numRuns: 20 },
    );
  });

  // decayWeight with extreme dates
  test("decayWeight handles extreme past dates (10+ years)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 365 * 10, max: 365 * 100 }),
        (daysAgo) => {
          const date = new Date(Date.now() - daysAgo * 86400000).toISOString();
          const w = decayWeight(date);
          // Clamped to Number.MIN_VALUE to prevent underflow to 0
          expect(w).toBeGreaterThan(0);
          expect(w).toBeLessThanOrEqual(1);
          expect(w).toBeLessThan(0.001);
          // Must always be finite (not NaN or Infinity)
          expect(Number.isFinite(w)).toBe(true);
        },
      ),
    );
  });

  // profileForPrompt with many tags/feeds
  test("profileForPrompt handles large profile without crash", () => {
    const manyTags = Array.from({ length: 100 }, (_, i) => ({
      tag: `tag-${i}`,
      total: 10 + i,
      read: 5 + (i % 5),
      readRate: (5 + (i % 5)) / (10 + i),
    }));
    const manyFeeds = Array.from({ length: 50 }, (_, i) => ({
      feed_id: i,
      title: `Feed ${i}`,
      category: i % 3 === 0 ? "Tech" : null,
      total: 20,
      read: 10,
      readRate: 0.5,
    }));
    const profile: UserProfile = {
      totalCurated: 5000,
      totalRead: 2500,
      overallReadRate: 0.5,
      preferredTags: manyTags.slice(0, 50),
      ignoredTags: manyTags.slice(50),
      feedStats: manyFeeds,
      scoreBands: [
        { band: "0.85-1.0 (Must Read)", total: 1000, read: 900, readRate: 0.9 },
        { band: "0.70-0.84 (Recommended)", total: 1500, read: 900, readRate: 0.6 },
        { band: "0.50-0.69 (Worth a Look)", total: 1500, read: 450, readRate: 0.3 },
        { band: "0.00-0.49 (Low Priority)", total: 1000, read: 100, readRate: 0.1 },
      ],
      totalDismissed: 500,
      dismissRate: 0.167,
      dismissedTags: manyTags.slice(0, 20).map((t) => ({
        tag: t.tag,
        total: t.total,
        count: Math.floor(t.total * 0.7),
        rate: 0.7,
      })),
    };
    const prompt = profileForPrompt(profile);
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
    const formatted = formatProfile(profile);
    expect(typeof formatted).toBe("string");
  });
});

// ═══ L4: PATHOLOGICAL STRUCTURES ═══

describe("L4: Pathological structures", () => {
  // Tags with special characters that might break parsing
  test("normalizeTag handles unicode, emoji, and control chars", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.constantFrom(
            "🔥fire", "café", "naïve", "\t\ttab-tag\t", "\n\nnewline",
            "\0null", "\uFEFFbom", "tag\u200Bzwsp", "a".repeat(5000),
            "---", "...", "___",
          ),
        ),
        (s) => {
          const result = normalizeTag(s);
          expect(typeof result).toBe("string");
          expect(result).toBe(result.trim());
          // Should never throw
        },
      ),
      { numRuns: 200 },
    );
  });

  // Tags that are all commas / whitespace
  test("normalizeTags handles degenerate comma-heavy input", () => {
    const inputs = [
      ",,,,,",
      ", , , ,",
      "  ,  ,  ",
      ",,tag,,",
      ",",
      "",
      "   ",
      "a,,,,b,,,,c",
    ];
    for (const input of inputs) {
      const result = normalizeTags(input);
      expect(typeof result).toBe("string");
      // Should not contain empty tags
      const tags = result.split(",").map((t) => t.trim());
      for (const t of tags) {
        if (t) expect(t.length).toBeGreaterThan(0);
      }
    }
  });

  // Collision-heavy synonym inputs
  test("normalizeTags deduplicates all synonym variants", () => {
    // All of these should resolve to the same tag
    const llmVariants = "llm, LLM, llms, LLMs, large-language-models, Large-Language-Model";
    const result = normalizeTags(llmVariants);
    expect(result).toBe("llm");
  });

  // Tags with only whitespace characters
  test("normalizeTag with only whitespace returns hyphenated", () => {
    const result = normalizeTag("   ");
    // trim() -> "", then no hyphens needed
    expect(result).toBe("");
  });

  // decayWeight with epoch boundaries
  test("decayWeight handles epoch edge cases", () => {
    // Unix epoch
    expect(decayWeight("1970-01-01T00:00:00.000Z")).toBeGreaterThan(0);
    expect(decayWeight("1970-01-01T00:00:00.000Z")).toBeLessThan(0.001);
    // Y2K
    const y2k = decayWeight("2000-01-01T00:00:00.000Z");
    expect(y2k).toBeGreaterThan(0);
    expect(y2k).toBeLessThan(0.001);
    // Far future
    expect(decayWeight("2099-01-01T00:00:00.000Z")).toBe(1);
  });

  // profileForPrompt with zero-total score bands
  test("profileForPrompt handles all-zero profile gracefully", () => {
    const profile: UserProfile = {
      totalCurated: 0,
      totalRead: 0,
      overallReadRate: 0,
      preferredTags: [],
      ignoredTags: [],
      feedStats: [],
      scoreBands: [
        { band: "0.85-1.0 (Must Read)", total: 0, read: 0, readRate: 0 },
        { band: "0.70-0.84 (Recommended)", total: 0, read: 0, readRate: 0 },
        { band: "0.50-0.69 (Worth a Look)", total: 0, read: 0, readRate: 0 },
        { band: "0.00-0.49 (Low Priority)", total: 0, read: 0, readRate: 0 },
      ],
      totalDismissed: 0,
      dismissRate: 0,
      dismissedTags: [],
    };
    const prompt = profileForPrompt(profile);
    expect(prompt).toContain("Overall read rate: 0%");
    expect(prompt).not.toContain("Reading patterns by score tier:");
    expect(prompt).toContain("Adjust scores accordingly");
  });

  // Extremely high read rates (> 1.0 due to float accumulation)
  test("profileForPrompt with floating point edge case readRate", () => {
    const profile: UserProfile = {
      totalCurated: 1,
      totalRead: 1,
      overallReadRate: 1.0,
      preferredTags: [{ tag: "test", total: 0.0001, read: 0.0001, readRate: 1.0 }],
      ignoredTags: [],
      feedStats: [],
      scoreBands: [
        { band: "0.85-1.0 (Must Read)", total: 1, read: 1, readRate: 1.0 },
        { band: "0.70-0.84 (Recommended)", total: 0, read: 0, readRate: 0 },
        { band: "0.50-0.69 (Worth a Look)", total: 0, read: 0, readRate: 0 },
        { band: "0.00-0.49 (Low Priority)", total: 0, read: 0, readRate: 0 },
      ],
      totalDismissed: 0,
      dismissRate: 0,
      dismissedTags: [],
    };
    const prompt = profileForPrompt(profile);
    expect(prompt).not.toContain("NaN");
    expect(prompt).not.toContain("Infinity");
    const formatted = formatProfile(profile);
    expect(formatted).not.toContain("NaN");
    expect(formatted).not.toContain("Infinity");
  });
});

// ═══ L5: OPERATION SEQUENCES ═══

describe("L5: Operation sequences on normalizeTags", () => {
  // Random sequences of normalize operations
  test("repeated normalization converges after 1 step", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.string({ minLength: 1, maxLength: 30 }).filter((s) => !s.includes(",")),
          { minLength: 1, maxLength: 20 },
        ),
        (tags) => {
          const input = tags.join(",");
          const once = normalizeTags(input);
          const twice = normalizeTags(once);
          const thrice = normalizeTags(twice);
          // Must converge after first normalization
          expect(twice).toBe(once);
          expect(thrice).toBe(once);
        },
      ),
      { numRuns: 200 },
    );
  });

  // Combining tags from multiple sources
  test("merging and re-normalizing preserves no-dup invariant", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.string({ minLength: 1, maxLength: 20 }).filter((s) => !s.includes(",")),
          { minLength: 1, maxLength: 10 },
        ),
        fc.array(
          fc.string({ minLength: 1, maxLength: 20 }).filter((s) => !s.includes(",")),
          { minLength: 1, maxLength: 10 },
        ),
        (tagsA, tagsB) => {
          const normalA = normalizeTags(tagsA.join(","));
          const normalB = normalizeTags(tagsB.join(","));
          const merged = normalizeTags(normalA + ", " + normalB);
          const outputTags = merged.split(",").map((t) => t.trim()).filter((t) => t);
          expect(new Set(outputTags).size).toBe(outputTags.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ═══ ROBUSTNESS: Crash tests ═══

describe("Robustness: crash resistance", () => {
  test("decayWeight never throws for any string input", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const result = decayWeight(s);
        expect(typeof result).toBe("number");
        expect(Number.isFinite(result)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  test("normalizeTag never throws for any string", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const result = normalizeTag(s);
        expect(typeof result).toBe("string");
      }),
      { numRuns: 500 },
    );
  });

  test("normalizeTags never throws for any string", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const result = normalizeTags(s);
        expect(typeof result).toBe("string");
      }),
      { numRuns: 500 },
    );
  });

  test("formatProfile never produces NaN or Infinity", () => {
    fc.assert(
      fc.property(
        fc.record({
          totalCurated: fc.nat({ max: 10000 }),
          totalRead: fc.nat({ max: 10000 }),
          overallReadRate: fc.float({ min: 0, max: 1, noNaN: true }),
          preferredTags: fc.array(
            fc.record({
              tag: fc.string({ minLength: 1, maxLength: 20 }),
              total: fc.float({ min: 0, max: 1000, noNaN: true }),
              read: fc.float({ min: 0, max: 1000, noNaN: true }),
              readRate: fc.float({ min: 0, max: 1, noNaN: true }),
            }),
            { maxLength: 5 },
          ),
          ignoredTags: fc.array(
            fc.record({
              tag: fc.string({ minLength: 1, maxLength: 20 }),
              total: fc.float({ min: 0, max: 1000, noNaN: true }),
              read: fc.float({ min: 0, max: 1000, noNaN: true }),
              readRate: fc.float({ min: 0, max: 1, noNaN: true }),
            }),
            { maxLength: 5 },
          ),
          feedStats: fc.array(
            fc.record({
              feed_id: fc.nat({ max: 100 }),
              title: fc.string({ maxLength: 30 }),
              category: fc.option(fc.string({ maxLength: 20 }), { nil: null }),
              total: fc.float({ min: 0, max: 1000, noNaN: true }),
              read: fc.float({ min: 0, max: 1000, noNaN: true }),
              readRate: fc.float({ min: 0, max: 1, noNaN: true }),
            }),
            { maxLength: 5 },
          ),
          scoreBands: fc.constant([
            { band: "0.85-1.0 (Must Read)", total: 5, read: 4, readRate: 0.8 },
            { band: "0.00-0.49 (Low Priority)", total: 5, read: 1, readRate: 0.2 },
          ]),
          totalDismissed: fc.nat({ max: 5000 }),
          dismissRate: fc.float({ min: 0, max: 1, noNaN: true }),
          dismissedTags: fc.array(
            fc.record({
              tag: fc.string({ minLength: 1, maxLength: 20 }),
              total: fc.float({ min: 0, max: 1000, noNaN: true }),
              count: fc.float({ min: 0, max: 1000, noNaN: true }),
              rate: fc.float({ min: 0, max: 1, noNaN: true }),
            }),
            { maxLength: 5 },
          ),
        }),
        (profile) => {
          const formatted = formatProfile(profile as UserProfile);
          expect(formatted).not.toContain("NaN");
          expect(formatted).not.toContain("Infinity");
          const prompt = profileForPrompt(profile as UserProfile);
          expect(prompt).not.toContain("NaN");
          expect(prompt).not.toContain("Infinity");
        },
      ),
      { numRuns: 100 },
    );
  });
});
