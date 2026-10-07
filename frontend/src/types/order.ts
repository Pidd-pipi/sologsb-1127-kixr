import type { FacilityType } from './point';

/** 工单状态：自动对账结果 + 督导员认领流转 */
export type OrderStatus = '待认领' | '已开单' | '已关闭';

export const ORDER_STATUSES: OrderStatus[] = ['待认领', '已开单', '已关闭'];

/** 待认领原因：对不上点位 / 对上多处点位 */
export type UnmatchedReason = '无命中' | '多处命中';

/** 认领方式：唯一命中自动开单；督导员确认开单 */
export type MatchMethod = '自动' | '人工确认';

/** 数据来源标识（实测值对撞时用） */
export const SOURCE_ORDER = '热线工单（外部实测）' as const;
export const SOURCE_INSPECTION = '点位最新核验' as const;

/** 12345 热线转办的无障碍投诉工单 */
export interface ComplaintOrder {
  id: string;
  /** 工单编号，例：12345-2025-1102 */
  code: string;
  /** 热线受理日期 YYYY-MM-DD */
  receivedAt: string;
  /** 投诉人/来电描述 */
  reporter: string;
  /** 投诉文本中提到的道路或位置 */
  road: string;
  /** 投诉的设施类型（热线归类） */
  facilityType: FacilityType;
  /** 投诉内容摘要 */
  content: string;
  /** 外部实测：坡度 %（热线现场测量，可能为空） */
  slope: number | null;
  /** 外部实测：净宽 cm（热线现场测量，可能为空） */
  clearWidth: number | null;
  /** 对账状态 */
  status: OrderStatus;
  /** 已开单/认领后挂到的点位 id；待认领时为空 */
  pointId: string;
  /** 命中点位方式（自动唯一命中或人工确认） */
  matchMethod: MatchMethod | null;
  /** 由该工单开出的整改条目 id（便于联动重算） */
  rectifyId: string;
  /** 督导员认领备注 */
  claimNote: string;
  createdAt: string;
  updatedAt: string;
}

export type ComplaintOrderDraft = Omit<
  ComplaintOrder,
  'id' | 'status' | 'pointId' | 'matchMethod' | 'rectifyId' | 'claimNote' | 'createdAt' | 'updatedAt'
>;

/** 单个点位的对账命中情况 */
export interface OrderCandidate {
  pointId: string;
  /** 命中的道路关键词（用于向督导员解释为什么命中） */
  matchedRoad: string;
}

/** 一次对账比对结果（纯派生数据，不落库，点位或核验一变即重算） */
export interface ReconcileMatch {
  orderId: string;
  candidates: OrderCandidate[];
  /** 0 处命中：无命中；1 处：唯一命中；>1：多处命中 */
  kind: 'none' | 'unique' | 'multiple';
  reason: UnmatchedReason | null;
}
