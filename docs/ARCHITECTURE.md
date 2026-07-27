# Epoch 技术架构

状态：Draft v0.5
日期：2026-07-26

> v0.5 变更摘要：ETF 穿透采用自动发现、可替换 Holdings Provider、版本化快照与最后可信状态；调仓新增 ETF 不修改领域代码，发行人文件与手工 CSV 仅作兜底。v0.4 已完成策略大改与券商接入边界对齐。

## 1. 架构目标

技术架构服务于以下目标：

- 组合数据可信、可对账、可重算；
- 外部数据来源、金融模型和 Agent 均可替换；
- 事实数据、客观计算、Agent 判断与人工决定分层保存；
- 客观计算、语义判断与硬约束收口的责任边界可执行；
- 投资策略是唯一规则来源，规则不散落在界面、数据库触发器或 Agent Prompt 中；
- 每次风险计算、Agent 运行、调仓意向和约束校验均可追溯；
- 本地部署简单，长期维护成本低；
- 券商交易权限始终与系统隔离。

## 2. 架构原则

### 2.1 单仓库与有限运行时边界

产品与领域代码继续作为一个单仓库的模块化系统管理，不按业务名词拆分多个仓库或微服务。只在运行时、依赖和资源特征存在实质差异时建立进程边界：TypeScript 控制面负责事实、编排、审计和收口；Python Analytics Service 负责数值模型和组合风险计算。

该边界是单个产品内的运行时隔离，不代表将 Epoch 演变为通用微服务系统。两端通过版本化的 JSON Schema 协作，不共享语言内部对象。

### 2.2 四类数据分离

| 类型 | 内容 | 生成者 | 是否可覆盖上一层 |
|---|---|---|---|
| 事实 | 账本、行情、期权链、事件时间、原始证据 | Connectors / 所有者 | 否 |
| 计算 | NAV、收益归因、SHAR、σₚ、RC、CVaR、压力测试 | 确定性代码 | 否 |
| 判断 | 六因子评估、权重档位、主线判断、预案、调仓意向 | Agent / 所有者 | 否 |
| 决定 | 确认、修改、拒绝与实际执行 | 所有者 | 仅以新版本追加 |

Agent 不能将推论写成事实，也不能将调仓意向写成最终决定。

### 2.3 计算—判断—收口

```text
不可变原始数据
        ↓
归一化事实与组合快照
        ↓
确定性计算层：绩效 / SHAR / σₚ / RC / CVaR / 压力情景
        ↓
外部 Agent 判断层：研究 / 预案 / 波动性质 / 调仓意向
        ↓
确定性收口层：重算意向后组合 + 硬约束校验
        ↓
所有者决定 → 券商端手工执行
```

判断层可以提出任意有理由的调仓意向，但收口层不评价理由，只根据适用策略版本与当时数据执行机械校验。

## 3. 总体架构

```text
IBKR / 交易所 / 公司文件 / 市场与事件数据
                         │
                     Connectors
                         │
                  原始不可变数据层
                         │
              归一化 / 对账 / 快照构建
                         │
               PostgreSQL 领域模型
                         │
                 TypeScript 控制面
        ┌──────────┼──────────┐
        │          │          │
     Web UI       Scheduler    Operations / Journal
        │          │          │
        │     版本化计算契约       │
        │          ▼          │
        │   Python Analytics Service
        │          │
        └──── Policy Gate ─── Agent Gateway
                              │
                    Codex / Claude 通用 Agent
```

Web UI 和 Agent Gateway 共享同一 TypeScript 领域服务。Scheduler 固化输入快照后调用 Analytics Service，验证返回结果并写入 `CalculationRun`。Analytics Service 不直接修改数据库，Agent 不直接访问数据库，也不自行实现风险公式或硬约束。

## 4. 技术选型

| 层级 | 选择 | 说明 |
|---|---|---|
| Web UI | Next.js + TypeScript | Operations、Portfolio、Allocation & Risk、Journal |
| API | Next.js Route Handlers + TypeScript | 领域接口、Agent Gateway 与数据服务；与 Web 共享类型 |
| 业务计算 | TypeScript 确定性模块 | 账本、NAV、输入快照、计算编排和 Policy Gate |
| 量化计算 | Python Analytics Service | SHAR/HAR、协方差、σₚ、RC、CVaR、压力测试和回测 |
| 计算契约 | JSON Schema + HTTP | TypeScript 与 Python 共享版本化输入输出，不共享数据库写权 |
| 数据库 | PostgreSQL | 事实、版本、计算结果和审计关系 |
| 原始数据 | 本地对象目录 | 保存不可变外部响应与内容哈希 |
| 图表 | Recharts | 金融时间序列、归因与风险解释 |
| 调度 | 轻量任务调度 | 日终同步、每日计算和事件扫描 |
| Agent 接口 | 本地 CLI/API + JSON Schema | 为单一通用 Agent 提供受限工具 |
| 部署 | Docker Compose | 单仓库、一条命令启动 Web、Scheduler、Analytics 和 PostgreSQL |

具体 HAR 实现库与期权工具在模型细化后确定。架构通过稳定的计算接口、版本化参数和计算运行记录隔离具体库，不在 TypeScript 产品层绑定某个 Python 实现。Python 计算核心保持为纯函数/可测试包，HTTP 层只负责契约校验、调用和错误封装。

## 5. 模块边界

### 5.1 connectors

负责外部系统接入、认证、限速、重试、时效标记和原始响应留存。账本、行情、汇率、期权链、基本面与事件数据分别实现连接器，不让上游差异泄漏进领域层。

### 5.2 ledger

负责交易、现金流、股息、费用、公司行动、成本和对账。它是组合计算的可信来源；成本价只向账本、税务与行为复盘提供，不进入权重决策。

### 5.3 portfolio

负责持仓快照、NAV、TWR、MWR、回撤、基准对比和收益归因。所有结果均显式绑定 as-of 时间、基础币种和数据快照。

### 5.4 exposure

负责证券到发行人、ETF 底层持仓、行业、地域、币种、主题与因子的映射。它从最新持仓自动发现基金，不保存任何 SOXX 等单一产品的特例；ETF 成分由 connectors 的统一 Holdings Provider 契约输入。穿透敞口用于解释风险来源，不自行生成仓位上限。

### 5.5 analytics

负责纯计算能力：

- 历史和前瞻波动率；
- HAR-RV / SHAR-IV-J 及后续模型变体；
- 协方差与 250 日相关性估计；
- 组合波动率 σₚ、stress σₚ（ρ = 0.90）与波动率漂移倍数；
- RC、风险/资金比、乖离度与相关性聚类；
- CVaR、历史情景和压力测试；
- 指数隐波、隐含相关性、put skew、GEX 与其他市场结构指标。

`analytics` **不求解权重**。ERC 与均值方差类优化不在职责内——权重由所有者按档位人工给出，数学模型只做风险度量与监控呈现。

`analytics` 输出带单位的数值、质量状态和计算说明，不输出“应该买入/卖出”的语义判断。

`analytics` 作为仅在内部网络暴露的无状态 Python 服务运行。它不持有券商凭证、不拥有领域数据库写权，不负责任务排期、幂等或最终决策。所有生产调用都由 Scheduler 提交冻结输入；命令行入口只用于开发、黄金样本重放和故障诊断。

### 5.6 policy

负责策略版本、参数集、提示、复核待办和唯一硬卡口。主要职责是：

- 校验组合波动率 σₚ ≤ 45%，并输出余量；
- 校验替代标的是否来自已评估候选池；
- 校验目标权重是否落在构建规则区间 [10%, 40%] 且为 5% 的倍数；
- 检查 90 天禁回购（仅约束主动清仓）、参数冻结期与仅允许降风险的状态；
- 跟踪回补批次的触发条件与强制时限；
- 对调仓意向的目标组合重新计算并输出逐条校验结果。

`policy` 不判断公司质量、主线是否证伪或波动是否系统性。

> **唯一能强制交易的条款是 σₚ 卡口。** 波动率漂移、RC、风险/资金比、乖离度、CVaR 与压力情景均只产生提示与复核待办，不构成否决理由。[10%, 40%] 是构建规则，在设定目标权重时检查一次，**不因市价波动触发临时调仓**。

### 5.7 operations

负责每日运行状态、事件视界、预案状态、待办、预警、触发和待审核对象。它协调计算、Agent 任务和人工确认，但不复制各模块的业务规则。

### 5.8 journal

负责结构化研究、因子评估、权重档位与三行理由、事实/假设/推论、催化剂、证伪条件、预案、调仓意向、最终决定、实际执行和复盘。主观对象均使用追加版本，保留当时语境。

调仓记录表字段与《投资策略》5.1 保持一致，含触发类型、σᵢ 与锚点 σᵢ⁰（注明估计器）、σₚ 与 stress σₚ、权重档位及三行理由、监控盘异常项与复核结论、计划 vs 实际执行。

### 5.9 agent_gateway

向 Codex 和 Claude 暴露受限、结构化、可审计的查询与写入能力。第一版只服务一个通用投资 Agent，不为不同任务建立独立后端或重复能力。

## 6. 数据时效与来源分层

| 数据层 | 用途 | 首选来源 | 频率 |
|---|---|---|---|
| 账本 | 交易、现金、股息、费用、公司行动 | IBKR Flex Web Service | 每日 |
| 价格与汇率 | OHLC、指数、基准、USD 统一收益 | 独立日频行情源 | 日频 |
| ETF 底层持仓 | 成分、权重、持股数与基金内市值 | 发行人文件自动导入；结构化付费 API 可选 | 调仓分析前或快照过期时 |
| 日内收益 | 严格口径的 RS± / ΔJ | 待补数据源（当前用日频近似） | — |
| 期权 | IV、skew、GEX 与期限结构 | 待补数据源 | — |
| 指数隐波与隐含相关性 | 系统性 vs 特质性判据 | CBOE 公开数据 | 日频 |
| 基本面 | 财报、指引与公司事实 | 官方文件优先 | 事件驱动 |
| 事件 | 财报日、宏观、政策与行业日程 | 官方日历/多来源 | 每日扫描 |
| 主观数据 | 评估、预案、意向、决定与复盘 | Agent / 所有者 | 任务/事件驱动 |

### 6.1 券商接入边界

IBKR Flex Activity Statement 作为日终可对账账本，不用于实时轮询。Flex Web Service 是无状态 HTTPS 拉取，token 支持 IP 白名单与最长一年有效期，适合无人值守的固定 IP 部署。

**Epoch 不接入 TWS API 与 Client Portal Gateway。** 两者均需常驻会话与每日交互式二次认证，与"不做盘中高频探测"的产品边界及无人值守部署冲突。因此：

- 不存在盘中持仓、盘中余额与 WebSocket 订阅链路；
- 期权链、IV 与 put skew 当前**无数据源**，`β_iv` 外生项按降级口径运行；
- 组合风险计算只依赖日频 OHLC 与汇率，不依赖券商实时行情。

已实现的 `ibkr-web` 只读连接状态检查保留为可选能力，默认不启用。

### 6.2 时效标记

每个数据集记录最后成功时间、应有截止时间、质量状态和降级原因。数据不新鲜时不得静默沿用“正常”状态。

### 6.3 ETF Holdings Provider

ETF 穿透与单一发行人的网页或文件格式解耦。Scheduler 从最新非零持仓识别基金集合，按 `(fund_instrument_id, as_of, provider)` 查找本地快照；缺失或超过时效阈值时调用 Provider，未过期时直接复用。新增、换入或卖出 ETF 均由持仓事实驱动，不要求修改分类代码。

统一 Provider 输出至少包含基金标识、`as_of`、抓取时间、来源、原始响应哈希、成分标识、权重、可选持股数和基金内市值。原始响应不可变留存，标准化快照追加写入，不覆盖历史；历史组合计算必须选择当时可得的快照，避免前视偏差。

Provider 优先级：

1. 发行人官方 CSV / 文件适配器，原始文件放入私有目录后自动解析；
2. 所有者提供的统一 CSV 格式；
3. 覆盖当前持仓、支持明确 `as_of` 的结构化 ETF Holdings API（可选付费 Provider）；
4. SEC N-PORT 用作免费低频兜底；按 CIK 与 Series ID 双重识别基金，并遵守 SEC User-Agent 与限速要求。

主 Provider 失败时保留最后可信快照并标记 `stale`；从未成功取得的基金进入“待穿透”，不得把基金管理人当作经济发行人。某一发行人端点受阻只降低该适配器优先级，不构成领域层阻塞。

## 7. 核心领域模型

### 7.1 事实与组合

```text
Account
Instrument
Issuer
Transaction
CashFlow
CorporateAction
PositionSnapshot
PortfolioSnapshot
PriceObservation
FxObservation
OptionObservation
Benchmark
FundHoldingsSnapshot
FundHolding
Exposure
```

### 7.2 策略、计算与收口

```text
StrategyVersion
ParameterSet
CalculationRun
VolatilityForecast
CovarianceEstimate
VolatilityAnchor
AllocationSnapshot
RiskMetric
StressScenario
PolicyEvaluation
```

`VolatilityAnchor` 在每次调仓时归档当时的 `σᵢ⁰` 与 `σₚ⁰`，供后续计算漂移倍数 `σᵢ/σᵢ⁰`、`σₚ/σₚ⁰`——用于区分"这只票变了"与"整个市场变了"。锚点只在调仓时重置，不随日常计算更新。

`CalculationRun` 是计算审计的核心，至少记录：

- as-of 时间和输入数据快照；
- 代码、模型、策略与参数版本；
- 预测窗口、币种口径和标的集合；
- 输出引用、数据质量、降级状态与失败原因；
- 重算后是否一致。

### 7.3 研究、事件与决定

```text
Theme
ThemeVersion
Candidate
FactorAssessment
WeightTier
Evidence
Claim
Catalyst
InvalidationCondition
ExitRestriction
Event
EventHorizonEntry
Playbook
PlaybookBranch
ExceptionRecord
RebalanceIntent
RefillPlan
RefillBatch
Decision
ExecutionRecord
Review
AgentRun
```

`WeightTier` 取代原 `ViewAllocation`：权重不再由 `θ·观点 + (1−θ)·ERC` 合成，而是人工归入档位（40 / 35 / 30 / 25 / 20 / 15 / 10），并强制记录三行理由——盈利预期（含可证伪的锚）、主要风险（须与 `InvalidationCondition` 一致）、为什么是这一层。

`RefillPlan` / `RefillBatch` 描述风控减仓后的回补状态机：三批各 1/3、逐批触发条件、卡口连续通过 10 个交易日的强制时限。风控减仓是风险层行为，**不改变 `WeightTier`**；回补目标是当前目标权重，不是减仓前的权重。

关键关系：

- `Instrument → Issuer`：多种证券可以属于同一发行人；
- `PositionSnapshot → Instrument`：保存 point-in-time 持仓；
- `FundHoldingsSnapshot → FundHolding → Instrument/Issuer`：按 `as_of` 保存 ETF 成分事实并支持历史重放；
- `StrategyVersion → ParameterSet → CalculationRun`：每次计算明确使用的规则与参数；
- `Evidence → Claim → FactorAssessment/ThemeVersion`：证据通过可验证命题支撑研究判断；
- `FactorAssessment → WeightTier`：权重档位引用因子结论与"为什么是这一层"的理由；
- `WeightTier → VolatilityAnchor`：目标权重与当时的 σ 锚点一同归档；
- `Event → EventHorizonEntry → Playbook`：事件与时间距离、预案状态分离；
- `RebalanceIntent → PolicyEvaluation → Decision`：Agent 意向、机械校验和人工决定分离；
- `Decision → ExecutionRecord`：决定与券商端实际执行差异可追踪；
- `Decision → RefillPlan → RefillBatch`：风控减仓派生回补计划，批次执行与未执行理由均留痕。

## 8. 数据约定

每条时间相关记录至少区分：

- `observed_at`：系统何时获得该数据；
- `effective_at`：数据在现实中何时生效；
- `recorded_at`：记录何时写入 Epoch；
- `as_of`：某次计算或判断所使用的信息截止点。

每条外部记录保存：

- 来源和原始标识；
- 原始载荷或其不可变引用；
- 内容哈希；
- 导入任务和连接器版本；
- 数据质量、时效状态与是否经过人工确认。

所有金额必须携带币种。所有收益与风险计算必须明确基础币种、汇率时点、现金流处理、费用和股息口径。风险计算默认使用策略要求的 USD 统一口径。

## 9. 风险计算管线

### 9.0 服务调用与责任边界

```text
Scheduler 读取事实数据
        ↓
固化输入快照、as-of、策略/参数版本和 input_hash
        ↓
按版本化 JSON Schema 调用 Python Analytics Service
        ↓
校验数值、单位、model_version、质量和降级状态
        ↓
由 TypeScript 写入 CalculationRun 并执行 Policy Gate
```

Analytics Service 提供健康检查和版本化计算端点。日常秒级计算可同步返回；长时间回测应使用异步任务语义，不让单个 HTTP 请求无限等待。在出现实际并发需求前不引入 Redis、Celery 或通用消息队列。

### 9.1 输入与降级

每个模型接口都必须定义：

- 必需和可选输入；
- 最小历史窗口；
- 数据新鲜度与质量要求；
- 缺失 IV、期权不活跃、交易日错位或汇率缺失时的降级策略；
- 不适用品种的拒绝或替代模型；
- 输出质量状态与用户可见的解释。

降级结果不能冒充完整 SHAR-IV-J 结果。每次输出必须标明当期估计器口径——SHAR-IV-J、无 IV 项设定、60 日 Garman-Klass 降级，以及半方差用的是日内口径还是日频近似。Policy Gate 可根据模型可用性决定只允许降风险动作或要求人工复核。

> **估计器可升级，卡口值不变。** σₚ ≤ 45% 不因估计器降级而放宽或收紧。

### 9.2 目标权重与校验

```text
人工设定 WeightTier（档位 + 三行理由）
             ↓
      计算 σₚ / stress σₚ / RC / CVaR / 压力情景
             ↓
      Policy Gate 校验：σₚ ≤ 45% · 候选池来源 · 构建规则区间
             ↓
      合规目标或明确否决原因
             ↓
      归档 VolatilityAnchor（σᵢ⁰ / σₚ⁰）
```

Epoch 不合成目标权重——`AllocationSnapshot` 记录的是人工给定的档位结果与当时的风险度量，不是求解产物。

Agent 提交的 `RebalanceIntent` 不得携带自行计算的“已合规”结论。Policy Gate 必须使用当时数据和目标持仓独立重算。

## 10. Agent 与 Skills 架构

《投资策略》是唯一规则来源，Agent Skill 只是一个通用 Agent 的适配与工具层：

```text
frameworks/
  strategies/
  policies/
  schemas/
skills/
  epoch-investment-agent/
```

通用 Agent 通过 `task_type` 区分任务：

- `research_candidate`；
- `review_position`；
- `review_portfolio`；
- `prepare_event`；
- `assess_event`；
- `propose_rebalance`；
- `run_review`。

Agent Gateway 提供的核心能力分为：

- **查询**：组合快照、持仓、绩效、穿透、风险快照、事件视界、策略与历史研究；
- **有限写入**：研究草稿、因子评估、权重档位建议、预案、调仓意向和复盘；
- **计算请求**：请求 Epoch 执行组合计算或硬约束校验，Agent 不自行写入计算结果。

每次 `AgentRun` 保存：

- 任务类型、模型与提示版本；
- 策略、参数与输出 Schema 版本；
- 输入对象、数据快照与计算运行引用；
- 引用来源与结构化输出；
- 已知限制、人工修改和反馈。

## 11. 数据质量与对账

### 11.1 幂等导入

相同 Flex 报表可以重复导入，不产生重复交易或现金流。

### 11.2 账本守恒

每日验证：

```text
期初资产
+ 外部净现金流
+ 投资损益
+ 汇率变化
- 费用
= 期末资产
```

无法解释的差异进入 Data Health，不允许静默修正。

### 11.3 可重算

原始数据不可变，归一化和派生数据可以根据代码、模型、策略与参数版本重建。Agent 生成内容不能成为账本、市场事实或客观风险结果的唯一来源。

## 12. 安全边界

- IBKR token 和第三方密钥只进入系统密钥存储或本机环境；
- 日志对账户号、token、订单标识和个人信息脱敏；
- Web 服务默认只监听本机；
- 外部 Agent 调用前进行字段级上下文裁剪；
- 原始数据、数据库和投资日志支持加密备份；
- Agent 不能写账本、客观计算、策略、参数或最终决定；
- Agent 只能调用 Policy Gate，不能伪造或覆盖校验结果；
- 系统不接入下单端点；
- 未来若加入订单草稿，必须经独立安全评审、使用 Paper Account 并要求人工确认。

## 13. 测试策略

### 13.1 账本与组合

- 固定样例的收益与现金流测试；
- 多币种、汇率时点和公司行动测试；
- 与 IBKR statement 的黄金样本对账；
- 边界日期、缺失行情和重复导入测试。

### 13.2 金融计算

- HAR / SHAR、协方差、σₚ、stress σₚ、RC、CVaR 和压力测试的固定向量与黄金结果；
- 半方差 RS± 与符号跳跃 ΔJ 在日内口径与日频近似下的对照测试；
- 波动率漂移倍数与 1.5× / 2.0× 分级边界的参数化测试；
- 汇率、交易日错位与跳跃情景测试；
- 数据缺失、模型不适用和降级状态测试；
- 计算运行重现与版本变更测试。

### 13.3 Policy Gate

- 《投资策略》中每条机械规则都有确定性测试；
- 同一调仓意向在固定快照和版本下必须得到相同结果；
- σₚ 卡口边界、候选池来源、构建规则区间、参数冻结期、90 天禁回购（含风控减仓豁免）和仅降风险状态覆盖边界用例；
- 回补批次的触发条件、强制时限与"回补不得越限"边界；
- 失败时输出精确的规则、输入和否决原因。

### 13.4 Agent

- Agent 输入与输出必须通过 JSON Schema；
- 使用固定证据集做六因子评估、预案与组合判断回归评估；
- 检测缺失引用、事实与推断混淆、策略版本错配和越权写入；
- 确保 Agent 无法直接修改 `PolicyEvaluation`、`Decision` 或账本。

## 14. 建议仓库结构

```text
apps/
  web/
packages/
  domain/
  policy/
  connectors/
  agent_gateway/
services/
  analytics/
    pyproject.toml
    src/
      epoch_analytics/
      epoch_analytics_service/
    tests/
    Dockerfile
contracts/
  analytics/
frameworks/
  strategies/
  policies/
  schemas/
skills/
  epoch-investment-agent/
tests/
  fixtures/
  reconciliation/
  policy/
  agent/
data/
  raw/
docs/
```

单一 Git 仓库同时保存 TypeScript 与 Python 代码；`pnpm-lock.yaml` 和 Python 依赖锁文件分别固化两个运行时，根级命令统一安装、测试、构建和启动。真实投资数据不进入 Git。仓库只保存脱敏、合成或公开测试数据。

Docker Compose 的目标稳态拓扑为四个常驻服务：PostgreSQL、Web/API、Scheduler 和 Python Analytics；数据库迁移是启动时的一次性任务。所有组件仍由一条本地命令启动。

## 15. 官方接口参考

当前使用：

- [IBKR Flex Web Service](https://ibkrcampus.com/campus/ibkr-api-page/flex-web-service/)——日终账本唯一券商接口

参考（当前不接入，见 6.1）：

- [IBKR Web API Documentation](https://ibkrcampus.com/campus/ibkr-api-page/webapi-doc/)
- [IBKR Web API Changelog](https://ibkrcampus.com/campus/ibkr-api-page/web-api-changelog/)
- [IBKR Market Data Subscriptions](https://ibkrcampus.com/campus/ibkr-api-page/market-data-subscriptions/)
