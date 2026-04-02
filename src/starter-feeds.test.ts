import { describe, expect, test, beforeEach, afterAll } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { db } from "./db";
import { loadStarterFeeds, getAllFeeds } from "./feed";

const tmpDir = join(import.meta.dirname!, "__test_tmp__");

function clearFeeds(): void {
  db.prepare("DELETE FROM articles").run();
  db.prepare("DELETE FROM feeds").run();
}

function writeTmpJson(filename: string, content: unknown): string {
  mkdirSync(tmpDir, { recursive: true });
  const path = join(tmpDir, filename);
  writeFileSync(path, JSON.stringify(content), "utf-8");
  return path;
}

describe("loadStarterFeeds", () => {
  beforeEach(() => {
    clearFeeds();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("loads feeds from a custom JSON file", () => {
    const path = writeTmpJson("feeds.json", {
      feeds: [
        { url: "https://a.com/rss", category: "Cat1" },
        { url: "https://b.com/rss", category: "Cat2" },
      ],
    });

    const count = loadStarterFeeds(path);
    expect(count).toBe(2);
    const feeds = getAllFeeds();
    expect(feeds.some((f) => f.url === "https://a.com/rss" && f.category === "Cat1")).toBe(true);
    expect(feeds.some((f) => f.url === "https://b.com/rss" && f.category === "Cat2")).toBe(true);
  });

  test("skips duplicate feeds and returns correct count", () => {
    const path = writeTmpJson("feeds.json", {
      feeds: [
        { url: "https://a.com/rss", category: "Cat1" },
        { url: "https://b.com/rss" },
      ],
    });

    loadStarterFeeds(path);
    const count = loadStarterFeeds(path);
    expect(count).toBe(0);
  });

  test("throws on missing file", () => {
    expect(() => loadStarterFeeds("/nonexistent/feeds.json")).toThrow("Failed to read feed pack");
  });

  test("throws on invalid JSON", () => {
    mkdirSync(tmpDir, { recursive: true });
    const path = join(tmpDir, "bad.json");
    writeFileSync(path, "not json", "utf-8");
    expect(() => loadStarterFeeds(path)).toThrow("Failed to read feed pack");
  });

  test("throws on missing feeds array", () => {
    const path = writeTmpJson("no-feeds.json", { name: "oops" });
    expect(() => loadStarterFeeds(path)).toThrow("Invalid feed pack format");
  });
});
