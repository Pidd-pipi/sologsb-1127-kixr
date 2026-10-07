import type { Inspection } from '../types/inspection';
import type { ComplaintOrder } from '../types/complaint';

/** 外部实测与点位核验的数值比较容差 */
export const SLOPE_TOLERANCE = 0.5; // 坡度相差 0.5 个百分点视为不一致
export const WIDTH_TOLERANCE = 5; // 净宽相差 5cm 视为不一致

/** 单路数值（坡度或净宽）的双源对照结果 */
export interface MeasureDiffItem {
  label: string;
  unit: string;
  /** 工单外部实测 */
  external: number | null;
  /** 点位最新核验 */
  inspected: number | null;
  /** 两路数值是否对不上（任一路缺测不算冲突，只标注来源） */
  conflict: boolean;
}

export interface MeasureCompareResult {
  items: MeasureDiffItem[];
  /** 是否存在双源实测不一致 */
  hasConflict: boolean;
}

function isDiff(a: number | null, b: number | null, tolerance: number): boolean {
  if (a === null || b === null) return false;
  return Math.abs(a - b) > tolerance;
}

/** 取点位最新一次核验（按日期降序的第一条） */
export function latestInspectionOf(inspections: Inspection[], pointId: string): Inspection | undefined {
  return inspections
    .filter((i) => i.pointId === pointId)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))[0];
}

/**
 * 工单外部实测 vs 点位最新核验。
 * 两边都留：任一路有值就展示，并标明来源；不一致时高亮冲突，不以任一方覆盖另一方。
 */
export function compareMeasures(
  external: Pick<ComplaintOrder, 'slope' | 'clearWidth'>,
  latest?: Inspection,
): MeasureCompareResult {
  const inspSlope = latest ? latest.slope : null;
  const inspWidth = latest ? latest.clearWidth : null;
  const slopeConflict = isDiff(external.slope, inspSlope, SLOPE_TOLERANCE);
  const widthConflict = isDiff(external.clearWidth, inspWidth, WIDTH_TOLERANCE);
  const items: MeasureDiffItem[] = [
    {
      label: '坡度',
      unit: '%',
      external: external.slope,
      inspected: inspSlope,
      conflict: slopeConflict,
    },
    {
      label: '净宽',
      unit: 'cm',
      external: external.clearWidth,
      inspected: inspWidth,
      conflict: widthConflict,
    },
  ];
  return { items, hasConflict: slopeConflict || widthConflict };
}
