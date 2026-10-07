import type { AccessPoint } from '../types/point';
import type { ComplaintOrder, ReconcileMatch } from '../types/order';

/** 无意义的位置修饰词（门牌、方位角、层级等），归一化时整体剔除 */
const NOISE_TOKENS = [
  '人行横道',
  '人行道',
  '辅道',
  '辅路',
  '十字路口',
  '交叉口',
  '路口',
  '东南角',
  '西南角',
  '东北角',
  '西北角',
  '东南角',
  '门前',
  '门口',
  '地面层',
  '地上',
  '地下',
  '政务大厅',
  '一层',
  '二层',
  '三层',
];

/** 道路通用后缀 */
const ROAD_SUFFIX = ['大街', '大道', '步行街', '街', '路'];
/** 可在专名末尾出现的方位词 */
const DIRECTION_CHARS = ['东', '西', '南', '北', '中'];
/** 区段词 */
const SECTION_CHARS = ['段'];

/**
 * 道路文本归一化：去空格标点门牌数字、剔除位置噪声词，保留路名本体。
 * 工单来自热线口语（「东单北大街路口坡道」），点位是登记口径
 * （「东单北大街与灯市口大街交叉口东南角」），两边都归一化后再做包含比对。
 */
export function normalizeRoad(text: string): string {
  if (!text) return '';
  let s = String(text)
    .replace(/[0-9０-９]+(号|栋|幢|层|期|区|m|米|号院)?/g, '')
    .replace(/\s+/g, '')
    .replace(/[，。、,.（）()【】\[\]《》<>—\-_~～:：;；]/g, '');
  for (const token of NOISE_TOKENS) {
    s = s.split(token).join('');
  }
  // 「A 与 B」「A/B」这类交叉口表述，保留「与」作为分隔，匹配时按片段拆开
  return s;
}

/**
 * 抽取道路专名候选（多种长度），覆盖口语省略：
 * 「莲花池东路」→ 莲花池东路 / 莲花池东 / 莲花池；「王府井大街南段」→ 王府井大街南 / 王府井大街 / 王府井
 */
function roadKeys(text: string): string[] {
  const norm = normalizeRoad(text);
  if (!norm) return [];
  // 交叉口表述按「与」拆成多段
  const segments = norm.split('与').filter(Boolean);
  const keys = new Set<string>();
  for (let seg of segments) {
    // 去掉区段词及其后的内容：xx大街南段 → xx大街南
    for (const sc of SECTION_CHARS) {
      const idx = seg.indexOf(sc);
      if (idx >= 0) seg = seg.slice(0, Math.max(0, idx));
    }
    if (!seg) continue;
    keys.add(seg);
    // 剥道路后缀后保留专名（含/不含末尾方位词两个版本）
    let core = seg;
    for (const suffix of ROAD_SUFFIX) {
      if (core.length > suffix.length && core.endsWith(suffix)) {
        core = core.slice(0, core.length - suffix.length);
        break;
      }
    }
    if (core && core !== seg) {
      keys.add(core);
      if (DIRECTION_CHARS.includes(core[core.length - 1]) && core.length > 2) {
        keys.add(core.slice(0, -1));
      }
    }
  }
  return [...keys].filter((k) => k.length >= 2);
}

/** 单工单 × 单点匹配：设施类型相同，且道路专名在任一侧互相包含 */
export function pointMatchesOrder(
  point: AccessPoint,
  order: Pick<ComplaintOrder, 'road' | 'facilityType'>,
): boolean {
  if (point.facilityType !== order.facilityType) return false;
  const orderKeys = roadKeys(order.road);
  if (!orderKeys.length) return false;
  const haystacks = [
    ...roadKeys(point.location),
    normalizeRoad(point.location),
    normalizeRoad(point.name),
  ].filter(Boolean);
  if (!haystacks.length) return false;
  return orderKeys.some((ok) => haystacks.some((h) => h.includes(ok) || ok.includes(h)));
}

/**
 * 工单对账：按道路 + 设施类型给待认领工单挑候选点位。
 * - 恰好 1 个候选 → unique（自动开单）
 * - 0 个 → none（待认领，无命中）
 * - 多个 → multiple（待认领，多处命中；同一设施挂两个点走这里）
 */
export function matchOrder(order: ComplaintOrder, points: AccessPoint[]): ReconcileMatch {
  const candidates = points
    .filter((p) => pointMatchesOrder(p, order))
    .map((p) => ({ pointId: p.id, matchedRoad: p.location || p.name }));
  const kind = candidates.length === 0 ? 'none' : candidates.length === 1 ? 'unique' : 'multiple';
  return {
    orderId: order.id,
    candidates,
    kind,
    reason: kind === 'none' ? '无命中' : kind === 'multiple' ? '多处命中' : null,
  };
}

/** 批量对账（只算待认领工单；已认领的保留督导员决定，不被自动改挂） */
export function matchOrders(orders: ComplaintOrder[], points: AccessPoint[]): Map<string, ReconcileMatch> {
  const map = new Map<string, ReconcileMatch>();
  for (const order of orders) {
    if (order.status !== '待认领') continue;
    map.set(order.id, matchOrder(order, points));
  }
  return map;
}
