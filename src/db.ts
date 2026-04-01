import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";

const DB_PATH = process.env.DB_PATH ?? "./data/feed-curator.db";

mkdirSync("./data", { recursive: true });

export const db = new Database(DB_PATH);

db.run("PRAGMA journal_mode = WAL");
db.run("PRAGMA foreign_keys = ON");

db.run(`
  CREATE TABLE IF NOT EXISTS feeds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL UNIQUE,
    title TEXT,
    last_fetched_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feed_id INTEGER,
    url TEXT NOT NULL UNIQUE,
    title TEXT,
    content TEXT,
    published_at TEXT,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
    score REAL,
    summary TEXT,
    curated_at TEXT,
    read_at TEXT,
    FOREIGN KEY (feed_id) REFERENCES feeds(id)
  )
`);

// Indexes
db.run("CREATE INDEX IF NOT EXISTS idx_articles_feed_id ON articles(feed_id)");
db.run("CREATE INDEX IF NOT EXISTS idx_articles_curated_at ON articles(curated_at)");
db.run("CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at)");
db.run("CREATE INDEX IF NOT EXISTS idx_articles_score ON articles(score)");

// Migrations
for (const [table, col] of [
  ["articles", "read_at TEXT"],
  ["articles", "tags TEXT"],
  ["feeds", "category TEXT"],
]) {
  try {
    db.run(`ALTER TABLE ${table} ADD COLUMN ${col}`);
  } catch {
    // column already exists
  }
}
