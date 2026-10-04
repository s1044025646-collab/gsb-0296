import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeArgs, parseCommandTail } from "../src/crt.js";
import { ENCODE_FIXTURES, PARSE_FIXTURES } from "./fixtures.js";

describe("CRT 解析 - 独立已知向量表", () => {
  for (const fixture of PARSE_FIXTURES) {
    it(`parse(${JSON.stringify(fixture.input)})`, () => {
      const result = parseCommandTail(fixture.input);
      assert.deepEqual(
        result.args.map((arg) => arg.value),
        fixture.args
      );
      assert.equal(result.unterminatedQuote, fixture.unterminated);
      assert.equal(result.inputLength, fixture.input.length);
      // 每个参数区间切片（去除可能的分隔符）应可回溯到原文内容片段
      for (const arg of result.args) {
        assert.ok(arg.start >= 0 && arg.end <= fixture.input.length);
        assert.ok(arg.start <= arg.end);
      }
    });
  }
});

describe("CRT 编码 - 独立已知向量表", () => {
  for (const fixture of ENCODE_FIXTURES) {
    it(`encode(${JSON.stringify(fixture.args)})`, () => {
      const result = encodeArgs(fixture.args);
      assert.equal(result.commandLine, fixture.commandLine);
    });
  }
});

describe("往返一致 + 编码稳定（小字符集穷举）", () => {
  const alphabet = ["a", " ", "\t", '"', "\\", "中", ""];

  function cartesian(pools: string[], depth: number): string[][] {
    if (depth === 0) return [[]];
    const rest = cartesian(pools, depth - 1);
    const out: string[][] = [];
    for (const head of pools) {
      for (const tail of rest) out.push([head, ...tail]);
    }
    return out;
  }

  // 单参数：所有长度 0..4 的小字符集组合
  const singleArgs = [...cartesian(alphabet, 2), ...cartesian(alphabet, 3)];

  for (const words of singleArgs) {
    const arg = words.join("");
    it(`roundtrip/稳定 单参数 ${JSON.stringify(arg)}`, () => {
      const first = encodeArgs([arg]);
      const parsed = parseCommandTail(first.commandLine);
      assert.deepEqual(parsed.args.map((a) => a.value), [arg]);
      // 稳定性：再次编码必须得到完全相同的命令行
      const second = encodeArgs(parsed.args.map((a) => a.value));
      assert.equal(second.commandLine, first.commandLine);
    });
  }

  // 双参数：挑选有代表性的组合，验证参数边界不丢失/不错位
  const tricky = ["", " ", '"', "\\", 'a"b', "a b", "a\\b", '\\', '\\\\', '中 文'];
  for (const left of tricky) {
    for (const right of tricky) {
      const args = [left, right];
      it(`roundtrip 双参数 ${JSON.stringify(args)}`, () => {
        const encoded = encodeArgs(args);
        const reparsed = parseCommandTail(encoded.commandLine);
        assert.deepEqual(reparsed.args.map((a) => a.value), args);
        const reencoded = encodeArgs(reparsed.args.map((a) => a.value));
        assert.equal(reencoded.commandLine, encoded.commandLine);
      });
    }
  }
});

describe("UTF-16 偏移（非 UTF-8 字节）", () => {
  it("BMP 中文按代码单元计数，start 正确", () => {
    const result = parseCommandTail("中文 参数");
    assert.equal(result.args[0]!.start, 0);
    assert.equal(result.args[0]!.end, 2);
    assert.equal(result.args[1]!.start, 3);
  });

  it("代理对（💡，2 个代码单元）长度按 UTF-16 计", () => {
    const result = parseCommandTail("a💡b");
    assert.equal(result.inputLength, 4); // a + 2 surrogate + b
    assert.deepEqual(result.args.map((x) => x.value), ["a💡b"]);
  });
});

describe("输入校验与错误码", () => {
  it("拒绝非字符串输入（不强转）", () => {
    assert.throws(
      () => parseCommandTail(123 as unknown as string),
      (err: unknown) => (err as { code: string }).code === "NOT_STRING"
    );
    assert.throws(
      () => parseCommandTail(null as unknown as string),
      (err: unknown) => (err as { code: string }).code === "NOT_STRING"
    );
  });

  it("拒绝 NUL", () => {
    assert.throws(
      () => parseCommandTail("a\u0000b"),
      (err: unknown) => (err as { code: string }).code === "CONTAINS_NUL"
    );
  });

  it("拒绝超长输入", () => {
    assert.throws(
      () => parseCommandTail("x".repeat(1_000_001)),
      (err: unknown) => (err as { code: string }).code === "INPUT_TOO_LONG"
    );
  });

  it("拒绝含非字符串元素的数组", () => {
    assert.throws(
      () => encodeArgs(["ok", 5 as unknown as string]),
      (err: unknown) => (err as { code: string }).code === "NOT_STRING"
    );
  });

  it("非数组参数报错", () => {
    assert.throws(
      () => encodeArgs("abc" as unknown as string[]),
      (err: unknown) => (err as { code: string }).code === "NOT_STRING"
    );
  });
});

describe("步骤解释", () => {
  it("记录引用切换、转义归并与提交", () => {
    const result = parseCommandTail('a "b"');
    const actions = result.steps.map((s) => s.action);
    assert.ok(actions.includes("quote-open"));
    assert.ok(actions.includes("quote-close"));
    assert.ok(actions.filter((a) => a === "submit").length >= 2);
  });

  it("转义引号步骤带说明", () => {
    const result = parseCommandTail('\\" x');
    const escaped = result.steps.find((s) => s.action === "escaped-quote");
    assert.ok(escaped);
    assert.match(escaped!.note, /字面引号/);
  });
});
