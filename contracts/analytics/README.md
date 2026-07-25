# Analytics contracts

此目录是 TypeScript 控制面与 Python Analytics Service 之间的语言中立契约源。契约按主版本分目录；生产调用必须携带 `contractVersion`，不兼容变更新增主版本而不覆盖旧文件。

金额、数量和需要精确重放的十进制数使用字符串或整数表示；日期时间使用带时区的 ISO 8601；JSON 不允许 `NaN`、`Infinity` 或省略必填质量状态。

`portfolio-market-input.schema.json` 冻结 Phase 3 风险计算的首个具体输入口径：USD 基础币种、`.NDX` 日历、拆股调整后的收盘到收盘价格收益、同有效日收盘汇率，以及显式缺失值策略。该版本明确不包含股息再投资，不得将其标记为总收益。
