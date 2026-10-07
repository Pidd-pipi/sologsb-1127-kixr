/**
 * 热线无障碍投诉工单
 * 坡度、净宽等实测值来自热线外部上报；点位核验值以督导员最新一次核验为准。
 * 两路数值不一致时同时保留，并分别标注来源（工单上报 / 点位核验）。
 */

/** 工单来源 */
export type ComplaintSource = '12345热线' | '无障碍投诉专线' | '网格巡查' | '群众来访';

export const COMPLAINT_SOURCES: ComplaintSource[] = ['12345热线', '无障碍投诉专线', '网格巡查', '群众来访'];

/** 工单状态：待认领（自动对账未唯一命中）/ 已认领（已挂到点位，整改条目已开出） */
export type ComplaintStatus = '待认领' | '已认领';

/** 认领方式：自动对账唯一命中 / 督导员人工认领 */
export type ClaimMode = 'auto' | 'manual';

export interface ComplaintOrder {
  id: string;
  /** 热线工单号，例：RX-2025-0312 */
  code: string;
  source: ComplaintSource;
  /** 报修内容原文 */
  content: string;
  /** 投诉反映的道路（或建筑），对账主键之一 */
  road: string;
  /** 投诉反映的设施类型，允许是热线原文措辞（如「坡道」），对账时做同义归一 */
  facilityText: string;
  /** 外部实测：坡度 %，未提供为 null */
  slope: number | null;
  /** 外部实测：净宽 cm，未提供为 null */
  clearWidth: number | null;
  /** 投诉人联系电话，可空 */
  contact: string;
  /** 来件日期 YYYY-MM-DD */
  receivedAt: string;
  status: ComplaintStatus;
  /** 认领（挂接）的点位 id；待认领时为空字符串 */
  pointId: string;
  /** 自动对账 / 人工认领 */
  claimMode: ClaimMode | null;
  /** 认领时间 ISO；自动对账在新增或重新比对命中时写入 */
  claimedAt: string;
  /** 认领操作人（人工认领时取督导员署名） */
  claimedBy: string;
  /** 由此工单开出的整改条目 id */
  rectifyId: string;
  /** 最近一次自动对账的说明（命中条件 / 未命中原因 / 多命中点位），供督导员判断 */
  matchNote: string;
  createdAt: string;
}

export type ComplaintOrderDraft = Omit<
  ComplaintOrder,
  'id' | 'status' | 'pointId' | 'claimMode' | 'claimedAt' | 'claimedBy' | 'rectifyId' | 'matchNote' | 'createdAt'
>;
