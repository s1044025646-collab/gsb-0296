#!/usr/bin/env node
import { resolve } from "node:path";
import { AppError } from "./errors.js";
import { openDatabase } from "./db.js";
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
openDatabase(resolve(DATA_DIR, "app.db"));

const usage = `Windows CRT 参数引用解析与往返编码 CLI

用法:
  node dist/src/cli.js parse "<参数尾串>" [--steps]
  node dist/src/cli.js encode -- "<参数1>" "<参数2>" ...
  node dist/src/cli.js roundtrip "<参数尾串>"
  node dist/src/cli.js batch-verify items.json
  node dist/src/cli.js history [--kind parse|encode|roundtrip|batch] [--limit N]
  node dist/src/cli.js report <id>
  node dist/src/cli.js export [output.json]

所有偏移均按 UTF-16 代码单元计数。仅解析文本，不执行任何程序。
`;

function print(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

function fail(error: AppError | Error): never {
  if (error instanceof AppError) {
    process.stderr.write(`错误 [${error.code}]: ${error.message}\n`);
  } else {
    process.stderr.write(`错误 [INTERNAL]: ${String(error)}\n`);
  }
  process.exit(1);
}

const [command, ...rest] = process.argv.slice(2);

try {
  switch (command) {
    case "parse": {
      const withSteps = rest.includes("--steps");
      const input = rest.filter((arg) => arg !== "--steps").join(" ");
      const result = parseAndSave(input);
      print({
        reportId: result.reportId,
        inputLength: result.inputLength,
        unterminatedQuote: result.unterminatedQuote,
        stepsTruncated: result.stepsTruncated,
        args: result.args.map((arg) => ({
          index: arg.index,
          value: arg.value,
          start: arg.start,
          end: arg.end,
        })),
        ...(withSteps ? { steps: result.steps } : {}),
      });
      break;
    }
    case "encode": {
      const separator = rest.indexOf("--");
      const args = separator === -1 ? rest : rest.slice(separator + 1);
      const result = encodeAndSave(args);
      print({
        reportId: result.reportId,
        commandLine: result.commandLine,
        quoted: result.quoted,
      });
      break;
    }
    case "roundtrip": {
      const result = roundTripAndSave(rest.join(" "));
      print({
        reportId: result.reportId,
        stable: result.stable,
        args: result.parse.args.map((arg) => arg.value),
        commandLine: result.encoded.commandLine,
      });
      break;
    }
    case "batch-verify": {
      const file = rest[0];
      if (!file) throw new AppError("INVALID_BATCH", "需要提供 JSON 文件路径");
      await doBatch(file);
      break;
    }
    case "history": {
      const kindIndex = rest.indexOf("--kind");
      const limitIndex = rest.indexOf("--limit");
      print(
        fetchHistory({
          kind: kindIndex !== -1 ? rest[kindIndex + 1] : undefined,
          limit: limitIndex !== -1 ? Number(rest[limitIndex + 1]) : 20,
        })
      );
      break;
    }
    case "report": {
      const id = Number(rest[0]);
      if (!Number.isInteger(id)) throw new AppError("INVALID_QUERY", "需要数字报告 id");
      const row = fetchReport(id);
      print({ ...row, result_json: JSON.parse(row.result_json) });
      break;
    }
    case "export": {
      const rows = fetchAllForExport().map((row) => ({
        ...row,
        result_json: JSON.parse(row.result_json),
      }));
      const text = JSON.stringify(rows, null, 2);
      if (rest[0]) {
        const { writeFileSync } = await import("node:fs");
        writeFileSync(rest[0], text, "utf-8");
        process.stdout.write(`已导出 ${rows.length} 条报告到 ${rest[0]}\n`);
      } else {
        process.stdout.write(text + "\n");
      }
      break;
    }
    default:
      process.stdout.write(usage);
  }
} catch (error) {
  fail(error as Error);
}

async function doBatch(file: string): Promise<void> {
  const { readFileSync } = await import("node:fs");
  const items = JSON.parse(readFileSync(file, "utf-8"));
  const result = verifyBatch(items);
  print(result);
  if (result.failed > 0) process.exit(2);
}
