import { db } from "./db";
import { getLocalDateKey, getUtcDateKey } from "./date";
import type { Briefing, BriefingCluster } from "./types";

export function saveBriefing(date: string, clusters: BriefingCluster[]): void {
  db.prepare(
    "INSERT OR REPLACE INTO briefings (date, clusters) VALUES (?, ?)"
  ).run(date, JSON.stringify(clusters));
}

export function getBriefing(date: string): Briefing | null {
  return (
    (db.prepare("SELECT * FROM briefings WHERE date = ?").get(date) as Briefing) ?? null
  );
}

export function getTodayBriefing(): Briefing | null {
  const today = getLocalDateKey();
  const briefing = getBriefing(today);
  if (briefing) return briefing;

  const legacyUtcDate = getUtcDateKey();
  if (legacyUtcDate !== today) {
    return getBriefing(legacyUtcDate);
  }

  return null;
}
