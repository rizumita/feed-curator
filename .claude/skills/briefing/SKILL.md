---
name: briefing
description: Generate a topic-clustered daily briefing from unread articles. AI groups related articles into topics and provides reasoning for each cluster. Use when asked to "briefing", "generate briefing", "today's picks", or "daily digest".
---

# Generate Daily Briefing

Analyze unread curated articles, group related ones into topic clusters, and save a daily briefing with AI-generated topic summaries.

## Steps

1. Run `bun src/cli.ts config language` to check the user's preferred language. Write all topic names and summaries in that language. If not set, use English.
2. Run `bun src/cli.ts profile --prompt` to get the user's reading preferences. Use this to prioritize topics.
3. Run `bun src/cli.ts articles --unread --json` to get unread articles as JSON (dismissed/archived articles are excluded from the default article list)
4. Run `bun src/cli.ts config briefing_max_articles` to get max articles (default: 10 if not set)
5. Run `bun src/cli.ts config briefing_max_clusters` to get max topics (default: 5 if not set)
6. Analyze the articles and group related ones into topic clusters:
   - **Clustering**: Group articles by content similarity — use tags, title keywords, and summary themes to identify related articles
   - **Topic naming**: Give each cluster a short, descriptive topic name (in the user's language)
   - **Topic summary**: Write a 1-2 sentence summary explaining why this topic matters today (in the user's language)
   - **Selection criteria**:
     - Score: Prioritize higher-scored articles
     - Profile match: Boost topics matching user's preferred tags/sources
     - Freshness: Prefer newer articles over older ones
     - Diversity: Ensure topic variety (don't cluster everything into one topic)
   - **Cluster size**: 1-4 articles per cluster is ideal
   - A single important article can form its own cluster
7. Trim results to fit within the configured limits (max articles and max clusters)
8. Save the briefing:
   ```
   bun src/cli.ts briefing --save '{"clusters":[{"topic":"Topic Name","summary":"Why this matters...","article_ids":[1,2,3]},...]}'
   ```
9. Report the results to the user: number of topics, number of articles selected, and list each topic with its articles

## Example Output

For a briefing with 3 topics:

```
📌 Claude Code の新機能と活用法 (3 articles)
   Hooks機能の解説と実践例が3本。MCP連携の具体的な実装パターンも。
   - [12] Claude Code Hooks Deep Dive (0.92)
   - [15] Building MCP Servers (0.88)
   - [18] Claude Code in CI/CD (0.82)

📌 LLMセキュリティの最新動向 (2 articles)
   プロンプトインジェクションの新しい攻撃手法と防御策。
   - [22] Prompt Injection 2.0 (0.85)
   - [25] LLM Security Audit Guide (0.78)
```
