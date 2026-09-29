/**
 * 1/12 セクション（0°〜30° の扇形）を生成する。
 *
 * - 0° 軸：主枝が乗る鏡映軸
 * - 30° 線：隣の 1/6 セクションとの境界
 *
 * 小枝・二次枝・プレートは、先端が境界から BOUNDARY_MARGIN 以内に収まるよう幾何的に大きさを制限する。
 * これにより鏡映・回転した際に隣接セクションと重ならない。
 * 例外として中央の六角形と ring（輪）は、30° 線上で隣のセクションと意図的に接続する。
 */
import { add, angleOf, DEG, length as lengthOf, polar, scale, type Point, type Stroke } from "./geometry";
import type { BranchParams, SnowflakeParameters } from "./params";

export const SECTION_ANGLE = 30;
/** 境界（30°）との最小角度差 */
export const BOUNDARY_MARGIN = 4;
/** 二次枝が鏡映軸（0°）へ近づける限界 */
const AXIS_MARGIN = 1.5;
/** 外径に対して枝先が届いてよい割合 */
const OUTER_LIMIT = 0.97;
/** 境界ぎりぎりまで伸ばさないための安全率 */
const SAFETY = 0.96;
/**
 * 細かすぎる要素を出さないための下限（半径に対する比）。
 * 小さな線や小さな六角形が密集すると、集合体のように見えて落ち着かないため。
 */
const MIN_TWIG_RATIO = 0.05;
const MIN_PLATE_RATIO = 0.035;
/** 枝先の六角プレートを付ける小枝の数（外側から数える） */
const MAX_BRANCH_PLATES = 1;

const PHI_MAX = SECTION_ANGLE - BOUNDARY_MARGIN;
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;

/**
 * 点 p から角度 dirDeg に伸ばしたとき、扇形 [phiMin, phiMax] と半径 rMax の内側に留まれる最大長。
 */
export function maxLengthInWedge(
  p: Point,
  dirDeg: number,
  rMax: number,
  phiMin = AXIS_MARGIN,
  phiMax = PHI_MAX,
): number {
  const d = polar(1, dirDeg);
  let limit = Infinity;

  for (const phi of [phiMin, phiMax]) {
    const u = polar(1, phi);
    const denom = cross(u, d);
    if (Math.abs(denom) < 1e-9) continue;
    const t = -cross(u, p) / denom;
    if (t > 0 && dot(add(p, scale(d, t)), u) > 0) limit = Math.min(limit, t);
  }

  // |p + t d| = rMax
  const b = dot(p, d);
  const c = dot(p, p) - rMax * rMax;
  const disc = b * b - c;
  if (disc > 0) limit = Math.min(limit, -b + Math.sqrt(disc));

  return Math.max(0, limit);
}

/** すべての点が扇形（0°〜PHI_MAX、半径 rMax 以内）に収まるか */
const fitsWedge = (points: Point[], rMax: number) =>
  points.every((p) => lengthOf(p) <= rMax && angleOf(p) >= -1e-9 && angleOf(p) <= PHI_MAX);

/** 収まるまで size を縮める。収まらなければ 0 */
function shrinkToFit(size: number, build: (size: number) => Point[], rMax: number): number {
  let s = size;
  for (let i = 0; i < 12; i++) {
    if (fitsWedge(build(s), rMax)) return s;
    s *= 0.85;
  }
  return 0;
}

const perimeter = (points: Point[]) =>
  points.reduce((sum, p, i) => (i === 0 ? 0 : sum + Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y)), 0);

interface ResolvedBranch {
  params: BranchParams;
  base: Point;
  d: number;
  length: number;
}

/** 小枝の長さを確定する。総延長が density の範囲に入るよう全体をスケールする */
function resolveBranches(p: SnowflakeParameters): ResolvedBranch[] {
  const R = p.radius;
  const items = p.branches.map((params) => {
    const d = params.t * R;
    const base = { x: d, y: 0 };
    const desired = params.lengthFactor * R;
    // 付け根は 0° 軸上にあるので、軸側の制限は掛けない
    const max = maxLengthInWedge(base, params.angle, R * OUTER_LIMIT, -90) * SAFETY;
    return { params, base, d, desired, max };
  });

  const total = (k: number) =>
    items.reduce((sum, it) => sum + (it.params.isTip ? 0 : Math.min(it.desired * k, it.max)), 0) / R;

  // 密度ガード：スカスカ・過密を避ける（二分探索でスケールを決める）
  let k = 1;
  const { min, max } = p.density;
  if (total(1) < min || total(1) > max) {
    const target = total(1) < min ? min : max;
    let lo = 0.5;
    let hi = 1.8;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (total(mid) < target) lo = mid;
      else hi = mid;
    }
    k = (lo + hi) / 2;
  }

  return items.map((it) => ({
    params: it.params,
    base: it.base,
    d: it.d,
    length: it.params.isTip ? Math.min(it.desired, it.max) : Math.min(it.desired * k, it.max),
  }));
}

export function generateSection(p: SnowflakeParameters): Stroke[] {
  const R = p.radius;
  const rMax = R * OUTER_LIMIT;
  const MIN_TWIG = R * MIN_TWIG_RATIO;
  const MIN_PLATE = R * MIN_PLATE_RATIO;
  const { core, traits } = p;
  const strokes: Stroke[] = [];

  // --- 中央部 --------------------------------------------------------------
  // 六角形の頂点(0°)から辺の中点(30°)まで。鏡映で1辺、回転で六角形になる。
  const halfEdge = (r: number): Point[] => [polar(r, 0), polar(r * Math.cos(30 * DEG), 30)];
  const coreStroke = (points: Point[]): Stroke => ({
    points,
    width: p.lineWidth,
    kind: "core",
    growth: { start: 0, end: perimeter(points) },
  });

  strokes.push(coreStroke(halfEdge(core.radius)));
  if (core.style === "double") strokes.push(coreStroke(halfEdge(core.radius * core.innerRatio)));
  if (core.style === "star") strokes.push(coreStroke([polar(core.radius, 0), polar(core.radius * core.innerRatio, 30)]));
  const coreEnd = Math.max(...strokes.map((s) => s.growth.end));
  if (core.filled) {
    strokes.push({
      points: [{ x: 0, y: 0 }, ...halfEdge(core.radius)],
      width: 0,
      kind: "plate",
      fill: true,
      growth: { start: coreEnd, end: coreEnd },
    });
  }

  // 主枝上の距離 d に成長の前線が届くまでの距離
  const growthAt = (d: number) => (p.armStart > 0 ? coreEnd : 0) + (d - p.armStart);

  // --- 主枝の扇形プレート ---------------------------------------------------
  if (traits.armBody === "sector") {
    const d0 = p.sectorPlate.from * R;
    const d1 = Math.min(p.sectorPlate.to * R, R * 0.8);
    const tan60 = Math.tan(60 * DEG);
    const outline = (h: number): Point[] => [
      { x: d0, y: 0 },
      { x: d0 + h / tan60, y: h },
      { x: d1 - h / tan60, y: h },
      { x: d1, y: 0 },
    ];
    const h = shrinkToFit(Math.min(p.sectorPlate.height * R, ((d1 - d0) * tan60) / 2.2), outline, rMax);
    if (h >= MIN_PLATE) {
      const points = outline(h);
      strokes.push(
        { points, width: p.lineWidth, kind: "edge", growth: { start: growthAt(d0), end: growthAt(d1) } },
        { points, width: 0, kind: "plate", fill: true, growth: { start: growthAt(d1), end: growthAt(d1) } },
      );
    }
  }

  // --- 主枝先端の六角プレート -----------------------------------------------
  if (traits.armTip === "plate") {
    // 中心を主枝上に置いた六角形の上半分（鏡映で全体になる）
    const halfHex = (h: number): Point[] => [180, 120, 60, 0].map((a) => add({ x: R - h, y: 0 }, polar(h, a)));
    const h = shrinkToFit(p.armTipPlate * R, halfHex, R + 1e-6);
    if (h >= MIN_PLATE) {
      const points = halfHex(h);
      const start = growthAt(R - 2 * h);
      strokes.push(
        { points, width: p.lineWidth, kind: "edge", growth: { start, end: start + perimeter(points) } },
        { points, width: 0, kind: "plate", fill: true, growth: { start: start + perimeter(points), end: start + perimeter(points) } },
      );
    }
  }

  // --- 小枝・二次枝・枝先の装飾 ---------------------------------------------
  const branches = resolveBranches(p).sort((a, b) => a.d - b.d);
  const regular = branches.filter((b) => !b.params.isTip);
  // 枝先の六角プレート：枝先を頂点とし、枝が六角形の中心を通る（枝先の外側へははみ出さない）
  const branchPlate = (br: ResolvedBranch): { points: Point[]; h: number } | null => {
    const dir = br.params.angle;
    const tip = add(br.base, polar(br.length, dir));
    const hexAt = (h: number): Point[] =>
      [180, 240, 300, 0, 60, 120, 180].map((a) => add(add(tip, polar(-h, dir)), polar(h, dir + a)));
    const h = shrinkToFit(Math.min(Math.max(br.length * p.branchPlate, 0.045 * R), 0.08 * R, br.length * 0.45), hexAt, rMax);
    return h >= MIN_PLATE ? { points: hexAt(h), h } : null;
  };
  // プレートは実際に収まる枝のうち、外側の十分長いものにだけ付ける（小さな六角形が並ばないように）。
  // 該当がなければ収まる枝の中で最も長いものに付け、特徴が見た目に必ず現れるようにする
  const plates = new Map<ResolvedBranch, { points: Point[]; h: number }>();
  if (traits.branchTip === "plate") {
    const fitting = [...regular]
      .reverse()
      .map((br) => [br, branchPlate(br)] as const)
      .filter((entry): entry is readonly [ResolvedBranch, { points: Point[]; h: number }] => entry[1] !== null);
    const preferred = fitting.filter(([br]) => br.length >= 0.1 * R);
    const chosen =
      preferred.length > 0 ? preferred.slice(0, MAX_BRANCH_PLATES) : [...fitting].sort((a, b) => b[0].length - a[0].length).slice(0, 1);
    for (const [br, plate] of chosen) plates.set(br, plate);
  }
  // ring は最も外側にある十分な長さの小枝から、隣の腕へ向かって伸ばす
  const ringBranch =
    traits.branchTip === "ring" ? [...regular].reverse().find((b) => b.length >= 0.12 * R) : undefined;

  branches.forEach((br, i) => {
    const { params, base, d, length } = br;
    if (length < MIN_TWIG * 0.6) return;
    const dir = params.angle;
    // 線の太さは結晶全体で均一（結晶ごとの太さの違いだけを残す）
    const width = p.lineWidth;
    const start = growthAt(d);
    const tip = add(base, polar(length, dir));
    const end = start + length;

    strokes.push({ points: [base, tip], width, kind: "branch", growth: { start, end } });

    /** プレートが覆う小枝上の範囲の始まり（0〜1）。ここより先には二次枝を付けない */
    let plateFromU = 1;
    const plate = plates.get(br);
    if (plate) {
      const { points, h } = plate;
      // 成長の前線が六角形の内側の頂点に届いたところから、輪郭を描き始める
      const outlineStart = end - 2 * h;
      const outlineEnd = outlineStart + perimeter(points) / 2;
      plateFromU = 1 - (2 * h) / length;
      strokes.push(
        { points, width, kind: "edge", growth: { start: outlineStart, end: outlineEnd } },
        { points, width: 0, kind: "plate", fill: true, growth: { start: outlineEnd, end: outlineEnd } },
      );
    }

    // 隣の腕と繋がる輪：境界（30°線）へ垂直に伸ばし、隣のセクションの鏡像と一直線に繋がる
    const isRing = br === ringBranch;
    if (isRing) {
      const u30 = polar(1, SECTION_ANGLE);
      const meet = scale(u30, dot(tip, u30));
      strokes.push({
        points: [tip, meet],
        width,
        kind: "ring",
        growth: { start: end, end: end + lengthOf({ x: meet.x - tip.x, y: meet.y - tip.y }) },
      });
    }

    // 二次枝は隣の小枝にぶつからないよう、小枝の間隔の半分未満に制限する
    const outerGap = (branches[i + 1]?.d ?? R) - d;
    const innerGap = d - (branches[i - 1]?.d ?? core.radius);

    for (const twig of params.twigs) {
      // 装飾と重ならないようにする
      if (twig.u > plateFromU - 0.08) continue;
      if (isRing && twig.side === "inner") continue;

      const origin = add(base, polar(length * twig.u, dir));
      const twigDir = dir + (twig.side === "outer" ? -60 : 60) + twig.angleJitter;
      const gap = twig.side === "outer" ? outerGap : innerGap;
      const twigLength = Math.min(
        length * twig.lengthFactor,
        gap * 0.45,
        maxLengthInWedge(origin, twigDir, rMax) * SAFETY,
      );
      if (twigLength < MIN_TWIG) continue;
      const twigStart = start + length * twig.u;
      strokes.push({
        points: [origin, add(origin, polar(twigLength, twigDir))],
        width,
        kind: "twig",
        growth: { start: twigStart, end: twigStart + twigLength },
      });
    }
  });

  // --- 主枝 ----------------------------------------------------------------
  // 小枝の付け根で分割する（成長は連続して見えるよう growth を繋げる）
  const stops = [p.armStart, ...branches.map((b) => b.d), R].filter(
    (v, i, arr) => i === 0 || v - arr[i - 1] > 0.5,
  );
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1];
    const b = stops[i];
    strokes.unshift({
      points: [
        { x: a, y: 0 },
        { x: b, y: 0 },
      ],
      width: p.lineWidth,
      kind: "main",
      growth: { start: growthAt(a), end: growthAt(b) },
      onAxis: true,
    });
  }

  // 塗りは線より奥に描く
  return [...strokes.filter((s) => s.fill), ...strokes.filter((s) => !s.fill)];
}
