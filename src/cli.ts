#!/usr/bin/env bun
import { Command } from "commander";
import { db } from "./db";
import { addFeed, listFeeds, getAllFeeds, updateFeedFetchedAt, updateFeedTitle, updateFeedCategory } from "./feed";
import { addArticle, listArticles, updateArticleCuration, updateArticleTags, markAsRead, markAsUnread, dismissArticle, dismissArticles, getAutoArchiveDays, runAutoArchive, saveBriefing, getBriefing } from "./article";
import { parseFeed } from "./rss";
import { startServer } from "./server";
import { generateProfile, formatProfile, profileForPrompt } from "./profile";
import { aiCurate, aiBriefing } from "./ai";

const program = new Command();
program.name("feed-curator").description("AI-powered RSS feed curation tool");

// Default to "start" when no command is given
if (process.argv.length === 2) {
  process.argv.push("start");
}

// feed add <url>
program
  .command("add")
  .description("Register an RSS feed URL")
  .argument("<url>", "RSS feed URL")
  .option("-c, --category <category>", "Feed category")
  .action((url: string, opts: { category?: string }) => {
    if (!/^https?:\/\//i.test(url)) {
      console.error("Error: Feed URL must start with http:// or https://");
      return;
    }
    addFeed(url, undefined, opts.category);
  });

// feed list
program
  .command("list")
  .description("List registered feeds")
  .action(() => {
    const feeds = listFeeds();
    if (feeds.length === 0) {
      console.log("No feeds registered.");
      return;
    }
    for (const f of feeds) {
      const cat = f.category ? ` [${f.category}]` : "";
      console.log(`[${f.id}] ${f.title ?? "(no title)"}${cat} - ${f.url}`);
      if (f.last_fetched_at) console.log(`    Last fetched: ${f.last_fetched_at}`);
    }
  });

// feed fetch
program
  .command("fetch")
  .description("Fetch new articles from all registered feeds")
  .action(async () => {
    const feeds = getAllFeeds();
    if (feeds.length === 0) {
      console.log("No feeds registered. Use 'feed add <url>' first.");
      return;
    }

    let totalNew = 0;
    for (const feed of feeds) {
      try {
        const response = await fetch(feed.url);
        if (!response.ok) {
          console.error(`Failed to fetch ${feed.url}: ${response.status}`);
          continue;
        }
        const contentLength = Number(response.headers.get("content-length") || 0);
        if (contentLength > 10 * 1024 * 1024) {
          console.warn(`Skipping ${feed.url}: response too large (${contentLength} bytes)`);
          continue;
        }
        const xml = await response.text();
        const { title, items } = parseFeed(xml);

        if (title) updateFeedTitle(feed.id, title);

        let newCount = 0;
        for (const item of items) {
          if (!item.url) continue;
          const added = addArticle(
            item.url,
            item.title,
            item.content,
            feed.id,
            item.publishedAt ?? undefined
          );
          if (added) newCount++;
        }

        updateFeedFetchedAt(feed.id);
        console.log(`${feed.title ?? feed.url}: ${newCount} new articles (${items.length} total)`);
        totalNew += newCount;
      } catch (err) {
        console.error(`Error fetching ${feed.url}:`, err);
      }
    }
    console.log(`\nTotal: ${totalNew} new articles added.`);
  });

// feed add-article <url>
program
  .command("add-article")
  .description("Add a single article URL")
  .argument("<url>", "Article URL")
  .option("-t, --title <title>", "Article title")
  .action(async (url: string, opts: { title?: string }) => {
    let title = opts.title;

    // Try to extract title from page if not provided
    if (!title) {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const contentLength = Number(response.headers.get("content-length") || 0);
        if (contentLength > 10 * 1024 * 1024) throw new Error("Response too large");
        const html = await response.text();
        const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (match) title = match[1].trim();
      } catch {
        // ignore - title is optional
      }
    }

    const added = addArticle(url, title);
    if (added) {
      console.log(`Added article: ${title ?? url}`);
    } else {
      console.log(`Article already exists: ${url}`);
    }
  });

// feed articles
program
  .command("articles")
  .description("List articles")
  .option("--uncurated", "Show only uncurated articles")
  .option("--unread", "Show only unread articles")
  .option("--json", "Output as JSON")
  .action((opts: { uncurated?: boolean; unread?: boolean; json?: boolean }) => {
    let articles = listArticles(opts.uncurated ?? false);
    if (opts.unread) {
      articles = articles.filter((a) => a.read_at === null);
    }
    if (articles.length === 0) {
      console.log(opts.uncurated ? "No uncurated articles." : "No articles.");
      return;
    }

    if (opts.json) {
      console.log(JSON.stringify(articles, null, 2));
      return;
    }

    for (const a of articles) {
      const score = a.score !== null ? ` [Score: ${a.score}]` : "";
      const read = a.read_at ? " ✓" : "";
      console.log(`[${a.id}] ${a.title ?? "(no title)"}${score}${read}`);
      console.log(`    ${a.url}`);
      if (a.summary) console.log(`    Summary: ${a.summary}`);
    }
  });

// feed update <id>
program
  .command("update")
  .description("Update article curation data")
  .argument("<id>", "Article ID")
  .requiredOption("--score <score>", "Relevance score (0.0-1.0)")
  .requiredOption("--summary <summary>", "Article summary")
  .option("--tags <tags>", "Comma-separated tags")
  .action((id: string, opts: { score: string; summary: string; tags?: string }) => {
    const numId = Number(id);
    const numScore = Number(opts.score);
    if (!Number.isInteger(numId) || numId <= 0) {
      console.error("Error: id must be a positive integer.");
      return;
    }
    if (isNaN(numScore) || numScore < 0.0 || numScore > 1.0) {
      console.error("Error: score must be between 0.0 and 1.0.");
      return;
    }
    updateArticleCuration(numId, numScore, opts.summary, opts.tags);
    console.log(`Updated article ${id}.`);
  });

// feed tag <id> <tags>
program
  .command("tag")
  .description("Set tags on an article")
  .argument("<id>", "Article ID")
  .argument("<tags>", "Comma-separated tags")
  .action((id: string, tags: string) => {
    updateArticleTags(Number(id), tags);
    console.log(`Tagged article ${id}: ${tags}`);
  });

// feed read <id...>
program
  .command("read")
  .description("Mark articles as read")
  .argument("<ids...>", "Article IDs")
  .action((ids: string[]) => {
    for (const id of ids) {
      markAsRead(Number(id));
    }
    console.log(`Marked ${ids.length} article(s) as read.`);
  });

// feed unread <id...>
program
  .command("unread")
  .description("Mark articles as unread")
  .argument("<ids...>", "Article IDs")
  .action((ids: string[]) => {
    for (const id of ids) {
      markAsUnread(Number(id));
    }
    console.log(`Marked ${ids.length} article(s) as unread.`);
  });

// feed dismiss <id...>
program
  .command("dismiss")
  .description("Dismiss articles (skip without reading)")
  .argument("<ids...>", "Article IDs")
  .action((ids: string[]) => {
    const numIds = ids.map(Number);
    dismissArticles(numIds);
    console.log(`Dismissed ${ids.length} article(s).`);
  });

// feed archive
program
  .command("archive")
  .description("Run auto-archive on old unread articles")
  .option("--run", "Execute auto-archive now")
  .action((opts: { run?: boolean }) => {
    if (opts.run) {
      const days = getAutoArchiveDays();
      const count = runAutoArchive(days);
      console.log(`Archived ${count} article(s) older than ${days} days.`);
    } else {
      const days = getAutoArchiveDays();
      console.log(`Auto-archive threshold: ${days} days`);
      console.log(`Use --run to execute.`);
    }
  });

// feed categorize <feed-id> <category>
program
  .command("categorize")
  .description("Set category on a feed")
  .argument("<id>", "Feed ID")
  .argument("<category>", "Category name")
  .action((id: string, category: string) => {
    updateFeedCategory(Number(id), category);
    console.log(`Feed ${id} categorized as: ${category}`);
  });

// feed profile
program
  .command("profile")
  .description("Show reading profile based on read history")
  .option("--prompt", "Output as prompt for AI curation")
  .action((opts: { prompt?: boolean }) => {
    const profile = generateProfile();
    if (opts.prompt) {
      console.log(profileForPrompt(profile));
    } else {
      console.log(formatProfile(profile));
    }
  });

// feed config
program
  .command("config")
  .description("Get or set configuration")
  .argument("<key>", "Config key (e.g. language)")
  .argument("[value]", "Config value to set")
  .action((key: string, value?: string) => {
    if (value !== undefined) {
      db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [key, value]);
      console.log(`Set ${key} = ${value}`);
    } else {
      const row = db.query("SELECT value FROM settings WHERE key = ?").get(key) as
        | { value: string }
        | null;
      if (row) {
        console.log(row.value);
      } else {
        console.log(`(not set)`);
      }
    }
  });

// feed briefing
program
  .command("briefing")
  .description("Show or save today's briefing")
  .option("--save <json>", "Save briefing data (JSON)")
  .option("--date <date>", "Show briefing for specific date (YYYY-MM-DD)")
  .action((opts: { save?: string; date?: string }) => {
    if (opts.save) {
      const data = JSON.parse(opts.save);
      const today = new Date().toISOString().slice(0, 10);
      saveBriefing(today, data.clusters);
      console.log(`Briefing saved for ${today} with ${data.clusters.length} topic(s).`);
      return;
    }
    const date = opts.date ?? new Date().toISOString().slice(0, 10);
    const briefing = getBriefing(date);
    if (!briefing) {
      console.log(`No briefing found for ${date}.`);
      return;
    }
    const clusters = JSON.parse(briefing.clusters) as Array<{ topic: string; summary: string; article_ids: number[] }>;
    console.log(`=== Briefing for ${date} ===\n`);
    for (const cluster of clusters) {
      console.log(`📌 ${cluster.topic} (${cluster.article_ids.length} articles)`);
      console.log(`   ${cluster.summary}`);
      console.log(`   Article IDs: ${cluster.article_ids.join(", ")}\n`);
    }
  });

// feed start (all-in-one: fetch → curate → briefing → serve)
program
  .command("start")
  .description("Fetch feeds, AI-curate, generate briefing, and start web UI")
  .option("-p, --port <port>", "Port number", "3000")
  .option("--no-fetch", "Skip fetching feeds")
  .option("--no-curate", "Skip AI curation")
  .option("--no-briefing", "Skip briefing generation")
  .action(async (opts: { port: string; fetch: boolean; curate: boolean; briefing: boolean }) => {
    // 1. Fetch
    if (opts.fetch) {
      console.log("\n=== Fetching feeds ===");
      const feeds = getAllFeeds();
      if (feeds.length === 0) {
        console.log("No feeds registered. Use 'feed add <url>' first.");
      } else {
        let totalNew = 0;
        for (const feed of feeds) {
          try {
            const response = await fetch(feed.url);
            if (!response.ok) {
              console.error(`Failed to fetch ${feed.url}: ${response.status}`);
              continue;
            }
            const contentLength = Number(response.headers.get("content-length") || 0);
            if (contentLength > 10 * 1024 * 1024) {
              console.warn(`Skipping ${feed.url}: response too large`);
              continue;
            }
            const xml = await response.text();
            const { title, items } = parseFeed(xml);
            if (title) updateFeedTitle(feed.id, title);
            let newCount = 0;
            for (const item of items) {
              if (!item.url) continue;
              if (addArticle(item.url, item.title, item.content, feed.id, item.publishedAt ?? undefined)) newCount++;
            }
            updateFeedFetchedAt(feed.id);
            console.log(`${feed.title ?? feed.url}: ${newCount} new`);
            totalNew += newCount;
          } catch (err) {
            console.error(`Error fetching ${feed.url}:`, err);
          }
        }
        console.log(`Total: ${totalNew} new articles.`);
      }
    }

    // 2. AI Curate
    if (opts.curate) {
      console.log("\n=== AI Curation ===");
      const count = await aiCurate();
      console.log(`Curated ${count} article(s).`);
    }

    // 3. Briefing
    if (opts.briefing) {
      console.log("\n=== Generating Briefing ===");
      await aiBriefing();
    }

    // 4. Auto-archive
    const archiveDays = getAutoArchiveDays();
    const archived = runAutoArchive(archiveDays);
    if (archived > 0) console.log(`Auto-archived ${archived} old article(s).`);

    // 5. Start server
    const port = Number(opts.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      console.error("Error: port must be an integer between 1 and 65535.");
      return;
    }
    console.log("\n=== Starting Web UI ===");
    startServer(port);
  });

// feed serve
program
  .command("serve")
  .description("Start web UI server")
  .option("-p, --port <port>", "Port number", "3000")
  .action((opts: { port: string }) => {
    const port = Number(opts.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      console.error("Error: port must be an integer between 1 and 65535.");
      return;
    }
    startServer(port);
  });

program.parse();
