/** 整改状态 */
export type RectifyStatus = '待整改' | '已整改' | '复发';

export const RECTIFY_STATUSES: RectifyStatus[] = ['待整改', '已整改', '复发'];

/** 整改跟踪条目 */
export interface RectifyPlan {
  id: string;
  pointId: string;
  /** 整改要求 */
  requirement: string;
  /** 责任单位 */
  unit: string;
  /** 整改期限 YYYY-MM-DD */
  deadline: string;
  /** 复检日期 YYYY-MM-DD，未复检为空字符串 */
  recheckDate: string;
  status: RectifyStatus;
  /** 来源：热线工单自动/人工开出时记录工单 id；核验结论自动生成时为空 */
  sourceOrderId?: string;
  /** 外部实测快照：坡度 %（来自热线工单，未提供为 null） */
  externalSlope?: number | null;
  /** 外部实测快照：净宽 cm（来自热线工单，未提供为 null） */
  externalClearWidth?: number | null;
  createdAt: string;
}

export type RectifyPlanDraft = Omit<RectifyPlan, 'id' | 'createdAt'>;

/** 按状态与期限分组后的清单结构 */
export interface RectifyGroup {
  key: string;
  title: string;
  items: RectifyPlan[];
}
