import { AppError } from "./errors.js";
import { MAX_BATCH_SIZE } from "./limits.js";
import {
  encodeArgs,
  parseCommandTail,
  roundTripCheck,
  type EncodeResult,
  type ParseResult,
} from "./crt.js";
import {
  exportAllReports,
  getReport,
  listReports,
  saveReport,
  type HistoryQuery,
  type ParseRecordRow,
} from "./db.js";

export function parseAndSave(input: unknown): ParseResult & { reportId: number } {
  const result = parseCommandTail(input);
  const reportId = saveReport({
    kind: "parse",
    rawInput: result.input,
    result: result,
  });
  return { ...result, reportId };
}

export function encodeAndSave(args: unknown): EncodeResult & { reportId: number } {
  const result = encodeArgs(args);
  const reportId = saveReport({
    kind: "encode",
    rawInput: result.commandLine,
    result,
  });
  return { ...result, reportId };
}

export function roundTripAndSave(input: unknown) {
  const result = roundTripCheck(input);
  const reportId = saveReport({
    kind: "roundtrip",
    rawInput: result.parse.input,
    result,
  });
  return { ...result, reportId };
}

export interface BatchItem {
  /** 用于编码核对的参数数组（推荐提供）。 */
  args?: unknown;
  /** 或直接提供命令行尾串做解析+再编码核对。 */
  input?: unknown;
}

export interface BatchEntryResult {
  item: number;
  ok: boolean;
  args?: string[];
  commandLine?: string;
  stable?: boolean;
  error?: { code: string; message: string; details?: Record<string, unknown> };
}

/**
 * 批量核对：每个条目可给 args（编码后重解析）或 input（解析后规范编码再解析）。
 * 单条失败会记录其序号与错误码，不影响其他条目；全部处理完再返回。
 */
export function verifyBatch(items: unknown): {
  total: number;
  failed: number;
  results: BatchEntryResult[];
  reportId: number;
} {
  if (!Array.isArray(items)) {
    throw new AppError("INVALID_BATCH", "批量请求体必须是数组", {
      receivedType: typeof items,
    });
  }
  if (items.length > MAX_BATCH_SIZE) {
    throw new AppError("INVALID_BATCH", "批量条目超过上限", {
      size: items.length,
      max: MAX_BATCH_SIZE,
    });
  }

  const results: BatchEntryResult[] = items.map((item, position) => {
    try {
      if (item === null || typeof item !== "object") {
        throw new AppError("INVALID_BATCH", "条目必须是对象 { args } 或 { input }");
      }
      const entry = item as BatchItem;
      if (entry.args !== undefined) {
        const encoded = encodeArgs(entry.args);
        const reparsed = parseCommandTail(encoded.commandLine);
        const expected = encoded.args;
        const stable =
          reparsed.args.length === expected.length &&
          reparsed.args.every((arg, idx) => arg.value === expected[idx]);
        return {
          item: position,
          ok: stable,
          args: expected,
          commandLine: encoded.commandLine,
          stable,
          ...(stable
            ? {}
            : {
                error: {
                  code: "ROUNDTRIP_MISMATCH",
                  message: "重解析结果与原参数不一致",
                },
              }),
        };
      }
      if (entry.input !== undefined) {
        const parsed = parseCommandTail(entry.input);
        const encoded = encodeArgs(parsed.args.map((arg) => arg.value));
        const reparsed = parseCommandTail(encoded.commandLine);
        const original = parsed.args.map((arg) => arg.value);
        const stable =
          reparsed.args.length === original.length &&
          reparsed.args.every((arg, idx) => arg.value === original[idx]);
        return {
          item: position,
          ok: stable,
          args: original,
          commandLine: encoded.commandLine,
          stable,
          ...(stable
            ? {}
            : {
                error: {
                  code: "ROUNDTRIP_MISMATCH",
                  message: "规范编码重解析结果与首次解析不一致",
                },
              }),
        };
      }
      throw new AppError("INVALID_BATCH", "条目必须提供 args 或 input");
    } catch (cause) {
      const error =
        cause instanceof AppError
          ? { code: cause.code, message: cause.message, details: cause.details }
          : { code: "INTERNAL", message: String(cause) };
      return { item: position, ok: false, error };
    }
  });

  const failed = results.filter((r) => !r.ok).length;
  const reportId = saveReport({
    kind: "batch",
    rawInput: JSON.stringify(items),
    result: { total: results.length, failed, results },
  });
  return { total: results.length, failed, results, reportId };
}

export function fetchReport(id: number): ParseRecordRow {
  const row = getReport(id);
  if (!row) {
    throw new AppError("NOT_FOUND", `报告 #${id} 不存在`, { id });
  }
  return row;
}

export function fetchHistory(query: HistoryQuery): ParseRecordRow[] {
  return listReports(query);
}

export function fetchAllForExport(): ParseRecordRow[] {
  return exportAllReports();
}
