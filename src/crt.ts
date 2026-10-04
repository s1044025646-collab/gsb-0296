import { AppError, findNul, requireString } from "./errors.js";
import {
  MAX_ARG_COUNT,
  MAX_INPUT_LENGTH,
  MAX_STEP_COUNT,
  RULE_VERSION,
} from "./limits.js";

/** 一次扫描步骤（解释记录中的一条）。 */
export interface ScanStep {
  /** 从 0 开始的步骤序号。 */
  index: number;
  /** 当前字符的 UTF-16 代码单元偏移。 */
  offset: number;
  /** 被检查的字符（已转义生成引号时记录字面含义）。 */
  char: string;
  /** 该步发生的关键动作。 */
  action:
    | "delimiter"
    | "literal"
    | "backslash-run"
    | "quote-open"
    | "quote-close"
    | "escaped-quote"
    | "doubled-quote"
    | "submit";
  /** 扫描后的引用状态。 */
  quoted: boolean;
  /** 人类可读说明。 */
  note: string;
}

export interface ParsedArgument {
  /** 参数序号，从 0 开始。 */
  index: number;
  /** 解析出的参数内容。 */
  value: string;
  /** 在原输入中的 UTF-16 代码单元区间 [start, end)，含属于该参数的原始空白前位置。 */
  start: number;
  end: number;
}

export interface ParseResult {
  ruleVersion: string;
  input: string;
  /** 输入长度（UTF-16 代码单元）。 */
  inputLength: number;
  args: ParsedArgument[];
  /** 引用是否在输入末尾仍未闭合。 */
  unterminatedQuote: boolean;
  /** 扫描步骤；达到上限时被截短。 */
  steps: ScanStep[];
  /** 步骤是否因上限被截短（不影响 args 的完整性）。 */
  stepsTruncated: boolean;
}

export interface EncodeResult {
  ruleVersion: string;
  args: string[];
  commandLine: string;
  /** 是否使用了外层引用（逐参数）。 */
  quoted: boolean[];
}

function validateTail(input: unknown): string {
  const text = requireString(input, "input");
  if (text.length > MAX_INPUT_LENGTH) {
    throw new AppError("INPUT_TOO_LONG", "输入超过长度上限", {
      length: text.length,
      max: MAX_INPUT_LENGTH,
    });
  }
  const nulAt = findNul(text);
  if (nulAt !== -1) {
    throw new AppError("CONTAINS_NUL", "输入包含 NUL (U+0000) 字符", { offset: nulAt });
  }
  return text;
}

function isWhitespace(codeUnit: number): boolean {
  // 仅空格 (U+0020) 与制表符 (U+0009) 作为分隔符。
  return codeUnit === 0x20 || codeUnit === 0x09;
}

/**
 * 解析不含程序名的参数尾串。
 *
 * 规则（现代 Microsoft C Runtime 普通参数，不含 argv[0]）：
 * - 引用外的空格/制表符分隔参数；连续分隔符不产生空参数。
 * - 反斜杠仅在紧邻双引号时具有转义意义：
 *   2n 个 -> n 个反斜杠，引号参与引用规则；
 *   2n+1 个 -> n 个反斜杠 + 一个字面引号，引用状态不变。
 * - 未紧邻引号的反斜杠原样保留。
 * - 引用内连续两个未转义引号 -> 一个字面引号且保持引用；
 *   其余未转义引号切换引用状态。
 * - 空引用产生空参数；一个参数可混合引用与非引用片段。
 * - 未闭合引用按引用持续到输入末尾处理，并在结果中标记诊断。
 */
export function parseCommandTail(input: unknown): ParseResult {
  const text = validateTail(input);
  const len = text.length;

  const args: ParsedArgument[] = [];
  const steps: ScanStep[] = [];
  let stepsTruncated = false;
  let stepIndex = 0;

  const record = (step: Omit<ScanStep, "index">) => {
    if (stepIndex < MAX_STEP_COUNT) {
      steps.push({ index: stepIndex, ...step });
    } else {
      stepsTruncated = true;
    }
    stepIndex += 1;
  };

  let current = "";
  let currentStart = -1;
  let currentHasContent = false;
  let inQuotes = false;
  let i = 0;

  const beginArg = (pos: number) => {
    if (currentStart === -1) {
      currentStart = pos;
    }
  };

  const submit = (endPos: number) => {
    if (currentStart === -1) return;
    if (args.length >= MAX_ARG_COUNT) {
      throw new AppError("TOO_MANY_ARGS", "参数个数超过上限", {
        max: MAX_ARG_COUNT,
      });
    }
    args.push({
      index: args.length,
      value: current,
      start: currentStart,
      end: endPos,
    });
    record({
      offset: endPos,
      char: "",
      action: "submit",
      quoted: inQuotes,
      note: `提交参数 #${args.length - 1}（长度 ${current.length}，区间 [${currentStart}, ${endPos})）`,
    });
    current = "";
    currentStart = -1;
    currentHasContent = false;
  };

  while (i < len) {
    const code = text.charCodeAt(i);
    const ch = text.charAt(i);

    // 统计连续反斜杠，仅当下一个非反斜杠字符是引号时做归并。
    if (ch === "\\") {
      let run = 0;
      const runStart = i;
      while (i < len && text.charAt(i) === "\\") {
        run += 1;
        i += 1;
      }
      if (i < len && text.charAt(i) === '"') {
        const backslashes = Math.floor(run / 2);
        current += "\\".repeat(backslashes);
        beginArg(runStart);
        currentHasContent = true;
        if (run % 2 === 1) {
          // 2n+1：字面引号，引用状态不变。
          current += '"';
          record({
            offset: runStart,
            char: `\\×${run}"`,
            action: "escaped-quote",
            quoted: inQuotes,
            note: `${run} 个反斜杠+引号 -> ${backslashes} 个反斜杠和 1 个字面引号，引用状态不变`,
          });
          i += 1;
        } else {
          // 2n：引号参与引用规则（切换状态）。
          const wasQuoted = inQuotes;
          inQuotes = !inQuotes;
          record({
            offset: runStart,
            char: `\\×${run}"`,
            action: inQuotes ? "quote-open" : "quote-close",
            quoted: inQuotes,
            note: `${run} 个反斜杠+引号 -> ${backslashes} 个反斜杠，引号${
              wasQuoted ? "关闭引用" : "开启引用"
            }`,
          });
          i += 1;
        }
      } else {
        // 未紧邻引号：全部原样保留。
        current += "\\".repeat(run);
        beginArg(runStart);
        currentHasContent = true;
        record({
          offset: runStart,
          char: `\\×${run}`,
          action: "backslash-run",
          quoted: inQuotes,
          note: `${run} 个反斜杠后非引号，原样保留`,
        });
      }
      continue;
    }

    if (ch === '"') {
      beginArg(i);
      if (inQuotes && i + 1 < len && text.charAt(i + 1) === '"') {
        // 引用内连续两个未转义引号 -> 一个字面引号，保持引用。
        current += '"';
        currentHasContent = true;
        record({
          offset: i,
          char: '""',
          action: "doubled-quote",
          quoted: true,
          note: "引用内连续两个引号 -> 1 个字面引号，保持引用",
        });
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      record({
        offset: i,
        char: '"',
        action: inQuotes ? "quote-open" : "quote-close",
        quoted: inQuotes,
        note: inQuotes ? "未转义引号开启引用" : "未转义引号关闭引用",
      });
      i += 1;
      continue;
    }

    if (!inQuotes && isWhitespace(code)) {
      submit(i);
      record({
        offset: i,
        char: ch,
        action: "delimiter",
        quoted: false,
        note: ch === "\t" ? "引用外制表符分隔参数" : "引用外空格分隔参数",
      });
      i += 1;
      continue;
    }

    beginArg(i);
    currentHasContent = true;
    current += ch;
    record({
      offset: i,
      char: ch,
      action: "literal",
      quoted: inQuotes,
      note: inQuotes ? "引用内字面字符" : "引用外字面字符",
    });
    i += 1;
  }

  // 末尾：有挂起参数（含空引用 ""）则提交；纯尾随分隔符不产生参数。
  if (currentStart !== -1 || (inQuotes && currentHasContent)) {
    submit(len);
  }

  return {
    ruleVersion: RULE_VERSION,
    input: text,
    inputLength: len,
    args,
    unterminatedQuote: inQuotes,
    steps,
    stepsTruncated,
  };
}

/**
 * 规范编码：为每个参数决定是否加外层引号并正确转义。
 *
 * - 含空格/制表符/双引号，或为空字符串的参数加外层引号。
 * - 不加引号时：每个字面双引号写成 \"（反斜杠本身无需翻倍）。
 * - 加引号时：每个字面双引号写成 \\\"（3 个反斜杠+引号：
 *   一对归并为反斜杠，余下一个转义引号）；
 *   结尾连续的反斜杠整体翻倍，保证结束引号不被吞掉。
 */
export function encodeArgs(args: unknown): EncodeResult {
  if (!Array.isArray(args)) {
    throw new AppError("NOT_STRING", "args 必须是字符串数组", {
      receivedType: typeof args,
    });
  }
  const values = args.map((value, position) => requireString(value, `args[${position}]`));

  const quotedFlags: boolean[] = [];
  const parts: string[] = [];

  for (const value of values) {
    if (value.length > MAX_INPUT_LENGTH) {
      throw new AppError("INPUT_TOO_LONG", "单个参数超过长度上限", {
        length: value.length,
        max: MAX_INPUT_LENGTH,
      });
    }
    if (findNul(value) !== -1) {
      throw new AppError("CONTAINS_NUL", "参数包含 NUL (U+0000) 字符");
    }

    const needsQuotes =
      value.length === 0 ||
      [...value].some((c) => c === " " || c === "\t" || c === '"');

    if (!needsQuotes) {
      // 无空白且无引号：直接输出即可（反斜杠原样，解码时不紧邻引号）。
      quotedFlags.push(false);
      parts.push(value);
      continue;
    }

    // 在引用上下文中逐段处理。解码器规则：引号前 2n+1 个反斜杠 ->
    // n 个反斜杠 + 字面引号（状态不变）；2n 个 -> n 个反斜杠 + 切换状态。
    let body = "";
    let p = 0;
    while (p < value.length) {
      if (value.charAt(p) === "\\") {
        let run = 0;
        const runStart = p;
        while (p < value.length && value.charAt(p) === "\\") {
          run += 1;
          p += 1;
        }
        if (p < value.length && value.charAt(p) === '"') {
          // k 个字面反斜杠 + 字面引号：需要 2k+1 个反斜杠后接引号。
          body += "\\".repeat(2 * run + 1);
          body += '"';
          p += 1;
        } else if (p === value.length) {
          // 结尾反斜杠紧邻外层结束引号：整体翻倍。
          body += "\\".repeat(2 * run);
        } else {
          body += "\\".repeat(run);
        }
        continue;
      }
      if (value.charAt(p) === '"') {
        // k=0：1 个反斜杠 + 引号即解码为字面引号。
        body += '\\"';
        p += 1;
        continue;
      }
      body += value.charAt(p);
      p += 1;
    }

    quotedFlags.push(true);
    parts.push(`"${body}"`);
  }

  return {
    ruleVersion: RULE_VERSION,
    args: values,
    commandLine: parts.join(" "),
    quoted: quotedFlags,
  };
}

/** 往返便捷函数：解析后再编码，可用于核对稳定性。 */
export function roundTripCheck(input: unknown): {
  parse: ParseResult;
  encoded: EncodeResult;
  stable: boolean;
} {
  const parsed = parseCommandTail(input);
  const encoded = encodeArgs(parsed.args.map((a) => a.value));
  const reparsed = parseCommandTail(encoded.commandLine);
  const stable =
    reparsed.args.length === parsed.args.length &&
    reparsed.args.every((arg, idx) => arg.value === parsed.args[idx]!.value);
  return { parse: parsed, encoded, stable };
}
