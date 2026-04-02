---
name: fetch-feeds
description: Fetch new articles from all registered RSS feeds and store them in the database. Use when asked to "fetch feeds", "update articles", "get new posts", or "pull RSS".
---

# Fetch Feeds

Fetch new articles from all registered RSS feeds and save them to the SQLite database.

## Steps

1. Run `bun src/cli.ts fetch` to pull articles from all feeds
2. Report the results (number of new articles) to the user
3. Report any errors encountered
4. If new articles were added, automatically run `/curate` to score, summarize, and tag them
5. If curated articles exist, run `/briefing` to generate today's topic-clustered briefing
