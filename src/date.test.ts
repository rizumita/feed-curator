import { describe, expect, test } from "vitest";
import { getLocalDateKey, getUtcDateKey } from "./date";

describe("date keys", () => {
  test("uses local calendar date for the local date key", () => {
    const date = new Date(2026, 3, 7, 0, 30, 0);
    expect(getLocalDateKey(date)).toBe("2026-04-07");
  });

  test("uses UTC calendar date for the legacy UTC date key", () => {
    const date = new Date("2026-04-07T00:30:00+09:00");
    expect(getUtcDateKey(date)).toBe("2026-04-06");
  });
});
