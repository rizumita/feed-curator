# Feed Curator

AI-powered RSS feed curation tool. Claude Code acts as the AI curator — no API keys needed.

## Architecture

- **CLI tool** (`npx tsx src/cli.ts`): Data management (feeds, articles, SQLite)
- **Web UI** (`npx tsx src/cli.ts serve`): Browser-based article reader with AI curation
- **AI integration**: Curation, briefing, and feed discovery via Claude Code subprocess

## Dev Commands

```
pnpm test                             # Run all tests (vitest)
pnpm run dev <command>                # Run CLI via tsx
npx tsx src/cli.ts serve [--port 3000] # Start web UI server
```

## CLI Commands

```
npx tsx src/cli.ts add <url> [-c category] # Register RSS feed with category
npx tsx src/cli.ts list                   # List registered feeds
npx tsx src/cli.ts fetch                  # Fetch articles from all feeds
npx tsx src/cli.ts add-article <url>      # Add single article URL
npx tsx src/cli.ts articles [--uncurated] [--unread] [--json]  # List articles
npx tsx src/cli.ts update <id> --score <n> --summary "..." [--tags "a,b"]  # Update curation
npx tsx src/cli.ts tag <id> <tags>        # Set tags on an article
npx tsx src/cli.ts read <id...>           # Mark articles as read
npx tsx src/cli.ts unread <id...>         # Mark articles as unread
npx tsx src/cli.ts categorize <id> <cat>  # Set feed category
npx tsx src/cli.ts profile [--prompt]     # Show reading profile (--prompt for AI use)
npx tsx src/cli.ts serve [--port 3000]    # Start web UI server
npx tsx src/cli.ts config <key> [value]   # Get/set config (e.g. language)
```

## Web UI

- **Views**: Briefing (default), All, Archive, Feeds
- **Article tiers**: Must Read (85-100), Recommended (70-85), Worth a Look (50-70), Low Priority (0-50)
- **Features**: Read/dismiss toggle, tag/category/read filters, dark/light/auto theme, SSE-based actions
- **API**: All endpoints under `/api/` — see `src/server.ts` for full list

## Data

- SQLite database: `data/feed-curator.db`
- Digest output: `output/digest-YYYY-MM-DD.md`
- Both directories are gitignored
