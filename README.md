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

然后用一个命令启动本地 PostgreSQL、执行迁移，并同时运行 Web、Scheduler 与 Analytics：

```bash
pnpm dev:local
```

**券商接入边界**：Epoch 不做盘中高频信息探测，日常运行**不需要 IBKR Client Portal Gateway 或 TWS**——两者均需常驻会话与每日交互式二次认证，与无人值守部署冲突。账本走 Flex Web Service（无状态 HTTPS、日频拉取），行情走独立日频 OHLC 源。默认状态下页面显示“IBKR 未配置”，账本、绩效与确定性计算全部正常。

若你本机已自行启动 Client Portal Gateway，可将 API 根地址传入以查看只读连接状态；这是可选能力，不是任何功能的前提：

```bash
IBKR_WEB_API_URL=https://127.0.0.1:5000/v1/api pnpm dev:local
```

Epoch 只请求连接/认证状态，不实现订单创建、修改或提交端点。

按 `Ctrl-C` 会统一停止三个应用进程。默认通过 Docker 启动 PostgreSQL；如果需要使用已有数据库，可先设置 `DATABASE_URL`。完整容器环境仍使用 `docker compose up --build`。

首次运行时，脚本会通过 Homebrew 自动安装缺失的 `uv` 或 Docker Desktop，并自动安装/同步 Node 与 Python 项目依赖；后续启动只执行快速依赖同步。若使用已有 PostgreSQL，设置 `DATABASE_URL` 后不会安装或启动 Docker。

导入 IBKR Flex CSV 报表：

```bash
pnpm import:flex -- --file /path/to/activity-statement.csv
```

这条命令只用于未来追加新的 IBKR 数据，不用于重做现有历史基线。原始报表按 SHA-256 不可变保存到 `data/raw/ibkr-flex/`（不纳入 Git），交易和现金流水按 IBKR 外部标识幂等写入账本。默认账户为 `ibkr_8602`，可通过 `--account` 修改。

已有的 `tmp/satellite-data/normalized/*.csv` 会在 `pnpm dev:local` 和 Docker Compose 启动时自动校验并幂等登记到 PostgreSQL，无需手工重新导入。也可以单独执行只读检查：

```bash
pnpm baseline:check
```

组合页面与 `/api/v1/portfolio` 优先读取 PostgreSQL 中最新登记的基线版本；数据库暂不可用时会明确标记降级并回退到本地清洗数据，私有文件不存在时才使用合成 Demo。

组合页面的数据健康区域包含仓位数量对账明细，展示相邻报告区间内由交易推算的数量、券商报告数量、差异及待回查状态。

赠股、IPO 获配等不经过普通成交记录的仓位变化以 `adjustment_in` / `adjustment_out` 显式记录，并绑定原始月结单页码，不伪装成买卖或外部资金流。

绩效区域同时给出由净值链计算的 TWR，以及基于期初资产、逐日外部资金流和期末资产计算的年化与累计 MWR（XIRR）。

每个非零外部现金流日记录显式 Modified Dietz 权重，基线校验会复算逐日资产收益并按源数据精度检查误差，不使用隐藏的日期特判。

账本事件按类型检查重放所需字段：成交必须有证券、数量、价格和现金金额，非现金调整必须有证券与数量，换汇和其他现金事件必须有对应现金腿。券商报表中的重复摘要行会在暂存清洗阶段排除。

报告持仓的本币市值、显式汇率与券商基础币种市值会逐行复算；Futu 使用 CNY、IBKR 使用 USD。缺少基础币种汇率的快照保持待补状态，不使用组合总值倒推出的隐含汇率冒充市场输入。

日频行情需求会先统一券商代码：Futu 的 `US:*` 与 IBKR 的 `XNAS:*`、`XNYS:*`、`ARCX:*`、`BATS:*` 同名美股会映射为同一 `US:*` 市场标识，避免重复行情和跨账户迁移时的虚假仓位变化。

`HK0000502390`、`HK0000584752`、`HK0000938420` 按现金等价物处理：基金申赎属于现金管理内部转换，不构成证券级日频行情的硬依赖；基金管理人 NAV 与券商报告估值仅作为辅助核验依据。

运行 `pnpm market:fetch` 会把公开日频行情原始响应写入私有暂存区，并生成 `market-prices.csv`、`market-bars.csv` 与 `market-splits.csv`；原始响应保留内容哈希，下载数据不会提交到仓库。

已有原始行情时可以运行 `pnpm market:normalize`，完全离线重新生成兼容的 `market-prices.csv`、`market-bars.csv` 和 `market-splits.csv`。OHLCV 行同时携带来源观测时间；联网刷新仍需显式允许将所需标的列表发送给对应公开数据源。

主要端点：

- `GET /api/health`：数据库、Analytics、迁移、数据来源与交易权限状态；
- `GET /api/v1/portfolio`：当前组合；
- `GET /api/v1/calculations/demo`：从固定交易、现金流和价格重建的每日账本。

Phase 0 与 Phase 1 的范围及验收证据分别见 [docs/reviews/PHASE_0.md](docs/reviews/PHASE_0.md) 和 [docs/reviews/PHASE_1.md](docs/reviews/PHASE_1.md)；Phase 2 的实施进度见 [docs/reviews/PHASE_2.md](docs/reviews/PHASE_2.md)。数据约定见 [docs/CONVENTIONS.md](docs/CONVENTIONS.md)。

Python Analytics 当前已完成服务骨架、共享契约、健康检查和端到端契约检查；SHAR-IV-J、σₚ、CVaR 等生产量化模型仍按 Phase 3 路线实现。Analytics 只做风险度量与监控呈现，不求解权重。
