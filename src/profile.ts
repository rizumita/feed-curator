import { db } from "./db";

interface TagStat {
  tag: string;
  total: number;
  read: number;
  readRate: number;
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
  dismissedTags: TagStat[];
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

  // Tag stats
  const tagMap = new Map<string, { total: number; read: number }>();
  for (const a of curated) {
    if (!a.tags) continue;
    for (const raw of a.tags.split(",")) {
      const tag = raw.trim();
      if (!tag) continue;
      const stat = tagMap.get(tag) ?? { total: 0, read: 0 };
      stat.total++;
      if (a.read_at) stat.read++;
      tagMap.set(tag, stat);
    }
  }

  const tagStats: TagStat[] = [...tagMap.entries()]
    .map(([tag, s]) => ({ tag, ...s, readRate: s.total > 0 ? s.read / s.total : 0 }))
    .sort((a, b) => b.readRate - a.readRate);

  const preferredTags = tagStats.filter((t) => t.readRate > overallReadRate && t.total >= 3);
  const ignoredTags = tagStats.filter((t) => t.readRate < overallReadRate * 0.5 && t.total >= 3);

  // Dismissed tag stats
  const dismissTagMap = new Map<string, { total: number; dismissed: number }>();
  for (const a of curated) {
    if (!a.tags) continue;
    for (const raw of a.tags.split(",")) {
      const tag = raw.trim();
      if (!tag) continue;
      const stat = dismissTagMap.get(tag) ?? { total: 0, dismissed: 0 };
      stat.total++;
      if (a.dismissed_at) stat.dismissed++;
      dismissTagMap.set(tag, stat);
    }
  }

  const dismissedTags: TagStat[] = [...dismissTagMap.entries()]
    .map(([tag, s]) => ({ tag, total: s.total, read: s.dismissed, readRate: s.total > 0 ? s.dismissed / s.total : 0 }))
    .filter((t) => t.readRate > dismissRate && t.total >= 3)
    .sort((a, b) => b.readRate - a.readRate);

  // Feed stats
  const feedMap = new Map<number, { title: string; category: string | null; total: number; read: number }>();
  for (const a of curated) {
    if (!a.feed_id) continue;
    const stat = feedMap.get(a.feed_id) ?? { title: a.feed_title ?? "", category: a.category, total: 0, read: 0 };
    stat.total++;
    if (a.read_at) stat.read++;
    feedMap.set(a.feed_id, stat);
  }

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
      out += `  ${t.tag}: ${t.read}/${t.total} (${(t.readRate * 100).toFixed(0)}%)\n`;
    }
  }

  if (p.ignoredTags.length > 0) {
    out += "\nIgnored Tags (read rate below 50% of average):\n";
    for (const t of p.ignoredTags) {
      out += `  ${t.tag}: ${t.read}/${t.total} (${(t.readRate * 100).toFixed(0)}%)\n`;
    }
  }

  out += `\nDismissed: ${p.totalDismissed} (${(p.dismissRate * 100).toFixed(0)}% of actioned)\n`;

  if (p.dismissedTags.length > 0) {
    out += "\nFrequently Dismissed Tags:\n";
    for (const t of p.dismissedTags) {
      out += `  ${t.tag}: ${t.read}/${t.total} dismissed (${(t.readRate * 100).toFixed(0)}%)\n`;
    }
  }

  out += "\nFeed Engagement:\n";
  for (const f of p.feedStats) {
    const cat = f.category ? ` [${f.category}]` : "";
    out += `  ${f.title || "Feed " + f.feed_id}${cat}: ${f.read}/${f.total} (${(f.readRate * 100).toFixed(0)}%)\n`;
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

  prompt += "\nAdjust scores accordingly: boost articles matching preferred tags/sources, lower scores for ignored and dismissed tags.";
  return prompt;
}
