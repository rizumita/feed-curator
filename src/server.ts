import { db } from "./db";
import type { Article, Feed } from "./types";

function getCuratedArticles(): (Article & { feed_title: string | null })[] {
  return db
    .query(
      `SELECT a.*, f.title as feed_title
       FROM articles a
       LEFT JOIN feeds f ON a.feed_id = f.id
       WHERE a.curated_at IS NOT NULL
       ORDER BY a.score DESC`
    )
    .all() as (Article & { feed_title: string | null })[];
}

function getFeeds(): Feed[] {
  return db.query("SELECT * FROM feeds ORDER BY created_at DESC").all() as Feed[];
}

function getStats() {
  const total = (db.query("SELECT COUNT(*) as n FROM articles").get() as any).n;
  const curated = (
    db.query("SELECT COUNT(*) as n FROM articles WHERE curated_at IS NOT NULL").get() as any
  ).n;
  const feeds = (db.query("SELECT COUNT(*) as n FROM feeds").get() as any).n;
  return { total, curated, feeds };
}

function scoreColor(score: number): string {
  if (score >= 0.85) return "#10b981";
  if (score >= 0.7) return "#3b82f6";
  if (score >= 0.5) return "#f59e0b";
  return "#6b7280";
}

function scoreLabel(score: number): string {
  if (score >= 0.85) return "Must Read";
  if (score >= 0.7) return "Recommended";
  if (score >= 0.5) return "Worth a Look";
  return "Low Priority";
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return dateStr;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderPage(articles: (Article & { feed_title: string | null })[]): string {
  const stats = getStats();
  const now = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const articleCards = articles
    .map((a, i) => {
      const score = a.score ?? 0;
      const color = scoreColor(score);
      const label = scoreLabel(score);
      const title = escapeHtml(a.title ?? "(Untitled)");
      const summary = escapeHtml(a.summary ?? "");
      const feedName = escapeHtml(a.feed_title ?? "Unknown");
      const published = formatDate(a.published_at);

      return `
      <article class="card">
        <div class="card-header">
          <span class="rank">#${i + 1}</span>
          <span class="badge" style="background:${color}">${label}</span>
          <span class="score">${score.toFixed(2)}</span>
        </div>
        <h2 class="card-title">
          <a href="${escapeHtml(a.url)}" target="_blank" rel="noopener">${title}</a>
        </h2>
        <p class="card-summary">${summary}</p>
        <div class="card-meta">
          <span class="feed-name">${feedName}</span>
          ${published ? `<span class="date">${published}</span>` : ""}
        </div>
      </article>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Feed Curator</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #0a0a0b;
      --surface: #141416;
      --surface-hover: #1a1a1e;
      --border: #27272a;
      --text: #fafafa;
      --text-muted: #a1a1aa;
      --text-dim: #71717a;
      --accent: #a78bfa;
      --accent-glow: rgba(167, 139, 250, 0.15);
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      min-height: 100vh;
    }

    .container {
      max-width: 720px;
      margin: 0 auto;
      padding: 0 1.5rem;
    }

    header {
      padding: 3rem 0 2rem;
      border-bottom: 1px solid var(--border);
      margin-bottom: 2rem;
    }

    header h1 {
      font-size: 1.75rem;
      font-weight: 700;
      letter-spacing: -0.03em;
      background: linear-gradient(135deg, #fff 0%, var(--accent) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .subtitle {
      color: var(--text-dim);
      font-size: 0.875rem;
      margin-top: 0.5rem;
    }

    .stats {
      display: flex;
      gap: 1.5rem;
      margin-top: 1.25rem;
    }

    .stat {
      display: flex;
      align-items: baseline;
      gap: 0.375rem;
    }

    .stat-value {
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--text);
    }

    .stat-label {
      font-size: 0.75rem;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 1rem;
      transition: all 0.2s ease;
    }

    .card:hover {
      background: var(--surface-hover);
      border-color: rgba(167, 139, 250, 0.3);
      box-shadow: 0 0 0 1px var(--accent-glow), 0 8px 32px rgba(0, 0, 0, 0.3);
    }

    .card-header {
      display: flex;
      align-items: center;
      gap: 0.625rem;
      margin-bottom: 0.75rem;
    }

    .rank {
      font-size: 0.75rem;
      font-weight: 700;
      color: var(--text-dim);
      font-variant-numeric: tabular-nums;
    }

    .badge {
      font-size: 0.6875rem;
      font-weight: 600;
      padding: 0.1875rem 0.5rem;
      border-radius: 999px;
      color: #fff;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .score {
      margin-left: auto;
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--text-muted);
      font-variant-numeric: tabular-nums;
    }

    .card-title {
      font-size: 1.125rem;
      font-weight: 600;
      line-height: 1.4;
      margin-bottom: 0.625rem;
      letter-spacing: -0.01em;
    }

    .card-title a {
      color: var(--text);
      text-decoration: none;
    }

    .card-title a:hover {
      color: var(--accent);
    }

    .card-summary {
      font-size: 0.9375rem;
      color: var(--text-muted);
      line-height: 1.65;
      margin-bottom: 0.875rem;
    }

    .card-meta {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      font-size: 0.8125rem;
      color: var(--text-dim);
    }

    .card-meta .feed-name::before {
      content: "";
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--accent);
      margin-right: 0.375rem;
      vertical-align: middle;
    }

    .empty {
      text-align: center;
      padding: 4rem 2rem;
      color: var(--text-dim);
    }

    .empty h2 {
      font-size: 1.25rem;
      margin-bottom: 0.5rem;
      color: var(--text-muted);
    }

    footer {
      padding: 2rem 0;
      margin-top: 2rem;
      border-top: 1px solid var(--border);
      text-align: center;
      color: var(--text-dim);
      font-size: 0.75rem;
    }

    @media (max-width: 640px) {
      header { padding: 2rem 0 1.5rem; }
      .card { padding: 1.25rem; }
      .stats { gap: 1rem; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Feed Curator</h1>
      <p class="subtitle">${now}</p>
      <div class="stats">
        <div class="stat">
          <span class="stat-value">${stats.curated}</span>
          <span class="stat-label">Curated</span>
        </div>
        <div class="stat">
          <span class="stat-value">${stats.total - stats.curated}</span>
          <span class="stat-label">Pending</span>
        </div>
        <div class="stat">
          <span class="stat-value">${stats.feeds}</span>
          <span class="stat-label">Feeds</span>
        </div>
      </div>
    </header>

    <main>
      ${
        articles.length > 0
          ? articleCards
          : `<div class="empty">
              <h2>No curated articles yet</h2>
              <p>Run /curate to score and summarize your articles.</p>
            </div>`
      }
    </main>

    <footer>
      Feed Curator &mdash; AI-powered curation by Claude Code
    </footer>
  </div>
</body>
</html>`;
}

export function startServer(port: number = 3000) {
  const server = Bun.serve({
    port,
    fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/api/articles") {
        const articles = getCuratedArticles();
        return Response.json(articles);
      }

      if (url.pathname === "/api/feeds") {
        const feeds = getFeeds();
        return Response.json(feeds);
      }

      if (url.pathname === "/") {
        const articles = getCuratedArticles();
        return new Response(renderPage(articles), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  console.log(`Feed Curator running at http://localhost:${server.port}`);
}
