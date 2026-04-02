import { db } from "./db";

export function getConfig(key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | null;
  return row?.value ?? null;
}

export function setConfig(key: string, value: string): void {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
}

export function getAutoArchiveDays(): number {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'auto_archive_days'").get() as { value: string } | null;
  if (!row) return 7;
  const days = parseInt(row.value, 10);
  return Number.isFinite(days) && days > 0 ? days : 7;
}

export function runAutoArchive(days: number): number {
  if (!Number.isFinite(days) || days <= 0) return 0;
  const result = db.prepare(
    `UPDATE articles
     SET archived_at = datetime('now')
     WHERE curated_at IS NOT NULL
       AND read_at IS NULL
       AND dismissed_at IS NULL
       AND archived_at IS NULL
       AND COALESCE(
         datetime(COALESCE(published_at, fetched_at), '+' || ? || ' days'),
         datetime(fetched_at, '+' || ? || ' days')
       ) < datetime('now')`
  ).run(days, days);
  return result.changes;
}
