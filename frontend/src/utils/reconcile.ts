import type { FacilityType } from '../types/point';
import type { AccessPoint } from '../types/point';

/** 候选点位与工单的匹配评分及命中依据 */
export interface MatchCandidate {
  point: AccessPoint;
  score: number;
  /** 命中的道路词，如 中关村大街 */
  roadHit: string;
  /** 归一后对上的设施类型 */
  typeHit: FacilityType | string;
}

export type MatchOutcomeKind = 'unique' | 'ambiguous' | 'none';

export interface MatchOutcome {
  kind: MatchOutcomeKind;
  /** unique 时的唯一点位 */
  point?: AccessPoint;
  /** ambiguous / none 时按评分降序给出的候选（供督导员人工认领） */
  candidates: MatchCandidate[];
  /** 给督导员看的对账说明 */
  note: string;
}

/** 热线原文措辞 → 标准设施类型（同一处设施常被热线写成不同说法） */
const TYPE_ALIASES: Record<string, string> = {
  坡道: '坡道类',
  轮椅坡道: '轮椅坡道',
  缘石坡道: '缘石坡道',
  无障碍坡道: '轮椅坡道',
  轮椅坡: '轮椅坡道',
  路缘坡: '缘石坡道',
  斜坡: '坡道类',
  盲道: '盲道',
  触感铺地: '盲道',
  无障碍电梯: '无障碍电梯',
  直梯: '无障碍电梯',
  升降电梯: '无障碍电梯',
  电梯: '无障碍电梯',
  无障碍卫生间: '无障碍卫生间',
  无障碍厕所: '无障碍卫生间',
  无障碍洗手间: '无障碍卫生间',
  无障碍厕位: '无障碍卫生间',
  低位服务台: '低位服务台',
  低位窗口: '低位服务台',
  服务台: '低位服务台',
};

/** 去掉「北京市/区/交叉口/门前」等后缀与标点，便于做道路子串比对 */
function normalizeRoad(text: string): string {
  return (text || '')
    .replace(/北京市?/g, '')
    .replace(/[东城区西城区朝阳区海淀区丰台区石景山区]/g, '')
    .replace(/[\s,，。、（）()号院?\d]+/g, '');
}

/** 从工单道路/报修原文中抽出主干路名（取最长的一个「xx大街/路/街/道」片段） */
export function extractRoadKey(road: string, content = ''): string {
  const text = `${road} ${content}`;
  const rawHits = text.match(/[一-龥]{2,12}?(?:大街|大道|辅路|路|街|道)/g) ?? [];
  // 报修正文里的设施词也以「道」结尾（如 缘石坡道/盲道），不是路名，剔除
  const facilityWords = /盲道|坡道|缘石|斜坡|通道/;
  const hits = rawHits
    .map((h) => h.replace(/^(?:北京市)?(?:东城区|西城区|朝阳区|海淀区|丰台区|石景山区)?/, ''))
    .filter((h) => !facilityWords.test(h));
  if (!hits.length) return normalizeRoad(road);
  // 同长时优先标准道路后缀，避免选到「门口路」这类误命中
  return hits.sort((a, b) => {
    if (b.length !== a.length) return b.length - a.length;
    const proper = /(大街|大道|辅路|路|街)$/;
    return Number(proper.test(b)) - Number(proper.test(a));
  })[0];
}

/** 归一设施类型：返回标准类型或「坡道类」这种需要在坡道亚型间兜底的类别 */
export function normalizeFacility(text: string): string {
  const t = (text || '').trim();
  if (TYPE_ALIASES[t]) return TYPE_ALIASES[t];
  // 直接包含关键词的情况，如「路口坡道太陡」
  if (t.includes('盲道')) return '盲道';
  if (t.includes('电梯') || t.includes('直梯')) return '无障碍电梯';
  if (t.includes('卫生间') || t.includes('厕所') || t.includes('洗手间')) return '无障碍卫生间';
  if (t.includes('服务台') || t.includes('窗口')) return '低位服务台';
  if (t.includes('缘石') || t.includes('路缘')) return '缘石坡道';
  if (t.includes('坡道') || t.includes('坡') || t.includes('斜坡')) return '坡道类';
  return t;
}

/** 两个归一类型是否兼容；坡道类与缘石坡道、轮椅坡道互通 */
function typeCompatible(a: string, b: string): boolean {
  if (a === b) return true;
  const rampTypes = new Set(['坡道类', '缘石坡道', '轮椅坡道']);
  return rampTypes.has(a) && rampTypes.has(b);
}

/**
 * 按「道路 + 设施类型」对点位。
 * 道路：工单主干路名是点位名称或所在道路的子串（或反向包含）才算命中；
 * 类型：热线措辞先同义归一，再判断兼容。
 * 两条同时满足才进候选；按命中质量评分，唯一点位直接开整改，零/多命中转待认领。
 */
export function matchOrder(
  road: string,
  facilityText: string,
  content: string,
  points: AccessPoint[],
): MatchOutcome {
  const roadKey = extractRoadKey(road, content);
  const wantType = normalizeFacility(facilityText);
  const roadKeyNorm = normalizeRoad(roadKey);

  const candidates: MatchCandidate[] = [];
  for (const p of points) {
    const hay = normalizeRoad(`${p.name} ${p.location}`);
    let roadHit = '';
    let score = 0;
    if (roadKeyNorm && (hay.includes(roadKeyNorm) || roadKeyNorm.includes(hay))) {
      roadHit = roadKey;
      score += 10;
      // 所在道路字段直接出现，比只在名称中出现更可信
      if (normalizeRoad(p.location).includes(roadKeyNorm)) score += 4;
      if (p.name.includes(roadKeyNorm)) score += 2;
    }
    if (!roadHit) continue;

    if (!typeCompatible(wantType, p.facilityType)) continue;
    score += wantType === p.facilityType ? 8 : 5; // 精确类型高于坡道亚型兜底

    candidates.push({ point: p, score, roadHit, typeHit: p.facilityType });
  }

  candidates.sort((a, b) => b.score - a.score || a.point.code.localeCompare(b.point.code));

  if (candidates.length === 0) {
    return {
      kind: 'none',
      candidates,
      note: `按道路「${roadKey || road}」+ 设施「${facilityText}」未对到任何点位，待督导员人工认领或先补登点位`,
    };
  }
  if (candidates.length === 1) {
    return {
      kind: 'unique',
      point: candidates[0].point,
      candidates,
      note: `唯一命中：${candidates[0].point.code} ${candidates[0].point.name}（道路 ${candidates[0].roadHit}、类型 ${candidates[0].typeHit}）`,
    };
  }
  const top = candidates[0];
  const tied = candidates.filter((c) => c.score === top.score);
  if (tied.length === 1) {
    // 最高分唯一（可能是同一处设施被登记了两次，评分已用「所在道路命中」加权拉开）
    return {
      kind: 'unique',
      point: top.point,
      candidates,
      note: `唯一高匹配：${top.point.code} ${top.point.name}（道路 ${top.roadHit}、类型 ${top.typeHit}）`,
    };
  }
  return {
    kind: 'ambiguous',
    candidates,
    note: `道路「${top.roadHit}」上有 ${tied.length} 处${top.typeHit}点位同分（${tied
      .map((c) => c.point.code)
      .join('、')}），疑似同一处设施挂到两个点，请督导员确认`,
  };
}
