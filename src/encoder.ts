import { ArgvError, LIMITS, assertValidInput } from "./rules.js";

export function encodeArg(arg: string): string {
  assertValidInput(arg, "参数");
  const needsQuotes = arg.length === 0 || /[ \t"]/.test(arg);
  if (!needsQuotes) return arg;
  let out = '"';
  let backslashes = 0;
  for (const ch of arg) {
    if (ch === "\\") {
      backslashes++;
      continue;
    }
    if (ch === '"') {
      out += "\\".repeat(backslashes * 2 + 1) + '"';
      backslashes = 0;
      continue;
    }
    if (backslashes > 0) {
      out += "\\".repeat(backslashes);
      backslashes = 0;
    }
    out += ch;
  }
  // 结束引号前的反斜杠必须翻倍
  out += "\\".repeat(backslashes * 2) + '"';
  return out;
}

export function encode(args: string[]): string {
  if (!Array.isArray(args)) throw new ArgvError("E_NOT_STRING", "args 必须是字符串数组");
  if (args.length > LIMITS.maxArgs)
    throw new ArgvError("E_TOO_MANY_ARGS", `参数数量超过上限 ${LIMITS.maxArgs}`);
  for (const a of args) assertValidInput(a, "参数");
  return args.map(encodeArg).join(" ");
}
