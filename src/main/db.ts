import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { app } from 'electron';
import { join, dirname } from 'node:path';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Task, TaskInput, TaskStatus } from '@shared/types';

let db: Database;
let dbPath: string;
let saveTimer: NodeJS.Timeout | null = null;

function locateWasm(): string {
  // sql.js ships sql-wasm.wasm next to its dist file. Resolve via require (CJS main).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pkg = require.resolve('sql.js/dist/sql-wasm.js');
  return join(dirname(pkg), 'sql-wasm.wasm');
}

export async function initDb(): Promise<Database> {
  const dir = join(app.getPath('userData'), 'data');
  mkdirSync(dir, { recursive: true });
  dbPath = join(dir, 'trail.db');

  const wasmPath = locateWasm();
  const SQL: SqlJsStatic = await initSqlJs({
    locateFile: () => wasmPath,
  });

  if (existsSync(dbPath)) {
    const bytes = readFileSync(dbPath);
    db = new SQL.Database(new Uint8Array(bytes));
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      source TEXT NOT NULL,
      source_ref TEXT,
      status TEXT NOT NULL DEFAULT 'todo',
      url TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      notes TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      due_at INTEGER,
      snoozed_until INTEGER,
      last_touched_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_source_ref
      ON tasks(source, source_ref) WHERE source_ref IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_updated ON tasks(updated_at DESC);

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      ts INTEGER NOT NULL,
      processed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_events_unprocessed ON events(type, processed_at);
  `);

  // Migration: add processed_at column on older DBs
  const cols = allRows<{ name: string }>("PRAGMA table_info(events)");
  if (!cols.some((c) => c.name === 'processed_at')) {
    db.run('ALTER TABLE events ADD COLUMN processed_at INTEGER');
  }

  scheduleSave();
  return db;
}

export function getDb(): Database {
  if (!db) throw new Error('DB not initialized');
  return db;
}

function flushSave(): void {
  if (!db || !dbPath) return;
  const data = db.export();
  const tmp = dbPath + '.tmp';
  writeFileSync(tmp, Buffer.from(data));
  renameSync(tmp, dbPath);
}

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      flushSave();
    } catch (err) {
      console.error('DB save failed', err);
    }
  }, 250);
}

export function saveDbNow(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  flushSave();
}

// ---------- low-level helpers (sql.js doesn't expose better-sqlite3 prepare API) ----------

function run(sql: string, params: unknown[] = []): void {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params as any);
    stmt.step();
  } finally {
    stmt.free();
  }
  scheduleSave();
}

function allRows<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
  const stmt = db.prepare(sql);
  const out: T[] = [];
  try {
    stmt.bind(params as any);
    while (stmt.step()) out.push(stmt.getAsObject() as T);
  } finally {
    stmt.free();
  }
  return out;
}

function getRow<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | null {
  const rows = allRows<T>(sql, params);
  return rows[0] ?? null;
}

// ---------- mappers ----------

function rowToTask(r: any): Task {
  return {
    id: r.id,
    title: r.title,
    source: r.source,
    sourceRef: r.source_ref,
    status: r.status,
    url: r.url,
    tags: JSON.parse(r.tags || '[]'),
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    dueAt: r.due_at,
    snoozedUntil: r.snoozed_until,
    lastTouchedAt: r.last_touched_at,
  };
}

// ---------- repos ----------

export const tasksRepo = {
  list(filter?: { status?: TaskStatus[] }): Task[] {
    let sql = 'SELECT * FROM tasks';
    const params: unknown[] = [];
    if (filter?.status?.length) {
      sql += ` WHERE status IN (${filter.status.map(() => '?').join(',')})`;
      params.push(...filter.status);
    }
    sql += ' ORDER BY (status = "done") ASC, last_touched_at DESC';
    return allRows(sql, params).map(rowToTask);
  },

  byId(id: string): Task | null {
    const row = getRow('SELECT * FROM tasks WHERE id = ?', [id]);
    return row ? rowToTask(row) : null;
  },

  bySourceRef(source: string, sourceRef: string): Task | null {
    const row = getRow('SELECT * FROM tasks WHERE source = ? AND source_ref = ?', [
      source,
      sourceRef,
    ]);
    return row ? rowToTask(row) : null;
  },

  upsertBySourceRef(input: TaskInput & { source: NonNullable<TaskInput['source']> }): Task {
    const now = Date.now();
    if (input.sourceRef) {
      const existing = this.bySourceRef(input.source, input.sourceRef);
      if (existing) {
        run('UPDATE tasks SET title=?, url=?, updated_at=? WHERE id=?', [
          input.title,
          input.url ?? existing.url,
          now,
          existing.id,
        ]);
        return { ...existing, title: input.title, url: input.url ?? existing.url, updatedAt: now };
      }
    }
    return this.create(input);
  },

  create(input: TaskInput): Task {
    const now = Date.now();
    const task: Task = {
      id: randomUUID(),
      title: input.title.trim(),
      source: input.source ?? 'manual',
      sourceRef: input.sourceRef ?? null,
      status: 'todo',
      url: input.url ?? null,
      tags: input.tags ?? [],
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now,
      dueAt: input.dueAt ?? null,
      snoozedUntil: null,
      lastTouchedAt: now,
    };
    run(
      `INSERT INTO tasks (id,title,source,source_ref,status,url,tags,notes,created_at,updated_at,due_at,snoozed_until,last_touched_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        task.id,
        task.title,
        task.source,
        task.sourceRef,
        task.status,
        task.url,
        JSON.stringify(task.tags),
        task.notes,
        task.createdAt,
        task.updatedAt,
        task.dueAt,
        task.snoozedUntil,
        task.lastTouchedAt,
      ],
    );
    return task;
  },

  update(id: string, patch: Partial<Task>): Task {
    const cur = this.byId(id);
    if (!cur) throw new Error(`Task ${id} not found`);
    const next: Task = { ...cur, ...patch, id: cur.id, updatedAt: Date.now() };
    run(
      `UPDATE tasks SET title=?, status=?, url=?, tags=?, notes=?, due_at=?, snoozed_until=?, last_touched_at=?, updated_at=? WHERE id=?`,
      [
        next.title,
        next.status,
        next.url,
        JSON.stringify(next.tags),
        next.notes,
        next.dueAt,
        next.snoozedUntil,
        next.lastTouchedAt,
        next.updatedAt,
        next.id,
      ],
    );
    return next;
  },

  remove(id: string): void {
    run('DELETE FROM tasks WHERE id = ?', [id]);
  },

  countStalled(now = Date.now()): number {
    const sixHours = 6 * 60 * 60 * 1000;
    const row = getRow<{ c: number }>(
      `SELECT COUNT(*) as c FROM tasks
       WHERE status IN ('todo','in_progress')
         AND (snoozed_until IS NULL OR snoozed_until < ?)
         AND last_touched_at < ?`,
      [now, now - sixHours],
    );
    return row?.c ?? 0;
  },
};

export interface RawEvent {
  id: string;
  taskId: string | null;
  type: string;
  payload: unknown;
  ts: number;
  processedAt: number | null;
}

function rowToEvent(r: any): RawEvent {
  return {
    id: r.id,
    taskId: r.task_id,
    type: r.type,
    payload: JSON.parse(r.payload),
    ts: r.ts,
    processedAt: r.processed_at,
  };
}

export const eventsRepo = {
  log(type: string, payload: unknown, taskId: string | null = null): void {
    run('INSERT INTO events (id,task_id,type,payload,ts) VALUES (?,?,?,?,?)', [
      randomUUID(),
      taskId,
      type,
      JSON.stringify(payload),
      Date.now(),
    ]);
  },

  byTaskId(taskId: string, limit = 50): RawEvent[] {
    const rows = allRows(
      'SELECT * FROM events WHERE task_id = ? ORDER BY ts DESC LIMIT ?',
      [taskId, limit],
    );
    return rows.map(rowToEvent);
  },

  recent(limit: number, since?: number): RawEvent[] {
    const sql = since
      ? 'SELECT * FROM events WHERE ts >= ? ORDER BY ts DESC LIMIT ?'
      : 'SELECT * FROM events ORDER BY ts DESC LIMIT ?';
    const params = since ? [since, limit] : [limit];
    return allRows(sql, params).map(rowToEvent);
  },

  unprocessed(types: string[], limit: number): RawEvent[] {
    if (types.length === 0) return [];
    const placeholders = types.map(() => '?').join(',');
    const rows = allRows(
      `SELECT * FROM events
       WHERE type IN (${placeholders})
         AND processed_at IS NULL
       ORDER BY ts ASC
       LIMIT ?`,
      [...types, limit],
    );
    return rows.map(rowToEvent);
  },

  markProcessed(ids: string[], now = Date.now()): void {
    if (ids.length === 0) return;
    db.run('BEGIN');
    try {
      for (const id of ids) run('UPDATE events SET processed_at = ? WHERE id = ?', [now, id]);
      db.run('COMMIT');
    } catch (err) {
      db.run('ROLLBACK');
      throw err;
    }
  },
};
