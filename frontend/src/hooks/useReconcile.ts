import { useMemo } from 'react';
import { useOrderStore } from '../stores/orderStore';
import { usePointStore } from '../stores/pointStore';
import { matchOrders } from '../utils/reconcile';
import { diffOrderWithInspection, type OrderMeasureDiff } from '../utils/measureDiff';
import type { AccessPoint } from '../types/point';
import type { ComplaintOrder, ReconcileMatch } from '../types/order';
import type { Inspection } from '../types/inspection';
import type { RectifyPlan } from '../types/rectify';

/** 每个点位最新一次核验 */
function buildLatest(inspections: Inspection[]): Map<string, Inspection> {
  const map = new Map<string, Inspection>();
  for (const i of inspections) {
    const cur = map.get(i.pointId);
    if (!cur || cur.date < i.date) map.set(i.pointId, i);
  }
  return map;
}

export interface OrderRow {
  order: ComplaintOrder;
  /** 待认领工单的候选比对结果；已开单工单为 null */
  match: ReconcileMatch | null;
  point: AccessPoint | undefined;
  latest: Inspection | undefined;
  diff: OrderMeasureDiff;
  rectify: RectifyPlan | undefined;
}

export interface ReconcileResult {
  rows: OrderRow[];
  /** 待认领：无命中 */
  noHit: OrderRow[];
  /** 待认领：多处命中 */
  multiHit: OrderRow[];
  /** 已开单（自动/人工） */
  opened: OrderRow[];
  pointMap: Map<string, AccessPoint>;
  latestByPoint: Map<string, Inspection>;
}

/**
 * 工单对账派生视图：
 * points / inspections / orders 任一变化都通过 useMemo 立即重算，
 * 因此点位核验一变，实测对撞、路线判定与整改联动全部刷新；
 * 未认领工单则按最新点位集重新比对（补登点位可自动消解待认领）。
 */
export function useReconcile(): ReconcileResult {
  const orders = useOrderStore((s) => s.orders);
  const points = usePointStore((s) => s.points);
  const inspections = usePointStore((s) => s.inspections);
  const rectifies = usePointStore((s) => s.rectifies);

  return useMemo(() => {
    const pointMap = new Map(points.map((p) => [p.id, p]));
    const latestByPoint = buildLatest(inspections);
    const rectifyMap = new Map(rectifies.map((r) => [r.id, r]));
    const matches = matchOrders(orders, points);

    const rows: OrderRow[] = orders.map((order) => {
      const match = order.status === '待认领' ? (matches.get(order.id) ?? null) : null;
      const point = order.pointId ? pointMap.get(order.pointId) : undefined;
      const latest = order.pointId ? latestByPoint.get(order.pointId) : undefined;
      return {
        order,
        match,
        point,
        latest,
        diff: diffOrderWithInspection(order, latest),
        rectify: order.rectifyId ? rectifyMap.get(order.rectifyId) : undefined,
      };
    });

    return {
      rows,
      noHit: rows.filter((r) => r.order.status === '待认领' && r.match?.kind === 'none'),
      multiHit: rows.filter((r) => r.order.status === '待认领' && r.match?.kind === 'multiple'),
      opened: rows.filter((r) => r.order.status === '已开单'),
      pointMap,
      latestByPoint,
    };
  }, [orders, points, inspections, rectifies]);
}
