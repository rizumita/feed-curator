import { db } from "./db";
import { getConfig, setConfig } from "./config";

export interface RecentAction {
  title: string | null;
  summary: string | null;
  tags: string | null;
  score: number | null;
  action: "read" | "dismissed";
}

export function getPreferenceMemo(): string | null {
  return getConfig("preference_memo");
}

export function savePreferenceMemo(memo: string): void {
  setConfig("preference_memo", memo);
  setConfig("preference_memo_updated_at", new Date().toISOString());
}

export function isPreferenceMemoStale(): boolean {
  const updatedAt = getConfig("preference_memo_updated_at");
  if (!updatedAt) return true;

  const elapsed = Date.now() - new Date(updatedAt).getTime();
  if (Number.isNaN(elapsed)) return true;
  const oneDayMs = 24 * 60 * 60 * 1000;
  if (elapsed < oneDayMs) return false;

  const newActions = db.prepare(
    `SELECT COUNT(*) as cnt FROM articles
     WHERE (read_at > ? OR dismissed_at > ?)
       AND curated_at IS NOT NULL`
  ).get(updatedAt, updatedAt) as { cnt: number };
  return newActions.cnt >= 20;
}

export function getRecentActions(days: number, limit: number): RecentAction[] {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  return db.prepare(
    `SELECT title, summary, tags, score,
            CASE WHEN read_at IS NOT NULL THEN 'read' ELSE 'dismissed' END as action
     FROM articles
     WHERE curated_at IS NOT NULL
       AND (read_at > ? OR dismissed_at > ?)
     ORDER BY COALESCE(read_at, dismissed_at) DESC
     LIMIT ?`
  ).all(cutoff, cutoff, limit) as RecentAction[];
}
