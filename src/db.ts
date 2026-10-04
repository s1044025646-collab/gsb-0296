import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { RULE_VERSION } from "./limits.js";

export interface ParseRecordRow {
  id: number;
  kind: "parse" | "encode" | "roundtrip" | "batch";
  raw_input: string;
  rule_version: string;
  result_json: string;
  created_at: string;
}

let dbInstance: DatabaseSync | null = null;
let dbPath = "";

export function openDatabase(path: string): DatabaseSync {
  if (dbInstance) return dbInstance;
  mkdirSync(dirname(path), { recursive: true });
  dbPath = path;
  dbInstance = new DatabaseSync(path);
  dbInstance.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK (kind IN ('parse','encode','roundtrip','batch')),
      raw_input TEXT NOT NULL,
      rule_version TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return dbInstance;
}

export function getDbPath(): string {
  return dbPath;
}

export function closeDatabase(): void {
  dbInstance?.close();
  dbInstance = null;
}

interface SaveInput {
  kind: ParseRecordRow["kind"];
  rawInput: string;
  result: unknown;
}

export function saveReport({ kind, rawInput, result }: SaveInput): number {
  const db = openDatabase(dbPath || "data/app.db");
  const stmt = db.prepare(
    "INSERT INTO reports (kind, raw_input, rule_version, result_json) VALUES (?, ?, ?, ?)"
  );
  const info = stmt.run(kind, rawInput, RULE_VERSION, JSON.stringify(result));
  return Number(info.lastInsertRowid);
}

export function getReport(id: number): ParseRecordRow | undefined {
  const db = openDatabase(dbPath || "data/app.db");
  return db.prepare("SELECT * FROM reports WHERE id = ?").get(id) as unknown as
    | ParseRecordRow
    | undefined;
}

export interface HistoryQuery {
  kind?: string;
  limit?: number;
  offset?: number;
  q?: string;
}

export function listReports(query: HistoryQuery): ParseRecordRow[] {
  const db = openDatabase(dbPath || "data/app.db");
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (query.kind) {
    conditions.push("kind = ?");
    params.push(query.kind);
  }
  if (query.q) {
    conditions.push("raw_input LIKE ?");
    params.push(`%${query.q}%`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 500);
  const offset = Math.max(query.offset ?? 0, 0);
  const stmt = db.prepare(
    `SELECT * FROM reports ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
  );
  return stmt.all(...params, limit, offset) as unknown as ParseRecordRow[];
}

export function exportAllReports(): ParseRecordRow[] {
  const db = openDatabase(dbPath || "data/app.db");
  return db.prepare("SELECT * FROM reports ORDER BY id ASC").all() as unknown as ParseRecordRow[];
}
