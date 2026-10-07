import { create } from 'zustand';
import { db } from '../db';
import type { ComplaintOrder, ComplaintOrderDraft, ReconcileMatch } from '../types/order';
import type { Inspection } from '../types/inspection';
import type { RectifyPlan } from '../types/rectify';
import { addDays, makeId, toPlain, todayStr } from '../utils/format';
import { matchOrders } from '../utils/reconcile';
import { rejudge } from '../utils/routeCheck';
import { usePointStore } from './pointStore';

interface OrderState {
  orders: ComplaintOrder[];
  loaded: boolean;
  loading: boolean;
  error: string;
  load: () => Promise<void>;
  addOrder: (draft: ComplaintOrderDraft) => Promise<ComplaintOrder>;
  /** 全量重新比对：给待认领工单挑候选点位，唯一命中的自动开单 */
  reconcile: () => Promise<{ autoOpened: number; pending: number }>;
  /** 督导员人工认领（多处命中选择 / 无命中时直接指定点位），随后开出整改条目 */
  claim: (orderId: string, pointId: string, note: string) => Promise<void>;
  /** 点位最新核验变化后，联动重算该点位上由工单开出的整改条目（已整改 → 复发） */
  handleInspectionChanged: (inspection: Inspection) => Promise<void>;
  getOrder: (id: string) => ComplaintOrder | undefined;
}

/** 由工单外部实测 + 投诉描述拼整改要求（数值标注为热线实测来源） */
function buildRequirement(order: ComplaintOrder): string {
  const parts: string[] = [];
  if (order.slope !== null) parts.push(`热线实测坡度 ${order.slope}%`);
  if (order.clearWidth !== null) parts.push(`热线实测净宽 ${order.clearWidth}cm`);
  const measure = parts.length ? `（${parts.join('，')}）` : '';
  return `12345 工单 ${order.code}：${order.content}${measure}`;
}

export const useOrderStore = create<OrderState>((set, get) => {
  /** 落库并回写工单状态 */
  const persistOrder = async (updated: ComplaintOrder) => {
    const plain = toPlain(updated);
    await db.orders.put(plain);
    set((s) => ({ orders: s.orders.map((o) => (o.id === plain.id ? plain : o)) }));
  };

  /**
   * 开出工单整改条目：
   * 同一点位已有未整改条目时挂接既有条目（避免同一设施重复派单），
   * 否则新建来源为「热线工单」的整改条目，并把 rectifyId 回写工单。
   */
  const openRectify = async (
    order: ComplaintOrder,
    pointId: string,
    method: '自动' | '人工确认',
    note = '',
  ): Promise<void> => {
    const pointState = usePointStore.getState();
    const point = pointState.getPoint(pointId);

    const existing = pointState.rectifies.find(
      (r) => r.pointId === pointId && r.status !== '已整改',
    );

    let rectifyId: string;
    if (existing) {
      rectifyId = existing.id;
      const merged = `工单 ${order.code} 并入：${buildRequirement(order)}`;
      await pointState.updateRectify(existing.id, {
        requirement: existing.requirement.includes(order.code)
          ? existing.requirement
          : `${existing.requirement}｜${merged}`,
        source: '热线工单',
        orderId: existing.orderId || order.id,
      });
    } else {
      const plan: Omit<RectifyPlan, 'id' | 'createdAt'> = {
        pointId,
        requirement: buildRequirement(order),
        unit: point?.maintainUnit || '待指派责任单位',
        deadline: addDays(todayStr(), 30),
        recheckDate: '',
        status: '待整改',
        source: '热线工单',
        orderId: order.id,
      };
      const created = await pointState.addRectify(plan);
      rectifyId = created.id;
    }

    await persistOrder(
      toPlain({
        ...order,
        status: '已开单' as const,
        pointId,
        matchMethod: method,
        rectifyId,
        claimNote: note,
        updatedAt: new Date().toISOString(),
      }),
    );
  };

  return {
    orders: [],
    loaded: false,
    loading: false,
    error: '',

    load: async () => {
      set({ loading: true, error: '' });
      try {
        const rows = await db.orders.toArray();
        set({
          orders: rows.sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1)),
          loading: false,
          loaded: true,
        });
        // 载入后先跑一遍：种子/历史待认领工单可能在补登点位后已能唯一命中
        await get().reconcile();
      } catch (e) {
        set({ loading: false, loaded: true, error: e instanceof Error ? e.message : String(e) });
      }
    },

    addOrder: async (draft) => {
      const now = new Date().toISOString();
      const order: ComplaintOrder = toPlain({
        ...draft,
        id: makeId('ord'),
        status: '待认领',
        pointId: '',
        matchMethod: null,
        rectifyId: '',
        claimNote: '',
        createdAt: now,
        updatedAt: now,
      });
      await db.orders.put(order);
      set((s) => ({
        orders: [order, ...s.orders].sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1)),
      }));
      await get().reconcile();
      return order;
    },

    reconcile: async () => {
      const { orders } = get();
      if (!orders.length) return { autoOpened: 0, pending: 0 };
      const pointState = usePointStore.getState();
      if (!pointState.loaded || !pointState.points.length) {
        return { autoOpened: 0, pending: orders.filter((o) => o.status === '待认领').length };
      }

      const matches: Map<string, ReconcileMatch> = matchOrders(orders, pointState.points);
      let autoOpened = 0;
      for (const match of matches.values()) {
        if (match.kind !== 'unique') continue;
        const order = get().orders.find((o) => o.id === match.orderId);
        if (!order || order.status !== '待认领') continue;
        await openRectify(order, match.candidates[0].pointId, '自动');
        autoOpened += 1;
      }
      const pending = get().orders.filter((o) => o.status === '待认领').length;
      return { autoOpened, pending };
    },

    claim: async (orderId, pointId, note) => {
      const order = get().orders.find((o) => o.id === orderId);
      if (!order) throw new Error('工单不存在');
      if (order.status !== '待认领') throw new Error('该工单已处理，不能重复认领');
      if (!usePointStore.getState().getPoint(pointId)) {
        throw new Error('所选点位不存在，请重新选择');
      }
      await openRectify(order, pointId, '人工确认', note);
    },

    handleInspectionChanged: async (inspection) => {
      const pointState = usePointStore.getState();
      // 该点位上由工单开出、且已标记整改完成的条目：最新核验又不合格 → 复发重开
      if (inspection.conclusion !== '不合格') return;
      const related = pointState.rectifies.filter(
        (r) => r.pointId === inspection.pointId && r.source === '热线工单' && r.status === '已整改',
      );
      for (const plan of related) {
        // eslint-disable-next-line no-await-in-loop
        await pointState.updateRectify(plan.id, {
          status: '复发',
          recheckDate: '',
          requirement: `${plan.requirement}｜${inspection.date} 核验复发：${rejudge(inspection).reasons.join('；')}`,
        });
      }
    },

    getOrder: (id) => get().orders.find((o) => o.id === id),
  };
});
