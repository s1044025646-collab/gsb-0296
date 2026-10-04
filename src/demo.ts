import { resolve } from "node:path";
import { openDatabase } from "./db.js";
import { encodeArgs, parseCommandTail } from "./crt.js";

openDatabase(resolve(process.env.ARGV_DATA_DIR ?? "data", "app.db"));

const demoArgs: string[] = [
  "",
  "C:\\Program Files\\Windows NT",
  "C:\\Users\\张三\\Documents\\路径\\",
  '他说:"你好"',
  "制表\t符与空格",
];

function line(title: string): void {
  process.stdout.write(`\n=== ${title} ===\n`);
}

line("1. 输入参数数组");
console.log(demoArgs);

const encoded = encodeArgs(demoArgs);
line("2. 规范编码命令行（参数尾串）");
console.log(encoded.commandLine);
console.log("逐参数是否加引号:", encoded.quoted);

const parsed = parseCommandTail(encoded.commandLine);
line("3. 按同一规则重新解析");
for (const arg of parsed.args) {
  console.log(
    `#${arg.index} [${arg.start}, ${arg.end}) len=${arg.value.length} =>`,
    JSON.stringify(arg.value)
  );
}

const recovered = parsed.args.map((arg) => arg.value);
const ok =
  recovered.length === demoArgs.length &&
  recovered.every((value, index) => value === demoArgs[index]);
line("4. 往返核对");
console.log(ok ? "PASS：数组 -> 编码 -> 解析，逐元素精确保留" : "FAIL：往返不一致");
if (!ok) process.exitCode = 1;

line("5. 未闭合引用诊断（不补字符）");
const open = parseCommandTail('"未闭合 的参数');
console.log({
  unterminatedQuote: open.unterminatedQuote,
  args: open.args.map((arg) => arg.value),
});
