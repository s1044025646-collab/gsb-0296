import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { AppError } from "./errors.js";
import { DEFAULT_PORT } from "./limits.js";
import { closeDatabase, openDatabase } from "./db.js";
import {
  encodeAndSave,
  fetchAllForExport,
  fetchHistory,
  fetchReport,
  parseAndSave,
  roundTripAndSave,
  verifyBatch,
} from "./service.js";

const DATA_DIR = process.env.ARGV_DATA_DIR ?? resolve("data");
const DB_FILE = resolve(DATA_DIR, "app.db");

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 5_000_000) {
      throw new AppError("INPUT_TOO_LONG", "请求体超过 5MB 上限");
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  } catch {
    throw new AppError("INVALID_JSON", "请求体不是合法 JSON");
  }
}

function errorBody(code: string, message: string, details?: unknown) {
  return { ok: false as const, error: { code, message, details } };
}

export function createApp(): Server {
  openDatabase(DB_FILE);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const method = req.method ?? "GET";

    try {
      if (method === "GET" && path === "/health") {
        sendJson(res, 200, { ok: true, service: "win-crt-argv" });
        return;
      }

      if (method === "POST" && path === "/api/parse") {
        const body = (await readJson(req)) as { input?: unknown };
        sendJson(res, 200, { ok: true, ...parseAndSave(body.input) });
        return;
      }

      if (method === "POST" && path === "/api/encode") {
        const body = (await readJson(req)) as { args?: unknown };
        sendJson(res, 200, { ok: true, ...encodeAndSave(body.args) });
        return;
      }

      if (method === "POST" && path === "/api/roundtrip") {
        const body = (await readJson(req)) as { input?: unknown };
        const result = roundTripAndSave(body.input);
        sendJson(res, 200, {
          ok: true,
          ...result,
          parse: {
            ...result.parse,
            args: result.parse.args.map((arg) => ({
              index: arg.index,
              value: arg.value,
              start: arg.start,
              end: arg.end,
            })),
          },
        });
        return;
      }

      if (method === "POST" && path === "/api/batch-verify") {
        const body = (await readJson(req)) as { items?: unknown } | unknown[];
        const items = Array.isArray(body)
          ? body
          : (body as { items?: unknown }).items;
        sendJson(res, 200, { ok: true, ...verifyBatch(items) });
        return;
      }

      if (method === "GET" && path === "/api/reports") {
        const idText = url.searchParams.get("id");
        if (idText !== null) {
          const id = Number(idText);
          if (!Number.isInteger(id) || id <= 0) {
            throw new AppError("INVALID_QUERY", "id 必须是正整数");
          }
          const row = fetchReport(id);
          sendJson(res, 200, { ok: true, report: { ...row, result_json: JSON.parse(row.result_json) } });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          reports: fetchHistory({
            kind: url.searchParams.get("kind") ?? undefined,
            q: url.searchParams.get("q") ?? undefined,
            limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
            offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined,
          }),
        });
        return;
      }

      if (method === "GET" && path === "/api/export") {
          const rows = fetchAllForExport().map((row) => ({
            ...row,
            result_json: JSON.parse(row.result_json),
          }));
          sendJson(res, 200, { ok: true, count: rows.length, reports: rows });
          return;
      }

      sendJson(res, 404, errorBody("NOT_FOUND", `无此路由: ${method} ${path}`));
    } catch (cause) {
      if (cause instanceof AppError) {
        sendJson(res, 400, errorBody(cause.code, cause.message, cause.details));
      } else {
        sendJson(res, 500, errorBody("INTERNAL", String(cause)));
      }
    }
  });

  return server;
}

function pickPort(): number {
  const fromEnv = Number(process.env.PORT);
  if (Number.isInteger(fromEnv) && fromEnv > 0 && fromEnv < 65536) return fromEnv;
  const arg = process.argv.find((value) => value.startsWith("--port="));
  const fromArg = arg ? Number(arg.slice("--port=".length)) : NaN;
  if (Number.isInteger(fromArg) && fromArg >= 0 && fromArg < 65536) return fromArg;
  return DEFAULT_PORT;
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  const port = pickPort();
  const server = createApp();
  server.listen(port, () => {
    const address = server.address();
    const actual = typeof address === "object" && address ? address.port : port;
    console.log(JSON.stringify({
      status: "listening",
      port: actual,
      db: DB_FILE,
      endpoints: [
        "POST /api/parse",
        "POST /api/encode",
        "POST /api/roundtrip",
        "POST /api/batch-verify",
        "GET  /api/reports",
        "GET  /api/reports?id=N",
        "GET  /api/export",
      ],
    }, null, 2));
  });

  const shutdown = () => {
    server.close(() => {
      closeDatabase();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
