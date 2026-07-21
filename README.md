# Epoch

![Epoch 个人卫星仓投资控制台](assets/banner.png)

「Epoch」是我给自己搭建的个人投资控制台，管理我本人的 IBKR 卫星仓。该系统提供以下功能：

- **投资记录**：长期记录组合表现，投资逻辑，与基准进行对比；
- **仓位解读**：穿透性分析持仓是否合理有效；
- **信息跟踪**：将新闻和一手证据转化为可解释的风险信号；
- **风险管理**：基于风险信号对组合风险敞口进行管控；
- **辅助投研**：对外暴露 Skills & APIs，便于借助代理式 AI 进行投研分析；

## 项目文档

- [产品设计](docs/DESIGN.md)：产品定位、范围、用户体验和验收场景
- [技术架构](docs/ARCHITECTURE.md)：系统结构、数据模型、技术选型和安全边界
- [投资框架](docs/STRATEGY.md)：投资原则、证据政策、风险和仓位规则
- [实施路线](docs/ROADMAP.md)：开发阶段、依赖关系和阶段验收标准
- [视觉规范](docs/THEME.md)：网页配色方案与主题规范
- [视觉资产](assets/)：项目使用的图片、图标与主题资源

## 本地运行

Epoch 使用 TypeScript 控制面和独立 Python Analytics Service。完整环境通过一条命令启动：

```bash
docker compose up --build
```

打开 `http://localhost:3000`。启动链路会等待 PostgreSQL 和 Analytics 就绪、幂等执行迁移，然后启动 Web/API 与轻量调度器。Analytics 只在 Compose 内部网络暴露。若存在 `tmp/satellite-data`，系统读取已清洗的本地卫星仓数据；该目录被 Git 忽略。若不存在，系统自动使用可重现的合成 Demo。

不使用 Docker 时需要 pnpm 与 [uv](https://docs.astral.sh/uv/)，先安装两个运行时的依赖：

```bash
pnpm install
uv sync --locked --project services/analytics
```

然后分别运行：

```bash
pnpm db:migrate
pnpm dev
pnpm scheduler
pnpm analytics:dev
```

主要端点：

- `GET /api/health`：数据库、Analytics、迁移、数据来源与交易权限状态；
- `GET /api/v1/portfolio`：当前组合；
- `GET /api/v1/calculations/demo`：从固定交易、现金流和价格重建的每日账本。

Phase 0 的范围与验收证据见 [docs/reviews/PHASE_0.md](docs/reviews/PHASE_0.md)，数据约定见 [docs/CONVENTIONS.md](docs/CONVENTIONS.md)。

Python Analytics 当前已完成服务骨架、共享契约、健康检查和端到端契约检查；HAR、ERC、CVaR 等生产量化模型仍按 Phase 3 路线实现。
