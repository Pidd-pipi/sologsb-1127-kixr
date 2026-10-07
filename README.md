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
| `/points/:id` | 点位详情：地图定位与属性、核验历史、就地新增核验、整改跟踪、关联 12345 工单实测对撞 | 五个模型 |
| `/routes` | 通行路线编制：选点自动串联路段，逐段填障碍数/台阶数/路缘高差，结合端点最新核验输出全线判定 | RouteSegment / AccessPoint / Inspection |
| `/map` | 设施地图：按设施类型着色渲染点位，点选弹出核验摘要 | AccessPoint / Inspection |
| `/orders` | 12345 工单对账：按道路+设施类型匹配点位，唯一命中直接开整改单，0/多处命中列待认领，外部实测与最新核验对撞留档 | ComplaintOrder / AccessPoint / RectifyPlan |
| `/rectify` | 整改清单：按状态与期限分组、逾期置顶，登记复检结果 | RectifyPlan / AccessPoint |

## 数据模型（`src/types/` 独立文件）

| 模型 | 文件 | 关键字段 |
| --- | --- | --- |
| AccessPoint | `src/types/point.ts` | 点位编号、名称、设施类型、经纬度、行政区、所在道路或建筑、建成年代、养护单位 |
| Inspection | `src/types/inspection.ts` | 核验日期、核验人、坡度 %、净宽 cm、扶手、盲道连续性、占用情况、结论、问题描述 |
| RouteSegment | `src/types/route.ts` | 路线名称、起点/终点点位、长度、障碍数、台阶数、路缘高差、是否可轮椅通行 |
| RectifyPlan | `src/types/rectify.ts` | 点位 id、整改要求、责任单位、整改期限、复检日期、状态、来源（核验/手工/热线工单）、来源工单 id |
| ComplaintOrder | `src/types/order.ts` | 工单编号、受理日期、投诉人、道路、设施类型、外部实测坡度/净宽、对账状态、挂接点位、认领方式、整改条目 id |

## 工单对账规则（`src/utils/reconcile.ts` / `src/stores/orderStore.ts`）

1. **按道路 + 设施类型匹配点位**：道路文本经归一化（去门牌/方位角/「辅路、交叉口」噪声、剥离「大街/路」后缀取专名）后双向包含比对。
2. **对账结果**：恰好 1 处命中 → 自动开出整改条目；0 处（无命中）或多处（同一设施挂了两个点）→ 进入「待认领」，由督导员在 `/orders` 确认点位后再开单。
3. **重新比对是响应式的**：点位新增/核验变化即重跑未认领工单的比对（补登点位可把「无命中」自动消解为开单）；已认领工单保留督导员决定，不自动改挂。
4. **外部实测对撞（`src/utils/measureDiff.ts`）**：工单坡度/净宽算热线外部实测，与点位最新核验不一致时**两边数值都保留**，分别标注「热线工单（外部实测）」「点位最新核验（日期）」并标出差异量。
5. **联动重算**：点位新增一条「不合格」核验时，该点位由工单开出且已整改完成的条目立即重判为「复发」；路线判定（`buildVerdict`）实时纳入端点/途经点位最新核验——不合格阻断通行、限期整改给出警示。

## 数据存储

- **IndexedDB（Dexie，库名 `gbaccessmap-db`）**：业务数据。含版本号与升级迁移：
  - `v1` 建 `points` / `inspections` 表；
  - `v2` 增加 `routes` 表与 `pointId` 相关索引；
  - `v3` 增加 `rectifies` 表，并为历史「不合格」核验补建整改条目；
  - `v4` 增加 `orders`（12345 热线工单）表与索引，`rectifies` 增加 `source` / `orderId` 来源字段并为历史条目补默认值。
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
        ├── types/{point,inspection,route,rectify,order}.ts
        ├── db/index.ts                     # Dexie 封装 + 版本迁移 + 示例数据
        ├── stores/{pointStore,routeStore,orderStore,uiStore}.ts
        ├── components/common/{MapPanel,StatusBadge,FacilityIcon,MeasureInput,EmptyState}.tsx
        ├── hooks/{useAmapLoader,useInspectionFilter,useReconcile,useLocalDraft}.ts
        ├── pages/{Overview,PointNew,PointDetail,Routes,MapView,Orders,Rectify}.tsx
        ├── layouts/AppLayout.tsx
        ├── router/index.tsx
        └── utils/{routeCheck,reconcile,measureDiff,geo,format}.ts
```

## 判定阈值（`src/utils/routeCheck.ts`）

- 坡度：≤ 5% 合格，> 5% 限期整改，> 8% 不合格；
- 净宽：≥ 120cm 合格，< 120cm 限期整改，< 90cm 不合格；
- 路缘高差：≤ 3cm 可轮椅通行，> 6cm 判定不可通行；存在台阶需绕行或增设坡道。
