import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { escapeHtml, getTier } from "./web/html";
import { decodeEntities, textOf, stripHtml } from "./rss";

// ─── escapeHtml ───

describe("escapeHtml (property-based)", () => {
  test("output never contains unescaped HTML special characters", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const escaped = escapeHtml(s);
        const ampPositions = [...escaped.matchAll(/&/g)];
        for (const match of ampPositions) {
          const rest = escaped.slice(match.index!);
          const startsEntity =
            rest.startsWith("&amp;") ||
            rest.startsWith("&lt;") ||
            rest.startsWith("&gt;") ||
            rest.startsWith("&quot;") ||
            rest.startsWith("&#x27;");
          expect(startsEntity).toBe(true);
        }
      }),
    );
  });

  test("output length >= input length", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(escapeHtml(s).length).toBeGreaterThanOrEqual(s.length);
      }),
    );
  });

  test("strings without special chars pass through unchanged", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !/[<>&"']/.test(s)),
        (s) => {
          expect(escapeHtml(s)).toBe(s);
        },
      ),
    );
  });
});

// ─── getTier ───

describe("getTier (property-based)", () => {
  test("every score in [0,1] maps to a tier with all required fields", () => {
    fc.assert(
      fc.property(fc.float({ min: 0, max: 1, noNaN: true }), (score) => {
        const tier = getTier(score);
        expect(tier).toHaveProperty("id");
        expect(tier).toHaveProperty("label");
        expect(tier).toHaveProperty("color");
        expect(tier).toHaveProperty("min");
        expect(tier).toHaveProperty("max");
      }),
    );
  });

  test("score >= 0.85 maps to must-read", () => {
    fc.assert(
      fc.property(fc.float({ min: Math.fround(0.85), max: 1, noNaN: true }), (score) => {
        expect(getTier(score).id).toBe("must-read");
      }),
    );
  });

  test("score < 0.5 maps to low-priority", () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: Math.fround(0.5), noNaN: true }).filter((n) => n < 0.5),
        (score) => {
          expect(getTier(score).id).toBe("low-priority");
        },
      ),
    );
  });

  test("score falls within tier's [min, max]", () => {
    fc.assert(
      fc.property(fc.float({ min: 0, max: 1, noNaN: true }), (score) => {
        const tier = getTier(score);
        expect(score).toBeGreaterThanOrEqual(tier.min);
        expect(score).toBeLessThanOrEqual(tier.max);
      }),
    );
  });
});

// ─── decodeEntities ───

describe("decodeEntities (property-based)", () => {
  test("plain ASCII without & passes through unchanged", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !s.includes("&")),
        (s) => {
          expect(decodeEntities(s)).toBe(s);
        },
      ),
    );
  });

  test("decoded text length <= input length", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(decodeEntities(s).length).toBeLessThanOrEqual(s.length);
      }),
    );
  });

  test("known entities produce shorter output", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("&amp;", "&lt;", "&gt;", "&quot;", "&#x27;", "&#65;", "&#x41;"),
        (entity) => {
          expect(decodeEntities(entity).length).toBeLessThan(entity.length);
        },
      ),
    );
  });
});

// ─── textOf ───

describe("textOf (property-based)", () => {
  test("always returns a string for typical RSS values", () => {
    // textOf handles: string, number, {#text: string}, null, undefined
    // Objects with non-string #text or _ fields may return non-strings (known limitation)
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.integer(), fc.constant(null), fc.constant(undefined),
          fc.record({ "#text": fc.string() })),
        (val) => {
          expect(typeof textOf(val)).toBe("string");
        },
      ),
    );
  });

  test("string input returns same string", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(textOf(s)).toBe(s);
      }),
    );
  });

  test("number input returns its string representation", () => {
    fc.assert(
      fc.property(fc.integer(), (n) => {
        expect(textOf(n)).toBe(String(n));
      }),
    );
  });

  test("null and undefined return empty string", () => {
    expect(textOf(null)).toBe("");
    expect(textOf(undefined)).toBe("");
  });
});

// ─── stripHtml ───

describe("stripHtml (property-based)", () => {
  test("output never contains HTML tags", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(stripHtml(s)).not.toMatch(/<[^>]+>/);
      }),
    );
  });

  test("output length <= input length", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(stripHtml(s).length).toBeLessThanOrEqual(s.length);
      }),
    );
  });

  test("wrapping in tags and stripping recovers content", () => {
    fc.assert(
      fc.property(
        // Exclude chars that stripHtml/decodeEntities would transform, and strings that trim changes
        fc.string().filter((s) => s.trim().length > 0 && s === s.trim() && !/[<>&"']/.test(s)),
        (content) => {
          expect(stripHtml(`<p>${content}</p>`)).toBe(content);
        },
      ),
    );
  });
});
