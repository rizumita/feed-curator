# Feed Curator

AI-powered RSS feed curation tool. Claude Code acts as the AI curator — no API keys needed.

## Architecture

- **CLI tool** (`bun src/cli.ts`): Data management (feeds, articles, SQLite)
- **Claude Code skills**: AI-driven curation (`/curate`, `/fetch-feeds`, `/discover-feeds`)

## CLI Commands

```
bun src/cli.ts add <url>              # Register RSS feed
bun src/cli.ts list                   # List registered feeds
bun src/cli.ts fetch                  # Fetch articles from all feeds
bun src/cli.ts add-article <url>      # Add single article URL
bun src/cli.ts articles [--uncurated] [--json]  # List articles
bun src/cli.ts update <id> --score <n> --summary "..."  # Update curation
bun src/cli.ts serve [--port 3000]    # Start web UI server
bun src/cli.ts config <key> [value]   # Get/set config (e.g. language)
```

## Data

- SQLite database: `data/feed-curator.db`
- Digest output: `output/digest-YYYY-MM-DD.md`
- Both directories are gitignored
