import fs from 'fs';
import os from 'node:os';
import path from 'path';
import { randomBytes } from 'node:crypto';
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';

export type SqlValue = number | string | Uint8Array | null;

export type BindParams =
  | Record<string, unknown>
  | Array<unknown>
  | undefined;

export interface QueryExecResult {
  columns: string[];
  values: unknown[][];
}

export interface CompatibleStatement {
  run(params?: BindParams): void;
  free(): void;
}

export interface CompatibleDatabase {
  readonly engine: 'node-sqlite-wal' | 'sql.js';
  readonly isWalMode: boolean;
  exec(sql: string, params?: BindParams): QueryExecResult[];
  run(sql: string, params?: BindParams): void;
  prepare(sql: string): CompatibleStatement;
  export(): Uint8Array;
  checkpoint?(): void;
  close(): void;
}

// Structural types for built-in node:sqlite (Node 22.12+ --experimental-sqlite & Node 24 / Electron 45)
interface NodeSqliteStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  columns?: () => Array<{ name: string }>;
  setReturnArrays?: (enabled: boolean) => void;
}

interface NodeSqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): NodeSqliteStatement;
  close(): void;
}

interface NodeSqliteModule {
  DatabaseSync: new (location: string) => NodeSqliteDatabase;
}

function normalizeParam(value: unknown): SqlValue {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (value instanceof Uint8Array) return value;
  return String(value);
}

function normalizeParamArray(params: BindParams): SqlValue[] {
  if (!params) return [];
  if (Array.isArray(params)) {
    return params.map((item) => normalizeParam(item));
  }
  return [];
}

function normalizeNamedParams(params: Record<string, unknown>): Record<string, SqlValue> {
  const out: Record<string, SqlValue> = {};
  for (const [k, v] of Object.entries(params)) {
    out[k] = normalizeParam(v);
  }
  return out;
}

function isLikelyQuery(sql: string): boolean {
  const cleaned = sql
    .replace(/^\s*(?:--[^\n]*\n|\/\*[\s\S]*?\*\/|\s)*/g, '')
    .trimStart();
  return /^(SELECT|PRAGMA|WITH|EXPLAIN|VALUES)\b/i.test(cleaned);
}

function hasMultipleStatements(sql: string): boolean {
  // Strip single/double quoted literals and comments before counting semicolons
  const stripped = sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/"(?:""|[^"])*"/g, '""')
    .trim();
  const withoutTrailing = stripped.replace(/;+\s*$/, '');
  return withoutTrailing.includes(';');
}

class NodeSqliteWalAdapter implements CompatibleDatabase {
  readonly engine = 'node-sqlite-wal' as const;
  readonly isWalMode = true;

  constructor(
    private readonly nativeDb: NodeSqliteDatabase,
    private readonly dbPath: string
  ) {
    // High-concurrency WAL settings suitable for 5,000+ invoices/day across LAN counters
    this.nativeDb.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;
      PRAGMA cache_size = -64000;
      PRAGMA temp_store = MEMORY;
      PRAGMA wal_autocheckpoint = 1000;
    `);
  }

  exec(sql: string, params?: BindParams): QueryExecResult[] {
    if (!params && hasMultipleStatements(sql)) {
      this.nativeDb.exec(sql);
      return [];
    }

    if (!isLikelyQuery(sql) && !/\bRETURNING\b/i.test(sql)) {
      this.run(sql, params);
      return [];
    }

    const stmt = this.nativeDb.prepare(sql);
    const useArrays = typeof stmt.setReturnArrays === 'function' && typeof stmt.columns === 'function';

    if (useArrays) {
      stmt.setReturnArrays!(true);
      const rawRows = (
        params && !Array.isArray(params)
          ? stmt.all(normalizeNamedParams(params))
          : stmt.all(...normalizeParamArray(params))
      ) as SqlValue[][];
      if (!rawRows.length) return [];
      const columns = stmt.columns!().map((col) => col.name);
      return [{ columns, values: rawRows }];
    }

    // Fallback path for Node 22.12 (where StatementSync returns plain objects)
    const rawRows = (
      params && !Array.isArray(params)
        ? stmt.all(normalizeNamedParams(params))
        : stmt.all(...normalizeParamArray(params))
    ) as Array<Record<string, SqlValue>>;

    if (!rawRows.length) return [];
    const columns = Object.keys(rawRows[0]);
    const values = rawRows.map((row) => columns.map((col) => row[col] ?? null));
    return [{ columns, values }];
  }

  run(sql: string, params?: BindParams): void {
    if (!params && hasMultipleStatements(sql)) {
      this.nativeDb.exec(sql);
      return;
    }
    if (!params) {
      this.nativeDb.exec(sql);
      return;
    }
    const stmt = this.nativeDb.prepare(sql);
    if (!Array.isArray(params)) {
      stmt.run(normalizeNamedParams(params));
    } else {
      stmt.run(...normalizeParamArray(params));
    }
  }

  prepare(sql: string): CompatibleStatement {
    const stmt = this.nativeDb.prepare(sql);
    return {
      run(params?: BindParams) {
        if (!params) {
          stmt.run();
        } else if (!Array.isArray(params)) {
          stmt.run(normalizeNamedParams(params));
        } else {
          stmt.run(...normalizeParamArray(params));
        }
      },
      free() {
        // node:sqlite statements are GC-managed
      },
    };
  }

  checkpoint(): void {
    try {
      this.nativeDb.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch {
      // Ignore busy checkpoint errors; WAL remains valid
    }
  }

  export(): Uint8Array {
    // Perform an online consistent hot snapshot (merges WAL safely without locking out readers)
    const tempBackupPath = path.join(
      os.tmpdir(),
      `aptpos-hot-backup-${process.pid}-${randomBytes(6).toString('hex')}.sqlite`
    );
    try {
      const escaped = tempBackupPath.replace(/'/g, "''");
      this.nativeDb.exec(`VACUUM INTO '${escaped}'`);
      return new Uint8Array(fs.readFileSync(tempBackupPath));
    } catch {
      // Fallback: checkpoint WAL and read the primary file
      this.checkpoint();
      return new Uint8Array(fs.readFileSync(this.dbPath));
    } finally {
      try {
        if (fs.existsSync(tempBackupPath)) fs.unlinkSync(tempBackupPath);
      } catch {
        // Ignore temp file cleanup error
      }
    }
  }

  close(): void {
    try {
      this.checkpoint();
    } finally {
      this.nativeDb.close();
    }
  }
}

class SqlJsAdapter implements CompatibleDatabase {
  readonly engine = 'sql.js' as const;
  readonly isWalMode = false;

  constructor(private readonly inner: SqlJsDatabase) {}

  exec(sql: string, params?: BindParams): QueryExecResult[] {
    if (!params) {
      return this.inner.exec(sql);
    }
    if (Array.isArray(params)) {
      return this.inner.exec(sql, normalizeParamArray(params));
    }
    return this.inner.exec(sql, normalizeNamedParams(params) as unknown as SqlValue[]);
  }

  run(sql: string, params?: BindParams): void {
    if (!params) {
      this.inner.run(sql);
      return;
    }
    if (Array.isArray(params)) {
      this.inner.run(sql, normalizeParamArray(params));
      return;
    }
    this.inner.run(sql, normalizeNamedParams(params) as unknown as SqlValue[]);
  }

  prepare(sql: string): CompatibleStatement {
    const stmt = this.inner.prepare(sql);
    return {
      run(params?: BindParams) {
        if (!params) {
          stmt.run();
        } else if (Array.isArray(params)) {
          stmt.run(normalizeParamArray(params));
        } else {
          stmt.run(normalizeNamedParams(params) as unknown as SqlValue[]);
        }
      },
      free() {
        stmt.free();
      },
    };
  }

  export(): Uint8Array {
    return this.inner.export();
  }

  close(): void {
    this.inner.close();
  }
}

async function tryLoadNodeSqlite(): Promise<NodeSqliteModule | null> {
  if (process.env.POS_DB_ENGINE === 'sql.js') return null;
  try {
    const mod = (await import('node:sqlite')) as unknown as NodeSqliteModule;
    if (mod && typeof mod.DatabaseSync === 'function') {
      return mod;
    }
  } catch {
    // Runtime does not have node:sqlite enabled; fall back cleanly to sql.js
  }
  return null;
}

export function removeSqliteSidecarFiles(dbPath: string): void {
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const sidecar = `${dbPath}${suffix}`;
    try {
      if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
    } catch {
      // Ignore cleanup errors
    }
  }
}

export async function openSqliteDatabase(dbPath: string): Promise<CompatibleDatabase> {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const nodeSqlite = await tryLoadNodeSqlite();
  if (nodeSqlite) {
    try {
      const nativeDb = new nodeSqlite.DatabaseSync(dbPath);
      return new NodeSqliteWalAdapter(nativeDb, dbPath);
    } catch (error) {
      console.warn('Could not open database with native node:sqlite WAL; falling back to sql.js:', error);
    }
  }

  const SQL = await initSqlJs();
  const inner = fs.existsSync(dbPath)
    ? new SQL.Database(fs.readFileSync(dbPath))
    : new SQL.Database();
  return new SqlJsAdapter(inner);
}

export async function openSqliteFromBuffer(
  fileBuffer: Buffer,
  targetPath: string
): Promise<CompatibleDatabase> {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const nodeSqlite = await tryLoadNodeSqlite();
  if (nodeSqlite) {
    removeSqliteSidecarFiles(targetPath);
    fs.writeFileSync(targetPath, fileBuffer);
    const nativeDb = new nodeSqlite.DatabaseSync(targetPath);
    return new NodeSqliteWalAdapter(nativeDb, targetPath);
  }

  const SQL = await initSqlJs();
  return new SqlJsAdapter(new SQL.Database(fileBuffer));
}
