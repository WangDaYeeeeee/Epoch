# Phase 3 实施记录

状态：Completed
开始日期：2026-07-26
完成日期：2026-07-27

## 目标

Phase 3“确定性风险引擎与 Policy Gate”用于回答“组合承担了多少风险，以及调仓意向是否越过唯一硬卡口”，不求解目标权重、不生成交易指令。

## 第一切片：Portfolio Risk Output Schema v1

已冻结 `portfolio-risk-output/1.0`：

- 波动率统一为年化小数，CVaR 统一为组合价值损失小数；
- 输出必须披露估计器 ID、版本、完整/降级状态、波动率与协方差方法、窗口和 252 年化因子；
- 组合层输出 σₚ、stress σₚ、95% 历史 CVaR；
- 标的层输出当前权重、年化波动率、RC 与风险/资金比；
- 相关矩阵固定披露 250 日窗口和明确标的顺序；
- Policy Gate 只包含 `portfolio_volatility_cap`，阈值固定为 `0.45`；
- 质量状态显式列出缺失标的和警告；
- 契约禁止额外的目标权重或交易字段。

Python 强类型契约额外校验 JSON Schema 无法表达的语义：

- 相关矩阵与标的顺序同维、标的唯一、矩阵对称、对角为 1、元素位于 `[-1, 1]`；
- Policy Gate 的 observed、passed 和 violations 必须彼此一致；
- Policy Gate 必须评估输出中同一个 σₚ；
- 标的风险行必须唯一并与相关矩阵顺序完全一致。

## 第二切片：降级风险数值核心

已实现无外部依赖的确定性纯计算：

- 60 日 Garman-Klass 年化已实现波动率，严格校验 OHLC 正数、high/low 不变量与完整窗口；
- 250 日对齐 USD 收益的样本协方差和相关矩阵；
- 使用 Garman-Klass `σᵢ` 与 250 日相关矩阵重建协方差，计算 `σₚ`；
- 将所有非对角相关系数置为 `0.90`，重算只呈现、不触发交易的 stress `σₚ`；
- Euler RC 及风险/资金比，黄金样本验证 `ΣRCᵢ = σₚ`；
- 95% 历史 CVaR 损失；
- 唯一 Policy Gate `σₚ ≤ 45%`。

新增 `portfolio-risk-input/1.0`，要求当前权重、每个标的至少 60 个 OHLC bar 和日期严格对齐的至少 250 个 USD 收益。纯计算运行器直接产生通过 `portfolio-risk-output/1.0` 强类型校验的降级结果。

## 第三切片：Calculation API 接入

- `POST /v1/calculations/run` 已支持 `calculationType = portfolio-risk`；
- 请求 payload 先通过 `portfolio-risk-input/1.0` 对应的 Python 强类型模型，再进入纯计算；
- 返回通用 `CalculationResponse` 信封，包含请求身份、输入哈希、引擎版本、模型版本、降级状态、诊断参数、警告与耗时；
- 不完整窗口、日期错位或非法数值返回 422；未知计算类型返回 501；
- TypeScript 客户端具备超时、网络/5xx 有界重试和 4xx 不重试；
- 客户端强制核对 `calculationId`、`calculationType` 与 `inputHash`，拒绝错配响应。

## 第四切片：真实风险输入快照

TypeScript 已可从最新持仓与标准化 `market-bars.csv` 构造 `portfolio-risk-input/1.0`：

- 券商交易所代码先归并为统一证券标识，同一证券跨账户合并；
- 风险权重使用证券 USD 市值除以包含现金和应计项的净 NAV，现金不生成零风险行情序列；因此负现金融资会真实表现为风险资产权重合计超过 100%；
- 外币 OHLC 使用同有效日 FX close 折算为 USD；
- 各标的先求共同有效日期，再用最后 251 个共同 close 生成严格对齐的 250 个 USD 收益；
- 每个标的保留最后 60 个 USD OHLC bar；
- 证券、FX 或共同历史不足时拒绝构建并报告具体标的/数量。

真实基线已端到端通过 Python 强类型契约与风险核心，使用截至 `2026-07-16` 的共同有效数据：

- 降级 `σₚ ≈ 34.01%`，通过 `45%` 唯一硬卡口；
- stress `σₚ ≈ 43.71%`，仅呈现、不触发交易；
- 95% 历史 CVaR 损失约 `5.12%`；
- 5 个当前风险标的均具备 60 日 OHLC 和 250 日共同收益。

## 第五切片：不可变 CalculationRun

- 追加迁移 `0010_calculation_run_snapshots.sql`，为既有 `calculation_run` 增加契约版本、完整输入 JSON、引擎/模型版本、诊断、警告和耗时；
- 输入 payload 使用规范化 JSON 的 SHA-256 哈希，代码版本使用风险相关源文件内容哈希；
- `(calculation_type, as_of, input_hash, code_version)` 继续作为幂等键；
- 仓储采用“认领 running → 完成 succeeded/degraded 或记录 failed”的状态流；
- 已完成记录再次请求时直接返回原结果，不覆盖不可变输入；
- `pnpm risk:run` 串联真实快照构建、Analytics 调用、迁移与落库。

第一份真实运行已保存：

- CalculationRun：`cd121166-d30c-4be7-839a-a873acd77868`
- input hash：`352ba5277fc733a201a3b6b8517f682efb9edc5c0d71937136f0b7244c904ff2`
- workspace code version：`portfolio-risk-workspace-0abe4975051a99d0`
- 状态：`degraded`

相同命令重复执行后返回同一 CalculationRun ID，已验证幂等复用。

## 第六切片：Portfolio 风险展示

- Portfolio 数据装配会从 PostgreSQL 读取最后一个 `succeeded/degraded` 的 `portfolio-risk` 运行；
- API 返回 CalculationRun ID、输入哈希、模型版本、数据日期、模型状态和行情新鲜度；
- 页面展示 `σₚ`、45% 卡口余量、stress `σₚ`、95% CVaR、模型/行情状态；
- 逐标的展示当前权重、`σᵢ`、RC 和 RC/w，并按 RC 从高到低排序；
- 降级模型与过期行情均有明确提示，不把历史运行冒充最新交易结论。

本机数据库装配已验证读取 CalculationRun `cd121166-d30c-4be7-839a-a873acd77868`，风险状态为 `degraded`、行情状态为 `stale`。

## 第七切片：调仓意向风险重算

- 新增 `POST /api/v1/risk/rebalance`，只接受显式目标权重，不求解、不归一化、不下单；
- 券商代码先规范化，重复别名、非有限权重、单项绝对权重大于 100% 和缺少验证行情的标的会被拒绝；
- 目标标的复用当前已验证的 60 日 OHLC 与 250 日共同 USD 收益；
- 调仓场景使用 `portfolio-risk-rebalance` 计算类型，独立写入 CalculationRun；
- 同一日期、目标权重、输入数据和代码版本的请求保持幂等；
- 黄金测试覆盖 `σₚ > 45%` 时唯一硬卡口失败并返回 `PORTFOLIO_VOLATILITY_CAP_EXCEEDED`。

端到端验证场景（仅用于验证，不是推荐权重）：

- GOOGL 20%、KLAC 10%、SOXX 20%、TSM 25%、SK Hynix 15%，风险资产合计 90%；
- CalculationRun：`87cd209e-dddd-4110-9300-fe599c545b9a`
- `σₚ ≈ 29.90%`，45% 卡口通过；
- stress `σₚ ≈ 38.65%`；
- 95% 历史 CVaR 损失约 `4.46%`。

## 第八切片：历史意向对比

- CalculationRun 仓储支持按计算类型读取最近完成记录；
- Portfolio API 返回最近 5 个 `portfolio-risk-rebalance` 场景，不与当前真实风险运行混淆；
- 页面展示目标权重摘要、场景 `σₚ`、相对当前变化、stress `σₚ` 与卡口结论；
- 历史意向明确标记为只读审计记录，不代表已采用或已执行。

本机数据库装配已验证同时返回当前 CalculationRun `cd121166-d30c-4be7-839a-a873acd77868` 与调仓场景 `87cd209e-dddd-4110-9300-fe599c545b9a`。

## 第九切片：显式波动率漂移锚点

- 新增 `risk_drift_anchor` 与逐标的锚点快照，只引用已完成的 `portfolio-risk` 或 `portfolio-risk-rebalance` CalculationRun；
- `GET/POST /api/v1/risk/anchors` 支持读取最近锚点，以及由用户明确指定 CalculationRun 创建锚点；
- 同一个 CalculationRun 重复确认只返回同一个锚点，不覆盖最初快照；
- Portfolio API 与页面计算并展示 `σₚ/σₚ⁰` 和逐标的 `σᵢ/σᵢ⁰`；
- 漂移达到 `1.5×` 标记为关注，达到 `2.0×` 标记为强关注；该提示不构成新的 Policy Gate，也不自动交易；
- 已退出或当前缺少的标的不伪造漂移比例。

系统不会把测试调仓场景自动提升为已执行基准。目前没有创建真实锚点，因为尚未收到某次调仓已经实际执行的明确确认。

数据库集成已验证锚点创建、读取和重复确认的幂等性。

## 第十切片：真实风险运行趋势

- Portfolio API 返回最近 30 次已完成的 `portfolio-risk` 运行，并按计算日期从旧到新排列；
- 趋势严格排除 `portfolio-risk-rebalance` 调仓意向，避免把假设组合混入真实组合时序；
- 页面逐次展示 `σₚ`、相对上次变化、stress `σₚ` 和历史 CVaR；
- `σₚ` 进度条以现行 45% 唯一硬卡口为尺度，不增加新的交易规则；
- 单点历史也会如实显示为基线，不伪造趋势变化。

## 第十一切片：用户主动风险操作

- Portfolio 页面新增调仓意向表单，从当前真实风险权重起步并允许用户显式修改；
- 表单持续显示目标权重合计与未分配/现金余量，不替用户归一化权重；
- 提交只调用 `portfolio-risk-rebalance` 测算并保存审计记录，不连接交易或下单能力；
- 页面新增锚点确认控件，可选择当前真实运行或历史调仓测算；
- 锚点确认要求用户勾选“组合已经实际执行”，提交时再进行浏览器二次确认；
- 确认成功后刷新 Portfolio 数据，测算和锚点错误均在原位显示，不丢失用户输入。

浏览器检查覆盖桌面与移动断点；检查过程未提交测算或创建锚点。

## 第十二切片：定时风险刷新与失败告警

- 新增每 6 小时检查一次的 `portfolio-risk-refresh` 调度任务；
- 风险输入日期、输入哈希和代码版本完全相同时返回 `skipped`，不重复调用 Analytics，也不制造虚假新历史点；
- 任一身份字段变化时，复用正式 CalculationRun 流程执行并幂等保存；
- 新增持久化 `operational_alert`，任务失败按来源和指纹累计次数，不用最后一次错误覆盖历史；
- 后续任务成功或安全跳过时自动将对应开放告警标记为 `resolved`；
- Portfolio 数据健康区域展示开放告警、失败原因、累计次数和最近发生时间；
- 调度任务继续使用 PostgreSQL advisory lock，多个 Scheduler 实例不会并发执行同一个任务。

数据库集成验证了同一任务连续失败两次后告警累计为 2，以及随后成功时自动恢复。迁移后的风险任务首次运行安排在 6 小时后，不会在部署瞬间意外调用 Analytics。

## 第十三切片：行情新鲜度告警

- 新增每小时运行的 `market-data-freshness-monitor`；
- 直接复用现有共同有效日期、NDX 交易日历与最大 1 个交易日滞后的判定，不复制第二套口径；
- 监控只读取本地标准化持仓和行情，不擅自联网抓取或向 Provider 发送持仓标识；
- `stale` 或 `missing` 生成独立 warning，包含最新日期、预期日期和交易日滞后；
- 持续异常按固定指纹累计出现次数，恢复为 `fresh` 后自动 resolved；
- 行情告警与 Scheduler 执行失败告警使用不同来源，互不误关闭；
- 开放 warning 复用数据健康告警区域展示。

数据库集成验证了 `stale → open warning → fresh → resolved` 的完整状态流。任务迁移后首次检查安排在 1 小时后。

## 第十四切片：行情刷新预检与人工触发

- 新增 `GET/POST /api/v1/market-data/refresh` 与数据健康页面操作控件；
- GET 返回实际刷新脚本使用的 Provider、来源 symbol、日期范围、外发披露和 SHA-256 预检指纹；
- 该切片的初始完整历史刷新范围为 30 个 Yahoo symbol 与 2 个基金 NAV 来源，共 32 个来源标识；第十五切片已将其替换为持仓驱动增量范围；
- 预检明确声明不会发送券商凭证、账户标识、仓位数量、权重或交易历史；
- 用户必须勾选外发授权并通过浏览器二次确认；
- POST 必须同时携带 `confirmed=true` 与精确的当前预检指纹，否则在接触 Provider 或数据库前拒绝；
- 刷新过程使用 PostgreSQL advisory lock，防止两次人工刷新并行覆盖本地文件；
- 成功后立即重跑本地新鲜度监控，新的风险输入由既有定时风险任务识别；
- 本切片的自动验证未调用 POST，未向外部行情 Provider 发送请求。

## 第十五切片：持仓驱动的增量行情更新

- 人工刷新目标不再使用固定 32 项清单，而是从最新非零持仓和必要 FX 对实时推导；
- 当前基线预检自动得到 GOOGL、KLAC、SOXX、TSM、SK Hynix 与 KRWUSD，共 6 个 Yahoo 来源 symbol；
- 新换入标的会自动进入预检；若尚无 Provider 映射则 fail closed，并明确列出缺失标的；
- 默认从所有必需序列的共同最新有效日前 7 个自然日回补，兼顾供应商修订和拆股事件；
- 标准化 CSV 只替换目标标的增量窗口内的记录，其他标的与更早历史完整保留；
- 每次原始响应和 manifest 写入独立 `raw/market-data/runs/<run-id>`，同时维护兼容离线归一化的最近响应；
- 任何 Provider 请求失败发生在标准化合并之前，不会用部分下载结果冒充完整刷新。

本切片只执行本地预检，得到 `2026-07-09 → 2026-07-28`、6 个目标；未向 Provider 发起请求。

## 第十六切片：刷新运行审计与完整文件替换

- 新增 `market_refresh_run`，在获得并发锁后保存当次不可变预检和 `running` 状态；
- 刷新完成后记录结构化结果并转为 `succeeded`，异常则保存失败原因并转为 `failed`；
- GET 预检响应同时返回最近一次刷新运行，页面展示时间、状态和失败原因；
- 标准化 prices、bars、splits 会先分别生成完整临时文件，全部写入成功后才替换正式文件；
- 原始响应继续在独立 run 目录先行留存，标准化合并只在所有 Provider 下载和解析完成后开始；
- 刷新本身失败时，即使审计状态落库也异常，API 仍优先返回原始刷新失败原因。

迁移与数据库集成已验证 `running → succeeded`、不可变预检、结构化结果和最近运行读取；测试记录在结束时清理。本切片未向 Provider 发起请求。

## 第十七切片：增量下载验收门

- 所有 Provider 下载和解析完成后、标准化合并开始前执行纯数据验收；
- 每个预检目标必须至少返回一条正数 close，缺失目标整体失败；
- price、bar 和 split 的日期必须位于用户确认的预检区间；
- 同一日期/标的的 price、bar 或 split 重复键会被拒绝；
- 股票目标必须返回 OHLC，且满足正数、high/low 和 open/close 不变量；
- FX 保持既有契约，只要求正数数据与 close 覆盖，不因供应商盘中 high/low 不一致误拒绝；
- split 的 numerator 和 denominator 必须为正数；
- 验收摘要包含目标数、各类新增行数和逐标的最新日期，并同时写入 run manifest 与审计结果。

纯测试覆盖完整数据通过、缺少 FX 价格失败和股票 OHLC 不一致失败。本切片未向 Provider 发起请求。

## 第十八切片：授权行情刷新与真实数据验收

- 所有者明确授权向 Yahoo Finance 发送预检中的 6 个来源标识和日期范围；
- 实际发送的标识为 GOOGL、KLAC、SOXX、TSM、000660.KS 与 KRWUSD=X，不包含账户、仓位、权重、交易或券商凭证；
- 首次响应因 Yahoo 返回区间边界外时区日期而安全失败，标准化文件未被部分覆盖；
- 下载器随后在解析层按已确认区间过滤时间戳和拆股事件，并保持完整文件暂存后原子替换；
- 重试成功写入 72 条价格和 72 条 OHLC，6/6 目标全部通过验收；
- 行情刷新审计 ID：`9d50ebb9-d6fc-47ed-bc6c-e9b28c8a058b`；
- 修正“共同有效日”判定：由各序列末日的最小值改为真实日期交集；最新共同有效日为 `2026-07-23`，相对 `2026-07-24` 预期截止日滞后 1 个交易日，状态为 `fresh`；
- `pnpm market:fetch` 已统一串联迁移、并发锁、不可变审计、增量下载、数据验收和刷新后新鲜度监控。

## 第十九切片：SHAR 日频近似与样本外回测

- 正式模型升级为 `portfolio-risk-shar-daily-j-no-iv@1.0.0`；
- 逐标的实现正/负符号半方差 `RS⁺/RS⁻` 与符号跳跃 `ΔJ = RS⁺ − RS⁻`；
- 使用日、周、月 HAR 项和符号项进行 ridge OLS，预测方差后转为年化波动率；
- 因当前只有日频 OHLC 且无 IV 数据源，运行明确标记为 `shar-daily-j-no-iv`、`degraded`，不伪装为完整 SHAR-IV-J；
- 每个标的记录模型系数、半方差、ΔJ、拟合误差，以及 60 个扩展窗一步样本外误差；
- 同时记录 HAR 基线的同口径样本外误差，用于识别 SHAR 是否真正改善而非只报告样本内拟合；
- 预测波动率驱动组合 σₚ、RC、stress σₚ 和唯一 45% Policy Gate；
- 输出最近历史崩盘周，并按相关阈值形成标的聚类。

最终真实 CalculationRun：

- ID：`96b31608-4713-4c2e-81db-a1d9c9d37c5b`
- input hash：`b43c3d21146a7bb17bf7015cb61f2b820ebe9d96c7d0b0a6d687c4da7dfba86b`
- code version：`portfolio-risk-workspace-8d2be5f199435adf`
- 数据日期：`2026-07-23`
- 状态：`degraded`（日频近似、无 IV）
- σₚ：`43.49%`
- 45% 卡口余量：约 `1.51` 个百分点，卡口通过
- stress σₚ：`55.45%`，仅呈现
- 95% 历史 CVaR：`5.12%`

最终相关性聚类为 `[GOOGL]`、`[KLAC, SOXX, TSM]`、`[SK Hynix]`。最近五个历史压力周均已记录，最差一周为 `2026-07-08` 的 `-11.61%`。

## 第二十切片：完整漂移指标与页面诊断

- 锚点逐标的快照新增风险贡献，创建新锚点时同时冻结权重、波动率和 RC；
- `D_w` 使用当前与锚点权重分布的半 L1 距离；
- `D_r` 使用当前与锚点风险贡献分布的半 L1 距离；
- 旧锚点缺少 RC 时 `D_r` 返回不可用，不伪造为零；
- 页面展示 SHAR 半方差、ΔJ、样本外误差、HAR 基线误差、相关性聚类、崩盘周以及可用时的 D_w/D_r；
- 目前仍未创建真实执行锚点，因为没有收到某次调仓已实际执行的确认；这不影响计算实现和 Phase 3 验收。

## Phase 3 最终验收

- 固定输入、模型和代码版本可幂等返回同一 CalculationRun；
- σₚ、stress σₚ、RC、CVaR、历史崩盘周和相关性聚类均由同一确定性 Python 核心产生；
- Policy Gate 对当前已验证行情宇宙内的任意显式目标权重逐条返回可解释结果，不求解权重、不归一化、不下单；
- 新标的只有取得并通过验证的行情序列后才能进入计算；研究候选池扩展归 Phase 4，当前实现 fail closed；
- IV 缺失和日频近似被明确记录为降级状态，45% 卡口值不变；
- Yahoo 刷新、行情新鲜度、定时风险运行、失败告警和恢复链路均完成数据库集成验证；
- 验收时无开放 operational alert。

Phase 3 至此收尾。后续真实调仓执行后，仅需由用户确认对应 CalculationRun 为锚点，即可开始持续计算 σᵢ/σᵢ⁰、σₚ/σₚ⁰、D_w 与 D_r。
