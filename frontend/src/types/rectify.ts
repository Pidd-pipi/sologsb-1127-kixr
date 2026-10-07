/** 整改状态 */
export type RectifyStatus = '待整改' | '已整改' | '复发';

export const RECTIFY_STATUSES: RectifyStatus[] = ['待整改', '已整改', '复发'];

/** 整改条目来源：核验自动生成 / 手工生成 / 12345 热线工单 */
export type RectifySource = '核验' | '手工' | '热线工单';

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
  /** 条目来源，v4 起补充，历史数据默认「核验」 */
  source: RectifySource;
  /** 来源工单 id（source 为热线工单时有值） */
  orderId: string;
  createdAt: string;
}

export type RectifyPlanDraft = Omit<
  RectifyPlan,
  'id' | 'createdAt' | 'source' | 'orderId'
> &
  Partial<Pick<RectifyPlan, 'source' | 'orderId'>>;

/** 按状态与期限分组后的清单结构 */
export interface RectifyGroup {
  key: string;
  title: string;
  items: RectifyPlan[];
}
