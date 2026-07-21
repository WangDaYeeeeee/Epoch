# Epoch 技术架构

状态：Draft v0.1  
日期：2026-07-20

## 1. 架构目标

技术架构服务于以下目标：

- 组合数据可信、可对账、可重算；
- 外部数据来源可替换；
- 事实数据与模型推断严格分离；
- 投资规则不散落在界面或提示词中；
- 本地部署简单，长期维护成本低；
- Codex、Claude 和 Web UI 共享同一领域能力；
- 在第一阶段彻底隔离真实交易权限。

## 2. 总体架构

```text
IBKR / 公司文件 / 新闻 / 市场数据
                    │
                Connectors
                    │
             原始不可变数据层
                    │
          归一化 / 对账 / 数据增强
                    │
       PostgreSQL 领域模型与分析结果
          ┌─────────┼─────────┐
       Web UI     Risk Engine   Research API/CLI
                                  │
                         Codex / Claude Skills
```

第一版采用模块化单体，不采用微服务。

## 3. 技术选型

| 层级 | 选择 | 说明 |
|---|---|---|
| Web UI | Next.js + TypeScript | 页面、交互和类型安全 |
| API | Python + FastAPI | 数据分析、金融计算和模型生态 |
| 计算 | Polars/Pandas + NumPy | 组合与时间序列计算 |
| 数据库 | PostgreSQL | 领域数据、版本和审计关系 |
| 原始数据 | 本地对象目录 | 保存不可变外部响应 |
| 图表 | ECharts | 金融时间序列与交互图表 |
| 调度 | 轻量任务调度 | 初期不引入重型工作流平台 |
| Agent 接口 | 本地 CLI/API | 为不同 Agent 提供稳定边界 |
| 部署 | Docker Compose | 本机一条命令启动 |

业务规则和金融计算放在 Python 领域层，不能散落于前端组件、数据库触发器或 Agent Prompt。

## 4. 模块边界

### 4.1 connectors

负责外部系统接入、认证、限速、重试和原始响应留存。

### 4.2 ledger

负责交易、现金流、股息、费用、公司行动、成本和对账。它是组合计算的可信来源。

### 4.3 portfolio

负责持仓快照、NAV、TWR、MWR、回撤、波动率、基准和收益归因。

### 4.4 exposure

负责证券到发行人、行业、地域、币种、因子、主题和底层资产的映射。

### 4.5 risk

负责风险指标、政策限制、事件评价、规则状态和行动建议。

### 4.6 research

负责投资假设、证据、事实主张、估值情景和结构化研究。

### 4.7 journal

负责决定、当时快照、理由、复核日期和结果评价。

### 4.8 agent

向 Codex 和 Claude 暴露受限、结构化、可审计的查询和写建议能力。

## 5. 数据时效分层

| 数据层 | 用途 | 首选来源 | 频率 |
|---|---|---|---|
| 账本 | 交易、现金、股息、费用、公司行动 | IBKR Flex Web Service | 每日 |
| 账户状态 | 盘中持仓、余额和 PnL | IBKR Web API/WebSocket | 按需/盘中 |
| 市场数据 | 最新价与历史价格 | IBKR 或独立数据源 | 按需/日频 |
| 基本面 | 财报与公司事实 | 官方文件优先 | 事件驱动 |
| 事件 | 公告、监管文件和可信新闻 | 多来源 | 持续 |
| 主观数据 | 假设、标签、限制和决定 | Epoch | 人工维护 |

IBKR Flex Activity Statement 适合作为日终可对账账本，不适合实时轮询。盘中账户状态使用 IBKR Web API；连接器必须显式管理会话、订阅、速率和 WebSocket 生命周期。

## 6. 核心领域模型

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
Benchmark
Exposure
Thesis
ThesisVersion
Evidence
Claim
RiskEvent
RiskAssessment
PolicyLimit
Recommendation
Decision
Review
AgentRun
```

关键关系：

- `Instrument → Issuer`：多种证券可以属于同一发行人；
- `PositionSnapshot → Instrument`：保存 point-in-time 持仓；
- `Evidence → Claim → ThesisVersion`：证据通过事实主张影响投资假设；
- `RiskEvent → RiskAssessment → Recommendation`：事件、评价和建议分离；
- `Recommendation → Decision`：系统建议和最终决定分离；
- `Decision → PortfolioSnapshot`：决定绑定当时的组合状态。

## 7. 数据约定

每条时间相关记录至少区分：

- `observed_at`：系统何时获得数据；
- `effective_at`：数据在现实中何时生效；
- `recorded_at`：何时写入 Epoch。

每条外部记录保存：

- 来源和原始标识；
- 原始载荷或其不可变引用；
- 内容哈希；
- 导入任务和连接器版本；
- 是否经过人工确认。

所有金额必须携带币种。所有收益计算必须明确基础币种、现金流处理、费用和股息口径。

## 8. 数据质量与对账

### 8.1 幂等导入

相同 Flex 报表可以重复导入，不产生重复交易或现金流。

### 8.2 账本守恒

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

### 8.3 可重算

原始数据不可变，归一化和派生数据可以根据代码版本重建。模型生成内容不能成为基础账本的唯一来源。

## 9. Agent 与 Skills 架构

投资框架是唯一规则来源，Agent Skill 是适配层：

```text
frameworks/
  core/
  strategies/
  schemas/
skills/
  epoch-company-research/
  epoch-event-impact/
  epoch-position-review/
  epoch-portfolio-review/
```

Agent 通过受限工具获取：

- 脱敏组合摘要；
- 指定持仓及其投资假设；
- 已授权的证据；
- 适用策略和风险政策版本。

每次 Agent 运行保存：

- 模型与提示版本；
- 框架版本；
- 输入对象引用；
- 引用来源；
- 结构化输出；
- 已知限制和人工反馈。

## 10. 安全边界

- IBKR token 和第三方密钥只进入系统密钥存储或本机环境；
- 日志对账户号、token、订单标识和个人信息脱敏；
- Web 服务默认只监听本机；
- 外部模型调用前进行字段级上下文裁剪；
- 原始数据、数据库和研究日志支持加密备份；
- Agent 只能写研究结果和建议，不能写账本或交易；
- 第一阶段不接入下单端点；
- 未来若加入订单草稿，必须使用独立权限、Paper Account 和人工确认。

## 11. 测试策略

### 11.1 金融计算

- 固定样例的收益与现金流测试；
- 多币种和公司行动测试；
- 与 IBKR statement 的黄金样本对账；
- 边界日期、缺失行情和重复导入测试。

### 11.2 数据连接器

- 使用脱敏录制响应进行契约测试；
- 验证限速、超时、重试和断线恢复；
- 生产凭证不进入测试环境。

### 11.3 风险与 Agent

- 每条规则有确定性测试；
- 模型输出必须通过 JSON Schema；
- 使用固定证据集做回归评估；
- 检测缺失引用、事实与推断混淆及越权建议。

## 12. 建议仓库结构

```text
apps/
  web/
  api/
packages/
  domain/
  analytics/
  connectors/
frameworks/
skills/
tests/
  fixtures/
  reconciliation/
data/
  raw/
docs/
```

真实投资数据不进入 Git。仓库只保存脱敏、合成或公开测试数据。

## 13. 官方接口参考

- [IBKR Web API Documentation](https://ibkrcampus.com/campus/ibkr-api-page/webapi-doc/)
- [IBKR Web API Changelog](https://ibkrcampus.com/campus/ibkr-api-page/web-api-changelog/)
- [IBKR Flex Web Service](https://ibkrcampus.com/campus/ibkr-api-page/flex-web-service/)
- [IBKR Market Data Subscriptions](https://ibkrcampus.com/campus/ibkr-api-page/market-data-subscriptions/)

