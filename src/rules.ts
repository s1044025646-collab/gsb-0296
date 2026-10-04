export const RULES_VERSION = "msvcrt-argv-1.0";

export const LIMITS = {
  maxInputLength: 1_000_000,
  maxArgs: 100_000,
  maxSteps: 200_000,
} as const;

export type ErrorCode =
  | "E_NOT_STRING"
  | "E_NUL"
  | "E_TOO_LONG"
  | "E_TOO_MANY_ARGS"
  | "E_BAD_REQUEST"
  | "E_NOT_FOUND";

export class ArgvError extends Error {
  constructor(public code: ErrorCode, message: string) {
    super(message);
    this.name = "ArgvError";
  }
}

export function assertValidInput(s: unknown, what = "input"): asserts s is string {
  if (typeof s !== "string") throw new ArgvError("E_NOT_STRING", `${what} 必须是字符串`);
  if (s.includes("\0")) throw new ArgvError("E_NUL", `${what} 不允许包含 NUL 字符`);
  if (s.length > LIMITS.maxInputLength)
    throw new ArgvError("E_TOO_LONG", `${what} 超过长度上限 ${LIMITS.maxInputLength}`);
}
