import type { Briefing, BriefingCluster } from "../types";
import type { ArticleWithFeed } from "../article";

declare const __APP_VERSION__: string;
const version = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

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

export function sanitizeUrl(url: string): string {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("/") || trimmed.startsWith("#")) {
    return escapeHtml(trimmed);
  }
  return "#";
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
  const uncurated = a.score === null;
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
    <article class="card${isRead ? " read" : ""}${uncurated ? " uncurated" : ""}" data-id="${a.id}" data-tier="${uncurated ? "uncurated" : tier.id}" data-tags="${escapeHtml(tags.join(","))}" data-category="${escapeHtml(a.category ?? "")}" data-date="${a.published_at ?? a.fetched_at}">
      <div class="card-row">
        <button class="read-btn${isRead ? " is-read" : ""}" onclick="toggleRead(${a.id})" title="${isRead ? "Mark unread" : "Mark read"}">
          ${isRead ? "✓" : ""}
        </button>${view === "active" ? `
        <button class="skip-btn" onclick="dismissArticle(${a.id})" title="Skip">&#x2715;</button>` : ""}
        <div class="card-body">
          <h3 class="card-title">
            <a href="${sanitizeUrl(a.url)}" target="_blank" rel="noopener" onclick="markRead(${a.id})">${title}</a>
          </h3>
          <p class="card-summary">${uncurated ? "<em>Pending curation...</em>" : summary}</p>
          <div class="card-meta">
            <span class="feed-name">${feedName}</span>
            ${published ? `<span class="sep">&middot;</span><span class="date">${published}</span>` : ""}
            ${tagsHtml ? `<span class="sep">&middot;</span>${tagsHtml}` : ""}
          </div>
        </div>
        <div class="card-score">
          ${uncurated
            ? `<div class="score-ring" style="--pct:0;--color:#9ca3af"><span>—</span></div>`
            : `<div class="score-ring" style="--pct:${pct};--color:${tier.color}"><span>${pct}</span></div>`}
        </div>
      </div>
    </article>`;
}

function renderFeedsView(feeds: Feed[]): string {
  if (feeds.length === 0) {
    return `<div class="empty">
      <h2>No feeds registered</h2>
      <p>Use the search box in the sidebar to discover and add feeds.</p>
    </div>`;
  }

  const byCategory = new Map<string, Feed[]>();
  for (const f of feeds) {
    const cat = f.category ?? "Uncategorized";
    const list = byCategory.get(cat) ?? [];
    list.push(f);
    byCategory.set(cat, list);
  }

  return `<h1 class="feeds-title">Registered Feeds <span class="feeds-count">${feeds.length}</span></h1>
    ${[...byCategory.entries()].map(([cat, catFeeds]) => `
      <section class="feeds-category">
        <h2 class="feeds-category-name">${escapeHtml(cat)} <span class="feeds-count">${catFeeds.length}</span></h2>
        ${catFeeds.map(f => `
          <div class="feed-card" data-feed-id="${f.id}">
            <div class="feed-card-info">
              <div class="feed-card-title">${escapeHtml(f.title ?? "(no title)")}</div>
              <div class="feed-card-url">${escapeHtml(f.url)}</div>
              ${f.last_fetched_at ? `<div class="feed-card-meta">Last fetched: ${formatDate(f.last_fetched_at)}</div>` : ""}
            </div>
            <button class="feed-remove-btn" onclick="removeFeed(${f.id})" title="Remove feed">&times;</button>
          </div>
        `).join("\n")}
      </section>
    `).join("\n")}`;
}

interface Stats {
  total: number;
  curated: number;
  unread: number;
  feeds: number;
  archived: number;
}

function renderBriefingView(briefing: Briefing, articles: ArticleWithFeed[]): string {
  const clusters: BriefingCluster[] = JSON.parse(briefing.clusters);
  const articleMap = new Map(articles.map(a => [a.id, a]));

  return clusters.map(cluster => {
    const clusterArticles = cluster.article_ids
      .map(id => articleMap.get(id))
      .filter((a): a is ArticleWithFeed => a !== undefined);

    if (clusterArticles.length === 0) return "";
    // Hide clusters where all articles are already read
    if (clusterArticles.every(a => a.read_at !== null)) return "";

    const clusterIds = clusterArticles.map(a => a.id);

    return `
      <section class="briefing-cluster">
        <div class="cluster-header">
          <h2 class="cluster-topic">${escapeHtml(cluster.topic)} <span class="cluster-count">${clusterArticles.length}</span></h2>
          <button class="skip-section-btn" onclick="skipCluster(this, [${clusterIds.join(",")}])" title="Skip this topic">Skip topic</button>
        </div>
        <p class="cluster-summary">${escapeHtml(cluster.summary)}</p>
        ${clusterArticles.map(a => renderCard(a, "active")).join("\n")}
      </section>`;
  }).join("\n");
}

import type { Feed } from "../types";

function renderMainContent(opts: {
  view: string; stats: Stats; feeds: Feed[]; briefing: Briefing | null;
  articles: ArticleWithFeed[]; now: string; sectionHtml: string;
}): string {
  const { view, stats, feeds, briefing, articles, now, sectionHtml } = opts;

  if (stats.feeds === 0 && view !== "feeds") {
    return `<div class="onboarding">
      <h1>Welcome to Feed Curator</h1>
      <p>Get started by finding feeds to follow.</p>
      <div class="onboarding-search">
        <input type="text" id="onboard-topic" placeholder="Enter a topic (e.g. AI, Rust, TypeScript...)" class="onboarding-input" />
        <button id="onboard-search-btn" onclick="document.getElementById('discover-topic').value=document.getElementById('onboard-topic').value;discoverFeeds()" class="onboarding-btn">Search Feeds</button>
      </div>
    </div>`;
  }
  if (stats.feeds > 0 && stats.curated === 0 && view === "briefing") {
    return `<div class="onboarding">
      <h1>Feeds Ready</h1>
      <p>${stats.feeds} feed(s) registered. Fetch articles and let AI curate them.</p>
      <button onclick="runUpdate()" class="onboarding-btn update-btn">Update Now</button>
    </div>`;
  }
  if (view === "feeds") return renderFeedsView(feeds);
  if (view === "briefing" && briefing) {
    return `<div class="briefing-header">
      <h1>Today's Briefing</h1>
      <span class="briefing-date">${now}</span>
    </div>
    ${renderBriefingView(briefing, articles)}
    <div class="briefing-footer">
      <a href="?view=all" class="see-all-link">See all ${stats.unread} unread articles &rarr;</a>
    </div>`;
  }
  if (articles.length > 0) return sectionHtml;
  return `<div class="onboarding">
    <h1>No curated articles yet</h1>
    <p>Fetch articles and let AI curate them.</p>
    <button onclick="runUpdate()" class="onboarding-btn update-btn">Update Now</button>
  </div>`;
}

export function renderPage(
  articles: ArticleWithFeed[],
  stats: Stats,
  sort: "newest" | "score" = "newest",
  view: "briefing" | "all" | "archive" | "feeds" = "briefing",
  briefing?: Briefing | null,
  language?: string | null,
  feeds?: Feed[],
  autoUpdateHours?: number,
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
          <button class="mark-section-read" onclick="markSectionRead(this)" title="Mark all visible as read">Mark all read</button>${view !== "archive" ? `
          <button class="skip-section-btn" onclick="skipSectionAll(this)" title="Skip all visible">Skip all</button>` : ""}
        </div>
        ${s.articles.map(a => renderCard(a, view === "archive" ? "archive" : "active")).join("\n")}
      </section>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Feed Curator</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="stylesheet" href="/styles.css?v=${version}">
</head>
<body>
  <div class="layout">
    <aside class="sidebar">
      <div class="sidebar-top">
        <div class="logo"><svg class="logo-icon" viewBox="0 0 441 374" xmlns="http://www.w3.org/2000/svg"><g fill="currentColor" transform="translate(0,374) scale(.1,-.1)"><path d="M1670 3734c-251-11-475-27-616-44-517-63-923-175-912-253 13-89 465-212 968-262 421-41 1025-53 1420-26 670 44 1282 173 1340 281 46 87-420 206-1015 260-347 31-964 54-1185 44z"/><path d="M4015 3314c-22-13-89-45-150-71-382-162-888-277-1480-335-172-17-836-17-1010 0-562 54-1008 178-1312 363-35 21-63 36-63 34 0-6 278-535 441-839 112-208 225-300 419-340 78-16 240-26 240-15 0 4-31 82-70 175s-68 169-67 170c1 1 40-4 87-12 237-38 712-43 1050-9 567 56 1147 176 1429 296 173 74 275 156 360 288 51 81 181 306 181 316 0 9-14 4-55-21z"/><path d="M3270 2480c-274-34-539-108-990-277-325-121-465-164-700-212-226-46-479-52-655-16-69 14-194 53-259 80-15 7-5-19 41-106 33-63 102-196 152-295 51-100 108-200 127-222 105-123 346-143 674-56 321 84 591 222 974 497 226 163 300 210 401 259 405 194 791 50 941-352 26-70 28-85 29-230 0-144-2-160-28-233-15-43-44-105-65-137l-37-59 0 147c0 207-35 321-139 459-99 130-300 243-434 243-24 0-37-14-97-107-39-58-71-110-73-115-2-4 12-8 31-8 47 0 160-35 229-72 31-17 84-58 116-92 105-109 155-241 155-406 1-151-45-265-144-362-212-207-572-191-774 34-56 62-120 192-134 272-13 71-14 216-2 269 5 20 6 37 2 37-4 0-137-41-297-90-337-106-518-153-665-175-196-28-383-15-495 35-24 10-44 17-44 16 0-8 346-653 453-846 116-208 214-299 367-340 103-28 286-8 384 42 63 31 466 272 466 278 0 3-17 14-37 25-96 51-224 176-288 280-16 25-11 23 31-16 112-104 268-189 424-229 118-31 366-39 500-16 472 82 844 429 966 901 26 99 28 126 28 270 0 131-4 176-22 248-81 326-323 575-637 658-92 24-348 34-475 19z"/><path d="M2920 1450c-44-66-80-122-80-125 0-3 24-5 54-5 30 0 84-9 122-21 56-17 77-31 125-78 46-46 61-70 74-116 24-82 17-159-23-236-18-34-30-64-28-66 2-2 34 1 70 8 166 29 255 172 227 369-26 191-168 345-351 380-106 20-101 23-190-110z"/></g></svg>Feed Curator</div>
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
        <div class="sidebar-heading">Actions</div>
        <div class="action-buttons">
          <button class="action-btn" onclick="runUpdate()" id="btn-update">Update</button>
        </div>
        <div id="action-status" class="action-status"></div>
        <div class="discover-form">
          <input type="text" id="discover-topic" placeholder="Discover feeds by topic..." class="discover-input" />
          <button onclick="discoverFeeds()" id="discover-btn" class="discover-btn">Search</button>
        </div>
      </div>

      <div class="sidebar-section">
        <div class="sidebar-heading">View</div>
        <div class="filter-list" id="view-filters">
          <button class="filter-btn${view === "briefing" ? " active" : ""}" onclick="setView('briefing')">Briefing</button>
          <button class="filter-btn${view === "all" ? " active" : ""}" onclick="setView('all')">All</button>
          <button class="filter-btn${view === "archive" ? " active" : ""}" onclick="setView('archive')">Archive</button>
          <button class="filter-btn${view === "feeds" ? " active" : ""}" onclick="setView('feeds')">Feeds</button>
        </div>
      </div>

      ${allCategories.length > 0 ? `
      <div class="sidebar-section">
        <div class="sidebar-heading">Category</div>
        <div class="filter-list" id="category-filters">
          <button class="filter-btn active" data-value="all">All</button>
          ${allCategories.map(c => `<button class="filter-btn" data-value="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join("\n")}
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
        <div class="period-filter" style="margin-top:0.5rem">
          <select id="period-filter" onchange="filterByPeriod(this.value)">
            <option value="all">All time</option>
            <option value="1">Today</option>
            <option value="3">3 days</option>
            <option value="7" selected>7 days</option>
            <option value="14">14 days</option>
            <option value="30">30 days</option>
            <option value="90">3 months</option>
            <option value="180">6 months</option>
          </select>
        </div>
      </div>

      ${allTags.length > 0 ? `
      <div class="sidebar-section">
        <div class="sidebar-heading">Tags</div>
        <div class="tag-filters">
          <button class="tag-filter active" data-value="all">All</button>
          ${allTags.map(t => `<button class="tag-filter" data-value="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join("\n")}
        </div>
      </div>` : ""}

      <div class="sidebar-section">
        <div class="sidebar-heading">Auto Update</div>
        <div class="auto-update-setting">
          <select id="auto-update-hours" onchange="setAutoUpdate(this.value)">
            <option value="0"${autoUpdateHours === 0 ? " selected" : ""}>Off</option>
            <option value="1"${autoUpdateHours === 1 ? " selected" : ""}>1h</option>
            <option value="3"${autoUpdateHours === 3 ? " selected" : ""}>3h</option>
            <option value="6"${(autoUpdateHours ?? 6) === 6 ? " selected" : ""}>6h</option>
            <option value="12"${autoUpdateHours === 12 ? " selected" : ""}>12h</option>
            <option value="24"${autoUpdateHours === 24 ? " selected" : ""}>24h</option>
          </select>
        </div>
      </div>

      <div class="sidebar-section toc">
        <div class="sidebar-heading">Sections</div>
        <div class="filter-list">
          ${tocLinks}
        </div>
      </div>
    </aside>

    <main class="main">
      ${!language ? `
      <div class="lang-banner" id="lang-banner">
        <p>Select your preferred language for article summaries and digests:</p>
        <div class="lang-options">
          <button onclick="setLanguage('ja')">日本語</button>
          <button onclick="setLanguage('en')">English</button>
          <button onclick="setLanguage('zh')">中文</button>
          <button onclick="setLanguage('ko')">한국어</button>
          <button onclick="setLanguage('es')">Espa\u00f1ol</button>
          <button onclick="setLanguage('fr')">Fran\u00e7ais</button>
          <button onclick="setLanguage('de')">Deutsch</button>
        </div>
      </div>` : ""}
      <div id="discover-results" class="discover-results-main" style="display:none"></div>
      ${renderMainContent({ view, stats, feeds: feeds ?? [], briefing: briefing ?? null, articles, now, sectionHtml })}
      <footer>Feed Curator &mdash; AI-powered curation by Claude Code</footer>
    </main>
  </div>

  <script src="/scripts.js?v=${version}"></script>
</body>
</html>`;
}
