import { db } from "./db";
import type { Article, Feed } from "./types";
import { renderPage } from "./web/html";
import { getAutoArchiveDays, runAutoArchive } from "./article";

type ArticleWithFeed = Article & { feed_title: string | null; category: string | null };

function getCuratedArticles(sort: "newest" | "score" = "newest", view: "active" | "archive" = "active"): ArticleWithFeed[] {
  const order = sort === "score" ? "a.score DESC" : "a.published_at DESC, a.fetched_at DESC";
  const whereClause = view === "archive"
    ? "WHERE a.curated_at IS NOT NULL AND (a.dismissed_at IS NOT NULL OR a.archived_at IS NOT NULL)"
    : "WHERE a.curated_at IS NOT NULL AND a.dismissed_at IS NULL AND a.archived_at IS NULL";
  return db
    .query(
      `SELECT a.*, f.title as feed_title, f.category
       FROM articles a
       LEFT JOIN feeds f ON a.feed_id = f.id
       ${whereClause}
       ORDER BY ${order}`
    )
    .all() as ArticleWithFeed[];
}

function getFeeds(): Feed[] {
  return db.query("SELECT * FROM feeds ORDER BY created_at DESC").all() as Feed[];
}

function getStats(): { total: number; curated: number; unread: number; feeds: number; archived: number } {
  const total = (db.query("SELECT COUNT(*) as n FROM articles").get() as any).n;
  const curated = (
    db.query("SELECT COUNT(*) as n FROM articles WHERE curated_at IS NOT NULL").get() as any
  ).n;
  const unread = (
    db.query("SELECT COUNT(*) as n FROM articles WHERE curated_at IS NOT NULL AND read_at IS NULL AND dismissed_at IS NULL AND archived_at IS NULL").get() as any
  ).n;
  const feeds = (db.query("SELECT COUNT(*) as n FROM feeds").get() as any).n;
  const archived = (
    db.query("SELECT COUNT(*) as n FROM articles WHERE curated_at IS NOT NULL AND (dismissed_at IS NOT NULL OR archived_at IS NOT NULL)").get() as any
  ).n;
  return { total, curated, unread, feeds, archived };
}

function toggleRead(id: number): boolean {
  const article = db.query("SELECT read_at FROM articles WHERE id = ?").get(id) as { read_at: string | null } | null;
  if (!article) return false;
  if (article.read_at) {
    db.run("UPDATE articles SET read_at = NULL WHERE id = ?", [id]);
  } else {
    db.run("UPDATE articles SET read_at = datetime('now') WHERE id = ?", [id]);
  }
  return true;
}

const STYLES_PATH = new URL("./web/styles.css", import.meta.url).pathname;
const SCRIPTS_PATH = new URL("./web/scripts.js", import.meta.url).pathname;

export function startServer(port: number = 3000): void {
  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/styles.css") {
        return new Response(Bun.file(STYLES_PATH), {
          headers: { "Content-Type": "text/css; charset=utf-8" },
        });
      }

      if (url.pathname === "/scripts.js") {
        return new Response(Bun.file(SCRIPTS_PATH), {
          headers: { "Content-Type": "application/javascript; charset=utf-8" },
        });
      }

      if (url.pathname === "/api/articles") {
        return Response.json(getCuratedArticles());
      }

      if (url.pathname === "/api/feeds") {
        return Response.json(getFeeds());
      }

      const readMatch = url.pathname.match(/^\/api\/read\/(\d+)$/);
      if (readMatch && req.method === "POST") {
        toggleRead(Number(readMatch[1]));
        return Response.json({ ok: true });
      }

      if (url.pathname === "/api/read-batch" && req.method === "POST") {
        let body: any;
        try {
          body = await req.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }
        const { ids } = body as { ids: unknown };
        if (!Array.isArray(ids) || ids.length > 1000) {
          return Response.json({ error: "ids must be an array with at most 1000 elements" }, { status: 400 });
        }
        for (const id of ids) {
          db.run("UPDATE articles SET read_at = datetime('now') WHERE id = ? AND read_at IS NULL", [id]);
        }
        return Response.json({ ok: true, count: ids.length });
      }

      // POST /api/dismiss/:id
      const dismissMatch = url.pathname.match(/^\/api\/dismiss\/(\d+)$/);
      if (dismissMatch && req.method === "POST") {
        db.run("UPDATE articles SET dismissed_at = datetime('now') WHERE id = ? AND dismissed_at IS NULL", [Number(dismissMatch[1])]);
        return Response.json({ ok: true });
      }

      // POST /api/dismiss-batch
      if (url.pathname === "/api/dismiss-batch" && req.method === "POST") {
        let body: any;
        try {
          body = await req.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }
        const { ids } = body as { ids: unknown };
        if (!Array.isArray(ids) || ids.length > 1000) {
          return Response.json({ error: "ids must be an array with at most 1000 elements" }, { status: 400 });
        }
        const placeholders = ids.map(() => "?").join(",");
        db.run(`UPDATE articles SET dismissed_at = datetime('now') WHERE id IN (${placeholders}) AND dismissed_at IS NULL`, ids);
        return Response.json({ ok: true, count: ids.length });
      }

      if (url.pathname === "/") {
        const archiveDays = getAutoArchiveDays();
        runAutoArchive(archiveDays);
        const sort = url.searchParams.get("sort") === "score" ? "score" : "newest";
        const view = url.searchParams.get("view") === "archive" ? "archive" : "active";
        const articles = getCuratedArticles(sort, view);
        const stats = getStats();
        return new Response(renderPage(articles, stats, sort, view), {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'",
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
          },
        });
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  console.log(`Feed Curator running at http://localhost:${server.port}`);
}
