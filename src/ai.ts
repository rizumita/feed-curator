import { spawn } from "child_process";
import { listArticles, updateArticleCuration } from "./article";
import { saveBriefing } from "./briefing-data";
import { getLocalDateKey } from "./date";
import { getConfig } from "./config";
import { getRecentActions, savePreferenceMemo } from "./preferences";
import { generateProfile, profileForPrompt } from "./profile";
import { normalizeTags } from "./tag";
import { DEFAULT_AI_BACKEND, DEFAULT_OLLAMA_MODEL, DEFAULT_OLLAMA_URL } from "./ai-backend";

function extractJson(response: string, type: "array" | "object"): string | null {
  const pattern = type === "array" ? /\[[\s\S]*\]/ : /\{[\s\S]*\}/;
  const match = response.match(pattern);
  return match?.[0] ?? null;
}

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function findClaude(): string {
  const home = homedir();
  const candidates = [
    "claude",
    join(home, ".local", "bin", "claude"),
    join(home, ".claude", "bin", "claude"),
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
  ];
  for (const p of candidates) {
    if (p === "claude" || existsSync(p)) return p;
  }
  return "claude";
}

const CLAUDE_PATH = findClaude();

/** Build environment for Claude CLI. When backend is "ollama", route via Ollama's Anthropic-compatible API. */
function buildClaudeEnv(): NodeJS.ProcessEnv {
  const backend = getConfig("ai_backend") ?? DEFAULT_AI_BACKEND;
  if (backend === "ollama") {
    const ollamaUrl = getConfig("ollama_url") ?? DEFAULT_OLLAMA_URL;
    const model = getConfig("ollama_model") ?? DEFAULT_OLLAMA_MODEL;
    return {
      ...process.env,
      ANTHROPIC_BASE_URL: `${ollamaUrl}/v1`,
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_MODEL: model,
    };
  }
  return { ...process.env };
}

function callClaude(prompt: string, opts?: { allowedTools?: string[] }): Promise<string | null> {
  const useStdin = opts?.allowedTools?.length;
  const args = ["-p", "--output-format", "json"];
  if (useStdin) {
    args.push("--allowedTools", ...opts.allowedTools!);
  } else {
    args.push(prompt);
  }
  // allowedTools (WebSearch etc.) requires Claude CLI natively — skip Ollama env
  const env = useStdin ? { ...process.env } : buildClaudeEnv();
  return new Promise((resolve) => {
    const proc = spawn(CLAUDE_PATH, args, { env });
    if (useStdin) {
      proc.stdin?.write(prompt);
      proc.stdin?.end();
    }
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
      try {
        const json = JSON.parse(stdout);
        if (json.is_error) {
          console.error("claude CLI returned error:", json.result);
          resolve(null);
          return;
        }
        resolve((json.result as string)?.trim() ?? null);
      } catch {
        resolve(stdout.trim());
      }
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      console.error("Failed to run claude CLI:", err.message);
      resolve(null);
    });
  });
}

const CURATE_LIMIT = 50;

/** Extract head (500 chars) + tail (300 chars) for token-efficient curation */
function prepareArticleSnippet(a: import("./types").Article) {
  const content = a.content ?? "";
  const head = content.slice(0, 500);
  const tail = content.length > 800 ? content.slice(-300) : "";
  return {
    id: a.id,
    title: a.title,
    url: a.url,
    content_head: head,
    ...(tail && { content_tail: tail }),
    content_length: content.length,
  };
}

/** Minimal preview for Stage 1 fast screening: title + first 200 chars */
function prepareArticlePreview(a: import("./types").Article) {
  return {
    id: a.id,
    title: a.title,
    content_preview: (a.content ?? "").slice(0, 200),
  };
}

/** Rank articles by blended score: 70% curation score + 30% freshness (14-day window) */
function rankByBlendedScore(articles: import("./types").Article[]): import("./types").Article[] {
  const now = Date.now();
  const maxAge = 14 * 24 * 60 * 60 * 1000;
  return articles
    .map(a => {
      const score = a.score ?? 0;
      const ts = new Date(a.published_at ?? a.fetched_at).getTime();
      const age = Number.isNaN(ts) ? maxAge : now - ts;
      const freshness = Math.max(0, 1 - age / maxAge);
      return { article: a, blended: 0.7 * score + 0.3 * freshness };
    })
    .sort((a, b) => b.blended - a.blended)
    .map(r => r.article);
}

/** Stage 1: Fast screening with minimal context. Returns preliminary scores only. */
export async function aiCurateFast(
  articles: import("./types").Article[],
  onProgress?: (msg: string) => void,
): Promise<Array<{ id: number; prelimScore: number }>> {
  if (articles.length === 0) return [];

  const batchSize = 20;
  const results: Array<{ id: number; prelimScore: number }> = [];
  const totalBatches = Math.ceil(articles.length / batchSize);

  for (let i = 0; i < articles.length; i += batchSize) {
    const batch = articles.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const articlesJson = batch.map(prepareArticlePreview);

    const prompt = `You are a feed article screener. Score these articles based on: novelty, technical depth, practical utility, breadth of interest.

Articles (title + first 200 chars of content):
${JSON.stringify(articlesJson, null, 2)}

Respond with ONLY a JSON array (no markdown, no explanation):
[{"id": <number>, "score": <0.0-1.0>}]

Score criteria: 0.0 = spam/irrelevant, 0.3 = low value, 0.5 = borderline interesting, 0.7 = good article, 0.9+ = exceptional/must-read.`;

    const msg = `Stage 1: Screening batch ${batchNum}/${totalBatches} (${batch.length} articles)...`;
    onProgress?.(msg);

    const response = await callClaude(prompt);
    if (!response) {
      onProgress?.(`Stage 1: Batch ${batchNum} failed, skipping.`);
      continue;
    }

    try {
      const json = extractJson(response, "array");
      if (!json) continue;
      const parsed = JSON.parse(json) as Array<{ id: number; score: number }>;
      for (const r of parsed) {
        if (r.id && typeof r.score === "number") {
          results.push({ id: r.id, prelimScore: r.score });
        }
      }
    } catch {
      onProgress?.(`Stage 1: Batch ${batchNum} parse error, skipping.`);
    }
  }

  return results;
}

/** Stage 2: Precision re-evaluation with full context and user profile. */
export async function aiRerankCandidates(
  articles: import("./types").Article[],
  onProgress?: (msg: string) => void,
): Promise<Array<{ id: number; score: number; summary: string; tags: string }>> {
  if (articles.length === 0) return [];

  const language = getConfig("language") ?? "en";
  const profile = generateProfile();
  const profilePrompt = profileForPrompt(profile);
  const batchSize = 10;
  const results: Array<{ id: number; score: number; summary: string; tags: string }> = [];
  const totalBatches = Math.ceil(articles.length / batchSize);

  for (let i = 0; i < articles.length; i += batchSize) {
    const batch = articles.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const articlesJson = batch.map(prepareArticleSnippet);

    const prompt = `You are a feed curator. Score, summarize, and tag these articles.

${profilePrompt}

Language for summaries: ${language}

Articles (content_head: first 500 chars, content_tail: last 300 chars if long, content_length: total chars):
${JSON.stringify(articlesJson, null, 2)}

For each article, respond with ONLY a JSON array (no markdown, no explanation):
[{"id": <number>, "score": <0.0-1.0>, "summary": "<2-3 sentences in ${language}>", "tags": "<comma-separated English tags>"}]

Pick 1 core tag from: agents, coding, llm, mcp, security, tools, rag, local-models, enterprise, research
Then add 1-2 free-form tags that capture the specific topic (e.g. "fine-tuning", "multimodal", "rust", "observability"). Keep tags lowercase, hyphenated.

Score based on: novelty, technical depth, practical utility, breadth of interest.
Adjust scores using the user profile above.`;

    const msg = `Stage 2: Re-evaluating batch ${batchNum}/${totalBatches} (${batch.length} articles)...`;
    onProgress?.(msg);

    const response = await callClaude(prompt);
    if (!response) {
      onProgress?.(`Stage 2: Batch ${batchNum} failed, skipping.`);
      continue;
    }

    try {
      const json = extractJson(response, "array");
      if (!json) continue;
      const parsed = JSON.parse(json) as Array<{ id: number; score: number; summary: string; tags: string }>;
      for (const r of parsed) {
        if (r.id && typeof r.score === "number" && r.summary) {
          results.push(r);
        }
      }
    } catch {
      onProgress?.(`Stage 2: Batch ${batchNum} parse error, skipping.`);
    }
  }

  return results;
}

/** Generate summary/tags for confirmed low-scoring articles (score kept from Stage 1). */
async function aiSummarizeLow(
  articles: Array<{ article: import("./types").Article; prelimScore: number }>,
  onProgress?: (msg: string) => void,
): Promise<Array<{ id: number; score: number; summary: string; tags: string }>> {
  if (articles.length === 0) return [];

  const language = getConfig("language") ?? "en";
  const batchSize = 20;
  const results: Array<{ id: number; score: number; summary: string; tags: string }> = [];
  const totalBatches = Math.ceil(articles.length / batchSize);
  const scoreMap = new Map(articles.map(a => [a.article.id, a.prelimScore]));

  for (let i = 0; i < articles.length; i += batchSize) {
    const batch = articles.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const articlesJson = batch.map(a => prepareArticleSnippet(a.article));

    const prompt = `You are a feed curator. Generate brief summaries and tags for these low-priority articles.

Language for summaries: ${language}

Articles (content_head: first 500 chars, content_tail: last 300 chars if long, content_length: total chars):
${JSON.stringify(articlesJson, null, 2)}

Respond with ONLY a JSON array (no markdown, no explanation):
[{"id": <number>, "summary": "<1-2 sentences in ${language}>", "tags": "<comma-separated English tags>"}]

Pick 1 core tag from: agents, coding, llm, mcp, security, tools, rag, local-models, enterprise, research
Then add 1-2 free-form tags that capture the specific topic. Keep tags lowercase, hyphenated.`;

    const msg = `Summarizing ${batch.length} low-priority articles (batch ${batchNum}/${totalBatches})...`;
    onProgress?.(msg);

    const response = await callClaude(prompt);
    if (!response) {
      onProgress?.(`Low-priority batch ${batchNum} failed, skipping.`);
      continue;
    }

    try {
      const json = extractJson(response, "array");
      if (!json) continue;
      const parsed = JSON.parse(json) as Array<{ id: number; summary: string; tags: string }>;
      for (const r of parsed) {
        if (r.id && r.summary) {
          results.push({
            id: r.id,
            score: scoreMap.get(r.id) ?? 0,
            summary: r.summary,
            tags: r.tags ?? "",
          });
        }
      }
    } catch {
      onProgress?.(`Low-priority batch ${batchNum} parse error, skipping.`);
    }
  }

  return results;
}

export async function aiCurate(onProgress?: (msg: string) => void): Promise<number> {
  const articles = listArticles(true, CURATE_LIMIT);
  if (articles.length === 0) {
    console.log("No uncurated articles.");
    return 0;
  }

  const lowThreshold = parseFloat(getConfig("curate_low_threshold") ?? "0.3");

  // Stage 1: Fast screening
  onProgress?.(`Stage 1: Screening ${articles.length} articles...`);
  const preliminary = await aiCurateFast(articles, onProgress);

  // Triage: split into low-scoring and candidates
  const scoredIds = new Set(preliminary.map(p => p.id));
  const prelimMap = new Map(preliminary.map(p => [p.id, p.prelimScore]));
  const candidates: import("./types").Article[] = [];
  const lowArticles: Array<{ article: import("./types").Article; prelimScore: number }> = [];

  for (const article of articles) {
    const prelimScore = prelimMap.get(article.id);
    if (prelimScore === undefined) {
      // Not returned by Stage 1 — treat as candidate to avoid dropping
      candidates.push(article);
    } else if (prelimScore < lowThreshold) {
      lowArticles.push({ article, prelimScore });
    } else {
      candidates.push(article);
    }
  }

  onProgress?.(`Triage: ${candidates.length} candidates, ${lowArticles.length} low-priority`);

  // Stage 2: Precision re-evaluation for candidates
  const reranked = await aiRerankCandidates(candidates, onProgress);

  // Summarize low-scoring articles (score preserved from Stage 1)
  const lowResults = await aiSummarizeLow(lowArticles, onProgress);

  // Save all results
  let curated = 0;
  for (const r of [...reranked, ...lowResults]) {
    if (r.id && typeof r.score === "number" && r.summary) {
      const tags = r.tags ? normalizeTags(r.tags) : r.tags;
      updateArticleCuration(r.id, r.score, r.summary, tags);
      curated++;
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

  const ranked = rankByBlendedScore(unread);
  const candidateLimit = Math.min(ranked.length, maxArticles * 3, 50);
  const candidates = ranked.slice(0, candidateLimit);

  const articlesJson = candidates.map(a => ({
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
    const today = getLocalDateKey();
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

  const language = getConfig("language") ?? "en";
  const prompt = `You are an RSS feed discovery assistant. Find RSS/Atom feeds related to this topic: "${topic}"

Search for blogs, news sites, and publications about this topic. For each feed found, verify it's a real RSS/Atom feed URL (ending in /feed, /rss, /atom.xml, /feed.xml, /rss.xml, /index.xml, or similar).

User's language: ${language}
If the topic is in a non-English language, include feeds in that language as well as relevant English feeds.

Return ONLY a JSON array (no markdown, no explanation):
[{"url": "https://example.com/feed.xml", "title": "Site Name", "description": "Brief description of what this feed covers"}]

Guidelines:
- Find 5-10 high-quality feeds
- Prefer actively maintained feeds
- Include a mix of individual blogs and official project blogs
- Only include publicly accessible feeds (no auth required)
- Make sure URLs are actual feed URLs, not regular web pages
- Include feeds in the topic's language when applicable`;

  const response = await callClaude(prompt, { allowedTools: ["WebSearch", "WebFetch"] });
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

export async function aiGenerateMemo(onProgress?: (msg: string) => void): Promise<string | null> {
  const actions = getRecentActions(90, 100);
  if (actions.length < 10) {
    const msg = "Not enough reading history for preference memo (need 10+).";
    console.log(msg);
    onProgress?.(msg);
    return null;
  }

  const language = getConfig("language") ?? "en";
  const actionsJson = actions.map(a => ({
    title: a.title,
    summary: a.summary,
    tags: a.tags,
    score: a.score,
    action: a.action,
  }));

  const prompt = `You are a reading preference analyst. Analyze the user's reading behavior and write a concise semantic preference memo.

Recent articles the user interacted with (action: "read" = user chose to read, "dismissed" = user skipped):
${JSON.stringify(actionsJson, null, 2)}

Write a preference memo in ${language} that captures:
- **Prefers**: What topics, styles, and depth levels the user gravitates toward
- **Avoids**: What types of content the user consistently skips
- **Recent interest shift**: Any emerging trends in their reading

Rules:
- Focus on SEMANTIC patterns (e.g. "prefers hands-on tutorials with code" not "reads articles tagged 'coding'")
- Do NOT repeat tag statistics — capture the WHY behind the reading choices
- Keep each bullet to one line
- Write 3-7 bullet points total
- Output ONLY the bullet list, no headers or explanation`;

  onProgress?.("Generating preference memo...");
  const response = await callClaude(prompt);
  if (!response) {
    console.error("Failed to generate preference memo.");
    return null;
  }

  const memo = response.trim();
  if (!memo) {
    console.error("Empty preference memo received.");
    return null;
  }
  savePreferenceMemo(memo);
  const msg = "Preference memo updated.";
  console.log(msg);
  onProgress?.(msg);
  return memo;
}
