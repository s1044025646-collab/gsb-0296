import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync } from "node:child_process";
import { createServer, findFreePort } from "../src/server.js";
import { Store } from "../src/store.js";
import type { AddressInfo } from "node:net";

let server: ReturnType<typeof createServer>;
let base: string;
let dbPath: string;
let store: Store;

before(async () => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "crtargv-")), "test.db");
  store = new Store(dbPath);
  server = createServer(store);
  const port = await findFreePort();
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
  store.close();
});

async function post(p: string, body: unknown) {
  const res = await fetch(base + p, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

test("API decode/encode/verify/history", async () => {
  const enc = await post("/api/encode", { args: ["a b", 'x"y', "C:\\"] });
  assert.equal(enc.status, 200);
  assert.equal(enc.json.encoded, '"a b" "x\\"y" C:\\');

  const dec = await post("/api/decode", { input: '"a b" "x\\"y" C:\\' });
  assert.deepEqual(dec.json.args.map((a: { value: string }) => a.value), ["a b", 'x"y', "C:\\"]);

  const ver = await post("/api/verify", { batch: [["a b", ""], ["中"]] });
  assert.equal(ver.json.failed, 0);
  const bad = await post("/api/verify", { batch: [["ok"], ["a\0"]] });
  assert.equal(bad.json.failed, 1);
  assert.equal(bad.json.items[1].index, 1); // 能定位失败条目
  assert.ok(bad.json.items[1].error);

  const hist = await (await fetch(`${base}/api/history`)).json();
  assert.ok(hist.items.length >= 4);
  const one = await (await fetch(`${base}/api/history/${dec.json.id}`)).json();
  assert.equal(one.id, dec.json.id);

  const err = await post("/api/decode", { input: 42 });
  assert.equal(err.status, 400);
  assert.equal(err.json.code, "E_NOT_STRING");
});

test("持久化：重启后可读取", () => {
  store.close();
  const store2 = new Store(dbPath);
  const items = store2.list();
  assert.ok(items.length >= 4);
  assert.ok(items.every((i) => i.rules_version));
  store2.close();
  store = new Store(dbPath); // 让 after 钩子安全关闭
});

test("CLI 与 API 结果一致", () => {
  const cliOut = execFileSync(
    process.execPath,
    [path.join(__dirname, "../src/cli.js"), "encode", "--stdin"],
    {
      env: { ...process.env, CRT_ARGV_DB: dbPath },
      encoding: "utf8",
      input: JSON.stringify(["a b", 'x"y', "C:\\"]),
    }
  );
  const parsed = JSON.parse(cliOut);
  assert.equal(parsed.encoded, '"a b" "x\\"y" C:\\');
});
