# Epoch 技术架构

状态：Draft v0.2
日期：2026-07-21

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

### 2.1 模块化单体

第一版采用模块化单体，不采用微服务。模块通过显式的领域接口协作，不以分布式部署换取形式上的边界。

### 2.2 四类数据分离

| 类型 | 内容 | 生成者 | 是否可覆盖上一层 |
|---|---|---|---|
| 事实 | 账本、行情、期权链、事件时间、原始证据 | Connectors / 所有者 | 否 |
| 计算 | NAV、收益归因、HAR、ERC、RC、CVaR、压力测试 | 确定性代码 | 否 |
| 判断 | 六因子评估、观点权重、主线判断、预案、调仓意向 | Agent / 所有者 | 否 |
| 决定 | 确认、修改、拒绝与实际执行 | 所有者 | 仅以新版本追加 |

Agent 不能将推论写成事实，也不能将调仓意向写成最终决定。

### 2.3 计算—判断—收口

```text
不可变原始数据
        ↓
归一化事实与组合快照
        ↓
确定性计算层：绩效 / HAR / ERC / RC / CVaR / 压力情景
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
        ┌─────────────┼─────────────┐
        │                         │
  Analytics Engine          Operations / Journal
        │                         │
   Policy Gate ──────────── Web UI
        │                         │
        └────── Agent Gateway ─────┘
                         │
               Codex / Claude 通用 Agent
```

Web UI 和 Agent Gateway 共享同一领域服务。Agent 不直接访问数据库，也不自行实现风险公式或硬约束。

## 4. 技术选型

| 层级 | 选择 | 说明 |
|---|---|---|
| Web UI | Next.js + TypeScript | Operations、Portfolio、Allocation & Risk、Journal |
| API | Next.js Route Handlers + TypeScript | 领域接口、Agent Gateway 与数据服务；与 Web 共享类型 |
| 计算 | TypeScript 确定性模块 | 首个切片的账本与组合计算；复杂数值模型可在 Phase 3 独立评估运行时 |
| 数据库 | PostgreSQL | 事实、版本、计算结果和审计关系 |
| 原始数据 | 本地对象目录 | 保存不可变外部响应与内容哈希 |
| 图表 | Recharts | 金融时间序列、归因与风险解释 |
| 调度 | 轻量任务调度 | 日终同步、每日计算和事件扫描 |
| Agent 接口 | 本地 CLI/API + JSON Schema | 为单一通用 Agent 提供受限工具 |
| 部署 | Docker Compose | 本机一条命令启动 |

具体 HAR 实现库与期权工具在模型细化后确定。架构通过稳定的预测接口、版本化参数和计算运行记录隔离具体库，不在产品层绑定某个实现。

## 5. 模块边界

### 5.1 connectors

负责外部系统接入、认证、限速、重试、时效标记和原始响应留存。账本、行情、汇率、期权链、基本面与事件数据分别实现连接器，不让上游差异泄漏进领域层。

### 5.2 ledger

负责交易、现金流、股息、费用、公司行动、成本和对账。它是组合计算的可信来源；成本价只向账本、税务与行为复盘提供，不进入权重决策。

### 5.3 portfolio

负责持仓快照、NAV、TWR、MWR、回撤、基准对比和收益归因。所有结果均显式绑定 as-of 时间、基础币种和数据快照。

### 5.4 exposure

负责证券到发行人、ETF 底层持仓、行业、地域、币种、主题与因子的映射。穿透敞口用于解释风险来源，不自行生成仓位上限。

### 5.5 analytics

负责纯计算能力：

- 历史和前瞻波动率；
- HAR-RV / HAR-IV-J 及后续模型变体；
- 协方差与相关性估计；
- ERC、RC、组合波动率与目标权重合成；
- CVaR、历史情景和压力测试；
- 指数隐波、隐含相关性、put skew、GEX 与其他市场结构指标。

`analytics` 输出带单位的数值、质量状态和计算说明，不输出“应该买入/卖出”的语义判断。

### 5.6 policy

负责策略版本、参数集、预警、交易触发和硬约束。主要职责是：

- 根据当时持仓数量计算 RC 预警与偏离触发线；
- 校验组合波动率、压力情景、财报日与回撤约束；
- 校验替代标的是否来自已评估候选池；
- 检查禁买期、参数冻结期与仅允许降风险的状态；
- 对调仓意向的目标组合重新计算并输出逐条校验结果。

`policy` 不判断公司质量、主线是否证伪或波动是否系统性。

### 5.7 operations

负责每日运行状态、事件视界、预案状态、待办、预警、触发和待审核对象。它协调计算、Agent 任务和人工确认，但不复制各模块的业务规则。

### 5.8 journal

负责结构化研究、因子评估、观点权重、事实/假设/推论、催化剂、证伪条件、预案、调仓意向、最终决定、实际执行和复盘。主观对象均使用追加版本，保留当时语境。

### 5.9 agent_gateway

向 Codex 和 Claude 暴露受限、结构化、可审计的查询与写入能力。第一版只服务一个通用投资 Agent，不为不同任务建立独立后端或重复能力。

## 6. 数据时效与来源分层

| 数据层 | 用途 | 首选来源 | 频率 |
|---|---|---|---|
| 账本 | 交易、现金、股息、费用、公司行动 | IBKR Flex Web Service | 每日 |
| 账户状态 | 盘中持仓、余额和 PnL | IBKR Web API/WebSocket | 按需/盘中 |
| 价格与汇率 | OHLC、指数、基准、USD 统一收益 | IBKR 或独立数据源 | 日频/按需 |
| 期权 | IV、skew、GEX 与期限结构 | IBKR 期权链或独立数据源 | 每日/事件前后 |
| 基本面 | 财报、指引与公司事实 | 官方文件优先 | 事件驱动 |
| 事件 | 财报日、宏观、政策与行业日程 | 官方日历/多来源 | 每日扫描 |
| 主观数据 | 评估、预案、意向、决定与复盘 | Agent / 所有者 | 任务/事件驱动 |

IBKR Flex Activity Statement 作为日终可对账账本，不用于实时轮询。盘中账户状态使用 IBKR Web API；连接器必须显式管理会话、订阅、速率和 WebSocket 生命周期。

每个数据集记录最后成功时间、应有截止时间、质量状态和降级原因。数据不新鲜时不得静默沿用“正常”状态。

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
Exposure
```

### 7.2 策略、计算与收口

```text
StrategyVersion
ParameterSet
CalculationRun
VolatilityForecast
CovarianceEstimate
AllocationSnapshot
RiskMetric
StressScenario
PolicyEvaluation
```

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
ViewAllocation
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
Decision
ExecutionRecord
Review
AgentRun
```

关键关系：

- `Instrument → Issuer`：多种证券可以属于同一发行人；
- `PositionSnapshot → Instrument`：保存 point-in-time 持仓；
- `StrategyVersion → ParameterSet → CalculationRun`：每次计算明确使用的规则与参数；
- `Evidence → Claim → FactorAssessment/ThemeVersion`：证据通过可验证命题支撑研究判断；
- `FactorAssessment → ViewAllocation`：观点权重引用评估与权重差异理由；
- `Event → EventHorizonEntry → Playbook`：事件与时间距离、预案状态分离；
- `RebalanceIntent → PolicyEvaluation → Decision`：Agent 意向、机械校验和人工决定分离；
- `Decision → ExecutionRecord`：决定与券商端实际执行差异可追踪。

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

### 9.1 输入与降级

每个模型接口都必须定义：

- 必需和可选输入；
- 最小历史窗口；
- 数据新鲜度与质量要求；
- 缺失 IV、期权不活跃、交易日错位或汇率缺失时的降级策略；
- 不适用品种的拒绝或替代模型；
- 输出质量状态与用户可见的解释。

降级结果不能冒充完整 HAR-IV-J 结果。Policy Gate 可根据模型可用性决定只允许降风险动作或要求人工复核。

### 9.2 目标权重与校验

```text
已确认 ViewAllocation + ERC
             ↓
      按 θ 合成目标权重
             ↓
      计算 RC / σₚ / CVaR / 压力情景
             ↓
      Policy Gate 逐条校验
             ↓
      合规目标或明确否决原因
```

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
- **有限写入**：研究草稿、因子评估、观点权重、预案、调仓意向和复盘；
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

- HAR、协方差、ERC、RC、CVaR 和压力测试的固定向量与黄金结果；
- 不同持仓数量下 RC 阈值的参数化测试；
- 期权、汇率、交易日错位与跳跃情景测试；
- 数据缺失、模型不适用和降级状态测试；
- 计算运行重现与版本变更测试。

### 13.3 Policy Gate

- 《投资策略》中每条机械规则都有确定性测试；
- 同一调仓意向在固定快照和版本下必须得到相同结果；
- 财报日、回撤、参数冻结、禁买期和仅降风险状态覆盖边界用例；
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
  api/
packages/
  domain/
  analytics/
  policy/
  connectors/
  agent_gateway/
frameworks/
  strategies/
  policies/
  schemas/
skills/
  epoch-investment-agent/
tests/
  fixtures/
  reconciliation/
  analytics/
  policy/
  agent/
data/
  raw/
docs/
```

真实投资数据不进入 Git。仓库只保存脱敏、合成或公开测试数据。

## 15. 官方接口参考

- [IBKR Web API Documentation](https://ibkrcampus.com/campus/ibkr-api-page/webapi-doc/)
- [IBKR Web API Changelog](https://ibkrcampus.com/campus/ibkr-api-page/web-api-changelog/)
- [IBKR Flex Web Service](https://ibkrcampus.com/campus/ibkr-api-page/flex-web-service/)
- [IBKR Market Data Subscriptions](https://ibkrcampus.com/campus/ibkr-api-page/market-data-subscriptions/)
