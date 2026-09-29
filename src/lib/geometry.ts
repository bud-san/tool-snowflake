/** 雪の結晶の座標データ。描画・アニメーションはこの型だけに依存する。 */

export interface Point {
  x: number;
  y: number;
}

/**
 * core: 中央部 / main: 主枝 / branch: 小枝 / twig: 二次枝
 * edge: プレートの輪郭 / ring: 隣の腕と繋がる線 / plate: プレートの塗り（fill）
 */
export type StrokeKind = "core" | "main" | "branch" | "twig" | "edge" | "ring" | "plate";

export interface Stroke {
  /** 描画順（成長方向）に並んだ点列 */
  points: Point[];
  width: number;
  kind: StrokeKind;
  /**
   * 成長タイミング。中心から成長経路に沿った距離。
   * createSnowflake で 0〜1 に正規化される。
   */
  growth: { start: number; end: number };
  /** 鏡映軸（0°）上にある要素。鏡映時に複製しない */
  onAxis?: boolean;
  /** 線ではなく塗りの多角形として描く（points は閉じた多角形の頂点） */
  fill?: boolean;
}

export const DEG = Math.PI / 180;

export const polar = (radius: number, angleDeg: number): Point => ({
  x: radius * Math.cos(angleDeg * DEG),
  y: radius * Math.sin(angleDeg * DEG),
});

export const add = (p: Point, q: Point): Point => ({ x: p.x + q.x, y: p.y + q.y });
export const scale = (p: Point, k: number): Point => ({ x: p.x * k, y: p.y * k });
export const length = (p: Point): number => Math.hypot(p.x, p.y);
export const angleOf = (p: Point): number => Math.atan2(p.y, p.x) / DEG;

export const mirrorPoint = (p: Point): Point => ({ x: p.x, y: -p.y });

export function rotatePoint(p: Point, angleDeg: number): Point {
  const c = Math.cos(angleDeg * DEG);
  const s = Math.sin(angleDeg * DEG);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

export const mapStroke = (stroke: Stroke, fn: (p: Point) => Point): Stroke => ({
  ...stroke,
  points: stroke.points.map(fn),
});

export function strokeLength(stroke: Stroke): number {
  let total = 0;
  for (let i = 1; i < stroke.points.length; i++) {
    const a = stroke.points[i - 1];
    const b = stroke.points[i];
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}
