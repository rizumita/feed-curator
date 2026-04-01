---
name: discover-feeds
description: Discover and register RSS feeds related to a given topic. Uses web search to find relevant blogs, sites, and their RSS feed URLs, then verifies and registers them. Use when asked to "find feeds about...", "discover feeds for...", "collect feeds on...", or "gather RSS sources for...".
---

# Discover Feeds

Find and register RSS feeds related to a user-specified topic.

## Arguments

The user provides a topic or interest area (e.g., "AI-driven development", "Rust programming", "cloud native infrastructure").

## Steps

1. **Search for feeds**: Use WebSearch to find blogs, news sites, and publications related to the topic. Search with queries like:
   - `"<topic>" RSS feed`
   - `"<topic>" blog atom feed`
   - `best "<topic>" blogs RSS`

2. **Extract feed URLs**: For each promising site found:
   - Use WebFetch to load the page and look for RSS/Atom feed links in:
     - `<link rel="alternate" type="application/rss+xml">` or `type="application/atom+xml"` tags
     - Common paths: `/feed`, `/rss`, `/feed.xml`, `/rss.xml`, `/atom.xml`, `/index.xml`
   - Collect candidate feed URLs

3. **Verify feeds**: For each candidate URL:
   - Run `bun src/cli.ts fetch` won't work for unregistered feeds, so use `curl -sI <url>` or WebFetch to check the URL returns valid XML
   - Only proceed with URLs that return valid RSS/Atom content

4. **Present candidates**: Show the user a numbered list of discovered feeds with:
   - Feed title (if extracted)
   - Feed URL
   - Brief description of the source
   - Ask the user which feeds to register (all, specific numbers, or none)

5. **Register selected feeds**: For each approved feed, run:
   ```
   bun src/cli.ts add <feed-url>
   ```

6. **Optionally fetch**: Ask the user if they want to fetch articles from the newly added feeds right away. If yes, run:
   ```
   bun src/cli.ts fetch
   ```

## Guidelines

- Aim for 5-10 high-quality feed candidates per topic
- Prefer feeds that are actively maintained (recent posts)
- Include a mix of individual blogs, official project blogs, and aggregator sites
- Avoid feeds that require authentication
- If the topic is broad, suggest sub-topics the user might want to narrow down to
