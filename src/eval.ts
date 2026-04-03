/**
 * LLM-as-judge evaluation framework for curation quality.
 *
 * Evaluates curation results (score, summary, tags) against article content
 * using Claude CLI as an independent judge. Also computes behavioral metrics
 * from user read/dismiss patterns.
 */
import { spawn } from "child_process";
import { db } from "./db";
import { getConfig } from "./config";
import type { Article } from "./types";

export interface EvalArticle {
  id: number;
  title: string | null;
  url: string;
  content_head: string;
  score: number;
  summary: string;
  tags: string | null;
  read_at: string | null;
  dismissed_at: string | null;
}

export interface JudgeResult {
  article_id: number;
  score_accuracy: number;   // 1-5: Is the curation score appropriate for this content?
  summary_quality: number;  // 1-5: Accurate, concise, informative?
  tag_relevance: number;    // 1-5: Do tags match the article content?
  reasoning: string;        // Brief explanation
}

export interface BehavioralMetrics {
  total_curated: number;
  total_read: number;
  total_dismissed: number;
  read_rate: number;
  score_bands: Array<{
    band: string;
    min: number;
    max: number;
    total: number;
    read: number;
    dismissed: number;
    read_rate: number;
  }>;
}

export interface EvalReport {
  date: string;
  sample_size: number;
  elapsed_ms: number;
  behavioral: BehavioralMetrics;
  judge_results: JudgeResult[];
  judge_summary: {
    avg_score_accuracy: number;
    avg_summary_quality: number;
    avg_tag_relevance: number;
    avg_overall: number;
  };
}

export interface ComparisonResult {
  baseline_date: string;
  current_date: string;
  judge: {
    metric: string;
    baseline: number;
    current: number;
    delta: number;
  }[];
  behavioral: {
    metric: string;
    baseline: number;
    current: number;
    delta: number;
  }[];
  timing: {
    baseline_ms: number;
    current_ms: number;
    delta_ms: number;
  };
}

/** Compare two eval reports and return structured deltas */
export function compareReports(baseline: EvalReport, current: EvalReport): ComparisonResult {
  const judgeMetrics = [
    { metric: "Score accuracy", key: "avg_score_accuracy" as const },
    { metric: "Summary quality", key: "avg_summary_quality" as const },
    { metric: "Tag relevance", key: "avg_tag_relevance" as const },
    { metric: "Overall", key: "avg_overall" as const },
  ];

  return {
    baseline_date: baseline.date,
    current_date: current.date,
    judge: judgeMetrics.map(m => ({
      metric: m.metric,
      baseline: baseline.judge_summary[m.key],
      current: current.judge_summary[m.key],
      delta: current.judge_summary[m.key] - baseline.judge_summary[m.key],
    })),
    behavioral: [
      {
        metric: "Read rate",
        baseline: baseline.behavioral.read_rate,
        current: current.behavioral.read_rate,
        delta: current.behavioral.read_rate - baseline.behavioral.read_rate,
      },
    ],
    timing: {
      baseline_ms: baseline.elapsed_ms ?? 0,
      current_ms: current.elapsed_ms ?? 0,
      delta_ms: (current.elapsed_ms ?? 0) - (baseline.elapsed_ms ?? 0),
    },
  };
}

/** Sample curated articles for evaluation */
export function sampleArticles(limit: number = 50): EvalArticle[] {
  return db.prepare(
    `SELECT id, title, url, content, score, summary, tags, read_at, dismissed_at
     FROM articles
     WHERE curated_at IS NOT NULL AND score IS NOT NULL AND summary IS NOT NULL
     ORDER BY RANDOM()
     LIMIT ?`
  ).all(limit).map((row: any) => ({
    id: row.id,
    title: row.title,
    url: row.url,
    content_head: (row.content ?? "").slice(0, 500),
    score: row.score,
    summary: row.summary,
    tags: row.tags,
    read_at: row.read_at,
    dismissed_at: row.dismissed_at,
  }));
}

/** Compute behavioral metrics from user actions */
export function computeBehavioralMetrics(): BehavioralMetrics {
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      COALESCE(SUM(CASE WHEN read_at IS NOT NULL THEN 1 ELSE 0 END), 0) as read_count,
      COALESCE(SUM(CASE WHEN dismissed_at IS NOT NULL THEN 1 ELSE 0 END), 0) as dismissed_count
    FROM articles
    WHERE curated_at IS NOT NULL AND score IS NOT NULL
  `).get() as { total: number; read_count: number; dismissed_count: number };

  const bands = [
    { band: "Must Read (85-100)", min: 0.85, max: 1.0 },
    { band: "Recommended (70-85)", min: 0.70, max: 0.85 },
    { band: "Worth a Look (50-70)", min: 0.50, max: 0.70 },
    { band: "Low Priority (0-50)", min: 0.0, max: 0.50 },
  ];

  const scoreBands = bands.map(b => {
    const row = db.prepare(`
      SELECT
        COUNT(*) as total,
        COALESCE(SUM(CASE WHEN read_at IS NOT NULL THEN 1 ELSE 0 END), 0) as read_count,
        COALESCE(SUM(CASE WHEN dismissed_at IS NOT NULL THEN 1 ELSE 0 END), 0) as dismissed_count
      FROM articles
      WHERE curated_at IS NOT NULL AND score IS NOT NULL
        AND score >= ? AND score < ?
    `).get(b.min, b.max === 1.0 ? 1.01 : b.max) as { total: number; read_count: number; dismissed_count: number };

    return {
      band: b.band,
      min: b.min,
      max: b.max,
      total: row.total,
      read: row.read_count,
      dismissed: row.dismissed_count,
      read_rate: row.total > 0 ? row.read_count / row.total : 0,
    };
  });

  return {
    total_curated: stats.total,
    total_read: stats.read_count,
    total_dismissed: stats.dismissed_count,
    read_rate: stats.total > 0 ? stats.read_count / stats.total : 0,
    score_bands: scoreBands,
  };
}

function callClaudeSync(prompt: string): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn("claude", ["-p", "--output-format", "json", prompt]);
    let stdout = "";
    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    const timer = setTimeout(() => { proc.kill(); resolve(null); }, 120_000);
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) { resolve(null); return; }
      try {
        const json = JSON.parse(stdout);
        resolve(json.is_error ? null : (json.result as string)?.trim() ?? null);
      } catch {
        resolve(stdout.trim());
      }
    });
    proc.on("error", () => { clearTimeout(timer); resolve(null); });
  });
}

/** Use Claude as judge to evaluate curation quality for a batch of articles */
export async function judgeArticles(
  articles: EvalArticle[],
  onProgress?: (msg: string) => void,
): Promise<JudgeResult[]> {
  if (articles.length === 0) return [];

  const language = getConfig("language") ?? "en";
  const batchSize = 5;
  const results: JudgeResult[] = [];

  for (let i = 0; i < articles.length; i += batchSize) {
    const batch = articles.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(articles.length / batchSize);
    onProgress?.(`Judging batch ${batchNum}/${totalBatches}...`);

    const articlesForJudge = batch.map(a => ({
      id: a.id,
      title: a.title,
      content_preview: a.content_head,
      curation_score: a.score,
      curation_summary: a.summary,
      curation_tags: a.tags,
    }));

    const prompt = `You are an independent quality evaluator for an RSS curation system.

For each article below, evaluate the quality of the automated curation:
- **score_accuracy** (1-5): Is the curation score (0.0-1.0) appropriate for this content? Higher scores should mean more novel, deep, and useful articles.
- **summary_quality** (1-5): Is the summary accurate, concise, and informative?
- **tag_relevance** (1-5): Do the tags accurately describe the article's topics?

Articles to evaluate:
${JSON.stringify(articlesForJudge, null, 2)}

Respond with ONLY a JSON array (no markdown, no explanation):
[{"article_id": <number>, "score_accuracy": <1-5>, "summary_quality": <1-5>, "tag_relevance": <1-5>, "reasoning": "<brief explanation in ${language}>"}]`;

    const response = await callClaudeSync(prompt);
    if (!response) {
      onProgress?.(`Batch ${batchNum} failed, skipping.`);
      continue;
    }

    try {
      const match = response.match(/\[[\s\S]*\]/);
      if (!match) continue;
      const parsed = JSON.parse(match[0]) as JudgeResult[];
      for (const r of parsed) {
        if (r.article_id && typeof r.score_accuracy === "number") {
          results.push(r);
        }
      }
    } catch {
      onProgress?.(`Batch ${batchNum} parse error, skipping.`);
    }
  }

  return results;
}

/** Generate full evaluation report */
export async function runEvaluation(
  sampleSize: number = 50,
  onProgress?: (msg: string) => void,
): Promise<EvalReport> {
  const startTime = Date.now();

  onProgress?.("Sampling articles...");
  const articles = sampleArticles(sampleSize);
  onProgress?.(`Sampled ${articles.length} articles.`);

  onProgress?.("Computing behavioral metrics...");
  const behavioral = computeBehavioralMetrics();

  onProgress?.("Running LLM-as-judge...");
  const judgeResults = await judgeArticles(articles, onProgress);

  const avgOrZero = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  const judgeSummary = {
    avg_score_accuracy: avgOrZero(judgeResults.map(r => r.score_accuracy)),
    avg_summary_quality: avgOrZero(judgeResults.map(r => r.summary_quality)),
    avg_tag_relevance: avgOrZero(judgeResults.map(r => r.tag_relevance)),
    avg_overall: avgOrZero(judgeResults.map(r => (r.score_accuracy + r.summary_quality + r.tag_relevance) / 3)),
  };

  return {
    date: new Date().toISOString().slice(0, 10),
    sample_size: articles.length,
    elapsed_ms: Date.now() - startTime,
    behavioral,
    judge_results: judgeResults,
    judge_summary: judgeSummary,
  };
}
