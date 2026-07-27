# Phase 5 实施记录

状态：Accepted
开始日期：2026-07-27
验收日期：2026-07-27

## 目标

Phase 5 建立一个受限、可审计的通用 Investment Agent。Agent 使用 Epoch 提供的数据快照与领域写入能力，但不能直接访问数据库、复制风险公式、修改客观计算、记录最终决定或创建订单。

## 第一切片：统一 Agent Gateway 与审计边界

- 固定七类 `task_type`：候选研究、单标的复核、组合复核、事件预案、事件评估、调仓建议和周期复盘；
- 新增版本化输出 JSON Schema、任务级运行时校验和本地 CLI；
- `AgentRun` 保存模型、提示版本、策略、参数、输入、脱敏数据快照、Schema 版本、引用、限制、输出和 CalculationRun 引用；
- 数据快照只暴露组合汇总、持仓、风险、候选状态和事件视界，并显式返回查询、草稿写入与禁止权限；
- Agent 输出不能包含 `policyGatePassed` 或 `compliant`，调仓建议必须交由 Epoch 独立计算；
- 新增人工反馈，区分接受、修改和拒绝，并可保存纠正后的输出；
- 研究、预案和复盘只能物化为幂等草稿或建议，不能直接确认；
- 风险调仓 API 与 Agent Gateway 共享同一服务实现，避免出现第二套 Policy Gate；
- 新增仓库内 `epoch-investment-agent` Skill，并通过标准 Skill 校验；
- 新增覆盖七类任务的固定回归输出集。

## 最终验收

- 领域测试覆盖七类任务、候选事实证据要求和禁止模型自行宣称 Policy Gate；
- 27 个数据库迁移已在真实 PostgreSQL 执行并通过幂等校验；
- 36 个测试文件、134 项测试全部通过，其中 19 项为真实 PostgreSQL 集成测试；
- PostgreSQL 集成测试覆盖 AgentRun 启动、脱敏权限快照、完成、反馈、幂等复盘草稿、真实 Evidence 引用与候选研究草稿物化；
- 固定回归集覆盖全部七类任务的合法输出，候选研究必须包含事实/假设/推论边界、六因子结构和完整档位理由；
- 端到端验收完成 `propose_rebalance → Epoch Analytics → CalculationRun → Policy Gate`，Agent 未提供合规结论；验收计算返回 `degraded` 模型状态、σₚ 37.69%、45% 卡口通过；
- TypeScript `--noEmit`、`git diff --check`、Next.js 生产构建和标准 Skill 校验通过；
- `/api/health`、Agent Gateway、Agent Schema 与原有 Portfolio 端点均从本机网络侧返回 HTTP 200；
- 外部 Agent 不可用时，原有 Portfolio、Risk、Operations 和 Journal 路径不依赖 Gateway。

Phase 5 完成标准已满足：同一 Gateway 接受全部七类任务；研究输出具有来源与置信度；六因子和档位建议保持人工确认边界；Policy Gate 只由 Epoch 执行；Agent 无账本、策略、参数、客观计算、最终决定、执行记录或订单写权限。
