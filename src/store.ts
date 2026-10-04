import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { RULES_VERSION } from "./rules.js";
import type { DecodeResult } from "./parser.js";

export interface RecordRow {
  id: number;
  kind: "decode" | "encode" | "verify";
  rules_version: string;
  input: string;
  result: string;
  created_at: string;
}

export class Store {
  private db: DatabaseSync;
  constructor(dbPath?: string) {
    const dir = dbPath ? path.dirname(dbPath) : path.join(process.cwd(), "data");
    fs.mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(dbPath ?? path.join(dir, "crt-argv.db"));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        rules_version TEXT NOT NULL,
        input TEXT NOT NULL,
        result TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )`);
  }

  saveDecode(input: string, r: DecodeResult, encoded: string): number {
    return this.insert("decode", input, {
      args: r.args,
      diagnostics: r.diagnostics,
      stepsTruncated: r.stepsTruncated,
      encoded,
    });
  }

  saveEncode(args: string[], encoded: string): number {
    return this.insert("encode", JSON.stringify(args), { args, encoded });
  }

  saveVerify(report: unknown): number {
    return this.insert("verify", "batch", report);
  }

  private insert(kind: string, input: string, result: unknown): number {
    const stmt = this.db.prepare(
      "INSERT INTO records (kind, rules_version, input, result) VALUES (?,?,?,?)"
    );
    const r = stmt.run(kind, RULES_VERSION, input, JSON.stringify(result));
    return Number(r.lastInsertRowid);
  }

  list(limit = 50, offset = 0): RecordRow[] {
    return this.db
      .prepare("SELECT * FROM records ORDER BY id DESC LIMIT ? OFFSET ?")
      .all(limit, offset) as unknown as RecordRow[];
  }

  get(id: number): RecordRow | undefined {
    return this.db.prepare("SELECT * FROM records WHERE id = ?").get(id) as
      | RecordRow
      | undefined;
  }

  close() {
    this.db.close();
  }
}
