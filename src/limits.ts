/** 规则版本：现代 Microsoft C Runtime 普通参数规则（不含 argv[0）。 */
export const RULE_VERSION = "msvcrt-argv-1.0";

/** 输入尾串最大长度，单位为 UTF-16 代码单元。 */
export const MAX_INPUT_LENGTH = 1_000_000;

/** 扫描步骤（状态转移/字符处理）条数上限，防止解释无限增长。 */
export const MAX_STEP_COUNT = 100_000;

/** 单次允许解析出的参数个数上限。 */
export const MAX_ARG_COUNT = 100_000;

/** 批量接口单批条目上限。 */
export const MAX_BATCH_SIZE = 1_000;

/** 默认端口；0 表示由系统选择空闲端口。 */
export const DEFAULT_PORT = 0;
