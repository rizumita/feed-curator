import { db } from "./db";
import type { Article, Feed } from "./types";

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

function getAllCategories(articles: ArticleWithFeed[]): string[] {
  const catSet = new Set<string>();
  for (const a of articles) {
    if (a.category) catSet.add(a.category);
  }
  return [...catSet].sort();
}

function getAllTags(articles: ArticleWithFeed[]): string[] {
  const tagSet = new Set<string>();
  for (const a of articles) {
    if (a.tags) {
      for (const t of a.tags.split(",")) {
        const trimmed = t.trim();
        if (trimmed) tagSet.add(trimmed);
      }
    }
  }
  return [...tagSet].sort();
}

function getFeeds(): Feed[] {
  return db.query("SELECT * FROM feeds ORDER BY created_at DESC").all() as Feed[];
}

function getStats() {
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

interface Tier {
  id: string;
  label: string;
  color: string;
  min: number;
  max: number;
}

const TIERS: Tier[] = [
  { id: "must-read", label: "Must Read", color: "#10b981", min: 0.85, max: 1.0 },
  { id: "recommended", label: "Recommended", color: "#3b82f6", min: 0.7, max: 0.85 },
  { id: "worth-a-look", label: "Worth a Look", color: "#f59e0b", min: 0.5, max: 0.7 },
  { id: "low-priority", label: "Low Priority", color: "#6b7280", min: 0, max: 0.5 },
];

function getTier(score: number): Tier {
  return TIERS.find((t) => score >= t.min) ?? TIERS[TIERS.length - 1];
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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

function renderCard(a: ArticleWithFeed): string {
  const score = a.score ?? 0;
  const tier = getTier(score);
  const title = escapeHtml(a.title ?? "(Untitled)");
  const summary = escapeHtml(a.summary ?? "");
  const feedName = escapeHtml(a.feed_title ?? "Unknown");
  const published = formatDate(a.published_at);
  const isRead = a.read_at !== null;
  const pct = Math.round(score * 100);
  const tags = a.tags ? a.tags.split(",").map((t: string) => t.trim()).filter(Boolean) : [];
  const tagsHtml = tags.map((t: string) => `<span class="tag" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</span>`).join("");

  return `
    <article class="card${isRead ? " read" : ""}" data-id="${a.id}" data-tier="${tier.id}" data-tags="${escapeHtml(tags.join(","))}" data-category="${escapeHtml(a.category ?? "")}">
      <div class="card-row">
        <button class="read-btn${isRead ? " is-read" : ""}" onclick="toggleRead(${a.id})" title="${isRead ? "Mark unread" : "Mark read"}">
          ${isRead ? "✓" : ""}
        </button>
        <div class="card-body">
          <h3 class="card-title">
            <a href="${escapeHtml(a.url)}" target="_blank" rel="noopener" onclick="markRead(${a.id})">${title}</a>
          </h3>
          <p class="card-summary">${summary}</p>
          <div class="card-meta">
            <span class="feed-name">${feedName}</span>
            ${published ? `<span class="sep">&middot;</span><span class="date">${published}</span>` : ""}
            ${tagsHtml ? `<span class="sep">&middot;</span>${tagsHtml}` : ""}
          </div>
        </div>
        <div class="card-score">
          <div class="score-ring" style="--pct:${pct};--color:${tier.color}">
            <span>${pct}</span>
          </div>
        </div>
      </div>
    </article>`;
}

function renderPage(articles: ArticleWithFeed[], sort: "newest" | "score" = "newest"): string {
  const stats = getStats();
  const now = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Group articles by tier
  const grouped = TIERS.map((tier) => ({
    tier,
    articles: articles.filter((a) => {
      const s = a.score ?? 0;
      return s >= tier.min && (tier.min === 0 ? s < tier.max : s < tier.max || s === 1.0);
    }),
  })).filter((g) => g.articles.length > 0);

  // Fix: ensure each article appears in exactly one group
  const sections = TIERS.map((tier) => {
    const items = articles.filter((a) => getTier(a.score ?? 0).id === tier.id);
    return { tier, articles: items };
  }).filter((g) => g.articles.length > 0);

  const allTags = getAllTags(articles);
  const allCategories = getAllCategories(articles);

  const tocLinks = sections
    .map((s) => `<a href="#${s.tier.id}" class="toc-link" style="--tc:${s.tier.color}"><span class="toc-dot" style="background:${s.tier.color}"></span>${s.tier.label}<span class="toc-count">${s.articles.length}</span></a>`)
    .join("\n");

  const sectionHtml = sections
    .map(
      (s) => `
      <section id="${s.tier.id}" class="tier-section">
        <div class="tier-header">
          <span class="tier-bar" style="background:${s.tier.color}"></span>
          <h2>${s.tier.label}</h2>
          <span class="tier-count">${s.articles.length}</span>
          <button class="mark-section-read" onclick="markSectionRead(this)" title="Mark all visible as read">Mark all read</button>
        </div>
        ${s.articles.map(renderCard).join("\n")}
      </section>`
    )
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
      --sidebar-w: 220px;
    }

    /* Dark theme (default) */
    :root, [data-theme="dark"] {
      --bg: #09090b;
      --surface: #18181b;
      --surface-hover: #1e1e22;
      --border: #27272a;
      --border-light: #3f3f46;
      --text: #fafafa;
      --text-muted: #a1a1aa;
      --text-dim: #71717a;
      --accent: #7c3aed;
      --accent-light: #a78bfa;
      --accent-glow: rgba(167, 139, 250, 0.12);
      --tag-bg: rgba(167, 139, 250, 0.12);
      --tag-text: #a78bfa;
      --logo-from: #fff;
    }

    /* Light theme */
    [data-theme="light"] {
      --bg: #fafafa;
      --surface: #ffffff;
      --surface-hover: #f4f4f5;
      --border: #e4e4e7;
      --border-light: #d4d4d8;
      --text: #18181b;
      --text-muted: #52525b;
      --text-dim: #71717a;
      --accent: #7c3aed;
      --accent-light: #7c3aed;
      --accent-glow: rgba(124, 58, 237, 0.08);
      --tag-bg: rgba(124, 58, 237, 0.08);
      --tag-text: #6d28d9;
      --logo-from: #18181b;
    }

    @media (prefers-color-scheme: light) {
      :root:not([data-theme="dark"]) {
        --bg: #fafafa;
        --surface: #ffffff;
        --surface-hover: #f4f4f5;
        --border: #e4e4e7;
        --border-light: #d4d4d8;
        --text: #18181b;
        --text-muted: #52525b;
        --text-dim: #71717a;
        --accent: #7c3aed;
        --accent-light: #7c3aed;
        --accent-glow: rgba(124, 58, 237, 0.08);
        --tag-bg: rgba(124, 58, 237, 0.08);
        --tag-text: #6d28d9;
        --logo-from: #18181b;
      }
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      min-height: 100vh;
    }

    /* --- Layout --- */
    .layout {
      display: flex;
      max-width: 1080px;
      margin: 0 auto;
      min-height: 100vh;
    }

    .sidebar {
      width: var(--sidebar-w);
      flex-shrink: 0;
      padding: 2rem 1.25rem;
      position: sticky;
      top: 0;
      height: 100vh;
      overflow-y: auto;
      border-right: 1px solid var(--border);
    }

    .main {
      flex: 1;
      min-width: 0;
      padding: 2rem 2rem 4rem;
    }

    /* --- Sidebar --- */
    .logo {
      font-size: 1.125rem;
      font-weight: 700;
      letter-spacing: -0.03em;
      background: linear-gradient(135deg, var(--logo-from) 0%, var(--accent-light) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 0.25rem;
    }

    .date-label {
      font-size: 0.75rem;
      color: var(--text-dim);
      margin-bottom: 1.5rem;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.5rem;
      margin-bottom: 1.5rem;
    }

    .stat-box {
      background: var(--surface);
      border-radius: 8px;
      padding: 0.625rem 0.75rem;
    }

    .stat-val {
      font-size: 1.25rem;
      font-weight: 700;
    }

    .stat-lbl {
      font-size: 0.6875rem;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .sidebar-section {
      margin-bottom: 1.5rem;
    }

    .sidebar-heading {
      font-size: 0.6875rem;
      font-weight: 600;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 0.5rem;
    }

    .filter-list {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .filter-btn {
      background: none;
      border: none;
      border-radius: 6px;
      padding: 0.4rem 0.625rem;
      color: var(--text-muted);
      font-size: 0.8125rem;
      cursor: pointer;
      text-align: left;
      transition: all 0.12s ease;
    }

    .filter-btn:hover { background: var(--surface); color: var(--text); }
    .filter-btn.active { background: var(--accent-glow); color: var(--accent); font-weight: 600; }

    .toc-link {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.375rem 0.625rem;
      border-radius: 6px;
      color: var(--text-muted);
      text-decoration: none;
      font-size: 0.8125rem;
      transition: all 0.12s ease;
    }

    .toc-link:hover { background: var(--surface); color: var(--text); }

    .toc-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .toc-count {
      margin-left: auto;
      font-size: 0.75rem;
      color: var(--text-dim);
      font-variant-numeric: tabular-nums;
    }

    /* --- Main Content --- */
    .tier-section { margin-bottom: 2.5rem; }

    .tier-header {
      display: flex;
      align-items: center;
      gap: 0.625rem;
      margin-bottom: 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid var(--border);
    }

    .tier-bar {
      width: 3px;
      height: 1.25rem;
      border-radius: 2px;
    }

    .tier-header h2 {
      font-size: 1rem;
      font-weight: 600;
      letter-spacing: -0.01em;
    }

    .tier-count {
      font-size: 0.75rem;
      color: var(--text-dim);
      background: var(--surface);
      padding: 0.125rem 0.5rem;
      border-radius: 999px;
    }

    .mark-section-read {
      margin-left: auto;
      background: none;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 0.25rem 0.625rem;
      color: var(--text-dim);
      font-size: 0.6875rem;
      cursor: pointer;
      transition: all 0.12s ease;
    }

    .mark-section-read:hover {
      border-color: var(--accent-light);
      color: var(--accent-light);
    }

    /* --- Cards --- */
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 1rem 1.25rem;
      margin-bottom: 0.5rem;
      transition: all 0.15s ease;
    }

    .card:hover {
      background: var(--surface-hover);
      border-color: var(--border-light);
    }

    .card.read { opacity: 0.45; }
    .card.read:hover { opacity: 0.75; }

    .card-row {
      display: flex;
      align-items: flex-start;
      gap: 0.875rem;
    }

    .read-btn {
      flex-shrink: 0;
      width: 1.375rem;
      height: 1.375rem;
      margin-top: 0.125rem;
      background: none;
      border: 1.5px solid var(--border-light);
      border-radius: 4px;
      cursor: pointer;
      color: var(--text-dim);
      font-size: 0.75rem;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.12s ease;
      padding: 0;
    }

    .read-btn:hover { border-color: var(--accent-light); color: var(--accent-light); }
    .read-btn.is-read { background: var(--accent); border-color: var(--accent); color: #fff; }

    .card-body { flex: 1; min-width: 0; }

    .card-title {
      font-size: 0.9375rem;
      font-weight: 600;
      line-height: 1.4;
      margin-bottom: 0.25rem;
    }

    .card-title a {
      color: var(--text);
      text-decoration: none;
    }

    .card-title a:hover { color: var(--accent); }

    .card-summary {
      font-size: 0.8125rem;
      color: var(--text-muted);
      line-height: 1.6;
      margin-bottom: 0.375rem;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .card:hover .card-summary {
      -webkit-line-clamp: unset;
    }

    .card-meta {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      font-size: 0.75rem;
      color: var(--text-dim);
    }

    .feed-name::before {
      content: "";
      display: inline-block;
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: var(--accent-light);
      margin-right: 0.25rem;
      vertical-align: middle;
    }

    .sep { color: var(--border-light); }

    .tag {
      display: inline-block;
      font-size: 0.6875rem;
      padding: 0.0625rem 0.4rem;
      border-radius: 4px;
      background: var(--tag-bg);
      color: var(--tag-text);
      margin-right: 0.25rem;
    }

    .tag-filters {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
    }

    .tag-filter {
      background: none;
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 0.2rem 0.5rem;
      color: var(--text-dim);
      font-size: 0.75rem;
      cursor: pointer;
      transition: all 0.12s ease;
    }

    .tag-filter:hover { border-color: var(--accent-light); color: var(--accent-light); }
    .tag-filter.active { background: var(--accent); border-color: var(--accent); color: #fff; }

    .sidebar-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .theme-toggle {
      background: none;
      border: 1px solid var(--border);
      border-radius: 6px;
      width: 2rem;
      height: 2rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
      color: var(--text-dim);
      font-size: 1rem;
    }

    .theme-toggle:hover { border-color: var(--accent-light); color: var(--accent-light); }

    /* Theme icons: sun=light, moon=dark, half=auto */
    .theme-icon::before { content: "\\25D0"; }
    [data-theme="dark"] .theme-icon::before { content: "\\2600"; }
    [data-theme="light"] .theme-icon::before { content: "\\263E"; }

    /* --- Score Ring --- */
    .card-score {
      flex-shrink: 0;
      margin-top: 0.125rem;
    }

    .score-ring {
      width: 2.75rem;
      height: 2.75rem;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: conic-gradient(var(--color) calc(var(--pct) * 1%), var(--border) 0);
      position: relative;
    }

    .score-ring::before {
      content: "";
      position: absolute;
      inset: 3px;
      border-radius: 50%;
      background: var(--surface);
    }

    .score-ring span {
      position: relative;
      font-size: 0.75rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      color: var(--text-muted);
    }

    /* --- Empty --- */
    .empty {
      text-align: center;
      padding: 4rem 2rem;
      color: var(--text-dim);
    }

    .empty h2 {
      font-size: 1.125rem;
      margin-bottom: 0.5rem;
      color: var(--text-muted);
    }

    footer {
      text-align: center;
      color: var(--text-dim);
      font-size: 0.6875rem;
      padding: 1.5rem 0;
    }

    /* --- Mobile --- */
    @media (max-width: 768px) {
      .layout { flex-direction: column; }
      .sidebar {
        width: 100%;
        height: auto;
        position: sticky;
        top: 0;
        z-index: 10;
        background: var(--bg);
        border-right: none;
        border-bottom: 1px solid var(--border);
        padding: 1rem 1.25rem;
      }
      .stats-grid { grid-template-columns: repeat(4, 1fr); }
      .sidebar-section.toc { display: none; }
      .main { padding: 1.25rem; }
      .score-ring { width: 2.25rem; height: 2.25rem; }
      .score-ring span { font-size: 0.6875rem; }
    }
  </style>
</head>
<body>
  <div class="layout">
    <aside class="sidebar">
      <div class="sidebar-top">
        <div class="logo">Feed Curator</div>
        <button class="theme-toggle" onclick="cycleTheme()" title="Toggle theme" aria-label="Toggle theme">
          <span class="theme-icon"></span>
        </button>
      </div>
      <div class="date-label">${now}</div>

      <div class="stats-grid">
        <div class="stat-box">
          <div class="stat-val" id="unread-count">${stats.unread}</div>
          <div class="stat-lbl">Unread</div>
        </div>
        <div class="stat-box">
          <div class="stat-val">${stats.curated}</div>
          <div class="stat-lbl">Curated</div>
        </div>
        <div class="stat-box">
          <div class="stat-val">${stats.total - stats.curated}</div>
          <div class="stat-lbl">Pending</div>
        </div>
        <div class="stat-box">
          <div class="stat-val">${stats.feeds}</div>
          <div class="stat-lbl">Feeds</div>
        </div>
      </div>

      ${allCategories.length > 0 ? `
      <div class="sidebar-section">
        <div class="sidebar-heading">Category</div>
        <div class="filter-list" id="category-filters">
          <button class="filter-btn active" data-value="all" onclick="filterByCategory('all')">All</button>
          ${allCategories.map(c => `<button class="filter-btn" data-value="${escapeHtml(c)}" onclick="filterByCategory('${escapeHtml(c)}')">${escapeHtml(c)}</button>`).join("\n")}
        </div>
      </div>` : ""}

      <div class="sidebar-section">
        <div class="sidebar-heading">Sort</div>
        <div class="filter-list">
          <button class="filter-btn${sort === "newest" ? " active" : ""}" onclick="setSort('newest')">Newest first</button>
          <button class="filter-btn${sort === "score" ? " active" : ""}" onclick="setSort('score')">Score first</button>
        </div>
      </div>

      <div class="sidebar-section">
        <div class="sidebar-heading">Filter</div>
        <div class="filter-list" id="read-filters">
          <button class="filter-btn active" data-value="all" onclick="filterArticles('all')">All</button>
          <button class="filter-btn" data-value="unread" onclick="filterArticles('unread')">Unread only</button>
          <button class="filter-btn" data-value="read" onclick="filterArticles('read')">Read only</button>
        </div>
      </div>

      ${allTags.length > 0 ? `
      <div class="sidebar-section">
        <div class="sidebar-heading">Tags</div>
        <div class="tag-filters">
          <button class="tag-filter active" data-value="all" onclick="filterByTag('all')">All</button>
          ${allTags.map(t => `<button class="tag-filter" data-value="${escapeHtml(t)}" onclick="filterByTag('${escapeHtml(t)}')">${escapeHtml(t)}</button>`).join("\n")}
        </div>
      </div>` : ""}

      <div class="sidebar-section toc">
        <div class="sidebar-heading">Sections</div>
        <div class="filter-list">
          ${tocLinks}
        </div>
      </div>
    </aside>

    <main class="main">
      ${
        articles.length > 0
          ? sectionHtml
          : `<div class="empty">
              <h2>No curated articles yet</h2>
              <p>Run /curate to score and summarize your articles.</p>
            </div>`
      }
      <footer>Feed Curator &mdash; AI-powered curation by Claude Code</footer>
    </main>
  </div>

  <script>
    async function toggleRead(id) {
      await fetch('/api/read/' + id, { method: 'POST' });
      const card = document.querySelector('[data-id="' + id + '"]');
      const btn = card.querySelector('.read-btn');
      const isRead = card.classList.toggle('read');
      btn.classList.toggle('is-read');
      btn.textContent = isRead ? '\\u2713' : '';
      btn.title = isRead ? 'Mark unread' : 'Mark read';
      updateUnreadCount();
    }

    async function markRead(id) {
      const card = document.querySelector('[data-id="' + id + '"]');
      if (!card.classList.contains('read')) {
        await fetch('/api/read/' + id, { method: 'POST' });
        card.classList.add('read');
        const btn = card.querySelector('.read-btn');
        btn.classList.add('is-read');
        btn.textContent = '\\u2713';
        btn.title = 'Mark unread';
        updateUnreadCount();
      }
    }

    function updateUnreadCount() {
      const unread = document.querySelectorAll('.card:not(.read)').length;
      document.getElementById('unread-count').textContent = unread;
    }

    // Theme management
    function getPreferredTheme() {
      const saved = localStorage.getItem('theme');
      if (saved) return saved;
      return 'auto';
    }

    function applyTheme(theme) {
      if (theme === 'auto') {
        document.documentElement.removeAttribute('data-theme');
      } else {
        document.documentElement.setAttribute('data-theme', theme);
      }
      localStorage.setItem('theme', theme);
    }

    function cycleTheme() {
      const current = getPreferredTheme();
      const next = current === 'auto' ? 'light' : current === 'light' ? 'dark' : 'auto';
      applyTheme(next);
    }

    // Apply saved theme on load
    applyTheme(getPreferredTheme());

    // --- Filter state from URL params ---
    const params = new URLSearchParams(location.search);
    let currentReadFilter = params.get('read') || 'unread';
    let currentTagFilter = params.get('tag') || 'all';
    let currentCategoryFilter = params.get('category') || 'all';

    function updateURL() {
      const p = new URLSearchParams(location.search);
      currentReadFilter === 'all' ? p.delete('read') : p.set('read', currentReadFilter);
      currentTagFilter === 'all' ? p.delete('tag') : p.set('tag', currentTagFilter);
      currentCategoryFilter === 'all' ? p.delete('category') : p.set('category', currentCategoryFilter);
      const qs = p.toString();
      history.replaceState(null, '', qs ? '?' + qs : location.pathname);
    }

    function applyFilters() {
      document.querySelectorAll('.card').forEach(card => {
        const isRead = card.classList.contains('read');
        const tags = (card.dataset.tags || '').split(',').map(t => t.trim());
        const category = card.dataset.category || '';
        let show = true;
        if (currentReadFilter === 'unread' && isRead) show = false;
        if (currentReadFilter === 'read' && !isRead) show = false;
        if (currentTagFilter !== 'all' && !tags.includes(currentTagFilter)) show = false;
        if (currentCategoryFilter !== 'all' && category !== currentCategoryFilter) show = false;
        card.style.display = show ? '' : 'none';
      });
      document.querySelectorAll('.tier-section').forEach(sec => {
        const visible = sec.querySelectorAll('.card:not([style*="display: none"])').length;
        sec.style.display = visible ? '' : 'none';
      });
      // Update visible tags based on category
      const visibleTags = new Set();
      document.querySelectorAll('.card').forEach(card => {
        const cat = card.dataset.category || '';
        if (currentCategoryFilter !== 'all' && cat !== currentCategoryFilter) return;
        (card.dataset.tags || '').split(',').forEach(t => { const tr = t.trim(); if (tr) visibleTags.add(tr); });
      });
      document.querySelectorAll('.tag-filter:not([data-value="all"])').forEach(btn => {
        btn.style.display = visibleTags.has(btn.dataset.value) ? '' : 'none';
      });
      // Reset tag filter if current tag not in visible set
      if (currentTagFilter !== 'all' && !visibleTags.has(currentTagFilter)) {
        currentTagFilter = 'all';
        document.querySelectorAll('.tag-filter').forEach(b => {
          b.classList.toggle('active', (b.dataset.value || 'all') === 'all');
        });
        applyFilters();
        return;
      }
      updateURL();
    }

    function setActiveBtn(container, value) {
      document.querySelectorAll(container + ' .filter-btn').forEach(b => {
        b.classList.toggle('active', (b.dataset.value || 'all') === value);
      });
    }

    function filterArticles(mode) {
      currentReadFilter = mode;
      setActiveBtn('#read-filters', mode);
      applyFilters();
    }

    function filterByTag(tag) {
      currentTagFilter = tag;
      document.querySelectorAll('.tag-filter').forEach(b => {
        b.classList.toggle('active', (b.dataset.value || 'all') === tag);
      });
      applyFilters();
    }

    function filterByCategory(cat) {
      currentCategoryFilter = cat;
      setActiveBtn('#category-filters', cat);
      applyFilters();
    }

    async function markSectionRead(btn) {
      const section = btn.closest('.tier-section');
      const cards = section.querySelectorAll('.card:not(.read):not([style*="display: none"])');
      const ids = [...cards].map(c => Number(c.dataset.id));
      if (ids.length === 0) return;
      await fetch('/api/read-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids })
      });
      cards.forEach(card => {
        card.classList.add('read');
        const rb = card.querySelector('.read-btn');
        rb.classList.add('is-read');
        rb.textContent = '\u2713';
        rb.title = 'Mark unread';
      });
      updateUnreadCount();
    }

    function setSort(sort) {
      const p = new URLSearchParams(location.search);
      sort === 'newest' ? p.delete('sort') : p.set('sort', sort);
      // Preserve other params
      if (currentReadFilter !== 'all') p.set('read', currentReadFilter);
      if (currentTagFilter !== 'all') p.set('tag', currentTagFilter);
      if (currentCategoryFilter !== 'all') p.set('category', currentCategoryFilter);
      const qs = p.toString();
      location.href = qs ? '?' + qs : '/';
    }

    // Restore filters on load
    setActiveBtn('#read-filters', currentReadFilter);
    setActiveBtn('#category-filters', currentCategoryFilter);
    document.querySelectorAll('.tag-filter').forEach(b => {
      b.classList.toggle('active', (b.dataset.value || 'all') === currentTagFilter);
    });
    applyFilters();

  </script>
</body>
</html>`;
}

export function startServer(port: number = 3000) {
  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

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
        return new Response(renderPage(getCuratedArticles(sort), sort), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  console.log(`Feed Curator running at http://localhost:${server.port}`);
}
