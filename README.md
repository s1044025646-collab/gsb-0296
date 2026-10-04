# Windows CRT 参数引用解析与往返编码后端

使用 **TypeScript + Node.js + SQLite** 从零实现的 Windows 命令行“普通参数”解析器与规范编码器，只提供 **HTTP API** 与 **CLI**，不含任何前端。

系统**只解析文本**，不会执行输入中的任何程序或命令；也不调用现成的 argv 解析库、操作系统接口或 shell 来代替核心算法。SQLite 使用 Node 内置的 `node:sqlite`（免原生编译）。

## 适用规则与边界

本项目实现的是**现代 Microsoft C 运行时（CRT / UCRT）普通参数**规则，输入是**不含程序名（`argv[0]`）的参数尾串**。

- 仅引用（双引号）**外**的空格 `U+0020` 和制表符 `U+0009` 分隔参数；连续分隔符不产生空参数。
- 反斜杠只有在**紧邻双引号**时才有转义意义：
  - 引号前连续 **2n** 个反斜杠 → 生成 **n** 个反斜杠，引号参与引用规则（开启/关闭引用）；
  - 引号前连续 **2n+1** 个反斜杠 → 生成 **n** 个反斜杠和**一个字面引号**，引用状态不变。
  - 未紧邻引号的反斜杠**原样保留**。
- **已引用状态**下连续两个未转义引号 `""` → 生成一个字面引号并**保持引用**；其余未转义引号切换引用状态。
- 空引用 `""` 产生空参数；同一参数可以混合引用与非引用片段（如 `"a"b` 等价于 `ab`）。
- **未闭合引用**按“引用持续到输入末尾”处理，并在结果中给出 `unterminatedQuote: true` 诊断，**不会擅自补一个引号**。

### 明确不做的事（语法边界）

- **不实现 `argv[0]`（程序名）的特殊规则**——`argv[0]` 对引号/反斜杠的处理与普通参数不同，输入约定已剔除程序名。
- **不解释 PowerShell 语法**：PowerShell 不是 CRT 引用模型，单引号、反引号转义、`$变量`、子表达式 `$(...)` 等均不识别。
- **不解释 cmd.exe 语法**：`%VAR%`、`%^` 转义、管道 `|`、重定向 `> <`、`&&`、命令替换等一律按普通字符对待。
- 不做环境变量展开、通配符（glob）展开、路径查找或进程创建。

### 编码规则（规范形式）

`encode(args)` 自行决定每个参数是否加外层引号，并保证 `parse(encode(args))` 逐元素精确保留原数组：

- 空字符串、含空格/制表符/双引号的参数加外层引号；其余不加。
- 引用内，字面引号编码为反斜杠+引号；若引号前还有 `k` 个字面反斜杠，则这 `k` 个反斜杠与转义反斜杠一起写成 `2k+1` 个反斜杠后接引号。
- 参数末尾连续的反斜杠紧邻外层结束引号时整体**翻倍**，避免结束引号被误吞。
- 编码结果是**稳定**的：`encode(parse(encode(args)))` 与 `encode(args)` 完全相同。但不保证保留原始命令行中冗余的引用写法（等价写法会被规范化）。

## 偏移与计数约定

- 所有 `start` / `end` / 步骤中的 `offset` / `inputLength` 均按 **UTF-16 代码单元**计数（与 JavaScript 字符串索引一致），**不是 UTF-8 字节位置**。例如 BMP 中文每字 1 个单元，`💡` 这样的补充平面字符占 2 个单元。
- 输入上限 `MAX_INPUT_LENGTH = 1,000,000` 代码单元；步骤记录上限 `MAX_STEP_COUNT = 100,000`；参数个数上限 `100,000`；批量单批 `1,000` 条（见 `src/limits.ts`）。
- 步骤达到上限时 `stepsTruncated=true`，**解释被截短不影响完整参数结果**（参数扫描不受步骤上限影响）。
- 拒绝 **NUL（U+0000）**、**非字符串**输入与**超限**输入，错误以明确错误码返回，绝不把非法数据 `String()` 强转。

## 错误码

| 错误码 | 含义 |
| --- | --- |
| `NOT_STRING` | 期望字符串却收到其它类型（不会隐式强转） |
| `CONTAINS_NUL` | 输入含 U+0000 |
| `INPUT_TOO_LONG` | 输入或单个参数超过长度上限 |
| `TOO_MANY_ARGS` | 参数个数超过上限 |
| `INVALID_BATCH` | 批量请求体不是数组 / 超过批量上限 / 条目结构不合法 |
| `INVALID_JSON` | HTTP 请求体不是合法 JSON |
| `INVALID_QUERY` | 查询参数非法（如 id 不是正整数） |
| `NOT_FOUND` | 报告 id 不存在 / 路由不存在 |

批量中单条失败会在结果里标出该条的 **`item` 序号（从 0 开始）与错误码**，不影响其它条目；CLI 在批量存在失败条目不成功时以退出码 `2` 结束。

## 环境要求

- Windows 本地运行；Node.js **>= 22.5**（开发与实测版本为 Node v25.5.0，使用内置 `node:sqlite`）。
- 不依赖 Docker、WSL、付费服务或任何外部在线 API。

## 安装、构建、测试、启动、演示

```powershell
# 安装依赖（仅 typescript 与 @types/node）
npm install

# 类型检查 + 编译到 dist/
npm run build

# 构建并运行全部测试（核心向量表 / 穷举往返 / 持久化 / API+CLI 一致性）
npm test

# 启动 HTTP 服务：默认端口 0 = 自动选择空闲端口，启动时打印实际端口
npm start
# 也可指定端口或用环境变量
node dist/src/server.js --port=8731
$env:PORT="8731"; npm start

# 运行演示：终端同时打印 参数数组 -> 编码串 -> 解析结果 -> 往返核对
npm run demo
```

数据默认写入项目内 `data/app.db`（SQLite，WAL 模式），可用环境变量 `ARGV_DATA_DIR` 覆盖目录。

## HTTP API

所有请求/响应均为 UTF-8 JSON。

| 方法与路径 | 说明 |
| --- | --- |
| `GET /health` | 健康检查 |
| `POST /api/parse` | `{ "input": "尾串" }` → 参数数组、区间、未闭合诊断、步骤（并持久化） |
| `POST /api/encode` | `{ "args": ["...", "..."] }` → 规范命令行、逐参数是否加引号（并持久化） |
| `POST /api/roundtrip` | `{ "input": "尾串" }` → 解析 + 规范编码 + 稳定性结论 |
| `POST /api/batch-verify` | `{ "items": [{ "args": [...] } 或 { "input": "..." }] }`，失败条目带序号与错误码 |
| `GET /api/reports` | 历史查询，支持 `kind`、`q`（原文模糊匹配）、`limit`、`offset` |
| `GET /api/reports?id=N` | 查看单条报告（含完整解析结果与步骤） |
| `GET /api/export` | 导出全部报告为 JSON |

解析结果中每个参数形如：

```json
{ "index": 0, "value": "a b", "start": 0, "end": 5 }
```

`steps` 中每条记录包含 `index`、`offset`、`char`、`action`（`delimiter` / `literal` / `backslash-run` / `quote-open` / `quote-close` / `escaped-quote` / `doubled-quote` / `submit`）、扫描后 `quoted` 状态与中文 `note` 说明。

## CLI

```powershell
node dist/src/cli.js parse '"a b" c' --steps   # 解析，--steps 附带关键扫描步骤
node dist/src/cli.js encode -- "" "a b" 'c"d'  # 编码（-- 之后均为参数，避免选项解析）
node dist/src/cli.js roundtrip '"a b" c'        # 解析后规范编码并核对稳定性
node dist/src/cli.js batch-verify examples/batch-items.json
node dist/src/cli.js history --kind parse --limit 20
node dist/src/cli.js report 1                   # 查看某条报告
node dist/src/cli.js export out.json            # JSON 导出（省略文件名则打印到终端）
```

> 在 PowerShell 中把命令行尾串作为**一个**参数传给 `parse` 时，请按需用 PowerShell 自己的引号包好；PowerShell 引号只负责把字符串传进 Node，本程序内部再按 CRT 规则解析该字符串。

## 目录结构

```
src/
  limits.ts     规则版本与各类上限
  errors.ts     错误码、AppError、字符串/NUL 校验
  crt.ts        核心：逐字符扫描解析器 + 规范编码器 + 往返核对
  db.ts         node:sqlite 持久化（reports 表）
  service.ts    解析/编码/批量核对/历史，落库
  server.ts     HTTP API（默认空闲端口）
  cli.ts        命令行入口
  demo.ts       演示
test/
  fixtures.ts          独立已知输入输出表（人工推导，防止“两边错成一致”）
  core.test.ts         向量表、小字符集穷举往返与编码稳定性、UTF-16 偏移、错误码
  persistence.test.ts  SQLite 持久化与重启读取
  integration.test.ts  HTTP API 与 CLI 结果一致性
examples/batch-items.json
```

## 已知限制与假设

- 规则版本标记为 `msvcrt-argv-1.0`；若未来调整规则可在 `src/limits.ts` 升级版本号，历史报告保留各自版本。
- 只把空格与制表符作为分隔符（CRT 普通参数规则），不把其它 Unicode 空白当分隔符。
- 单进程内使用一个 SQLite 连接，面向本地单机使用，未做高并发写入压测与鉴权（建议仅监听本机回环）。
- 依赖 Node 内置 `node:sqlite`（实验特性，运行时会打印一条 ExperimentalWarning，不影响功能）。
