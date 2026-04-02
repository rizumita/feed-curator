import { spawnSync } from "child_process";
import { db } from "./db";
import { listArticles, updateArticleCuration, saveBriefing } from "./article";
import { generateProfile, profileForPrompt } from "./profile";
import type { Article } from "./types";

function getConfig(key: string): string | null {
  const row = db.query("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | null;
  return row?.value ?? null;
}

function callClaude(prompt: string): string | null {
  const result = spawnSync("claude", ["-p", prompt], {
    encoding: "utf-8",
    timeout: 300_000,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error) {
    console.error("Failed to run claude CLI:", result.error.message);
    return null;
  }
  if (result.status !== 0) {
    console.error("claude CLI exited with status", result.status);
    if (result.stderr) console.error(result.stderr);
    return null;
  }
  return result.stdout.trim();
}

export async function aiCurate(): Promise<number> {
  const articles = listArticles(true); // uncurated only
  if (articles.length === 0) {
    console.log("No uncurated articles.");
    return 0;
  }

  const language = getConfig("language") ?? "en";
  const profile = generateProfile();
  const profilePrompt = profileForPrompt(profile);

  // Process in batches to avoid token limits
  const batchSize = 10;
  let curated = 0;

  for (let i = 0; i < articles.length; i += batchSize) {
    const batch = articles.slice(i, i + batchSize);
    const articlesJson = batch.map(a => ({
      id: a.id,
      title: a.title,
      url: a.url,
      content: a.content?.slice(0, 500),
    }));

    const prompt = `You are a feed curator. Score, summarize, and tag these articles.

${profilePrompt}

Language for summaries: ${language}

Articles:
${JSON.stringify(articlesJson, null, 2)}

For each article, respond with ONLY a JSON array (no markdown, no explanation):
[{"id": <number>, "score": <0.0-1.0>, "summary": "<2-3 sentences in ${language}>", "tags": "<comma-separated English tags>"}]

Use these tag categories when applicable: agents, coding, llm, mcp, security, tools, rag, local-models, enterprise, research

Score based on: novelty, technical depth, practical utility, breadth of interest.
Adjust scores using the user profile above.`;

    console.log(`Curating batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(articles.length / batchSize)} (${batch.length} articles)...`);

    const response = callClaude(prompt);
    if (!response) {
      console.error("Failed to get AI response for batch, skipping.");
      continue;
    }

    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.error("No JSON array found in response, skipping batch.");
        continue;
      }
      const results = JSON.parse(jsonMatch[0]) as Array<{
        id: number;
        score: number;
        summary: string;
        tags: string;
      }>;

      for (const r of results) {
        if (r.id && typeof r.score === "number" && r.summary) {
          updateArticleCuration(r.id, r.score, r.summary, r.tags);
          curated++;
        }
      }
    } catch (e) {
      console.error("Failed to parse AI response:", e);
    }
  }

  return curated;
}

export async function aiBriefing(): Promise<boolean> {
  const language = getConfig("language") ?? "en";
  const profile = generateProfile();
  const profilePrompt = profileForPrompt(profile);
  const maxArticles = parseInt(getConfig("briefing_max_articles") ?? "10", 10);
  const maxClusters = parseInt(getConfig("briefing_max_clusters") ?? "5", 10);

  // Get unread, non-dismissed, non-archived curated articles
  const allArticles = listArticles(false);
  const unread = allArticles.filter(a =>
    a.curated_at !== null && a.read_at === null && a.dismissed_at === null && a.archived_at === null
  );

  if (unread.length === 0) {
    console.log("No unread articles for briefing.");
    return false;
  }

  const articlesJson = unread.slice(0, 50).map(a => ({
    id: a.id,
    title: a.title,
    score: a.score,
    summary: a.summary,
    tags: a.tags,
    published_at: a.published_at,
  }));

  const prompt = `You are a feed briefing generator. Group related articles into topic clusters.

${profilePrompt}

Language for topic names and summaries: ${language}
Max articles: ${maxArticles}
Max topics: ${maxClusters}

Unread articles:
${JSON.stringify(articlesJson, null, 2)}

Create topic clusters by grouping related articles. For each cluster:
- topic: short descriptive name (in ${language})
- summary: 1-2 sentence explanation of why this topic matters (in ${language})
- article_ids: array of article IDs in this cluster

Selection criteria: high score, profile match, freshness, topic diversity.
Cluster size: 1-4 articles per cluster.

Respond with ONLY a JSON object (no markdown, no explanation):
{"clusters":[{"topic":"...","summary":"...","article_ids":[...]}]}`;

  console.log("Generating briefing...");
  const response = callClaude(prompt);
  if (!response) {
    console.error("Failed to get AI response for briefing.");
    return false;
  }

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("No JSON object found in response.");
      return false;
    }
    const data = JSON.parse(jsonMatch[0]) as { clusters: Array<{ topic: string; summary: string; article_ids: number[] }> };
    const today = new Date().toISOString().slice(0, 10);
    saveBriefing(today, data.clusters);
    console.log(`Briefing saved: ${data.clusters.length} topic(s), ${data.clusters.reduce((n, c) => n + c.article_ids.length, 0)} articles.`);
    return true;
  } catch (e) {
    console.error("Failed to parse briefing response:", e);
    return false;
  }
}
