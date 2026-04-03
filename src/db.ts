import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

const DEFAULT_DIR = join(homedir(), ".feed-curator");
const DB_PATH = process.env.DB_PATH ?? join(DEFAULT_DIR, "feed-curator.db");
mkdirSync(dirname(DB_PATH), { recursive: true });

const IS_BUN = typeof globalThis.Bun !== "undefined";

// ─── Bun native SQLite backend ───

function createBunDb() {
  // Dynamic import to avoid Node.js parse errors
  const { Database } = require("bun:sqlite");
  const bunDb = new Database(DB_PATH, { create: true });

  class BunCompatDatabase {
    prepare(sql: string) {
      return {
        get(...params: unknown[]): unknown {
          const stmt = bunDb.prepare(sql);
          return params.length > 0 ? stmt.get(...params) : stmt.get();
        },
        all(...params: unknown[]): unknown[] {
          const stmt = bunDb.prepare(sql);
          return params.length > 0 ? stmt.all(...params) : stmt.all();
        },
        run(...params: unknown[]): { changes: number } {
          const stmt = bunDb.prepare(sql);
          const result = params.length > 0 ? stmt.run(...params) : stmt.run();
          return { changes: result.changes };
        },
      };
    }
    exec(sql: string): void {
      bunDb.exec(sql);
    }
    pragma(str: string): void {
      bunDb.exec(`PRAGMA ${str}`);
    }
  }

  return new BunCompatDatabase();
}

// ─── sql.js (WASM) backend for Node.js ───

async function createSqlJsDb() {
  const initSqlJs = (await import("sql.js")).default;
  const SQL = await initSqlJs();

  const fileBuffer = existsSync(DB_PATH) ? readFileSync(DB_PATH) : undefined;
  const sqlDb = fileBuffer ? new SQL.Database(fileBuffer) : new SQL.Database();

  let dirty = false;

  function flush(): void {
    if (!dirty) return;
    const data = sqlDb.export();
    writeFileSync(DB_PATH, Buffer.from(data));
    sqlDb.run("PRAGMA foreign_keys = ON");
    dirty = false;
  }

  function scheduleSave(): void {
    if (!dirty) {
      dirty = true;
      queueMicrotask(flush);
    }
  }

  process.on("exit", flush);

  class SqlJsCompatDatabase {
    prepare(sql: string) {
      return {
        get(...params: unknown[]): unknown {
          const stmt = sqlDb.prepare(sql);
          try {
            if (params.length > 0) stmt.bind(params);
            if (stmt.step()) return stmt.getAsObject();
            return undefined;
          } finally {
            stmt.free();
          }
        },
        all(...params: unknown[]): unknown[] {
          const stmt = sqlDb.prepare(sql);
          const results: unknown[] = [];
          try {
            if (params.length > 0) stmt.bind(params);
            while (stmt.step()) results.push(stmt.getAsObject());
            return results;
          } finally {
            stmt.free();
          }
        },
        run(...params: unknown[]): { changes: number } {
          sqlDb.run(sql, params as any[]);
          const changes = sqlDb.getRowsModified();
          scheduleSave();
          return { changes };
        },
      };
    }
    exec(sql: string): void {
      sqlDb.exec(sql);
      scheduleSave();
    }
    pragma(str: string): void {
      sqlDb.run(`PRAGMA ${str}`);
    }
  }

  return new SqlJsCompatDatabase();
}

// ─── Initialize the appropriate backend ───

export const db = IS_BUN ? createBunDb() : await createSqlJsDb();

// ─── Schema (shared) ───

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS feeds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL UNIQUE,
    title TEXT,
    last_fetched_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);

db.exec(`
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

db.exec("CREATE INDEX IF NOT EXISTS idx_articles_feed_id ON articles(feed_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_articles_curated_at ON articles(curated_at)");
db.exec("CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at)");
db.exec("CREATE INDEX IF NOT EXISTS idx_articles_score ON articles(score)");

db.exec(`
  CREATE TABLE IF NOT EXISTS briefings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL UNIQUE,
    clusters TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// Migrations
for (const [table, col] of [
  ["articles", "read_at TEXT"],
  ["articles", "tags TEXT"],
  ["feeds", "category TEXT"],
  ["articles", "dismissed_at TEXT"],
  ["articles", "archived_at TEXT"],
  ["articles", "canonical_url TEXT"],
  ["articles", "duplicate_of INTEGER REFERENCES articles(id)"],
]) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col}`);
  } catch {
    // column already exists
  }
}

db.exec("CREATE INDEX IF NOT EXISTS idx_articles_dismissed_at ON articles(dismissed_at)");
db.exec("CREATE INDEX IF NOT EXISTS idx_articles_archived_at ON articles(archived_at)");
db.exec("CREATE INDEX IF NOT EXISTS idx_articles_canonical_url ON articles(canonical_url)");
db.exec("CREATE INDEX IF NOT EXISTS idx_articles_duplicate_of ON articles(duplicate_of)");
