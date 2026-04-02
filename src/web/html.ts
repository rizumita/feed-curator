import type { Article } from "../types";

type ArticleWithFeed = Article & { feed_title: string | null; category: string | null };

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

export function getTier(score: number): Tier {
  return TIERS.find((t) => score >= t.min) ?? TIERS[TIERS.length - 1];
}

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

export function getAllCategories(articles: ArticleWithFeed[]): string[] {
  const catSet = new Set<string>();
  for (const a of articles) {
    if (a.category) catSet.add(a.category);
  }
  return [...catSet].sort();
}

export function getAllTags(articles: ArticleWithFeed[]): string[] {
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

function renderCard(a: ArticleWithFeed, view: "active" | "archive" = "active"): string {
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
        </button>${view === "active" ? `
        <button class="skip-btn" onclick="dismissArticle(${a.id})" title="Skip">&#x2715;</button>` : ""}
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

interface Stats {
  total: number;
  curated: number;
  unread: number;
  feeds: number;
  archived: number;
}

export function renderPage(
  articles: ArticleWithFeed[],
  stats: Stats,
  sort: "newest" | "score" = "newest",
  view: "active" | "archive" = "active",
): string {
  const now = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

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
          <button class="mark-section-read" onclick="markSectionRead(this)" title="Mark all visible as read">Mark all read</button>${view === "active" ? `
          <button class="skip-section-btn" onclick="skipSectionAll(this)" title="Skip all visible">Skip all</button>` : ""}
        </div>
        ${s.articles.map(a => renderCard(a, view)).join("\n")}
      </section>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Feed Curator</title>
  <link rel="stylesheet" href="/styles.css">
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
        <div class="stat-box">
          <div class="stat-val">${stats.archived}</div>
          <div class="stat-lbl">Archived</div>
        </div>
      </div>

      <div class="sidebar-section">
        <div class="sidebar-heading">View</div>
        <div class="filter-list" id="view-filters">
          <button class="filter-btn${view === "active" ? " active" : ""}" onclick="setView('active')">Active</button>
          <button class="filter-btn${view === "archive" ? " active" : ""}" onclick="setView('archive')">Archive</button>
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

  <script src="/scripts.js"></script>
</body>
</html>`;
}
