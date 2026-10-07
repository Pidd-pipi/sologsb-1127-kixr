# sologsb-1127 城市无障碍设施核验地图（gbaccessmap）

面向无障碍督导员与轮椅使用者代表，把坡道、盲道、无障碍电梯的点位、核验数据与通行路线集中到一张图上。

## 一键启动（Docker）

```bash
cp .env.example .env
docker compose up -d --build
```

访问地址：<http://localhost:21827>

停止服务（镜像保留）：

```bash
docker compose down
```

## 技术栈

| 分层 | 选型 |
| --- | --- |
| 框架 | React 18 + TypeScript |
| UI | Ant Design 5 + @ant-design/icons |
| 构建 | Vite 6（`tsc -b && vite build`，构建含类型检查） |
| 状态管理 | Zustand 5（业务数据 store + UI 偏好 persist 到 localStorage） |
| 路由 | React Router 6（BrowserRouter，nginx `try_files` 兜底） |
| 地图 | 高德地图 JS API（key 走 `VITE_AMAP_KEY`，留空时自动降级为本地 SVG 网格视图） |
| 本地存储 | IndexedDB（Dexie 4，库名 `gbaccessmap-db`）+ localStorage（表单草稿、UI 偏好） |
| 托管 | nginx:alpine（多阶段构建） |

## 核心功能

| 路由 | 说明 | 消费模型 |
| --- | --- | --- |
| `/` | 核验总览：按行政区与设施类型汇总点位数、合格率、待整改数，点击统计块下钻清单 | AccessPoint / Inspection / RectifyPlan |
| `/points/new` | 点位登记：地图打点或手填经纬度，可同时录入首次核验实测值 | AccessPoint / Inspection |
| `/points/:id` | 点位详情：地图定位与属性、核验历史、就地新增核验、工单对账与整改跟踪 | 五个模型 |
| `/routes` | 通行路线编制：选点自动串联路段，逐段填障碍数/台阶数/路缘高差，端点点位最新核验即时并入全线判定 | RouteSegment / AccessPoint / Inspection |
| `/map` | 设施地图：按设施类型着色渲染点位，点选弹出核验摘要 | AccessPoint / Inspection |
| `/rectify` | 整改清单：按状态与期限分组、逾期置顶，来源工单与双源实测对照，登记复检结果 | RectifyPlan / AccessPoint / ComplaintOrder |
| `/complaints` | 工单对账：热线投诉按「道路+设施类型」配点位，唯一命中直接开整改，对不上/对上多处列待认领由督导员确认 | ComplaintOrder / AccessPoint / RectifyPlan |

## 数据模型（`src/types/` 独立文件）

| 模型 | 文件 | 关键字段 |
| --- | --- | --- |
| AccessPoint | `src/types/point.ts` | 点位编号、名称、设施类型、经纬度、行政区、所在道路或建筑、建成年代、养护单位 |
| Inspection | `src/types/inspection.ts` | 核验日期、核验人、坡度 %、净宽 cm、扶手、盲道连续性、占用情况、结论、问题描述 |
| RouteSegment | `src/types/route.ts` | 路线名称、起点/终点点位、长度、障碍数、台阶数、路缘高差、是否可轮椅通行 |
| RectifyPlan | `src/types/rectify.ts` | 点位 id、整改要求、责任单位、整改期限、复检日期、状态、来源工单 id、外部实测快照 |
| ComplaintOrder | `src/types/complaint.ts` | 热线工单号、来源、反映道路、设施原文措辞、外部实测坡度/净宽、认领点位/方式/整改条目 id、对账说明 |

## 数据存储

- **IndexedDB（Dexie，库名 `gbaccessmap-db`）**：业务数据。含版本号与升级迁移：
  - `v1` 建 `points` / `inspections` 表；
  - `v2` 增加 `routes` 表与 `pointId` 相关索引；
  - `v3` 增加 `rectifies` 表，并为历史「不合格」核验补建整改条目；
  - `v4` 增加 `complaints` 表、`rectifies.sourceOrderId` 索引；补登工单演示点位/核验，并按对账结果预置工单与自动开出的整改条目。
- **localStorage**：点位登记表单草稿（`gbaccessmap-draft:point-new`）与 UI 偏好（`gbaccessmap-ui`）。
- 首次打开时自动写入一批示例数据，便于直接体验。
- 容器无状态：不使用数据库服务、不挂载命名卷，清空浏览器存储即可重置数据。

## 高德地图 key

`VITE_AMAP_KEY` 留空（默认）时：`useAmapLoader()` 检测到 key 为空会**立即**返回降级标记，**不会**请求 `webapi.amap.com`；页面渲染可点选、可查看详情的本地 SVG 网格视图（`MapPanel`）。配置了 key 时脚本加载失败或超时同样自动降级，因此构建与运行都不依赖该 key。

## 目录结构

```
sologsb-1127/
├── docker-compose.yml          # 顶层 name: gbaccessmap，无 version: 字段
├── .env / .env.example         # COMPOSE_PROJECT_NAME / FRONTEND_PORT / VITE_AMAP_KEY
├── README.md
└── frontend/
    ├── Dockerfile              # node:20-alpine 构建 → nginx:alpine 托管
    ├── nginx.conf              # try_files + gzip
    ├── index.html
    ├── package.json
    ├── vite.config.ts
    ├── tsconfig*.json
    ├── public/favicon.svg
    └── src/
        ├── types/{point,inspection,route,rectify,complaint}.ts
        ├── db/index.ts                     # Dexie 封装 + v1–v4 迁移 + 示例数据
        ├── stores/{pointStore,routeStore,complaintStore,uiStore}.ts
        ├── components/common/{MapPanel,StatusBadge,FacilityIcon,MeasureInput,MeasureCompare,EmptyState}.tsx
        ├── hooks/{useAmapLoader,useInspectionFilter,useLocalDraft}.ts
        ├── pages/{Overview,PointNew,PointDetail,Routes,MapView,Rectify,Complaints}.tsx
        ├── layouts/AppLayout.tsx
        ├── router/index.tsx
        └── utils/{routeCheck,reconcile,measures,geo,format}.ts
```

## 判定阈值（`src/utils/routeCheck.ts`）

- 坡度：≤ 5% 合格，> 5% 限期整改，> 8% 不合格；
- 净宽：≥ 120cm 合格，< 120cm 限期整改，< 90cm 不合格；
- 路缘高差：≤ 3cm 可轮椅通行，> 6cm 判定不可通行；存在台阶需绕行或增设坡道。
- 路线端点（含途经点）最新核验为「不合格」时整条路线判不可通行，「限期整改」或未核验给出提示；核验一变路线判定立即重算。

## 工单对账规则（`src/utils/reconcile.ts`、`src/stores/complaintStore.ts`）

- 对账主键为**道路 + 设施类型**：从工单道路/报修原文抽主干路名（剔除「缘石坡道/盲道」等设施词干扰），在点位名称与「所在道路」上做子串匹配；设施措辞先同义归一（如「坡道/路缘坡/电梯」），坡道亚型之间互通。
- **只对上一处**：自动认领并直接开出整改条目（责任单位取点位养护单位，期限 30 天，幂等：同工单不重复开条）。
- **对不上或对上多处**（含同一处设施挂到两个点、同分候选）：列为待认领，督导员在 `/complaints` 确认点位后人工认领再写；对不上的也可先补登点位。
- 待认领工单的候选列表按最新点位**实时重算**；补登点位或新增核验后，新唯一命中的工单自动认领开条。
- 工单的坡度、净宽是**外部实测**：落整改条目时快照留档（`externalSlope/externalClearWidth`），与点位最新核验值并列展示（`MeasureCompare`），差值超过 0.5 个百分点 / 5cm 标「两边不一致，均保留待核」，不以任一方覆盖另一方。
