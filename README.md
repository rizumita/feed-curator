# Feed Curator

AI-powered RSS feed curation tool. Claude Code acts as the AI curator — no API keys needed.

Collect articles from RSS feeds, let Claude Code summarize and score them, and browse the results in a stylish web UI.

[日本語版は下にあります / Japanese version below](#feed-curator-1)

---

## Features

- **Feed Collection** — Register RSS/Atom feeds by URL or discover them by topic
- **AI Curation** — Claude Code reads articles, scores relevance (0.0-1.0), writes summaries in your language
- **Personalized Scoring** — Learns from your reading history to boost what you care about
- **Categories & Tags** — Organize feeds by category, tag articles by topic
- **Web UI** — Two-column layout with tier grouping, filters, read/unread tracking, dark/light theme
- **Markdown Digest** — Generate daily digest files sorted by score
- **Multi-language** — Summaries and digests written in your preferred language

## Requirements

- [Bun](https://bun.sh/) runtime
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/user/feed-curator.git
cd feed-curator
bun install

# 2. Claude Code will ask your preferred language on first run
# Or set it manually:
bun src/cli.ts config language en

# 3. Add feeds (or use /discover-feeds in Claude Code)
bun src/cli.ts add https://example.com/feed.xml --category "Tech"

# 4. Fetch articles
bun src/cli.ts fetch

# 5. Curate with Claude Code
# In Claude Code, run: /curate

# 6. Browse results
bun src/cli.ts serve
# Open http://localhost:3000
```

## Claude Code Skills

Run these as slash commands in Claude Code:

| Skill | Description |
|---|---|
| `/fetch-feeds` | Fetch new articles from all registered feeds |
| `/curate` | AI-score, summarize, and tag uncurated articles |
| `/discover-feeds <topic>` | Search the web for RSS feeds on a topic and register them |

## CLI Commands

```
bun src/cli.ts add <url> [-c category]   # Register RSS feed
bun src/cli.ts list                      # List registered feeds
bun src/cli.ts fetch                     # Fetch articles from all feeds
bun src/cli.ts add-article <url>         # Add single article URL
bun src/cli.ts articles [--uncurated] [--unread] [--json]
bun src/cli.ts update <id> --score <n> --summary "..." [--tags "a,b"]
bun src/cli.ts tag <id> <tags>           # Set tags on an article
bun src/cli.ts read <id...>              # Mark articles as read
bun src/cli.ts unread <id...>            # Mark articles as unread
bun src/cli.ts categorize <id> <cat>     # Set feed category
bun src/cli.ts profile [--prompt]        # Show reading profile
bun src/cli.ts serve [--port 3000]       # Start web UI server
bun src/cli.ts config <key> [value]      # Get/set config
```

## Web UI

Start with `bun src/cli.ts serve` and open http://localhost:3000.

- **Two-column layout** — Sidebar with stats, filters, navigation; main area with articles
- **Tier grouping** — Must Read / Recommended / Worth a Look / Low Priority
- **Score ring** — Visual score indicator per article
- **Filters** — Category, read status, tags (combinable, persisted in URL)
- **Read tracking** — Click to read, checkbox toggle, mark-all-read per section
- **Dark/Light theme** — Auto-follows OS, or manually toggle (saved to localStorage)
- **Summaries** — 2-line preview, expand on hover

## How Curation Works

1. `/fetch-feeds` pulls new articles from all registered RSS feeds
2. `/curate` reads uncurated articles and for each one:
   - Scores relevance (0.0-1.0) based on novelty, depth, utility
   - Adjusts scores using your reading profile (preferred/ignored tags)
   - Writes a 2-3 sentence summary in your configured language
   - Assigns 1-3 topic tags
3. Results appear in the web UI and a Markdown digest is generated

## Architecture

```
CLI (Bun + TypeScript + SQLite)     Claude Code Skills
  Data management                     /curate — AI scoring & summaries
  Feed fetching & parsing             /fetch-feeds — Article collection
  Web UI server                       /discover-feeds — Feed discovery
```

No API keys needed — Claude Code itself is the AI.

## Data

- SQLite database: `data/feed-curator.db` (auto-created, gitignored)
- Digest output: `output/digest-YYYY-MM-DD.md` (gitignored)

---

# Feed Curator

AIがRSSフィードをキュレーションするツール。Claude Code自身がAIキュレーターとして動作します。APIキーは不要です。

RSSフィードから記事を収集し、Claude Codeが要約・スコアリングを行い、スタイリッシュなWeb UIで閲覧できます。

## 特徴

- **フィード収集** — URLでRSS/Atomフィードを登録、またはトピックで自動検索
- **AIキュレーション** — Claude Codeが記事を読み、関連度スコア(0.0-1.0)と要約を設定言語で生成
- **パーソナライズ** — 既読履歴から学習し、興味のあるトピックのスコアを自動調整
- **カテゴリー & タグ** — フィードをカテゴリーで整理、記事にトピックタグを付与
- **Web UI** — 2カラムレイアウト、ティア別グループ、フィルター、既読管理、ダーク/ライトテーマ
- **Markdownダイジェスト** — スコア順の日次ダイジェストを自動生成
- **多言語対応** — 要約とダイジェストを設定した言語で出力

## 必要なもの

- [Bun](https://bun.sh/) ランタイム
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI

## クイックスタート

```bash
# 1. クローンしてインストール
git clone https://github.com/user/feed-curator.git
cd feed-curator
bun install

# 2. 初回起動時にClaude Codeが言語設定を聞きます
# 手動で設定する場合:
bun src/cli.ts config language ja

# 3. フィードを追加（Claude Codeで /discover-feeds も可）
bun src/cli.ts add https://example.com/feed.xml --category "Tech"

# 4. 記事を取得
bun src/cli.ts fetch

# 5. Claude Codeでキュレーション
# Claude Codeで: /curate

# 6. 結果をブラウザで確認
bun src/cli.ts serve
# http://localhost:3000 を開く
```

## Claude Codeスキル

Claude Codeでスラッシュコマンドとして実行:

| スキル | 説明 |
|---|---|
| `/fetch-feeds` | 全登録フィードから新着記事を取得 |
| `/curate` | 未キュレーション記事をAIでスコアリング・要約・タグ付け |
| `/discover-feeds <トピック>` | トピックに関するRSSフィードをウェブ検索して登録 |

## CLIコマンド

```
bun src/cli.ts add <url> [-c カテゴリー]  # RSSフィード登録
bun src/cli.ts list                       # 登録フィード一覧
bun src/cli.ts fetch                      # 全フィードから記事取得
bun src/cli.ts add-article <url>          # 単独記事URL追加
bun src/cli.ts articles [--uncurated] [--unread] [--json]
bun src/cli.ts update <id> --score <n> --summary "..." [--tags "a,b"]
bun src/cli.ts tag <id> <tags>            # 記事にタグ設定
bun src/cli.ts read <id...>               # 既読にする
bun src/cli.ts unread <id...>             # 未読に戻す
bun src/cli.ts categorize <id> <cat>      # フィードのカテゴリー設定
bun src/cli.ts profile [--prompt]         # 読書プロファイル表示
bun src/cli.ts serve [--port 3000]        # Web UIサーバー起動
bun src/cli.ts config <key> [value]       # 設定の取得/変更
```

## キュレーションの仕組み

1. `/fetch-feeds` で全フィードから新着記事を取得
2. `/curate` が未キュレーション記事を処理:
   - 新規性、技術的深さ、実用性に基づきスコアリング (0.0-1.0)
   - 既読履歴のプロファイルに基づきスコアを調整
   - 設定言語で2-3文の要約を生成
   - 1-3個のトピックタグを付与
3. Web UIとMarkdownダイジェストに結果が反映

## ライセンス

MIT
