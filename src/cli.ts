import { Command } from "commander";
import { db } from "./db";
import { addFeed, listFeeds, getAllFeeds, updateFeedFetchedAt, updateFeedTitle } from "./feed";
import { addArticle, listArticles, updateArticleCuration } from "./article";
import { parseFeed } from "./rss";
import { startServer } from "./server";

const program = new Command();
program.name("feed").description("RSS Feed Curator CLI");

// feed add <url>
program
  .command("add")
  .description("Register an RSS feed URL")
  .argument("<url>", "RSS feed URL")
  .action((url: string) => {
    addFeed(url);
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
      console.log(`[${f.id}] ${f.title ?? "(no title)"} - ${f.url}`);
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
            item.publishedAt
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
  .option("--json", "Output as JSON")
  .action((opts: { uncurated?: boolean; json?: boolean }) => {
    const articles = listArticles(opts.uncurated ?? false);
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
      console.log(`[${a.id}] ${a.title ?? "(no title)"}${score}`);
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
  .action((id: string, opts: { score: string; summary: string }) => {
    updateArticleCuration(Number(id), Number(opts.score), opts.summary);
    console.log(`Updated article ${id}.`);
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

// feed serve
program
  .command("serve")
  .description("Start web UI server")
  .option("-p, --port <port>", "Port number", "3000")
  .action((opts: { port: string }) => {
    startServer(Number(opts.port));
  });

program.parse();
