import { test } from "node:test";
import assert from "node:assert/strict";
import { decode } from "../src/parser.js";
import { encode } from "../src/encoder.js";

// 独立已知输入输出表（不依赖往返）
const KNOWN: Array<[string, string[]]> = [
  ["", []],
  ["   \t  ", []],
  ["abc", ["abc"]],
  ["a b\tc", ["a", "b", "c"]],
  ['""', [""]],
  ['"" ""', ["", ""]],
  ['"a b" c', ["a b", "c"]],
  ['a"b"c d', ["abc", "d"]], // 相邻引用片段混合
  ['"a""b"', ['a"b']], // 引用内连续引号 -> 字面引号，保持引用
  ['"a"""', ['a"']],
  ["\\\\", ["\\\\"]], // 未紧邻引号的反斜杠原样保留
  ['\\\\"x"', ["\\x"]], // 2n 个反斜杠 -> n 个，引号切换引用
  ['\\\\"x', ["\\x"]],
  ['\\"a\\"', ['"a"']], // 奇数个反斜杠 -> 字面引号
  ['\\\\\\"x', ['\\"x']], // 3 个反斜杠(2n+1) -> 1 个 + 字面引号，x 仍在同参数
  ['\\\\\\\\"x', ["\\\\x"]], // 4 个反斜杠(2n) -> 2 个，引号切换引用
  ['"C:\\Program Files\\"', ['C:\\Program Files"']], // 引用内 \" 是转义引号（经典陷阱）
  ['"C:\\bin\\\\"', ["C:\\bin\\"]], // 结束引号前反斜杠翻倍
  ["中文 路径", ["中文", "路径"]],
  ['"D:\\游戏 目录\\存档"', ["D:\\游戏 目录\\存档"]],
  ['"unclosed', ["unclosed"]], // 未闭合引用
  ['a "b c', ["a", "b c"]],
  ['"a"b"c"', ["abc"]],
];

test("已知输入输出表", () => {
  for (const [input, expected] of KNOWN) {
    const r = decode(input);
    assert.deepEqual(r.args.map((a) => a.value), expected, `decode(${JSON.stringify(input)})`);
  }
});

test("未闭合引用附带诊断且不补字符", () => {
  const r = decode('"abc');
  assert.equal(r.args[0].value, "abc");
  assert.equal(r.diagnostics.length, 1);
  assert.match(r.diagnostics[0], /未闭合/);
});

test("步骤记录与截短", () => {
  const r = decode('a "b" c', 3);
  assert.equal(r.steps.length, 3);
  assert.equal(r.stepsTruncated, true);
  assert.deepEqual(r.args.map((a) => a.value), ["a", "b", "c"]); // 截短不影响结果
  const full = decode('a "b" c');
  assert.ok(full.steps.some((s) => s.kind === "quote_on"));
  assert.ok(full.steps.some((s) => s.kind === "arg_commit"));
});

test("偏移按 UTF-16 代码单元", () => {
  const r = decode('中 "x y"');
  assert.equal(r.args[1].start, 2);
  assert.equal(r.args[1].end, 7);
});

test("拒绝非法输入", () => {
  assert.throws(() => decode("a\0b"), /NUL/);
  assert.throws(() => decode(123 as unknown as string), /字符串/);
  assert.throws(() => encode(["a\0"]), /NUL/);
  assert.throws(() => encode(["a", 1] as unknown as string[]), /字符串/);
});

test("编码已知输出", () => {
  assert.equal(encode(["abc"]), "abc");
  assert.equal(encode([""]), '""');
  assert.equal(encode(["a b"]), '"a b"');
  assert.equal(encode(['a"b']), '"a\\"b"');
  assert.equal(encode(["C:\\bin\\"]), "C:\\bin\\"); // 无空格/引号时无需外层引号
  assert.equal(encode(["C:\\a b\\"]), '"C:\\a b\\\\"'); // 引用内结尾反斜杠翻倍
  assert.equal(encode(["a", "b"]), "a b");
});
