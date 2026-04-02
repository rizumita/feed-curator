import { createServer } from "http";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { db } from "./db";
import type { Article, Feed } from "./types";
import { renderPage } from "./web/html";
import { getAutoArchiveDays, runAutoArchive, getBriefing, getTodayBriefing } from "./article";
import { aiDiscoverFeeds, registerDiscoveredFeed } from "./ai";

const __dirname = dirname(fileURLToPath(import.meta.url));

type ArticleWithFeed = Article & { feed_title: string | null; category: string | null };

function getCuratedArticles(sort: "newest" | "score" = "newest", view: "active" | "archive" = "active"): ArticleWithFeed[] {
  const order = sort === "score" ? "a.score DESC" : "a.published_at DESC, a.fetched_at DESC";
  const whereClause = view === "archive"
    ? "WHERE a.curated_at IS NOT NULL AND (a.dismissed_at IS NOT NULL OR a.archived_at IS NOT NULL)"
    : "WHERE a.curated_at IS NOT NULL AND a.dismissed_at IS NULL AND a.archived_at IS NULL";
  return db
    .prepare(
      `SELECT a.*, f.title as feed_title, f.category
       FROM articles a
       LEFT JOIN feeds f ON a.feed_id = f.id
       ${whereClause}
       ORDER BY ${order}`
    )
    .all() as ArticleWithFeed[];
}

function getFeeds(): Feed[] {
  return db.prepare("SELECT * FROM feeds ORDER BY created_at DESC").all() as Feed[];
}

function getStats(): { total: number; curated: number; unread: number; feeds: number; archived: number } {
  const total = (db.prepare("SELECT COUNT(*) as n FROM articles").get() as any)?.n ?? 0;
  const curated = (
    db.prepare("SELECT COUNT(*) as n FROM articles WHERE curated_at IS NOT NULL").get() as any
  ).n;
  const unread = (
    db.prepare("SELECT COUNT(*) as n FROM articles WHERE curated_at IS NOT NULL AND read_at IS NULL AND dismissed_at IS NULL AND archived_at IS NULL").get() as any
  ).n;
  const feeds = (db.prepare("SELECT COUNT(*) as n FROM feeds").get() as any)?.n ?? 0;
  const archived = (
    db.prepare("SELECT COUNT(*) as n FROM articles WHERE curated_at IS NOT NULL AND (dismissed_at IS NOT NULL OR archived_at IS NOT NULL)").get() as any
  ).n;
  return { total, curated, unread, feeds, archived };
}

function toggleRead(id: number): boolean {
  const article = db.prepare("SELECT read_at FROM articles WHERE id = ?").get(id) as { read_at: string | null } | null;
  if (!article) return false;
  if (article.read_at) {
    db.prepare("UPDATE articles SET read_at = NULL WHERE id = ?").run(id);
  } else {
    db.prepare("UPDATE articles SET read_at = datetime('now') WHERE id = ?").run(id);
  }
  return true;
}

function jsonResponse(res: import("http").ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function readBody(req: import("http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => { data += chunk.toString(); });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export function startServer(port: number = 3000): void {
  const stylesPath = join(__dirname, "web", "styles.css");
  const scriptsPath = join(__dirname, "web", "scripts.js");

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const method = req.method ?? "GET";

    try {
      if (url.pathname === "/styles.css") {
        const css = readFileSync(stylesPath, "utf-8");
        res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
        res.end(css);
        return;
      }

      if (url.pathname === "/scripts.js") {
        const js = readFileSync(scriptsPath, "utf-8");
        res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
        res.end(js);
        return;
      }

      if (url.pathname === "/api/articles") {
        jsonResponse(res, getCuratedArticles());
        return;
      }

      if (url.pathname === "/api/feeds") {
        jsonResponse(res, getFeeds());
        return;
      }

      const readMatch = url.pathname.match(/^\/api\/read\/(\d+)$/);
      if (readMatch && method === "POST") {
        toggleRead(Number(readMatch[1]));
        jsonResponse(res, { ok: true });
        return;
      }

      if (url.pathname === "/api/read-batch" && method === "POST") {
        let body: any;
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          jsonResponse(res, { error: "Invalid JSON" }, 400);
          return;
        }
        const { ids } = body as { ids: unknown };
        if (!Array.isArray(ids) || ids.length > 1000) {
          jsonResponse(res, { error: "ids must be an array with at most 1000 elements" }, 400);
          return;
        }
        for (const id of ids) {
          db.prepare("UPDATE articles SET read_at = datetime('now') WHERE id = ? AND read_at IS NULL").run(id);
        }
        jsonResponse(res, { ok: true, count: ids.length });
        return;
      }

      // GET /api/briefing
      if (url.pathname === "/api/briefing") {
        const date = url.searchParams.get("date");
        const briefing = date ? getBriefing(date) : getTodayBriefing();
        jsonResponse(res, briefing);
        return;
      }

      // POST /api/dismiss/:id
      const dismissMatch = url.pathname.match(/^\/api\/dismiss\/(\d+)$/);
      if (dismissMatch && method === "POST") {
        db.prepare("UPDATE articles SET dismissed_at = datetime('now') WHERE id = ? AND dismissed_at IS NULL").run(Number(dismissMatch[1]));
        jsonResponse(res, { ok: true });
        return;
      }

      // POST /api/dismiss-batch
      if (url.pathname === "/api/dismiss-batch" && method === "POST") {
        let body: any;
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          jsonResponse(res, { error: "Invalid JSON" }, 400);
          return;
        }
        const { ids } = body as { ids: unknown };
        if (!Array.isArray(ids) || ids.length > 1000) {
          jsonResponse(res, { error: "ids must be an array with at most 1000 elements" }, 400);
          return;
        }
        const placeholders = ids.map(() => "?").join(",");
        db.prepare(`UPDATE articles SET dismissed_at = datetime('now') WHERE id IN (${placeholders}) AND dismissed_at IS NULL`).run(...ids);
        jsonResponse(res, { ok: true, count: ids.length });
        return;
      }

      // POST /api/discover — discover feeds by topic
      if (url.pathname === "/api/discover" && method === "POST") {
        let body: any;
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          jsonResponse(res, { error: "Invalid JSON" }, 400);
          return;
        }
        const { topic } = body as { topic: unknown };
        if (typeof topic !== "string" || !topic.trim()) {
          jsonResponse(res, { error: "topic is required" }, 400);
          return;
        }
        const feeds = await aiDiscoverFeeds(topic.trim());
        jsonResponse(res, { feeds });
        return;
      }

      // POST /api/discover/register — register a discovered feed
      if (url.pathname === "/api/discover/register" && method === "POST") {
        let body: any;
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          jsonResponse(res, { error: "Invalid JSON" }, 400);
          return;
        }
        const { url: feedUrl, category } = body as { url: unknown; category: unknown };
        if (typeof feedUrl !== "string" || !feedUrl.trim()) {
          jsonResponse(res, { error: "url is required" }, 400);
          return;
        }
        const added = registerDiscoveredFeed(feedUrl.trim(), typeof category === "string" ? category : undefined);
        jsonResponse(res, { ok: true, added });
        return;
      }

      if (url.pathname === "/") {
        const archiveDays = getAutoArchiveDays();
        runAutoArchive(archiveDays);
        const sort = url.searchParams.get("sort") === "score" ? "score" : "newest";
        const view = url.searchParams.get("view") === "archive" ? "archive" :
                     url.searchParams.get("view") === "all" ? "all" : "briefing";
        const articles = getCuratedArticles(sort, view === "archive" ? "archive" : "active");
        const stats = getStats();
        const briefing = view === "briefing" ? getTodayBriefing() : null;
        const effectiveView = (view === "briefing" && !briefing) ? "all" : view;
        const html = renderPage(articles, stats, sort, effectiveView, briefing);
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'",
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "DENY",
        });
        res.end(html);
        return;
      }

      res.writeHead(404);
      res.end("Not Found");
    } catch (err) {
      console.error("Server error:", err);
      res.writeHead(500);
      res.end("Internal Server Error");
    }
  });

  server.listen(port, () => {
    console.log(`Feed Curator running at http://localhost:${port}`);
  });
}
