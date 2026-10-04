import * as http from "node:http";
import * as net from "node:net";
import { decode } from "./parser.js";
import { encode } from "./encoder.js";
import { verifyBatch } from "./verify.js";
import { Store } from "./store.js";
import { ArgvError, RULES_VERSION, LIMITS } from "./rules.js";

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 4 * 1024 * 1024) {
        reject(new ArgvError("E_TOO_LONG", "请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  const s = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(s);
}

export function createServer(store: Store): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (req.method === "GET" && url.pathname === "/api/health") {
        return send(res, 200, { ok: true, rulesVersion: RULES_VERSION, limits: LIMITS });
      }
      if (req.method === "POST" && url.pathname === "/api/decode") {
        const body = JSON.parse(await readBody(req));
        const r = decode(body.input, body.maxSteps);
        const encoded = encode(r.args.map((a) => a.value));
        const id = store.saveDecode(body.input, r, encoded);
        return send(res, 200, { id, rulesVersion: RULES_VERSION, ...r, encoded });
      }
      if (req.method === "POST" && url.pathname === "/api/encode") {
        const body = JSON.parse(await readBody(req));
        const encoded = encode(body.args);
        const id = store.saveEncode(body.args, encoded);
        return send(res, 200, { id, rulesVersion: RULES_VERSION, encoded });
      }
      if (req.method === "POST" && url.pathname === "/api/verify") {
        const body = JSON.parse(await readBody(req));
        const report = verifyBatch(body.batch);
        const id = store.saveVerify(report);
        return send(res, 200, { id, rulesVersion: RULES_VERSION, ...report });
      }
      if (req.method === "GET" && url.pathname === "/api/history") {
        const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 500);
        const offset = Number(url.searchParams.get("offset") ?? 0);
        return send(res, 200, { items: store.list(limit, offset) });
      }
      const m = url.pathname.match(/^\/api\/history\/(\d+)$/);
      if (req.method === "GET" && m) {
        const row = store.get(Number(m[1]));
        if (!row) throw new ArgvError("E_NOT_FOUND", `记录 ${m[1]} 不存在`);
        return send(res, 200, row);
      }
      throw new ArgvError("E_NOT_FOUND", `未知路由 ${req.method} ${url.pathname}`);
    } catch (e) {
      if (e instanceof ArgvError)
        return send(res, e.code === "E_NOT_FOUND" ? 404 : 400, { error: e.message, code: e.code });
      if (e instanceof SyntaxError)
        return send(res, 400, { error: "请求体不是合法 JSON", code: "E_BAD_REQUEST" });
      return send(res, 500, { error: (e as Error).message, code: "E_INTERNAL" });
    }
  });
}

export function findFreePort(preferred?: number): Promise<number> {
  const tryPort = (port: number): Promise<number> =>
    new Promise((resolve, reject) => {
      const s = net.createServer();
      s.once("error", reject);
      s.listen(port, "127.0.0.1", () => {
        const p = (s.address() as net.AddressInfo).port;
        s.close(() => resolve(p));
      });
    });
  if (preferred) return tryPort(preferred).catch(() => tryPort(0));
  return tryPort(0);
}

async function main() {
  const store = new Store(process.env.CRT_ARGV_DB);
  const server = createServer(store);
  const preferred = process.env.PORT ? Number(process.env.PORT) : undefined;
  const port = await findFreePort(preferred);
  server.listen(port, "127.0.0.1", () => {
    console.log(`crt-argv API 已启动: http://127.0.0.1:${port} (规则版本 ${RULES_VERSION})`);
  });
}

if (require.main === module) main();
