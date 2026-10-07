import Dexie, { type Table } from 'dexie';
import type { AccessPoint } from '../types/point';
import type { Inspection } from '../types/inspection';
import type { RouteSegment } from '../types/route';
import type { RectifyPlan } from '../types/rectify';
import type { ComplaintOrder, ComplaintOrderDraft } from '../types/complaint';
import { addDays, makeId, todayStr, toPlain } from '../utils/format';
import { judgeInspection } from '../utils/routeCheck';
import { matchOrder } from '../utils/reconcile';

export const DB_NAME = 'gbaccessmap-db';

/**
 * 浏览器本地库：IndexedDB（Dexie）
 * v1 建 points / inspections
 * v2 加 routes 表与 pointId 索引
 * v3 加 rectifies 表，并为历史不合格核验补建整改条目
 * v4 加 complaints（热线工单）表，整改条目加 sourceOrderId 索引；
 *    补登工单对账示例点位/核验，并按「道路+设施类型」对账结果预置工单与自动开出的整改条目
 */
class AccessMapDb extends Dexie {
  points!: Table<AccessPoint, string>;
  inspections!: Table<Inspection, string>;
  routes!: Table<RouteSegment, string>;
  rectifies!: Table<RectifyPlan, string>;
  complaints!: Table<ComplaintOrder, string>;

  constructor() {
    super(DB_NAME);
    this.version(1).stores({
      points: 'id, code, facilityType, district, name',
      inspections: 'id, pointId, date, conclusion',
    });
    this.version(2)
      .stores({
        points: 'id, code, facilityType, district, name',
        inspections: 'id, pointId, date, conclusion',
        routes: 'id, routeName, fromPointId, toPointId, order',
      })
      .upgrade(async (tx) => {
        // v2：把 plan 阶段遗留的 routeName 缺失记录补上默认名称
        const table = tx.table('routes');
        const rows: RouteSegment[] = await table.toArray();
        for (const row of rows) {
          if (!row.routeName) {
            await table.update(row.id, { routeName: '未命名路线' });
          }
        }
      });
    this.version(3)
      .stores({
        points: 'id, code, facilityType, district, name',
        inspections: 'id, pointId, date, conclusion',
        routes: 'id, routeName, fromPointId, toPointId, order',
        rectifies: 'id, pointId, status, deadline',
      })
      .upgrade(async (tx) => {
        // v3：为历史「不合格」核验补建整改条目（已存在同点位待整改条目则跳过）
        const inspections: Inspection[] = await tx.table('inspections').toArray();
        const existed: RectifyPlan[] = await tx.table('rectifies').toArray();
        const pendingPointIds = new Set(
          existed.filter((r) => r.status !== '已整改').map((r) => r.pointId),
        );
        for (const insp of inspections) {
          if (insp.conclusion !== '不合格') continue;
          if (pendingPointIds.has(insp.pointId)) continue;
          pendingPointIds.add(insp.pointId);
          await tx.table('rectifies').add({
            id: `rct-mig-${insp.id}`,
            pointId: insp.pointId,
            requirement: `按核验结论整改：${insp.problem || '整改坡度、净宽与占用问题'}`,
            unit: '待指派责任单位',
            deadline: addDays(insp.date || todayStr(), 30),
            recheckDate: '',
            status: '待整改',
            createdAt: new Date().toISOString(),
          });
        }
      });
    this.version(4)
      .stores({
        points: 'id, code, facilityType, district, name',
        inspections: 'id, pointId, date, conclusion',
        routes: 'id, routeName, fromPointId, toPointId, order',
        rectifies: 'id, pointId, status, deadline, sourceOrderId',
        complaints: 'id, code, status, pointId, receivedAt',
      })
      .upgrade(async (tx) => {
        // v4：补登工单对账演示点位/核验（老库缺哪条补哪条），再预置工单对账数据
        const pointRows: AccessPoint[] = await tx.table('points').toArray();
        const inspRows: Inspection[] = await tx.table('inspections').toArray();
        const pointIds = new Set(pointRows.map((p) => p.id));
        const inspIds = new Set(inspRows.map((i) => i.id));
        const now = new Date().toISOString();
        for (const p of SEED_EXTRA_POINTS) {
          if (!pointIds.has(p.id)) {
            await tx.table('points').add({ ...p, createdAt: now, updatedAt: now });
          }
        }
        for (const s of SEED_EXTRA_INSPECTIONS) {
          const id = `ins-seed-${s.seedIndex}`;
          if (!inspIds.has(id)) {
            const judged = judgeInspection({
              slope: s.slope,
              clearWidth: s.clearWidth,
              hasHandrail: s.hasHandrail,
              tactileContinuous: s.tactileContinuous,
              occupied: s.occupied,
            });
            await tx.table('inspections').add({
              id,
              pointId: s.pointId,
              date: s.date,
              inspector: s.inspector,
              slope: s.slope,
              clearWidth: s.clearWidth,
              hasHandrail: s.hasHandrail,
              tactileContinuous: s.tactileContinuous,
              occupied: s.occupied,
              conclusion: judged.conclusion,
              problem: s.problem,
              createdAt: now,
            });
          }
        }
        const allPoints: AccessPoint[] = await tx.table('points').toArray();
        const complaintCount = await tx.table('complaints').count();
        if (complaintCount === 0) {
          const rectifyRows: RectifyPlan[] = await tx.table('rectifies').toArray();
          const built = buildComplaintSeed(allPoints, rectifyRows, 'mig', now);
          await tx.table('complaints').bulkAdd(built.complaints);
          if (built.rectifies.length) await tx.table('rectifies').bulkAdd(built.rectifies);
        }
      });
  }
}

export const db = new AccessMapDb();

const SEED_POINTS: Omit<AccessPoint, 'createdAt' | 'updatedAt'>[] = [
  {
    id: 'pt-1001',
    code: 'WZ-2024-001',
    name: '东单北大街缘石坡道',
    facilityType: '缘石坡道',
    lng: 116.4183,
    lat: 39.9142,
    district: '东城区',
    location: '东单北大街与灯市口大街交叉口东南角',
    builtYear: 2016,
    maintainUnit: '市政道路养护一所',
  },
  {
    id: 'pt-1002',
    code: 'WZ-2024-002',
    name: '王府井步行街盲道',
    facilityType: '盲道',
    lng: 116.4109,
    lat: 39.915,
    district: '东城区',
    location: '王府井大街南段 118 号门前',
    builtYear: 2018,
    maintainUnit: '市政道路养护二所',
  },
  {
    id: 'pt-1003',
    code: 'WZ-2024-003',
    name: '西直门站无障碍电梯',
    facilityType: '无障碍电梯',
    lng: 116.3555,
    lat: 39.9405,
    district: '西城区',
    location: '地铁西直门站 A 口地面层',
    builtYear: 2019,
    maintainUnit: '轨道交通运营部',
  },
  {
    id: 'pt-1004',
    code: 'WZ-2024-004',
    name: '朝阳公园南门轮椅坡道',
    facilityType: '轮椅坡道',
    lng: 116.4741,
    lat: 39.9339,
    district: '朝阳区',
    location: '朝阳公园南路南门西侧',
    builtYear: 2015,
    maintainUnit: '园林绿化服务中心',
  },
  {
    id: 'pt-1005',
    code: 'WZ-2024-005',
    name: '中关村广场无障碍卫生间',
    facilityType: '无障碍卫生间',
    lng: 116.3106,
    lat: 39.9842,
    district: '海淀区',
    location: '中关村大街 27 号地下二层',
    builtYear: 2020,
    maintainUnit: '城管委设施科',
  },
  {
    id: 'pt-1006',
    code: 'WZ-2024-006',
    name: '丰台科技园低位服务台',
    facilityType: '低位服务台',
    lng: 116.2956,
    lat: 39.856,
    district: '丰台区',
    location: '丰台科技园政务大厅一层',
    builtYear: 2021,
    maintainUnit: '城管委设施科',
  },
  {
    id: 'pt-1007',
    code: 'WZ-2024-007',
    name: '莲花池东路盲道',
    facilityType: '盲道',
    lng: 116.32,
    lat: 39.8977,
    district: '丰台区',
    location: '莲花池东路北侧辅路人行道',
    builtYear: 2014,
    maintainUnit: '市政道路养护一所',
  },
  {
    id: 'pt-1008',
    code: 'WZ-2024-008',
    name: '鲁谷路无障碍电梯',
    facilityType: '无障碍电梯',
    lng: 116.2213,
    lat: 39.9065,
    district: '石景山区',
    location: '鲁谷路 35 号院 3 号楼东侧',
    builtYear: 2013,
    maintainUnit: '轨道交通运营部',
  },
];

interface SeedInspection {
  pointId: string;
  date: string;
  inspector: string;
  slope: number;
  clearWidth: number;
  hasHandrail: boolean;
  tactileContinuous: boolean;
  occupied: Inspection['occupied'];
  problem: string;
}

const SEED_INSPECTIONS: SeedInspection[] = [
  {
    pointId: 'pt-1001',
    date: '2025-03-12',
    inspector: '督导员 李维',
    slope: 3.2,
    clearWidth: 150,
    hasHandrail: true,
    tactileContinuous: true,
    occupied: '无',
    problem: '',
  },
  {
    pointId: 'pt-1002',
    date: '2025-03-14',
    inspector: '督导员 王岚',
    slope: 2.1,
    clearWidth: 130,
    hasHandrail: false,
    tactileContinuous: false,
    occupied: '无',
    problem: '盲道在路口处断开约 4 米，未设置提示盲道',
  },
  {
    pointId: 'pt-1003',
    date: '2025-04-02',
    inspector: '督导员 陈默',
    slope: 1.4,
    clearWidth: 160,
    hasHandrail: true,
    tactileContinuous: true,
    occupied: '无',
    problem: '',
  },
  {
    pointId: 'pt-1004',
    date: '2025-04-08',
    inspector: '督导员 李维',
    slope: 6.4,
    clearWidth: 105,
    hasHandrail: true,
    tactileContinuous: true,
    occupied: '临时占用',
    problem: '坡道中段被共享单车临时占用，实际净宽不足',
  },
  {
    pointId: 'pt-1005',
    date: '2025-04-19',
    inspector: '督导员 赵敏',
    slope: 1.1,
    clearWidth: 155,
    hasHandrail: true,
    tactileContinuous: true,
    occupied: '无',
    problem: '',
  },
  {
    pointId: 'pt-1006',
    date: '2025-05-06',
    inspector: '督导员 赵敏',
    slope: 2.6,
    clearWidth: 140,
    hasHandrail: true,
    tactileContinuous: true,
    occupied: '无',
    problem: '',
  },
  {
    pointId: 'pt-1007',
    date: '2025-05-11',
    inspector: '督导员 王岚',
    slope: 9.5,
    clearWidth: 82,
    hasHandrail: false,
    tactileContinuous: false,
    occupied: '长期占用',
    problem: '盲道被沿街商铺货架长期占用，坡度过大且净宽不足 90cm',
  },
  {
    pointId: 'pt-1008',
    date: '2025-05-20',
    inspector: '督导员 陈默',
    slope: 1.8,
    clearWidth: 145,
    hasHandrail: true,
    tactileContinuous: true,
    occupied: '无',
    problem: '',
  },
];

interface SeedRoute {
  routeName: string;
  pointIds: string[];
  length: number;
  obstacleCount: number;
  stepCount: number;
  curbHeight: number;
}

const SEED_ROUTES: SeedRoute[] = [
  {
    routeName: '东单—王府井轮椅通道',
    pointIds: ['pt-1001', 'pt-1002'],
    length: 640.5,
    obstacleCount: 1,
    stepCount: 0,
    curbHeight: 2,
  },
];

/**
 * 工单对账演示点位：
 * pt-1009 鲁谷路与既有 pt-1008 同路不同设施（电梯 vs 坡道，唯一命中用）；
 * pt-1010 / pt-1011 同在中关村大街且都是缘石坡道——模拟「同一处设施挂到两个点」。
 */
const SEED_EXTRA_POINTS: Omit<AccessPoint, 'createdAt' | 'updatedAt'>[] = [
  {
    id: 'pt-1009',
    code: 'WZ-2024-009',
    name: '鲁谷路小区出入口缘石坡道',
    facilityType: '缘石坡道',
    lng: 116.2238,
    lat: 39.9048,
    district: '石景山区',
    location: '鲁谷路 35 号院出入口西侧',
    builtYear: 2017,
    maintainUnit: '市政道路养护二所',
  },
  {
    id: 'pt-1010',
    code: 'WZ-2024-010',
    name: '中关村大街南口缘石坡道',
    facilityType: '缘石坡道',
    lng: 116.3112,
    lat: 39.9835,
    district: '海淀区',
    location: '中关村大街与中关村南路交叉口西南角',
    builtYear: 2016,
    maintainUnit: '市政道路养护一所',
  },
  {
    id: 'pt-1011',
    code: 'WZ-2024-011',
    name: '中关村大街27号门前缘石坡道',
    facilityType: '缘石坡道',
    lng: 116.3109,
    lat: 39.9846,
    district: '海淀区',
    location: '中关村大街 27 号门前人行道',
    builtYear: 2016,
    maintainUnit: '市政道路养护一所',
  },
];

interface SeedExtraInspection extends SeedInspection {
  seedIndex: number;
}

const SEED_EXTRA_INSPECTIONS: SeedExtraInspection[] = [
  {
    seedIndex: 9,
    pointId: 'pt-1009',
    date: '2025-05-22',
    inspector: '督导员 陈默',
    slope: 6.8,
    clearWidth: 112,
    hasHandrail: false,
    tactileContinuous: true,
    occupied: '无',
    problem: '坡道偏陡、宽度勉强，列入观察',
  },
  {
    seedIndex: 10,
    pointId: 'pt-1010',
    date: '2025-05-25',
    inspector: '督导员 李维',
    slope: 4.1,
    clearWidth: 128,
    hasHandrail: true,
    tactileContinuous: true,
    occupied: '无',
    problem: '',
  },
  {
    seedIndex: 11,
    pointId: 'pt-1011',
    date: '2025-05-25',
    inspector: '督导员 李维',
    slope: 4.4,
    clearWidth: 126,
    hasHandrail: true,
    tactileContinuous: true,
    occupied: '无',
    problem: '',
  },
];

/** 热线来件：四种对账情形各一 */
const SEED_COMPLAINTS: ComplaintOrderDraft[] = [
  {
    // 唯一命中 pt-1009，且外部实测坡度与点位核验对不上（9.2% vs 6.8%）
    code: 'RX-2025-0601',
    source: '12345热线',
    content: '鲁谷路35号院门口轮椅上不去，坡道太陡，家里老人轮椅卡在坡中段',
    road: '鲁谷路',
    facilityText: '坡道',
    slope: 9.2,
    clearWidth: 110,
    contact: '138****2041',
    receivedAt: '2025-06-01',
  },
  {
    // 多命中：中关村大街两处缘石坡道同分，疑似同一处设施挂两个点
    code: 'RX-2025-0602',
    source: '无障碍投诉专线',
    content: '中关村大街南口路缘石没有做坡，轮椅下不了人行道，来往车辆多很危险',
    road: '中关村大街',
    facilityText: '缘石坡道',
    slope: null,
    clearWidth: null,
    contact: '',
    receivedAt: '2025-06-02',
  },
  {
    // 对不上：库内无崇文门外大街点位
    code: 'RX-2025-0603',
    source: '群众来访',
    content: '崇文门外大街盲道被电动车和早餐摊占满，视障同事根本没法走',
    road: '崇文门外大街',
    facilityText: '盲道',
    slope: null,
    clearWidth: 65,
    contact: '010-****8821',
    receivedAt: '2025-06-03',
  },
  {
    // 唯一命中 pt-1001（东单北大街缘石坡道），外部净宽与核验值一致、坡度缺测
    code: 'RX-2025-0604',
    source: '网格巡查',
    content: '东单北大街路口缘石坡道导向盲道砖缺失，坡道侧面无提示，夜间容易踩空',
    road: '东单北大街',
    facilityText: '缘石坡道',
    slope: null,
    clearWidth: 148,
    contact: '',
    receivedAt: '2025-06-04',
  },
];

/** 由工单外部实测拼整改要求：保留实测值并标注来源，便于整改单位对照 */
function complaintRequirement(order: ComplaintOrderDraft): string {
  const measures: string[] = [];
  if (order.slope !== null) measures.push(`工单实测坡度 ${order.slope}%`);
  if (order.clearWidth !== null) measures.push(`工单实测净宽 ${order.clearWidth}cm`);
  const measureText = measures.length ? `（${measures.join('，')}，来源：${order.source}）` : '';
  return `按${order.code} 热线投诉核查整改：${order.content}${measureText}`;
}

/**
 * 按「道路+设施类型」对账预置工单：唯一命中直接开整改条目；
 * 对不上/多命中列为待认领。工单与整改条目都打上统一前缀便于演示追踪。
 */
export function buildComplaintSeed(
  points: AccessPoint[],
  existedRectifies: RectifyPlan[],
  idTag: string,
  nowIso: string,
): { complaints: ComplaintOrder[]; rectifies: RectifyPlan[] } {
  const complaints: ComplaintOrder[] = [];
  const rectifies: RectifyPlan[] = [];
  SEED_COMPLAINTS.forEach((draft, i) => {
    const orderId = `cmp-${idTag}-${i + 1}`;
    const outcome = matchOrder(draft.road, draft.facilityText, draft.content, points);
    const base: ComplaintOrder = {
      ...draft,
      id: orderId,
      status: '待认领',
      pointId: '',
      claimMode: null,
      claimedAt: '',
      claimedBy: '',
      rectifyId: '',
      matchNote: outcome.note,
      createdAt: nowIso,
    };
    if (outcome.kind === 'unique' && outcome.point) {
      const point = outcome.point;
      const rectifyId = `rct-${idTag}cmp-${i + 1}`;
      const already = existedRectifies.some((r) => r.id === rectifyId);
      if (!already) {
        rectifies.push({
          id: rectifyId,
          pointId: point.id,
          requirement: complaintRequirement(draft),
          unit: point.maintainUnit,
          deadline: addDays(todayStr(), 30),
          recheckDate: '',
          status: '待整改',
          sourceOrderId: orderId,
          externalSlope: draft.slope,
          externalClearWidth: draft.clearWidth,
          createdAt: nowIso,
        });
      }
      complaints.push({
        ...base,
        status: '已认领',
        pointId: point.id,
        claimMode: 'auto',
        claimedAt: nowIso,
        claimedBy: '系统自动对账',
        rectifyId,
      });
    } else {
      complaints.push(base);
    }
  });
  return { complaints, rectifies };
}

function buildSeed() {
  const now = new Date().toISOString();
  const today = todayStr();
  const allSeedPoints = [...SEED_POINTS, ...SEED_EXTRA_POINTS];
  const points: AccessPoint[] = allSeedPoints.map((p) => ({ ...p, createdAt: now, updatedAt: now }));
  const inspections: Inspection[] = SEED_INSPECTIONS.map((s, i) => {
    const judged = judgeInspection({
      slope: s.slope,
      clearWidth: s.clearWidth,
      hasHandrail: s.hasHandrail,
      tactileContinuous: s.tactileContinuous,
      occupied: s.occupied,
    });
    return {
      id: `ins-seed-${i + 1}`,
      pointId: s.pointId,
      date: s.date,
      inspector: s.inspector,
      slope: s.slope,
      clearWidth: s.clearWidth,
      hasHandrail: s.hasHandrail,
      tactileContinuous: s.tactileContinuous,
      occupied: s.occupied,
      conclusion: judged.conclusion,
      problem: s.problem,
      createdAt: now,
    };
  });
  SEED_EXTRA_INSPECTIONS.forEach((s) => {
    const judged = judgeInspection({
      slope: s.slope,
      clearWidth: s.clearWidth,
      hasHandrail: s.hasHandrail,
      tactileContinuous: s.tactileContinuous,
      occupied: s.occupied,
    });
    inspections.push({
      id: `ins-seed-${s.seedIndex}`,
      pointId: s.pointId,
      date: s.date,
      inspector: s.inspector,
      slope: s.slope,
      clearWidth: s.clearWidth,
      hasHandrail: s.hasHandrail,
      tactileContinuous: s.tactileContinuous,
      occupied: s.occupied,
      conclusion: judged.conclusion,
      problem: s.problem,
      createdAt: now,
    });
  });
  const routes: RouteSegment[] = [];
  SEED_ROUTES.forEach((r, ri) => {
    for (let i = 1; i < r.pointIds.length; i += 1) {
      routes.push({
        id: `rts-seed-${ri + 1}-${i}`,
        routeName: r.routeName,
        fromPointId: r.pointIds[i - 1],
        toPointId: r.pointIds[i],
        length: Math.round((r.length / (r.pointIds.length - 1)) * 10) / 10,
        obstacleCount: r.obstacleCount,
        stepCount: r.stepCount,
        curbHeight: r.curbHeight,
        wheelchairPassable: r.stepCount === 0 && r.curbHeight <= 3 && r.obstacleCount <= 2,
        order: i,
        createdAt: now,
      });
    }
  });
  const rectifies: RectifyPlan[] = [
    {
      id: 'rct-seed-1',
      pointId: 'pt-1007',
      requirement: '清退盲道上的商铺货架，重做坡道并加装扶手，复测净宽不低于 120cm',
      unit: '市政道路养护一所',
      deadline: addDays(today, -21),
      recheckDate: '',
      status: '待整改',
      createdAt: now,
    },
    {
      id: 'rct-seed-2',
      pointId: 'pt-1002',
      requirement: '补齐路口断开的盲道并增设提示盲道',
      unit: '市政道路养护二所',
      deadline: addDays(today, -6),
      recheckDate: '',
      status: '待整改',
      createdAt: now,
    },
    {
      id: 'rct-seed-3',
      pointId: 'pt-1004',
      requirement: '划设共享单车禁停区，恢复坡道净宽至 120cm 以上',
      unit: '园林绿化服务中心',
      deadline: addDays(today, 18),
      recheckDate: '',
      status: '待整改',
      createdAt: now,
    },
    {
      id: 'rct-seed-4',
      pointId: 'pt-1008',
      requirement: '更换电梯轿厢呼叫按钮盲文标识',
      unit: '轨道交通运营部',
      deadline: addDays(today, -40),
      recheckDate: addDays(today, -12),
      status: '已整改',
      createdAt: now,
    },
  ];
  const complaintBuilt = buildComplaintSeed(points, rectifies, 'seed', now);
  return { points, inspections, routes, rectifies, complaints: complaintBuilt.complaints, complaintRectifies: complaintBuilt.rectifies };
}

/** 首次打开时写入示例数据；已有数据则跳过 */
export async function ensureSeed(): Promise<void> {
  const count = await db.points.count();
  if (count > 0) return;
  const seed = toPlain(buildSeed());
  await db.transaction(
    'rw',
    db.points,
    db.inspections,
    db.routes,
    db.rectifies,
    db.complaints,
    async () => {
      await db.points.bulkPut(seed.points);
      await db.inspections.bulkPut(seed.inspections);
      await db.routes.bulkPut(seed.routes);
      await db.rectifies.bulkPut(seed.rectifies);
      await db.rectifies.bulkPut(seed.complaintRectifies);
      await db.complaints.bulkPut(seed.complaints);
    },
  );
}

export { makeId };
