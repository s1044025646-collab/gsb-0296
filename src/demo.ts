import { decode } from "./parser.js";
import { encode } from "./encoder.js";

const args = [
  "",
  "C:\\Program Files\\My App",
  "C:\\tools\\bin\\",
  '他说 "你好" 然后离开',
  "plain",
  "tab\there",
];

const encoded = encode(args);
const decoded = decode(encoded);

console.log("原始数组:");
args.forEach((a, i) => console.log(`  [${i}] ${JSON.stringify(a)}`));
console.log("\n编码串:");
console.log("  " + encoded);
console.log("\n解析结果:");
decoded.args.forEach((a) =>
  console.log(`  [${a.index}] ${JSON.stringify(a.value)}  (区间 ${a.start}..${a.end})`)
);
const ok =
  decoded.args.length === args.length && decoded.args.every((a, i) => a.value === args[i]);
console.log("\n往返一致: " + (ok ? "是" : "否"));
if (!ok) process.exitCode = 1;
