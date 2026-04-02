import { db } from "./db";
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
  const today = new Date().toISOString().slice(0, 10);
  return getBriefing(today);
}
