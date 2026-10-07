/** 通行路线段 */
export interface RouteSegment {
  id: string;
  /** 路线名称，同一条路线的多段共用一个名称 */
  routeName: string;
  fromPointId: string;
  toPointId: string;
  /** 长度 m */
  length: number;
  /** 沿途障碍数 */
  obstacleCount: number;
  /** 台阶数 */
  stepCount: number;
  /** 路缘高差 cm */
  curbHeight: number;
  /** 是否可轮椅通行（由逐段核验判定） */
  wheelchairPassable: boolean;
  /** 在整条路线中的顺序，从 1 开始 */
  order: number;
  createdAt: string;
}

export type RouteSegmentDraft = Omit<RouteSegment, 'id' | 'createdAt' | 'wheelchairPassable'>;

/** 路线端点 / 途经点位的最新核验问题（点位核验一变即随路线判定重算） */
export interface RoutePointIssue {
  pointId: string;
  /** 最新核验结论 */
  conclusion: string;
  date: string;
  reasons: string[];
  /** 不合格阻断通行；限期整改仅作警示 */
  blocking: boolean;
}

/** 全线判定结果 */
export interface RouteVerdict {
  routeName: string;
  passable: boolean;
  totalLength: number;
  totalObstacles: number;
  totalSteps: number;
  maxCurbHeight: number;
  /** 阻断原因：路段判定不达标 或 端点点位核验不合格 */
  reasons: string[];
  /** 警示原因：端点点位最新结论为限期整改（不直接阻断，但提示轮椅使用者） */
  warnings: string[];
  /** 参与判定的点位核验问题明细 */
  pointIssues: RoutePointIssue[];
}
