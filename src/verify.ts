import { decode } from "./parser.js";
import { encode } from "./encoder.js";

export interface VerifyItemResult {
  index: number;
  ok: boolean;
  args?: string[];
  encoded?: string;
  redecoded?: string[];
  reencoded?: string;
  error?: string;
}

export interface VerifyReport {
  total: number;
  passed: number;
  failed: number;
  items: VerifyItemResult[];
}

// 批量核对：decode(encode(args)) === args 且编码稳定（encode 结果幂等）
export function verifyBatch(batch: string[][]): VerifyReport {
  if (!Array.isArray(batch)) throw new Error("batch 必须是数组的数组");
  const items: VerifyItemResult[] = batch.map((args, index) => {
    try {
      const encoded = encode(args);
      const redecoded = decode(encoded).args.map((a) => a.value);
      const reencoded = encode(redecoded);
      const roundtrip =
        redecoded.length === args.length && redecoded.every((v, i) => v === args[i]);
      const stable = reencoded === encoded;
      return {
        index,
        ok: roundtrip && stable,
        args,
        encoded,
        redecoded,
        reencoded,
        ...(roundtrip ? {} : { error: "往返不一致" }),
        ...(!stable ? { error: "编码不稳定" } : {}),
      };
    } catch (e) {
      return { index, ok: false, args, error: (e as Error).message };
    }
  });
  const failed = items.filter((i) => !i.ok).length;
  return { total: items.length, passed: items.length - failed, failed, items };
}
