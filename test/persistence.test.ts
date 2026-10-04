import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { closeDatabase, getReport, openDatabase } from "../src/db.js";
import {
  encodeAndSave,
  fetchAllForExport,
  parseAndSave,
} from "../src/service.js";

let dir: string;
let dbFile: string;

before(() => {
  dir = mkdtempSync(join(tmpdir(), "argv-db-"));
  dbFile = join(dir, "app.db");
  openDatabase(dbFile);
});

after(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});

describe("SQLite 持久化与重启读取", () => {
  it("保存解析报告并可按 id 取回", () => {
    const saved = parseAndSave('"a b" c');
    const row = getReport(saved.reportId);
    assert.ok(row);
    assert.equal(row!.kind, "parse");
    const parsed = JSON.parse(row!.result_json);
    assert.deepEqual(
      parsed.args.map((a: { value: string }) => a.value),
      ["a b", "c"]
    );
    assert.equal(row!.rule_version, saved.ruleVersion);
  });

  it("保存编码报告", () => {
    const saved = encodeAndSave(["x y", ""]);
    const row = getReport(saved.reportId);
    assert.equal(row!.kind, "encode");
    assert.ok(JSON.parse(row!.result_json).commandLine.includes('""'));
  });

  it("关闭后重新打开（模拟重启），数据仍在", () => {
    closeDatabase();
    openDatabase(dbFile);
    const all = fetchAllForExport();
    assert.ok(all.length >= 2);
    const kinds = new Set(all.map((r) => r.kind));
    assert.ok(kinds.has("parse"));
    assert.ok(kinds.has("encode"));
  });
});
