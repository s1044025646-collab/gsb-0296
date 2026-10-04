# crt-argv：Windows CRT 参数解析与往返编码后端

在 Windows 本地运行的纯后端服务（TypeScript + Node.js + SQLite），实现现代 Microsoft C Runtime 普通命令行参数规则的解析（decode）与规范编码（encode）。只处理文本，绝不执行输入中的任何程序或命令。

## 规则边界（重要）

- 只实现 MSVCRT `argv[1..n]` 普通参数规则（`CommandLineToArgvW` 风格的反斜杠/引号规则）。
- 不包含 `argv[0]`（程序名）的特殊解析规则。
- 不解释 PowerShell / cmd.exe 的变量展开（`$env:X`、`%X%`）、管道、重定向、命令替换等 shell 语法。输入是"程序名之后的参数尾串"，输出是字符串数组；本服务不是 shell。
- 偏移一律按 UTF-16 代码单元计数（与 JavaScript 字符串下标一致），不使用 UTF-8 字节位置。

## 核心规则

- 仅引用外的空格和制表符分隔参数。
- 未紧邻双引号的反斜杠原样保留。
- 引号前连续 2n 个反斜杠生成 n 个反斜杠，引号参与引用规则；2n+1 个生成 n 个反斜杠和一个字面引号。
- 已引用状态下连续两个未转义引号生成一个字面引号且保持引用；其余未转义引号切换引用状态。
- 空引用 `""` 产生空参数；同一参数可混合引用与非引用片段；未闭合引用按引用持续到输入末尾处理并附诊断信息，不自动补字符。
- 编码器仅在需要时（空串、含空格/制表符/引号）加外层引号；字面引号转义为 `\"`，外层结束引号前的反斜杠翻倍。保证 decode(encode(args)) 逐字保留每个参数，且编码结果稳定（幂等）。不保证任意原始命令行往返后保留同一种多余引用写法。

## 环境要求

- Windows + Node.js 22 及以上（使用内置 `node:sqlite`，无原生依赖、无 Docker/WSL/外部服务）。
- 首次使用执行 `npm install`（仅安装 TypeScript 与类型定义）。

## 命令

```powershell
npm run build   # 编译 TypeScript 到 dist/
npm test        # 构建并运行全部测试
npm start       # 启动 API（默认自动选择空闲端口；PORT=8000 可指定）
npm run demo    # 演示：空参数、带空格目录、结尾反斜杠、字面引号
```

## CLI

```powershell
node dist/src/cli.js decode '"a b" C:\tools\' --steps   # 解析并显示扫描步骤
node dist/src/cli.js encode "[\"a b\",\"\"]"            # 编码 JSON 数组（注意 shell 引号）
"[""a b""]" | node dist/src/cli.js encode --stdin       # 推荐：经 stdin 传 JSON，避免 shell 转义
node dist/src/cli.js verify batch.json                  # 批量往返核对（数组的数组），失败条目带 index
node dist/src/cli.js history 20                         # 查看历史
node dist/src/cli.js export out.json                    # 导出历史为 JSON
```

## HTTP API

默认监听 127.0.0.1 的随机空闲端口（`PORT` 环境变量可指定，占用时自动回退到空闲端口）。请求与响应均为 UTF-8 JSON。

- `GET /api/health`：规则版本与上限。
- `POST /api/decode`，体 `{"input":"...","maxSteps":1000}`：解析，返回参数（序号、内容、原始起止区间）、扫描步骤、诊断、规范编码。
- `POST /api/encode`，体 `{"args":["..."]}`：编码为规范命令行。
- `POST /api/verify`，体 `{"batch":[["..."],...]}`：批量核对往返一致性与编码稳定性，失败条目带 `index` 与 `error`。
- `GET /api/history?limit=50&offset=0`：历史记录。
- `GET /api/history/{id}`：单条记录（含完整结果 JSON）。

## 错误码

- `E_NOT_STRING`：输入/参数不是字符串（不做强转）。
- `E_NUL`：输入包含 NUL 字符。
- `E_TOO_LONG`：超过长度上限（默认 1000000 代码单元）。
- `E_TOO_MANY_ARGS`：参数数量超限（默认 100000）。
- `E_BAD_REQUEST`：请求体不是合法 JSON。
- `E_NOT_FOUND`：路由或记录不存在。

## 数据存储

- SQLite 数据库位于项目内 `data/crt-argv.db`（可用环境变量 `CRT_ARGV_DB` 指定其他路径）。
- 每条记录保存原文、规则版本（`msvcrt-argv-1.0`）、参数/编码报告、创建时间。重启后历史可正常读取（有测试覆盖）。

## 扫描步骤与解释

`decode` 返回 `steps` 数组，记录 `arg_start`、`quote_on/off`、`literal_quote`、`escaped_quote`、`backslash_collapse`、`arg_commit` 等事件及其 UTF-16 偏移。步骤数量有上限（默认 200000，可用 `maxSteps` 调整）；截短只影响解释，不影响完整参数结果（以 `stepsTruncated: true` 标识）。

## 测试

- `test/known.test.ts`：独立已知输入输出表，覆盖连续引号、奇偶个反斜杠、相邻引用片段、纯空白、空输入、未闭合引号、中文路径、非法输入拒绝、编码已知输出。
- `test/roundtrip.test.ts`：用小字符集（字母、空格、制表符、引号、反斜杠、中文）穷举生成一万多组参数对，检查往返一致与编码幂等，与已知表互补，避免两侧同错被往返测试掩盖。
- `test/api.test.ts`：API 全路由、批量失败定位、SQLite 持久化与重启读取、CLI 与 API 结果一致。

## 目录结构

- `src/rules.ts`：规则版本、上限、错误码、输入校验。
- `src/parser.ts`：逐字符扫描解码器（含步骤与诊断）。
- `src/encoder.ts`：规范编码器。
- `src/verify.ts`：批量往返核对。
- `src/store.ts`：SQLite 持久化（node:sqlite）。
- `src/server.ts`：HTTP API（端口自动选择）。
- `src/cli.ts`：命令行入口。
- `src/demo.ts`：演示脚本。
- `test/`：测试；`data/`：SQLite 数据目录（运行时生成）。

## 已知限制

- 仅 CRT 普通参数规则；不模拟任何具体程序对 argv 的二次解释，也不处理 argv[0]。
- `node:sqlite` 在 Node 25 仍带实验性警告（功能可用），升级 Node 后留意其 API 变化。
- CLI 经 PowerShell/cmd 传参时会先被 shell 处理一层引号，复杂 JSON 建议用 `--stdin`。
