# Phase 0 验收记录

状态：Completed
日期：2026-07-21

## 交付物

| 路线图要求 | 实现 |
|---|---|
| 仓库、开发环境与 CI | pnpm workspace、Docker Compose、GitHub Actions |
| Web、API、PostgreSQL 骨架 | Next.js Web 与 Route Handlers、PostgreSQL 17 |
| 数据库迁移 | 带内容哈希、advisory lock 和版本表的幂等迁移执行器 |
| 轻量任务调度 | PostgreSQL 持久化任务、advisory lock、单次与常驻运行模式 |
| 数据约定 | [CONVENTIONS.md](../CONVENTIONS.md) 与对应 TypeScript 类型/测试 |
| 合成 Demo | 交易、现金流、价格，以及确定性每日账本计算 |
| 策略与参数版本 | JSON Schema、内容哈希、数据库种子和只读应用边界 |
| 个人配置 | `futu_2189` + `ibkr_8602`、`.NDX`、USD 统一口径 |

## 完成标准

- `docker compose up --build` 依次启动 PostgreSQL、执行迁移、启动 Web/API 和调度器；没有私有数据时自动使用合成 Demo。
- 固定合成输入生成相同 SHA-256 输入哈希、10 个每日快照、最终 NAV `$106,896.00`，账本守恒差异为 `$0.00`。
- 策略和参数只由版本化文件与迁移种子提供；Web/API 没有修改端点。
- `.env`、`tmp/`、`data/raw/`、凭证和真实账户数据均被 Git 忽略。
- 券商能力固定为 `read_only`，系统没有下单端点。

## 验证命令

```bash
pnpm lint
pnpm test
pnpm build
docker compose up --build
curl http://localhost:3000/api/health
curl http://localhost:3000/api/v1/calculations/demo
```

CI 使用真实 PostgreSQL 服务重复执行迁移，并运行调度任务集成测试，以验证迁移幂等与计算结果留存。
