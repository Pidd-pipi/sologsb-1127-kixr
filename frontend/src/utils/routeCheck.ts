import type { Inspection, InspectionConclusion, OccupiedLevel } from '../types/inspection';
import type { RouteSegment, RouteVerdict } from '../types/route';

/** 阈值常量：依据《无障碍设计规范》常用核验口径 */
export const SLOPE_PASS = 5; // 坡度 ≤ 5% 为合格
export const SLOPE_FAIL = 8; // 坡度 > 8% 直接不合格
export const WIDTH_PASS = 120; // 净宽 ≥ 120cm 为合格
export const WIDTH_MIN = 90; // 净宽 < 90cm 不合格
export const CURB_PASS = 3; // 路缘高差 ≤ 3cm 可轮椅通行
export const CURB_FAIL = 6; // 路缘高差 > 6cm 判定不可通行

export interface JudgeInput {
  slope: number;
  clearWidth: number;
  hasHandrail: boolean;
  tactileContinuous: boolean;
  occupied: OccupiedLevel;
}

export interface JudgeResult {
  conclusion: InspectionConclusion;
  reasons: string[];
}

/** 按实测值给出结论建议 */
export function judgeInspection(input: JudgeInput): JudgeResult {
  const reasons: string[] = [];
  const slope = Number(input.slope) || 0;
  const clearWidth = Number(input.clearWidth) || 0;

  if (slope > SLOPE_FAIL) reasons.push(`坡度 ${slope}% 超过 ${SLOPE_FAIL}% 上限`);
  if (clearWidth < WIDTH_MIN) reasons.push(`净宽 ${clearWidth}cm 小于 ${WIDTH_MIN}cm 下限`);
  if (input.occupied === '长期占用') reasons.push('设施被长期占用，无法正常使用');
  if (reasons.length) return { conclusion: '不合格', reasons };

  const warns: string[] = [];
  if (slope > SLOPE_PASS) warns.push(`坡度 ${slope}% 超过 ${SLOPE_PASS}% 推荐值`);
  if (clearWidth < WIDTH_PASS) warns.push(`净宽 ${clearWidth}cm 小于 ${WIDTH_PASS}cm 推荐值`);
  if (!input.hasHandrail) warns.push('未设置扶手');
  if (!input.tactileContinuous) warns.push('盲道不连续');
  if (input.occupied === '临时占用') warns.push('设施被临时占用');
  if (warns.length) return { conclusion: '限期整改', reasons: warns };

  return { conclusion: '合格', reasons: ['坡度、净宽均满足推荐值，扶手与盲道完好'] };
}

/** 已落库的核验记录（可能带有历史结论）复判 */
export function rejudge(inspection: Inspection): JudgeResult {
  return judgeInspection({
    slope: inspection.slope,
    clearWidth: inspection.clearWidth,
    hasHandrail: inspection.hasHandrail,
    tactileContinuous: inspection.tactileContinuous,
    occupied: inspection.occupied,
  });
}

/** 单段可轮椅通行判定 */
export function judgeSegment(seg: Pick<RouteSegment, 'curbHeight' | 'stepCount' | 'obstacleCount'>): {
  passable: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  const curb = Number(seg.curbHeight) || 0;
  const steps = Number(seg.stepCount) || 0;
  const obstacles = Number(seg.obstacleCount) || 0;
  if (curb > CURB_FAIL) reasons.push(`路缘高差 ${curb}cm 超过 ${CURB_FAIL}cm，轮椅无法越障`);
  if (steps > 0) reasons.push(`存在 ${steps} 级台阶，需绕行或增设坡道`);
  if (obstacles > 2) reasons.push(`沿途障碍 ${obstacles} 处，通行风险偏高`);
  return { passable: reasons.length === 0, reasons };
}

/** 全线判定：逐段判定后汇总；端点点位最新核验结论即时参与判定 */
export interface VerdictPointContext {
  /** 点位 id → 名称 */
  nameOf?: (id: string) => string;
  /** 点位 id → 最新核验结论（点位核验一变，路线判定立即重算） */
  latestConclusionOf?: (id: string) => Inspection['conclusion'] | undefined;
}

export function buildVerdict(
  routeName: string,
  segments: Pick<
    RouteSegment,
    'curbHeight' | 'stepCount' | 'obstacleCount' | 'length' | 'order' | 'fromPointId' | 'toPointId'
  >[],
  context: VerdictPointContext = {},
): RouteVerdict {
  const ordered = [...segments].sort((a, b) => a.order - b.order);
  const totalLength = Math.round(ordered.reduce((n, s) => n + (Number(s.length) || 0), 0) * 10) / 10;
  const totalObstacles = ordered.reduce((n, s) => n + (Number(s.obstacleCount) || 0), 0);
  const totalSteps = ordered.reduce((n, s) => n + (Number(s.stepCount) || 0), 0);
  const maxCurbHeight = ordered.reduce((n, s) => Math.max(n, Number(s.curbHeight) || 0), 0);
  const reasons: string[] = [];
  const warnings: string[] = [];
  ordered.forEach((s) => {
    const r = judgeSegment(s);
    if (!r.passable) {
      reasons.push(`第 ${s.order} 段：${r.reasons.join('；')}`);
    }
  });

  // 端点（含起终点、途经点）最新核验即时并入：不合格即阻断，限期整改/未核验给提示
  const latestConclusionOf = context.latestConclusionOf;
  if (latestConclusionOf) {
    const endpointIds = Array.from(new Set(ordered.flatMap((s) => [s.fromPointId, s.toPointId])));
    endpointIds.forEach((pid) => {
      const label = context.nameOf ? context.nameOf(pid) : pid;
      const conclusion = latestConclusionOf(pid);
      if (conclusion === '不合格') {
        reasons.push(`点位「${label}」最新核验为不合格，途经设施无法通行`);
      } else if (conclusion === '限期整改') {
        warnings.push(`点位「${label}」最新核验为限期整改，通行条件可能变化`);
      } else if (!conclusion) {
        warnings.push(`点位「${label}」尚无核验记录，建议补核后再发布路线`);
      }
    });
  }

  return {
    routeName,
    passable: reasons.length === 0 && ordered.length > 0,
    totalLength,
    totalObstacles,
    totalSteps,
    maxCurbHeight,
    reasons: ordered.length === 0 ? ['尚未串联路段'] : reasons,
    warnings,
  };
}
