import { db } from "./db";
import { getPreferenceMemo } from "./article";

interface TagStat {
  tag: string;
  total: number;
  read: number;
  readRate: number;
}

interface ActionStat {
  tag: string;
  total: number;
  count: number;
  rate: number;
}

interface FeedStat {
  feed_id: number;
  title: string;
  category: string | null;
  total: number;
  read: number;
  readRate: number;
}

interface ScoreBand {
  band: string;
  total: number;
  read: number;
  readRate: number;
}

export interface UserProfile {
  totalCurated: number;
  totalRead: number;
  overallReadRate: number;
  preferredTags: TagStat[];
  ignoredTags: TagStat[];
  feedStats: FeedStat[];
  scoreBands: ScoreBand[];
  totalDismissed: number;
  dismissRate: number;
  dismissedTags: ActionStat[];
}

// Exponential decay with 30-day half-life
const HALF_LIFE_DAYS = 30;
const DECAY_LAMBDA = Math.LN2 / HALF_LIFE_DAYS;

export function decayWeight(dateStr: string | null): number {
  if (!dateStr) return 0.5; // fallback for missing dates
  const ts = new Date(dateStr).getTime();
  if (Number.isNaN(ts)) return 0.5; // invalid date fallback
  const daysAgo = (Date.now() - ts) / (1000 * 60 * 60 * 24);
  if (daysAgo < 0) return 1;
  return Math.max(Number.MIN_VALUE, Math.exp(-DECAY_LAMBDA * daysAgo));
}

export function generateProfile(): UserProfile {
  const curated = db
    .prepare(
      `SELECT a.*, f.title as feed_title, f.category
       FROM articles a
       LEFT JOIN feeds f ON a.feed_id = f.id
       WHERE a.curated_at IS NOT NULL`
    )
    .all() as any[];

  const totalCurated = curated.length;
  const totalRead = curated.filter((a) => a.read_at).length;
  const totalDismissed = curated.filter((a) => a.dismissed_at).length;
  const overallReadRate = totalCurated > 0 ? totalRead / totalCurated : 0;
  const dismissRate = (totalDismissed + totalRead) > 0 ? totalDismissed / (totalDismissed + totalRead) : 0;

  // Single-pass: collect tag, dismiss, and feed stats with time decay
  const tagMap = new Map<string, { total: number; read: number }>();
  const dismissTagMap = new Map<string, { total: number; dismissed: number }>();
  const feedMap = new Map<number, { title: string; category: string | null; total: number; read: number }>();

  for (const a of curated) {
    // Feed stats (decay based on read action date)
    if (a.feed_id) {
      const fw = decayWeight(a.read_at ?? a.curated_at);
      const fstat = feedMap.get(a.feed_id) ?? { title: a.feed_title ?? "", category: a.category, total: 0, read: 0 };
      fstat.total += fw;
      if (a.read_at) fstat.read += fw;
      feedMap.set(a.feed_id, fstat);
    }

    if (!a.tags) continue;
    const tags = a.tags.split(",");
    const readW = decayWeight(a.read_at ?? a.curated_at);
    const dismissW = decayWeight(a.dismissed_at ?? a.curated_at);

    for (const raw of tags) {
      const tag = raw.trim();
      if (!tag) continue;

      // Tag read stats
      const tstat = tagMap.get(tag) ?? { total: 0, read: 0 };
      tstat.total += readW;
      if (a.read_at) tstat.read += readW;
      tagMap.set(tag, tstat);

      // Tag dismiss stats
      const dstat = dismissTagMap.get(tag) ?? { total: 0, dismissed: 0 };
      dstat.total += dismissW;
      if (a.dismissed_at) dstat.dismissed += dismissW;
      dismissTagMap.set(tag, dstat);
    }
  }

  const tagStats: TagStat[] = [...tagMap.entries()]
    .map(([tag, s]) => ({ tag, ...s, readRate: s.total > 0 ? s.read / s.total : 0 }))
    .sort((a, b) => b.readRate - a.readRate);

  const preferredTags = tagStats.filter((t) => t.readRate > overallReadRate && t.total >= 3);
  const ignoredTags = tagStats.filter((t) => t.readRate < overallReadRate * 0.5 && t.total >= 3);

  const dismissedTags: ActionStat[] = [...dismissTagMap.entries()]
    .map(([tag, s]) => ({ tag, total: s.total, count: s.dismissed, rate: s.total > 0 ? s.dismissed / s.total : 0 }))
    .filter((t) => t.rate > dismissRate && t.total >= 3)
    .sort((a, b) => b.rate - a.rate);

  const feedStats: FeedStat[] = [...feedMap.entries()]
    .map(([feed_id, s]) => ({ feed_id, ...s, readRate: s.total > 0 ? s.read / s.total : 0 }))
    .sort((a, b) => b.readRate - a.readRate);

  // Score band stats
  const bands = [
    { band: "0.85-1.0 (Must Read)", min: 0.85, max: 1.01 },
    { band: "0.70-0.84 (Recommended)", min: 0.7, max: 0.85 },
    { band: "0.50-0.69 (Worth a Look)", min: 0.5, max: 0.7 },
    { band: "0.00-0.49 (Low Priority)", min: 0, max: 0.5 },
  ];

  const scoreBands: ScoreBand[] = bands.map((b) => {
    const inBand = curated.filter((a) => (a.score ?? 0) >= b.min && (a.score ?? 0) < b.max);
    const read = inBand.filter((a) => a.read_at).length;
    return { band: b.band, total: inBand.length, read, readRate: inBand.length > 0 ? read / inBand.length : 0 };
  });

  return { totalCurated, totalRead, overallReadRate, preferredTags, ignoredTags, feedStats, scoreBands, totalDismissed, dismissRate, dismissedTags };
}

export function formatProfile(p: UserProfile): string {
  let out = "=== User Reading Profile ===\n\n";
  out += `Total: ${p.totalCurated} curated, ${p.totalRead} read (${(p.overallReadRate * 100).toFixed(0)}%)\n\n`;

  out += "Score Bands:\n";
  for (const b of p.scoreBands) {
    out += `  ${b.band}: ${b.read}/${b.total} read (${(b.readRate * 100).toFixed(0)}%)\n`;
  }

  if (p.preferredTags.length > 0) {
    out += "\nPreferred Tags (read rate above average):\n";
    for (const t of p.preferredTags) {
      out += `  ${t.tag}: ${Math.round(t.read)}/${Math.round(t.total)} (${(t.readRate * 100).toFixed(0)}%)\n`;
    }
  }

  if (p.ignoredTags.length > 0) {
    out += "\nIgnored Tags (read rate below 50% of average):\n";
    for (const t of p.ignoredTags) {
      out += `  ${t.tag}: ${Math.round(t.read)}/${Math.round(t.total)} (${(t.readRate * 100).toFixed(0)}%)\n`;
    }
  }

  out += `\nDismissed: ${p.totalDismissed} (${(p.dismissRate * 100).toFixed(0)}% of actioned)\n`;

  if (p.dismissedTags.length > 0) {
    out += "\nFrequently Dismissed Tags:\n";
    for (const t of p.dismissedTags) {
      out += `  ${t.tag}: ${Math.round(t.count)}/${Math.round(t.total)} dismissed (${(t.rate * 100).toFixed(0)}%)\n`;
    }
  }

  out += "\nFeed Engagement:\n";
  for (const f of p.feedStats) {
    const cat = f.category ? ` [${f.category}]` : "";
    out += `  ${f.title || "Feed " + f.feed_id}${cat}: ${Math.round(f.read)}/${Math.round(f.total)} (${(f.readRate * 100).toFixed(0)}%)\n`;
  }

  return out;
}

export function profileForPrompt(p: UserProfile): string {
  const preferred = p.preferredTags.map((t) => t.tag).join(", ");
  const ignored = p.ignoredTags.map((t) => t.tag).join(", ");

  let prompt = "User reading preferences (based on read history):\n";
  prompt += `- Overall read rate: ${(p.overallReadRate * 100).toFixed(0)}%\n`;

  if (preferred) {
    prompt += `- Preferred tags (reads often): ${preferred}\n`;
  }
  if (ignored) {
    prompt += `- Ignored tags (rarely reads): ${ignored}\n`;
  }

  const topFeeds = p.feedStats.filter((f) => f.readRate > p.overallReadRate).map((f) => f.title || "Feed " + f.feed_id);
  if (topFeeds.length > 0) {
    prompt += `- Preferred sources: ${topFeeds.join(", ")}\n`;
  }

  if (p.dismissedTags.length > 0) {
    const dismissed = p.dismissedTags.map((t) => t.tag).join(", ");
    prompt += `- Frequently dismissed tags (user skips these): ${dismissed}\n`;
  }

  // Include score band reading patterns
  const activeBands = p.scoreBands.filter((b) => b.total > 0);
  if (activeBands.length > 0) {
    prompt += "- Reading patterns by score tier:\n";
    for (const b of activeBands) {
      prompt += `    ${b.band}: ${(b.readRate * 100).toFixed(0)}% read rate (${b.read}/${b.total})\n`;
    }
  }

  const memo = getPreferenceMemo();
  if (memo) {
    prompt += `\nSemantic preferences (AI-generated from reading history):\n${memo}\n`;
  }

  prompt += "\nAdjust scores accordingly: boost articles matching preferred tags/sources, lower scores for ignored and dismissed tags. Use score band patterns and semantic preferences to calibrate scoring.";
  return prompt;
}
