export type ErrorCode =
  | "NOT_STRING"
  | "CONTAINS_NUL"
  | "INPUT_TOO_LONG"
  | "TOO_MANY_ARGS"
  | "STEP_LIMIT_REACHED"
  | "INVALID_BATCH"
  | "BATCH_ITEM_TOO_LARGE"
  | "NOT_FOUND"
  | "INVALID_JSON"
  | "INVALID_QUERY";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }
}

/** 严格要求字符串：拒绝 null/undefined/数字/对象等，不做隐式 String() 强转。 */
export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new AppError(
      "NOT_STRING",
      `字段 ${field} 必须是字符串，收到 ${value === null ? "null" : typeof value}`,
      { field, receivedType: value === null ? "null" : typeof value }
    );
  }
  return value;
}

/** 拒绝 NUL 字符（U+0000），返回 NUL 的首个代码单元偏移（如有）。 */
export function findNul(text: string): number {
  return text.indexOf("\u0000");
}
