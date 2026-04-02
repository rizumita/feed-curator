import { createServer } from "http";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { renderPage } from "./web/html";
import { getCuratedArticles, getActiveArticles, getStats, toggleRead, markAsRead, dismissArticle, dismissArticles } from "./article";
import { getBriefing, getTodayBriefing } from "./briefing-data";
import { getConfig, setConfig, getAutoArchiveDays, runAutoArchive } from "./config";
import { isPreferenceMemoStale } from "./preferences";
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
      if (url.pathname === "/favicon.svg") {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 441 374"><g fill="#7c3aed"><path d="M1670 3734c-251-11-475-27-616-44-517-63-923-175-912-253 13-89 465-212 968-262 421-41 1025-53 1420-26 670 44 1282 173 1340 281 46 87-420 206-1015 260-347 31-964 54-1185 44z" transform="translate(0,374) scale(.1,-.1)"/><path d="M4015 3314c-22-13-89-45-150-71-382-162-888-277-1480-335-172-17-836-17-1010 0-562 54-1008 178-1312 363-35 21-63 36-63 34 0-6 278-535 441-839 112-208 225-300 419-340 78-16 240-26 240-15 0 4-31 82-70 175s-68 169-67 170c1 1 40-4 87-12 237-38 712-43 1050-9 567 56 1147 176 1429 296 173 74 275 156 360 288 51 81 181 306 181 316 0 9-14 4-55-21z" transform="translate(0,374) scale(.1,-.1)"/><path d="M3270 2480c-274-34-539-108-990-277-325-121-465-164-700-212-226-46-479-52-655-16-69 14-194 53-259 80-15 7-5-19 41-106 33-63 102-196 152-295 51-100 108-200 127-222 105-123 346-143 674-56 321 84 591 222 974 497 226 163 300 210 401 259 405 194 791 50 941-352 26-70 28-85 29-230 0-144-2-160-28-233-15-43-44-105-65-137l-37-59 0 147c0 207-35 321-139 459-99 130-300 243-434 243-24 0-37-14-97-107-39-58-71-110-73-115-2-4 12-8 31-8 47 0 160-35 229-72 31-17 84-58 116-92 105-109 155-241 155-406 1-151-45-265-144-362-212-207-572-191-774 34-56 62-120 192-134 272-13 71-14 216-2 269 5 20 6 37 2 37-4 0-137-41-297-90-337-106-518-153-665-175-196-28-383-15-495 35-24 10-44 17-44 16 0-8 346-653 453-846 116-208 214-299 367-340 103-28 286-8 384 42 63 31 466 272 466 278 0 3-17 14-37 25-96 51-224 176-288 280-16 25-11 23 31-16 112-104 268-189 424-229 118-31 366-39 500-16 472 82 844 429 966 901 26 99 28 126 28 270 0 131-4 176-22 248-81 326-323 575-637 658-92 24-348 34-475 19z" transform="translate(0,374) scale(.1,-.1)"/><path d="M2920 1450c-44-66-80-122-80-125 0-3 24-5 54-5 30 0 84-9 122-21 56-17 77-31 125-78 46-46 61-70 74-116 24-82 17-159-23-236-18-34-30-64-28-66 2-2 34 1 70 8 166 29 255 172 227 369-26 191-168 345-351 380-106 20-101 23-190-110z" transform="translate(0,374) scale(.1,-.1)"/></g></svg>`;
        res.writeHead(200, {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "public, max-age=86400",
        });
        res.end(svg);
        return;
      }

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
