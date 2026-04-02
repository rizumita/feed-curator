import { describe, expect, test } from "bun:test";
import { formatProfile, profileForPrompt, type UserProfile } from "./profile";

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    totalCurated: 20,
    totalRead: 10,
    overallReadRate: 0.5,
    preferredTags: [],
    ignoredTags: [],
    feedStats: [],
    scoreBands: [
      { band: "0.85-1.0 (Must Read)", total: 5, read: 4, readRate: 0.8 },
      { band: "0.70-0.84 (Recommended)", total: 5, read: 3, readRate: 0.6 },
      { band: "0.50-0.69 (Worth a Look)", total: 5, read: 2, readRate: 0.4 },
      { band: "0.00-0.49 (Low Priority)", total: 5, read: 1, readRate: 0.2 },
    ],
    ...overrides,
  };
}

// ─── formatProfile ───

describe("formatProfile", () => {
  test("shows total counts and read rate", () => {
    const out = formatProfile(makeProfile());
    expect(out).toContain("20 curated, 10 read (50%)");
  });

  test("shows score bands", () => {
    const out = formatProfile(makeProfile());
    expect(out).toContain("0.85-1.0 (Must Read): 4/5 read (80%)");
    expect(out).toContain("0.00-0.49 (Low Priority): 1/5 read (20%)");
  });

  test("shows preferred tags when present", () => {
    const out = formatProfile(
      makeProfile({
        preferredTags: [{ tag: "ai", total: 5, read: 4, readRate: 0.8 }],
      })
    );
    expect(out).toContain("Preferred Tags");
    expect(out).toContain("ai: 4/5 (80%)");
  });

  test("omits preferred tags section when empty", () => {
    const out = formatProfile(makeProfile());
    expect(out).not.toContain("Preferred Tags");
  });

  test("shows ignored tags when present", () => {
    const out = formatProfile(
      makeProfile({
        ignoredTags: [{ tag: "enterprise", total: 5, read: 0, readRate: 0 }],
      })
    );
    expect(out).toContain("Ignored Tags");
    expect(out).toContain("enterprise: 0/5 (0%)");
  });

  test("shows feed engagement", () => {
    const out = formatProfile(
      makeProfile({
        feedStats: [
          { feed_id: 1, title: "TechBlog", category: "Tech", total: 10, read: 8, readRate: 0.8 },
        ],
      })
    );
    expect(out).toContain("TechBlog [Tech]: 8/10 (80%)");
  });

  test("uses fallback name for feed without title", () => {
    const out = formatProfile(
      makeProfile({
        feedStats: [
          { feed_id: 42, title: "", category: null, total: 5, read: 2, readRate: 0.4 },
        ],
      })
    );
    expect(out).toContain("Feed 42: 2/5 (40%)");
  });

  test("handles zero curated (0%)", () => {
    const out = formatProfile(
      makeProfile({ totalCurated: 0, totalRead: 0, overallReadRate: 0 })
    );
    expect(out).toContain("0 curated, 0 read (0%)");
  });
});

// ─── profileForPrompt ───

describe("profileForPrompt", () => {
  test("includes overall read rate", () => {
    const out = profileForPrompt(makeProfile());
    expect(out).toContain("Overall read rate: 50%");
  });

  test("includes preferred tags", () => {
    const out = profileForPrompt(
      makeProfile({
        preferredTags: [
          { tag: "ai", total: 5, read: 4, readRate: 0.8 },
          { tag: "tools", total: 4, read: 3, readRate: 0.75 },
        ],
      })
    );
    expect(out).toContain("Preferred tags (reads often): ai, tools");
  });

  test("includes ignored tags", () => {
    const out = profileForPrompt(
      makeProfile({
        ignoredTags: [{ tag: "enterprise", total: 5, read: 0, readRate: 0 }],
      })
    );
    expect(out).toContain("Ignored tags (rarely reads): enterprise");
  });

  test("includes preferred sources above average", () => {
    const out = profileForPrompt(
      makeProfile({
        overallReadRate: 0.5,
        feedStats: [
          { feed_id: 1, title: "TopBlog", category: null, total: 10, read: 8, readRate: 0.8 },
          { feed_id: 2, title: "LowBlog", category: null, total: 10, read: 2, readRate: 0.2 },
        ],
      })
    );
    expect(out).toContain("Preferred sources: TopBlog");
    expect(out).not.toContain("LowBlog");
  });

  test("omits sections when no data", () => {
    const out = profileForPrompt(makeProfile());
    expect(out).not.toContain("Preferred tags");
    expect(out).not.toContain("Ignored tags");
    expect(out).not.toContain("Preferred sources");
  });

  test("always includes score adjustment instruction", () => {
    const out = profileForPrompt(makeProfile());
    expect(out).toContain("Adjust scores accordingly");
  });
});
