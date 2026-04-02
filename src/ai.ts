import { spawn } from "child_process";
import { listArticles, updateArticleCuration, saveBriefing, getConfig } from "./article";
import { generateProfile, profileForPrompt } from "./profile";

function extractJson(response: string, type: "array" | "object"): string | null {
  const pattern = type === "array" ? /\[[\s\S]*\]/ : /\{[\s\S]*\}/;
  const match = response.match(pattern);
  return match?.[0] ?? null;
}

function callClaude(prompt: string): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn("claude", ["-p", prompt]);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    const timer = setTimeout(() => { proc.kill(); resolve(null); }, 300_000);
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        console.error("claude CLI exited with status", code);
        if (stderr) console.error(stderr);
        resolve(null);
        return;
      }
      resolve(stdout.trim());
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      console.error("Failed to run claude CLI:", err.message);
      resolve(null);
    });
  });
}

export async function aiCurate(onProgress?: (msg: string) => void): Promise<number> {
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
  const totalBatches = Math.ceil(articles.length / batchSize);

  for (let i = 0; i < articles.length; i += batchSize) {
    const batch = articles.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
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

    const msg = `Curating batch ${batchNum}/${totalBatches} (${batch.length} articles)...`;
    console.log(msg);
    onProgress?.(msg);

    const response = await callClaude(prompt);
    if (!response) {
      console.error("Failed to get AI response for batch, skipping.");
      onProgress?.(`Batch ${batchNum} failed, skipping.`);
      continue;
    }

    try {
      // Extract JSON from response (handle markdown code blocks)
      const json = extractJson(response, "array");
      if (!json) {
        console.error("No JSON array found in response, skipping batch.");
        continue;
      }
      const results = JSON.parse(json) as Array<{
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
      onProgress?.(`Batch ${batchNum} done: ${results.length} curated`);
    } catch (e) {
      console.error("Failed to parse AI response:", e);
    }
  }

  return curated;
}

export async function aiBriefing(onProgress?: (msg: string) => void): Promise<boolean> {
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
  onProgress?.("Analyzing articles for briefing...");
  const response = await callClaude(prompt);
  if (!response) {
    console.error("Failed to get AI response for briefing.");
    return false;
  }

  try {
    const json = extractJson(response, "object");
    if (!json) {
      console.error("No JSON object found in response.");
      return false;
    }
    const data = JSON.parse(json) as { clusters: Array<{ topic: string; summary: string; article_ids: number[] }> };
    const today = new Date().toISOString().slice(0, 10);
    saveBriefing(today, data.clusters);
    const msg = `Briefing saved: ${data.clusters.length} topic(s), ${data.clusters.reduce((n, c) => n + c.article_ids.length, 0)} articles.`;
    console.log(msg);
    onProgress?.(msg);
    return true;
  } catch (e) {
    console.error("Failed to parse briefing response:", e);
    return false;
  }
}

export interface DiscoveredFeed {
  url: string;
  title: string;
  description: string;
}

export async function aiDiscoverFeeds(topic: string, onProgress?: (msg: string) => void): Promise<DiscoveredFeed[]> {
  onProgress?.(`Searching feeds for "${topic}"...`);

  const prompt = `You are an RSS feed discovery assistant. Find RSS/Atom feeds related to this topic: "${topic}"

Search for blogs, news sites, and publications about this topic. For each feed found, verify it's a real RSS/Atom feed URL (ending in /feed, /rss, /atom.xml, /feed.xml, /rss.xml, /index.xml, or similar).

Return ONLY a JSON array (no markdown, no explanation):
[{"url": "https://example.com/feed.xml", "title": "Site Name", "description": "Brief description of what this feed covers"}]

Guidelines:
- Find 5-10 high-quality feeds
- Prefer actively maintained feeds
- Include a mix of individual blogs and official project blogs
- Only include publicly accessible feeds (no auth required)
- Make sure URLs are actual feed URLs, not regular web pages`;

  const response = await callClaude(prompt);
  if (!response) return [];

  try {
    const json = extractJson(response, "array");
    if (!json) return [];
    const feeds = JSON.parse(json) as DiscoveredFeed[];
    onProgress?.(`Found ${feeds.length} feed(s).`);
    return feeds;
  } catch {
    return [];
  }
}
