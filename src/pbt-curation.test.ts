import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { decayWeight } from "./profile";
import { normalizeTag, normalizeTags } from "./tag";

// ─── decayWeight (property-based) ───

describe("decayWeight (property-based)", () => {
  // Invariant: output is always in (0, 1]
  test("output is always in (0, 1] for valid dates", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 365 * 5 }), // 0-5 years ago
        (daysAgo) => {
          const date = new Date(Date.now() - daysAgo * 86400000).toISOString();
          const w = decayWeight(date);
          expect(w).toBeGreaterThan(0);
          expect(w).toBeLessThanOrEqual(1);
        },
      ),
    );
  });

  // Algebraic: monotonically decreasing with age
  test("more recent dates produce higher weight", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 365 * 5 }),
        fc.integer({ min: 1, max: 365 * 5 }),
        (daysAgo, extraDays) => {
          const recent = new Date(Date.now() - daysAgo * 86400000).toISOString();
          const older = new Date(Date.now() - (daysAgo + extraDays) * 86400000).toISOString();
          expect(decayWeight(recent)).toBeGreaterThanOrEqual(decayWeight(older));
        },
      ),
    );
  });

  // Robustness: null returns fallback
  test("null always returns 0.5", () => {
    expect(decayWeight(null)).toBe(0.5);
  });

  // Invariant: future dates clamp to 1
  test("future dates always return 1", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 365 }),
        (daysAhead) => {
          const future = new Date(Date.now() + daysAhead * 86400000).toISOString();
          expect(decayWeight(future)).toBe(1);
        },
      ),
    );
  });
});

// ─── normalizeTag (property-based) ───

describe("normalizeTag (property-based)", () => {
  // Algebraic: idempotent
  test("normalizeTag is idempotent", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 50 }), (s) => {
        expect(normalizeTag(normalizeTag(s))).toBe(normalizeTag(s));
      }),
    );
  });

  // Invariant: output is always lowercase
  test("output is always lowercase", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 50 }), (s) => {
        const result = normalizeTag(s);
        expect(result).toBe(result.toLowerCase());
      }),
    );
  });

  // Invariant: output never has leading/trailing whitespace
  test("output is always trimmed", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 50 }), (s) => {
        const result = normalizeTag(s);
        expect(result).toBe(result.trim());
      }),
    );
  });

  // Invariant: output never contains spaces (replaced by hyphens)
  test("output never contains spaces", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 50 }), (s) => {
        const result = normalizeTag(s);
        expect(result).not.toMatch(/\s/);
      }),
    );
  });
});

// ─── normalizeTags (property-based) ───

describe("normalizeTags (property-based)", () => {
  // Algebraic: idempotent
  test("normalizeTags is idempotent", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 5 }),
        (tags) => {
          const input = tags.join(", ");
          expect(normalizeTags(normalizeTags(input))).toBe(normalizeTags(input));
        },
      ),
    );
  });

  // Invariant: output tag count <= input comma-separated tag count (dedup may reduce)
  test("output tag count <= input comma-split tag count", () => {
    fc.assert(
      fc.property(
        // Use strings without commas as individual tags to avoid false splits
        fc.array(
          fc.string({ minLength: 1, maxLength: 20 }).filter((s) => !s.includes(",")),
          { minLength: 1, maxLength: 10 },
        ),
        (tags) => {
          const input = tags.join(",");
          const outputTags = normalizeTags(input).split(",").filter((t) => t.trim());
          const inputNonEmpty = tags.filter((t) => t.trim().length > 0);
          expect(outputTags.length).toBeLessThanOrEqual(inputNonEmpty.length);
        },
      ),
    );
  });

  // Invariant: no duplicates in output
  test("output has no duplicate tags", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 10 }),
        (tags) => {
          const result = normalizeTags(tags.join(","));
          const outputTags = result.split(",").map((t) => t.trim()).filter((t) => t);
          expect(new Set(outputTags).size).toBe(outputTags.length);
        },
      ),
    );
  });

  // Metamorphic: reordering inputs may change output order but not content set
  test("output set is order-independent", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 2, maxLength: 5 }),
        (tags) => {
          const forward = normalizeTags(tags.join(","));
          const reversed = normalizeTags([...tags].reverse().join(","));
          const forwardSet = new Set(forward.split(",").map((t) => t.trim()));
          const reversedSet = new Set(reversed.split(",").map((t) => t.trim()));
          expect(forwardSet).toEqual(reversedSet);
        },
      ),
    );
  });
});

// ─── Content structuring (property-based) ───

describe("content structuring logic (property-based)", () => {
  // Test the content head/tail splitting logic from ai.ts
  function structureContent(content: string) {
    const head = content.slice(0, 500);
    const tail = content.length > 800 ? content.slice(-300) : "";
    return { head, tail, length: content.length };
  }

  // Invariant: head is always <= 500 chars
  test("head is always <= 500 chars", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 5000 }), (content) => {
        const { head } = structureContent(content);
        expect(head.length).toBeLessThanOrEqual(500);
      }),
    );
  });

  // Invariant: tail is empty for short content, 300 chars for long content
  test("tail is empty when content <= 800 chars", () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 800 }),
        (content) => {
          const { tail } = structureContent(content);
          expect(tail).toBe("");
        },
      ),
    );
  });

  test("tail is exactly 300 chars when content > 800 chars", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 801, maxLength: 5000 }),
        (content) => {
          const { tail } = structureContent(content);
          expect(tail.length).toBe(300);
        },
      ),
    );
  });

  // Invariant: head + tail never exceeds original
  test("head + tail length <= original content length", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 5000 }), (content) => {
        const { head, tail, length } = structureContent(content);
        expect(head.length + tail.length).toBeLessThanOrEqual(length);
      }),
    );
  });

  // Invariant: length always matches original
  test("length field equals original content length", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 5000 }), (content) => {
        expect(structureContent(content).length).toBe(content.length);
      }),
    );
  });
});

// ─── Blended score (property-based) ───

describe("blended briefing score (property-based)", () => {
  const MAX_AGE = 14 * 24 * 60 * 60 * 1000;

  function blendedScore(score: number, ageMs: number): number {
    const freshness = Math.max(0, 1 - ageMs / MAX_AGE);
    return 0.7 * score + 0.3 * freshness;
  }

  // Invariant: blended score is in [0, 1]
  test("blended score is always in [0, 1]", () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 1, noNaN: true }),
        fc.integer({ min: 0, max: MAX_AGE * 2 }),
        (score, ageMs) => {
          const b = blendedScore(score, ageMs);
          expect(b).toBeGreaterThanOrEqual(0);
          expect(b).toBeLessThanOrEqual(1);
        },
      ),
    );
  });

  // Algebraic: higher score → higher blended (with same age)
  test("higher curation score produces higher blended score at same age", () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: Math.fround(0.99), noNaN: true }),
        fc.float({ min: Math.fround(0.001), max: 1, noNaN: true }),
        fc.integer({ min: 0, max: MAX_AGE }),
        (scoreLow, delta, ageMs) => {
          const scoreHigh = Math.min(1, scoreLow + delta);
          if (scoreHigh > scoreLow) {
            expect(blendedScore(scoreHigh, ageMs)).toBeGreaterThan(blendedScore(scoreLow, ageMs));
          }
        },
      ),
    );
  });

  // Algebraic: fresher article → higher blended (with same score)
  test("fresher article produces higher blended score at same curation score", () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 1, noNaN: true }),
        fc.integer({ min: 0, max: MAX_AGE }),
        fc.integer({ min: 1, max: MAX_AGE }),
        (score, ageMs, extraAge) => {
          expect(blendedScore(score, ageMs)).toBeGreaterThanOrEqual(
            blendedScore(score, ageMs + extraAge),
          );
        },
      ),
    );
  });

  // Boundary: age beyond maxAge yields freshness = 0, so blended = 0.7 * score
  test("age beyond maxAge gives blended = 0.7 * score", () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 1, noNaN: true }),
        fc.integer({ min: MAX_AGE, max: MAX_AGE * 3 }),
        (score, ageMs) => {
          expect(blendedScore(score, ageMs)).toBeCloseTo(0.7 * score, 5);
        },
      ),
    );
  });
});
