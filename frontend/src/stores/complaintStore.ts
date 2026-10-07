import { create } from 'zustand';
import { db } from '../db';
import { makeId, toPlain, todayStr, addDays } from '../utils/format';
import { matchOrder, type MatchOutcome } from '../utils/reconcile';
import { usePointStore } from './pointStore';
import type { ComplaintOrder, ComplaintOrderDraft } from '../types/complaint';

interface ComplaintState {
  orders: ComplaintOrder[];
  loaded: boolean;
  loading: boolean;
  error: string;
  load: () => Promise<void>;
  /** 登记热线工单并立即对账：唯一命中直接开整改，否则挂待认领 */
  addOrder: (draft: ComplaintOrderDraft) => Promise<ComplaintOrder>;
  /** 督导员人工认领：挂到选定点位并补开整改条目 */
  claimOrder: (orderId: string, pointId: string, operator: string) => Promise<void>;
  /** 点位/核验一变即调用：未认领工单按最新点位重新比对，新唯一命中自动升级 */
  revalidatePending: () => Promise<void>;
}

/** 由工单外部实测拼整改要求：保留实测值并标注来源，与点位核验值并列留档 */
export function buildOrderRequirement(draft: Pick<ComplaintOrderDraft, 'code' | 'source' | 'content' | 'slope' | 'clearWidth'>): string {
  const measures: string[] = [];
  if (draft.slope !== null) measures.push(`工单实测坡度 ${draft.slope}%`);
  if (draft.clearWidth !== null) measures.push(`工单实测净宽 ${draft.clearWidth}cm`);
  const measureText = measures.length ? `（${measures.join('，')}，来源：${draft.source}）` : '';
  return `按${draft.code} 热线投诉核查整改：${draft.content}${measureText}`;
}

/**
 * 跑一次对账。unique 时：幂等开出整改条目（同工单已有整改条目不重复开），
 * 并把工单置为已认领；none/ambiguous 只刷新对账说明，保持待认领。
 */
async function applyOutcome(
  order: ComplaintOrder,
  outcome: MatchOutcome,
  mode: 'auto' | 'manual',
  operator: string,
): Promise<ComplaintOrder> {
  const pointStore = usePointStore.getState();
  if (outcome.kind !== 'unique' || !outcome.point) {
    const next = toPlain({ ...order, matchNote: outcome.note });
    await db.complaints.put(next);
    return next;
  }
  const point = outcome.point;
  const nowIso = new Date().toISOString();

  let rectifyId = order.rectifyId;
  if (!rectifyId || !pointStore.rectifies.some((r) => r.id === rectifyId)) {
    const plan = await pointStore.addRectify({
      pointId: point.id,
      requirement: buildOrderRequirement(order),
      unit: point.maintainUnit || '待指派责任单位',
      deadline: addDays(todayStr(), 30),
      recheckDate: '',
      status: '待整改',
      sourceOrderId: order.id,
      externalSlope: order.slope,
      externalClearWidth: order.clearWidth,
    });
    rectifyId = plan.id;
  }

  const next = toPlain({
    ...order,
    status: '已认领' as const,
    pointId: point.id,
    claimMode: mode,
    claimedAt: nowIso,
    claimedBy: operator,
    rectifyId,
    matchNote: outcome.note,
  });
  await db.complaints.put(next);
  return next;
}

export const useComplaintStore = create<ComplaintState>((set, get) => ({
  orders: [],
  loaded: false,
  loading: false,
  error: '',

  load: async () => {
    set({ loading: true, error: '' });
    try {
      const rows = await db.complaints.toArray();
      set({
        orders: rows.sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1)),
        loading: false,
        loaded: true,
      });
    } catch (e) {
      set({ loading: false, loaded: true, error: e instanceof Error ? e.message : String(e) });
    }
  },

  addOrder: async (draft) => {
    const nowIso = new Date().toISOString();
    const order: ComplaintOrder = toPlain({
      ...draft,
      id: makeId('cmp'),
      status: '待认领',
      pointId: '',
      claimMode: null,
      claimedAt: '',
      claimedBy: '',
      rectifyId: '',
      matchNote: '',
      createdAt: nowIso,
    });
    const { points } = usePointStore.getState();
    const outcome = matchOrder(order.road, order.facilityText, order.content, points);
    const saved = await applyOutcome(order, outcome, 'auto', '系统自动对账');
    set((s) => ({ orders: [saved, ...s.orders] }));
    return saved;
  },

  claimOrder: async (orderId, pointId, operator) => {
    const order = get().orders.find((o) => o.id === orderId);
    if (!order) return;
    const point = usePointStore.getState().points.find((p) => p.id === pointId);
    if (!point) throw new Error('未找到要认领的点位');
    const note = `督导员 ${operator || '匿名'} 人工认领：${point.code} ${point.name}`;
    const forced: MatchOutcome = {
      kind: 'unique',
      point,
      candidates: [{ point, score: -1, roadHit: order.road, typeHit: point.facilityType }],
      note,
    };
    const saved = await applyOutcome({ ...order, matchNote: note }, forced, 'manual', operator);
    set((s) => ({ orders: s.orders.map((o) => (o.id === orderId ? saved : o)) }));
  },

  revalidatePending: async () => {
    const { points } = usePointStore.getState();
    const pending = get().orders.filter((o) => o.status === '待认领');
    if (!pending.length) return;
    const updated: ComplaintOrder[] = [];
    for (const order of pending) {
      const outcome = matchOrder(order.road, order.facilityText, order.content, points);
      // eslint-disable-next-line no-await-in-loop
      const saved = await applyOutcome(order, outcome, 'auto', '系统自动对账');
      updated.push(saved);
    }
    set((s) => {
      const map = new Map(updated.map((o) => [o.id, o]));
      return { orders: s.orders.map((o) => map.get(o.id) ?? o) };
    });
  },
}));
