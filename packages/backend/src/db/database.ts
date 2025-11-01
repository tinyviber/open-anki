import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { Pool } from 'pg';

const require = createRequire(import.meta.url);
const { getDatabaseUrl } = require('../../scripts/getDatabaseUrl.cjs') as {
  getDatabaseUrl: () => string;
};

export type QueryResult<Row = any> = { rows: Row[] };

export interface QueryClient {
  query: (text: string, params?: unknown[]) => Promise<QueryResult>;
  release: () => Promise<void> | void;
}

export type DatabaseProvider = 'postgres' | 'sqlite';

interface DatabaseAdapter {
  readonly provider: DatabaseProvider;
  getClient(): Promise<QueryClient>;
  query(text: string, params?: unknown[]): Promise<QueryResult>;
  close(): Promise<void>;
}

type QueryablePool = Pick<Pool, 'query' | 'connect' | 'end'>;

interface SqliteStatement {
  all: (...params: unknown[]) => Array<Record<string, unknown>>;
  run: (...params: unknown[]) => unknown;
}

interface SqliteDatabase {
  prepare: (sql: string) => SqliteStatement;
  close: () => void;
}

class PostgresAdapter implements DatabaseAdapter {
  readonly provider: DatabaseProvider = 'postgres';
  private readonly pool: QueryablePool;

  constructor(pool?: QueryablePool) {
    if (pool) {
      this.pool = pool;
    } else {
      const connectionString = getDatabaseUrl();
      this.pool = new Pool({ connectionString });
    }
  }

  async getClient(): Promise<QueryClient> {
    const client = await this.pool.connect();
    return client as unknown as QueryClient;
  }

  async query(text: string, params?: unknown[]): Promise<QueryResult> {
    const result = await this.pool.query(text, params);
    return result as unknown as QueryResult;
  }

  async close(): Promise<void> {
    if (typeof this.pool.end === 'function') {
      await this.pool.end();
    }
  }
}

class SqliteQueryClient implements QueryClient {
  constructor(private readonly db: SqliteDatabase) {}

  async query(text: string, params?: unknown[]): Promise<QueryResult> {
    return executeSqliteQuery(this.db, text, params ?? []);
  }

  async release(): Promise<void> {
    // better-sqlite3 does not require releasing connections; no-op.
  }
}

class SqliteAdapter implements DatabaseAdapter {
  readonly provider: DatabaseProvider = 'sqlite';
  private readonly db: SqliteDatabase;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = createSqliteDatabase(dbPath);
    initializeSqliteSchema(this.db);
  }

  async getClient(): Promise<QueryClient> {
    return new SqliteQueryClient(this.db);
  }

  async query(text: string, params?: unknown[]): Promise<QueryResult> {
    return executeSqliteQuery(this.db, text, params ?? []);
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

let activeAdapter: DatabaseAdapter | null = null;
let testAdapter: DatabaseAdapter | null = null;

const SQLITE_ENV_FLAG = 'SQLITE_DB_PATH';
const PROVIDER_ENV = 'DB_PROVIDER';
const DEFAULT_SQLITE_PATH = path.resolve(process.cwd(), 'packages/backend/.data/dev.sqlite');

function resolveProviderFromEnv(): DatabaseProvider {
  const configuredProvider = process.env[PROVIDER_ENV]?.toLowerCase();
  if (configuredProvider === 'sqlite') {
    return 'sqlite';
  }
  if (configuredProvider === 'postgres') {
    return 'postgres';
  }
  if (process.env[SQLITE_ENV_FLAG]) {
    return 'sqlite';
  }
  return 'postgres';
}

function getSqlitePath(): string {
  return process.env[SQLITE_ENV_FLAG] ?? DEFAULT_SQLITE_PATH;
}

function createAdapter(): DatabaseAdapter {
  if (testAdapter) {
    return testAdapter;
  }
  const provider = resolveProviderFromEnv();
  if (provider === 'sqlite') {
    return new SqliteAdapter(getSqlitePath());
  }
  return new PostgresAdapter();
}

function getAdapter(): DatabaseAdapter {
  if (testAdapter) {
    return testAdapter;
  }
  if (!activeAdapter) {
    activeAdapter = createAdapter();
  }
  return activeAdapter;
}

export function getDatabaseProvider(): DatabaseProvider {
  return getAdapter().provider;
}

export async function getQueryClient(): Promise<QueryClient> {
  return getAdapter().getClient();
}

export function query(text: string, params?: unknown[]): Promise<QueryResult> {
  return getAdapter().query(text, params);
}

export async function closeDatabase(): Promise<void> {
  if (testAdapter) {
    await testAdapter.close();
    testAdapter = null;
  }
  if (activeAdapter) {
    await activeAdapter.close();
    activeAdapter = null;
  }
}

export function setTestPool(pool: QueryablePool | null): void {
  if (testAdapter) {
    void testAdapter.close();
    testAdapter = null;
  }
  if (!pool) {
    activeAdapter = null;
    return;
  }
  testAdapter = new PostgresAdapter(pool);
  activeAdapter = null;
}

interface SqliteQueryTransformResult {
  sql: string;
  params: unknown[];
}

function convertPostgresSqlToSqlite(text: string, params: unknown[]): SqliteQueryTransformResult {
  const placeholderMatches = [...text.matchAll(/\$(\d+)/g)];
  if (placeholderMatches.length === 0) {
    return {
      sql: sanitizeSql(text),
      params,
    };
  }

  const orderedParams = placeholderMatches.map(match => {
    const index = Number(match[1]) - 1;
    if (index < 0 || index >= params.length) {
      return undefined;
    }
    return params[index];
  });

  const sql = sanitizeSql(text.replace(/\$(\d+)/g, '?'));
  return { sql, params: orderedParams };
}

function sanitizeSql(sql: string): string {
  let sanitized = sql;
  sanitized = sanitized.replace(/NOW\(\)/gi, 'CURRENT_TIMESTAMP');
  sanitized = sanitized.replace(/::\s*jsonb/gi, '');
  sanitized = sanitized.replace(/::\s*text/gi, '');
  sanitized = sanitized.replace(/\s+FOR\s+UPDATE/gi, '');
  sanitized = sanitized.replace(/;\s*$/g, '');
  return sanitized;
}

const JSON_COLUMNS = new Set([
  'config',
  'fields',
  'tags',
  'payload',
  'diff',
]);

function executeSqliteQuery(db: SqliteDatabase, text: string, params: unknown[]): QueryResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return { rows: [] };
  }

  const normalized = trimmed.toUpperCase();
  if (normalized === 'BEGIN') {
    runSqlStatements(db, 'BEGIN');
    return { rows: [] };
  }
  if (normalized === 'COMMIT') {
    runSqlStatements(db, 'COMMIT');
    return { rows: [] };
  }
  if (normalized === 'ROLLBACK') {
    runSqlStatements(db, 'ROLLBACK');
    return { rows: [] };
  }
  if (/^SELECT\s+set_config/iu.test(trimmed)) {
    return { rows: [] };
  }

  const { sql, params: orderedParams } = convertPostgresSqlToSqlite(text, params);
  const statement = db.prepare(sql);

  const finalParams = orderedParams.length > 0 ? orderedParams : params;
  const boundParams = finalParams.map(value => serializeSqliteValue(value));

  if (isReadOnlySql(sql)) {
    const rawRows = statement.all(...boundParams) as Array<Record<string, unknown>>;
    const rows = rawRows.map(row => deserializeSqliteRow(row));
    return { rows };
  }

  statement.run(...boundParams);
  return { rows: [] };
}

function runSqlStatements(db: SqliteDatabase, sql: string) {
  const statements = sql
    .split(';')
    .map(part => part.trim())
    .filter(Boolean);

  for (const statementSql of statements) {
    db.prepare(statementSql).run();
  }
}

function isReadOnlySql(sql: string): boolean {
  const normalized = sql.trim().toUpperCase();
  return normalized.startsWith('SELECT') || normalized.startsWith('WITH') || normalized.startsWith('PRAGMA');
}

function serializeSqliteValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value) || typeof value === 'object') {
    return JSON.stringify(value);
  }
  return value;
}

function deserializeSqliteRow<Row extends Record<string, unknown>>(row: Row): Row {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value == null) {
      result[key] = value;
      continue;
    }

    if (JSON_COLUMNS.has(key)) {
      if (typeof value === 'string') {
        try {
          result[key] = JSON.parse(value);
          continue;
        } catch {
          result[key] = value;
          continue;
        }
      }
    }

    if (typeof value === 'string' && ISO_DATE_REGEX.test(value)) {
      result[key] = new Date(value);
      continue;
    }

    result[key] = value;
  }
  return result as Row;
}

const ISO_DATE_REGEX = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

type SqliteConstructor = new (path: string, options?: unknown) => SqliteDatabase;

function createSqliteDatabase(dbPath: string): SqliteDatabase {
  const Constructor = loadSqliteConstructor();
  const instance = new Constructor(dbPath);
  tryEnableForeignKeys(instance);
  return instance;
}

function tryEnableForeignKeys(db: SqliteDatabase) {
  runSqlStatements(db, 'PRAGMA foreign_keys = ON;');
}

function loadSqliteConstructor(): SqliteConstructor {
  if (typeof process.versions?.bun === 'string') {
    try {
      const bunModule = require('bun:sqlite');
      const ctor = (bunModule?.Database ?? bunModule?.default ?? bunModule) as SqliteConstructor | undefined;
      if (typeof ctor === 'function') {
        return ctor as SqliteConstructor;
      }
    } catch {
      // Ignore bun:sqlite resolution failures and fall back to better-sqlite3.
    }
  }

  try {
    const betterSqlite = require('better-sqlite3');
    const ctor = (betterSqlite?.default ?? betterSqlite) as SqliteConstructor | undefined;
    if (typeof ctor === 'function') {
      return ctor as SqliteConstructor;
    }
    throw new Error('Invalid better-sqlite3 export.');
  } catch (error) {
    throw new Error(
      'SQLite support requires installing the better-sqlite3 package (or running under Bun with bun:sqlite available).'
    );
  }
}

function initializeSqliteSchema(db: SqliteDatabase) {
  runSqlStatements(
    db,
    `
    CREATE TABLE IF NOT EXISTS decks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      config TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      deck_id TEXT NOT NULL,
      model_name TEXT NOT NULL,
      fields TEXT NOT NULL,
      tags TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      note_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      due TEXT,
      interval INTEGER,
      ease_factor REAL,
      reps INTEGER,
      lapses INTEGER,
      card_type INTEGER,
      queue INTEGER,
      original_due INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS review_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      card_id TEXT NOT NULL,
      timestamp TEXT,
      rating INTEGER,
      duration_ms INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sync_meta (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      version INTEGER NOT NULL,
      op TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      payload TEXT,
      device_id TEXT,
      diff TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, entity_id, version)
    );

    CREATE TABLE IF NOT EXISTS device_sync_progress (
      user_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      last_version INTEGER NOT NULL DEFAULT 0,
      last_meta_id TEXT,
      continuation_token TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, device_id)
    );

    CREATE INDEX IF NOT EXISTS idx_decks_user_id ON decks(user_id);
    CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes(user_id);
    CREATE INDEX IF NOT EXISTS idx_notes_deck_id ON notes(deck_id);
    CREATE INDEX IF NOT EXISTS idx_cards_user_id ON cards(user_id);
    CREATE INDEX IF NOT EXISTS idx_cards_note_id ON cards(note_id);
    CREATE INDEX IF NOT EXISTS idx_review_logs_user_id ON review_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_review_logs_card_id ON review_logs(card_id);
    CREATE INDEX IF NOT EXISTS idx_sync_meta_user_id ON sync_meta(user_id);
    CREATE INDEX IF NOT EXISTS idx_sync_meta_entity ON sync_meta(entity_id, entity_type);
    CREATE INDEX IF NOT EXISTS idx_sync_meta_user_version ON sync_meta(user_id, version);
    CREATE INDEX IF NOT EXISTS idx_device_sync_progress_user ON device_sync_progress(user_id);
  `
  );
}
