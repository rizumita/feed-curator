import { createServer } from "http";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { renderPage } from "./web/html";
import { getAutoArchiveDays, runAutoArchive, getBriefing, getTodayBriefing, getCuratedArticles, getActiveArticles, getStats, toggleRead, markAsRead, dismissArticle, dismissArticles, getConfig, setConfig, isPreferenceMemoStale } from "./article";
import { aiDiscoverFeeds, aiCurate, aiBriefing, aiGenerateMemo } from "./ai";
import { addFeed, fetchAllFeeds, listFeeds, removeFeed } from "./feed";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

function sseHandler(
  res: import("http").ServerResponse,
  action: (send: (msg: string) => void) => Promise<Record<string, unknown>>,
): void {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
  const send = (msg: string) => { res.write(`data: ${JSON.stringify({ message: msg })}\n\n`); };
  action(send)
    .then((result) => { res.write(`data: ${JSON.stringify({ done: true, ...result })}\n\n`); })
    .catch((e: unknown) => { const msg = e instanceof Error ? e.message : String(e); res.write(`data: ${JSON.stringify({ error: msg })}\n\n`); })
    .finally(() => { res.end(); });
}

export function startServer(port: number = 3000): import("http").Server {
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
        jsonResponse(res, listFeeds());
        return;
      }

      const readMatch = url.pathname.match(/^\/api\/read\/(\d+)$/);
      if (readMatch && method === "POST") {
        const found = toggleRead(Number(readMatch[1]));
        jsonResponse(res, { ok: found });
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
        const validIds = ids.filter((id: unknown) => typeof id === "number" && Number.isInteger(id) && id > 0);
        for (const id of validIds) {
          markAsRead(id);
        }
        jsonResponse(res, { ok: true, count: validIds.length });
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
        dismissArticle(Number(dismissMatch[1]));
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
        const validIds = ids.filter((id: unknown) => typeof id === "number" && Number.isInteger(id) && id > 0);
        if (validIds.length === 0) {
          jsonResponse(res, { ok: true, count: 0 });
          return;
        }
        dismissArticles(validIds);
        jsonResponse(res, { ok: true, count: validIds.length });
        return;
      }

      // POST /api/update — fetch → curate (new only) → briefing in sequence (SSE)
      if (url.pathname === "/api/update" && method === "POST") {
        sseHandler(res, async (send) => {
          // 1. Fetch
          send("Fetching feeds...");
          const newArticles = await fetchAllFeeds({ onProgress: send });
          send(`Fetched ${newArticles} new article(s).`);

          // 1.5. Regenerate preference memo if stale
          if (isPreferenceMemoStale()) {
            await aiGenerateMemo(send);
          }

          // 2. Curate uncurated articles
          send("AI curating articles...");
          const curated = await aiCurate(send);
          if (curated > 0) {
            send(`Curated ${curated} article(s).`);
          } else {
            send("No articles to curate.");
          }

          // 3. Briefing
          send("Generating briefing...");
          const ok = await aiBriefing(send);

          // 4. Auto-archive
          const archiveDays = getAutoArchiveDays();
          const archived = runAutoArchive(archiveDays);
          if (archived > 0) send(`Auto-archived ${archived} old article(s).`);

          return { newArticles, curated, briefing: ok };
        });
        return;
      }

      // POST /api/fetch — fetch only (SSE)
      if (url.pathname === "/api/fetch" && method === "POST") {
        sseHandler(res, async (send) => {
          send("Starting feed fetch...");
          const newArticles = await fetchAllFeeds({ onProgress: send });
          return { newArticles };
        });
        return;
      }

      // POST /api/curate — AI-curate uncurated articles (SSE)
      if (url.pathname === "/api/curate" && method === "POST") {
        sseHandler(res, async (send) => {
          send("Starting AI curation...");
          const curated = await aiCurate(send);
          return { curated };
        });
        return;
      }

      // POST /api/briefing/generate — generate today's briefing (SSE)
      if (url.pathname === "/api/briefing/generate" && method === "POST") {
        sseHandler(res, async (send) => {
          send("Starting briefing generation...");
          const ok = await aiBriefing(send);
          return { ok };
        });
        return;
      }

      // POST /api/discover — discover feeds by topic (SSE)
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
        sseHandler(res, async (send) => {
          const feeds = await aiDiscoverFeeds(topic.trim(), send);
          return { feeds };
        });
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
        if (!/^https?:\/\//i.test(feedUrl.trim())) {
          jsonResponse(res, { error: "url must start with http:// or https://" }, 400);
          return;
        }
        const added = addFeed(feedUrl.trim(), undefined, typeof category === "string" ? category : undefined);
        jsonResponse(res, { ok: true, added });
        return;
      }

      // POST /api/config/language — set language
      if (url.pathname === "/api/config/language" && method === "POST") {
        let body: any;
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          jsonResponse(res, { error: "Invalid JSON" }, 400);
          return;
        }
        const { language } = body as { language: unknown };
        if (typeof language !== "string" || !language.trim()) {
          jsonResponse(res, { error: "language is required" }, 400);
          return;
        }
        setConfig("language", language.trim());
        jsonResponse(res, { ok: true, language: language.trim() });
        return;
      }

      // DELETE /api/feeds/:id — remove a feed
      const feedDeleteMatch = url.pathname.match(/^\/api\/feeds\/(\d+)$/);
      if (feedDeleteMatch && method === "DELETE") {
        const feedId = Number(feedDeleteMatch[1]);
        removeFeed(feedId);
        jsonResponse(res, { ok: true });
        return;
      }

      if (url.pathname === "/") {
        const archiveDays = getAutoArchiveDays();
        runAutoArchive(archiveDays);
        const sort = url.searchParams.get("sort") === "score" ? "score" : "newest";
        const viewParam = url.searchParams.get("view");
        const view = viewParam === "feeds" ? "feeds" :
                     viewParam === "archive" ? "archive" :
                     viewParam === "all" ? "all" : "briefing";
        const articles = view === "feeds" ? []
          : view === "all" ? getActiveArticles(sort)
          : getCuratedArticles(sort, view === "archive" ? "archive" : "active");
        const stats = getStats();
        const briefing = view === "briefing" ? getTodayBriefing() : null;
        const effectiveView = (view === "briefing" && !briefing) ? "all" : view;
        const language = getConfig("language");
        const allFeeds = view === "feeds" ? listFeeds() : undefined;
        const html = renderPage(articles, stats, sort, effectiveView, briefing, language, allFeeds);
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'",
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "DENY",
        });
        res.end(html);
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
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

  return server;
}
