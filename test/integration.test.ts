import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createApp } from "../src/server.js";
import { closeDatabase } from "../src/db.js";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// 编译后本文件位于 dist/test/，CLI 位于 dist/src/
const distDir = join(import.meta.dirname, "..");

let server: Server;
let baseUrl: string;
let dataDir: string;

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "argv-api-"));
  process.env.ARGV_DATA_DIR = dataDir;
  server = createApp();
  await new Promise<void>((resolveListen) => server.listen(0, resolveListen));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

async function post(path: string, body: unknown): Promise<any> {
  const res = await fetch(baseUrl + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

describe("HTTP API", () => {
  it("/health", async () => {
    const res = await fetch(baseUrl + "/health");
    const body = await res.json();
    assert.equal(body.ok, true);
  });

  it("解析并返回参数与区间", async () => {
    const body = await post("/api/parse", { input: '"a b"  c' });
    assert.equal(body.ok, true);
    assert.deepEqual(body.args.map((a: any) => a.value), ["a b", "c"]);
    assert.ok(body.reportId > 0);
  });

  it("编码并往返", async () => {
    const body = await post("/api/encode", { args: ["", 'he said "hi"', "C:\\x\\"] });
    assert.equal(body.ok, true);
    const again = await post("/api/parse", { input: body.commandLine });
    assert.deepEqual(again.args.map((a: any) => a.value), ["", 'he said "hi"', "C:\\x\\"]);
  });

  it("批量核对能定位失败条目（含错误码）", async () => {
    const body = await post("/api/batch-verify", {
      items: [
        { args: ["a b"] },
        { args: [42 as unknown as string] },
        { args: ["c", "d e"] },
        { bogus: true },
      ],
    });
    assert.equal(body.ok, true);
    assert.equal(body.total, 4);
    assert.equal(body.failed, 2);
    assert.equal(body.results[1].error.code, "NOT_STRING");
    assert.equal(body.results[3].error.code, "INVALID_BATCH");
  });

  it("非字符串/ NUL 返回明确错误码", async () => {
    const notString = await post("/api/parse", { input: 99 });
    assert.equal(notString.ok, false);
    assert.equal(notString.error.code, "NOT_STRING");
    const nul = await post("/api/parse", { input: "a\u0000" });
    assert.equal(nul.error.code, "CONTAINS_NUL");
  });

  it("历史查询与 JSON 导出", async () => {
    const reports = await (await fetch(baseUrl + "/api/reports?kind=parse&limit=5")).json();
    assert.ok(reports.reports.length >= 1);
    const exported = await (await fetch(baseUrl + "/api/export")).json();
    assert.ok(exported.count >= 1);
  });
});

describe("CLI 与 API 结果一致", () => {
  const env = { ...process.env, ARGV_DATA_DIR: dataDir };

  it("CLI parse 与 API parse 对同一输入等价", () => {
    const input = '"C:\\Program Files\\x" 中文\\"q';
    const stdout = execFileSync(
      process.execPath,
      [join(distDir, "src", "cli.js"), "parse", input],
      { encoding: "utf-8", env }
    );
    const cli = JSON.parse(stdout);
    return post("/api/parse", { input }).then((api) => {
      assert.deepEqual(
        cli.args.map((a: any) => a.value),
        api.args.map((a: any) => a.value)
      );
      assert.equal(cli.unterminatedQuote, api.unterminatedQuote);
    });
  });

  it("CLI encode 输出可被 API 恢复", () => {
    const stdout = execFileSync(
      process.execPath,
      [join(distDir, "src", "cli.js"), "encode", "--", "", "a b", 'c"d'],
      { encoding: "utf-8", env }
    );
    const cli = JSON.parse(stdout);
    return post("/api/parse", { input: cli.commandLine }).then((api) => {
      assert.deepEqual(api.args.map((a: any) => a.value), ["", "a b", 'c"d']);
    });
  });
});
