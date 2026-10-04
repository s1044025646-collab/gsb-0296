import { ArgvError, LIMITS, assertValidInput } from "./rules.js";

export interface Step {
  offset: number; // UTF-16 代码单元偏移
  kind:
    | "arg_start"
    | "quote_on"
    | "quote_off"
    | "literal_quote"
    | "backslash_collapse"
    | "escaped_quote"
    | "arg_commit";
  detail: string;
}

export interface ParsedArg {
  index: number;
  value: string;
  start: number; // 原始区间（UTF-16 代码单元），含引用字符
  end: number; // 半开区间
}

export interface DecodeResult {
  args: ParsedArg[];
  steps: Step[];
  stepsTruncated: boolean;
  diagnostics: string[];
}

export function decode(input: string, maxSteps: number = LIMITS.maxSteps): DecodeResult {
  assertValidInput(input);
  const args: ParsedArg[] = [];
  const steps: Step[] = [];
  const diagnostics: string[] = [];
  let stepsTruncated = false;

  const push = (s: Step) => {
    if (steps.length < maxSteps) steps.push(s);
    else stepsTruncated = true;
  };

  let i = 0;
  const n = input.length;
  while (i < n) {
    // 跳过参数间分隔符（仅引用外的空格/制表符；此处必在引用外）
    while (i < n && (input[i] === " " || input[i] === "\t")) i++;
    if (i >= n) break;
    if (args.length >= LIMITS.maxArgs)
      throw new ArgvError("E_TOO_MANY_ARGS", `参数数量超过上限 ${LIMITS.maxArgs}`);

    const index = args.length;
    const start = i;
    let value = "";
    let inQuotes = false;
    push({ offset: i, kind: "arg_start", detail: `参数 #${index} 开始` });

    while (i < n) {
      const ch = input[i];
      if ((ch === " " || ch === "\t") && !inQuotes) break;
      if (ch === "\\") {
        let run = 0;
        const runStart = i;
        while (i < n && input[i] === "\\") {
          run++;
          i++;
        }
        if (i < n && input[i] === '"') {
          const pairs = run >> 1;
          if (run % 2 === 0) {
            value += "\\".repeat(pairs);
            if (pairs > 0)
              push({
                offset: runStart,
                kind: "backslash_collapse",
                detail: `${run} 个反斜杠归并为 ${pairs} 个，引号参与引用规则`,
              });
            // 引号按引用规则处理
            if (inQuotes && input[i + 1] === '"') {
              value += '"';
              push({ offset: i, kind: "literal_quote", detail: `引用内连续两个引号生成字面引号，保持引用` });
              i += 2;
            } else {
              inQuotes = !inQuotes;
              push({ offset: i, kind: inQuotes ? "quote_on" : "quote_off", detail: `引用状态切换为 ${inQuotes}` });
              i++;
            }
          } else {
            value += "\\".repeat(pairs) + '"';
            push({
              offset: runStart,
              kind: "escaped_quote",
              detail: `${run} 个反斜杠归并为 ${pairs} 个并生成一个字面引号`,
            });
            i++;
          }
        } else {
          // 未紧邻引号：原样保留
          value += "\\".repeat(run);
        }
        continue;
      }
      if (ch === '"') {
        if (inQuotes && input[i + 1] === '"') {
          value += '"';
          push({ offset: i, kind: "literal_quote", detail: `引用内连续两个引号生成字面引号，保持引用` });
          i += 2;
        } else {
          inQuotes = !inQuotes;
          push({ offset: i, kind: inQuotes ? "quote_on" : "quote_off", detail: `引用状态切换为 ${inQuotes}` });
          i++;
        }
        continue;
      }
      value += ch;
      i++;
    }

    if (inQuotes)
      diagnostics.push(`参数 #${index}：引用未闭合，按引用持续到输入末尾处理（未自动补引号）`);
    args.push({ index, value, start, end: i });
    push({ offset: i, kind: "arg_commit", detail: `提交参数 #${index}，长度 ${value.length}` });
  }

  return { args, steps, stepsTruncated, diagnostics };
}
