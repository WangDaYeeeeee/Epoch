# Analytics contracts

此目录是 TypeScript 控制面与 Python Analytics Service 之间的语言中立契约源。契约按主版本分目录；生产调用必须携带 `contractVersion`，不兼容变更新增主版本而不覆盖旧文件。

金额、数量和需要精确重放的十进制数使用字符串或整数表示；日期时间使用带时区的 ISO 8601；JSON 不允许 `NaN`、`Infinity` 或省略必填质量状态。

`portfolio-market-input.schema.json` 冻结 Phase 3 风险计算的首个具体输入口径：USD 基础币种、`.NDX` 日历、拆股调整后的收盘到收盘价格收益、同有效日收盘汇率，以及显式缺失值策略。该版本明确不包含股息再投资，不得将其标记为总收益。

`portfolio-risk-output.schema.json` 冻结 Phase 3A 风险输出：所有波动率均为年化小数，CVaR 为组合价值损失小数；输出必须披露估计器、降级状态、窗口、年化因子、逐标的 RC、250 日相关矩阵及唯一硬卡口 `σₚ ≤ 45%`。该契约不包含目标权重求解或交易指令。

`portfolio-risk-input.schema.json` 是降级风险引擎的直接输入：当前权重、每个标的至少 60 个日频 OHLC bar，以及按日期严格对齐的至少 250 个 USD 收益。权重以净 NAV 为分母，现金计入分母但不生成零风险序列，因此负现金融资可使风险资产权重合计超过 100%。外币 OHLC 使用同有效日收盘汇率统一折算为 USD；收益是在严格共同日期上计算的 USD 收盘到收盘价格收益，不含股息。价格和收益使用 JSON number，因为它们是模型观测与计算输入；账本数量和金额仍沿用精确十进制字符串。
