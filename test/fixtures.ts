/**
 * 独立已知输入 -> 输出表。
 * 这些向量依据 Microsoft CRT 文档规则人工推导，作为不依赖往返的独立断言，
 * 防止解析器与编码器“错成一致”而被往返测试掩盖。
 */
export interface ParseFixture {
  input: string;
  args: string[];
  unterminated: boolean;
}

export const PARSE_FIXTURES: ParseFixture[] = [
  { input: "", args: [], unterminated: false },
  { input: "   ", args: [], unterminated: false },
  { input: "\t\t  \t", args: [], unterminated: false },
  { input: "a b c", args: ["a", "b", "c"], unterminated: false },
  { input: "a  b", args: ["a", "b"], unterminated: false },
  { input: "a\tb", args: ["a", "b"], unterminated: false },
  { input: '""', args: [""], unterminated: false },
  { input: '"" ""', args: ["", ""], unterminated: false },
  { input: '"" a', args: ["", "a"], unterminated: false },
  { input: 'a ""', args: ["a", ""], unterminated: false },
  { input: '"   "', args: ["   "], unterminated: false },
  { input: '" \t "', args: [" \t "], unterminated: false },
  { input: '"a b" c', args: ["a b", "c"], unterminated: false },
  // 反斜杠不紧邻引号时原样保留
  { input: "\\foo\\bar", args: ["\\foo\\bar"], unterminated: false },
  { input: "foo\\\\", args: ["foo\\\\"], unterminated: false },
  // 奇数个反斜杠 + 引号 => 字面引号
  { input: '\\"', args: ['"'], unterminated: false },
  { input: '\\\\"a"', args: ['\\a'], unterminated: false },
  { input: '\\\\\\"', args: ['\\"'], unterminated: false },
  // 偶数个反斜杠 + 引号 => 反斜杠归并，引号参与引用
  { input: '\\" a', args: ['"', "a"], unterminated: false },
  { input: '"foo\\\\"', args: ["foo\\"], unterminated: false },
  // 引用内连续两个引号 => 一个字面引号，保持引用
  { input: '"""', args: ['"'], unterminated: true },
  { input: '"a""b"', args: ['a"b'], unterminated: false },
  { input: '"say ""hi"""', args: ['say "hi"'], unterminated: false },
  // 相邻引用片段混合
  { input: '"a"b"c"', args: ["abc"], unterminated: false },
  { input: 'ab"c d"ef', args: ["abc def"], unterminated: false },
  // 未闭合引用持续到末尾，不补字符
  { input: '"未闭合 的参数', args: ["未闭合 的参数"], unterminated: true },
  { input: 'a "b c', args: ["a", "b c"], unterminated: true },
  // 中文路径（UTF-16 下 BMP 字符每字 1 单元）
  { input: "中文 路径", args: ["中文", "路径"], unterminated: false },
  { input: '"C:\\测试 目录"', args: ["C:\\测试 目录"], unterminated: false },
];

/** 独立编码向量：参数数组 -> 期望的规范命令行。 */
export interface EncodeFixture {
  args: string[];
  commandLine: string;
}

export const ENCODE_FIXTURES: EncodeFixture[] = [
  { args: [], commandLine: "" },
  { args: [""], commandLine: '""' },
  { args: ["", ""], commandLine: '"" ""' },
  { args: ["abc"], commandLine: "abc" },
  { args: ["a b"], commandLine: '"a b"' },
  { args: ["a\tb"], commandLine: '"a\tb"' },
  { args: ["C:\\dir\\"], commandLine: "C:\\dir\\" },
  { args: ['a"b'], commandLine: '"a\\"b"' },
  { args: ['a\\"b'], commandLine: '"a\\\\\\"b"' },
  { args: ['"'], commandLine: '"\\""' },
  { args: ['\\"'], commandLine: '"\\\\\\""' },
  { args: ['" "'], commandLine: '"\\" \\""' },
];
