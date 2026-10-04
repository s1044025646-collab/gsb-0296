import { test } from "node:test";
import assert from "node:assert/strict";
import { decode } from "../src/parser.js";
import { encode } from "../src/encoder.js";

const CHARSET = ["a", " ", "\t", '"', "\\", "中"];

function* strings(maxLen: number): Generator<string> {
  yield "";
  if (maxLen === 0) return;
  for (const s of strings(maxLen - 1)) {
    for (const c of CHARSET) yield c + s;
  }
}

test("小字符集穷举往返一致与编码稳定", () => {
  let count = 0;
  for (const s of strings(3)) {
    for (const t of strings(2)) {
      const args = [s, t];
      const enc1 = encode(args);
      const dec = decode(enc1).args.map((a) => a.value);
      assert.deepEqual(dec, args, `roundtrip ${JSON.stringify(args)}`);
      const enc2 = encode(dec);
      assert.equal(enc2, enc1, `stability ${JSON.stringify(args)}`);
      count++;
    }
  }
  assert.ok(count > 10000);
});
