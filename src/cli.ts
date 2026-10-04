import * as fs from "node:fs";
import { decode } from "./parser.js";
import { encode } from "./encoder.js";
import { verifyBatch } from "./verify.js";
import { Store } from "./store.js";
import { RULES_VERSION } from "./rules.js";

function out(v: unknown) {
  process.stdout.write(JSON.stringify(v, null, 2) + "\n");
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c: Buffer) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  const store = new Store(process.env.CRT_ARGV_DB);
  switch (cmd) {
    case "decode": {
      const showSteps = rest.includes("--steps");
      const input = rest.filter((a) => a !== "--steps").join(" ");
      const r = decode(input);
      const encoded = encode(r.args.map((a) => a.value));
      const id = store.saveDecode(input, r, encoded);
      out({
        id,
        rulesVersion: RULES_VERSION,
        args: r.args,
        diagnostics: r.diagnostics,
        encoded,
        ...(showSteps ? { steps: r.steps, stepsTruncated: r.stepsTruncated } : {}),
      });
      break;
    }
    case "encode": {
      const args: string[] =
        rest[0] === "--stdin" ? JSON.parse(await readStdin()) : JSON.parse(rest[0]);
      const encoded = encode(args);
      const id = store.saveEncode(args, encoded);
      out({ id, rulesVersion: RULES_VERSION, encoded });
      break;
    }
    case "verify": {
      const batch = JSON.parse(fs.readFileSync(rest[0], "utf8"));
      const report = verifyBatch(batch);
      const id = store.saveVerify(report);
      out({ id, rulesVersion: RULES_VERSION, ...report });
      if (report.failed > 0) process.exitCode = 1;
      break;
    }
    case "history": {
      out({ items: store.list(rest[0] ? Number(rest[0]) : 50) });
      break;
    }
    case "export": {
      fs.writeFileSync(rest[0], JSON.stringify(store.list(100000), null, 2), "utf8");
      console.log(`已导出到 ${rest[0]}`);
      break;
    }
    default:
      console.error(`用法:
  cli decode <参数尾串> [--steps]   解析命令行参数尾串
  cli encode "<json数组>"           编码字符串数组为命令行
  cli verify <batch.json>           批量往返核对（数组的数组）
  cli history [limit]               查看历史
  cli export <out.json>             导出历史为 JSON`);
      process.exitCode = 2;
  }
  store.close();
}

main().catch((e) => {
  console.error(`错误 [${e.code ?? "E_INTERNAL"}]: ${e.message}`);
  process.exitCode = 1;
});
