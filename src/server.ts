import { db } from "./db";
import type { Article, Feed } from "./types";
import { renderPage } from "./web/html";

type ArticleWithFeed = Article & { feed_title: string | null; category: string | null };

function getCuratedArticles(sort: "newest" | "score" = "newest"): ArticleWithFeed[] {
  const order = sort === "score" ? "a.score DESC" : "a.published_at DESC, a.fetched_at DESC";
  return db
    .query(
      `SELECT a.*, f.title as feed_title, f.category
       FROM articles a
       LEFT JOIN feeds f ON a.feed_id = f.id
       WHERE a.curated_at IS NOT NULL
       ORDER BY ${order}`
    )
    .all() as ArticleWithFeed[];
}

function getFeeds(): Feed[] {
  return db.query("SELECT * FROM feeds ORDER BY created_at DESC").all() as Feed[];
}

function getStats(): { total: number; curated: number; unread: number; feeds: number } {
  const total = (db.query("SELECT COUNT(*) as n FROM articles").get() as any).n;
  const curated = (
    db.query("SELECT COUNT(*) as n FROM articles WHERE curated_at IS NOT NULL").get() as any
  ).n;
  const unread = (
    db.query("SELECT COUNT(*) as n FROM articles WHERE curated_at IS NOT NULL AND read_at IS NULL").get() as any
  ).n;
  const feeds = (db.query("SELECT COUNT(*) as n FROM feeds").get() as any).n;
  return { total, curated, unread, feeds };
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
        const { ids } = await req.json() as { ids: number[] };
        for (const id of ids) {
          db.run("UPDATE articles SET read_at = datetime('now') WHERE id = ? AND read_at IS NULL", [id]);
        }
        return Response.json({ ok: true, count: ids.length });
      }

      if (url.pathname === "/") {
        const sort = url.searchParams.get("sort") === "score" ? "score" : "newest";
        const articles = getCuratedArticles(sort);
        const stats = getStats();
        return new Response(renderPage(articles, stats, sort), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  console.log(`Feed Curator running at http://localhost:${server.port}`);
}
