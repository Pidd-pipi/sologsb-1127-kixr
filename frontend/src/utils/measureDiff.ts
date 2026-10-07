import type { ComplaintOrder } from '../types/order';
import type { Inspection } from '../types/inspection';
import { SOURCE_INSPECTION, SOURCE_ORDER } from '../types/order';

/** 单项实测值对撞结果（两边都留，差异用来源标清） */
export interface MeasureConflict {
  field: 'slope' | 'clearWidth';
  label: string;
  unit: string;
  /** 工单外部实测 */
  orderValue: number | null;
  /** 点位最新核验实测 */
  inspectionValue: number | null;
  inspectionDate: string;
  /** 是否对不上 */
  conflict: boolean;
  /** 两边值差异量 */
  delta: number | null;
}

export interface OrderMeasureDiff {
  slope: MeasureConflict;
  clearWidth: MeasureConflict;
  /** 最新核验不存在（点位还没核验过） */
  noInspection: boolean;
  /** 是否存在任何对不上的项 */
  hasConflict: boolean;
}

const FIELD_META = [
  { field: 'slope' as const, label: '坡度', unit: '%' },
  { field: 'clearWidth' as const, label: '净宽', unit: 'cm' },
];

/**
 * 工单实测（外部来源）对撞点位最新核验：
 * 任一侧缺值都不算冲突（无值可比）；两边都有且数值不一致即对不上，
 * 此时两边的值都保留下来，由调用方分别标注来源。
 */
export function diffOrderWithInspection(
  order: Pick<ComplaintOrder, 'slope' | 'clearWidth'>,
  latest: Inspection | undefined,
): OrderMeasureDiff {
  const build = (meta: (typeof FIELD_META)[number]): MeasureConflict => {
    const orderValue = order[meta.field];
    const inspectionValue = latest ? latest[meta.field] : null;
    const both = orderValue !== null && orderValue !== undefined && inspectionValue !== null;
    const conflict = both ? Number(orderValue) !== Number(inspectionValue) : false;
    return {
      field: meta.field,
      label: meta.label,
      unit: meta.unit,
      orderValue: orderValue ?? null,
      inspectionValue: inspectionValue ?? null,
      inspectionDate: latest?.date ?? '',
      conflict,
      delta: both ? Math.round((Number(orderValue) - Number(inspectionValue)) * 10) / 10 : null,
    };
  };
  const slope = build(FIELD_META[0]);
  const clearWidth = build(FIELD_META[1]);
  return {
    slope,
    clearWidth,
    noInspection: !latest,
    hasConflict: slope.conflict || clearWidth.conflict,
  };
}

export { SOURCE_ORDER, SOURCE_INSPECTION };
